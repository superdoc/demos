import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createVersionHistoryProxy } from './version-history-proxy.mjs';

export async function assembleVersionHistory({ output, backendUrl }) {
  if (!backendUrl) throw new Error('Set VERSION_HISTORY_BACKEND_URL before assembling the release');
  createVersionHistoryProxy(backendUrl);
  const proxy = await readFile(new URL('./version-history-proxy.mjs', import.meta.url), 'utf8');
  const agentProxy = await readFile(new URL('./demo-agent-proxy.mjs', import.meta.url), 'utf8');
  await writeFile(path.join(output, '_worker.js'), `${proxy}\n${agentProxy}\nexport default createDemoAgentProxy(createVersionHistoryProxy(${JSON.stringify(backendUrl)}));\n`);
  await writeFile(path.join(output, '_routes.json'), JSON.stringify({
    version: 1,
    include: ['/version-history/api/*', '/version-history/collaboration', '/agent/api/*', '/agent/projects/*'],
    exclude: [],
  }, null, 2) + '\n');
}
