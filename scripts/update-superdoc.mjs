import { appendFile, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { assertExceptionVersion, dependencyUpdatePlan, readVersionPolicy } from "./demo-version-policy.mjs";

const { demos, exceptions } = await readVersionPolicy(process.cwd());

const requested = process.argv[2] || "latest";
const resolveVersion = (dependency, specifier) => {
  const result = spawnSync("npm", ["view", `${dependency}@${specifier}`, "version", "--json"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  const resolved = JSON.parse(result.stdout);
  if (typeof resolved !== "string") {
    throw new Error(`${dependency}@${specifier} resolved to multiple versions; use an exact version or npm tag`);
  }
  return resolved;
};

const versions = {
  superdoc: resolveVersion("superdoc", requested),
  "@superdoc/react": resolveVersion("@superdoc/react", "latest"),
  "@superdoc/sdk": resolveVersion("@superdoc/sdk", "latest"),
};
const collaborationDirectory = "canonical-collaboration-demo/client";
const collaborationException = exceptions.get(collaborationDirectory);
const collaborationVersions = collaborationException?.channel === "next" ? {
  superdoc: resolveVersion("superdoc", "next"),
  "@superdoc/react": resolveVersion("@superdoc/react", "next"),
  "@superdoc/sdk": resolveVersion("@superdoc/sdk", "next"),
} : versions;
const packages = [
  { directory: "rag/apps/web", manifest: "rag/apps/web/package.json", manager: "bun", dependencies: { superdoc: versions.superdoc } },
  { directory: "custom-word-editor", manifest: "custom-word-editor/package.json", manager: "pnpm", dependencies: { superdoc: versions.superdoc } },
  { directory: "template-builder-document-api-v2-demo", manifest: "template-builder-document-api-v2-demo/package.json", manager: "pnpm", dependencies: { superdoc: versions.superdoc } },
  { directory: "version-history", manifest: "version-history/package.json", manager: "pnpm", dependencies: { superdoc: versions.superdoc } },
  {
    directory: "canonical-collaboration-demo/client",
    manifest: "canonical-collaboration-demo/client/package.json",
    manager: "npm",
    dependencies: { superdoc: collaborationVersions.superdoc, "@superdoc/react": collaborationVersions["@superdoc/react"] },
  },
  {
    directory: "canonical-collaboration-demo/server",
    manifest: "canonical-collaboration-demo/server/package.json",
    manager: "npm",
    dependencies: { "@superdoc/sdk": collaborationVersions["@superdoc/sdk"] },
  },
];

for (const entry of packages) {
  const manifest = JSON.parse(await readFile(entry.manifest, "utf8"));
  assertExceptionVersion(exceptions, entry.directory, manifest.dependencies?.superdoc);
  const exception = exceptions.get(entry.directory);
  if (exception) console.log(`${exception.channel === "next" ? "Advancing Next release for" : "Keeping pinned"} ${exception.id}: ${exception.reason}`);
  const plan = dependencyUpdatePlan(entry, exceptions);
  for (const [name, version] of Object.entries(plan.dependencies)) manifest.dependencies[name] = version;
  await writeFile(entry.manifest, `${JSON.stringify(manifest, null, manifest.name === "@docrag/web" ? "\t" : 2)}\n`);

  const result = spawnSync(entry.manager, plan.args, { cwd: entry.directory, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);

  if (exception?.channel === "next") {
    exception.version = manifest.dependencies.superdoc;
    demos.find((demo) => demo.packageDirectory === entry.directory).superdocVersionException.version = exception.version;
  }

}

if (collaborationException?.channel === "next") await writeFile("demos.json", `${JSON.stringify(demos, null, 2)}\n`);

const resolveInstalledVersion = async (entry, dependency) => {
  const candidates = [
    `${entry.directory}/node_modules/${dependency}/package.json`,
    ...(dependency === "superdoc" ? [`rag/node_modules/superdoc/package.json`] : []),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(candidate, "utf8")).version;
    } catch {}
  }
  throw new Error(`Could not find installed ${dependency} for ${entry.manifest}`);
};

const coreEntries = packages.filter((entry) => "superdoc" in entry.dependencies);
const installed = await Promise.all(coreEntries.map(async (entry) => {
  const version = await resolveInstalledVersion(entry, "superdoc");
  assertExceptionVersion(exceptions, entry.directory, version);
  return { entry, version };
}));
const resolvedVersions = installed.filter(({ entry }) => !exceptions.has(entry.directory)).map(({ version }) => version);

if (new Set(resolvedVersions).size !== 1) {
  throw new Error(`Demos resolved different SuperDoc versions: ${resolvedVersions.join(", ")}`);
}

const resolved = resolvedVersions[0];
const reactEntry = packages.find((entry) => "@superdoc/react" in entry.dependencies);
const sdkEntry = packages.find((entry) => "@superdoc/sdk" in entry.dependencies);
const reactVersion = await resolveInstalledVersion(reactEntry, "@superdoc/react");
const sdkVersion = await resolveInstalledVersion(sdkEntry, "@superdoc/sdk");
const landingPath = "dist-landing/index.html";
const landing = await readFile(landingPath, "utf8");
await writeFile(landingPath, landing.replace(/SuperDoc v\d+\.\d+\.\d+(?:[-+][\w.-]+)?/g, `SuperDoc v${resolved}`));
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${resolved}\n`);
console.log(`Updated SuperDoc packages: superdoc ${resolved}, @superdoc/react ${reactVersion}, @superdoc/sdk ${sdkVersion}`);
