import { expect, type Page } from '@playwright/test';
import type { ChangeRecord } from '../src/change-records';

export const live = (page: Page) => page.getByLabel('Editable document', { exact: true });
export const preview = (page: Page) => page.getByLabel('Historical document', { exact: true });
export const saveButton = (page: Page) => page.getByRole('button', { name: 'Save version', exact: true });
export const versionButton = (page: Page, number: number) => page.getByRole('button', { name: new RegExp(`^Version ${number} ·`) });

export async function openRoom(page: Page, user = 'You', room = crypto.randomUUID()) {
  await page.goto(`/?room=${room}&user=${encodeURIComponent(user)}`);
  await expect(saveButton(page)).toBeEnabled({ timeout: 60_000 });
  return room;
}

export async function edit(page: Page, text: string, end = false) {
  await live(page).locator('.superdoc-text-run').first().click();
  await page.keyboard.press(end ? 'ControlOrMeta+End' : 'ControlOrMeta+Home');
  await page.keyboard.insertText(text);
  await expect(live(page)).toContainText(text.trim());
}

export async function save(page: Page) {
  const upload = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/versions'));
  await saveButton(page).click();
  const response = await upload;
  expect(response.ok(), await response.text()).toBe(true);
  const version = await response.json();
  await expect(saveButton(page)).toBeEnabled();
  const headers = { Authorization: response.request().headers()['authorization'] };
  const [file, changes] = await Promise.all([
    page.request.get(`${response.url()}/${version.id}/file`, { headers }),
    page.request.get(`${response.url()}/${version.id}/changes`, { headers }),
  ]);
  expect(file.ok()).toBe(true); expect(changes.ok()).toBe(true);
  return { version, docx: await file.body(), records: await changes.json() as ChangeRecord[] };
}

export async function openVersion(page: Page, number: number) {
  await versionButton(page, number).click();
  await expect(preview(page)).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 });
  await expect(page.getByRole('region', { name: 'Version edits' })).toHaveAttribute('aria-busy', 'false');
}

export const insertedText = (records: ChangeRecord[]) => records.flatMap((record) => record.changes.flatMap((change) => change.kind === 'text' ? [change.inserted] : [])).join('');
