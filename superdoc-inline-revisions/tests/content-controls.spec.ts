import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const sampleRun = (page: Page, text = 'and') => page.locator('.superdoc-text-run').filter({ hasText: new RegExp(`^${text}$`) });
const tool = (page: Page, name: string) => page.getByRole('toolbar', { name: 'Document toolbar' }).getByRole('button', { name, exact: true });
const menuItem = (page: Page, name: string) => page.getByRole('menuitem', { name, exact: true });
test.describe.configure({ mode: 'parallel' });

async function openControlFixture(page: Page) {
  await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL('./fixtures/content-controls.docx', import.meta.url)));
  await expect(sampleRun(page, 'alpha beta')).toBeVisible();
}
async function lockSample(page: Page) {
  await wrapSample(page);
  await menuItem(page, 'Lock content control').click();
  await expect(sampleRun(page)).toHaveAttribute('data-lock-mode', 'sdtContentLocked');
  await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
}

async function wrapSample(page: Page) {
  await sampleRun(page).dblclick();
  await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
  await sampleRun(page).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /^Copy/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Cut/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Copy/ })).toBeEnabled();
  await menuItem(page, 'Wrap in content control').click();
  await expect(sampleRun(page)).toHaveAttribute('data-sdt-id', /\d+/);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await sampleRun(page).click({ button: 'right' });
  await expect(menuItem(page, 'Lock content control')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
  // Wait for document/worker/style initialization before exercising editor actions.
  await expect(tool(page, 'Apply Normal')).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel('Document mode').selectOption('editing');
});

test('standard menu wraps the selected range and locks/unlocks the clicked control', async ({ page }) => {
  await wrapSample(page);
  await menuItem(page, 'Lock content control').click();
  await expect(sampleRun(page)).toHaveAttribute('data-lock-mode', 'sdtContentLocked');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await sampleRun(page).click({ button: 'right' });
  await expect(menuItem(page, 'Unlock content control')).toBeVisible();
  await expect(menuItem(page, 'Wrap in content control')).toHaveCount(0);
  await menuItem(page, 'Unlock content control').click();
  await expect(sampleRun(page)).toHaveAttribute('data-lock-mode', 'unlocked');
  await sampleRun(page).click({ button: 'right' });
  await expect(menuItem(page, 'Lock content control')).toBeVisible();
});

test('toolbar bold on a locked control keeps its lock through formatting and Undo', async ({ page }) => {
  await lockSample(page);
  await expect(tool(page, 'Bold')).toBeEnabled();
  await tool(page, 'Bold').click();
  await expect(sampleRun(page)).toHaveCSS('font-weight', '700');
  await sampleRun(page).click({ button: 'right' });
  await expect(menuItem(page, 'Unlock content control')).toBeVisible();
  await page.getByRole('menuitem', { name: /^Undo/ }).click();
  await expect(sampleRun(page)).toHaveCSS('font-weight', '400');
  await sampleRun(page).click({ button: 'right' });
  await expect(menuItem(page, 'Unlock content control')).toBeVisible();
  await page.getByRole('menuitem', { name: /^Redo/ }).click();
  await expect(sampleRun(page)).toHaveCSS('font-weight', '700');
  await expect(sampleRun(page)).toHaveAttribute('data-lock-mode', 'sdtContentLocked');
});

test('inline formatting, font menus, and clear formatting preserve a locked control', async ({ page }) => {
  await lockSample(page);
  const sample = sampleRun(page);
  for (const [name, css, value] of [['Italic', 'font-style', 'italic'], ['Underline', 'text-decoration-line', 'underline'], ['Strikethrough', 'text-decoration-line', 'line-through']]) {
    await tool(page, name).click();
    await expect(sample).toHaveCSS(css, new RegExp(value));
    await tool(page, name).click();
    await expect(sample).not.toHaveCSS(css, new RegExp(value));
  }
  await tool(page, 'Font family').click();
  await page.getByRole('menuitemradio', { name: 'Courier New', exact: true }).click();
  await expect(sample).toHaveCSS('font-family', /Courier New/);
  await tool(page, 'Font family').click();
  await page.getByRole('menuitemradio', { name: 'Courier New', exact: true }).click();
  await page.getByLabel('Font size', { exact: true }).selectOption('14');
  await expect(sample).toHaveCSS('font-size', '18.6667px');
  await tool(page, 'Font Color').click();
  await expect(sample).toHaveCSS('color', 'rgb(229, 0, 34)');
  await tool(page, 'Text Highlight Color').click();
  await expect(sample).toHaveCSS('background-color', 'rgb(255, 242, 0)');
  for (const [name, sign] of [['Subscript', -1], ['Superscript', 1]] as const) {
    await tool(page, name).click();
    await expect.poll(async () => Math.sign(await sample.evaluate((el) => parseFloat(getComputedStyle(el).verticalAlign)))).toBe(sign);
    await tool(page, name).click();
    await expect(sample).toHaveCSS('vertical-align', 'baseline');
  }
  await tool(page, 'Clear All Formatting').click();
  await expect(sample).toHaveCSS('color', 'rgb(0, 0, 0)');
  await expect(sample).toHaveCSS('font-family', /Cambria/);
  await tool(page, 'Clear All Formatting').click();
  await expect(sample).toHaveAttribute('data-lock-mode', 'sdtContentLocked');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('paragraph formatting and styles preserve a locked control', async ({ page }) => {
  await lockSample(page);
  const sample = sampleRun(page);
  const line = sample.locator('xpath=ancestor::*[contains(@class,"superdoc-line")][1]');
  await tool(page, 'Align center').click();
  await expect(line).toHaveCSS('text-align', 'center');
  await tool(page, 'Align left').click();
  await expect(line).toHaveCSS('text-align', 'left');
  await tool(page, 'Increase Indent').click();
  await expect(line).toHaveCSS('padding-left', '48px');
  await tool(page, 'Increase Indent').click();
  await expect(line).toHaveCSS('padding-left', '96px');
  await tool(page, 'Decrease Indent').click();
  await expect(line).toHaveCSS('padding-left', '48px');
  await tool(page, 'Line and Paragraph Spacing').click();
  await menuItem(page, '2').click();
  await expect(line).toHaveCSS('line-height', /[34]\d\./);
  await tool(page, 'Apply heading 1').click();
  await expect(sample).toHaveAttribute('styleid', 'Heading1');
  await expect(sample).toHaveAttribute('data-lock-mode', 'sdtContentLocked');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('bullet and number presets operate on locked content controls', async ({ page }) => {
  await lockSample(page);
  for (const [trigger, choice, marker] of [['Bullets options', 'Square', /[▪■]/], ['Numbering options', 'Upper Roman', /I\./]] as const) {
    await tool(page, trigger).click();
    await menuItem(page, choice).click();
    const paragraph = sampleRun(page).locator('xpath=ancestor::*[contains(@class,"superdoc-line")][1]').locator('..');
    await expect(paragraph).toContainText(marker);
    await expect(sampleRun(page)).toHaveAttribute('data-lock-mode', 'sdtContentLocked');
  }
  await tool(page, 'Numbering options').click();
  await menuItem(page, 'No numbering').click();
  await expect(tool(page, 'Numbering')).toHaveAttribute('aria-pressed', 'false');
  await expect(sampleRun(page)).toHaveAttribute('data-lock-mode', 'sdtContentLocked');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('review mode records formatting while preserving the lock', async ({ page }) => {
  await lockSample(page);
  await page.getByLabel('Document mode').selectOption('suggesting');
  await tool(page, 'Bold').click();
  await expect(sampleRun(page)).toHaveCSS('font-weight', '700');
  await expect(tool(page, 'Reject all')).toBeEnabled();
  await tool(page, 'Reject all').click();
  await expect(sampleRun(page)).toHaveCSS('font-weight', '400');
  await expect(sampleRun(page)).toHaveAttribute('data-lock-mode', 'sdtContentLocked');
});

test('change case preserves the content control and its lock', async ({ page }) => {
  await lockSample(page);
  const id = await sampleRun(page).getAttribute('data-sdt-id');
  await tool(page, 'Change Case').click();
  await menuItem(page, 'UPPERCASE').click();
  await expect(sampleRun(page, 'AND')).toHaveAttribute('data-sdt-id', id!);
  await expect(sampleRun(page, 'AND')).toHaveAttribute('data-lock-mode', 'sdtContentLocked');
});

test('viewing mode prevents content control mutations', async ({ page }) => {
  await lockSample(page);
  await page.getByLabel('Document mode').selectOption('viewing');
  await sampleRun(page).click({ button: 'right' });
  // The stock menu is suppressed entirely in Viewing mode.
  await expect(menuItem(page, 'Unlock content control')).toHaveCount(0);
  await expect(tool(page, 'Bold')).toBeDisabled();
});

test('formatting a partial selection preserves its exact range and every original lock', async ({ page }) => {
  await openControlFixture(page);
  const text = sampleRun(page, 'alpha beta');
  const bounds = await text.boundingBox();
  await text.dblclick({ position: { x: bounds!.width - 6, y: bounds!.height / 2 } });
  await tool(page, 'Bold').click();
  await expect(sampleRun(page, 'beta')).toHaveCSS('font-weight', '700');
  await expect(sampleRun(page, 'beta')).toHaveAttribute('data-lock-mode', 'contentLocked');
  await expect(sampleRun(page, 'alpha ')).toHaveCSS('font-weight', '400');
  await expect(sampleRun(page, 'neighbor')).toHaveAttribute('data-lock-mode', 'sdtContentLocked');
  await expect(sampleRun(page, 'neighbor')).toHaveCSS('font-weight', '400');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('the context action targets the clicked control when another range is selected', async ({ page }) => {
  await openControlFixture(page);
  await sampleRun(page, 'alpha beta').dblclick();
  await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
  await sampleRun(page, 'neighbor').click({ button: 'right' });
  await menuItem(page, 'Unlock content control').click();
  await expect(sampleRun(page, 'neighbor')).toHaveAttribute('data-lock-mode', 'unlocked');
  await expect(sampleRun(page, 'alpha beta')).toHaveAttribute('data-lock-mode', 'contentLocked');
});

test('formatting inside nested controls restores both the inline and block locks', async ({ page }) => {
  await openControlFixture(page);
  const text = sampleRun(page, 'nested text');
  await text.dblclick({ position: { x: 5, y: 6 } });
  await tool(page, 'Bold').click();
  await expect(sampleRun(page, 'nested')).toHaveCSS('font-weight', '700');
  await expect(sampleRun(page, 'nested')).toHaveAttribute('data-lock-mode', 'sdtContentLocked');
  await expect(page.locator('[data-sdt-id="99003"][data-sdt-scope="block"]').first()).toHaveAttribute('data-lock-mode', 'contentLocked');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('a range spanning paragraphs wraps in a block content control', async ({ page }) => {
  await openControlFixture(page);
  const first = sampleRun(page, 'First paragraph.');
  const second = sampleRun(page, 'Second paragraph.');
  const a = (await first.boundingBox())!;
  const b = (await second.boundingBox())!;
  await page.mouse.move(a.x + 1, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  await first.click({ button: 'right' });
  await menuItem(page, 'Wrap in content control').click();
  const control = first.locator('xpath=ancestor::*[@data-sdt-scope="block"][1]');
  await expect(control).toContainText('First paragraph.');
  const id = await control.getAttribute('data-sdt-id');
  await expect(second.locator('xpath=ancestor::*[@data-sdt-scope="block"][1]')).toHaveAttribute('data-sdt-id', id!);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('toolbar formatting works when locked content is selected again with the mouse', async ({ page }) => {
  await lockSample(page);
  await sampleRun(page).click();
  await sampleRun(page).dblclick();
  await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
  await tool(page, 'Bold').click();
  await expect(sampleRun(page)).toHaveCSS('font-weight', '700');
  await expect(sampleRun(page)).toHaveAttribute('data-lock-mode', 'sdtContentLocked');
});

test('a toolbar click immediately after locking waits for the restored selection', async ({ page }) => {
  await wrapSample(page);
  await menuItem(page, 'Lock content control').click();
  await tool(page, 'Bold').click();
  await expect(sampleRun(page)).toHaveCSS('font-weight', '700');
  await expect(sampleRun(page)).toHaveAttribute('data-lock-mode', 'sdtContentLocked');
});

test('clicking an existing locked control allows toolbar formatting of the control', async ({ page }) => {
  await openControlFixture(page);
  await sampleRun(page, 'alpha beta').click();
  await tool(page, 'Bold').click();
  await expect(sampleRun(page, 'alpha beta')).toHaveCSS('font-weight', '700');
  await expect(sampleRun(page, 'alpha beta')).toHaveAttribute('data-lock-mode', 'contentLocked');
  await expect(sampleRun(page, 'neighbor')).toHaveCSS('font-weight', '400');
});

test('keyboard formatting uses the same planner on a locked partial selection', async ({ page }) => {
  await openControlFixture(page);
  const text = sampleRun(page, 'alpha beta');
  const bounds = (await text.boundingBox())!;
  await text.dblclick({ position: { x: bounds.width - 6, y: bounds.height / 2 } });
  await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
  for (const [keys, property, value] of [
    ['ControlOrMeta+b', 'font-weight', '700'],
    ['ControlOrMeta+i', 'font-style', 'italic'],
    ['ControlOrMeta+u', 'text-decoration-line', 'underline'],
    ['ControlOrMeta+Shift+x', 'text-decoration-line', 'line-through'],
  ]) {
    await page.keyboard.press(keys);
    await expect(sampleRun(page, 'beta')).toHaveCSS(property, new RegExp(value));
    await expect(sampleRun(page, 'beta')).toHaveAttribute('data-lock-mode', 'contentLocked');
    await expect(sampleRun(page, 'alpha ')).toHaveCSS('font-weight', '400');
    await page.keyboard.press(keys);
    await expect(sampleRun(page, 'beta')).not.toHaveCSS(property, new RegExp(value));
  }
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('keyboard formatting in review mode preserves the lock through rejection', async ({ page }) => {
  await openControlFixture(page);
  await page.getByLabel('Document mode').selectOption('suggesting');
  await sampleRun(page, 'neighbor').click();
  await page.keyboard.press('ControlOrMeta+b');
  await expect(sampleRun(page, 'neighbor')).toHaveCSS('font-weight', '700');
  await tool(page, 'Reject all').click();
  await expect(sampleRun(page, 'neighbor')).toHaveCSS('font-weight', '400');
  await expect(sampleRun(page, 'neighbor')).toHaveAttribute('data-lock-mode', 'sdtContentLocked');
});

test('typing into a locked control does not show a document-open error', async ({ page }) => {
  await openControlFixture(page);
  await sampleRun(page, 'neighbor').click();
  await page.keyboard.type('x');
  await tool(page, 'Bold').click();
  await expect(sampleRun(page, 'neighbor')).toHaveCSS('font-weight', '700');
  await expect(sampleRun(page, 'neighbor')).toHaveAttribute('data-lock-mode', 'sdtContentLocked');
  await expect(page.getByText('The review document could not be opened.', { exact: true })).toHaveCount(0);
});
