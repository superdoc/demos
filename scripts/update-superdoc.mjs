import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const requested = process.argv[2] || "latest";
const packages = [
  { directory: "rag/apps/web", manifest: "rag/apps/web/package.json", manager: "bun" },
  { directory: "superdoc-inline-revisions", manifest: "superdoc-inline-revisions/package.json", manager: "pnpm" },
  { directory: "template-builder-document-api-v2-demo", manifest: "template-builder-document-api-v2-demo/package.json", manager: "pnpm" },
];

for (const entry of packages) {
  const manifest = JSON.parse(await readFile(entry.manifest, "utf8"));
  manifest.dependencies.superdoc = requested;
  await writeFile(entry.manifest, `${JSON.stringify(manifest, null, manifest.name === "@docrag/web" ? "\t" : 2)}\n`);

  const args = entry.manager === "bun"
    ? ["update", `superdoc@${requested}`]
    : ["update", `superdoc@${requested}`];
  const result = spawnSync(entry.manager, args, { cwd: entry.directory, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);

  // Keep the requested tag/range in the manifest while the lockfile records the resolution.
  const updated = JSON.parse(await readFile(entry.manifest, "utf8"));
  updated.dependencies.superdoc = requested;
  await writeFile(entry.manifest, `${JSON.stringify(updated, null, updated.name === "@docrag/web" ? "\t" : 2)}\n`);
}

const resolvedVersions = await Promise.all(packages.map(async (entry) => {
  const candidates = [
    `${entry.directory}/node_modules/superdoc/package.json`,
    `rag/node_modules/superdoc/package.json`,
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(candidate, "utf8")).version;
    } catch {}
  }
  throw new Error(`Could not find installed SuperDoc for ${entry.manifest}`);
}));

if (new Set(resolvedVersions).size !== 1) {
  throw new Error(`Demos resolved different SuperDoc versions: ${resolvedVersions.join(", ")}`);
}

const resolved = resolvedVersions[0];
const landingPath = "dist-landing/index.html";
const landing = await readFile(landingPath, "utf8");
await writeFile(landingPath, landing.replace(/SuperDoc v\d+\.\d+\.\d+(?:[-+][\w.-]+)?/g, `SuperDoc v${resolved}`));
console.log(`All demos now resolve SuperDoc v${resolved}`);
