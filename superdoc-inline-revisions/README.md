# SuperDoc inline revisions

A standalone React demo showing comments in a dedicated rail and tracked-change review controls inline with the document, built with the SuperDoc custom UI API.

## Run locally

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The app uses the latest published `superdoc` package and does not depend on the Orbit workspace.

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
- DOCX export from the browser

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
