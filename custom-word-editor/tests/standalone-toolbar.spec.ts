import { expect, test } from '@playwright/test';
import { cp, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';

let appDirectory: string;
let server: ViteDevServer;
let appUrl: string;

test.beforeAll(async () => {
  test.setTimeout(60_000);
  const demoDirectory = fileURLToPath(new URL('..', import.meta.url));
  appDirectory = await realpath(await mkdtemp(join(tmpdir(), 'standalone-document-toolbar-')));

  // A consumer app gets only the copied toolbar folder and its dependencies.
  await cp(join(demoDirectory, 'src/components/DocumentToolbar'), join(appDirectory, 'DocumentToolbar'), { recursive: true });
  await cp(join(demoDirectory, 'tests/fixtures/content-controls.docx'), join(appDirectory, 'contract.docx'));
  await symlink(join(demoDirectory, 'node_modules'), join(appDirectory, 'node_modules'), 'dir');
  await writeFile(join(appDirectory, 'index.html'), '<div id="root"></div><script type="module" src="/main.tsx"></script>');
  await writeFile(join(appDirectory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }));
  await writeFile(join(appDirectory, 'main.tsx'), `
    import { StrictMode } from 'react';
    import { createRoot } from 'react-dom/client';
    import { EditorWithToolbar } from './DocumentToolbar/examples/EditorWithToolbar';
    createRoot(document.getElementById('root')!).render(
      <StrictMode><EditorWithToolbar documentUrl="/contract.docx" /></StrictMode>
    );
  `);

  server = await createServer({
    configFile: false,
    root: appDirectory,
    cacheDir: join(appDirectory, '.vite'),
    plugins: [react()],
    server: { host: '127.0.0.1', port: 0, fs: { allow: [appDirectory, join(demoDirectory, 'node_modules')] } },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('The standalone toolbar test server did not start.');
  appUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await server?.close();
  if (appDirectory) await rm(appDirectory, { recursive: true, force: true });
});

test('a copied toolbar includes locked-control formatting and shortcuts without demo setup', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(appUrl);

  const toolbar = page.getByRole('toolbar', { name: 'Document toolbar' });
  const tool = (name: string) => toolbar.getByRole('button', { name, exact: true });
  const lockedText = page.locator('.superdoc-text-run').filter({ hasText: /^neighbor$/ });
  await expect(tool('Apply Normal')).toBeEnabled({ timeout: 30_000 });
  await expect(lockedText).toHaveAttribute('data-lock-mode', 'sdtContentLocked');

  await lockedText.click();
  await tool('Bold').click();
  await expect(lockedText).toHaveCSS('font-weight', '700');
  await page.keyboard.press('ControlOrMeta+i');
  await expect(lockedText).toHaveCSS('font-style', 'italic');
  await expect(lockedText).toHaveAttribute('data-lock-mode', 'sdtContentLocked');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(lockedText).toHaveCSS('font-style', 'normal');
  await expect(lockedText).toHaveCSS('font-weight', '700');
  await tool('Reject all').click();
  await expect(lockedText).toHaveCSS('font-weight', '400');
  await expect(lockedText).toHaveAttribute('data-lock-mode', 'sdtContentLocked');
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(errors).toEqual([]);
});
