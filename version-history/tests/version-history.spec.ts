import { expect, test, type Page } from '@playwright/test';

const versions = (page: Page) => page.getByRole('navigation', { name: 'Document versions' }).locator('.version-card');
const live = (page: Page) => page.getByLabel('Editable document', { exact: true });
const preview = (page: Page) => page.getByLabel('Historical document', { exact: true });

async function typeAtStart(page: Page, text: string) {
  await live(page).locator('.superdoc-text-run').first().click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type(text);
  await expect(live(page)).toContainText(text.trim());
}

test.beforeEach(async ({ page }) => {
  await page.goto(`/?room=${crypto.randomUUID()}&user=You`);
  await expect(page.getByRole('button', { name: 'Save version', exact: true })).toBeEnabled({ timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe('/version-history/');
  await expect(versions(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save version', exact: true })).toBeEnabled();
  await expect(versions(page)).toHaveCount(2);
  const paper = await live(page).locator('.superdoc-page').first().boundingBox();
  const stage = await page.getByRole('main', { name: 'Current document' }).boundingBox();
  expect(paper).not.toBeNull();
  expect(stage).not.toBeNull();
  expect(Math.abs(paper!.x + paper!.width / 2 - (stage!.x + stage!.width / 2))).toBeLessThan(2);
});

test('only Save version creates snapshots and old versions are read only', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await typeAtStart(page, 'First saved passage. ');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await expect(versions(page)).toHaveCount(2);
  await page.waitForTimeout(1300);
  await expect(versions(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save version', exact: true })).toBeEnabled();

  await typeAtStart(page, 'Second saved passage. ');
  await expect(versions(page)).toHaveCount(3);
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save version', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: /^Version 2 ·/ }).click();
  await expect(preview(page)).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await expect(preview(page)).toContainText('First saved passage.');
  await expect(preview(page)).not.toContainText('Second saved passage.');
  await expect(page.getByText('View only', { exact: true })).toBeVisible();
  await expect(live(page)).toBeHidden();
  await preview(page).locator('.superdoc-text-run').first().click();
  await page.keyboard.type('SHOULD NOT APPEAR');
  await expect(preview(page)).not.toContainText('SHOULD NOT APPEAR');
  await expect(versions(page)).toHaveCount(4);
  await page.screenshot({ path: 'artifacts/version-preview.png' });

  await page.getByRole('button', { name: 'Current version Live Continue editing You' }).click();
  await expect(live(page)).toContainText('Second saved passage.');
  await expect(preview(page)).toHaveCount(0);
  await typeAtStart(page, 'Back in the live editor. ');
  await expect(versions(page)).toHaveCount(4);
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(versions(page)).toHaveCount(5);
  await expect(live(page)).toContainText('Back in the live editor.');
  await page.screenshot({ path: 'artifacts/current-version.png' });
  expect(errors).toEqual([]);
});

test('opening history preserves unsaved edits and undo without creating versions', async ({ page }) => {
  await typeAtStart(page, 'Pending text is preserved. ');
  await page.getByRole('button', { name: /^Version 1 ·/ }).click();
  await expect(preview(page)).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await expect(preview(page)).not.toContainText('Pending text is preserved.');
  await expect(versions(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Back to current version', exact: true }).last().click();
  await expect(live(page)).toContainText('Pending text is preserved.');
  await live(page).locator('.superdoc-text-run').first().click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(live(page)).not.toContainText('Pending text is preserved.');
  await expect(versions(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(versions(page)).toHaveCount(3);
});

test('selection and version navigation do not create snapshots', async ({ page }) => {
  await live(page).locator('.superdoc-text-run').first().dblclick();
  await page.getByRole('button', { name: /^Version 1 ·/ }).click();
  await expect(preview(page)).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Current version Live Continue editing You' }).click();
  await expect(live(page)).toBeVisible();
  await page.waitForTimeout(1300);
  await expect(versions(page)).toHaveCount(2);
});

test('native toolbar edits are saved and historical formatting controls stay disabled', async ({ page }) => {
  const toolbar = page.locator('#current-document-toolbar');
  await expect(toolbar.locator('.superdoc-toolbar')).toBeVisible();
  await live(page).locator('.superdoc-text-run').first().dblclick();
  await toolbar.locator('[data-item="btn-italic"]').click();
  await expect(toolbar.locator('[data-item="btn-italic"]')).toHaveClass(/sd-active/);
  await expect(live(page).locator('.superdoc-text-run').filter({ hasText: /^DISCLOSURE$/ })).toHaveCSS('font-style', 'italic');
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(versions(page)).toHaveCount(3);

  await page.getByRole('button', { name: /^Version 1 ·/ }).click();
  await expect(preview(page)).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await expect(toolbar).toBeHidden();
  const previewToolbar = page.locator('#version-document-toolbar');
  await expect(previewToolbar.locator('.superdoc-toolbar')).toBeVisible();
  await expect(previewToolbar.locator('[data-item="btn-italic"]')).toHaveCSS('pointer-events', 'none');
  await expect(previewToolbar.locator('[data-item="btn-documentMode"]')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/native-toolbar-preview.png' });

  await page.getByRole('button', { name: 'Current version Live Continue editing You' }).click();
  await expect(toolbar).toBeVisible();
  await expect(live(page).locator('.superdoc-text-run').filter({ hasText: /^DISCLOSURE$/ })).toHaveCSS('font-style', 'italic');
  await toolbar.locator('[data-item="btn-undo"]').click();
  await expect(live(page).locator('.superdoc-text-run').first()).toHaveCSS('font-style', 'normal');
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(versions(page)).toHaveCount(4);
});

test('snapshots preserve suggested insertions and deletions as visible review markup', async ({ page }) => {
  await expect(page.locator('#current-document-toolbar [data-item="btn-documentMode"]')).toHaveCount(0);
  await typeAtStart(page, 'Suggested insertion. ');
  await expect(live(page)).toContainText('Suggested insertion.');
  await expect(live(page).locator('.track-insert-dec')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save version', exact: true })).toBeEnabled();
  await expect(versions(page)).toHaveCount(3);

  await page.getByRole('button', { name: /^Version 2 ·/ }).click();
  await expect(preview(page)).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await expect(preview(page).locator('.track-insert-dec').filter({ hasText: 'Suggested insertion.' })).toBeVisible();
  await expect(page.locator('#version-document-toolbar [data-item="btn-documentMode"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Current version Live Continue editing You' }).click();
  await live(page).locator('.superdoc-text-run').first().click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('End');
  await page.keyboard.down('Shift');
  for (let index = 0; index < 'AGREEMENT'.length; index += 1) await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
  await page.keyboard.press('Backspace');
  await expect(live(page).locator('.superdoc-text-run').filter({ hasText: 'MUTUAL NON-DISCLOSURE' })).not.toContainText('AGREEMENT');
  await expect(live(page).locator('.track-delete-dec')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save version', exact: true })).toBeEnabled();
  await expect(versions(page)).toHaveCount(4);

  await page.getByRole('button', { name: /^Version 3 ·/ }).click();
  await expect(preview(page)).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await expect(preview(page).locator('.track-insert-dec').filter({ hasText: 'Suggested insertion.' })).toBeVisible();
  await expect(preview(page).locator('.track-delete-dec').filter({ hasText: 'AGREEMENT' })).toBeVisible();
  await expect(page.locator('#version-document-toolbar [data-item="btn-acceptTrackedChangeBySelection"]:not(.sd-disabled), #version-document-toolbar [data-item="btn-rejectTrackedChangeOnSelection"]:not(.sd-disabled)')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/suggestions-preview.png' });
});
