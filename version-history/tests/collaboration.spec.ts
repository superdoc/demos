import { expect, test, type Page } from '@playwright/test';

const live = (page: Page) => page.getByLabel('Editable document', { exact: true });
const version = (page: Page, number: number) => page.getByRole('button', { name: new RegExp(`^Version ${number} ·`) });

async function edit(page: Page, text: string) {
  await live(page).locator('.superdoc-text-run').first().click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type(text);
  await expect(live(page)).toContainText(text.trim());
}

test('two editors share live edits, poll saved versions, and retain both authors in immutable snapshots', async ({ browser, baseURL }) => {
  const aliceContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 960 } });
  const bobContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 960 } });
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const room = crypto.randomUUID();
  try {
    await Promise.all([
      alice.goto(`/?room=${room}&user=Alice`),
      bob.goto(`/?room=${room}&user=Bob`),
    ]);
    for (const page of [alice, bob]) {
      await expect(page.getByRole('button', { name: 'Save version', exact: true })).toBeEnabled({ timeout: 45_000 });
      await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    }
    await edit(alice, 'Alice wrote this. ');
    await expect(live(bob)).toContainText('Alice wrote this.');
    await edit(bob, 'Bob replied here. ');
    await expect(live(alice)).toContainText('Bob replied here.');
    await alice.getByRole('button', { name: 'Save version', exact: true }).click();
    await expect(version(alice, 1)).toBeVisible();
    await expect(version(bob, 1)).toBeVisible({ timeout: 8000 });
    await expect(version(bob, 1)).toContainText('Alice');
    await version(bob, 1).click();
    const historical = bob.getByLabel('Historical document', { exact: true });
    await expect(historical).toHaveAttribute('aria-busy', 'false');
    await expect(historical).toContainText('Alice wrote this.');
    await expect(historical).toContainText('Bob replied here.');
    const changes = bob.getByRole('region', { name: 'Version edits' });
    await expect(changes.locator('.change-card').filter({ hasText: 'Alice' })).toContainText('Alice wrote this.');
    await expect(changes.locator('.change-card').filter({ hasText: 'Bob' })).toContainText('Bob replied here.');

    await edit(alice, 'A later shared edit. ');
    await alice.getByRole('button', { name: 'Save version', exact: true }).click();
    await expect(version(bob, 2)).toBeVisible({ timeout: 8000 });
    await expect(historical).not.toContainText('A later shared edit.');
    await expect(version(bob, 1)).toHaveAttribute('aria-current', 'true');
    await bob.screenshot({ path: 'artifacts/collaborative-versions.png' });
    await bob.getByRole('button', { name: 'Current version Live Continue editing Bob', exact: true }).click();
    await expect(live(bob)).toContainText('A later shared edit.');
    await bob.reload();
    await expect(bob.getByRole('button', { name: 'Save version', exact: true })).toBeEnabled();
    await expect(live(bob)).toContainText('A later shared edit.');
    await expect(version(bob, 1)).toBeVisible();
    await expect(version(bob, 2)).toBeVisible();
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});
