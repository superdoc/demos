import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

function revisionFixture(editCount?: number) {
  const parts = unzipSync(readFileSync(new URL('../public/document.docx', import.meta.url)));
  const original = strFromU8(parts['word/document.xml']);
  const paragraphs = Array.from({ length: editCount ?? 42 }, (_, index) => {
    let content = `<w:r><w:t>Paragraph ${index + 1}. This paragraph gives the document enough content to test navigation between pages.</w:t></w:r>`;
    if (editCount) {
      const date = new Date(Date.parse('2026-11-03T15:00:00Z') + index * 1000).toISOString();
      content += `<w:ins w:id="${index + 100}" w:author="Ada Rivera" w:date="${date}"><w:r><w:t>Recorded edit ${index + 1}.</w:t></w:r></w:ins>`;
    } else {
      if (index === 2) content += '<w:ins w:id="101" w:author="Ada Rivera" w:date="2026-11-03T15:00:00Z"><w:r><w:t>Ada added this sentence.</w:t></w:r></w:ins>';
      if (index === 22) content += '<w:del w:id="102" w:author="Zoe Chen" w:date="2026-11-01T15:00:00Z"><w:r><w:delText>Zoe removed this sentence.</w:delText></w:r></w:del>';
      if (index === 36) content += '<w:ins w:id="103" w:author="Marcus Bell" w:date="2026-11-02T15:00:00Z"><w:r><w:t>Marcus added a later paragraph.</w:t></w:r></w:ins>';
    }
    return `<w:p>${content}</w:p>`;
  }).join('');
  parts['word/document.xml'] = strToU8(original.replace(/(<w:body>)[\s\S]*?(<w:sectPr\b)/, `$1${paragraphs}$2`));
  return Buffer.from(zipSync(parts));
}

const fixture = revisionFixture();
const rows = (page: Page) => page.getByRole('region', { name: 'Version edits' }).locator('.change-card');

async function openInitialVersion(page: Page) {
  await page.getByRole('button', { name: /^Version 1 ·/ }).click();
  await expect(page.getByLabel('Historical document', { exact: true })).toHaveAttribute('aria-busy', 'false');
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).first()).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/document.docx', (route) => route.fulfill({
    body: fixture, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }));
  await page.goto(`/?room=${crypto.randomUUID()}&user=You`);
  await expect(page.getByRole('button', { name: 'Save version', exact: true })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save version', exact: true })).toBeEnabled();
});

test('the snapshot catalog sorts all edits by date and author', async ({ page }) => {
  await openInitialVersion(page);
  const authors = page.getByRole('region', { name: 'Version edits' }).locator('.change-card-heading strong');
  await expect(authors).toHaveText(['Ada Rivera', 'Marcus Bell', 'Zoe Chen']);
  await page.getByLabel('Sort edits').selectOption('oldest');
  await expect(authors).toHaveText(['Zoe Chen', 'Marcus Bell', 'Ada Rivera']);
  await page.getByLabel('Sort edits').selectOption('author');
  await expect(authors).toHaveText(['Ada Rivera', 'Marcus Bell', 'Zoe Chen']);
  await expect(rows(page).filter({ hasText: 'Zoe Chen' })).toContainText('Deleted');
  await expect(rows(page).filter({ hasText: 'Zoe Chen' })).toContainText('Zoe removed this sentence.');
  await page.screenshot({ path: 'artifacts/changelog.png' });
});

test('clicking an edit navigates through custom UI and hovering shows an author bubble that follows the pointer', async ({ page }) => {
  await openInitialVersion(page);
  const stage = page.getByRole('main', { name: 'Version preview' });
  const row = rows(page).filter({ hasText: 'Marcus Bell' });
  await row.click();
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => stage.evaluate((element) => element.scrollTop)).toBeGreaterThan(200);
  const passage = page.getByLabel('Historical document', { exact: true }).locator('.track-insert-dec').filter({ hasText: 'Marcus added a later paragraph.' });
  await expect(passage).toBeInViewport();
  const bounds = await passage.boundingBox();
  if (!bounds) throw new Error('The selected edit was not painted');
  await page.mouse.move(bounds.x + 4, bounds.y + bounds.height / 2);
  const bubble = page.getByRole('tooltip');
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText('Marcus Bell');
  const first = await bubble.boundingBox();
  await page.mouse.move(bounds.x + 30, bounds.y + bounds.height / 2);
  await expect.poll(async () => (await bubble.boundingBox())?.x).toBeGreaterThan(first!.x);
  await page.screenshot({ path: 'artifacts/changelog-hover.png' });
  await page.getByRole('heading', { name: 'Version history', exact: true }).hover();
  await expect(bubble).toHaveCount(0);
  await page.getByRole('button', { name: 'Current version Live Continue editing You' }).click();
  await expect(page.getByRole('region', { name: 'Version edits' })).toHaveCount(0);
});

test('switching snapshots uses each reopened document catalog', async ({ page }) => {
  await page.getByLabel('Editable document', { exact: true }).locator('.superdoc-text-run').first().click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type('A new hidden edit. ');
  await expect(page.getByLabel('Editable document', { exact: true })).toContainText('A new hidden edit.');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save version', exact: true })).toBeEnabled();
  await openInitialVersion(page);
  await page.getByRole('button', { name: /^Version 2 ·/ }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).filter({ hasText: 'A new hidden edit.' })).toContainText('You');
  await page.getByRole('button', { name: /^Version 1 ·/ }).click();
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).filter({ hasText: 'A new hidden edit.' })).toHaveCount(0);
});

test('the catalog includes edits beyond the first Document API page', async ({ page }) => {
  await page.route('**/document.docx', (route) => route.fulfill({
    body: revisionFixture(205), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }));
  await page.goto(`/?room=${crypto.randomUUID()}&user=You`);
  await expect(page.getByRole('button', { name: 'Save version', exact: true })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save version', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: /^Version 1 ·/ }).click();
  await expect(rows(page)).toHaveCount(205);
  const lastEdit = rows(page).filter({ hasText: 'Recorded edit 205.' });
  await expect(lastEdit).toBeEnabled();
  await lastEdit.click();
  await expect(lastEdit).toHaveAttribute('aria-current', 'true');
  await expect(page.getByLabel('Historical document', { exact: true }).locator('.track-insert-dec').filter({ hasText: 'Recorded edit 205.' })).toBeInViewport();
  await page.getByRole('button', { name: 'Current version Live Continue editing You' }).click();
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save version', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /^Version 2 ·/ }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Version edits' })).toContainText('No tracked edits in this version.');
});
