import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Use a short, untracked paragraph already present in the bundled document.
// Select it through the painted surface so these exercise actual editor gestures.
const sampleRun = (page: Page, text = 'and') => page.locator('.superdoc-text-run').filter({ hasText: new RegExp(`^${text}$`) });
const tool = (page: Page, name: string) => page.getByRole('toolbar', { name: 'Document toolbar' }).getByRole('button', { name, exact: true });

async function selectSample(page: Page) {
  const sample = sampleRun(page);
  await expect(sample).toHaveCount(1);
  await sample.dblclick();
  await expect(tool(page, 'Bold')).toBeEnabled();
  return sample;
}
async function menuChoice(page: Page, trigger: string, choice: string) {
  await tool(page, trigger).click();
  await page.getByRole('menuitem', { name: choice, exact: true }).click();
}
async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

const browserErrors = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => { expect(browserErrors.get(page) ?? []).toEqual([]); });

// Each test starts from a clean document; no globals or mocked editor commands.
test.describe.configure({ mode: 'parallel' });
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(tool(page, 'Apply Normal')).toBeEnabled();
  await page.getByLabel('Document mode').selectOption('editing');
});

test('font menu previews its typefaces, preserves selection, and supports keyboard search', async ({ page }, testInfo) => {
  const sample = await selectSample(page);
  await tool(page, 'Font family').click();
  const options = page.getByRole('menuitemradio');
  expect(await options.count()).toBeGreaterThan(2);
  await expect(page.getByRole('menuitemradio', { name: 'Courier New', exact: true })).toHaveCSS('font-family', /Courier New/);
  await expect(page.getByRole('menuitemradio', { name: 'Cambria', exact: true })).toHaveCSS('font-family', /Cambria/);
  await capture(page, testInfo, 'font-menu');
  await page.keyboard.press('End');
  await page.keyboard.press('c');
  await page.keyboard.press('o');
  await expect(page.getByRole('menuitemradio', { name: 'Courier New', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(sample).toHaveCSS('font-family', /Courier New/);
  await tool(page, 'Font family').click();
  await expect(page.getByRole('menuitemradio', { name: 'Courier New', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(tool(page, 'Font family')).toBeFocused();
});

test('font size, grow, and shrink update the selected text', async ({ page }) => {
  const sample = await selectSample(page);
  await page.getByLabel('Font size', { exact: true }).selectOption('14');
  await expect(sample).toHaveCSS('font-size', '18.6667px');
  await tool(page, 'Grow Font').click();
  await expect(page.getByLabel('Font size', { exact: true })).toHaveValue('15');
  await expect(sample).toHaveCSS('font-size', '20px');
  await tool(page, 'Shrink Font').click();
  await expect(sample).toHaveCSS('font-size', '18.6667px');
});

test('bold, italic, underline, strikethrough, and clear formatting change the document', async ({ page }) => {
  const sample = await selectSample(page);
  for (const [name, property, applied] of [
    ['Bold', 'font-weight', '700'], ['Italic', 'font-style', 'italic'],
    ['Underline', 'text-decoration-line', 'underline'], ['Strikethrough', 'text-decoration-line', 'line-through'],
  ]) {
    await test.step(name, async () => {
      await tool(page, name).click();
      await expect(sample).toHaveCSS(property, new RegExp(applied));
      await tool(page, name).click();
      await expect(tool(page, name)).toHaveAttribute('aria-pressed', 'false');
      if (property === 'text-decoration-line') await expect(sample).not.toHaveCSS(property, new RegExp(applied));
      else await expect(sample).toHaveCSS(property, name === 'Bold' ? '400' : 'normal');
    });
  }
  await menuChoice(page, 'Underline options', 'Underline');
  await expect(sample).toHaveCSS('text-decoration-line', /underline/);
  await tool(page, 'Clear All Formatting').click();
  await expect(sample).toHaveCSS('text-decoration-line', 'none');
});

test('subscript and superscript apply and toggle off', async ({ page }) => {
  const sample = await selectSample(page);
  for (const [name, sign] of [['Subscript', -1], ['Superscript', 1]] as const) {
    await tool(page, name).click();
    await expect.poll(async () => Math.sign(await sample.evaluate(el => parseFloat(getComputedStyle(el).verticalAlign)))).toBe(sign);
    await tool(page, name).click();
    await expect(sample).toHaveCSS('vertical-align', 'baseline');
  }
});

test('font and highlight colors work from both the buttons and palettes', async ({ page }) => {
  const sample = await selectSample(page);
  await tool(page, 'Font Color').click();
  await expect(sample).toHaveCSS('color', 'rgb(229, 0, 34)');
  await menuChoice(page, 'Font Color options', 'Apply #0070c0');
  await expect(sample).toHaveCSS('color', 'rgb(0, 112, 192)');
  await menuChoice(page, 'Font Color options', 'Automatic');
  await expect(sample).toHaveCSS('color', 'rgb(0, 0, 0)');
  await tool(page, 'Text Highlight Color').click();
  await expect(sample).toHaveCSS('background-color', 'rgb(255, 242, 0)');
  await menuChoice(page, 'Text Highlight Color options', 'Apply #70ad47');
  await expect(sample).toHaveCSS('background-color', 'rgb(112, 173, 71)');
  await menuChoice(page, 'Text Highlight Color options', 'No Color');
  await expect(sample).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('alignment, indentation, and every spacing option change the paragraph', async ({ page }) => {
  const sample = await selectSample(page);
  const line = sample.locator('..');
  for (const alignment of ['center', 'right', 'justify', 'left']) {
    await tool(page, alignment === 'justify' ? 'Justify' : `Align ${alignment}`).click();
    // The renderer correctly leaves a final justified line left-aligned.
    await expect(line).toHaveCSS('text-align', alignment === 'justify' ? 'left' : alignment);
    await expect(tool(page, alignment === 'justify' ? 'Justify' : `Align ${alignment}`)).toHaveAttribute('aria-pressed', 'true');
  }
  await tool(page, 'Increase Indent').click();
  await expect(line).toHaveCSS('padding-left', '48px');
  await tool(page, 'Decrease Indent').click();
  await expect(line).toHaveCSS('padding-left', '0px');
  for (const spacing of ['1', '1.15', '1.5', '2', '2.5', '3']) {
    const before = await line.getAttribute('style');
    await menuChoice(page, 'Line and Paragraph Spacing', spacing);
    await expect(line).not.toHaveAttribute('style', before!);
  }
});

test('bullet and numbering presets render the selected marker and None removes it', async ({ page }) => {
  const sample = await selectSample(page);
  const paragraph = sample.locator('..').locator('..');
  for (const [name, glyph] of [['Disc', '●'], ['Circle', '○'], ['Square', '▪']]) {
    await menuChoice(page, 'Bullets options', name);
    await expect(tool(page, 'Bullets')).toHaveAttribute('aria-pressed', 'true');
    await expect(paragraph).toContainText(glyph === '●' ? /[•●]/ : glyph === '○' ? /[○◦]/ : /[▪■]/);
  }
  await menuChoice(page, 'Bullets options', 'No bullets');
  await expect(tool(page, 'Bullets')).toHaveAttribute('aria-pressed', 'false');
  for (const [name, marker] of [
    ['Decimal', '1.'], ['Decimal parentheses', '1)'], ['Upper Roman', 'I.'],
    ['Upper letters', 'A.'], ['Lower letters parentheses', 'a)'], ['Lower letters', 'a.'], ['Lower Roman', 'i.'],
  ]) {
    await menuChoice(page, 'Numbering options', name);
    await expect(tool(page, 'Numbering')).toHaveAttribute('aria-pressed', 'true');
    await expect(paragraph).toContainText(marker);
  }
  await menuChoice(page, 'Numbering options', 'No numbering');
  await expect(tool(page, 'Numbering')).toHaveAttribute('aria-pressed', 'false');
  await tool(page, 'Bullets').click();
  await expect(tool(page, 'Bullets')).toHaveAttribute('aria-pressed', 'true');
  await tool(page, 'Bullets').click();
  await expect(tool(page, 'Bullets')).toHaveAttribute('aria-pressed', 'false');
  await tool(page, 'Numbering').click();
  await expect(tool(page, 'Numbering')).toHaveAttribute('aria-pressed', 'true');
  await tool(page, 'Numbering').click();
  await expect(tool(page, 'Numbering')).toHaveAttribute('aria-pressed', 'false');
});

for (const [choice, expected] of [['UPPERCASE', 'AND'], ['lowercase', 'and'], ['Title Case', 'And'], ['tOGGLE cASE', 'AND'], ['Sentence case.', 'And']]) {
  test(`change case: ${choice}`, async ({ page }) => {
    await selectSample(page);
    await menuChoice(page, 'Change Case', choice);
    await expect(sampleRun(page, expected)).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
  });
}

test('style gallery applies each displayed paragraph style', async ({ page }) => {
  const sample = await selectSample(page);
  for (const [name, styleId] of [
    ['No Spacing', 'NoSpacing'], ['heading 1', 'Heading1'], ['heading 2', 'Heading2'], ['heading 3', 'Heading3'],
    ['Title', 'Title'], ['Subtitle', 'Subtitle'], ['Quote', 'Quote'], ['Intense Quote', 'IntenseQuote'],
    ['List Paragraph', 'ListParagraph'], ['Normal', 'Normal'],
  ]) {
    await tool(page, `Apply ${name}`).click();
    await expect(sample).toHaveAttribute('styleid', styleId);
    await expect(tool(page, `Apply ${name}`)).toHaveClass(/is-active/);
  }
});

test('table picker inserts a table with the requested dimensions', async ({ page }, testInfo) => {
  await selectSample(page);
  await tool(page, 'Insert Table').click();
  await expect(page.getByRole('menuitem')).toHaveCount(48);
  const size = page.getByRole('menuitem', { name: 'Insert 3 column by 2 row table', exact: true });
  await size.hover();
  await expect(page.getByText('3 × 2 Table', { exact: true })).toBeVisible();
  await capture(page, testInfo, 'table-picker');
  await size.click();
  const table = page.locator('.superdoc-table-fragment');
  await expect(table).toHaveCount(1);
  await expect(table).toBeVisible();
  const cells = table.locator(':scope > [data-superdoc-table-row-role]');
  await expect(cells).toHaveCount(6);
  expect(await cells.evaluateAll((elements) => ({
    rows: new Set(elements.map((element) => (element as HTMLElement).style.top)).size,
    columns: new Set(elements.map((element) => (element as HTMLElement).style.left)).size,
  }))).toEqual({ rows: 2, columns: 3 });
  await capture(page, testInfo, 'inserted-table');
});

test('formatting marks toggle and unsupported options are absent', async ({ page }) => {
  await selectSample(page);
  const marks = tool(page, 'Show/Hide Formatting Marks');
  const paragraphMarks = page.locator('.superdoc-formatting-paragraph-mark');
  await marks.click();
  await expect(marks).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => paragraphMarks.count()).toBeGreaterThan(0);
  await marks.click();
  await expect(marks).toHaveAttribute('aria-pressed', 'false');
  await expect(paragraphMarks).toHaveCount(0);
  await expect(tool(page, 'Multilevel List')).toHaveCount(0);
  await expect(page.locator('[data-noop]')).toHaveCount(0);
  for (const [trigger, optionCount] of [['Bullets options', 4], ['Numbering options', 8]] as const) {
    await tool(page, trigger).click();
    await expect(page.getByRole('menuitem')).toHaveCount(optionCount);
    await expect(page.getByRole('menuitem', { name: /Define New/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
});

for (const action of ['Accept all', 'Reject all']) {
  test(`${action} resolves imported insertions and deletions`, async ({ page }) => {
    await page.getByLabel('Document mode').selectOption('suggesting');
    await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL('./fixtures/tracked-changes.docx', import.meta.url)));
    await expect(sampleRun(page, 'after review')).toBeVisible();
    await expect(sampleRun(page, 'before review')).toBeVisible();
    await expect(tool(page, action)).toBeEnabled();
    await tool(page, action).click();
    await expect(sampleRun(page, action === 'Accept all' ? 'after review' : 'before review')).toBeVisible();
    await expect(sampleRun(page, action === 'Accept all' ? 'before review' : 'after review')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);
  });
}

test('Viewing mode disables mutations in all three toolbar sections', async ({ page }) => {
  await selectSample(page);
  await page.getByLabel('Document mode').selectOption('viewing');
  for (const name of ['Font family', 'Grow Font', 'Shrink Font', 'Change Case', 'Clear All Formatting', 'Bold', 'Italic', 'Underline', 'Strikethrough', 'Subscript', 'Superscript', 'Text Highlight Color', 'Font Color', 'Bullets', 'Numbering', 'Decrease Indent', 'Increase Indent', 'Align left', 'Align center', 'Align right', 'Justify', 'Line and Paragraph Spacing', 'Insert Table', 'Accept all', 'Reject all', 'Apply Normal', 'Apply heading 1']) {
    await expect(tool(page, name)).toBeDisabled();
  }
  await expect(page.getByLabel('Font size', { exact: true })).toBeDisabled();
});
