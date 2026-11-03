# Version history demo: integration guide

This directory is a standalone React + SuperDoc application with a small Node
backend. Copy it independently of the surrounding demos gallery. The working
implementation is the reference; [README.md](README.md) covers local setup and
the public HTTP routes.

The main idea is to record native Word tracked changes while presenting an
ordinary editing experience. A user explicitly saves a DOCX version. Opening
that immutable file exposes its revisions as a changelog, with native highlights
and application-owned review UI.

## Ownership and component boundaries

| File | Responsibility |
| --- | --- |
| [src/main.tsx](src/main.tsx) | Mount the React application and import SuperDoc/application styles. |
| [src/App.tsx](src/App.tsx) | Compose the workspace, show connection/save state, select versions, and keep the live editor mounted while previewing history. |
| [src/DocumentEditor.tsx](src/DocumentEditor.tsx) | Own one SuperDoc instance, its native toolbar, document mode, collaboration configuration, readiness, and destruction. Reused for live and historical documents. |
| [src/session.ts](src/session.ts) | Resolve URL identity, acquire a room session, and provide HTTP paths, bearer headers, response checking, and the WebSocket URL. |
| [src/useVersionHistory.ts](src/useVersionHistory.ts) | Own HTTP version-list polling, manual export/upload, download caching, save state, and stale-response protection. |
| [src/HistoricalVersion.tsx](src/HistoricalVersion.tsx) | Bind the historical editor to its own SuperDoc custom UI provider, portal the changelog into the sidebar, and implement author hover bubbles. |
| [src/ChangesPanel.tsx](src/ChangesPanel.tsx) | Read the selected snapshot's revisions through Document API; use custom UI readiness, active state, and navigation. |
| [src/changes.ts](src/changes.ts) | Format revision text, authors, dates, occurrence keys, and sorting. Contains no storage or editor lifecycle logic. |
| [server/server.mjs](server/server.mjs) | Serve HTTP API/static assets, attach Hocuspocus WebSockets, coordinate room initialization, and persist room state and immutable versions. |
| [vite.config.ts](vite.config.ts) | Proxy `/api` and `/collaboration` during development and preview. |

The HTTP API and WebSocket service are logically separate but currently live in
the same backend file and listen on the same HTTP server. There is no separate
backend changelog processor: revision extraction happens in the browser after
opening a saved DOCX.

```text
Live SuperDoc <---- WebSocket /collaboration ----> Hocuspocus <--> room.yjs
      |
      | explicit Save version: export DOCX
      v
useVersionHistory ---- POST versions -----------> DOCX file + versions.json
      |
      +--------------- GET versions every 5s ----> shared version metadata
      |
      +--------------- GET selected file --------> immutable DOCX
                              |
                              v
                   Historical DocumentEditor
                              |
                    Document API revision list
                              |
                  custom UI changelog + navigation + hover
```

## Hidden tracked changes are the changelog source

The application labels the live experience **Editing**, but the underlying
SuperDoc configuration in `DocumentEditor` is:

```ts
documentMode: 'suggesting',
role: 'suggester',
trackChanges: { enabled: false },
interaction: { trackedChanges: { allowDecisions: false } },
```

`trackChanges.enabled: false` disables revision decorations; it does **not**
disable recording in suggesting mode. Supported edits still become revisions
with their native author, date, and change type. Do not change the underlying
mode to `editing`: that would make new edits direct and remove them from this
revision-based changelog.

The native toolbar excludes `document-mode`, `track-changes-accept-selection`,
and `track-changes-reject-selection`. Built-in comments and the context menu
are disabled. Keep review decisions disabled so a user cannot erase changelog
entries by accepting/rejecting them through this demo's UI.

This implementation does not observe raw keypresses, use extension mutation
events as an audit stream, or attach custom metadata to every typed character.
SuperDoc owns recording and range identity. Adjacent typing can merge into one
revision, and undo can remove a revision. The changelog is the set of pending
revisions contained in a snapshot, not a permanent per-keystroke audit log or a
diff against the previous version.

The browser session's `user` config supplies edit author identity. A version's
server-stamped `createdBy` identifies the person saving the snapshot; that file
can contain revisions from several authors. Never attribute every edit in a
snapshot to its saver.

## Explicit saving and shared version metadata

`useVersionHistory.save()` performs a revision-preserving export:

```ts
await superdoc.export({
  exportType: ['docx'],
  triggerDownload: false,
  policies: { trackedChanges: 'review-preserving' },
});
```

It uploads the bytes with `POST /api/rooms/:room/versions`. The backend assigns
the version number, creation timestamp, and saving user. `X-Version-Id` is a
caller-generated UUID; repeating the same ID for the same user returns the
existing version instead of overwriting its file. A new explicit save uses a
new ID. Do not export with `final` or `original` policies: those resolve pending
revisions and remove the information needed by the changelog.

Saving is manual, including the first version. Typing, mounting, and browsing
history must not create snapshots. The app disables local editor input and
version navigation during export/upload and coalesces in-flight save calls.
This only locks this browser's UI; it is not a distributed lock on other editors.
A snapshot contains the state available to the exporting editor, rather than
an atomic global checkpoint of every client's outstanding work.

Version metadata is fetched immediately and every 5 seconds, with overlapping
polls suppressed. A response-generation counter prevents an older request from
replacing a newer result. After a successful upload the saving browser inserts
the returned version immediately and refreshes the list. Other browsers receive
it through polling. Poll failures retain the previous list and retry later.

Files download on selection and are cached by immutable version ID. Polling
must never replace the live editor, remount a selected historical file, reset
its scroll position, or discard unsaved live edits.

## Reading revisions and rendering historical UI

A saved file opens through the same `DocumentEditor` with:

```ts
documentMode: 'viewing',
role: 'viewer',
trackChanges: { enabled: true },
viewing: { trackedChanges: 'markup' },
```

Do not pass a collaboration session to a historical editor. It must open the
saved file locally, without joining or replacing the current shared room.
`viewing.trackedChanges: 'markup'` matters: the default original projection can
hide inserted text even though its revision was preserved in the DOCX.

`HistoricalVersion` wraps each historical editor and its UI in a dedicated
`SuperDocUIProvider`. Bind the ready instance with `useSetSuperDoc`. The live
editor remains mounted independently; it must not overwrite the preview's
controller binding. The changelog is portaled into the sidebar so it shares
this provider with the document even though it renders elsewhere in the DOM.

`ChangesPanel` uses `useSuperDocDocumentApi()` to call:

```ts
await api.trackChanges.list({ in: 'all', limit: 200, offset });
```

Read every page until `total` is covered. `in: 'all'` includes revision-capable
stories beyond the main body. Read from the reopened historical document, not
the live editor's changing catalog. Await browser Document API calls and ignore
results after the owning preview unmounts.

The custom UI library handles the connection between list and document:

- `useSuperDocTrackChanges()` observes readiness and active-change state. Gate
  navigation on `listStatus === 'ready'`.
- `useSuperDocUI().trackChanges.setActive({ id, story })` focuses a list entry.
- `ui.trackChanges.scrollTo({ id, story })` navigates to its native range,
  including content outside the currently painted page window.
- `ui.trackChanges.getAt({ x, y })` resolves the revision beneath the pointer.
  `ChangeHover` displays its author/date in a fixed bubble, updates through
  `requestAnimationFrame`, and clears on scroll, pointer leave, and teardown.

Keep IDs and stories from the public API. Do not reconstruct revision targets
from DOM attributes, character positions guessed from rendered text, or CSS
selectors. Use ID plus story for row identity. Historical highlights are
SuperDoc's native revision markup; this app does not paint a separate diff.

Sorting is application-owned: newest first, oldest first, or author A–Z.
Unknown timestamps sort last. Display native revision metadata and explicit
unknown values rather than inventing dates or authors.

## HTTP, WebSocket, and storage contracts

The application HTTP API lives under `/api/rooms/:room`:

| Method | Path suffix | Purpose |
| --- | --- | --- |
| POST | `/session` | Accept client ID/display name; return token, user, document ID, and create/join mode. Return 202 while another editor initializes. |
| POST | `/ready` | Publish an initialized room after persisting its Yjs state. |
| GET | `/versions` | Return version metadata, newest first. |
| POST | `/versions` | Append an immutable DOCX version from request-body bytes. |
| GET | `/versions/:id/file` | Download a saved DOCX. |

Subsequent API requests carry the room session's bearer token. Hocuspocus
receives that same token through `document.collaboration.token`, rather than
through the HTTP API helper. Its WebSocket endpoint is `/collaboration`.

SuperDoc owns its browser Y.Doc/provider. Configure collaboration on the
document source, with `providerType: 'hocuspocus'`, session `documentId`, token,
server URL, and `roomMode`. Do not introduce v1 `modules.collaboration` or pass
an independently created Y.Doc into the browser editor.

The server currently maps the logical room to `version-history-${roomId}` and
recognizes native Hocuspocus names shaped as `sd2/v.../version-history-${roomId}`.
If changing naming or upgrading protocol behavior, update both sides together.

Exactly one client ID reserves initialization. Other clients wait. The creator
waits for both editor readiness and native collaboration readiness before
calling `/ready`; the server persists Yjs state and the ready marker before
publishing the room. Never make all visitors attempt `create`, treat a failed
join as permission to overwrite a room, or silently recover a partially seeded
room by importing an older DOCX. Startup deliberately leaves an interrupted
first initialization unpublished.

Default storage is ignored `server/data/<room>/`:

```text
room.json       room publication marker
room.yjs        live collaborative state, loaded/stored by Hocuspocus hooks
versions.json   immutable-version metadata and server-assigned ordering
<uuid>.docx     exported historical snapshots
```

Per-room write queues and temporary-file renames serialize writes in this
single server process. This is not a multi-process database or a transaction
spanning the room and all version files. DOCX history and live Yjs state serve
different purposes; restoring a DOCX is not equivalent to restoring a live
collaboration room.

Session tokens and initializer reservations are in memory. Room state and
versions persist to disk. After a backend restart, reload clients to obtain
fresh tokens. Names in URL parameters are demo identities, not authentication;
replace session issuance with your application's trusted identity before using
this as an authenticated product.

## Copying this into another application

1. Start with this package's source, sample `public/document.docx`, package
   manifest/lockfile, and SuperDoc stylesheet import. The gallery, other demos,
   and repository deployment scripts are not required.
2. Keep the SuperDoc/browser/provider/server versions compatible. Check this
   package's actual pins before using examples from another SuperDoc release.
3. Reuse `DocumentEditor` and the historical custom UI components. Replace
   `App.tsx` and `styles.css` with your application's shell as needed.
4. Adapt `session.ts` for your room routing and identity. Missing `room` and
   `user` parameters currently become a UUID and adjective–animal display name,
   written into the URL with `replaceState`. Preserve room identity on reload.
5. Adapt `useVersionHistory` to your version endpoints. Preserve immutable IDs,
   complete DOCX bytes, manual saves, pagination, five-second polling, and
   stale-response protection.
6. Keep or replace the backend HTTP/storage functions separately from the
   Hocuspocus transport. An existing collaboration service can replace the
   WebSocket layer without moving snapshot extraction into the server.
7. When splitting origins, adapt HTTP URLs, WebSocket URLs, authentication, and
   origin handling together. The demo assumes one browser origin; Vite proxies
   both API and WebSocket traffic to the backend.

## Run and verify

From this directory:

```sh
pnpm install --frozen-lockfile
pnpm dev          # Vite :5173 plus backend :4191
pnpm build       # TypeScript + production frontend
pnpm start       # Built frontend, API, and WebSockets on :4191
pnpm test:server # Backend API, concurrency, and persistence checks
pnpm test        # Browser integration checks
```

Backend environment variables: `PORT`, `HOST`, `DATA_DIRECTORY`.
Vite proxy override: `BACKEND_URL`. See `playwright.config.ts` for the isolated
test ports and storage paths.

For behavior changes, run the relevant tests. Backend coverage lives in
`server/server.test.mjs`; browser coverage in `tests/` exercises manual saving,
read-only previews, hidden revisions, sorting, pointer navigation/hover,
pagination past 200 changes, and two-editor collaboration with polled history.
Check that source edits remain attributed to their original authors and that
viewing an old snapshot never modifies or replaces the current room.

Keep generated documents, live room state, screenshots, and test output in the
ignored `server/data/`, `artifacts/`, or test-output directories. Commit the
sample fixture and test source, not runtime room data or credentials.
