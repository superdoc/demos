import { expect, test } from '@playwright/test';

test('loads floating comments and leaves tracked changes inline', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Mutual NDA — review copy')).toBeVisible();
  await expect(page.getByLabel('Editable contract')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'File' })).toHaveValue('');
  await expect(page.getByLabel('Document mode')).toHaveValue('suggesting');
  await expect(page.getByLabel('Document toolbar').locator('.superdoc-toolbar')).toBeVisible();
  await expect(page.getByLabel('Font family')).toBeVisible();
  await expect(page.getByLabel('Font size')).toBeVisible();
  await expect(page.getByLabel('Document toolbar').locator('.sd-toolbar-item-ctn')).toHaveCount(6);
  await expect(page.getByLabel('Format styles')).toBeVisible();
  await expect(page.getByLabel('Document toolbar').locator('[data-item="btn-bold"]')).toHaveCount(0);
  await expect(page.locator('.v2-ruler-host, .ruler')).toBeVisible();
  await expect(page.getByLabel('Document ruler')).toHaveCSS('position', 'sticky');
  await expect(page.getByLabel('Document comments')).toBeVisible();
  await expect(page.getByText('Review workspace')).toHaveCount(0);

  await expect(page.locator('.tracked-change-popover')).toHaveCount(0);
  await expect(page.locator('.selection-comment-control')).toHaveCount(0);
  await expect(page.getByText(/select one to review/)).toHaveCount(0);
});
