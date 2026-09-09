import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { renderGallery } from "./render-gallery.mjs";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "dist");
const manifest = JSON.parse(await readFile(path.join(root, "demos.json"), "utf8"));

await rm(output, { recursive: true, force: true });
await cp(path.join(root, "dist-landing"), output, { recursive: true });

for (const demo of manifest) {
  if (!demo.liveDemoUri?.startsWith("/")) {
    throw new Error(`${demo.id}.liveDemoUri must be a root-relative path`);
  }
  const route = demo.liveDemoUri.replace(/^\/+|\/+$/g, "");
  if (!route || route.split("/").includes("..")) {
    throw new Error(`${demo.id}.liveDemoUri is not a safe deployment path`);
  }
  const buildOutput = path.join(root, demo.packageDirectory, "dist");
  const destination = path.join(output, route);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(buildOutput, destination, { recursive: true });
}

await renderGallery({ mode: "production", output: path.join(output, "index.html") });
console.log(`Assembled ${manifest.length} demos from demos.json`);
