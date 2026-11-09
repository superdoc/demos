# Build a live document outline with SuperDoc

This standalone React example uses **SuperDoc 2.29.0** and public APIs. It needs no backend or API keys. Open a DOCX, expand real Word heading levels, jump to a section, rename a heading, and export the Word file.

## Run it

```sh
git clone https://github.com/superdoc/demos.git
cd demos/document-outline
npm install
npm run dev
```

The same command is available in the gallery and the app's **Build this** dialog. `npm run build` typechecks and creates a static `dist/` directory. `npm run preview` serves that build locally.

## What SuperDoc supplies

- `await superdoc.activeEditor.doc.info({})` returns the document's native heading outline: text, hierarchy level, and native ID.
- `superdoc.ui.document.onChange()` signals document changes. Refresh the outline after local and remote edits; dispose the subscription when replacing or destroying the editor.
- `await superdoc.ui.viewport.scrollIntoView(...)` reveals a native document target without making a content edit.
- `superdoc.export()` prepares the updated DOCX for download.

The React sidebar and expandable tree are application UI. They use these APIs rather than reading the paginated DOM, accessing editor internals, or sending content to an AI service.

## Read native headings

Start document-dependent work after `onReady`:

```ts
const doc = superdoc.activeEditor?.doc;
if (!doc) throw new Error("The document is not ready.");
const info = await doc.info({});
const headings = info.outline;
```

Render `headings` in document order. Nest an item beneath the preceding lower-level heading. Do not key by label: two sections can both be named “Notes.” Use native identity, including the story when the API supplies one.

The copyable implementation is split into:

- `src/read-outline.ts`: native heading reads through the public Document API.
- `src/use-outline.ts`: debounced changes, disposal and stale-read protection.
- `src/outline-tree.ts`: hierarchy construction.
- `src/OutlineNavigation.tsx`: accessible expansion controls and the active entry.

Each parent has a separate expand/collapse button. Clicking its label navigates without changing expansion state. Hidden children remain out of keyboard navigation. “Expand all” and “Collapse all” are local UI state, not changes to the Word file.

## Navigate by identity

Resolve the heading's exact text inside its native block, then pass that result's segments to the public viewport API. The scoped query prevents a repeated title from selecting a different section:

```ts
const matches = await doc.query.match({
  select: { type: "text", pattern: item.text, caseSensitive: true },
  within: { kind: "block", nodeType: "heading", nodeId: item.nodeId },
  ...(item.story ? { in: item.story } : {}),
});
const match = matches.items[0];
if (!match || match.matchKind !== "text") return false;
const [first, ...rest] = match.blocks;
const target: TextTarget = {
  kind: "text",
  segments: [
    { blockId: first.blockId, range: first.range },
    ...rest.map((block) => ({ blockId: block.blockId, range: block.range })),
  ],
  ...(match.target.story ? { story: match.target.story } : {}),
};
// Import TextTarget from superdoc/ui.
for (let step = 0; step < 8; step++) {
  const result = await superdoc.ui.viewport.scrollIntoView({
    target,
    block: "center",
    behavior: "instant",
  });
  if (result.success) return true;
}
return false;
```

See `src/navigate-outline.ts` for the typed implementation and cancellation when another section is selected. Each call performs one bounded reveal step for virtualized pages. Eight steps covers these fixtures; measure and bound the budget for your application's longest documents. Only a confirmed receipt marks the entry as current. On narrow screens, successful navigation closes the outline drawer so it does not cover the destination.

Preserve a story locator when provided. Do not construct or inspect private engine positions. See the [public navigation guide](https://docs.superdoc.dev/editor/migrate-from-v1/overview/) for the supported paragraph navigation boundary.

## Try the samples

Use **Add heading 1** or **Add heading 2** beside the sample buttons to insert a native heading immediately after the paragraph containing the cursor. The demo reads `doc.selection.current()`, resolves the block through `doc.getNodeById()`, and calls `doc.create.heading({ level, text, at: { kind: "after", target } })`. The new heading is revealed in the outline and its text is selected so you can immediately type a name.

**Structured brief** contains native Heading 1, Heading 2 and Heading 3 styles, two “Notes” headings with distinct IDs, and a longer section. Expand “Delivery plan,” navigate between the two “Notes” entries, and rename “Delivery plan” directly in the editable document.

**Unstyled brief** intentionally has no Word headings and shows the empty-outline state. Bold text alone does not create an outline entry.

Both files are synthetic and generated with `docx` 9.7.1 by `scripts/create-fixtures.ts`. The mixed paragraph, heading and table fixture uses a deterministic generator so contributors can reproduce it with `npm run fixtures`. It is not labeled Word-authored. Native rendering and browser behavior are tested; a separate Microsoft Word round trip is not claimed.

## Files and saving

Files selected in this demo are processed in the browser. There is no document upload endpoint, authentication service, database, or analytics collector. Editing changes the current in-memory document. Use **Export Word** to prepare a download; the demo cannot confirm a browser save or later offline use.

## Verification

`npm run test:browser` builds production assets and exercises native headings, expandable children, live rename updates, repeated-title navigation, empty outlines, document replacement, mobile layout, Word export, and the build dialog. The server HTML and this Markdown guide describe the same APIs and link to the same source.

[Document API info reference](https://docs.superdoc.dev/document-api/reference/info/) · [Custom UI guide](https://docs.superdoc.dev/editor/custom-ui/overview/) · [Source](https://github.com/superdoc/demos/tree/main/document-outline)
