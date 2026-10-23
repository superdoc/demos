import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function stableVersion(version) {
  return typeof version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version);
}

export function compareVersions(a, b) {
  const left = a.split(".").map(BigInt);
  const right = b.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

export function decideRelease({ latest, deployed, installed }) {
  if (!stableVersion(latest)) return { update: false, reason: "npm latest is not a stable version" };
  if (deployed !== null && !stableVersion(deployed)) throw new Error("Invalid deployed version");
  if (installed.some((version) => !stableVersion(version))) throw new Error("Expected exact stable dependency versions");
  if (installed.some((version) => compareVersions(version, latest) > 0)) {
    return { update: false, reason: "Skipping npm rollback: a demo already uses a newer version" };
  }
  if (deployed !== null && compareVersions(latest, deployed) <= 0) {
    return { update: false, reason: "This version has already been deployed" };
  }
  return { update: true, reason: deployed === null ? "No successful automated deployment recorded" : "New stable npm release" };
}

export async function checkRelease({ env = process.env, root = process.cwd(), fetchImpl = fetch } = {}) {
  const simulation = Boolean(env.SIMULATED_LATEST || env.SIMULATED_DEPLOYED || env.SIMULATE_FAILURE === "true");
  // A simulation must never acquire the ability to commit or deploy.
  const dryRun = simulation || env.DRY_RUN !== "false";
  const deployCurrent = env.DEPLOY_CURRENT === "true" && !simulation;
  const state = JSON.parse(await readFile(`${root}/.github/superdoc-release.json`, "utf8"));
  const deployed = env.SIMULATED_DEPLOYED || state.version;
  const manifests = ["rag/apps/web", "superdoc-inline-revisions", "template-builder-document-api-v2-demo", "canonical-collaboration-demo/client"];
  const installed = await Promise.all(manifests.map(async (directory) => {
    const manifest = JSON.parse(await readFile(`${root}/${directory}/package.json`, "utf8"));
    return manifest.dependencies.superdoc;
  }));
  if (deployCurrent) {
    if (installed.some((version) => !stableVersion(version)) || new Set(installed).size !== 1) {
      throw new Error("Source deployment requires matching exact stable SuperDoc versions in every demo");
    }
    if (deployed !== null && !stableVersion(deployed)) throw new Error("Invalid deployed version");
    if (deployed !== null && compareVersions(installed[0], deployed) < 0) {
      throw new Error("Source deployment would roll back the deployed SuperDoc version");
    }
  }
  let latest = deployCurrent ? installed[0] : env.SIMULATED_LATEST;
  if (!latest) {
    const response = await fetchImpl("https://registry.npmjs.org/superdoc/latest", {
      signal: AbortSignal.timeout(30_000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
    latest = (await response.json()).version;
  }
  if (simulation && !stableVersion(latest)) throw new Error("Simulated npm latest must be an exact stable version");
  const decision = deployCurrent
    ? { update: true, reason: "Deploy current source regardless of the previous version marker" }
    : decideRelease({ latest, deployed, installed });
  const result = { ...decision, version: latest, dry_run: dryRun, simulation };
  if (env.GITHUB_OUTPUT) {
    await appendFile(env.GITHUB_OUTPUT, `update=${result.update}\nversion=${stableVersion(latest) ? latest : ""}\ndry_run=${dryRun}\ndeploy_current=${deployCurrent}\n`);
  }
  if (env.GITHUB_STEP_SUMMARY) {
    await appendFile(env.GITHUB_STEP_SUMMARY, `## SuperDoc release check\n\n${result.reason}.\n\n- ${deployCurrent ? "Source SuperDoc version" : "npm latest"}: ${stableVersion(latest) ? latest : "ignored (not stable)"}\n- Last successful automated deployment: ${deployed ?? "none"}\n- Dry run: ${dryRun}\n- Simulation: ${simulation}\n`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await checkRelease(), null, 2));
}
