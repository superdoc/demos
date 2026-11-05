# Version history

A React demo with hidden tracked edits, Hocuspocus collaboration, and shared DOCX version history. Requires Node.js 22 and pnpm.

```sh
pnpm install
pnpm dev
```

This starts Vite on port 5173 and the Node/Hocuspocus backend on port 4191. Open two tabs with the same room and different display names:

- `http://localhost:5173/?room=contract&user=Alice`
- `http://localhost:5173/?room=contract&user=Bob`

Omitting or leaving `room` empty generates a new room UUID and inserts it into the URL. Omitting or leaving `user` empty generates an adjective–animal name, such as `Curious Otter`, and inserts it too. Existing values, other query parameters, and the URL fragment are retained. The URL is updated without reloading or adding a browser-history entry, so refreshes retain the generated room and name. Share the `room` value to collaborate; remove or change `user` for another editor. A per-tab session ID supplies the revision author identity. Query-string names are demo identity, not a login system.

The backend reserves one room initializer. Other visitors wait until that editor's native collaboration-ready signal and server persistence complete, then join the same room. The live editor remains connected while viewing historical snapshots. Saved snapshots open locally without attaching to collaboration.

The server keeps live Yjs state, immutable DOCX files, version metadata, and the room-ready marker under ignored `server/data/`. Closing all tabs or restarting the backend retains them. Reload clients after a backend restart to obtain fresh room session tokens. An interrupted first initialization is left unpublished rather than automatically overwriting a partial room.

The live document is presented as **Editing**, with native `documentMode: 'suggesting'`, `role: 'editor'`, and `trackChanges: { enabled: false }`. This records supported edits as Word revisions without painting revision decorations or showing suggestion bubbles. The editor role permits automatic post-save acceptance through Document API; the mode selector and manual review decisions remain disabled. Adjacent edits may be grouped into one revision by SuperDoc.

Choose **Save version** inside the Current version card to export a complete DOCX snapshot with `superdoc.export({ exportType: ['docx'], triggerDownload: false, policies: { trackedChanges: 'review-preserving' } })` and upload it to the server. Only after the server confirms storage does the app accept the captured tracked changes in the live document, through Document API. The immutable snapshot retains its original revisions and author metadata; the live acceptance syncs to collaborators. Following saves contain the revisions recorded since that reset, with earlier accepted text still present as ordinary document content. Typing, deletion, paste, undo, formatting, document loading, and navigation do not create versions. Concurrent saves receive unique, sequential version numbers, timestamps, and saving-user metadata from the backend.

A failed export/upload never accepts live changes. Capture reads the document revision before export. Cleanup reads the complete revision catalog, then accepts its IDs in one `trackChanges.decide` call guarded by that captured revision. If another user changes the document during export/upload or cleanup, the app reports that the snapshot was saved and retains the live revisions rather than accepting unsaved edits. Those revisions can overlap the previous snapshot until the next successful reset. Other cleanup failures offer **Retry resetting edit history**, which retries the guarded acceptance without uploading another snapshot. Acceptance is a native undoable operation; undoing it can restore revisions from an earlier interval.

The native SuperDoc toolbar supplies formatting, zoom, search, and undo/redo. Each editor mounts its own toolbar; switching versions shows only the selected editor’s controls.

Select a timestamp on the right to mount that snapshot in the same `DocumentEditor` component with `documentMode: 'viewing'`, `role: 'viewer'`, and `viewing: { trackedChanges: 'markup' }`. This displays suggested insertions and deletions without allowing edits or review decisions. Select **Current version** to resume editing. The live editor stays mounted while hidden, preserving unsaved work, selection, and undo history. Unsaved edits remain in the live editor when browsing history. During an explicit save, editor input and version navigation stay disabled through export, upload, and acceptance; repeated clicks cannot create overlapping saves.

The historical editor has its own `SuperDocUIProvider`. Its edit panel uses the browser Document API (`trackChanges.list({ in: 'all', limit, offset })`) to read every revision from the reopened snapshot. For sequential successful saves, this lists only the latest edit interval. It does not compute a text diff between snapshots. Sort by newest timestamp, oldest timestamp, or author; unknown timestamps sort last. Native revision author and timestamp metadata are displayed without inventing missing values.

The custom UI track-changes observer supplies readiness and active state. Clicking an edit calls `ui.trackChanges.setActive()` and `scrollTo()` with its ID and story. Pointer movement resolves changes through `ui.trackChanges.getAt()` and renders a following author/date bubble. IDs are never reconstructed from DOM attributes. Switching versions unmounts the historical UI, cancels stale catalog requests, and removes its hover listeners.

The client fetches the shared version list immediately and polls it every **5 seconds**, including while viewing a historical snapshot. A successful save appears immediately for the saving editor and on the next poll for other editors. Polling updates the list without replacing the live editor or selected snapshot. DOCX files download only when selected, with a per-tab cache. Failed refreshes report an error and retry on the next poll; an older polling response cannot replace a newer save response.

The API uses a session bearer token scoped to one room:

| Method | Route | Behavior |
| --- | --- | --- |
| POST | `/api/rooms/:room/session` | Reserve initialization or join a ready room; returns 202 while another editor initializes. |
| POST | `/api/rooms/:room/ready` | Persist the initializer's Yjs room before admitting joiners. |
| GET | `/api/rooms/:room/versions` | Return newest-first version metadata. |
| POST | `/api/rooms/:room/versions` | Save DOCX bytes; `X-Version-Id` provides an idempotent UUID. |
| GET | `/api/rooms/:room/versions/:id/file` | Download the immutable DOCX. |
| GET | `/api/health` | Backend health check. |

Hocuspocus WebSockets attach at `/collaboration`. Vite proxies both that path and `/api` to `http://127.0.0.1:4191`; `BACKEND_URL` overrides the development/preview proxy target. `PORT`, `HOST`, and `DATA_DIRECTORY` configure the backend. This is a single-server demo with file storage and anonymous room sessions; version restoration and comparison are not implemented.

```sh
pnpm build
pnpm start
pnpm test:server
pnpm test
```

`pnpm start` serves the built frontend, API and WebSockets from one origin on port 4191. Browser tests run an isolated backend and frontend on ports 4193/4194 with generated rooms and data under ignored `artifacts/`.

## Gallery deployment

The demo remains in `demos.json`, with `hidden: true` temporarily hiding its homepage card. Set `hidden` to `false` to show its screenshot and hover video again. The release bundle publishes it at **https://demos.superdoc.dev/version-history/**. The production build uses `BASE_PATH=/version-history/`. API and collaboration URLs resolve relative to that application path, so requests stay on the gallery origin:

- `/version-history/api/*` forwards to the backend's `/api/*`.
- `/version-history/collaboration` forwards WebSocket upgrades to `/collaboration`.

`scripts/assemble-release.mjs` copies the frontend and emits a Cloudflare Pages `_worker.js` proxy plus `_routes.json`. Only the API and collaboration routes invoke the Worker; the homepage and frontend assets remain static. The backend origin is baked into the release bundle from `VERSION_HISTORY_BACKEND_URL`; it is public configuration, not a credential. The proxy forwards room tokens and DOCX bodies without enabling cross-origin browser access.

Before the first live release:

1. Create a dedicated Railway service in the project accessible to the existing GitHub `RAILWAY_TOKEN`. Deployments upload `version-history/` as the service root and use its `Dockerfile` and `railway.json`. Keep a single replica.
2. Attach a persistent Railway volume at `/data`. The Docker image sets `DATA_DIRECTORY=/data` and listens on `0.0.0.0` using Railway's `PORT`. Startup refuses Railway deployments whose data directory is outside the attached volume. Give the service a public HTTPS domain and use `/api/health` for its health check.
3. Set the GitHub repository **variable** `VERSION_HISTORY_BACKEND_URL` to that HTTPS origin, without a path or query. Set the repository **secret** `VERSION_HISTORY_RAILWAY_SERVICE_ID` to the new service ID. The existing `RAILWAY_TOKEN` must have access to this service.

The deployment workflow checks those settings before a live release, deploys the backend, verifies health, and then publishes the Pages bundle. It verifies the public frontend and API route after production deployment. Staging Pages releases use the same configured backend; use a different room query parameter to isolate documents. Dry runs can build with a reserved `.invalid` placeholder when the backend URL has not been configured; they do not deploy services or create storage.

CI runs the backend and browser integration tests. The browser suite builds and serves the app under `/version-history/`, including two-editor collaboration and version saving, rather than only testing the root path. Release automation also tests proxy forwarding, WebSocket upgrade handling, and gallery asset preservation. Automated SuperDoc dependency updates include this demo's manifest and lockfile.
