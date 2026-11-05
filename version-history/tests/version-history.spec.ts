import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { edit, insertedText, live, openRoom, openVersion, preview, save, saveButton, versionButton } from './helpers';

test('ordinary edits produce attributed change records and plain DOCX snapshots, with no automatic versions', async ({ page }) => {
  await openRoom(page, 'Alice');
  await expect(page.getByRole('navigation', { name: 'Document versions' }).locator('.version-card')).toHaveCount(1);
  await live(page).locator('.superdoc-text-run').first().click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type('ABC');
  await expect(live(page)).toContainText('ABC');
  await expect(page.getByRole('navigation', { name: 'Document versions' }).locator('.version-card')).toHaveCount(1);
  const result = await save(page);
  expect(insertedText(result.records)).toBe('ABC');
  expect(result.records.every((record) => record.actor?.name === 'Alice' && record.actor?.id && record.actorType === 'human')).toBe(true);
  const xml = strFromU8(unzipSync(result.docx)['word/document.xml']);
  expect(xml).toContain('ABC'); expect(xml).not.toMatch(/<w:(ins|del)\b/);
  await expect(live(page).locator('.track-insert-dec, .track-delete-dec')).toHaveCount(0);
  await expect(page.locator('#current-document-toolbar .superdoc-toolbar')).toBeVisible();
  await expect(versionButton(page, 1)).toBeVisible();
});

test('historical checkpoints are immutable and read only while the live document stays mounted', async ({ page }) => {
  await openRoom(page);
  await edit(page, 'First version. '); await save(page);
  await edit(page, 'Unsaved live text. ');
  await openVersion(page, 1);
  await expect(preview(page)).toContainText('First version.');
  await expect(preview(page)).not.toContainText('Unsaved live text.');
  await expect(live(page)).toBeHidden();
  await preview(page).locator('.superdoc-text-run').first().click();
  await page.keyboard.type('MUST NOT WRITE');
  await expect(preview(page)).not.toContainText('MUST NOT WRITE');
  await page.getByRole('button', { name: 'Back to current version', exact: true }).click();
  await expect(live(page)).toContainText('Unsaved live text.');
  await live(page).locator('.superdoc-text-run').first().click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(live(page)).not.toContainText('Unsaved live text.');
  await expect(live(page)).toContainText('First version.');
  await expect(versionButton(page, 2)).toHaveCount(0);
});

test('saving does not add an Undo step', async ({ page }) => {
  await openRoom(page);
  await edit(page, 'Undo the actual edit. '); await save(page);
  await live(page).locator('.superdoc-text-run').first().click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(live(page)).not.toContainText('Undo the actual edit.');
  const result = await save(page);
  expect(result.records.some((record) => record.cause === 'undo')).toBe(true);
  await expect(saveButton(page)).toBeEnabled();
});

test('real suggestions remain pending across saves while the changelog uses independent change records', async ({ page }) => {
  await openRoom(page, 'Alice');
  const toolbar = page.locator('#current-document-toolbar');
  await toolbar.locator('[data-item="btn-documentMode"]').click();
  await page.getByText('Suggesting', { exact: true }).click();
  await edit(page, 'A genuine suggestion. ');
  const first = await save(page);
  expect(first.records.length).toBeGreaterThan(0);
  const xml = strFromU8(unzipSync(first.docx)['word/document.xml']);
  expect(xml).toMatch(/<w:ins\b/); expect(xml).toContain('A genuine suggestion.');
  const second = await save(page);
  expect(second.records).toEqual([]);
  expect(strFromU8(unzipSync(second.docx)['word/document.xml'])).toMatch(/<w:ins\b/);
  await openVersion(page, 1);
  await expect(preview(page)).toContainText('A genuine suggestion.');
});

test('normal-mode deletion and formatting are attributed without creating Word revisions', async ({ page }) => {
  await openRoom(page, 'Alice');
  await edit(page, 'Delete this. ');
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.down('Shift');
  for (let index = 0; index < 'Delete this. '.length; index++) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift'); await page.keyboard.press('Backspace');
  const removed = await save(page);
  expect(removed.records.some((record) => record.changes.some((change) => change.kind === 'text' && change.deleted === 'Delete this. '))).toBe(true);
  expect(strFromU8(unzipSync(removed.docx)['word/document.xml'])).not.toMatch(/<w:(ins|del)\b/);
  await live(page).locator('.superdoc-text-run').first().dblclick();
  await page.locator('#current-document-toolbar [data-item="btn-bold"]').click();
  const formatted = await save(page);
  expect(formatted.records.some((record) => record.changes.some((change) => change.kind === 'format'))).toBe(true);
  expect(formatted.records.every((record) => record.actor?.name === 'Alice')).toBe(true);
});
