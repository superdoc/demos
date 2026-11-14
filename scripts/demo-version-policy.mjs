import { readFile } from "node:fs/promises";
import path from "node:path";

const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function versionExceptions(demos) {
  const exceptions = new Map();
  for (const demo of demos) {
    const exception = demo.superdocVersionException;
    if (exception === undefined) continue;
    if (!exception || typeof exception.version !== "string"
      || exception.version.trim() !== exception.version || !exactVersion.test(exception.version)
      || typeof exception.reason !== "string" || !exception.reason.trim()) {
      throw new Error(`${demo.id}: superdocVersionException requires an exact version and a reason`);
    }
    if (!demo.packageDirectory || exceptions.has(demo.packageDirectory)) {
      throw new Error(`${demo.id}: version exception requires a unique packageDirectory`);
    }
    if (exception.channel !== undefined && exception.channel !== "next") {
      throw new Error(`${demo.id}: version exception channel must be next when provided`);
    }
    exceptions.set(demo.packageDirectory, { id: demo.id, version: exception.version, reason: exception.reason,
      ...(exception.channel ? { channel: exception.channel } : {}) });
  }
  return exceptions;
}

export async function readVersionPolicy(root) {
  const demos = JSON.parse(await readFile(path.join(root, "demos.json"), "utf8"));
  if (!Array.isArray(demos) || !demos.length) throw new Error("demos.json must contain at least one demo");
  return { demos, exceptions: versionExceptions(demos) };
}

export function nextDependencyTargets(demos) {
  const targets = [];
  for (const demo of demos) {
    if (demo.superdocVersionException?.channel !== "next") continue;
    targets.push({ directory: demo.packageDirectory, dependency: "superdoc" });
    if (demo.packageDirectory === "canonical-collaboration-demo/client") {
      targets.push({ directory: demo.packageDirectory, dependency: "@superdoc/react" },
        { directory: "canonical-collaboration-demo/server", dependency: "@superdoc/sdk" });
    }
  }
  return targets;
}

export function assertExceptionVersion(exceptions, directory, actual) {
  const exception = exceptions.get(directory);
  if (exception && actual !== exception.version) {
    throw new Error(`${exception.id}: expected exception version ${exception.version}, found ${actual}`);
  }
}

// Independent demos still install and run all checks; only their SuperDoc pin
// is protected from the stable-release updater.
export function dependencyUpdatePlan(entry, exceptions) {
  const dependencies = Object.fromEntries(Object.entries(entry.dependencies)
    .filter(([name]) => name !== "superdoc" || !exceptions.has(entry.directory)
      || exceptions.get(entry.directory).channel === "next"));
  const specs = Object.entries(dependencies).map(([name, version]) => `${name}@${version}`);
  let args;
  if (!specs.length) {
    args = entry.manager === "npm" ? ["ci"] : ["install", "--frozen-lockfile"];
  } else {
    args = entry.manager === "npm" ? ["install", ...specs, "--save-exact"] : ["update", ...specs];
  }
  return { dependencies, args };
}
