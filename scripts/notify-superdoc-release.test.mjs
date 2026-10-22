import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildNotification, notifyRelease, sendNotification } from "./notify-superdoc-release.mjs";

const demos = JSON.parse(await readFile(new URL("../demos.json", import.meta.url), "utf8"));
const success = { check: { result: "success" }, update: { result: "success" }, deploy: { result: "success" }, record: { result: "success" } };
const options = { needs: success, demos, version: "2.25.0", dryRun: false, runUrl: "https://github.com/superdoc/demos/actions/runs/123/attempts/1" };
const webhookUrl = "https://chat.googleapis.com/v1/spaces/test/messages?key=test-key&token=test-secret";

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
  let payload;
  await notifyRelease({ root, env: {
    RELEASE_RESULTS: JSON.stringify({ check: { result: "failure" }, update: { result: "skipped" }, deploy: { result: "skipped" }, record: { result: "skipped" } }),
    RELEASE_DRY_RUN: "", TRIGGER_DRY_RUN: "true", SIMULATE_FAILURE: "true",
    GOOGLE_CHAT_WEBHOOK_URL: webhookUrl,
    GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "superdoc/demos", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_STEP_SUMMARY: `${root}/summary`,
  }, fetchImpl: async (_url, request) => { payload = JSON.parse(request.body); return new Response("", { status: 200 }); } });
  assert.match(payload.text, /\[DRY RUN\].*FAILURE/);
  assert.match(payload.text, /unknown \(release detection did not complete\)/);
  assert.match(await readFile(`${root}/summary`, "utf8"), /Google Chat notification delivered/);
});
