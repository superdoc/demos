import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

const live = (page: Page) => page.getByLabel('Editable document', { exact: true });
const saveButton = (page: Page) => page.getByRole('button', { name: 'Save version', exact: true });
const editRows = (page: Page) => page.getByRole('region', { name: 'Version edits' }).locator('.change-card');
const revisions = (xml: string) => [...xml.matchAll(/<w:(ins|del)\b[^>]*>[\s\S]*?<\/w:\1>/g)].map((match) => match[0]);

async function edit(page: Page, text: string) {
  await live(page).locator('.superdoc-text-run').first().click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type(text);
  await expect(live(page)).toContainText(text.trim());
}

async function save(page: Page) {
  const uploaded = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/versions'));
  await saveButton(page).click();
  const response = await uploaded;
  expect(response.ok()).toBe(true);
  const version = await response.json();
  await expect(saveButton(page)).toBeEnabled();
  const file = await page.request.get(`${response.url()}/${version.id}/file`, {
    headers: { Authorization: response.request().headers()['authorization'] },
  });
  expect(file.ok()).toBe(true);
  return strFromU8(unzipSync(await file.body())['word/document.xml']);
}

test.beforeEach(async ({ page }) => {
  await page.goto(`/?room=${crypto.randomUUID()}&user=You`);
  await expect(saveButton(page)).toBeEnabled({ timeout: 30_000 });
});

test('saved snapshots preserve revisions and successive versions contain only the latest edits', async ({ page }) => {
  await edit(page, 'First checkpoint edit. ');
  const first = await save(page);
  expect(revisions(first).join('')).toContain('First checkpoint edit.');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Version saved', { exact: true })).toBeVisible();
  await expect(live(page)).toContainText('First checkpoint edit.');

  await edit(page, 'Second checkpoint edit. ');
  const second = await save(page);
  expect(second).toContain('First checkpoint edit.');
  expect(revisions(second).join('')).toContain('Second checkpoint edit.');
  expect(revisions(second).join('')).not.toContain('First checkpoint edit.');
  await expect(page.getByRole('alert')).toHaveCount(0);

  const unchanged = await save(page);
  expect(unchanged).toContain('First checkpoint edit.');
  expect(unchanged).toContain('Second checkpoint edit.');
  expect(revisions(unchanged)).toHaveLength(0);

  await page.getByRole('button', { name: /^Version 1 ·/ }).click();
  await expect(editRows(page)).toHaveCount(1);
  await expect(editRows(page)).toContainText('First checkpoint edit.');
  await page.getByRole('button', { name: /^Version 2 ·/ }).click();
  await expect(editRows(page)).toHaveCount(1);
  await expect(editRows(page)).toContainText('Second checkpoint edit.');
  await expect(page.getByLabel('Historical document', { exact: true })).toContainText('First checkpoint edit.');
  await page.getByRole('button', { name: /^Version 3 ·/ }).click();
  await expect(editRows(page)).toHaveCount(0);
});

test('a failed upload keeps tracked changes for the next successful save', async ({ page }) => {
  await edit(page, 'Keep this failed-save edit. ');
  await page.route('**/api/rooms/*/versions', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 503, json: { error: 'Storage unavailable' } });
    else await route.continue();
  });
  await saveButton(page).click();
  await expect(page.getByRole('alert')).toContainText('could not be saved');
  await expect(saveButton(page)).toBeEnabled();
  await page.unroute('**/api/rooms/*/versions');
  const saved = await save(page);
  expect(revisions(saved).join('')).toContain('Keep this failed-save edit.');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('edits arriving during upload stay tracked until a subsequent snapshot captures them', async ({ page, browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const collaborator = await context.newPage();
  const url = new URL(page.url());
  url.searchParams.set('user', 'Bob');
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let stored!: () => void;
  const persisted = new Promise<void>((resolve) => { stored = resolve; });
  try {
    await collaborator.goto(url.href);
    await expect(saveButton(collaborator)).toBeEnabled({ timeout: 30_000 });
    await edit(page, 'Captured before the upload. ');
    await expect(live(collaborator)).toContainText('Captured before the upload.');
    await page.route('**/api/rooms/*/versions', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      stored();
      await released;
      await route.fulfill({ response });
    });
    await saveButton(page).click();
    await persisted;
    await edit(collaborator, 'Arrived during upload. ');
    await expect(live(page)).toContainText('Arrived during upload.');
    release();
    await expect(saveButton(page)).toBeEnabled();
    await expect(page.getByRole('alert')).toContainText('shared document changed during saving');

    const recovered = await save(collaborator);
    expect(revisions(recovered).join('')).toContain('Captured before the upload.');
    expect(revisions(recovered).join('')).toContain('Arrived during upload.');
    await expect(collaborator.getByRole('alert')).toHaveCount(0);
    expect(revisions(await save(collaborator))).toHaveLength(0);
  } finally {
    release();
    await context.close();
  }
});
