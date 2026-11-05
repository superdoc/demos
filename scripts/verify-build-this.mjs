import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuildCommand, renderBuildDialog } from './build-this.mjs';

const root = path.resolve(import.meta.dirname, '..');

export function compareBuildCommands(appCommand, galleryMarkup) {
  const code = galleryMarkup.match(/<pre><code>([\s\S]*?)<\/code><\/pre>/)?.[1];
  assert.notEqual(code, undefined, 'Gallery build dialog must contain a command');
  const galleryCommand = code.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  assert.equal(galleryCommand, appCommand, 'Gallery and in-app build commands differ');
  return galleryCommand;
}

export async function verifyBuildCommands(sourceRoot = root, demoId = 'agentic-collaboration') {
  const demos = JSON.parse(await readFile(path.join(sourceRoot, 'demos.json'), 'utf8'));
  const demo = demos.find((entry) => entry.id === demoId);
  assert.ok(demo?.buildCommandSource && demo.buildCommandConsumer, `${demoId} must provide a gallery command and app consumer`);
  const topbarPath = path.join(sourceRoot, demo.buildCommandConsumer);
  const topbar = await readFile(topbarPath, 'utf8');
  const appImport = topbar.match(/import buildCommand from ['"]([^'"]+)\?raw['"]/);
  assert.ok(appImport, 'The in-app dialog must import its raw shell command');
  assert.match(topbar, /<code>\s*(?:\{buildCommand\}|\{\{\s*buildCommand\s*\}\})\s*<\/code>/, 'The in-app dialog must display the imported command');
  assert.match(topbar, /clipboard\.writeText\(buildCommand\)/, 'The in-app dialog must copy the displayed command');
  const appCommand = await readFile(path.resolve(path.dirname(topbarPath), appImport[1]), 'utf8');
  const galleryCommand = await readBuildCommand(sourceRoot, demo);
  return compareBuildCommands(appCommand, renderBuildDialog(demo, galleryCommand));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal ?? result.status})`);
  return result;
}

export async function runBuildCommand(command, sourceRoot = root, demoId = 'agentic-collaboration') {
  const demos = JSON.parse(await readFile(path.join(sourceRoot, 'demos.json'), 'utf8'));
  const demo = demos.find((entry) => entry.id === demoId);
  assert.ok(demo && ['build', 'dev'].includes(demo.buildCommandCheck), 'Unknown quickstart check');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'superdoc-build-this-'));
  try {
    const repository = path.join(temporary, 'source');
    const bin = path.join(temporary, 'bin');
    const work = path.join(temporary, 'work');
    await Promise.all([repository, bin, work].map((directory) => mkdir(directory)));

    // Include the tested checkout and dependency-update artifacts, never ignored
    // node_modules, .env files, or runtime documents. The user-facing URL still
    // clones normally; only this test redirects it to the isolated source copy.
    const sourceDirectory = demo.packageDirectory.split('/')[0];
    const files = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', sourceDirectory], { cwd: sourceRoot, encoding: 'utf8' });
    if (files.status !== 0) throw new Error('Cannot enumerate quickstart source');
    for (const file of new Set(files.stdout.split('\0').filter(Boolean))) {
      const destination = path.join(repository, file);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(sourceRoot, file), destination);
    }
    run('git', ['init', '--quiet', repository]);
    run('git', ['add', '.'], { cwd: repository });
    run('git', ['-c', 'user.name=Quickstart CI', '-c', 'user.email=quickstart@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Tested quickstart source'], { cwd: repository });
    const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    assert.ok(path.isAbsolute(realGit), 'Cannot locate git');
    await writeFile(path.join(bin, 'git'), `#!/bin/sh
if [ "$#" -eq 2 ] && [ "$1" = clone ] && [ "$2" = https://github.com/superdoc/demos.git ]; then
  echo 'Quickstart CI: cloning the tested checkout instead of published main' >&2
  exec "$SUPERDOC_TEST_GIT" clone --no-hardlinks "$SUPERDOC_TEST_REPOSITORY" demos
fi
if [ "$1" = clone ]; then
  echo 'Quickstart CI: unsupported clone command; update the test redirect' >&2
  exit 1
fi
exec "$SUPERDOC_TEST_GIT" "$@"
`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, SUPERDOC_TEST_GIT: realGit, SUPERDOC_TEST_REPOSITORY: repository, SUPERDOC_BUILD_ONLY: '1' };
    // Prevent a local/deployment environment from changing the copied profile.
    for (const key of Object.keys(env)) if (/^(VITE_|COLLABORATION_)/.test(key)) delete env[key];
    if (demo.buildCommandCheck === 'dev') {
      await checkDevCommand(command, { cwd: work, env, sourceRoot });
      // Also typecheck and bundle the freshly npm-installed app.
      run('npm', ['run', 'build'], { cwd: path.join(work, 'demos', demo.packageDirectory), env });
    } else {
      run('bash', [], { cwd: work, env, input: command, stdio: ['pipe', 'inherit', 'inherit'], timeout: 15 * 60_000 });
      const app = path.join(work, 'demos', demo.packageDirectory);
      const html = await readFile(path.join(app, 'dist/index.html'), 'utf8');
      assert.match(html, /<div id="root"><\/div>/, 'Quickstart must produce the browser app');
      for (const component of ['client', 'server']) {
        const relativeLock = path.join(sourceDirectory, component, 'package-lock.json');
        assert.equal(await readFile(path.join(work, 'demos', relativeLock), 'utf8'), await readFile(path.join(repository, relativeLock), 'utf8'), 'Build must preserve lockfiles');
      }
    }
    console.log(`Build this: ${demoId} quickstart passed.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function checkDevCommand(command, { cwd, env, sourceRoot }) {
  const { chromium } = createRequire(path.join(sourceRoot, 'tests/package.json'))('@playwright/test');
  const child = spawn('bash', [], { cwd, env: { ...env, NO_COLOR: '1' }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let output = '';
  let timer;
  let browser;
  try {
    const url = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Quickstart did not start Vite within five minutes')), 5 * 60_000);
      const consume = (chunk) => {
        process.stdout.write(chunk);
        output += chunk.toString().replace(/\x1b\[[0-9;]*m/g, '');
        const match = output.match(/Local:\s+(http:\/\/(?:localhost|127\.0\.0\.1):\d+\/)/);
        if (match) resolve(match[1]);
      };
      child.stdout.on('data', consume);
      child.stderr.on('data', consume);
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`Quickstart exited before startup (${code})`)));
      child.stdin.end(command);
    });
    clearTimeout(timer);
    browser = await chromium.launch();
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    // A rendered document verifies that the worker, sample DOCX, and editor load.
    await page.locator('.superdoc-text-run').first().waitFor({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Build this', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Build this app', exact: true });
    assert.equal(await dialog.locator('code').textContent(), command, 'Running app must show the verified gallery command');
    await dialog.getByRole('button', { name: 'Copy all commands', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), command, 'Running app must copy the same command');
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false);
    assert.deepEqual(errors, [], 'Quickstart must not have browser errors');
  } finally {
    clearTimeout(timer);
    await browser?.close();
    // Stop Vite and npm as well as the parent Bash process before removing files.
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await exited;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const demos = JSON.parse(await readFile(path.join(root, 'demos.json'), 'utf8'));
  const demoIndex = process.argv.indexOf('--demo');
  const selected = demoIndex < 0 ? demos.filter((demo) => demo.buildCommandSource) : demos.filter((demo) => demo.id === process.argv[demoIndex + 1]);
  assert.ok(selected.length, 'No matching quickstart demo');
  // Validate every selected command before executing any of them.
  const commands = await Promise.all(selected.map(async (demo) => ({ demo, command: await verifyBuildCommands(root, demo.id) })));
  for (const { demo, command } of commands) {
    console.log(`Build this: ${demo.id} gallery and in-app commands are identical.`);
    if (process.argv.includes('--run')) await runBuildCommand(command, root, demo.id);
  }
}
