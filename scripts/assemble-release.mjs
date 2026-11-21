import { installDemoAnalytics } from './install-demo-analytics.mjs';
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderGallery } from "./render-gallery.mjs";
import { assembleVersionHistory } from "./version-history-release.mjs";
import { collabAssets } from "./verify-collab-assets.mjs";

// Compose gallery-wide forwarding here; version-history assembly stays independent.
export async function assemblePagesWorker({ output, backendUrl }) {
  await assembleVersionHistory({ output, backendUrl });
  const workerPath = path.join(output, '_worker.js');
  const worker = await readFile(workerPath, 'utf8');
  const agentProxy = await readFile(new URL('./demo-agent-proxy.mjs', import.meta.url), 'utf8');
  await writeFile(workerPath, worker.replace('export default createVersionHistoryProxy(', 'const versionHistory = createVersionHistoryProxy(')
    + `\n${agentProxy}\nexport default createDemoAgentProxy(versionHistory);\n`);
  const routesPath = path.join(output, '_routes.json');
  const routes = JSON.parse(await readFile(routesPath, 'utf8'));
  routes.include.push('/agent/api/*', '/agent/projects/*', '/agent/open/*');
  await writeFile(routesPath, JSON.stringify(routes, null, 2) + '\n');
}

async function main() {
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

  await cp(
    path.join(root, "canonical-collaboration-demo", "client", "dist"),
    path.join(output, "collab"),
    { recursive: true },
  );

  await renderGallery({ mode: "production", output: path.join(output, "index.html") });
  await collabAssets(output);
  // Attach gallery API and project forwarding to the static release.
  await assemblePagesWorker({ output, backendUrl: process.env.VERSION_HISTORY_BACKEND_URL });
  console.log(`Assembled ${manifest.length} demos from demos.json`);
  await installDemoAnalytics(output, manifest.map(d => d.liveDemoUri.replace(/^\/+|\/+$/g, '')));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
