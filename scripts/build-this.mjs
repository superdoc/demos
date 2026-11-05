import { readFile } from 'node:fs/promises';
import path from 'node:path';

const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export async function readBuildCommand(root, demo) {
  const source = path.resolve(root, demo.buildCommandSource);
  if (!source.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Build command must be inside the repository');
  return readFile(source, 'utf8');
}

export function renderBuildDialog(demo, command) {
  const id = `build-${demo.id}`;
  const readme = `${demo.sourceUri.replace('/tree/', '/blob/')}/README.md`;
  return `<dialog class="build-dialog" id="${escapeHtml(id)}" aria-labelledby="${escapeHtml(id)}-title">
    <div class="build-dialog-header">
      <div><h2 id="${escapeHtml(id)}-title">Build this app</h2><p>Copy this Bash snippet to clone and run ${escapeHtml(demo.title)} locally.</p></div>
      <button class="build-dialog-close" type="button" aria-label="Close">×</button>
    </div>
    <div class="build-dialog-body">
      <pre><code>${escapeHtml(command)}</code></pre>
      <div class="build-dialog-actions"><button class="build-command-copy" type="button">Copy all commands</button><a href="${escapeHtml(readme)}" target="_blank" rel="noopener noreferrer">View the README on GitHub</a></div>
      <p class="build-copy-status" role="status"></p>
      <p class="build-dialog-note">${escapeHtml(demo.buildCommandNote ?? 'Requires Node.js 22+ and Git. Open the local URL printed by Vite.')}</p>
    </div>
  </dialog>`;
}
