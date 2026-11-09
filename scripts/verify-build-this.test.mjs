import assert from 'node:assert/strict';
import test from 'node:test';
import { renderBuildDialog } from './build-this.mjs';
import { compareBuildCommands, verifyBuildCommands } from './verify-build-this.mjs';

const demo = { id: 'collaboration', title: 'Collaboration', sourceUri: 'https://github.com/superdoc/demos/tree/main/canonical-collaboration-demo' };

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

for (const demoId of ['inline-revisions', 'template-builder-api-v2', 'document-outline']) {
  test(`${demoId} uses the same simple clone/install/dev command in the app and gallery`, async () => {
    const command = await verifyBuildCommands(undefined, demoId);
    assert.match(command, /git clone https:\/\/github.com\/superdoc\/demos\.git/);
    assert.match(command, /npm install\nnpm run dev/);
    assert.doesNotMatch(command, /OPENAI_API_KEY|make build/);
  });
}

test('version history shares a locked full-stack quickstart between the app and gallery', async () => {
  const command = await verifyBuildCommands(undefined, 'version-history');
  assert.match(command, /cd demos\/version-history/);
  assert.match(command, /pnpm@10\.25\.0 install --frozen-lockfile/);
  assert.match(command, /pnpm@10\.25\.0 dev/);
  assert.doesNotMatch(command, /OPENAI_API_KEY/);
});
