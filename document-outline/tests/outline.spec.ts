import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
async function ready(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.locator(".status")).toContainText("Ready", {
    timeout: 60000,
  });
  await expect(
    page.getByRole("button", { name: "Expand Overview", exact: true }),
  ).toBeVisible();
}
test("native outline supports expandable hierarchy and live heading edits", async ({
  page,
}) => {
  await ready(page);
  await expect(
    page.getByRole("button", { name: "Goals and outcomes", exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Expand Overview", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Goals and outcomes", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Collapse Overview", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Goals and outcomes", exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Delivery plan", exact: true })
    .click();
  await page
    .locator(".superdoc-line")
    .filter({ hasText: /^Delivery plan$/ })
    .last()
    .click();
  await page.keyboard.press("End");
  await page.keyboard.type(" updated");
  await expect(
    page.getByRole("button", { name: "Delivery plan updated", exact: true }),
  ).toBeVisible();
});
test("repeated headings navigate by native identity", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "Expand all", exact: true }).click();
  const notes = page.getByRole("button", { name: "Notes", exact: true });
  await expect(notes).toHaveCount(2);
  await notes.first().click();
  await expect(notes.first()).toHaveAttribute("aria-current", "location");
  await notes.last().click();
  await expect(notes.last()).toHaveAttribute("aria-current", "location");
  const lastHeading = page
    .locator(".superdoc-line")
    .filter({ hasText: /^Notes$/ })
    .last();
  await expect
    .poll(async () =>
      lastHeading.evaluate((element) => {
        const heading = element.getBoundingClientRect();
        const canvas = document
          .querySelector(".canvas")!
          .getBoundingClientRect();
        return (
          heading.top >= Math.max(0, canvas.top) &&
          heading.bottom <= Math.min(innerHeight, canvas.bottom)
        );
      }),
    )
    .toBe(true);
  await expect(page.locator('[aria-current="location"]')).toHaveCount(1);
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
});
test("unstyled documents show an empty outline and replacement restores headings", async ({ page }) => {
  await ready(page);
  await page.getByLabel("Open DOCX", { exact: true }).setInputFiles(fileURLToPath(new URL("../public/unstyled-brief.docx", import.meta.url)));
  await expect(page.getByText("No headings yet.", { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("navigation", { name: "Document sections" })).toHaveCount(0);
  await page.getByLabel("Open DOCX", { exact: true }).setInputFiles(fileURLToPath(new URL("../public/project-brief.docx", import.meta.url)));
  await expect(page.getByRole("button", { name: "Expand Overview", exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("No headings yet.", { exact: true })).toHaveCount(0);
});
test("heading buttons insert below the cursor and keep the correct hierarchy", async ({ page }) => {
  await ready(page);
  await page.locator(".superdoc-line").filter({ hasText: /^Overview$/ }).last().click();
  await page.getByRole("button", { name: "Add heading 1", exact: true }).click();
  const first = page.getByRole("button", { name: "New heading 1", exact: true });
  await expect(first).toHaveAttribute("aria-current", "location");
  await expect(page.locator(".outline-tree > li > .outline-row > .outline-item-label")).toHaveText([
    "Overview", "New heading 1", "Delivery plan", "Decisions",
  ]);
  await page.getByRole("button", { name: "Add heading 2", exact: true }).click();
  const second = page.getByRole("button", { name: "New heading 2", exact: true });
  await expect(second).toBeVisible();
  await expect(second).toHaveAttribute("aria-current", "location");
  const newSection = page.locator(".outline-tree > li").filter({ has: first });
  await expect(newSection.locator(":scope > ul > li > .outline-row > .outline-item-label")).toHaveText([
    "New heading 2", "Goals and outcomes", "Scope",
  ]);
  await page.keyboard.type("Renamed section");
  await expect(page.getByRole("button", { name: "Renamed section", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New heading 2", exact: true })).toHaveCount(0);
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
});
for (const width of [390, 1280])
  test(`responsive outline at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      deviceScaleFactor: 3,
    });
    const page = await context.newPage();
    await ready(page);
    await page.getByRole("button", { name: "Expand all", exact: true }).click();
    await page.locator(".studio").scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    if (width >= 850) {
      const handle = page.getByRole("separator", { name: "Resize document outline" });
      const sidebar = page.getByRole("complementary", { name: "Document outline" });
      const initial = (await sidebar.boundingBox())!.width;
      const grip = (await handle.boundingBox())!;
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + grip.width / 2 - 100, grip.y + grip.height / 2, { steps: 5 });
      await page.mouse.up();
      await expect(handle).toHaveAttribute("aria-valuenow", String(initial + 100));
      expect((await sidebar.boundingBox())!.width).toBe(initial + 100);
      await handle.press("ArrowLeft");
      await expect(handle).toHaveAttribute("aria-valuenow", String(initial + 124));
      expect((await sidebar.boundingBox())!.width).toBe(initial + 124);
    }
    await page.screenshot({ path: `test-results/outline-${width}.png` });
    await page
      .getByRole("button", { name: "Close document outline", exact: true })
      .click();
    await expect(
      page.getByRole("navigation", { name: "Document sections" }),
    ).not.toBeVisible();
    await page
      .getByRole("button", { name: "Toggle document outline", exact: true })
      .click();
    await expect(
      page.getByRole("navigation", { name: "Document sections" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Decisions", exact: true }).click();
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    if (width < 850)
      await expect(
        page.getByRole("navigation", { name: "Document sections" }),
      ).not.toBeVisible();
    const heading = page
      .locator(".superdoc-line")
      .filter({ hasText: /^Decisions$/ })
      .last();
    await expect
      .poll(() =>
        heading.evaluate((element) => {
          const rect = element.getBoundingClientRect(),
            canvas = document.querySelector(".canvas")!.getBoundingClientRect();
          return (
            rect.top >= Math.max(0, canvas.top) &&
            rect.bottom <= Math.min(innerHeight, canvas.bottom)
          );
        }),
      )
      .toBe(true);
    await context.close();
  });
test("Word export and build guide work without backend services", async ({
  page,
}) => {
  await ready(page);
  const download = page.waitForEvent("download");
  await page.getByRole("combobox", { name: "File", exact: true }).selectOption("save-as");
  expect((await download).suggestedFilename()).toBe("meridian-brief.docx");
  await page.getByRole("button", { name: "Build this", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Build this app" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog").locator("code")).toContainText(
    "cd demos/document-outline",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const guide = await page.request.get("/guide.md");
  expect(guide.ok()).toBe(true);
  expect(await guide.text()).toContain("doc.info");
});
