import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkRelease, decideRelease } from "./check-superdoc-release.mjs";

const installed = ["2.24.0", "2.24.0", "2.24.0", "2.24.0"];

test("new stable release updates; the same successful release is a no-op", () => {
  assert.equal(decideRelease({ latest: "2.25.0", deployed: "2.24.0", installed }).update, true);
  assert.equal(decideRelease({ latest: "2.25.0", deployed: "2.25.0", installed }).update, false);
});

test("a failed deployment is retried even when manifests were already committed", () => {
  assert.equal(decideRelease({ latest: "2.25.0", deployed: "2.24.0", installed: ["2.25.0"] }).update, true);
  assert.equal(decideRelease({ latest: "2.25.0", deployed: null, installed: ["2.25.0"] }).update, true);
});

test("prereleases and malformed npm metadata cannot trigger an update", () => {
  for (const latest of ["2.26.0-next.1", "2.26.0-rc.0", "latest", "v2.25.0", "2.25.0\nupdate=true", null]) {
    assert.equal(decideRelease({ latest, deployed: "2.24.0", installed }).update, false);
  }
});

test("version comparisons are numeric and never roll demos backward", () => {
  assert.equal(decideRelease({ latest: "2.100.0", deployed: "2.99.0", installed }).update, true);
  assert.equal(decideRelease({ latest: "2.24.0", deployed: "2.25.0", installed }).update, false);
  assert.equal(decideRelease({ latest: "2.25.0", deployed: "2.24.0", installed: ["2.26.0", "2.24.0"] }).update, false);
});

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "superdoc-release-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(`${root}/.github`);
  await writeFile(`${root}/.github/superdoc-release.json`, JSON.stringify({ version: "2.24.0" }));
  for (const directory of ["rag/apps/web", "superdoc-inline-revisions", "template-builder-document-api-v2-demo", "canonical-collaboration-demo/client"]) {
    await mkdir(`${root}/${directory}`, { recursive: true });
    await writeFile(`${root}/${directory}/package.json`, JSON.stringify({ dependencies: { superdoc: "2.24.0" } }));
  }
  return root;
}

test("simulated npm latest flows into workflow outputs with dry-run forced on", async (t) => {
  const root = await fixture(t);
  const result = await checkRelease({
    root,
    env: {
      SIMULATED_LATEST: "2.25.0",
      SIMULATED_DEPLOYED: "2.24.0",
      DRY_RUN: "false",
      GITHUB_OUTPUT: `${root}/outputs`,
      GITHUB_STEP_SUMMARY: `${root}/summary`,
    },
    fetchImpl: () => { throw new Error("Simulation must not need a registry publish"); },
  });
  assert.deepEqual(result, {
    update: true, reason: "New stable npm release", version: "2.25.0", dry_run: true, simulation: true,
  });
  assert.equal(await readFile(`${root}/outputs`, "utf8"), "update=true\nversion=2.25.0\ndry_run=true\n");
  assert.match(await readFile(`${root}/summary`, "utf8"), /Simulation: true/);
  assert.equal(JSON.parse(await readFile(`${root}/.github/superdoc-release.json`, "utf8")).version, "2.24.0");
});

test("production checks use the npm registry and require explicit live mode", async (t) => {
  const root = await fixture(t);
  const fetchImpl = async (url) => {
    assert.equal(url, "https://registry.npmjs.org/superdoc/latest");
    return Response.json({ version: "2.25.0" });
  };
  assert.equal((await checkRelease({ root, env: {}, fetchImpl })).dry_run, true);
  assert.equal((await checkRelease({ root, env: { DRY_RUN: "false" }, fetchImpl })).dry_run, false);
  assert.equal((await checkRelease({ root, env: { DRY_RUN: "false", SIMULATED_DEPLOYED: "0.0.0" }, fetchImpl })).dry_run, true);
});

test("registry errors fail the check instead of starting an update", async (t) => {
  const root = await fixture(t);
  await assert.rejects(checkRelease({ root, env: {}, fetchImpl: async () => new Response("unavailable", { status: 503 }) }), /HTTP 503/);
  await assert.rejects(checkRelease({ root, env: { SIMULATED_LATEST: "2.26.0-beta.1" } }), /exact stable version/);
});
