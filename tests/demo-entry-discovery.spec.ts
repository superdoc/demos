import { expect, test } from '@playwright/test';

const entries: Record<string, { title: string; source: string; route: string }> = {
  'template-builder-document-api-v2-demo': {
    title: 'Template Builder API v2 - Vue Demo',
    source: 'https://github.com/superdoc/demos/tree/main/template-builder-document-api-v2-demo',
    route: '/builder/',
  },
  'canonical-collaboration-demo': {
    title: 'SuperDoc collaboration demo',
    source: 'https://github.com/superdoc/demos/tree/main/canonical-collaboration-demo',
    route: '/collab/',
  },
  'custom-word-editor': {
    title: 'SuperDoc custom review UI',
    source: 'https://github.com/superdoc/demos/tree/main/custom-word-editor',
    route: '/custom-word-editor/',
  },
};

test('entry remains useful without JavaScript at phone and desktop widths', async ({ browser, baseURL }, testInfo) => {
  const entry = entries[testInfo.project.name];
  test.skip(!entry, 'The remaining three entry pages own this contract');
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(baseURL!);
      await expect(page.getByRole('heading', { level: 1, name: entry.title, exact: true })).toBeVisible();
      await expect(page.getByText('Loading the interactive demo…', { exact: false })).toBeVisible();
      // Playwright disables script execution but not the parser's scripting flag, so <noscript> stays unrendered here.
      expect(await page.locator('noscript').textContent()).toContain('Enable JavaScript to use the interactive demo.');
      await expect(page.getByRole('link', { name: 'Source and setup instructions' })).toHaveAttribute('href', entry.source);
      await expect(page.getByRole('link', { name: 'SuperDoc documentation' })).toHaveAttribute('href', 'https://docs.superdoc.dev/');
      await expect(page.getByRole('link', { name: 'More SuperDoc demos' })).toHaveAttribute('href', '/');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://demos.superdoc.dev${entry.route}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally {
    await context.close();
  }
});

test('a visitor with JavaScript sees a loading notice, not a request to enable JavaScript', async ({ page }, testInfo) => {
  const entry = entries[testInfo.project.name];
  test.skip(!entry, 'The remaining three entry pages own this contract');
  await page.route('**/assets/*.js', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: entry.title, exact: true })).toBeVisible();
  await expect(page.getByText('Loading the interactive demo…', { exact: false })).toBeVisible();
  await expect(page.getByText('Enable JavaScript', { exact: false })).toBeHidden();
});

test('mount replaces fallback while retaining the document heading and interactive controls', async ({ page }, testInfo) => {
  const entry = entries[testInfo.project.name];
  test.skip(!entry, 'The remaining three entry pages own this contract');
  if (testInfo.project.name === 'canonical-collaboration-demo') {
    await page.route('**/api/rooms/*/initialize', route => route.fulfill({ json: { document: null } }));
    await page.route('**/api/rooms/*/status', route => route.fulfill({ json: { document: null, stale: false } }));
  }
  await page.goto('/');
  const heading = page.locator('header.topbar h1');
  await expect(heading).toHaveCount(1, { timeout: 15_000 });
  await expect(heading).toBeVisible();
  await expect(page.getByRole('main', { name: 'SuperDoc demo introduction' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'More demos', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Document mode', exact: true })).toBeVisible();
  if (testInfo.project.name === 'canonical-collaboration-demo') {
    await expect(heading).toHaveText('No document');
    await page.getByRole('button', { name: 'Build this', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Build this app' })).toBeVisible();
  } else {
    await expect(page.getByRole('combobox', { name: 'File', exact: true })).toBeEnabled({ timeout: 30_000 });
    expect(await heading.evaluate(element => getComputedStyle(element).fontSize)).toBe(testInfo.project.name === 'custom-word-editor' ? '12px' : '16px');
  }
});
