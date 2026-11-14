import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { stableVersion } from './check-superdoc-release.mjs';
import { nextDependencyTargets, versionExceptions } from './demo-version-policy.mjs';

const execFileAsync = promisify(execFile);

export async function recordRelease({ root = process.cwd(), version = process.env.SUPERDOC_VERSION, sourceRef = process.env.DEPLOYED_SOURCE_SHA } = {}) {
  if (!stableVersion(version)) throw new Error('Record an exact stable shared release version.');
  if (sourceRef && !/^[0-9a-f]{40}$/.test(sourceRef)) throw new Error('The deployed source must be an exact commit SHA.');
  const readSource = async (file) => sourceRef
    ? (await execFileAsync('git', ['show', `${sourceRef}:${file}`], { cwd: root })).stdout
    : readFile(`${root}/${file}`, 'utf8');
  const demos = JSON.parse(await readSource('demos.json'));
  versionExceptions(demos);
  const next = {};
  for (const { directory, dependency } of nextDependencyTargets(demos)) {
    const manifest = JSON.parse(await readSource(`${directory}/package.json`));
    const installed = manifest.dependencies?.[dependency];
    if (typeof installed !== 'string') throw new Error(`Missing ${dependency} in ${directory}`);
    next[directory] ??= {};
    next[directory][dependency] = installed;
  }
  const state = { version, ...(Object.keys(next).length ? { next } : {}) };
  await writeFile(`${root}/.github/superdoc-release.json`, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await recordRelease();
