import { expect, test } from '@playwright/test';
import { edit, insertedText, live, openRoom, openVersion, save, saveButton } from './helpers';

test('each version stores its change interval without altering earlier document content', async ({ page }) => {
  await openRoom(page);
  await edit(page, 'First interval. '); const first = await save(page);
  await edit(page, 'Second interval. '); const second = await save(page);
  expect(insertedText(first.records)).toBe('First interval. ');
  expect(insertedText(second.records)).toBe('Second interval. ');
  expect((await save(page)).records).toEqual([]);
  await openVersion(page, 2);
  await expect(page.getByLabel('Historical document', { exact: true })).toContainText('First interval.');
  const rows = page.locator('.change-card');
  await expect(rows).toContainText(['Second interval.']);
  await openVersion(page, 3); await expect(rows).toHaveCount(0);
});

test('failed snapshot storage leaves both live edits and durable change records available for retry', async ({ page }) => {
  await openRoom(page); await edit(page, 'Survive a failed save. ');
  await page.route('**/api/rooms/*/versions', (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { error: 'Storage unavailable' } }) : route.continue());
  await saveButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Storage unavailable');
  await page.unroute('**/api/rooms/*/versions');
  expect(insertedText((await save(page)).records)).toBe('Survive a failed save. ');
  await expect(live(page)).toContainText('Survive a failed save.');
});

test('a remote edit after capture belongs to the next version, even while the upload response is delayed', async ({ page, browser }) => {
  const room = await openRoom(page, 'Alice');
  const context = await browser.newContext(); const bob = await context.newPage();
  let release!: () => void; const released = new Promise<void>((resolve) => { release = resolve; });
  let stored!: () => void; const persisted = new Promise<void>((resolve) => { stored = resolve; });
  try {
    await openRoom(bob, 'Bob', room);
    await edit(page, 'Captured edit. '); await expect(live(bob)).toContainText('Captured edit.');
    await page.route('**/api/rooms/*/versions', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch(); stored(); await released; await route.fulfill({ response });
    });
    await saveButton(page).click(); await persisted;
    await edit(bob, 'After capture. '); await expect(live(page)).toContainText('After capture.');
    release(); await expect(saveButton(page)).toBeEnabled();
    await page.unroute('**/api/rooms/*/versions');
    const next = await save(page);
    expect(insertedText(next.records)).toBe('After capture. ');
    expect(next.records.every((record) => record.actor?.name === 'Bob')).toBe(true);
  } finally { release(); await context.close(); }
});
