# Integrate the native full agent toolkit

The demo pins `@superdoc/sdk` 2.25.0-next.16. Stable 2.24.0 does not contain the
`full` preset. Its four advertised tools are `superdoc_inspect`,
`superdoc_perform_action`, `superdoc_api_search`, and `superdoc_api_call`.
There are no demo-defined Document API tools or argument translators for native document operations. The app separately retains `superdoc_references` for its citation-library CRUD.

## Existing agent loop

Keep the host's model, prompt UI, authentication, document identity, and lifecycle.
Create the native toolkit for the trusted host mode:

```js
import { createAgentToolkit } from '@superdoc/sdk';

const toolkit = await createAgentToolkit({
  provider: 'openai',
  preset: 'full',
  ...(reviewing ? { enforceChangeMode: 'tracked' } : {}),
});
// Advertise toolkit.tools and include toolkit.systemPrompt in the model request.
const result = await toolkit.dispatch(nativeDocument, toolName, argumentsFromModel);
```

Configure the SDK client with `defaultChangeMode: 'direct'` for Editing. Reuse the
toolkit and native SDK document. Reviewing must use the same enforcing preset for both advertisement and dispatch. Direct-only operations are refused,
including native SDK citation-source creation and citation/bibliography insertion.
The application library tool is a separate metadata operation permitted in both modes.
Do not enable an unrestricted direct-action allowlist to conceal these limits.

Use the SDK's guidance: common actions first, native API calls for other known
operations, then catalogue search when the operation/schema is unknown. Batches
execute sequentially, not atomically. A result with `completed < total` is a partial
failure and can contain committed edits. Do not describe it as all-or-nothing.

The demo model loop is `server/src/reference-integration/agent/create-agent.js`.
It adds selection context, chat streaming, tool statuses, cancellation boundaries,
repeated-failure detection, and a 24-turn limit. It passes native arguments and
receipts through. The host also advertises `superdoc_references`, dispatches it to
`document.manageReferences(referenceInput(args))`, and injects fresh library context
for each request. This app tool preserves saved Word source IDs, revision guards,
corporate authors, source updates, and refusal to delete cited sources. It does not
insert citations or document body text. The host adds brief guidance to use native source/metadata
structures rather than prose or hand-built content controls. It does not stream
partially generated text into the document.

## Manual reference UI compatibility

Full API access does not make every native operation equivalent to the old demo's
snapshot paths. `ReferenceDocument` remains a host lifecycle/manual-UI service.
It exposes its native SDK document as `handle`; the agent dispatches directly to
that handle. Its document-formatting compatibility operations are called by the reference HTTP
routes. Its source-library methods also serve the app-level `superdoc_references`
agent tool. Native document tool calls still bypass these helpers.

- `citationSources()` reads saved Word sources from a current native package
  snapshot. The SDK source list can be empty after joining a room even when the
  exported file contains sources. Import-time caches must not overwrite subsequent
  native agent additions, updates, or removals.
- Source forms, cursor-based citation/note insertion, citation deletion, bibliography
  operations, bibliography styles, field-code display, and export still use their
  existing reference UI methods and revision checks.
- Manual CSL rendering produces APA/Chicago/MLA results. Native agent citation fields
  can initially contain placeholder display text instead of those formatted results.
- Snapshot replacement retains the collaboration identity. Revisions are checked,
  but the check plus replacement is not an atomic distributed lock.

The server source lives in `server/src/reference-integration/`; browser-only
compatibility lives in `client/src/reference-integration/`. The thin API transport
and demo components remain outside the shared browser directory. Keep CSL styles,
locales, attribution, and licenses with the renderer. Never use customer originals
as disposable working files; replacement/close removes the working path.

## Verification

From the demo directory:

```sh
npm --prefix server test
LOG_SERVICES=none node --test server/src/citation-import.test.js \
  server/src/reference-anchor-contract.test.js server/src/reference-anchors.test.js \
  tests/reference-integration-portability.test.mjs \
  tests/footnote-review-labels.test.mjs tests/tracked-replacement-caret.test.mjs
npm --prefix client run build
```

Use the browser prompt UI to check a tracked edit, an operation discovered with
`superdoc_api_search`, a native direct mutation, source-panel refresh, and DOCX
export. Test both Reviewing and Editing. Do not equate a successful chat response
with verified document insertion. Native collaborative TOC creation/update is still
an engine limitation. Keep customer evidence in ignored artifacts.
