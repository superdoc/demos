import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = 'http://localhost:18000';
const clientUrl = 'http://localhost:18173';

async function until(read, accepts, description) {
  const deadline = Date.now() + 15_000;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (accepts(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(value)}`);
}

export default async function ({ browser, artifacts }) {
  const children = [];
  const logs = [];
  const errors = [];
  let release;
  let generation = 0;
  const model = createServer(async (request, response) => {
    try {
      let body = '';
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({
        id: 'presence-test', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`);
      if (input.messages.at(-1).role === 'tool') {
        send({ content: 'The streamed paragraph is complete.' });
        send({}, 'stop');
      } else {
        generation++;
        const gate = new Promise((resolve) => { release = resolve; });
        send({ tool_calls: [{ index: 0, id: `call_${generation}`, type: 'function', function: {
          name: 'superdoc_stream_text', arguments: `{"mode":"append","anchor":null,"text":"Agent begins here ${generation}`,
        } }] });
        await gate;
        send({ tool_calls: [{ index: 0, function: { arguments: ' and keeps typing."}' } }] });
        send({}, 'tool_calls');
      }
      response.end('data: [DONE]\n\n');
    } catch (error) {
      errors.push(error.message);
      response.destroy();
    }
  });
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');

  function start(name, args, cwd, extraEnv = {}) {
    const env = { ...process.env, ...extraEnv };
    delete env.ORBIT_ROOT;
    delete env.SUPERDOC_CLI_BIN;
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const output of [child.stdout, child.stderr]) output.on('data', (data) => logs.push(`[${name}] ${data}`));
    children.push(child);
    return child;
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const clientOutput = path.join(artifacts, 'client');
    const build = start('build', ['node_modules/vite/bin/vite.js', 'build', '--outDir', clientOutput], path.join(root, 'client'), {
      VITE_API_URL: api, VITE_COLLABORATION_AGENT: 'on', VITE_COLLABORATION_AGENT_AVAILABLE: 'on',
    });
    const [buildCode] = await once(build, 'exit');
    assert.equal(buildCode, 0, 'The browser fixture must build successfully.');
    const server = start('server', ['src/server.js'], path.join(root, 'server'), {
      PORT: '18000', PUBLIC_ORIGIN: api, DOCUMENT_ROOT: path.join(artifacts, 'documents'),
      CLIENT_ORIGINS: clientUrl,
      DEFAULT_DOCUMENT_PATH: path.join(root, 'server/assets/blank.docx'),
      OPENAI_API_KEY: 'local-test-only', OPENAI_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`,
      COLLABORATION_API: 'on', COLLABORATION_CLIENT: 'on', COLLABORATION_AGENT: 'on',
      COLLABORATION_AGENT_PRESENCE: 'on',
      COLLABORATION_AUTH: 'none', COLLABORATION_STORAGE: 'memory', COLLABORATION_DOCX: 'off',
    });
    const client = start('client', ['node_modules/vite/bin/vite.js', 'preview', '--outDir', clientOutput, '--port', '18173', '--strictPort'], path.join(root, 'client'));
    for (const [child, url] of [[server, `${api}/api/health`], [client, clientUrl]]) {
      await until(() => {
        assert.equal(child.exitCode, null, `${url} exited before readiness.`);
        return fetch(url).then((response) => response.ok, () => false);
      }, Boolean, url);
    }
    const room = `presence-${Date.now()}`;
    const pages = [await context.newPage(), await context.newPage()];
    for (const page of pages) {
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${clientUrl}/?room=${room}`);
      await page.locator('.editor-shell[aria-busy="false"]').waitFor();
    }
    const agent = (page) => page.locator('[data-v2-remote-caret]').filter({ has: page.locator('[data-v2-remote-label]', { hasText: /^Agent$/ }) });
    for (const page of pages) await page.getByText('2 users connected', { exact: true }).waitFor();

    const positions = [];
    for (const mode of ['direct', 'suggestion']) {
      const prefix = `Agent begins here ${mode === 'direct' ? 1 : 2}`;
      const page = pages[0];
      await page.getByRole('combobox', { name: 'Agent edit mode' }).selectOption(mode);
      await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill(`Append a paragraph in ${mode} mode.`);
      const jobResponse = page.waitForResponse((response) => response.url().endsWith(`/api/rooms/${room}/jobs`) && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Run agent', exact: true }).click();
      const job = await (await jobResponse).json();
      const before = [];
      for (const [index, peer] of pages.entries()) {
        await agent(peer).waitFor();
        await until(() => peer.locator('.editor-content').innerText(), (text) => text.includes(prefix), 'partial text');
        const previous = positions.find((position) => position.peer === index)?.after;
        before.push(await until(() => agent(peer).evaluate((caret) => ({ left: caret.style.left, top: caret.style.top })),
          (position) => !previous || JSON.stringify(position) !== JSON.stringify(previous), 'cursor at new paragraph'));
        assert.equal(await agent(peer).evaluate((caret) => caret.style.backgroundColor), 'rgb(139, 92, 246)');
      }
      await pages[0].screenshot({ path: path.join(artifacts, `${mode}-partial.png`) });
      assert.equal((await (await fetch(`${api}/api/rooms/${room}/jobs/${job.id}`)).json()).status, 'running');
      release();
      for (const [index, peer] of pages.entries()) {
        await until(() => peer.locator('.editor-content').innerText(), (text) => text.includes(`${prefix} and keeps typing.`), 'complete text');
        const after = await until(() => agent(peer).evaluate((caret) => ({ left: caret.style.left, top: caret.style.top })),
          (position) => JSON.stringify(position) !== JSON.stringify(before[index]), 'cursor movement');
        assert.equal(await agent(peer).count(), 1);
        positions.push({ mode, peer: index, before: before[index], after });
      }
      await until(() => fetch(`${api}/api/rooms/${room}/jobs/${job.id}`).then((response) => response.json()),
        (value) => value.status === 'completed', 'completed job');
      await pages[0].getByRole('button', { name: 'Run agent', exact: true }).waitFor();
      await pages[0].screenshot({ path: path.join(artifacts, `${mode}-complete.png`) });
    }
    const deletion = await fetch(`${api}/api/rooms/${room}/document`, { method: 'DELETE' });
    assert.equal(deletion.ok, true);
    for (const page of pages) await until(() => agent(page).count(), (count) => count === 0, 'agent leaving deleted room');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(artifacts, 'positions.json'), JSON.stringify(positions, null, 2));
    console.log('Verified purple Agent cursor moves during direct and tracked streaming in two browsers; user counts exclude the backend; deletion removes presence.');
  } catch (error) {
    for (const [index, page] of context.pages().entries()) {
      await page.screenshot({ path: path.join(artifacts, `failure-${index}.png`) }).catch(() => {});
      await fs.writeFile(path.join(artifacts, `failure-${index}.html`), await page.content().catch(() => ''));
    }
    throw error;
  } finally {
    release?.();
    await context.close();
    for (const child of children) {
      if (child.exitCode !== null) continue;
      const stopped = once(child, 'exit');
      child.kill('SIGTERM');
      const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
      await stopped;
      clearTimeout(kill);
    }
    model.closeAllConnections();
    await new Promise((resolve) => model.close(resolve));
    await fs.writeFile(path.join(artifacts, 'server.log'), logs.join(''));
  }
}
