import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const componentMode = (name) => {
  const mode = process.env[name] ?? 'on';
  if (mode !== 'on' && mode !== 'off') throw new Error(`${name} must be "on" or "off". Received "${mode}".`);
  return mode;
};

const apiMode = componentMode('COLLABORATION_API');
const clientMode = componentMode('COLLABORATION_CLIENT');
const agentMode = componentMode('COLLABORATION_AGENT');
if (agentMode === 'on' && apiMode === 'off') throw new Error('COLLABORATION_AGENT=on requires COLLABORATION_API=on.');

function run(args, options = {}) {
  const result = spawnSync('npm', args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The server is interpreted at runtime; this validates it. Component modes control
// runtime imports, while client and agent modes also select the browser bundle UI.
run(['run', 'check', '--prefix', 'server']);
if (clientMode === 'on') {
  run(['run', 'build', '--prefix', 'client'], {
    env: { VITE_COLLABORATION_AGENT: agentMode },
  });
}

console.log(`Built collaboration components: server=on, api=${apiMode}, client=${clientMode}, agent=${agentMode}`);
