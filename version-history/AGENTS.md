# Version history demo: integration guide

This standalone React application records edits through the public Document API
`doc.changes` surface introduced in Orbit PR #5351. The live editor starts in
ordinary **editing** mode. Tracked changes are genuine suggestions, never hidden
audit markers. Saving must not accept, reject, or otherwise mutate the document.

## Ownership

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Compose live/history views, connection state, manual saving, and the shared version list. Keep the live editor mounted while showing history. |
| `src/DocumentEditor.tsx` | Own a SuperDoc instance, its native toolbar, document mode, collaboration readiness, and teardown. Reused for history. |
| `src/session.ts` | URL identity, room session acquisition, authenticated HTTP paths, and live/preview WebSocket URLs. |
| `src/change-records.ts` | Public Changes API structural contracts and a runtime capability check for older packages. No tracked-change fallback. |
| `src/change-recorder.ts` | Read paginated native records, persist them, and advance the session cursor only after successful storage. |
| `src/versioning.tsx` | Reusable versioning operations: capture a stable snapshot, render a read-only snapshot and changelog, resolve/highlight ranges with author bubbles, and group paragraph edits. |
| `src/useVersionHistory.ts` | Bind the recorder, coordinate saving and downloads, cache immutable previews, and poll shared metadata every five seconds. |
| `src/changes.ts` | Low-level record interpretation, text range mapping through subsequent edits/splits, and attribution formatting/sorting. |
| `src/HistoricalVersion.tsx` | Compose versioning operations inside an isolated custom UI provider and wire selected-entry navigation to the host layout. |
| `server/server.mjs` | Authenticated HTTP API, live Hocuspocus service, isolated read-only snapshot providers, and serialized filesystem writes. |
| `server/change-store.mjs` | Validate records/checkpoints and select a version's interval by Yjs transaction clocks. |
| `scripts/local-superdoc.config.mjs` | Build local-only browser/UI artifacts from an API-capable Orbit source checkout. Never publish these artifacts. |

## Record edits without changing editing semantics

The constructor uses `documentMode: 'editing'`, `role: 'editor'`, and
`user: session.user`, including its stable `id`. The native mode selector stays
available. Switching to suggesting creates real Word revisions. Export uses the
`review-preserving` policy to preserve those genuine suggestions.

The collector calls `changes.list({ after, limit: 200, includeUpdate: true,
waitMs: 0 })` and posts the results to our backend. Short browser polls avoid
leaving an API execution scope open across human input. Calls are serialized;
empty polls wait 500 ms. Never replace native author metadata with the user who
saves a version. Relayed records can contain multiple contributors.

The buffer is session-local and bounded. A `truncated` result marks a history gap
and prevents a save from claiming a complete interval. An absent actor identity
also fails explicitly. HTTP failures retain the cursor so retrying resends the
same deterministic record IDs. Stop polling and abort uploads on unmount.

This lightweight demo forwards records from connected editors. It is not an
always-on audit service: closing every editor before a pending record upload
finishes can lose that record, even if the room's Yjs state survives. Production
history that requires continuous coverage needs a read-only SDK observer session
that persists the Changes API stream independently of browser lifetimes.

## Capture a stable version

1. Flush native change records to the backend.
2. Call `changes.snapshot({ includeState: true })` for revision, cursor, full
   Yjs state, and state vector; export a review-preserving DOCX.
3. Flush again and read another checkpoint. Retry capture up to three times if
   either revision or state vector changed. Remote peers can edit while the
   local UI is locked; never assume a global lock.
4. Upload the DOCX and checkpoint together as multipart form data with a UUID
   `X-Version-Id` and the expected previous version ID.
5. The backend verifies the state's vector, checks the previous version ID
   within its room write queue, and stores immutable DOCX, Yjs, and record files.

Version records are those whose transaction clocks are contained by the saved
state vector and were not already contained by the preceding version's vector.
Do not use timestamps or session-local `seq` values to decide membership.
Incremental Yjs updates often start above clock zero; inspect their inserted
struct clock ranges, not `encodeStateVectorFromUpdate`, when checking coverage.

Concurrent saves from a stale version return 409 and refresh the list. A failed
upload leaves the document and recorded edits untouched. Saving never adds an
Undo entry. A successful save must not be reported as a failed upload merely
because a subsequent status read fails.

## Open history without changing the live room

Historical DOCX exports remain downloadable. New previews open the saved Yjs
checkpoint so native block IDs remain the same as the persisted change records.

A preview uses the **original document ID** and a WebSocket URL with
`?room=<room>&snapshot=<version>`. The server routes it to an independent
Hocuspocus instance loaded only from that checkpoint and enforces read-only
connections. Native shard identity includes the document ID; adding a version
suffix to that ID breaks package-part lookup. Never join a preview to the live
provider, persist preview writes, or replace the live room with historical data.

Each preview has its own `SuperDocUIProvider`. It uses public Document API node
reads and custom UI `viewport.getRect`, `viewport.observe`, and
`viewport.scrollIntoView`. No private editor state, guessed DOM offsets, or
tracked-change IDs are used for navigation. Highlights and author hover bubbles
are application overlays; genuine Word revisions remain separate. Hide overlays
and clear hover state during scrolling, then recalculate after scrolling stops.

After resolving individual ranges, group entries by their original paragraph,
story, actor ID and contributor set within that version. Never group by display
name or combine different authors. Merge adjacent/overlapping target ranges,
keeping disjoint spans separate. Use snapshot text for grouped excerpts and the
latest member timestamp for sorting. Preserve native records unchanged; grouping
is presentation only. Entries without a paragraph (such as sidecars) stay separate.

Text/format ranges are positions after their recorded transaction, not durable
character anchors. Carry them through later interval records. Splits can produce
multiple ranges; merges or overlapping edits may leave only paragraph context.
Validate ranges against the checkpoint's text and label broad fallbacks as
**Affected paragraph**. Fully removed content can have no remaining range.
Never highlight unrelated text while claiming an exact location. Structural or
sidecar changes without a supported text location remain readable list entries.

Older DOCX-only versions have no API records or Yjs checkpoint. Display that
limitation; do not infer authors from a snapshot diff or from its saver.

## Backend contracts

All application routes are under `/api/rooms/:room` and require a room bearer
token after session acquisition:

| Method/path | Purpose |
| --- | --- |
| `POST /session` | Acquire identity/token; reserve one creator, or wait with 202. |
| `POST /ready` | Publish the initialized live room after native collaboration readiness. |
| `POST /changes` | Durably deduplicate native records, including their transaction updates. |
| `GET /versions` | List immutable metadata, newest first. |
| `POST /versions` | Save multipart `document` and JSON `checkpoint` fields. Legacy raw-DOCX uploads remain readable. |
| `GET /versions/:id/file` | Download the immutable DOCX. |
| `GET /versions/:id/changes` | Read that version's immutable change interval. |

Stored room files are `room.json`, `room.yjs`, `changes.json`, `versions.json`,
and each version's `<uuid>.docx`, `<uuid>.yjs`, `<uuid>.changes.json`. The version
index is written last. This is a single-process JSON/filesystem demo, not a
multi-process transactional database. Keep a persistent volume for deployment.

Names in URL parameters are demo identities, not authentication. Native actor
claims are not verified here. Production applications must issue trusted
identities and verify claims themselves.

The existing Pages proxy forwards `/version-history/api/*` and
`/version-history/collaboration`, including snapshot query parameters, to
Railway. `demos.json` retains `hidden: true`; the route remains deployed.

## Dependency and verification

The demo pins the published prerelease `superdoc@2.30.0-next.4`, which includes
the Changes API. Normal development and CI must use the installed npm package;
a local Orbit build is optional when testing unpublished engine changes. The
runtime capability check fails clearly on older packages rather than recreating
hidden suggestions. Do not skip integration tests for an unsupported dependency.

Run `pnpm test:server`, `pnpm build`, and `pnpm test` with an API-capable build.
Tests cover real normal-mode typing, multi-author collaboration, immutable
read-only previews, interval boundaries, failed storage, concurrent edits,
range navigation/hover, cursor retries, retention gaps, and backend restart.
Use ignored `artifacts/`, `test-results/`, or `server/data/` for runtime output.
