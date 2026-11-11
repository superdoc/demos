import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
async function ready(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.locator(".status")).toContainText("Ready", {
    timeout: 60000,
  });
  await expect(
    page.getByRole("button", { name: "Expand Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Untitled heading", exact: true }),
  ).toHaveCount(0);
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
  await page.getByRole("switch", { name: "Edit document" }).click();
  await expect(
    page.getByRole("switch", { name: "Edit document" }),
  ).toBeChecked();
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
test("detected titles are opt in and do not include repeated badges", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByRole("button", { name: "Unstyled brief", exact: true })
    .click();
  await expect(page.getByText("No headings yet.", { exact: true })).toBeVisible(
    { timeout: 60000 },
  );
  await page.getByRole("checkbox", { name: /Detect section titles/ }).check();
  await expect(
    page.getByRole("button", { name: "Meridian planning notes", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Expand Meridian planning notes",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Keep the original intent", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "AI PREPARES", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("checkbox", { name: /Detect section titles/ }).uncheck();
  await expect(
    page.getByText("No headings yet.", { exact: true }),
  ).toBeVisible();
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
    await page
      .locator(".studio")
      .screenshot({ path: `test-results/outline-${width}.png` });
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
  await page
    .getByRole("button", { name: "Export Word ↗", exact: true })
    .click();
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

test("projection layout markers do not become outline text or replace authored labels", async ({
  page,
}) => {
  const source = stripTypeScriptTypes(
    await readFile(
      new URL("../src/document-outline.ts", import.meta.url),
      "utf8",
    ),
  );
  await page.setContent("<!doctype html><html><body></body></html>");
  const entries = await page.evaluate(async (source) => {
    const url = URL.createObjectURL(
      new Blob([source], { type: "text/javascript" }),
    );
    try {
      const { outlineFromHtml } = await import(url);
      const html =
        '<h1>Real section</h1><h1><span data-superdoc-placeholder="page-break">[page break]</span></h1><h2>Page break <span data-superdoc-placeholder="page-break">[page break]</span>guidance</h2><p><strong><span data-superdoc-placeholder="image">[image]</span>Useful details</strong></p><h2>[page break]</h2>';
      const start = html.indexOf("<h2>Page break "),
        end = html.indexOf("</h2>", start) + 5;
      return outlineFromHtml(html, [
        {
          identity: "public",
          blockId: "authored-heading",
          nodeType: "heading",
          output: { start, end },
        },
      ]);
    } finally {
      URL.revokeObjectURL(url);
    }
  }, source);
  expect(entries.map((entry: { text: string }) => entry.text)).toEqual([
    "Real section",
    "Page break guidance",
    "Useful details",
    "[page break]",
  ]);
  expect(entries[1].within.nodeId).toBe("authored-heading");
});
