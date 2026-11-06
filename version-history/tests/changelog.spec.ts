import { expect, test } from '@playwright/test';
import { edit, live, openRoom, openVersion, save } from './helpers';

test('custom UI navigates to a recorded range and its author bubble follows the pointer', async ({ page }) => {
  await openRoom(page, 'Alice');
  await edit(page, 'Beginning change. ');
  await edit(page, ' End of document change.', true);
  await save(page); await openVersion(page, 1);
  await expect(page.locator('.change-card')).toHaveCount(2);
  const row = page.locator('.change-card').filter({ hasText: 'End of document change.' });
  await row.click(); await expect(row).toHaveAttribute('aria-current', 'true');
  const highlight = page.locator('.change-highlight.active').first();
  await expect(highlight).toBeVisible();
  const bounds = await highlight.boundingBox(); if (!bounds) throw new Error('No painted range');
  await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
  const tooltip = page.getByRole('tooltip'); await expect(tooltip).toContainText('Alice');
  const first = await tooltip.boundingBox();
  await page.mouse.move(bounds.x + 6, bounds.y + bounds.height / 2);
  await expect.poll(async () => (await tooltip.boundingBox())?.x).toBeGreaterThan(first!.x);
  await page.screenshot({ path: 'artifacts/changes-api-hover.png' });
  await page.getByRole('heading', { name: 'Version history', exact: true }).hover();
  await expect(tooltip).toHaveCount(0);
});

test('character typing renders one paragraph entry and one continuous highlight', async ({ page }) => {
  await openRoom(page, 'Alice');
  await live(page).locator('.superdoc-text-run').first().click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type('A paragraph of typed changes. ');
  const saved = await save(page);
  expect(saved.records.length).toBeGreaterThan(10);
  await openVersion(page, 1);
  const cards = page.locator('.change-card');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('A paragraph of typed changes.');
  await expect(cards).toContainText('edits in this paragraph');
  await cards.click();
  await expect(page.locator('.change-highlight.active')).toHaveCount(1);
  const bounds = await page.locator('.change-highlight.active').boundingBox();
  if (!bounds) throw new Error('No grouped highlight');
  await page.mouse.move(bounds.x + 4, bounds.y + bounds.height / 2);
  await expect(page.getByRole('tooltip')).toContainText('Alice');
  await page.screenshot({ path: 'artifacts/changes-api-paragraph.png' });
});

test('scrolling hides highlights and redraws them over the text after scrolling stops', async ({ page }) => {
  await openRoom(page, 'Alice');
  await edit(page, 'Scroll anchor text. ');
  await save(page);
  await openVersion(page, 1);
  await page.locator('.change-card').click();
  const highlight = page.locator('.change-highlight.active');
  await expect(highlight).toHaveCount(1);
  const before = await highlight.boundingBox();
  if (!before) throw new Error('Missing initial highlight');

  const stage = page.getByRole('main', { name: 'Version preview', exact: true });
  const scrolled = await stage.evaluate((element) => {
    const before = element.scrollTop;
    element.scrollTop += 70;
    return element.scrollTop - before;
  });
  expect(scrolled).toBeGreaterThan(0);
  await expect(highlight).toHaveCount(0);
  await expect(highlight).toHaveCount(1);
  await expect.poll(async () => (await highlight.boundingBox())?.y).toBeCloseTo(before.y - scrolled, 0);

  const text = page.getByLabel('Historical document', { exact: true })
    .locator('.superdoc-text-run').filter({ hasText: 'Scroll anchor text.' }).first();
  const textBounds = await text.boundingBox();
  const after = await highlight.boundingBox();
  if (!textBounds || !after) throw new Error('Missing text or highlight after scroll');
  expect(Math.abs(after.y - textBounds.y)).toBeLessThan(3);
  expect(Math.abs(after.x - textBounds.x)).toBeLessThan(3);

  await stage.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(highlight).toHaveCount(0);
  await stage.evaluate((element) => { element.scrollTop = 0; });
  await expect(highlight).toHaveCount(1);
  await page.screenshot({ path: 'artifacts/changes-api-scroll.png' });
});
