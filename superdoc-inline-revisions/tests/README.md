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

Document and style-catalog initialization gets a 30-second readiness wait, with
a 60-second total budget per test. Individual interaction assertions retain
Playwright's five-second default. CI always starts its own preview server.

`review-ui.spec.ts` checks the editor, ruler, toolbar sections and the view controls, and comments
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
- Viewing-mode mutation guards across all toolbar sections and the view controls.
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

`document-actions.spec.ts` controls delayed selection reads to verify that a
queued worker selection must match the intended range before the action queue
releases formatting. It also checks capture restoration, mismatched targets,
timeouts, refused selections, and worker failures. UI selection apply/restore
only acknowledges queuing; one subsequent selection read is not a completion
barrier.

`standalone-toolbar.spec.ts` creates a separate temporary Vite app with a copy of
only `src/components/DocumentToolbar`, the public integration example, and a DOCX
fixture. It checks that copying the toolbar includes locked-control formatting,
keyboard shortcuts, Undo, and review decisions without any demo setup. The test
server and temporary app are removed when the test finishes.

Review-mode formatting tests enter Reviewing mode before selecting and locking
their target. Changing modes refreshes worker-backed selection and toolbar state;
an existing selection is not used as a readiness signal across that transition.

Font-menu, table-picker, and inserted-table screenshots are attached to their
Playwright results. Failures also retain screenshots and traces under the ignored
`test-results/` directory. To inspect a failure:

```sh
pnpm exec playwright show-trace test-results/<test-name>/trace.zip
```

`outline.spec.ts` verifies independent Ruler/Outline checkboxes, panel closing,
native heading hierarchy, duplicate-title navigation, live style/heading edits,
invisible edge resizing, and refreshing the outline after document replacement.
The outline DOCX fixtures are synthetic copies of the outline demo's test samples.

The outline checks also cover the Headings/Custom selector, HTML-based title
detection, repeated-label exclusions, navigation to detected titles, live title
edits, mode persistence when reopening the panel, switching modes during reads,
and document replacement in Custom mode. Returning to Headings verifies that
custom detection did not create Word headings.

`outline-generation.spec.ts` checks the plain skeleton contract, including duplicate
labels, empty outlines, and skipped levels. `standalone-outline.spec.ts` copies only
the renderer, its stylesheet, and plain types into a separate app and verifies
expansion, ID-based selection, and replacing the supplied skeleton without any
SuperDoc instance, document, provider, or generation module.
