import { expect, test } from '@playwright/test';
import { edit, insertedText, live, openRoom, openVersion, preview, save, versionButton } from './helpers';

test('collaborators retain original edit authors and share immutable history through polling and reload', async ({ browser }) => {
  const aliceContext = await browser.newContext(); const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage(); const bob = await bobContext.newPage();
  try {
    const room = await openRoom(alice, 'Alice'); await openRoom(bob, 'Bob', room);
    await edit(alice, 'Alice wrote this. '); await expect(live(bob)).toContainText('Alice wrote this.');
    await edit(bob, 'Bob wrote this. '); await expect(live(alice)).toContainText('Bob wrote this.');
    const saved = await save(alice);
    expect(saved.records.map((record) => record.actor?.name).sort()).toEqual(['Alice', 'Bob']);
    await expect(versionButton(bob, 1)).toBeVisible({ timeout: 8000 });
    await openVersion(bob, 1);
    const authors = bob.locator('.change-card-heading strong');
    await expect(authors).toHaveText(['Bob', 'Alice']);
    await bob.getByLabel('Sort edits').selectOption('author'); await expect(authors).toHaveText(['Alice', 'Bob']);
    await bob.getByLabel('Sort edits').selectOption('oldest'); await expect(authors).toHaveText(['Alice', 'Bob']);
    await edit(alice, 'Later shared edit. '); const next = await save(alice);
    expect(insertedText(next.records)).toBe('Later shared edit. ');
    await expect(versionButton(bob, 2)).toBeVisible({ timeout: 8000 });
    await expect(preview(bob)).not.toContainText('Later shared edit.');
    await bob.getByRole('button', { name: 'Back to current version', exact: true }).click();
    await expect(live(bob)).toContainText('Later shared edit.');
    await bob.reload(); await expect(versionButton(bob, 2)).toBeVisible();
    await openVersion(bob, 1);
    await expect(preview(bob)).toContainText('Alice wrote this.');
    await expect(preview(bob)).toContainText('Bob wrote this.');
  } finally { await aliceContext.close(); await bobContext.close(); }
});
