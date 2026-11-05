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

The app and gallery's **Build this** modals share `src/build-app.sh`. Their
copyable quickstart clones the demos repository, enters this directory, and runs
`npm install` followed by `npm run dev`; no backend or API key is needed. Open
the URL Vite prints. CI compares the commands, runs the quickstart in a clean
clone of the tested source, checks the document and modal in Chromium, and builds
the installed app. See the root README for the quickstart test runner.
