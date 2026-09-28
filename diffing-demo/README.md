# SuperDoc Diffing Demo

A minimal Vue and SuperDoc editor that serves as the base for the diffing demo.

The current shell includes:

- Side-by-side left, right, and diff-preview editors
- An editable left document with the standard formatting toolbar
- A read-only right comparison document
- A disposable preview document that renders the native diff as tracked markup
- New, upload, and save-as file actions
- Reviewing, editing, and viewing document modes
- Client-side v2 document diffing that applies the right document's changes to
  a disposable copy of the left document as tracked changes

```bash
pnpm install
pnpm dev
```

Run `pnpm build` for a type-checked production build.
