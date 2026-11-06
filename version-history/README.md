# Version History

A React + SuperDoc demo with normal editing, explicit saved versions, and an
attributed changelog powered by the **Changes API**. Suggestions remain genuine
Word tracked changes; they are not used as hidden history markers.

The live document stays mounted when browsing history. Versions contain a DOCX,
a Yjs checkpoint from `changes.snapshot()`, and their own change-record interval.
Click an edit to navigate to its surviving range and hover a highlight to read
its author. The list supports newest, oldest, and author sorting.

## Run locally

The **Build this** buttons in the app and gallery both read `src/build-app.sh`.
That command clones the repository, uses pinned pnpm through `npx` to install
the frozen lockfile, and starts both services together. No API keys or hosted
services are required for local collaboration and saved versions.

Requires Node 22.12+ and pnpm. The demo pins the published prerelease
`superdoc@2.30.0-next.4`, which includes the Changes API. No local Orbit build
is needed. An older build without the API shows a capability error and disables saving.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Vite listens on port 5173 and proxies HTTP/WebSockets to the backend on 4191.
`?room=contract&user=Alice` selects a shared room and display name; missing values
become a UUID and an adjective–animal name. Open the same room in another browser
to collaborate. Saved versions refresh every five seconds.

### Optional: verify local Orbit changes

Normal development and CI use the published prerelease. To test unpublished
engine changes instead, use a clean Orbit checkout containing the API. Install its public and V2
workspaces with their frozen lockfiles. Set these absolute paths:

```sh
export SUPERDOC_LOCAL_SOURCE=/path/to/orbit/superdoc/public/packages/superdoc
export SUPERDOC_LOCAL_ES=/tmp/superdoc-changes-api-build
```

From that SuperDoc package directory, build its browser and custom UI entries:

```sh
pnpm exec vp build --config /path/to/demos/version-history/scripts/local-superdoc.config.mjs
```

Then run this demo's normal commands with those variables still exported. The
Vite config uses the local artifacts for `superdoc`, `superdoc/ui`,
`superdoc/ui/react`, and styles. The build helper keeps its output outside this
public repository and links its installed runtime dependencies. These source
artifacts are private, local-only verification output; never commit or deploy
them. Normal builds without the override use the installed npm package.

## Save and read history

Connected editors read `doc.changes.list({ includeUpdate: true })` and forward
records to the backend. A save drains that stream, captures a checkpoint and
DOCX at a stable revision, then uploads both. The backend selects records between
successive Yjs state vectors. It never accepts/rejects tracked changes or clears
the live history. Failed saves leave edits available for retry.

Record authors come from the native API, not the person saving. A relayed
transaction may list multiple contributors. A snapshot's creation time/saver
are separate server metadata. The backend still owns all durable storage.

The changelog groups a saved version's edits by paragraph and actor identity.
Adjacent or overlapping ranges share one highlight; disjoint ranges remain
separate. Each entry uses its latest edit timestamp for sorting. Raw API records
remain unchanged in storage, and different authors retain separate entries.

The API's record buffer is bounded. Missing records are surfaced as a gap;
saving cannot silently claim a complete interval. This lightweight demo uses
connected browsers as record collectors. An always-on production history needs
a read-only SDK observer so browser closure cannot interrupt recording.

Historical editors open isolated, server-enforced read-only checkpoint rooms.
They keep the original document identity and native block IDs. Highlights use
public custom UI viewport geometry, with paragraph context when a precise range
no longer survives. Removed blocks and some structural changes have no remaining
text location. Older DOCX-only versions are still readable but have no API log.

## Reuse the versioning operations

`src/versioning.tsx` exposes the versioning behavior separately from the app's
HTTP storage, room polling and layout:

| Export | Purpose |
| --- | --- |
| `captureSnapshot(editor, flush)` | Capture a stable DOCX and Yjs checkpoint after flushing records. |
| `SnapshotView` | Render a saved document through the supplied editor component with read-only mode enforced. |
| `Changelog` | Render grouped entries, sorting controls and selected-entry state. |
| `ChangeHighlights` | Draw range overlays and pointer-following author bubbles using custom UI viewport geometry. |
| `groupChanges(changes, textAt)` | Combine resolved edits by paragraph and author while preserving raw records. |

`resolveSnapshotChanges(api, records)` resolves and validates native record
locations in the saved document, then calls `groupChanges`. `HistoricalVersion`
composes these operations inside its own `SuperDocUIProvider` and handles entry
selection. Pass the existing `DocumentEditor` as `SnapshotView`'s `editor` prop;
this keeps capture/grouping independent of browser session initialization.
Keep the accompanying highlight/changelog styles from `src/styles.css`.

## Verify

```sh
pnpm test:server
pnpm test:dev # Same browser checks against the Vite development server
pnpm build
pnpm exec playwright install chromium
pnpm test
```

From the repository root, `node scripts/verify-build-this.mjs --demo version-history --run`
checks that both modals share the exact command, runs it in a clean clone of the
tested checkout, verifies collaboration and saving/reopening a version, and builds
the installed app. CI runs the same full-stack quickstart check.

Browser integration tests require an API-capable build and exercise the
`/version-history/` prefix. `VH_TEST_BACKEND_PORT` and `VH_TEST_FRONTEND_PORT`
override the isolated test ports. Test output and live room state are ignored.

## Gallery deployment

The route remains **https://demos.superdoc.dev/version-history/**, with its card
temporarily hidden through `demos.json`'s `hidden: true`. Frontend assets are on
Cloudflare Pages; the existing proxy forwards API and WebSocket requests,
including snapshot query parameters, to Railway.

Release builds use `BASE_PATH=/version-history/` and require
`VERSION_HISTORY_BACKEND_URL`. The Railway service uses a persistent volume at
`/data`; set `DATA_DIRECTORY` inside it. `VERSION_HISTORY_RAILWAY_SERVICE_ID` and
the existing Railway token select the backend. API-capable published dependency
versions are required before deploying this migration; local source artifacts
are not a release substitute.

See [AGENTS.md](AGENTS.md) for component boundaries, record/checkpoint contracts,
storage files, authentication assumptions, and integration details.
