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

Font-menu, table-picker, and inserted-table screenshots are attached to their
Playwright results. Failures also retain screenshots and traces under the ignored
`test-results/` directory. To inspect a failure:

```sh
pnpm exec playwright show-trace test-results/<test-name>/trace.zip
```
