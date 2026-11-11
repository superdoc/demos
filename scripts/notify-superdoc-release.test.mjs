import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildNotification, describeTrigger, notifyRelease, sendNotification, shouldNotifyTrigger } from "./notify-superdoc-release.mjs";

const demos = JSON.parse(await readFile(new URL("../demos.json", import.meta.url), "utf8"));
const success = { check: { result: "success" }, update: { result: "success" }, deploy: { result: "success" }, record: { result: "success" } };
const options = { needs: success, demos, version: "2.25.0", dryRun: false, runUrl: "https://github.com/superdoc/demos/actions/runs/123/attempts/1" };
const botToken = "xoxb-test-secret";
const channelId = "C123DEMOS";
const triggerEnv = { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "superdoc/demos", GITHUB_REF_NAME: "main", GITHUB_ACTOR: "maintainer" };
const pullRequest = { number: 93, title: "Collab quickstart integration", head: { ref: "simba-integration" }, base: { ref: "main" } };

test("PR notifications identify the linked PR, branches, and triggering action", () => {
  const trigger = describeTrigger({ env: { ...triggerEnv, GITHUB_EVENT_NAME: "pull_request" }, event: { action: "synchronize", pull_request: pullRequest } });
  const { text } = buildNotification({ ...options, dryRun: true, trigger });
  assert.match(text, /Trigger: PR testing — <https:\/\/github.com\/superdoc\/demos\/pull\/93\|PR #93: Collab quickstart integration>/);
  assert.match(text, /simba-integration → main; synchronize/);
  assert.doesNotMatch(text, /Latest stable release check|Trigger: PR merge/);
});

test("merged PR testing is distinct from PR testing and stable release checks", () => {
  const env = { ...triggerEnv, GITHUB_EVENT_NAME: "pull_request" };
  assert.match(describeTrigger({ env, event: { action: "closed", pull_request: { ...pullRequest, merged: true } } }), /^PR merge.*PR #93/);
  assert.match(describeTrigger({ env, event: { action: "closed", pull_request: { ...pullRequest, merged: false } } }), /^PR testing/);
  assert.match(describeTrigger({ env: { ...env, GITHUB_EVENT_NAME: "merge_group" }, event: { merge_group: { head_ref: "queue/pr-93" } } }), /^Merge queue testing — queue\/pr-93$/);
});

test("scheduled and manual release checks identify their source without claiming a new release", () => {
  assert.equal(describeTrigger({ env: { ...triggerEnv, GITHUB_EVENT_NAME: "schedule" } }), "Latest stable release check — scheduled poll of npm latest");
  const env = { ...triggerEnv, GITHUB_EVENT_NAME: "workflow_dispatch" };
  assert.equal(describeTrigger({ env }), "Latest stable release check — manual run by maintainer on main");
  assert.equal(describeTrigger({ env, event: { inputs: { deploy_current: "true" } } }), "Production source deployment — manual run by maintainer on main");
  for (const inputs of [{ simulated_latest: "2.25.0" }, { simulated_deployed: "0.0.0" }, { simulate_failure: "true" }]) {
    assert.match(describeTrigger({ env, event: { inputs } }), /^Manual release simulation by maintainer on main$/);
  }
  assert.match(describeTrigger({ env, event: { inputs: { simulate_failure: "false" } } }), /^Latest stable release check/);
});

test("push notifications link the commit without assuming a PR was merged", () => {
  const commit = "a".repeat(40);
  const trigger = describeTrigger({ env: { ...triggerEnv, GITHUB_EVENT_NAME: "push" }, event: { after: commit } });
  assert.equal(trigger, `Branch testing after push or merge — main — <https://github.com/superdoc/demos/commit/${commit}|aaaaaaa>`);
});

test("PR titles and branch names cannot inject Slack markup or mentions", () => {
  const trigger = describeTrigger({ env: { ...triggerEnv, GITHUB_EVENT_NAME: "pull_request" }, event: { action: "synchronize", pull_request: { ...pullRequest, title: "<!channel>\n*test*|bad &lt;!here&gt;", head: { ref: "<@U123>" } } } });
  assert.doesNotMatch(trigger, /<!channel>|<@U123>|\n|\*test\*|\|bad/);
  assert.ok(trigger.includes("&amp;lt;!here&amp;gt;"));
});

test("only merged PRs and stable release runs can notify", () => {
  const env = { ...triggerEnv, GITHUB_EVENT_NAME: "pull_request" };
  for (const action of ["opened", "synchronize", "reopened", "edited", "closed"]) {
    assert.equal(shouldNotifyTrigger({ env, event: { action, pull_request: { ...pullRequest, merged: false } } }), false);
  }
  assert.equal(shouldNotifyTrigger({ env, event: { action: "closed", pull_request: { ...pullRequest, merged: true } } }), true);
  assert.equal(shouldNotifyTrigger({ env: { ...triggerEnv, GITHUB_EVENT_NAME: "schedule" } }), true);
  for (const eventName of ["push", "merge_group", "pull_request_target", undefined]) {
    assert.equal(shouldNotifyTrigger({ env: { ...triggerEnv, GITHUB_EVENT_NAME: eventName } }), false);
  }
  const manual = { ...triggerEnv, GITHUB_EVENT_NAME: "workflow_dispatch" };
  assert.equal(shouldNotifyTrigger({ env: manual, event: { inputs: { dry_run: "false" } } }), true);
  for (const inputs of [{}, { dry_run: "true" }, { dry_run: "false", simulated_latest: "2.25.0" }, { dry_run: "false", simulated_deployed: "0.0.0" }, { dry_run: "false", simulate_failure: "true" }]) {
    assert.equal(shouldNotifyTrigger({ env: manual, event: { inputs } }), false);
  }
});

test("PR updates never contact Slack, even when pipeline stages fail", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "superdoc-notification-suppression-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const action of ["opened", "synchronize", "reopened", "closed"]) {
    await writeFile(`${root}/event.json`, JSON.stringify({ action, pull_request: { ...pullRequest, merged: false } }));
    await notifyRelease({ root, env: {
      GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: `${root}/event.json`,
      RELEASE_RESULTS: JSON.stringify({ check: { result: "failure" } }),
    }, fetchImpl: () => { assert.fail("PR updates must not send a notification"); } });
  }
});

test("successful deployments list every catalog demo with a production link", () => {
  const { text } = buildNotification(options);
  assert.match(text, /\[PRODUCTION\].*SUCCESS/);
  assert.match(text, /SuperDoc: 2\.25\.0/);
  assert.match(text, /Demos updated:/);
  for (const demo of demos) assert.ok(text.includes(`<https://demos.superdoc.dev${demo.liveDemoUri}|${demo.title}>`));
  assert.ok(text.includes(`<${options.runUrl}|View workflow logs>`));
});

test("new demos in the catalog are included without changing notification code", () => {
  const { text } = buildNotification({ ...options, demos: [...demos, { title: "Future Demo", liveDemoUri: "/future/" }] });
  assert.ok(text.includes("<https://demos.superdoc.dev/future/|Future Demo>"));
});

test("dry-run success describes validation and labels links as current production", () => {
  const { text } = buildNotification({ ...options, dryRun: true, needs: { ...success, record: { result: "skipped" } } });
  assert.match(text, /\[DRY RUN\].*SUCCESS/);
  assert.match(text, /No production deployment was performed/);
  assert.match(text, /Demos validated/);
  assert.doesNotMatch(text, /Demos updated:/);
});

test("each pipeline failure reports the failed stage without claiming an unsuccessful deployment", () => {
  for (const stage of ["check", "update", "deploy"]) {
    const needs = { ...success, [stage]: { result: "failure" }, deploy: { result: stage === "deploy" ? "failure" : "skipped" }, record: { result: "skipped" } };
    const { text } = buildNotification({ ...options, needs });
    assert.match(text, /FAILURE/);
    assert.match(text, /Failed stage\(s\):/);
    assert.match(text, /Demos targeted \(deployment not confirmed/);
    assert.doesNotMatch(text, /Demos updated:/);
  }
});

test("a marker failure distinguishes a successful deployment from a failed record", () => {
  const { text } = buildNotification({ ...options, needs: { ...success, record: { result: "failure" } } });
  assert.match(text, /FAILURE/);
  assert.match(text, /Deployment succeeded, but recording the deployed version failed/);
  assert.match(text, /Demos updated:/);
});

test("no-release checks stay silent; simulated failures are explicitly labeled", () => {
  const needs = { check: { result: "success" }, update: { result: "skipped" }, deploy: { result: "skipped" }, record: { result: "skipped" } };
  assert.equal(buildNotification({ ...options, needs }), null);
  const { text } = buildNotification({ ...options, dryRun: true, simulatedFailure: true, needs: { ...needs, check: { result: "failure" } } });
  assert.match(text, /\[DRY RUN\].*FAILURE/);
  assert.match(text, /Intentional simulated release failure/);
});

test("unsafe links are rejected and catalog titles cannot inject mentions", () => {
  for (const liveDemoUri of ["https://elsewhere.example/demo", "//elsewhere.example/demo", "/\\elsewhere.example/demo"]) {
    assert.throws(() => buildNotification({ ...options, demos: [{ title: "Bad demo", liveDemoUri }] }));
  }
  const { text } = buildNotification({ ...options, demos: [{ title: "<!here>\nDemo & more", liveDemoUri: "/new/" }] });
  assert.doesNotMatch(text, /<!here>/);
  assert.ok(text.includes("Demo &amp; more"));
});

test("bot delivery validates configuration before contacting Slack", async () => {
  const fetchImpl = () => assert.fail("Invalid configuration must not contact Slack");
  await assert.rejects(sendNotification({ channelId, message: {}, fetchImpl }), /SLACK_BOT_TOKEN is not configured/);
  await assert.rejects(sendNotification({ botToken, message: {}, fetchImpl }), /SLACK_CHANNEL_ID is not configured/);
  for (const invalidId of ["#int-demo-gallery", "https://example.com", "C123\n", "D123"]) {
    await assert.rejects(sendNotification({ botToken, channelId: invalidId, message: {}, fetchImpl }), /Invalid SLACK_CHANNEL_ID/);
  }
});

test("bot delivery posts the message to the configured channel and retries temporary HTTP errors", async () => {
  const statuses = [429, 503, 200];
  const delays = [];
  let calls = 0;
  await sendNotification({ botToken, channelId, message: { text: "test", channel: "COTHER" }, sleep: async (ms) => { delays.push(ms); }, fetchImpl: async (url, request) => {
    assert.equal(url, "https://slack.com/api/chat.postMessage");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.Authorization, `Bearer ${botToken}`);
    assert.equal(request.redirect, "error");
    assert.deepEqual(JSON.parse(request.body), { text: "test", channel: channelId, unfurl_links: false, unfurl_media: false });
    return new Response(JSON.stringify({ ok: true }), { status: statuses[calls++], headers: { "Retry-After": calls === 1 ? "3" : "0" } });
  } });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [3000, 2000]);
});

test("API errors and malformed responses fail even with HTTP 200", async () => {
  for (const body of [JSON.stringify({ ok: false, error: "missing_scope" }), JSON.stringify({ ok: false, error: "not_in_channel" }), "null", "{}", "not JSON"]) {
    await assert.rejects(sendNotification({ botToken, channelId, message: {}, fetchImpl: async () => new Response(body) }), /Slack notification (rejected|failed)/);
  }
});

test("persistent errors stop retrying, and long rate limits are not retried early", async () => {
  let calls = 0;
  await assert.rejects(sendNotification({ botToken, channelId, message: {}, sleep: async () => {}, fetchImpl: async () => {
    calls++;
    return new Response("", { status: 503 });
  } }), /HTTP 503/);
  assert.equal(calls, 3);
  await assert.rejects(sendNotification({ botToken, channelId, message: {}, sleep: () => assert.fail("Must not retry before Retry-After"), fetchImpl: async () => new Response("", { status: 429, headers: { "Retry-After": "120" } }) }), /rate limited/);
});

test("delivery errors never expose bot credentials or response bodies", async () => {
  for (const fetchImpl of [
    async () => { throw new Error(botToken); },
    async () => new Response(botToken, { status: 403 }),
    async () => new Response(botToken),
    async () => new Response(JSON.stringify({ ok: false, error: botToken })),
  ]) {
    await assert.rejects(sendNotification({ botToken, channelId, message: {}, fetchImpl }), (error) => {
      assert.doesNotMatch(error.message, /xoxb|test-secret/);
      return true;
    });
  }
});

test("a stable release sends the catalog and workflow link through the Slack secret", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "superdoc-slack-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(`${root}/demos.json`, JSON.stringify(demos));
  let calls = 0;
  await notifyRelease({ root, env: {
    ...triggerEnv,
    GITHUB_EVENT_NAME: "schedule", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
    RELEASE_RESULTS: JSON.stringify(success), SUPERDOC_VERSION: "2.25.0",
    SLACK_BOT_TOKEN: botToken, SLACK_CHANNEL_ID: channelId,
    GITHUB_STEP_SUMMARY: `${root}/summary`,
  }, fetchImpl: async (url, request) => {
    calls++;
    assert.equal(url, "https://slack.com/api/chat.postMessage");
    assert.deepEqual(JSON.parse(request.body), { ...buildNotification({ ...options, trigger: describeTrigger({ env: { ...triggerEnv, GITHUB_EVENT_NAME: "schedule" } }) }), channel: channelId, unfurl_links: false, unfurl_media: false });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } });
  assert.equal(calls, 1);
  assert.match(await readFile(`${root}/summary`, "utf8"), /Slack notification delivered/);
});

test("a detection failure before outputs exist still sends a labeled dry-run notification", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "superdoc-notification-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(`${root}/demos.json`, JSON.stringify(demos));
  await writeFile(`${root}/event.json`, JSON.stringify({ action: "closed", pull_request: { ...pullRequest, merged: true } }));
  let payload;
  await notifyRelease({ root, env: {
    RELEASE_RESULTS: JSON.stringify({ check: { result: "failure" }, update: { result: "skipped" }, deploy: { result: "skipped" }, record: { result: "skipped" } }),
    RELEASE_DRY_RUN: "", TRIGGER_DRY_RUN: "true",
    SLACK_BOT_TOKEN: botToken, SLACK_CHANNEL_ID: channelId,
    GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "superdoc/demos", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: `${root}/event.json`,
    GITHUB_STEP_SUMMARY: `${root}/summary`,
  }, fetchImpl: async (_url, request) => { payload = JSON.parse(request.body); return new Response(JSON.stringify({ ok: true }), { status: 200 }); } });
  assert.match(payload.text, /\[DRY RUN\].*FAILURE/);
  assert.match(payload.text, /unknown \(release detection did not complete\)/);
  assert.match(payload.text, /Trigger: PR merge.*PR #93: Collab quickstart integration/);
  assert.match(await readFile(`${root}/summary`, "utf8"), /Slack notification delivered/);
});
