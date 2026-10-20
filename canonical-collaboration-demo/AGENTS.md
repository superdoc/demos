# Integrate citations and footnotes into an existing app

The intended outcome is for a user to prompt **their own app's existing agent** to
create reference sources and reliably insert real Word citations and footnotes.
Use the maintained source in this repository. There is no generated bundle or
separately maintained customer implementation.

Start with [the integration guide](docs/customer-integration.md) and consult the
[workaround inventory](docs/reference-integration.md) for specific fixes.

## Integration workflow

1. Inspect the target app's SuperDoc versions, SDK document lifecycle, collaboration
   connection, agent tool registry/dispatch, host edit mode, and document authorization.
   Keep its agent framework, model provider, prompt UI, and document identity.
2. Reuse `server/src/reference-integration/`. Its three functional parts must stay
   connected: native SDK operations, custom tool contracts, and compatibility fixes.
   The native APIs alone do not reproduce this demo's behavior. Retain the supporting
   agent policy and CSL assets; do not reimplement snapshot edits in the target app.
3. Wrap the app's SDK document with `ReferenceDocument`. For new document sessions,
   `openReferenceDocument` accepts the app's existing SDK client/core toolkit and
   collaboration configuration. See the guide for already-open handles. Use one
   wrapper per document, on disposable working files; it removes old working files
   during replacement/close. The host owns the SDK client and lifecycle.
4. Register `createReferenceToolkit(coreToolkit)` with the existing agent. Before each
   prompt, call `createReferenceAgentAdapter` with that toolkit, document, prompt, and
   trusted host change mode. Add its system instructions and fresh source context to
   the app's existing messages. Route SDK/reference calls through `adapter.execute`;
   other application tools keep their existing dispatch. Honor `stop` and its receipt-
   based message, and use `interruptionReport` on turn exhaustion. The guide shows the
   exact adapter contract; copying our OpenAI runner or room server is unnecessary.
5. Mount browser fixes from `client/src/reference-integration/` when the app supports
   interactive editing/review. Bind its `ReferenceTransport` to the existing app's
   authenticated document transport, and supply `getContainer` for its editor/input/
   review container. Reset state on document identity/generation changes. Toolbar,
   modal, chat, and panel designs belong to the target app.
6. Verify the target app with the guide's acceptance scenarios. Check saved sources,
   exact anchor placement, tracked changes, unchanged body text, and Word export;
   a successful model answer alone is not evidence of successful insertion.

## Preserve these boundaries and safeguards

- Native session entry: `server/src/reference-integration/native/`; custom tools:
  `server/src/reference-integration/tools/`; compatibility repairs:
  `server/src/reference-integration/workarounds/`; agent context, policy, and retry
  handling: `server/src/reference-integration/agent/`. The wrapper joins these layers.
- Keep `server/src/reference-integration/assets/csl/` and its attribution/license
  links alongside the renderer. Use the owning app's dependency manifests; the guide
  records the validated SDK/browser/dependency versions.
- Agent insertion uses semantic anchors, never LLM-counted offsets. Preserve strict
  schemas, exact source IDs, fresh revisions, host-enforced tracked/direct modes,
  verification receipts, no-duplicate handling, and bounded retries. Metadata creation
  is distinct from inserting a citation. Do not substitute imitation citations/notes.
- Await reference work before replacing/closing a document. The revision check and
  snapshot replacement are not atomic compare-and-swap; the host must coordinate
  concurrent writers if it needs to exclude that race. Do not claim a distributed lock.
- Browser integration must not import demo room types, API clients, CSS shell selectors,
  model keys, or configuration. The thin demo adapters live outside the shared folders.
- After upgrading SuperDoc, verify each fix against its inventory removal condition.
  Keep customer documents, exports, traces, and credentials in ignored `artifacts/`.
  Local load-testing files/edits remain unrelated and must stay out of commits/deploys.

## Verification

Use the commands in the integration guide. The portability test checks source module
boundaries, native dispatch, mutation serialization, and the shared adapter contract.
Changes to the adapter must also pass `server/src/agent.test.js`: the demo's runner
uses the same policy code as a customer's existing loop.
