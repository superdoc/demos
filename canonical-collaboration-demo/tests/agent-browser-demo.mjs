import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const api = 'http://localhost:18000';
export const clientUrl = 'http://localhost:18173';

export async function until(read, accepts, description) {
  const deadline = Date.now() + 15_000;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (accepts(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(value)}`);
}

export async function startAgentDemo(artifacts, handleModelRequest, handleVoiceConnection) {
  await fs.mkdir(artifacts, { recursive: true });
  const children = [];
  const logs = [];
  const model = createServer(async (request, response) => {
    try {
      await handleModelRequest(request, response);
    } catch (error) {
      logs.push(`[model] ${error.stack ?? error}\n`);
      if (response.headersSent) return response.destroy();
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  const voice = handleVoiceConnection && new (createRequire(new URL('../server/package.json', import.meta.url))('ws').WebSocketServer)({ server: model });
  voice?.on('connection', (socket, request) => handleVoiceConnection(socket, request, logs));
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');

  function start(name, args, cwd, extraEnv) {
    const env = { ...process.env, ...extraEnv };
    delete env.ORBIT_ROOT;
    delete env.SUPERDOC_CLI_BIN;
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const output of [child.stdout, child.stderr]) output.on('data', (data) => logs.push(`[${name}] ${data}`));
    children.push(child);
    return child;
  }

  async function stop() {
    for (const socket of voice?.clients ?? []) socket.terminate();
    voice?.close();
    model.closeAllConnections();
    await new Promise((resolve) => model.close(resolve));
    await Promise.all(children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const stopped = once(child, 'exit');
      child.kill('SIGTERM');
      const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
      await stopped;
      clearTimeout(kill);
    }));
    await fs.writeFile(path.join(artifacts, 'server.log'), logs.join(''));
  }

  try {
    const clientOutput = path.join(artifacts, 'client');
    const clientRoot = path.join(root, 'client');
    const vite = 'node_modules/vite/bin/vite.js';
    const clientEnv = { VITE_API_URL: api, VITE_COLLABORATION_AGENT: 'on', VITE_COLLABORATION_AGENT_AVAILABLE: 'on' };
    const build = start('build', [vite, 'build', '--outDir', clientOutput], clientRoot, clientEnv);
    const [buildCode] = await once(build, 'exit');
    assert.equal(buildCode, 0, 'The browser fixture must build successfully.');
    const server = start('server', ['src/server.js'], path.join(root, 'server'), {
      PORT: new URL(api).port, PUBLIC_ORIGIN: api, DOCUMENT_ROOT: path.join(artifacts, 'documents'),
      CLIENT_ORIGINS: clientUrl, DEFAULT_DOCUMENT_PATH: path.join(root, 'server/assets/blank.docx'),
      OPENAI_API_KEY: 'local-test-only', OPENAI_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`,
      COLLABORATION_API: 'on', COLLABORATION_CLIENT: 'on', COLLABORATION_AGENT: 'on',
      COLLABORATION_AGENT_PRESENCE: 'on', COLLABORATION_AUTH: 'none', COLLABORATION_STORAGE: 'memory', COLLABORATION_DOCX: 'off',
    });
    const client = start('client', [vite, 'preview', '--outDir', clientOutput, '--port', new URL(clientUrl).port, '--strictPort'], clientRoot, {});
    for (const [child, url] of [[server, `${api}/api/health`], [client, clientUrl]]) {
      await until(() => {
        assert.equal(child.exitCode, null, `${url} exited before readiness.`);
        return fetch(url).then((response) => response.ok, () => false);
      }, Boolean, url);
    }
    return { stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
