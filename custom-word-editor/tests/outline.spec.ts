import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Apply Normal', exact: true })).toBeEnabled({ timeout: 30_000 });
}
async function upload(page: Page, fixture: string) {
  await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url)));
  await expect(page.getByRole('combobox', { name: 'File', exact: true })).toBeEnabled({ timeout: 30_000 });
}

test('generated outlines exclude blank headings and page-break placeholders in both modes', async ({ page }) => {
  await ready(page);
  await upload(page, 'outline-page-breaks.docx');
  await page.getByRole('checkbox', { name: 'Outline', exact: true }).check();
  const panel = page.getByRole('complementary', { name: 'Document outline', exact: true });
  const labels = panel.locator('.outline-item-label');
  const headings = [
    'Overview', 'Goals and outcomes', 'Scope', 'Delivery plan', 'Milestones',
    'Preparation', 'Notes', 'Decisions', 'Notes', 'Next steps',
  ];
  await expect(labels).toHaveText(headings);
  await page.getByRole('radio', { name: 'Custom', exact: true }).check();
  await expect(panel.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  // Keep the snapshot that satisfies the wait: another outline refresh can
  // clear the DOM between the poll and a second allTextContents() read.
  let customLabels: string[] = [];
  await expect.poll(async () => {
    customLabels = (await labels.allTextContents()).map((text) => text.trim());
    return customLabels;
  }).toEqual(expect.arrayContaining(headings));
  expect(customLabels.every((text) => text.length > 0)).toBe(true);
  expect(customLabels).not.toContain('Untitled heading');
  expect(customLabels).not.toContain('[page break]');
  expect(customLabels).not.toContain('[image]');
  expect(customLabels.filter((text) => text === 'Notes')).toHaveLength(2);
  await page.getByRole('radio', { name: 'Headings', exact: true }).check();
  await expect(labels).toHaveText(headings);
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('view checkboxes toggle the ruler and outline independently', async ({ page }, testInfo) => {
  await ready(page);
  const ruler = page.getByRole('checkbox', { name: 'Ruler', exact: true });
  const outline = page.getByRole('checkbox', { name: 'Outline', exact: true });
  await expect(ruler).toBeChecked();
  await expect(outline).toBeChecked();
  await expect(page.getByRole('complementary', { name: 'Document outline', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse all', exact: true })).toBeVisible();
  await outline.uncheck();
  await expect(page.getByRole('complementary', { name: 'Document outline', exact: true })).toHaveCount(0);
  await ruler.uncheck();
  await expect(page.getByLabel('Document ruler', { exact: true })).not.toBeVisible();
  await outline.check();
  await expect(page.getByRole('complementary', { name: 'Document outline', exact: true })).toBeVisible();
  await expect(page.getByLabel('Document comments', { exact: true })).toBeVisible();
  await ruler.check();
  await expect(page.getByLabel('Document ruler', { exact: true })).toBeVisible();
  await expect(page.locator('.v2-ruler-host, .ruler')).toBeVisible();
  const controls = await page.getByRole('group', { name: 'View', exact: true }).boundingBox();
  const gallery = await page.getByRole('group', { name: 'Format styles', exact: true }).boundingBox();
  expect(controls!.x + controls!.width).toBeLessThanOrEqual(gallery!.x);
  await page.screenshot({ path: testInfo.outputPath('view-controls.png') });
  await page.getByRole('button', { name: 'Close document outline', exact: true }).click();
  await expect(outline).not.toBeChecked();
  await expect(ruler).toBeChecked();
});

test('outline supports live hierarchy, navigation, resizing and document replacement', async ({ page }, testInfo) => {
  await ready(page);
  await upload(page, 'outline.docx');
  const toggle = page.getByRole('checkbox', { name: 'Outline', exact: true });
  await toggle.check();
  await expect(page.getByRole('button', { name: 'Collapse Overview', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Goals and outcomes', exact: true })).toBeVisible();
  const plan = page.locator('.outline-tree > li').filter({ has: page.getByRole('button', { name: 'Delivery plan', exact: true }) });
  const milestones = plan.locator(':scope > ul > li').filter({ has: page.getByRole('button', { name: 'Milestones', exact: true }) });
  const preparation = milestones.locator(':scope > ul > li').getByRole('button', { name: 'Preparation', exact: true });
  await expect(preparation).toBeVisible();
  await preparation.click();
  await expect(preparation).toHaveAttribute('aria-current', 'location');
  await page.getByRole('button', { name: 'Collapse Milestones', exact: true }).click();
  await expect(preparation).not.toBeVisible();
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  const notes = page.getByRole('button', { name: 'Notes', exact: true });
  await expect(notes).toHaveCount(2);
  await notes.first().click();
  await expect(notes.first()).toHaveAttribute('aria-current', 'location');
  await notes.last().click();
  await expect(notes.last()).toHaveAttribute('aria-current', 'location');
  const destination = page.locator('.superdoc-line').filter({ hasText: /^Notes$/ }).last();
  await expect.poll(() => destination.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const stage = document.querySelector('.document-stage')!.getBoundingClientRect();
    return rect.top >= stage.top + 25 && rect.bottom <= stage.bottom;
  })).toBe(true);
  const handle = page.getByRole('separator', { name: 'Resize document outline', exact: true });
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '420');
  await expect(handle).toHaveCSS('outline-style', 'none');
  await page.screenshot({ path: testInfo.outputPath('outline-panel.png') });
  await toggle.uncheck();
  await toggle.check();
  await expect(handle).toHaveAttribute('aria-valuenow', '420');
  await upload(page, 'outline-empty.docx');
  await expect(page.getByText('No headings found.', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Notes', exact: true })).toHaveCount(0);
  await upload(page, 'outline.docx');
  await expect(page.getByRole('button', { name: 'Collapse Overview', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
});

for (const level of [1, 2, 3])
test(`applying, renaming and removing Heading ${level} updates the outline`, async ({ page }) => {
  await ready(page);
  await page.getByLabel('Document mode', { exact: true }).selectOption('editing');
  await page.getByRole('checkbox', { name: 'Outline', exact: true }).check();
  const sample = page.locator('.superdoc-text-run').filter({ hasText: /^and$/ });
  await sample.dblclick();
  await page.getByRole('button', { name: `Apply heading ${level}`, exact: true }).click();
  await expect(page.getByRole('button', { name: 'and', exact: true })).toBeVisible({ timeout: 15_000 });
  await sample.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' updated');
  await expect(page.getByRole('button', { name: 'and updated', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apply Normal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'and updated', exact: true })).toHaveCount(0);
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
});

test('Custom detects and navigates bold titles without changing Word headings', async ({ page }, testInfo) => {
  await ready(page);
  await upload(page, 'outline-empty.docx');
  const toggle = page.getByRole('checkbox', { name: 'Outline', exact: true });
  await toggle.check();
  await expect(page.getByRole('radio', { name: 'Headings', exact: true })).toBeChecked();
  await expect(page.getByText('No headings found.', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Custom', exact: true }).check();
  const title = page.getByRole('button', { name: 'Meridian planning notes', exact: true });
  await expect(title).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Collapse Meridian planning notes', exact: true })).toBeVisible();
  const child = page.getByRole('button', { name: 'Keep the original intent', exact: true });
  await expect(child).toBeVisible();
  await expect(page.getByRole('button', { name: 'AI PREPARES', exact: true })).toHaveCount(0);
  await child.click();
  await expect(child).toHaveAttribute('aria-current', 'location');
  await page.getByLabel('Document mode', { exact: true }).selectOption('editing');
  await title.click();
  await page.locator('.superdoc-line').filter({ hasText: /^Meridian planning notes$/ }).last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' updated');
  await expect(page.getByRole('button', { name: 'Meridian planning notes updated', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('custom-outline.png') });
  await toggle.uncheck();
  await toggle.check();
  await expect(page.getByRole('radio', { name: 'Custom', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Meridian planning notes updated', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Headings', exact: true }).check();
  await expect(page.getByText('No headings found.', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Custom', exact: true }).check();
  await page.getByRole('radio', { name: 'Headings', exact: true }).check();
  await expect(page.getByText('No headings found.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Meridian planning notes updated', exact: true })).toHaveCount(0);
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
});

test('Custom preserves native hierarchy and refreshes after document replacement', async ({ page }) => {
  await ready(page);
  await upload(page, 'outline.docx');
  await page.getByRole('checkbox', { name: 'Outline', exact: true }).check();
  await page.getByRole('radio', { name: 'Custom', exact: true }).check();
  const plan = page.locator('.outline-tree > li').filter({ has: page.getByRole('button', { name: 'Delivery plan', exact: true }) });
  const milestones = plan.locator(':scope > ul > li').filter({ has: page.getByRole('button', { name: 'Milestones', exact: true }) });
  await expect(milestones.locator(':scope > ul > li').getByRole('button', { name: 'Preparation', exact: true })).toBeVisible();
  const notes = page.getByRole('button', { name: 'Notes', exact: true });
  await expect(notes).toHaveCount(2);
  await notes.last().click();
  await expect(notes.last()).toHaveAttribute('aria-current', 'location');
  await upload(page, 'outline-empty.docx');
  await expect(page.getByRole('button', { name: 'Meridian planning notes', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(notes).toHaveCount(0);
  await page.getByRole('radio', { name: 'Headings', exact: true }).check();
  await expect(page.getByText('No headings found.', { exact: true })).toBeVisible();
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
});
