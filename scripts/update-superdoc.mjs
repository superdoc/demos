import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const requested = process.argv[2] || "latest";
const packages = [
  { directory: "rag/apps/web", manifest: "rag/apps/web/package.json", manager: "bun", dependencies: { superdoc: requested } },
  { directory: "superdoc-inline-revisions", manifest: "superdoc-inline-revisions/package.json", manager: "pnpm", dependencies: { superdoc: requested } },
  { directory: "template-builder-document-api-v2-demo", manifest: "template-builder-document-api-v2-demo/package.json", manager: "pnpm", dependencies: { superdoc: requested } },
  {
    directory: "canonical-collaboration-demo/client",
    manifest: "canonical-collaboration-demo/client/package.json",
    manager: "npm",
    dependencies: { superdoc: requested, "@superdoc/react": "latest" },
  },
  {
    directory: "canonical-collaboration-demo/server",
    manifest: "canonical-collaboration-demo/server/package.json",
    manager: "npm",
    dependencies: { "@superdoc/sdk": "latest" },
  },
];

for (const entry of packages) {
  const manifest = JSON.parse(await readFile(entry.manifest, "utf8"));
  for (const [name, version] of Object.entries(entry.dependencies)) manifest.dependencies[name] = version;
  await writeFile(entry.manifest, `${JSON.stringify(manifest, null, manifest.name === "@docrag/web" ? "\t" : 2)}\n`);

  const dependencySpecs = Object.entries(entry.dependencies).map(([name, version]) => `${name}@${version}`);
  const args = entry.manager === "npm"
    ? ["install", ...dependencySpecs, "--save"]
    : ["update", ...dependencySpecs];
  const result = spawnSync(entry.manager, args, { cwd: entry.directory, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);

  // Keep requested tags/ranges in the manifest while lockfiles record exact resolutions.
  const updated = JSON.parse(await readFile(entry.manifest, "utf8"));
  for (const [name, version] of Object.entries(entry.dependencies)) updated.dependencies[name] = version;
  await writeFile(entry.manifest, `${JSON.stringify(updated, null, updated.name === "@docrag/web" ? "\t" : 2)}\n`);
}

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
const resolvedVersions = await Promise.all(coreEntries.map((entry) => resolveInstalledVersion(entry, "superdoc")));

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
console.log(`Updated SuperDoc packages: superdoc ${resolved}, @superdoc/react ${reactVersion}, @superdoc/sdk ${sdkVersion}`);
