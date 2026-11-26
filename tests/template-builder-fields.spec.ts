import { expect, test } from '@playwright/test';

for (const mode of ['editing', 'suggesting']) {
  test(`creates and groups a field in ${mode} mode`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'template-builder-document-api-v2-demo', 'Template Builder only');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto('/');
    await expect(page.getByRole('combobox', { name: 'Document mode' })).toBeEnabled({ timeout: 30000 });
    errors.length = 0;
    await page.getByRole('combobox', { name: 'Document mode' }).selectOption(mode);
    await page.getByRole('combobox', { name: 'Add field' }).selectOption('inline');
    await page.getByRole('textbox', { name: 'Alias' }).fill('Customer name');
    await page.getByRole('textbox', { name: 'Field value' }).fill('Example customer');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const card = page.locator('article').filter({ hasText: 'Customer name' });
    await expect(card).toBeVisible();
    await expect(page.getByRole('region', { name: 'Create field' })).toHaveCount(0);
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    const group = page.getByRole('textbox', { name: 'Tag value' }).first();
    await expect(group).not.toBeEmpty();
    const groupId = await group.inputValue();
    expect(groupId).not.toBe('field');
    await page.getByRole('button', { name: '← Back' }).click();
    await page.getByText('A focused fixture for visually checking variable and conditional rendering.', { exact: true }).first().click();
    await page.waitForTimeout(250);
    await card.getByRole('button', { name: 'Insert' }).click();
    await expect(card.getByText('2 instances')).toBeVisible({ timeout: 10000 });
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Instances (2)' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Tag value' }).first()).toHaveValue(groupId);
    expect(errors).toEqual([]);
  });
}

test('converts a selected suggestion into a field', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'template-builder-document-api-v2-demo', 'Template Builder only');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'File', exact: true })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('combobox', { name: 'File', exact: true }).selectOption('new');
  const editor = page.getByRole('textbox', { name: 'SuperDoc body (v2)' });
  await expect(page.getByText('untitled.docx', { exact: true })).toBeVisible();
  await expect(page.locator('[role="document"] p')).toHaveCount(1);
  await expect(page.locator('[role="document"] p')).toHaveText('');
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('suggesting');
  await editor.click();
  await page.keyboard.type('receiving_party');
  await expect(page.locator('[role="document"]')).toHaveText('receiving_party');
  await page.keyboard.press('Shift+Home');
  await page.locator('span').filter({ hasText: /^receiving_party$/ }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add field using selected text' }).click();
  const card = page.locator('article').filter({ hasText: 'receiving_party' });
  await expect(card).toBeVisible();
  await expect(card.getByText('1 instance')).toBeVisible();
  await expect(page.locator('[role="document"]')).toHaveText('receiving_party');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Field value Updates the document as you type.' })).toHaveValue('receiving_party');
  await expect(page.getByRole('textbox', { name: 'Tag value' }).first()).not.toBeEmpty();
  expect(errors).toEqual([]);
});

test('explains when only part of a suggestion is selected', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'template-builder-document-api-v2-demo', 'Template Builder only');
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'File', exact: true })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('combobox', { name: 'File', exact: true }).selectOption('new');
  await expect(page.getByText('untitled.docx', { exact: true })).toBeVisible();
  await expect(page.locator('[role="document"] p')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('suggesting');
  await page.getByRole('textbox', { name: 'SuperDoc body (v2)' }).click();
  await page.keyboard.type('receiving_party');
  await expect(page.locator('[role="document"]')).toHaveText('receiving_party');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
  const text = page.locator('span').filter({ hasText: /^receiving_party$/ }).first();
  const box = await text.boundingBox();
  if (!box) throw new Error('Suggested text is not visible');
  await text.click({ button: 'right', position: { x: box.width - 5, y: box.height / 2 } });
  await page.getByRole('menuitem', { name: 'Add field using selected text' }).click();
  await expect(page.getByRole('alert')).toHaveText('Select one complete tracked change×');
  await expect(page.locator('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss field error' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
