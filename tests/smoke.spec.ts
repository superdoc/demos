import { expect, test } from "@playwright/test";

test("demo mounts without console errors", async ({ page }, testInfo) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
	page.on("console", (msg) => {
		if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
	});

	if (testInfo.project.name === "docrag") {
		await page.route("**/api/documents", (route) =>
			route.fulfill({ json: { documents: [], chunkCount: 0 } }),
		);
	}

	await page.goto("/");
	const mount = testInfo.project.name === "template-builder-document-api-v2-demo"
		? "#app > *"
		: "#root > *";
	await expect(page.locator(mount)).toHaveCount(1, { timeout: 15_000 });
	await page.waitForLoadState("networkidle");

	expect(errors, errors.join("\n")).toEqual([]);
});
