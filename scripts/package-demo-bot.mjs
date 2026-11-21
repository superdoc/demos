import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
// Explicit allowlist: never upload local credentials, data, dependencies or other demos.
export async function packageDemoBot(destination) {
  const output = path.resolve(destination);
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error('Choose an empty deployment directory.');
  for (const name of await readdir(path.join(root, 'agent'))) {
    if (!/\.(?:mjs|json|sh)$/.test(name) && name !== 'Dockerfile') continue;
    await cp(path.join(root, 'agent', name), path.join(output, 'agent', name), { recursive: true });
  }
  for (const name of ['dist-landing/agent', 'dist-landing/superdoc-logo.png', 'demos.json', 'DEMO_IMPACT_SCORECARD.md', '.dockerignore']) {
    await cp(path.join(root, name), path.join(output, name), { recursive: true });
  }
  const demos = JSON.parse(await readFile(path.join(root, 'demos.json'), 'utf8'));
  for (const directory of new Set(demos.map((demo) => demo.packageDirectory))) {
    // Dockerfile lists the catalog's trusted README context explicitly.
    const parts = directory.split('/');
    while (parts.length) {
      const name = path.join(...parts, 'README.md');
      try { await cp(path.join(root, name), path.join(output, name)); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; parts.pop(); }
    }
  }
  await cp(path.join(root, 'agent/railway.json'), path.join(output, 'railway.json'));
  const hash = createHash('sha256');
  async function fingerprint(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(directory, entry.name);
      if (entry.isDirectory()) await fingerprint(name);
      else { hash.update(path.relative(output, name)); hash.update(await readFile(name)); }
    }
  }
  await fingerprint(output);
  const revision = hash.digest('hex');
  await writeFile(path.join(output, 'agent/revision.json'), JSON.stringify({ revision }) + '\n');
  return { output, revision };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/package-demo-bot.mjs <empty-directory>');
  console.log(JSON.stringify(await packageDemoBot(process.argv[2])));
}
