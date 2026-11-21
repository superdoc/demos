import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { packageDemoBot } from './package-demo-bot.mjs';

test('backend releases are identical and exclude local secrets, runtime data and dependencies', async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'demo-bot-package-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const a = await packageDemoBot(path.join(temporary, 'a'));
  const b = await packageDemoBot(path.join(temporary, 'b'));
  assert.equal(a.revision, b.revision);
  assert.match(a.revision, /^[a-f0-9]{64}$/);
  async function files(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.doesNotMatch(entry.name, /^(?:\.env|\.git$|\.demo-agent$|node_modules$|slack-state\.json$|budget\.json$)/);
      if (entry.isDirectory()) await files(path.join(directory, entry.name));
    }
  }
  await files(a.output);
  const config = JSON.parse(await readFile(path.join(a.output, 'railway.json')));
  assert.equal(config.build.dockerfilePath, 'agent/Dockerfile');
  assert.equal(config.deploy.healthcheckPath, '/health');
  assert.equal(config.deploy.numReplicas, 1);
  const dockerfile = await readFile(path.join(a.output, 'agent/Dockerfile'), 'utf8');
  for (const match of dockerfile.matchAll(/^COPY (.+) (.+)$/gm)) {
    for (const source of match[1].split(' ')) assert.ok(await readFileOrDirectory(path.join(a.output, source)), source);
  }
  await assert.rejects(packageDemoBot(a.output), /empty deployment directory/);
});
async function readFileOrDirectory(name) {
  try { await readFile(name); } catch (error) { if (error.code !== 'EISDIR') throw error; }
  return true;
}
