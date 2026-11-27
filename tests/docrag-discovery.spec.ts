import { expect, test } from "@playwright/test";

test.beforeEach(({}, testInfo) => {
	test.skip(testInfo.project.name !== "docrag", "DocRAG server discovery");
});

test("DocRAG heading, purpose and resources are usable without JavaScript", async ({ browser }, testInfo) => {
	const context = await browser.newContext({
		baseURL: testInfo.project.use.baseURL,
		javaScriptEnabled: false,
	});
	try {
		const page = await context.newPage();
		await page.goto("/", { waitUntil: "domcontentloaded" });
		await expect(page.getByRole("heading", { level: 1, name: "DocRAG", exact: true })).toBeVisible();
		await expect(page.getByRole("heading", { level: 2, name: "Ask your documents. Get cited answers." })).toBeVisible();
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://demos.superdoc.dev/docrag/");
		await expect(page.getByRole("link", { name: "Source", exact: true })).toHaveAttribute("href", "https://github.com/superdoc/demos/tree/main/rag");
		await expect(page.getByRole("link", { name: "Docs", exact: true })).toHaveAttribute("href", "https://docs.superdoc.dev");
		await expect(page.getByText("Loading the document viewer and chat…")).toBeVisible();
		// Playwright disables script execution but not the parser's scripting flag, so <noscript> stays unrendered here.
		expect(await page.locator("noscript").textContent()).toContain("Enable JavaScript to open the document viewer and chat.");
	} finally {
		await context.close();
	}
});

test("DocRAG shows a loading notice, not a request to enable JavaScript, while the app loads", async ({ page }) => {
	await page.route("**/assets/*.js", route => route.abort());
	await page.goto("/");
	await expect(page.getByText("Loading the document viewer and chat…")).toBeVisible();
	await expect(page.getByText("Enable JavaScript", { exact: false })).toBeHidden();
});

test("DocRAG keeps the same heading and resource links after the React app mounts", async ({ page }) => {
	await page.route("**/api/documents", route => route.fulfill({ json: { documents: [], chunkCount: 0 } }));
	await page.goto("/");
	await expect(page.locator("#root .file-sidebar")).toBeVisible();
	await expect(page.locator("#root .discovery-intro")).toHaveCount(0);
	await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
	await expect(page.getByRole("heading", { level: 1, name: "DocRAG", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "+ Add", exact: true })).toBeVisible();
	await expect(page.getByPlaceholder("Ask about your documents...")).toBeDisabled();
	await expect(page.getByRole("navigation", { name: "DocRAG resources" })).toBeVisible();
});

test("DocRAG persistent resource links fit a narrow header", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.route("**/api/documents", route => route.fulfill({ json: { documents: [], chunkCount: 0 } }));
	await page.goto("/");
	await expect(page.locator("#root .file-sidebar")).toBeVisible();
	for (const link of ["Source", "Docs"]) {
		await expect(page.getByRole("link", { name: link, exact: true })).toBeInViewport({ ratio: 1 });
	}
	await expect(page.getByRole("heading", { level: 1, name: "DocRAG", exact: true })).toBeInViewport({ ratio: 1 });
});
