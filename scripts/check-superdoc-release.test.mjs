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
  const directories = ["rag/apps/web", "superdoc-inline-revisions", "template-builder-document-api-v2-demo", "canonical-collaboration-demo/client", "version-history"];
  await writeFile(`${root}/demos.json`, JSON.stringify(directories.map((packageDirectory) => ({ id: packageDirectory, packageDirectory }))));
  for (const directory of directories) {
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
  assert.equal(await readFile(`${root}/outputs`, "utf8"), "update=true\nversion=2.25.0\ndry_run=true\ndeploy_current=false\n");
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
  assert.equal((await checkRelease({ root, env: { DRY_RUN: "false", SIMULATE_FAILURE: "true" }, fetchImpl })).dry_run, true);
});

test("registry errors fail the check instead of starting an update", async (t) => {
  const root = await fixture(t);
  await assert.rejects(checkRelease({ root, env: {}, fetchImpl: async () => new Response("unavailable", { status: 503 }) }), /HTTP 503/);
  await assert.rejects(checkRelease({ root, env: { SIMULATED_LATEST: "2.26.0-beta.1" } }), /exact stable version/);
});

test("merged source deploys the same SuperDoc version without updating dependencies or querying npm", async (t) => {
  const root = await fixture(t);
  const result = await checkRelease({ root, env: {
    DEPLOY_CURRENT: "true", DRY_RUN: "false", GITHUB_OUTPUT: `${root}/outputs`,
  }, fetchImpl: () => assert.fail("A source deployment must use committed dependencies") });
  assert.equal(result.update, true);
  assert.equal(result.version, "2.24.0");
  assert.equal(result.dry_run, false);
  assert.equal(result.simulation, false);
  assert.match(await readFile(`${root}/outputs`, "utf8"), /deploy_current=true/);
});

test("source deployment retains explicit dry runs and simulation safeguards", async (t) => {
  const root = await fixture(t);
  const fetchImpl = async () => Response.json({ version: "2.25.0" });
  assert.equal((await checkRelease({ root, env: { DEPLOY_CURRENT: "true", DRY_RUN: "true" }, fetchImpl })).dry_run, true);
  for (const simulation of [{ SIMULATED_LATEST: "2.25.0" }, { SIMULATED_DEPLOYED: "0.0.0" }, { SIMULATE_FAILURE: "true" }]) {
    const result = await checkRelease({ root, env: { DEPLOY_CURRENT: "true", DRY_RUN: "false", ...simulation }, fetchImpl });
    assert.equal(result.dry_run, true);
    assert.equal(result.simulation, true);
  }
});

test("source deployment rejects mismatched versions and SuperDoc rollbacks", async (t) => {
  const root = await fixture(t);
  const env = { DEPLOY_CURRENT: "true", DRY_RUN: "false" };
  await writeFile(`${root}/.github/superdoc-release.json`, JSON.stringify({ version: "2.25.0" }));
  await assert.rejects(checkRelease({ root, env }), /roll back/);
  await writeFile(`${root}/superdoc-inline-revisions/package.json`, JSON.stringify({ dependencies: { superdoc: "2.26.0" } }));
  await assert.rejects(checkRelease({ root, env }), /matching exact stable/);
});

async function addPrereleaseException(root) {
  const demos = JSON.parse(await readFile(`${root}/demos.json`, "utf8"));
  demos.find((demo) => demo.id === 'version-history').superdocVersionException = {
    version: '2.30.0-next.4', reason: 'Changes API is not stable yet',
  };
  await writeFile(`${root}/demos.json`, JSON.stringify(demos));
  await writeFile(`${root}/version-history/package.json`, JSON.stringify({ dependencies: { superdoc: '2.30.0-next.4' } }));
}

test("an explicit prerelease exception permits source deployment without changing the stable release version", async (t) => {
  const root = await fixture(t);
  await addPrereleaseException(root);
  const result = await checkRelease({ root, env: {
    DEPLOY_CURRENT: 'true', GITHUB_STEP_SUMMARY: `${root}/summary`,
  }, fetchImpl: () => assert.fail('Source deployment must not query npm') });
  assert.equal(result.version, '2.24.0');
  assert.equal(result.update, true);
  assert.match(await readFile(`${root}/summary`, 'utf8'), /version-history: 2\.30\.0-next\.4/);
});

test("a prerelease exception does not prevent scheduled stable updates or excuse mismatches in other demos", async (t) => {
  const root = await fixture(t);
  await addPrereleaseException(root);
  assert.equal((await checkRelease({ root, env: { SIMULATED_LATEST: '2.25.0' } })).update, true);
  await writeFile(`${root}/superdoc-inline-revisions/package.json`, JSON.stringify({ dependencies: { superdoc: '2.23.0' } }));
  await assert.rejects(checkRelease({ root, env: { DEPLOY_CURRENT: 'true' } }), /matching exact stable/);
});

test("removing an exception restores strict parity; changing its pinned version fails explicitly", async (t) => {
  const root = await fixture(t);
  await addPrereleaseException(root);
  const env = { DEPLOY_CURRENT: 'true' };
  await writeFile(`${root}/version-history/package.json`, JSON.stringify({ dependencies: { superdoc: '2.30.0-next.5' } }));
  await assert.rejects(checkRelease({ root, env }), /expected exception version/);
  const demos = JSON.parse(await readFile(`${root}/demos.json`, 'utf8'));
  delete demos.find((demo) => demo.id === 'version-history').superdocVersionException;
  await writeFile(`${root}/demos.json`, JSON.stringify(demos));
  await assert.rejects(checkRelease({ root, env }), /matching exact stable/);
});
