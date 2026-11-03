# Native agent and reference UI compatibility inventory

The agent uses the SDK full preset directly. It adds no custom Document API tools.
The citation, footnote, bibliography, semantic-anchor document agent contracts,
and streaming-text tool have been removed. The app-level `superdoc_references`
library tool remains, with fresh per-prompt source context and validated CRUD. Native actions remain available; the
host no longer filters them to force a custom streaming path.

## Verified SDK 2.25.0-next.16 boundary

| Previous wrapper responsibility | Native replacement / remaining boundary |
| --- | --- |
| Discover document operations and schemas | `superdoc_api_search`; no demo wrapper needed |
| Dispatch common edits and broader API operations | `superdoc_perform_action` and `superdoc_api_call`; native arguments and receipts |
| Footnote agent tool | Native `insert_footnote` helper or `doc.footnotes.insert`; direct insertion tested in a live room |
| App-level reference-source agent CRUD | Retained `superdoc_references`: metadata saves directly in both host modes, preserves imported sources and corporate authors, and uses the existing app persistence/rendering path |
| Citation agent insertion | Native `doc.citations.insert`; direct insertion succeeds, but default display can be a source-tag placeholder and tracked mode is not advertised |
| Bibliography agent insertion | Native `doc.citations.bibliography.insert`; direct insertion tested in a live room; strict Reviewing refuses this direct-only operation |
| Incremental prose writer | Removed; native SDK writes run after complete tool arguments; chat remains streamed |
| Reviewing policy | Native `enforceChangeMode: 'tracked'`; rejects direct-only operations, including an entire batch before writes when a member is disallowed |
| TOC creation/refresh | Operation discovery is available; native collaboration still rejects the mutation |

These checks establish API access and basic insertion, not equivalence for every
reference-editing edge case. Natural-language metadata requests also selected content-control operations rather than metadata.attach in browser checks; native catalogue access alone does not guarantee reliable model operation selection. An explicit doc.metadata.attach request succeeded through the same native full tools. In particular, native API availability does not replace
CSL formatting, source hydration, or tracked citation snapshot semantics.

## Retained manual UI/export repairs

| Area | Reason / removal condition |
| --- | --- |
| `reference-document.js` source reads | A new collaborating SDK session can report no citation sources while its DOCX export contains them. Read the current package for the UI. Recheck native cross-session source hydration before removing. |
| Current-source refresh before export | Native agent edits bypass manual UI methods. Read current sources before canonical export so the old import cache cannot erase native additions or resurrect removals. |
| `workarounds/citation-import.js` | Namespace-based Word source discovery and opaque source metadata preservation. Remove only after import/export fixtures preserve tags, corporate authors, editors, and unknown fields. |
| `workarounds/reference-rendering.js` and CSL assets | Manual APA/Chicago/MLA formatting, field-code display, and namespace preservation. Native agent insertions can initially show placeholders. |
| Citation, bibliography, and footnote snapshot helpers | Remain behind manual reference toolbar routes, including cursor-based placement, revision checks, deletion, and style switching. They are not agent dispatch fallbacks. |
| `workarounds/reference-anchors.js` and input validation | Optional exact placement and verification for manual snapshot operations; no semantic-anchor tool is advertised to the model. |
| Browser citation/bibliography deletion components | Remove exact native fields when deletion reaches the final visible character; preserve sources and surrounding text. |
| Browser tracked-replacement caret correction | Selection/caret compatibility for manual reviewing input; no text writer or model tool dependency. |
| Browser footnote navigation, highlights, review labels | Presentation/navigation around native notes. Preserve native author, decision, and identity fields. |

Reference mutations serialize within one service instance and use revision checks
before snapshot replacement. This is not an atomic compare-and-swap or distributed
lock. Changing a document during replacement requires host coordination.

## Verification

`server/src/agent.test.js` exercises native full-tool advertisement and dispatch,
strict mode and batch refusal, author argument propagation, obsolete Document API tool rejection and app-library CRUD in both modes, selection context, cancellation, chat streaming, and partial-failure
reporting. `server/src/citation-import.test.js` checks current source/export behavior
with real SDK documents. Placement and import helpers retain their focused tests.
`tests/reference-integration-portability.test.mjs` checks source boundaries, native
handle forwarding, and serialized manual reference mutations. Browser tests must
also inspect actual document content and exported Word structures.
