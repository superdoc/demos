import assert from "node:assert/strict";
import test from "node:test";
import { assertExceptionVersion, dependencyUpdatePlan, versionExceptions } from "./demo-version-policy.mjs";

const independent = {
  id: "history", packageDirectory: "version-history",
  superdocVersionException: { version: "2.30.0-next.4", reason: "Waiting for stable Changes API" },
};

test("version exceptions require an exact version and an explanation", () => {
  for (const exception of [false, null, {}, { version: "next", reason: "Test" }, { version: "^2.30.0", reason: "Test" }, { version: "2.30.0-next.4" }]) {
    assert.throws(() => versionExceptions([{ ...independent, superdocVersionException: exception }]), /exact version and a reason/);
  }
  assert.equal(versionExceptions([independent]).get("version-history").version, "2.30.0-next.4");
});

test("exempt demos still have their actual version checked against the declared pin", () => {
  const exceptions = versionExceptions([independent]);
  assert.doesNotThrow(() => assertExceptionVersion(exceptions, "version-history", "2.30.0-next.4"));
  assert.throws(() => assertExceptionVersion(exceptions, "version-history", "2.30.0-next.5"), /expected exception version/);
});

test("stable updates preserve independent pins and install their frozen lockfiles", () => {
  const exceptions = versionExceptions([independent]);
  const entry = { directory: "version-history", manager: "pnpm", dependencies: { superdoc: "2.30.0" } };
  assert.deepEqual(dependencyUpdatePlan(entry, exceptions), { dependencies: {}, args: ["install", "--frozen-lockfile"] });
  assert.deepEqual(dependencyUpdatePlan({ ...entry, manager: "npm" }, exceptions).args, ["ci"]);
  assert.deepEqual(dependencyUpdatePlan(entry, new Map()).dependencies, { superdoc: "2.30.0" });
  assert.deepEqual(dependencyUpdatePlan(entry, new Map()).args, ["update", "superdoc@2.30.0"]);
});

test("a SuperDoc exception does not suppress updates of unrelated dependencies", () => {
  const plan = dependencyUpdatePlan({ directory: "version-history", manager: "npm", dependencies: {
    superdoc: "2.30.0", "@superdoc/react": "2.30.0",
  } }, versionExceptions([independent]));
  assert.deepEqual(plan.dependencies, { "@superdoc/react": "2.30.0" });
  assert.deepEqual(plan.args, ["install", "@superdoc/react@2.30.0", "--save-exact"]);
});
