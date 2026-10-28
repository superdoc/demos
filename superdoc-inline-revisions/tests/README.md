# Inline revisions browser tests

Run from `superdoc-inline-revisions`:

```sh
pnpm install --frozen-lockfile
pnpm browsers # once, to install Chromium
pnpm test
```

The runner builds the demo and starts a preview on port 4188. The normal dev
server on port 5173 can keep running. Tests use two Chromium workers, with a new
browser context/document for each case.

`review-ui.spec.ts` checks the editor, ruler, three toolbar sections, and comments
rail. `toolbar.spec.ts` exercises real UI gestures and verifies rendered document
changes, without mocking editor commands or exposing application globals:

- Font previews, selected font, keyboard search, selection preservation, Escape.
- Font size, grow/shrink, bold, italic, underline/dropdown, strikethrough, clear.
- Subscript/superscript application and toggling back to the baseline.
- Font and highlight colors, palettes, automatic color, and highlight removal.
- Alignment, indentation, and all line-spacing choices.
- All bullet and numbering presets, both main toggle buttons, and None.
- All change-case choices and all ten style-gallery entries.
- Table-grid preview and inserting the chosen rows/columns.
- Formatting marks and absence of unsupported placeholder controls.
- Bulk accept/reject of actual insertion/deletion revisions.
- Viewing-mode mutation guards across all three toolbar sections.
- Uncaught browser exceptions.

The short standalone paragraph in the bundled sample gives formatting tests a
stable, untracked selection. Tests click the painted text rather than the
screen-reader-only document mirror.

`fixtures/tracked-changes.docx` is derived from the bundled sample by replacing
that paragraph with a tracked deletion (`before review`, revision 900) and a
tracked insertion (`after review`, revision 901), attributed to `Toolbar test`.
The bulk tests open this file through the demo's file input and verify which text
survives each decision. No changes are made to the public sample.

`content-controls.spec.ts` exercises the standard right-click menu plus wrapping
selected text, locking/unlocking the clicked control, and toolbar formatting on
locked controls. It checks Undo/Redo, review-mode rejection, fonts, colors,
inline/paragraph formatting, list presets, and viewing-mode guards.
`fixtures/content-controls.docx` uses the sample's package with a small replacement
body: two adjacent inline controls with different locks, a locked block containing
a locked inline control, and two plain paragraphs. These cases check precise
partial selections, nested locks, and wrapping a range across paragraphs.
The same tests cover clicking existing locked controls, formatting shortcuts on
partial selections, and rejecting keyboard-applied formatting in Reviewing mode.

`standalone-toolbar.spec.ts` creates a separate temporary Vite app with a copy of
only `src/components/DocumentToolbar`, the public integration example, and a DOCX
fixture. It checks that copying the toolbar includes locked-control formatting,
keyboard shortcuts, Undo, and review decisions without any demo setup. The test
server and temporary app are removed when the test finishes.

Font-menu, table-picker, and inserted-table screenshots are attached to their
Playwright results. Failures also retain screenshots and traces under the ignored
`test-results/` directory. To inspect a failure:

```sh
pnpm exec playwright show-trace test-results/<test-name>/trace.zip
```
