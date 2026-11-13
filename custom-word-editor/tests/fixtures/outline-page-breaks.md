# Outline page-break regression fixture

`outline-page-breaks.docx` is the existing synthetic `project-brief.docx` from
[PR #111](https://github.com/superdoc/demos/pull/111), copied without modification
from commit `2ba1b31d1ffd2ce29e777f8d716524d0d35ac3e2`.

- Source: `document-outline/public/project-brief.docx` in `jelkes1/demos`.
- SHA-256: `6246ecd7c9ddd5363e11231630f32872c0a41313b8c64d8ab3573378af2d915b`.
- Generator: `docx` 9.7.1, using that commit's `document-outline/scripts/create-fixtures.ts`.
- Contains real heading text, duplicate “Notes” headings, and an empty Heading 1
  containing only `<w:br w:type="page"/>`.
- The browser regression opens this file and checks the generated sidebar in
  Headings and Custom modes, including switching back to Headings.

Run with `pnpm exec playwright test tests/outline.spec.ts -g 'generated outlines'`
from `custom-word-editor`. This fixture contains only fictional sample content;
it is not Word-authored and has no claimed Word round-trip or SDK validation.
