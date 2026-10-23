import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const stages = { check: "Release detection", update: "Update SuperDoc", deploy: "Deploy Demos V2", record: "Record deployment" };
const label = (value) => String(value).replace(/[<>|*`\r\n]/g, " ").replace(/\s+/g, " ").trim();

export function shouldNotifyTrigger({ env, event = {} }) {
  if (env.GITHUB_EVENT_NAME === "pull_request") {
    return event.action === "closed" && event.pull_request?.merged === true;
  }
  if (env.GITHUB_EVENT_NAME === "schedule") return true;
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    const inputs = event.inputs || {};
    return String(inputs.dry_run) === "false" && !inputs.simulated_latest && !inputs.simulated_deployed && String(inputs.simulate_failure) !== "true";
  }
  return false;
}

export function describeTrigger({ env, event = {} }) {
  const repositoryUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}`;
  const pr = event.pull_request;
  if (["pull_request", "pull_request_target"].includes(env.GITHUB_EVENT_NAME) && pr) {
    const merged = event.action === "closed" && pr.merged === true;
    const kind = merged ? "PR merge" : "PR testing";
    const source = `<${repositoryUrl}/pull/${Number(pr.number)}|PR #${Number(pr.number)}: ${label(pr.title)}>`;
    const branches = `${label(pr.head?.ref || "unknown")} → ${label(pr.base?.ref || "unknown")}`;
    return `${kind} — ${source} (${branches}; ${label(event.action || "unknown action")})`;
  }
  if (env.GITHUB_EVENT_NAME === "schedule") {
    return "Latest stable release check — scheduled poll of npm latest";
  }
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    const simulation = event.inputs?.simulated_latest || event.inputs?.simulated_deployed || String(event.inputs?.simulate_failure) === "true";
    const sourceDeployment = String(event.inputs?.deploy_current) === "true";
    return `${simulation ? "Manual release simulation" : sourceDeployment ? "Production source deployment — manual run" : "Latest stable release check — manual run"} by ${label(env.GITHUB_ACTOR || "unknown")} on ${label(env.GITHUB_REF_NAME || "unknown")}`;
  }
  if (env.GITHUB_EVENT_NAME === "merge_group") {
    return `Merge queue testing — ${label(event.merge_group?.head_ref || env.GITHUB_REF_NAME || "unknown")}`;
  }
  if (env.GITHUB_EVENT_NAME === "push") {
    // A push alone does not establish whether the commit came from a merged PR.
    const commit = event.after || env.GITHUB_SHA;
    const source = /^[a-f0-9]{40,64}$/i.test(commit || "")
      ? ` — <${repositoryUrl}/commit/${commit}|${commit.slice(0, 7)}>` : "";
    return `Branch testing after push or merge — ${label(env.GITHUB_REF_NAME || "unknown")}${source}`;
  }
  return `${label(env.GITHUB_EVENT_NAME || "Unknown trigger")} on ${label(env.GITHUB_REF_NAME || "unknown")}`;
}

export function buildNotification({ needs, demos, version, dryRun, simulatedFailure = false, runUrl, trigger = "Unknown trigger" }) {
  const failed = Object.keys(stages).filter((stage) => needs[stage]?.result === "failure");
  const cancelled = Object.keys(stages).filter((stage) => needs[stage]?.result === "cancelled");
  const deployed = needs.deploy?.result === "success";
  if (!failed.length && !cancelled.length && !deployed) return null;
  const status = failed.length ? "FAILURE" : cancelled.length ? "CANCELLED" : "SUCCESS";
  const icon = failed.length ? "❌" : cancelled.length ? "⚠️" : "✅";
  const mode = dryRun ? "DRY RUN" : "PRODUCTION";
  const lines = [`${icon} *[${mode}] SuperDoc demos — ${status}*`, `Trigger: ${trigger}`, `SuperDoc: ${label(version || "unknown (release detection did not complete)")}`];
  if (simulatedFailure) lines.push("Intentional simulated release failure to test notifications.");
  if (dryRun) lines.push("Validation only. No production deployment was performed.");
  if (failed.length) lines.push(`Failed stage(s): ${failed.map((stage) => stages[stage]).join(", ")}`);
  if (cancelled.length) lines.push(`Cancelled stage(s): ${cancelled.map((stage) => stages[stage]).join(", ")}`);
  if (deployed && !dryRun && failed.includes("record")) lines.push("Deployment succeeded, but recording the deployed version failed; the next poll may retry.");
  const demoHeading = deployed
    ? dryRun ? "Demos validated (links open the current production demos):" : "Demos updated:"
    : "Demos targeted (deployment not confirmed; links open current production):";
  lines.push("", demoHeading);
  if (!Array.isArray(demos) || !demos.length) throw new Error("demos.json must contain at least one demo");
  for (const demo of demos) {
    if (!demo.title || !demo.liveDemoUri?.startsWith("/") || demo.liveDemoUri.startsWith("//")) {
      throw new Error("Each demo needs a title and root-relative liveDemoUri");
    }
    const url = new URL(demo.liveDemoUri, "https://demos.superdoc.dev");
    if (url.origin !== "https://demos.superdoc.dev" || /[<>|\r\n]/.test(url.href)) throw new Error("Invalid demo URL");
    lines.push(`• <${url.href}|${label(demo.title)}>`);
  }
  lines.push("", `<${runUrl}|View workflow logs>`);
  return { text: lines.join("\n") };
}

export async function sendNotification({ webhookUrl, message, fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (!webhookUrl) throw new Error("GOOGLE_CHAT_WEBHOOK_URL is not configured");
  let url;
  try { url = new URL(webhookUrl); } catch { throw new Error("Invalid Google Chat webhook URL"); }
  if (url.origin !== "https://chat.googleapis.com" || !/^\/v1\/spaces\/[^/]+\/messages$/.test(url.pathname) || !url.searchParams.has("key") || !url.searchParams.has("token")) {
    throw new Error("Invalid Google Chat webhook URL");
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      });
    } catch {
      // Fetch errors and response bodies can contain the secret webhook URL.
      throw new Error("Google Chat notification failed due to a network error");
    }
    if (response.ok) return;
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw new Error(`Google Chat notification failed (HTTP ${response.status})`);
  }
}

export async function notifyRelease({ env = process.env, root = process.cwd(), fetchImpl = fetch } = {}) {
  const event = env.GITHUB_EVENT_PATH ? JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8")) : {};
  if (!shouldNotifyTrigger({ env, event })) {
    console.log("Notifications are limited to PR merges and stable releases.");
    return;
  }
  const needs = JSON.parse(env.RELEASE_RESULTS);
  // Fall back to trigger inputs if release detection failed before producing outputs.
  const dryRun = env.RELEASE_DRY_RUN === "true" || env.TRIGGER_DRY_RUN === "true";
  const demos = JSON.parse(await readFile(`${root}/demos.json`, "utf8"));
  const runUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`;
  const trigger = describeTrigger({ env, event });
  const message = buildNotification({ needs, demos, version: env.SUPERDOC_VERSION, dryRun, simulatedFailure: env.SIMULATE_FAILURE === "true", runUrl, trigger });
  if (!message) {
    console.log("No release attempted; no Google Chat notification needed.");
    return;
  }
  await sendNotification({ webhookUrl: env.GOOGLE_CHAT_WEBHOOK_URL, message, fetchImpl });
  console.log("Google Chat notification delivered.");
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `## Google Chat notification delivered\n\n${message.text}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await notifyRelease();
}
