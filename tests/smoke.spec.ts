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
	if (testInfo.project.name === "canonical-collaboration-demo") {
		await page.route("**/api/rooms/*/initialize", (route) =>
			route.fulfill({ json: { document: null } }),
		);
		await page.route("**/api/rooms/*/status", (route) =>
			route.fulfill({ json: { document: null, stale: false } }),
		);
	}

	await page.goto("/");
	const mount = testInfo.project.name === "template-builder-document-api-v2-demo"
		? "#app > *"
		: "#root > *";
	await expect(page.locator(mount)).toHaveCount(1, { timeout: 15_000 });
	if (testInfo.project.name === "template-builder-document-api-v2-demo") {
		// The Vue shell mounts before SuperDoc loads the document and its workers.
		await expect(page.getByRole("combobox", { name: "File", exact: true })).toBeEnabled({ timeout: 15_000 });
		await expect(page.getByRole("combobox", { name: "Document mode", exact: true })).toBeEnabled();
	}
	await page.waitForLoadState("networkidle");

	expect(errors, errors.join("\n")).toEqual([]);
});
