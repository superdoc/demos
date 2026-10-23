import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildNotification, describeTrigger, notifyRelease, sendNotification, shouldNotifyTrigger } from "./notify-superdoc-release.mjs";

const demos = JSON.parse(await readFile(new URL("../demos.json", import.meta.url), "utf8"));
const success = { check: { result: "success" }, update: { result: "success" }, deploy: { result: "success" }, record: { result: "success" } };
const options = { needs: success, demos, version: "2.25.0", dryRun: false, runUrl: "https://github.com/superdoc/demos/actions/runs/123/attempts/1" };
const webhookUrl = "https://chat.googleapis.com/v1/spaces/test/messages?key=test-key&token=test-secret";
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

test("PR titles and branch names cannot inject Chat markup or mentions", () => {
  const trigger = describeTrigger({ env: { ...triggerEnv, GITHUB_EVENT_NAME: "pull_request" }, event: { action: "synchronize", pull_request: { ...pullRequest, title: "<users/all>\n*test*|bad", head: { ref: "<users/all>" } } } });
  assert.doesNotMatch(trigger, /<users\/all>|\n|\*test\*|\|bad/);
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

test("PR updates never call the webhook, even when pipeline stages fail", async (t) => {
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
  const { text } = buildNotification({ ...options, demos: [{ title: "<users/all>\nDemo", liveDemoUri: "/new/" }] });
  assert.doesNotMatch(text, /<users\/all>/);
});

test("webhook delivery posts the payload and retries temporary HTTP errors", async () => {
  const statuses = [429, 503, 200];
  let calls = 0;
  await sendNotification({ webhookUrl, message: { text: "test" }, sleep: async () => {}, fetchImpl: async (url, request) => {
    assert.equal(url, webhookUrl);
    assert.equal(request.method, "POST");
    assert.deepEqual(JSON.parse(request.body), { text: "test" });
    return new Response("", { status: statuses[calls++] });
  } });
  assert.equal(calls, 3);
});

test("webhook errors never expose its URL or response body", async () => {
  await assert.rejects(sendNotification({ webhookUrl, message: {}, fetchImpl: async () => { throw new Error(webhookUrl); } }), (error) => {
    assert.doesNotMatch(error.message, /test-secret|test-key|chat.googleapis.com/);
    return true;
  });
  await assert.rejects(sendNotification({ webhookUrl, message: {}, fetchImpl: async () => new Response(webhookUrl, { status: 403 }) }), /^Error: Google Chat notification failed \(HTTP 403\)$/);
  await assert.rejects(sendNotification({ webhookUrl: "", message: {} }), /not configured/);
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
    GOOGLE_CHAT_WEBHOOK_URL: webhookUrl,
    GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "superdoc/demos", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: `${root}/event.json`,
    GITHUB_STEP_SUMMARY: `${root}/summary`,
  }, fetchImpl: async (_url, request) => { payload = JSON.parse(request.body); return new Response("", { status: 200 }); } });
  assert.match(payload.text, /\[DRY RUN\].*FAILURE/);
  assert.match(payload.text, /unknown \(release detection did not complete\)/);
  assert.match(payload.text, /Trigger: PR merge.*PR #93: Collab quickstart integration/);
  assert.match(await readFile(`${root}/summary`, "utf8"), /Google Chat notification delivered/);
});
