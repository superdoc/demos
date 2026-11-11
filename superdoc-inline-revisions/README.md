# SuperDoc inline revisions

A standalone React demo showing comments in a dedicated rail and tracked-change review controls inline with the document, built with the SuperDoc custom UI API.

## Run locally

```bash
pnpm install
pnpm dev
```

The app uses the latest published `superdoc` package and does not depend on the Orbit workspace.

The app and gallery's **Build this** modals share `src/build-app.sh`. Their
copyable quickstart clones the demos repository, enters this directory, and runs
`pnpm install` followed by `pnpm dev`; no backend or API key is needed. Open
the URL Vite prints. CI compares the commands, runs the quickstart in a clean
clone of the tested source, checks the document and modal in Chromium, and builds
the installed app. See the root README for the quickstart test runner.

## Production build

```bash
pnpm build
pnpm preview
```

Deploy the generated `dist/` directory to any static host. The included review document is copied into the build automatically by Vite.

Run `pnpm browsers` once and `pnpm test` to build the demo and exercise the toolbar
and document interactions in Chromium. See the [browser test guide](./tests/README.md)
for coverage, fixtures, screenshots, and traces.

## What it demonstrates

- `SuperDocUIProvider` and the React custom UI hooks
- Floating observable comments while SuperDoc renders tracked changes inline
- Selection-based comment creation, replies, resolve, reopen, and navigation
- Per-change and bulk accept/reject actions
- Editing and suggesting mode switching
- Standard right-click options plus wrapping selected text in a content control
- Lock/unlock actions on the clicked content control
- Toolbar formatting on locked controls with atomic unlock/format/relock
- Ruler and Outline checkboxes immediately before the style gallery
- An expandable, resizable native-heading outline with live edits and precise section navigation
- DOCX export from the browser

Select text and right-click **Wrap in content control**. Right-click the control
to **Lock content control** or **Unlock content control**. Locking selects the
control's text so the toolbar can format it immediately. Inline formatting
uses `doc.mutations.apply` and restores the original lock modes in the same atomic
commit. Clicking an existing locked control also selects its contents. The
toolbar and Cmd/Ctrl formatting shortcuts use the same handler. Paragraph formatting
uses standard commands while keeping the locks in place. Wrapping and changing
locks are direct operations in both Editing and Reviewing modes; formatting is
tracked in Reviewing mode.

## Reuse the toolbar

Copy [`src/components/DocumentToolbar`](./src/components/DocumentToolbar) into your React
app and import `DocumentToolbar` from that folder. It includes formatting controls,
the heading/style gallery, and stacked tracked-change actions, with all styles
and icons included:

```tsx
<DocumentToolbar superdoc={editorInstance} />
```

See the [integration guide](./src/components/DocumentToolbar/README.md) for both the
standalone editor-instance and shared-provider setups, plus a complete example.

## Document outline

The outline panel opens with all sections expanded by default. Use **Outline** beside the styles gallery to hide or show it. Choose **Headings** to read native Word headings through `doc.info().outline`, or
**Custom** to combine those headings with title-like text detected from
`doc.projectHtml({ reviewMode: "final" })`, using the original outline demo rules.
Both modes refresh after document edits and file replacement, and use the public
viewport API to reveal entries by their block identity. Custom detection runs
locally and does not change document text or Word heading styles. Apply a Heading style in the gallery to add a paragraph to the
outline. Expand sections individually or with Expand all; drag the panel edge to
resize it. The panel shares the outline demo's tree, typography, and selection
styles, while leaving the comment rail available on the right.

**Ruler** toggles the editor's public ruler command independently of the outline.
These controls change the view without editing the document.

Outline generation is isolated in [`src/outline`](./src/outline/README.md).
`generateOutline(doc, mode)` returns `{ entries, skeleton }`; the generator has no
React or rendering dependency. `entries` retain document addresses for navigation,
while `skeleton` contains only nested IDs, labels, and children.

The renderer accepts that skeleton as a prop:

```tsx
<OutlineNavigation
  skeleton={outline.skeleton}
  activeId={activeId}
  onNavigate={handleNavigate}
/>
```

[`OutlineNavigation.tsx`](./src/components/DocumentOutline/OutlineNavigation.tsx)
owns expansion and selection presentation. It imports only React, plain skeleton
types, and its own stylesheet, so it also works without a SuperDoc provider.
The React hook in `src/components/DocumentOutline/use-outline.ts` adapts document
changes to generator calls. The panel wires the resulting data to the renderer,
handles resizing, and delegates navigation to `src/outline/navigate-outline.ts`.

The original custom-title rules live in `src/outline/custom-outline.ts`. They
recognize short bold titles and uppercase group labels, excluding repeated labels,
list items, URLs and sentence-like text. Native headings retain their levels and
identities. Custom entries retain the projection's public block IDs for navigation.
