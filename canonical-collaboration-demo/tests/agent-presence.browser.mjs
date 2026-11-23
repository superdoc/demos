import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { api, clientUrl, startAgentDemo, until } from './agent-browser-demo.mjs';

export default async function ({ browser, artifacts }) {
  const errors = [];
  let release;
  let generation = 0;
  const promptRequests = [];
  const demo = await startAgentDemo(artifacts, async (request, response) => {
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
        promptRequests.push(input.messages);
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const room = `presence-${Date.now()}`;
    const pages = [await context.newPage(), await context.newPage()];
    for (const page of pages) {
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${clientUrl}/?room=${room}`);
      await page.locator('.editor-shell[aria-busy="false"]').waitFor();
      if (page === pages[0]) {
        await page.getByText('1 user connected', { exact: true }).waitFor();
        await page.getByText('1 agent connected', { exact: true }).waitFor();
      }
    }
    const names = [];
    for (const page of pages) {
      const message = page.locator('.chat-history .message.assistant').first();
      await message.waitFor();
      const name = await message.locator('.message-role').textContent();
      assert.ok(name && name !== 'Agentic Collaborator');
      assert.ok((await message.innerText()).includes(`Hi, I’m ${name}, your agentic collaborator.`));
      names.push(name);
    }
    assert.notEqual(names[0], names[1]);
    const agent = (page, name) => page.locator('[data-v2-remote-caret]').filter({
      has: page.locator('[data-v2-remote-label]').and(page.getByText(name, { exact: true })),
    });
    for (const page of pages) {
      const users = page.getByText('2 users connected', { exact: true });
      const agents = page.getByText('2 agents connected', { exact: true });
      await users.waitFor();
      await agents.waitFor();
      const userBox = await users.boundingBox();
      const agentBox = await agents.boundingBox();
      assert.equal(agentBox.x, userBox.x);
      assert.ok(agentBox.y >= userBox.y + userBox.height, 'The agent count is below the user count.');
      assert.equal(await agents.locator('.presence-dot').evaluate((dot) => getComputedStyle(dot).backgroundColor), 'rgb(139, 92, 246)');
    }

    const positions = [];
    const sessionHeaders = [];
    const jobIds = [];
    for (const mode of ['direct', 'suggestion']) {
      const prefix = `Agent begins here ${mode === 'direct' ? 1 : 2}`;
      const author = mode === 'direct' ? 0 : 1;
      const page = pages[author];
      const name = names[author];
      await page.getByRole('combobox', { name: 'Agent edit mode' }).selectOption(mode);
      await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill(`Append a paragraph in ${mode} mode.`);
      const jobResponse = page.waitForResponse((response) => response.url().endsWith(`/api/rooms/${room}/jobs`) && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      const response = await jobResponse;
      const job = await response.json();
      const { authorization } = await response.request().allHeaders();
      const headers = { authorization };
      sessionHeaders.push(headers);
      jobIds.push(job.id);
      await page.mouse.move(5, 5);
      const stop = page.getByRole('button', { name: 'Stop', exact: true });
      await stop.waitFor();
      assert.equal(await stop.evaluate((button) => getComputedStyle(button).backgroundColor), 'rgb(229, 231, 235)');
      const before = [];
      for (const [index, peer] of pages.entries()) {
        await agent(peer, name).waitFor();
        await until(() => peer.locator('.editor-content').innerText(), (text) => text.includes(prefix), 'partial text');
        const previous = positions.find((position) => position.peer === index && position.name === name)?.after;
        before.push(await until(() => agent(peer, name).evaluate((caret) => ({ left: caret.style.left, top: caret.style.top })),
          (position) => !previous || JSON.stringify(position) !== JSON.stringify(previous), 'cursor at new paragraph'));
        assert.equal(await agent(peer, name).evaluate((caret) => caret.style.backgroundColor), 'rgb(139, 92, 246)');
      }
      await pages[0].screenshot({ path: path.join(artifacts, `${mode}-partial.png`) });
      assert.equal((await (await fetch(`${api}/api/rooms/${room}/jobs/${job.id}`, { headers })).json()).status, 'running');
      release();
      for (const [index, peer] of pages.entries()) {
        await until(() => peer.locator('.editor-content').innerText(), (text) => text.includes(`${prefix} and keeps typing.`), 'complete text');
        const after = await until(() => agent(peer, name).evaluate((caret) => ({ left: caret.style.left, top: caret.style.top })),
          (position) => JSON.stringify(position) !== JSON.stringify(before[index]), 'cursor movement');
        assert.equal(await agent(peer, name).count(), 1);
        positions.push({ mode, name, peer: index, before: before[index], after });
      }
      await until(() => fetch(`${api}/api/rooms/${room}/jobs/${job.id}`, { headers }).then((response) => response.json()),
        (value) => value.status === 'completed', 'completed job');
      await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
      await page.getByText('The streamed paragraph is complete.', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(artifacts, `${mode}-complete.png`) });
    }
    assert.notEqual(sessionHeaders[0].authorization, sessionHeaders[1].authorization);
    assert.ok(!promptRequests[1].some((message) => message.content === 'Append a paragraph in direct mode.'),
      'The second agent must not receive the first agent’s prompt.');
    for (const [index, headers] of sessionHeaders.entries()) {
      const ownMode = index === 0 ? 'direct' : 'suggestion';
      const otherMode = index === 0 ? 'suggestion' : 'direct';
      const chat = await fetch(`${api}/api/rooms/${room}/chat`, { headers }).then((response) => response.json());
      assert.deepEqual(chat.messages.filter(({ role }) => role === 'user').map(({ content }) => content),
        [`Append a paragraph in ${ownMode} mode.`]);
      await pages[index].getByText(`Append a paragraph in ${ownMode} mode.`, { exact: true }).waitFor();
      assert.equal(await pages[index].getByText(`Append a paragraph in ${otherMode} mode.`, { exact: true }).count(), 0);
    }
    const otherJob = `${api}/api/rooms/${room}/jobs/${jobIds[1]}`;
    for (const [url, method] of [[otherJob, 'GET'], [otherJob, 'DELETE'], [`${otherJob}/events`, 'GET']]) {
      assert.equal((await fetch(url, { headers: sessionHeaders[0], method })).status, 404);
    }
    assert.equal((await fetch(`${api}/api/rooms/${room}/chat`)).status, 401);
    for (const page of pages) {
      for (const name of names) await agent(page, name).waitFor();
    }
    await pages[1].getByRole('button', { name: 'Agent', exact: true }).click();
    await pages[0].getByText('1 agent connected', { exact: true }).waitFor();
    await pages[0].getByText('2 users connected', { exact: true }).waitFor();
    await agent(pages[0], names[1]).waitFor({ state: 'hidden' });
    await pages[1].getByRole('button', { name: 'Agent', exact: true }).click();
    await pages[0].getByText('2 agents connected', { exact: true }).waitFor();
    await pages[1].close();
    await pages[0].getByText('1 agent connected', { exact: true }).waitFor();
    await agent(pages[0], names[1]).waitFor({ state: 'hidden' });
    await pages[0].getByText('1 user connected', { exact: true }).waitFor();
    await pages[0].reload();
    await pages[0].getByText(`Hi, I’m ${names[0]}, your agentic collaborator.`, { exact: false }).waitFor();
    await pages[0].getByText('Append a paragraph in direct mode.', { exact: true }).waitFor();
    const deletion = await fetch(`${api}/api/rooms/${room}/document`, { method: 'DELETE' });
    assert.equal(deletion.ok, true);
    for (const page of context.pages()) {
      await until(() => agent(page, names[0]).count(), (count) => count === 0, 'agent leaving deleted room');
      await page.getByText('1 agent connected', { exact: true }).waitFor({ state: 'hidden' });
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(artifacts, 'positions.json'), JSON.stringify(positions, null, 2));
    console.log('Verified private chats and agent counts for two collaborators, shared direct and tracked edits, and presence cleanup.');
  } catch (error) {
    for (const [index, page] of context.pages().entries()) {
      await page.screenshot({ path: path.join(artifacts, `failure-${index}.png`) }).catch(() => {});
      await fs.writeFile(path.join(artifacts, `failure-${index}.html`), await page.content().catch(() => ''));
    }
    throw error;
  } finally {
    release?.();
    await context.close();
    await demo.stop();
  }
}
