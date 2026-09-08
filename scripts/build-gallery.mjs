import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "dist-gallery");
const demos = [
  {
    source: "superdoc-inline-revisions",
    route: "superdoc-inline-revisions",
  },
  {
    source: "template-builder-document-api-v2-demo",
    route: "template-builder-document-api-v2-demo",
  },
];

for (const demo of demos) {
  const result = spawnSync("pnpm", ["--dir", demo.source, "build"], {
    cwd: root,
    stdio: "inherit",
  });

  if (result.status !== 0) process.exit(result.status ?? 1);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(
  path.join(root, "dist-landing", "superdoc-logo.png"),
  path.join(output, "superdoc-logo.png"),
);
await cp(
  path.join(root, "dist-landing", "template-builder-preview.mp4"),
  path.join(output, "template-builder-preview.mp4"),
);
await cp(
  path.join(root, "dist-landing", "inline-revisions-preview.mp4"),
  path.join(output, "inline-revisions-preview.mp4"),
);
await cp(
  path.join(root, "dist-landing", "inline-revisions-poster.jpg"),
  path.join(output, "inline-revisions-poster.jpg"),
);
await cp(
  path.join(root, "dist-landing", "template-builder-poster.jpg"),
  path.join(output, "template-builder-poster.jpg"),
);

for (const demo of demos) {
  await cp(
    path.join(root, demo.source, "dist"),
    path.join(output, demo.route),
    { recursive: true },
  );
}

const landingSource = await readFile(
  path.join(root, "dist-landing", "index.html"),
  "utf8",
);
const localLanding = landingSource
  .replace(/\s*<article class="demo-slide" data-local-exclude>.*?<\/article>/s, "")
  .replace(/\s*<button class="demo-selector"[^>]*data-local-exclude><\/button>/s, "")
  .replace(/\s*<div class="background placeholder" data-local-exclude><\/div>/s, "");
await writeFile(path.join(output, "index.html"), localLanding);

console.log(`Built local gallery in ${path.relative(root, output)}/`);
