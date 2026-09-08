import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { renderGallery } from "./render-gallery.mjs";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "dist-gallery");
const manifest = JSON.parse(await readFile(path.join(root, "demos.json"), "utf8"));
const demos = manifest
  .filter((demo) => demo.localSourceDirectory)
  .map((demo) => ({
    source: demo.localSourceDirectory,
    route: demo.liveDemoUri.replace(/^\/+|\/+$/g, ""),
  }));

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
for (const demo of manifest) {
  for (const asset of [demo.screenshot, demo.video].filter(Boolean)) {
    await cp(
      path.join(root, "dist-landing", asset),
      path.join(output, asset),
    );
  }
}

for (const demo of demos) {
  await cp(
    path.join(root, demo.source, "dist"),
    path.join(output, demo.route),
    { recursive: true },
  );
}

await renderGallery({ mode: "local", output: path.join(output, "index.html") });

console.log(`Built local gallery in ${path.relative(root, output)}/`);
