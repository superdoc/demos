import { expect, test } from '@playwright/test';
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';

let appDirectory: string;
let server: ViteDevServer;
let appUrl: string;

test.beforeAll(async () => {
  const demoDirectory = fileURLToPath(new URL('..', import.meta.url));
  appDirectory = await realpath(await mkdtemp(join(tmpdir(), 'standalone-outline-')));
  // Copy only the renderer, its stylesheet, and plain types. No SuperDoc setup.
  for (const source of [
    'src/components/DocumentOutline/OutlineNavigation.tsx',
    'src/components/DocumentOutline/OutlineNavigation.css',
    'src/outline/types.ts',
  ]) {
    const destination = join(appDirectory, source);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(demoDirectory, source), destination);
  }
  await symlink(join(demoDirectory, 'node_modules'), join(appDirectory, 'node_modules'), 'dir');
  await writeFile(join(appDirectory, 'index.html'), '<div id="root"></div><script type="module" src="/main.tsx"></script>');
  await writeFile(join(appDirectory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }));
  await writeFile(join(appDirectory, 'main.tsx'), `
    import { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import OutlineNavigation from './src/components/DocumentOutline/OutlineNavigation';
    const initial = [{ id: 'root', text: 'Plan', children: [
      { id: 'first', text: 'Notes', children: [] },
      { id: 'second', text: 'Notes', children: [] },
    ] }];
    function App() {
      const [skeleton, setSkeleton] = useState(initial);
      const [activeId, setActiveId] = useState<string | null>(null);
      return <>
        <OutlineNavigation skeleton={skeleton} activeId={activeId} onNavigate={setActiveId} />
        <output aria-label="Selected ID">{activeId || 'none'}</output>
        <button onClick={() => setSkeleton([{ id: 'replacement', text: 'Replacement', children: [] }])}>Replace skeleton</button>
      </>;
    }
    createRoot(document.getElementById('root')).render(<App />);
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
  if (!address || typeof address === 'string') throw new Error('Standalone outline server did not start.');
  appUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await server?.close();
  if (appDirectory) await rm(appDirectory, { recursive: true, force: true });
});

test('renderer accepts a skeleton without a document or provider', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(appUrl);
  const notes = page.getByRole('button', { name: 'Notes', exact: true });
  await expect(notes.first()).toBeVisible();
  await page.getByRole('button', { name: 'Collapse Plan', exact: true }).click();
  await expect(notes.first()).not.toBeVisible();
  await page.getByRole('button', { name: 'Expand Plan', exact: true }).click();
  await expect(notes).toHaveCount(2);
  await notes.last().click();
  await expect(page.getByLabel('Selected ID')).toHaveText('second');
  await expect(notes.last()).toHaveAttribute('aria-current', 'location');
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await expect(notes.last()).not.toBeVisible();
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect(notes.last()).toBeVisible();
  await page.getByRole('button', { name: 'Replace skeleton', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replacement', exact: true })).toBeVisible();
  await expect(notes).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expand all', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
