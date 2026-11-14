# Connect reference tools to an existing app and agent

The goal is to let a customer use their existing prompt UI and agent to create saved
reference sources and insert real Word citations and footnotes at the requested places.
The maintained source is this repository. Integrate it directly; there is no tarball,
export step, or second customer implementation to maintain.

Start the integrating agent with [AGENTS.md](../AGENTS.md). It should inspect the target
app first and implement the small host adapter described here. Keep the target app's
agent framework, model provider, UI, collaboration transport, and document identity.

## The three functional parts

| Part | Maintained source | What it contributes |
| --- | --- | --- |
| Native SuperDoc APIs | `server/src/reference-integration/native/`, native handle calls in `reference-document.js`, and `client/src/reference-integration/native/` | SDK session opening, Full inspection/read/API dispatch, save/replace, browser selection and viewport geometry |
| Custom tools | `server/src/reference-integration/tools/` | `superdoc_stream_text` only; source, citation, footnote and bibliography operations use the SDK Full toolkit |
| Workarounds/fixes | `server/src/reference-integration/workarounds/` and browser compatibility components/helpers in `client/src/reference-integration/` | Stable imported sources, exact anchor resolution/verification, field/note insertion, rendering and deletion, XML repair, review labels, and tracked-typing correction |

`ReferenceDocument` connects the native operations to the custom tools and fixes.
`agent/reference-agent-adapter.js` supplies the policy needed to run them through an
existing agent: fresh source context, trusted change mode, error handling, bounded
repeated retries, and reporting based on successful receipts. These safeguards belong
to the reusable integration. Agent citation/footnote insertion dispatches through the
SDK Full toolkit; the toolbar keeps its existing snapshot insertion and compatibility
fixes. Copying only tool schemas would omit the remaining integration safeguards.

Use the source directories in place when they share a repository, or bring the two
source directories into the corresponding target app areas with their internal layout
intact. Record the originating commit when copying source so updates can be reviewed.
Do not create a generated distribution or duplicate the implementation. Merge required
dependencies into the owning applications' existing manifests. The demo's thin host
adapters are examples; its room server, chat, routes, and model runner are not required.

## Minimal server adapter

The target app supplies its existing SDK client and Full toolkit, one live document,
current prompt, and trusted tracked/direct mode. The SDK document must participate
in the same collaboration session as the app's editor.

### 1. Connect the app's document lifecycle

At the app's existing document-open/import boundary, use `openReferenceDocument` with
the existing SDK client. This runs the known import repairs before opening the native
handle, then returns the reference-aware document wrapper:

```js
import { createAgentToolkit } from '@superdoc/sdk';
import { openReferenceDocument, createReferenceToolkit, createReferenceAgentAdapter }
  from './reference-integration/index.js';

// Requires @superdoc/sdk 2.26.0 or later. Preserve the app's provider.
const agentToolkit = await createAgentToolkit({ provider: 'openai', preset: 'full' });

// These values come from the target app's existing document lifecycle.
const document = await openReferenceDocument({
  client: sdkClient,
  toolkit: agentToolkit,
  id: documentId,
  filename,
  path: workingPath,
  collaboration,
});
const referenceToolkit = createReferenceToolkit(agentToolkit);
```

The import path above assumes the server source directory was brought into the app
as `./reference-integration`. No new SDK service, model client, chat UI, or HTTP API
is required. Keep one wrapper per active document, not per prompt/request.

If the app already owns an open native handle, it can construct the exported
`ReferenceDocument` with `{id, filename, path, handle, toolkit, importedCitations}`.
Capture `importedCitations` with `prepareReferenceDocument(workingPath)` at the app's
import boundary, before SDK import can discard opaque source metadata. When attaching
mid-session, use a current native export plus the app's preserved source metadata;
do not assume a stale original file represents subsequent source edits. Prefer wiring
at the existing import boundary when that preservation state is not yet available.

The wrapper owns its **disposable working files**: `replace()` removes the old file
and `close()` removes the current one and closes the handle. Never pass the customer's
only original DOCX. Await `document.waitForReferences()` before replacement/close.
The host still owns SDK client startup/disposal and collaboration configuration.

### 2. Prepare each prompt in the existing agent

```js
const adapter = await createReferenceAgentAdapter({
  document,
  toolkit: referenceToolkit,
  prompt,
  changeMode: isSuggesting ? 'tracked' : 'direct', // from trusted application state
});
```

The adapter does not call a model or own chat history. Bind its outputs to the existing
agent framework:

| Adapter output | Host wiring |
| --- | --- |
| `tools` | Register alongside the app's other tools. Includes the four Full preset tools plus `superdoc_stream_text` only. Map provider envelopes if needed; preserve schemas and validation. |
| `systemPrompt` | Append to the existing system instructions. Includes native toolkit guidance, reference instructions, and the request's mode policy. |
| `contextMessage` | Add to this request before the user's prompt. Contains the fresh source library, stable IDs, bibliography style, and revision. Treat metadata as data. |
| `initialToolChoice` | Optional provider-specific first-turn API-search selection for an explicit bibliography-creation request. Translate its function name into the framework's selection mechanism. |
| `execute(toolName, arguments)` | Route registered native/reference calls here; accepts a JSON argument string or object. Other application tools retain their existing dispatch. |
| `interruptionReport('turn_limit')` | Use when the host reaches its turn limit; reports actual completed work rather than intermediate model claims. |

For each native/reference tool call from the existing agent:

```js
const outcome = await adapter.execute(toolName, argumentsFromModel);
// Return outcome.result as the tool result using the existing framework.
// If outcome.stop is set, stop this run and show outcome.message.
```

`outcome` includes normalized `args`, `result`, `failed`, and optional `stop`/`message`.
An optional third argument `{onStarted(args) { ... }}` supports the host's tool-call UI.
Honor `stop`: repeated identical failures, even across inspections or revision changes,
return a receipt-based interruption message. Keep a host turn limit as well; the demo
uses 12. A success with `formattingWarning` has already applied the insertion and must
not be retried as though it failed. Reject cancelled runs in the host before dispatch.

Create a new adapter for every prompt so source context and receipt/retry state are
fresh. Enforce per-document job exclusivity through the app's existing coordination.
Mode enforcement starts inside `execute` and is enforced again at native dispatch,
overriding model-supplied modes for document edits. Source metadata CRUD is direct. Full API calls in Reviewing mode carry the SDK's tracked-mode enforcement through dispatch, including batches. Prose insertion and replacement still use the streaming tool; direct API calls cannot bypass that policy. If supplying a custom dispatch callback to execute, forward its third options argument to document.dispatch(tool, args, options). Incomplete API batches are failures, even when earlier entries succeeded.
Bibliography mutation requires direct mode; the SDK rejects it in Reviewing mode. The optional `editingModeHint` adapts
that error's UI guidance to the target application; never silently switch user mode.

`createReferenceAgent` is an optional example runner, not a requirement. It uses the
same `createReferenceAgentAdapter` internally. Integrate the adapter into the customer's
agent rather than replacing it with this demo's OpenAI chat-completions loop.

### 3. Keep targeting and receipt safeguards

The agent uses the SDK Full toolkit for citation and footnote insertion. For footnotes,
use `superdoc_perform_action` with `action: 'insert_footnote'` and inspected `anchorText`.
For citations, discover the native insertion schema with `superdoc_api_search`, then
call it with `superdoc_api_call`. Follow the SDK's targeting contract, inspect the
requested location, copy real source IDs, and verify the native result. The removed
custom insertion tools' semantic-anchor schemas and placement receipts do not apply
to these agent calls. SDK 2.29.0-next.14 marks citation insertion as direct-only: Reviewing
mode must refuse it. Footnote insertion supports tracked mode.

The reference library reads the authoritative native source list. Agents use native
`doc.citations.sources.*` operations through `superdoc_api_search` and
`superdoc_api_call`. The app's shared dispatcher enforces edit-mode and cited-source
deletion policies, serializes reference mutations, and refreshes formatted field
caches after updates/removals. These behaviors are not separate model tools.
Bibliography operations likewise use native `doc.citations.bibliography.*`; app-side
CSL formatting and complex-field normalization remain internal compatibility steps.

At open/import, `native/reference-sources.js` reconciles preserved Word sources into
the native catalog, preferring persisted IDs and using unambiguous metadata matches
for older documents. Missing sources are inserted through the native API. A persisted
Word-tag/native-ID mapping prevents duplicate imports and preserves distinct sources
with identical metadata. Original Word tags and opaque XML are retained for export;
only current native records supply the live list and supported field values. Source
type changes are unsupported by native update. Existing citation instructions are
mapped to native IDs while their displayed text and revision markup are preserved.

Creating references without insertion calls native `doc.citations.sources.insert` to save metadata,
without changing body text. Inserting citations then uses those returned source IDs.
Footnote text is exact; do not type manual superscripts, plain-text parenthetical
citations, or fake note sections as fallback behavior. Report native API failures.
The toolbar retains its selection-based snapshot insertion paths and their guards.

The wrapper serializes reference metadata mutations, performs native source CRUD, and checks revisions before compatibility snapshot replacement.
The final check/replacement is not atomic compare-and-swap; browser edits can race it.
Use the app's write coordination if preventing that race is required. The integration
does not supply a distributed lock or durable storage. The host authorizes document
identity and edit mode; model arguments must not choose filesystem paths or handles.

## Browser adapter for editing and review parity

Prompt-driven creation/insertion uses the server adapter above. To also reproduce the
demo's interactive deletion/review/typing fixes, use the source in
`client/src/reference-integration/`. React components accept a ready SuperDoc instance
and callbacks rather than demo room types or URLs. The app keeps its own toolbar,
citation modal/source panel, chat, spinners, and error display.

`ReferenceTransport` in `client/src/reference-integration/types.ts` requires:

- `getDocument(fieldCodes)`: the current exported collaborative DOCX as a Blob.
- `getRevision()`: the current server catalog revision string.
- `removeCitation(input)`: the server wrapper's snapshot deletion fallback.
- `removeEmptyBibliography(blockId, expectedRevision)`: guarded empty-field cleanup.

Implement these callbacks with the app's existing authorized document transport.
No dedicated citations backend is required; the existing server can call the wrapper.
The demo's `client/src/reference-transport.ts` shows this thin binding.

Mount `CitationDeletion`, `BibliographyDeletion`, `FootnoteReviewLabels`, and
`TrackedReplacementCaret` alongside the app's editor. Pass `getContainer` returning a
stable element containing editor input and the review rail, plus the app's edit mode
and busy/error callbacks. Do not copy demo CSS selectors. Give deletion components a
`documentKey` tied to identity/generation; reset/unmount all adapters when it changes.
Keep callbacks stable. The mode values are `editing`, `suggesting`, and `viewing`.

Optional UI helpers include `FootnoteNavigation`, `FootnoteHighlights`,
`CitationHighlights`, and native `citationTarget`. Geometry uses native selection and
`ui.viewport.getRect`; body-footnote positions use the export scanner workaround.
The plain `installTrackedReplacementCaretRepair` helper also supports non-React hosts;
call `cancel()` on document replacement and `destroy()` on disposal. Other React
adapters can be translated into host lifecycle hooks while retaining their guards.

For interactive endpoint/RPC bindings, use the wrapper's existing operations:

| Operation | Wrapper entry point |
| --- | --- |
| Read sources/current revision | `document.citationSources()` |
| Source CRUD | `document.manageReferences(referenceInput(args))` |
| Toolbar insertion at a native selection | `document.insertCitation(input)` / `document.insertFootnote(input)` |
| Citation deletion fallback | `document.removeCitation(input)` |
| Bibliography CRUD | `document.manageBibliographies(bibliographyInput(args))` |
| Style and field-code display | `document.setBibliographyStyle(style, revision)` / `document.setReferenceDisplay(fieldCodes, revision)` |
| Current DOCX export | `document.save(outputPath, {fieldCodes})`; return bytes, clean up the temporary export |

Empty bibliography cleanup adds `onlyIfEmpty: true` on the host after normalizing its
`delete` arguments; this guard is not an agent argument. Return `success`, `removed`,
and optional `caret`. Preserve document identity/generation checks and refuse conflicting
agent/reference work. Toolbar selections must retain story, coordinate space, and
UTF-16 offsets. Agent insertion follows the SDK Full toolkit targeting contract.

## Versions, assets, and verification

The demo follows the published Next channel for agent presence. Current pinned packages: server `@superdoc/sdk` 2.29.0-next.14; browser `superdoc` 2.32.0-next.14, React 19;
JSZip 3.10.1; citeproc 2.4.63; `@xmldom/xmldom` 0.9.12. Server modules are ESM and
require Node 22+; direct TypeScript tests use Node 24. The demo mounts its editor with
`@superdoc/react` 2.27.0-next.14; browser adapters require only the SuperDoc instance. Keep
`server/src/reference-integration/assets/csl/` and its attribution/license links with
the renderer. The [inventory](reference-integration.md) records each fix's reason and
removal condition. Revalidate fixes individually when changing SuperDoc versions.

From this demo:

```sh
LOG_SERVICES=none node --test server/src/agent.test.js \
  server/src/reference-anchor-contract.test.js server/src/reference-anchors.test.js \
  server/src/reference-tool-progress.test.js tests/footnote-review-labels.test.mjs \
  tests/tracked-replacement-caret.test.mjs tests/reference-integration-portability.test.mjs
LOG_SERVICES=none node --test server/src/citation-import.test.js
npm --prefix client run build
```

The checks use synthetic metadata, no model calls, and verify module boundaries,
adapter policy, exact placement, source preservation, and SDK round trips. In the target
app, verify through **its own prompt UI and agent loop**: create sources without insertion;
insert citations after named sections; add footnotes after exact phrases; preserve all
other body text; check both Reviewing and Editing; accept/reject native changes; verify
Word export and a second collaborator. If interactive fixes are mounted, also verify
final-character citation deletion, empty-bibliography cleanup, footnote body navigation,
and partial-word replacement after earlier tracked edits at slow and rapid typing rates.
Keep customer evidence outside source control.

For UI synchronization, subscribe to the host collaboration change stream and debounce native catalog reads. Metadata-only source edits may not emit editor text-transaction events. The demo exposes a room-scoped `/document-events` invalidation stream and reads the native API on each refresh. Unsubscribe and cancel pending refreshes on document changes/unmount. No second app-owned source store is needed.
