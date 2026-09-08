import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(import.meta.dirname, "..");

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const replaceSection = (html, name, content) => html.replace(
  new RegExp(`(<!-- ${name}:START -->)[\\s\\S]*?(<!-- ${name}:END -->)`),
  `$1\n${content}\n      $2`,
);

export async function renderGallery({ mode, output }) {
  const manifest = JSON.parse(await readFile(path.join(root, "demos.json"), "utf8"));
  if (!Array.isArray(manifest) || manifest.length === 0) {
    throw new Error("demos.json must contain a non-empty array");
  }
  const requiredFields = [
    "id",
    "screenshot",
    "title",
    "description",
    "liveDemoUri",
    "sourceUri",
    "packageDirectory",
  ];
  for (const [index, demo] of manifest.entries()) {
    for (const field of requiredFields) {
      if (!demo[field]) throw new Error(`demos.json[${index}].${field} is required`);
    }
  }

  const ids = manifest.map((demo) => demo.id);
  if (new Set(ids).size !== ids.length) throw new Error("Demo ids must be unique");

  const versionEntries = mode === "local"
    ? manifest.filter((demo) => demo.localSourceDirectory)
    : manifest;
  const versions = await Promise.all(versionEntries.map(async (demo) => {
    const packageJson = await readFile(
      path.join(root, demo.packageDirectory, "node_modules", "superdoc", "package.json"),
      "utf8",
    );
    return JSON.parse(packageJson).version;
  }));
  if (new Set(versions).size !== 1) {
    throw new Error(`Demos resolved different SuperDoc versions: ${versions.join(", ")}`);
  }

  const backgrounds = manifest.map((_, index) =>
    `    <div class="background placeholder${index === 0 ? " active" : ""}"></div>`,
  ).join("\n");
  const selectors = manifest.map((demo, index) =>
    `        <button class="demo-selector${index === 0 ? " active" : ""}" type="button" aria-label="Show ${escapeHtml(demo.title)}" aria-pressed="${index === 0}"></button>`,
  ).join("\n");
  const cards = manifest.map((demo, index) => {
    const liveUri = mode === "local" && demo.localLiveDemoUri
      ? demo.localLiveDemoUri
      : demo.liveDemoUri;
    return `      <article class="demo-slide${index === 0 ? " active" : ""}">
        <div class="demo-card">
          <a class="card-main-link" href="${escapeHtml(liveUri)}" aria-label="Open ${escapeHtml(demo.title)} demo"></a>
          <img class="card-poster" src="/${escapeHtml(demo.screenshot)}" alt="${escapeHtml(demo.title)} demo preview">
          <div class="card-body"><h2>${escapeHtml(demo.title)}</h2><p>${escapeHtml(demo.description)}</p><div class="card-actions"><a href="${escapeHtml(liveUri)}">Live demo</a><button class="copy-link" type="button">Copy</button><span>|</span><a href="${escapeHtml(demo.sourceUri)}" target="_blank" rel="noopener noreferrer">Source</a><button class="copy-link" type="button">Copy</button></div></div>
        </div>
      </article>`;
  }).join("\n");

  let html = await readFile(path.join(root, "dist-landing", "index.html"), "utf8");
  html = replaceSection(html, "DEMO_BACKGROUNDS", backgrounds);
  html = replaceSection(html, "DEMO_SELECTORS", selectors);
  html = replaceSection(html, "DEMO_CARDS", cards);
  html = html.replace(
    /SuperDoc v\d+\.\d+\.\d+(?:[-+][\w.-]+)?/,
    `SuperDoc v${versions[0]}`,
  );
  await writeFile(path.resolve(root, output), html);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const modeIndex = process.argv.indexOf("--mode");
  const outputIndex = process.argv.indexOf("--output");
  const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : "production";
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : "dist/index.html";
  if (!["local", "production"].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  await renderGallery({ mode, output });
}
