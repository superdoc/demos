import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const [directory, kind, manager] = process.argv.slice(2);
if (!directory || !kind || !manager) {
  console.error("Usage: run-optional-tests.mjs <directory> <unit|browser> <bun|pnpm>");
  process.exit(2);
}

const packageJson = JSON.parse(await readFile(`${directory}/package.json`, "utf8"));
const script = `test:${kind}`;

if (!packageJson.scripts?.[script]) {
  console.log(`⊘ ${packageJson.name}: no ${script} script; skipping`);
  process.exit(0);
}

console.log(`▶ ${packageJson.name}: ${manager} run ${script}`);
const result = spawnSync(manager, ["run", script], {
  cwd: directory,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
