import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const collaborationRoot = path.join(root, "canonical-collaboration-demo");

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function loadCollaborationEnvironment() {
  const environment = { ...process.env };
  const envPath = path.join(collaborationRoot, ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error("Missing canonical-collaboration-demo/.env. Copy .env.example and add OPENAI_API_KEY.");
  }
  for (const sourceLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    environment[key] ??= value;
  }
  if (!environment.OPENAI_API_KEY) throw new Error("Add OPENAI_API_KEY to canonical-collaboration-demo/.env.");
  return {
    ...environment,
    PORT: "8000",
    PUBLIC_ORIGIN: "http://localhost:8000",
    DOCUMENT_ROOT: path.join(collaborationRoot, "data"),
    CLIENT_ORIGINS: "http://localhost:4173,http://127.0.0.1:4173",
  };
}

run("pnpm", ["--dir", "superdoc-inline-revisions", "install", "--frozen-lockfile"]);
run("pnpm", ["--dir", "template-builder-document-api-v2-demo", "install", "--frozen-lockfile"]);
run("make", ["install"], collaborationRoot);
run(process.execPath, ["scripts/build-gallery.mjs"]);

const collaborationEnvironment = loadCollaborationEnvironment();
const services = [
  spawn(process.execPath, ["scripts/serve-gallery.mjs"], { cwd: root, stdio: "inherit" }),
  spawn(process.execPath, ["src/server.js"], {
    cwd: path.join(collaborationRoot, "server"),
    env: collaborationEnvironment,
    stdio: "inherit",
  }),
];

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const service of services) service.kill("SIGTERM");
  setTimeout(() => {
    for (const service of services) if (service.exitCode === null) service.kill("SIGKILL");
  }, 5_000).unref();
  if (exitCode) process.exitCode = exitCode;
}

for (const service of services) {
  service.once("exit", (code) => {
    if (!stopping) stop(code || 1);
  });
}

console.log("Canonical collaboration demo: http://localhost:4173/collab/");
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
