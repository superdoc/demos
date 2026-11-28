import { expect, test } from "@playwright/test";

for (const viewport of [
	{ width: 1440, height: 1000 },
	{ width: 390, height: 844 },
	{ width: 844, height: 390 },
]) {
	test.describe(`builder controls at ${viewport.width}x${viewport.height}`, () => {
		test.use({ viewport, isMobile: viewport.width < 900, hasTouch: viewport.width < 900 });

		test("document and controls remain usable", async ({ page }, testInfo) => {
			test.skip(testInfo.project.name !== "template-builder-document-api-v2-demo", "Vue builder layout");
			await page.goto("/");
			await expect(page.locator(".superdoc-text-run").first()).toBeVisible({ timeout: 30_000 });
			const file = page.getByRole("combobox", { name: "File", exact: true });
			const mode = page.getByRole("combobox", { name: "Document mode", exact: true });
			const build = page.getByRole("button", { name: "Build this", exact: true });
			await expect(file).toBeEnabled();
			await expect(mode).toBeEnabled();

			// A normal click must reach the button, without the document title intercepting it.
			await build.click({ timeout: 5_000 });
			const dialog = page.getByRole("dialog", { name: "Build this app", exact: true });
			await expect(dialog).toBeVisible();
			await expect(dialog.locator("code")).toContainText("demos/template-builder-document-api-v2-demo");
			await dialog.getByRole("button", { name: "Close", exact: true }).click();
			await expect(dialog).not.toBeVisible();

			for (const control of [file, mode, build, page.getByRole("link", { name: "More demos", exact: true }), page.getByRole("button", { name: "Hide field explorer", exact: true })]) {
				await expect(control).toBeInViewport({ ratio: 1 });
			}
			await mode.selectOption("viewing");
			await expect(mode).toHaveValue("viewing");
			await mode.selectOption("editing");
			// The formatting ribbon can scroll within the header on a phone.
			await page.getByText("Autofill", { exact: true }).click();
			await expect(page.getByRole("checkbox", { name: "Autofill", exact: true })).toBeChecked();
			await page.getByText("Autofill", { exact: true }).click();
			await expect(page.getByRole("checkbox", { name: "Autofill", exact: true })).not.toBeChecked();

			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
			const editor = await page.locator(".editor-container").boundingBox();
			const sidebar = await page.locator(".sidebar").boundingBox();
			expect(editor).not.toBeNull();
			expect(sidebar).not.toBeNull();
			if (viewport.width < 900 && viewport.height > viewport.width) {
				expect(editor!.width).toBeGreaterThanOrEqual(viewport.width - 32);
				expect(editor!.height).toBeGreaterThan(200);
				expect(sidebar!.y).toBeGreaterThanOrEqual(editor!.y + editor!.height - 1);
			} else {
				// A landscape phone keeps the document beside the explorer instead of a short stacked strip.
				expect(editor!.height).toBeGreaterThan(viewport.height / 2);
				expect(sidebar!.x).toBeGreaterThanOrEqual(editor!.x + editor!.width - 1);
			}
			await page.getByRole("button", { name: "Hide field explorer", exact: true }).click();
			await expect(page.locator(".sidebar")).toHaveCount(0);
			await page.getByRole("button", { name: "Show field explorer", exact: true }).click();
			await expect(page.locator(".sidebar")).toBeVisible();
		});
	});
}
