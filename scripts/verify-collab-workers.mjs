import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function collabWorkers(output) {
  const directory = path.join(output, 'collab', 'assets');
  const names = (await readdir(directory)).filter((name) => /worker-entry-.*\.js$/.test(name)).sort();
  if (!names.length) throw new Error('The release bundle contains no collaboration editor workers');
  return Promise.all(names.map(async (name) => ({
    pathname: `/collab/assets/${name}`,
    bytes: await readFile(path.join(directory, name)),
  })));
}

export async function verifyCollabWorkers({
  workers,
  origin = 'https://demos.superdoc.dev',
  fetchImpl = fetch,
  attempts = 3,
  timeoutMs = 10_000,
  wait = sleep,
  log = console.log,
}) {
  if (!workers.length) throw new Error('No collaboration editor workers to verify');
  const results = await Promise.allSettled(workers.map(async ({ pathname, bytes }) => {
    let failure;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        // Check the same URL the browser uses, including the build's content hash.
        const response = await fetchImpl(new URL(pathname, origin), {
          redirect: 'error',
          headers: { 'cache-control': 'no-cache' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const type = response.headers.get('content-type') ?? '';
        if (!/^(?:application|text)\/(?:javascript|ecmascript)(?:\s*;|$)/i.test(type)) {
          throw new Error(`Expected JavaScript; received ${type || 'no content type'}`);
        }
        const actual = Buffer.from(await response.arrayBuffer());
        if (!actual.equals(bytes)) throw new Error(`Worker bytes differ from the release bundle (${actual.length} received; ${bytes.length} expected)`);
        log(`Verified ${pathname} (${actual.length} bytes)`);
        return pathname;
      } catch (error) {
        failure = error;
        log(`Worker verification ${attempt}/${attempts} ${pathname}: ${error.message}`);
        if (attempt < attempts) await wait(3_000);
      }
    }
    throw new Error(`${pathname}: ${failure?.message}`);
  }));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map((result) => result.reason),
    `Collaboration worker verification failed:\n${failures.map((result) => result.reason.message).join('\n')}`);
  return results.map((result) => result.value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyCollabWorkers({
    workers: await collabWorkers('dist'),
    origin: process.env.DEMOS_VERIFY_URL || 'https://demos.superdoc.dev',
  });
}
