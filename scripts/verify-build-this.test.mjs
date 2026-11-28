import assert from 'node:assert/strict';
import test from 'node:test';
import { renderBuildDialog } from './build-this.mjs';
import { compareBuildCommands, verifyBuildCommands, verifyBrowserBuild } from './verify-build-this.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const demo = { id: 'collaboration', title: 'Collaboration', sourceUri: 'https://github.com/superdoc/demos/tree/main/canonical-collaboration-demo' };

test('quickstart requires a real browser entry while allowing readable mount content', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'superdoc-browser-build-'));
  try {
    await mkdir(path.join(directory, 'assets'));
    await writeFile(path.join(directory, 'assets', 'index-test.js'), 'console.log("browser entry");');
    const script = '<script type="module" crossorigin src="./assets/index-test.js"></script>';
    for (const content of ['', '<main><h1>SuperDoc collaboration demo</h1></main>']) {
      await verifyBrowserBuild(`${script}<div id="root">${content}</div>`, directory);
    }
    await assert.rejects(verifyBrowserBuild('<div id="root"><main>Fallback only</main></div>', directory), /bundled browser entry/);
    await assert.rejects(verifyBrowserBuild(script, directory), /browser app mount/);
    await assert.rejects(verifyBrowserBuild('<script type="module" src="./assets/missing.js"></script><div id="root"></div>', directory), /ENOENT/);
    await writeFile(path.join(directory, 'assets', 'index-test.js'), '');
    await assert.rejects(verifyBrowserBuild(`${script}<div id="root"></div>`, directory), /must not be empty/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the gallery preserves shell quoting, redirects, interpolation, and newlines exactly', () => {
  const command = 'bash <<\'APP\'\necho "${VALUE:-<none>}" && echo \'&quot;\' > output\nAPP\n';
  assert.equal(compareBuildCommands(command, renderBuildDialog(demo, command)), command);
});

test('a changed, truncated, or missing gallery command fails before execution', () => {
  for (const markup of [renderBuildDialog(demo, 'make build'), renderBuildDialog(demo, 'make build\n'), '<dialog></dialog>']) {
    assert.throws(() => compareBuildCommands('make build\nmake dev\n', markup));
  }
});

test('the actual gallery and collaboration dialog display and copy the same command', async () => {
  const command = await verifyBuildCommands();
  assert.match(command, /make build/);
  assert.match(command, /SUPERDOC_BUILD_ONLY/);
  assert.match(command, /make dev/);
});

for (const demoId of ['custom-word-editor', 'template-builder-api-v2']) {
  test(`${demoId} uses the same simple clone/install/dev command in the app and gallery`, async () => {
    const command = await verifyBuildCommands(undefined, demoId);
    assert.match(command, /git clone https:\/\/github.com\/superdoc\/demos\.git/);
    assert.match(command, demoId === 'template-builder-api-v2' ? /npm install\nnpm run dev/ : /pnpm install\npnpm dev/);
    if (demoId === 'custom-word-editor') assert.match(command, /cd demos\/custom-word-editor\n/);
    assert.doesNotMatch(command, /OPENAI_API_KEY|make build/);
  });
}

for (const demoId of ['version-history']) {
  test(`${demoId} shares a pinned pnpm quickstart between the app and gallery`, async () => {
    const command = await verifyBuildCommands(undefined, demoId);
    assert.ok(command.includes(`cd demos/${demoId}`));
    assert.match(command, /npx --yes pnpm@10\.25\.0 install --frozen-lockfile/);
    assert.match(command, /npx --yes pnpm@10\.25\.0 dev/);
    assert.doesNotMatch(command, /OPENAI_API_KEY/);
  });
}
