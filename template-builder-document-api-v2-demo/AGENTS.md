# Document API v2 Demo - Agent Guide

This demo uses only SuperDoc's public v2 APIs. Do not use `activeEditor.state`,
`activeEditor.view`, or `activeEditor.commands`.

## Architecture

- `src/field-controller.ts` owns field state, document observation, initial
  loading, legacy-tag migration, and every field CRUD operation.
- `src/App.vue` subscribes to controller snapshots and owns presentation state
  such as tabs, highlighting, and the currently open panel.
- `src/components/` contains Vue-only presentation components.

Field state must not be independently patched or reconciled in Vue components.
Add document operations and their state updates to `FieldController`, then let
subscribers receive the resulting snapshot.

Use `superdoc.activeEditor.doc` for document reads and mutations and
`superdoc.ui` for selection, observation, geometry, and navigation.
