# Template Builder Document API v2 Demo

Vue reference app for building a template-field workflow with SuperDoc v2.

This copy tracks the latest published `superdoc` package. It uses only the public v2 browser surfaces:

- `superdoc.activeEditor.doc` for selection reads and document mutations
- `superdoc.ui.selection` for caret geometry
- `superdoc.ui.contentControls` for observation and navigation

No ProseMirror state, editor view, or legacy editor command APIs are used.

`src/field-controller.ts` is the single source of truth for fields. It owns
initial loading, SuperDoc observation, tag migration, and all field CRUD state.

```bash
pnpm install
pnpm dev
```

Run `pnpm build` for a type-checked production build.
