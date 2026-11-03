# Canonical collaboration demo

The agent uses the published SDK `full` preset. Inspect `server/package.json` for
the exact prerelease pin; stable SDK 2.24.0 does not include this preset.

## Agent integration

- `server/src/document-service.js` owns one SDK client and direct/tracked full
  toolkits. Reviewing uses `enforceChangeMode: 'tracked'`; Editing uses the ordinary
  full toolkit. Keep SDK tools, prompt, and dispatcher from the same toolkit.
- `server/src/reference-integration/agent/create-agent.js` owns the model loop,
  selection context, cancellation boundaries, tool status, and bounded retries.
  Dispatch through `toolkit.dispatch(document.handle, name, args)`.
- Expose the SDK full tools plus the app-level `superdoc_references` library tool.
  Keep source CRUD, imported-source context, validation, and snapshot persistence
  in the application. These metadata operations work in both host modes. Do not
  restore custom citation-insertion, bibliography, footnote, or streaming Document
  API tools; those operations use the SDK full preset.
- Model replies stream; document writes execute after full tool arguments arrive.
  SDK batches may retain earlier committed edits after a later operation fails.
  Mark partial batches failed and report partial completion honestly.

## Reference UI and export compatibility

`server/src/reference-integration/reference-document.js` still owns working-file
lifecycle and the reference toolbar's HTTP operations. Its `handle` is the native
SDK document. Its generic HTTP dispatch forwards directly to the SDK full toolkit;
it does not intercept native agent calls. The app library tool calls
`manageReferences(referenceInput(args))`; other tools dispatch to the native SDK.
Keep manual UI fixes separate from native agent execution. See [integration](docs/customer-integration.md) and
[the inventory](docs/reference-integration.md) for the compatibility boundary.

Native source changes must appear in the reference panel and exports. Read the
current package, not only the import-time source cache or SDK session-local source
list. Never overwrite native additions/deletions with cached source metadata.

Retain CSL assets and attribution with manual rendering. Browser integrations must
stay independent of demo room types, API clients, and CSS shell selectors. Await
reference work before replacement/close. Revision checks and snapshot replacement
are not an atomic distributed lock.

## Verification

Run the server suite, focused reference preservation/placement tests, portability
checks, and the client build after agent or SDK changes. Exercise the actual prompt
UI with the native full tools and verify the resulting document. In Reviewing,
check real tracked edits and rejection of direct-only operations. In Editing,
check source creation in both modes and export/reopen. Keep customer documents and evidence in
ignored `artifacts/`, never in committed fixtures.
