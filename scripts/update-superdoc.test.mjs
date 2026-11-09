import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Run the real updater in an isolated repository. Fake package managers report
// installed versions and record lockfile writes without querying npm or
// installing dependencies on the developer's machine.
const manager = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'view') {
  const version = args[1].startsWith('superdoc@') ? '2.31.0' : '3.0.0';
  console.log(JSON.stringify(version));
  process.exit(0);
}
if (!['install', 'update', 'ci'].includes(args[0])) throw new Error('Unexpected package-manager command');
fs.appendFileSync(process.env.MANAGER_LOG, JSON.stringify({ directory: path.relative(fs.realpathSync(process.env.TEST_ROOT), process.cwd()), args }) + '\\n');
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const [name, version] of Object.entries(manifest.dependencies)) {
  const directory = path.join('node_modules', name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version }));
}
if (!args.includes('--frozen-lockfile') && args[0] !== 'ci') fs.writeFileSync('pnpm-lock.yaml', 'updated lockfile');
`;

test('the stable updater preserves an exception pin/lockfile and resumes updating after its removal', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'superdoc-update-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directories = [
    'document-outline',
    'rag/apps/web', 'superdoc-inline-revisions', 'template-builder-document-api-v2-demo',
    'version-history', 'canonical-collaboration-demo/client',
  ];
  const demos = directories.map((directory) => ({ id: directory, packageDirectory: directory }));
  demos.find((demo) => demo.id === 'version-history').superdocVersionException = {
    version: '2.30.0-next.4', reason: 'Waiting for stable Changes API',
  };
  await writeFile(path.join(root, 'demos.json'), JSON.stringify(demos));
  for (const directory of [...directories, 'canonical-collaboration-demo/server']) {
    await mkdir(path.join(root, directory), { recursive: true });
    const dependencies = directory.endsWith('/server') ? { '@superdoc/sdk': '2.29.0' }
      : { superdoc: directory === 'version-history' ? '2.30.0-next.4' : '2.29.0' };
    if (directory.endsWith('/client')) dependencies['@superdoc/react'] = '2.29.0';
    await writeFile(path.join(root, directory, 'package.json'), JSON.stringify({ name: directory, dependencies }));
  }
  const historyLock = path.join(root, 'version-history/pnpm-lock.yaml');
  await writeFile(historyLock, 'original prerelease lockfile');
  await mkdir(path.join(root, 'dist-landing'));
  await writeFile(path.join(root, 'dist-landing/index.html'), 'SuperDoc v2.29.0');
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  for (const name of ['npm', 'pnpm', 'bun']) await writeFile(path.join(bin, name), manager, { mode: 0o755 });
  const log = path.join(root, 'manager.log');
  const script = path.resolve(import.meta.dirname, 'update-superdoc.mjs');
  const update = () => {
    const result = spawnSync(process.execPath, [script, '2.31.0'], {
      cwd: root, encoding: 'utf8', env: {
        ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TEST_ROOT: root, MANAGER_LOG: log,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  const dependency = async (directory) => JSON.parse(await readFile(path.join(root, directory, 'package.json'), 'utf8')).dependencies.superdoc;

  update();
  assert.equal(await dependency('version-history'), '2.30.0-next.4');
  assert.equal(await readFile(historyLock, 'utf8'), 'original prerelease lockfile');
  assert.equal(await dependency('superdoc-inline-revisions'), '2.31.0');
  assert.equal(await readFile(path.join(root, 'dist-landing/index.html'), 'utf8'), 'SuperDoc v2.31.0');
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.find((call) => call.directory === 'version-history').args, ['install', '--frozen-lockfile']);

  delete demos.find((demo) => demo.id === 'version-history').superdocVersionException;
  await writeFile(path.join(root, 'demos.json'), JSON.stringify(demos));
  update();
  assert.equal(await dependency('version-history'), '2.31.0');
  assert.equal(await readFile(historyLock, 'utf8'), 'updated lockfile');
});
