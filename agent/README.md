# Demo agent: implementation and maintenance guide

This directory owns the server for the gallery's demo agent. Its browser UI
lives in `../dist-landing/agent/`. Read this guide before modifying or rebuilding
the feature. The repository root README describes the broader demo gallery.

## Purpose and current scope

The agent helps a gallery visitor find a relevant existing SuperDoc demo, then
offers to generate a small runnable browser demo if the catalog has no close
match. Visitors can request follow-up fixes or changes on the generated demo's
page and download the current source as a ZIP.

This is a constrained example builder. It generates JavaScript, CSS, and useful
handoff guidance around a host-owned real SuperDoc editor. It does not execute
generated server code, install arbitrary dependencies, run generated tool calls,
or implement additional AI/backend services for the resulting demo.

## Source map

All paths below are relative to the repository root.

| File | Responsibility |
| --- | --- |
| `agent/service.mjs` | Catalog context, OpenAI requests and schemas, token ledger, build/revision lifecycle, project storage, limits, HTTP routes, expiry, CSP |
| `agent/project.mjs` | Pinned SuperDoc version, generated-source validation, sample DOCX, preview/standalone HTML scaffold, ZIP file inventory and agent handoff text |
| `agent/zip.mjs` | ZIP generation used for the DOCX and downloadable project |
| `agent/server.mjs` | Standalone Node HTTP entry point and public UI/branding assets |
| `agent/Dockerfile` | Standalone service image, built with the repository root as context |
| `dist-landing/agent/gallery.js` | Gallery search form, catalog results, explicit build offer and new-tab flow |
| `dist-landing/agent/project.html` | Trusted temporary-project shell, branding, title/summary, follow-up form, preview iframe and guidance |
| `dist-landing/agent/project.js` | Status polling, version switching, follow-up submission, downloads, expiry presentation and recovery |
| `dist-landing/agent/agent.css` | Gallery search styles and temporary-project shell styles |
| `dist-landing/superdoc-logo.png` | Shared gallery logo; reused at the far left of the project header |
| `demos.json` | Existing-demo search catalog; entries marked `hidden` are excluded |
| `scripts/serve-gallery.mjs` | Local gallery server; delegates `/agent/` requests to the service |
| `scripts/demo-agent-proxy.mjs` | Cloudflare Pages forwarding of API/project routes to the standalone service |
| `scripts/build-gallery.mjs` | Builds the local gallery and copies browser assets into ignored `dist-gallery/` |
| `scripts/assemble-release.mjs` | Copies `dist-landing/` assets into the production release |
| `scripts/version-history-release.mjs` | Integrates agent forwarding with the existing Pages Worker |
| `scripts/demo-agent.test.mjs` | Offline HTTP, generation, revision, persistence, expiry, budget and proxy integration checks |

`dist-landing/agent/` is source despite its directory name. Edit it directly.
`dist-gallery/` and `dist/` are build output. Copy/rebuild them from source;
editing only their copies does not change the next release.

## Request and generation flow

1. The gallery sends `POST /agent/api/search` with `{ "prompt": "..." }`.
2. The service supplies visible catalog entries and bounded README context to
   one OpenAI Responses API request. It filters returned IDs against the real
   catalog, deduplicates results, and returns at most three matches.
3. When there are no matches, the service issues a random, session-bound,
   single-use build offer valid for ten minutes. Search never starts a build.
4. The visitor explicitly clicks **Build this demo**. The browser opens a blank
   tab during the click, removes its opener, and posts the offer to
   `/agent/api/projects`. The service consumes the offer and reserves a build
   slot synchronously before persistence or generation can yield.
5. The new tab loads `/agent/projects/:id/` and polls its status every two
   seconds while it is building. The service makes one generation request.
6. Valid output becomes a ready project and starts that version's one-hour
   lifetime. The trusted shell loads the sandboxed preview and enables source
   download and the follow-up form. Failed output becomes a failed project with
   a public error. There is no automatic retry or model-driven tool loop.

## Follow-up requests and recovery

The project page's **Continue building** form sends a bounded prompt to
`POST /agent/api/projects/:id/revisions`.

The server reads the existing project from its own storage. The browser cannot
submit replacement source, select a model, or change generation settings. The
generation input contains the original request, up to six recent follow-up
requests, the previous ready project's complete JavaScript/CSS and metadata,
and any previous build failure. Failed initial generations can be retried with
a corrective prompt even though they have no runnable source.

Every follow-up creates a new project ID. It never mutates the original
project, its source, or its expiration. The page leaves the current iframe and
download available while polling the new version. On success it switches the
preview, download, title, summary and browser URL together. On failure it keeps
the previous version and the entered prompt, shows the error, and allows another
explicit request within the same limits. A page refresh during a follow-up
returns to the previous URL; it does not initiate another generation.

Initial builds and revisions share the per-IP generation rate limit, concurrent
slots, active-project cap, and daily token ledger. Each successful new version
gets its own one-hour lifetime; refreshing a version never extends it. Older
versions count toward capacity until their original expiry.

The generated-demo page is private by possession of its random 128-bit URL, not
by an authenticated account. Anyone with that URL can view, download, or request
a new revision. Revisions fork into new IDs rather than changing another
visitor's existing project. Do not treat these URLs as confidential-document
storage or add private user uploads without designing access control first.

## Browser UI contract

- The far-left header link uses the shared SuperDoc logo and blue brand text.
  The temporary ID badge and primary download button use `#1355ff`.
- No countdown appears. Expiration is still enforced by the server and an
  internal client timeout removes an expired preview/download.
- Title and description appear once in the trusted outer shell. The iframe
  starts with the demo's controls/status/editor, without repeated headings.
  Downloaded standalone HTML retains its own title and introduction.
- The follow-up form is available after either a successful or failed build.
  While a request is pending, it prevents duplicate submissions and announces
  progress through an accessible status region.
- Refining regenerates the example's code and starts a fresh editor/sample
  document. It does not preserve unsaved document edits inside the old iframe.
- The trusted shell uses `textContent` for generated titles, descriptions,
  guidance and errors. Generated content must not become shell HTML.

## Model contract and SuperDoc integration

The default model is `gpt-5-mini`, with `reasoning.effort = medium` and
`store = false`. `completion()` in `service.mjs` owns the Responses API envelope
and strict JSON schemas. Search returns `{ message, matches: [{ id, reason }] }`.
Generation returns nonempty strings for `title`, `summary`, `javascript`, `css`
and `guidance`.

`project.mjs` pins SuperDoc in `SUPERDOC_VERSION`. Both preview and standalone
output load that version's official jsDelivr JavaScript and CSS. The host owns
the toolbar, editor, sample document, controls, output and status nodes. Model
output exports one function:

```js
export async function setupDemo({ superdoc, controls, output, status, readText }) {
  const text = await readText();
  output.textContent = text;
}
```

`readText()` delegates to `superdoc.activeEditor.doc.getText({})`. Browser
Document API calls are asynchronous: await them. This host uses SuperDoc V2;
legacy TipTap `editor.state`, `view`, `commands`, `chain`, `on`, `getText` and
`getHTML` are not the supported surface. Read the current generator instructions
for the exact verified examples supplied to the model. Re-query text targets
after a mutation instead of reusing stale target addresses.

For new operations, verify the API against the pinned package and official
SuperDoc docs before adding examples to the instructions. Unknown operations
should result in a smaller working example and explicit handoff guidance.
Do not fake server features or replace SuperDoc with a mock editor.

`validateProject()` checks metadata/code lengths, requires the named export,
and parses JavaScript syntax with Node's `vm.Script` without executing it.
Parsing is not a security audit, API validation, or browser behavior test.

## Download format

`projectFiles()` produces `index.html`, `app.js`, `app.css`, `base.css`,
`sample.docx`, `package.json`, `README.md`, `AGENTS.md` and `.gitignore`.

The download uses Vite for local development and builds. README/AGENTS include
the original request, retained follow-up requests, version pin, entry-point
contract, limitations and next steps. It needs no API key to run. When changing
the host contract, update both generated documents along with the scaffold and
generator instructions.

## HTTP routes

| Method and path | Input / response |
| --- | --- |
| `GET /agent/api/health` | Configuration boolean and public limits; no credentials |
| `POST /agent/api/search` | `{ prompt }` → message, real matches and optional offer |
| `POST /agent/api/projects` | `{ offer }` → HTTP 202 with ID and project URL |
| `POST /agent/api/projects/:id/revisions` | `{ prompt }` → HTTP 202 with a new version's ID and URL |
| `GET /agent/api/projects/:id` | Public state, title, summary, guidance, expiry and error |
| `GET /agent/projects/:id/` | Trusted preview shell |
| `GET /agent/projects/:id/preview` | Sandboxed generated demo HTML; ready projects only |
| `GET /agent/projects/:id/download` | Source ZIP; ready projects only |
| `GET /agent/gallery.js`, `/agent/project.js`, `/agent/agent.css` | Trusted browser assets |
| `GET /superdoc-logo.png` | Branding asset, served by the gallery or standalone server |

POSTs require JSON and a valid Origin. Invalid/expired offers and unfinished
projects return 409. Missing/expired projects return 410. Limits return 429;
missing provider configuration returns 503. Generation failures are persisted
and reported through project state; an accepted HTTP 202 does not imply success.

## Limits and spending

`LIMITS` in `service.mjs` owns committed defaults.

| Limit | Default |
| --- | --- |
| User prompt | 1,200 characters; applies to search and follow-ups |
| JSON request body | 8,192 bytes |
| Search / generation output | 1,400 / 12,000 tokens, including reasoning |
| JavaScript + CSS | 65,536 bytes combined |
| Title / summary / guidance | 100 / 1,000 / 6,000 characters |
| Daily reserved tokens | 150,000 across all visitors and actions |
| Per-IP hourly allowance | 20 searches; 3 total builds/revisions |
| Concurrent generations | 2 |
| Stored temporary projects | 20 |
| Outstanding build offers | 200 |
| Provider request timeout | 150 seconds |
| Successful version lifetime | One hour from completion |
| Expiry cleanup interval | 15 seconds, plus request/startup checks |

Before every provider call, the service reserves its maximum output plus UTF-8
input bytes and 1,024 overhead tokens. The byte count is deliberately
conservative. Revision input includes existing code and can reserve substantially
more than an initial build. Failed calls keep their reservation. Reservations
are serialized and persisted to `budget.json`, surviving restarts and resetting
at midnight UTC. Do not silently refund failures, add retries, or increase limits
without reviewing the spend implications.

## Storage and trust boundaries

- Default storage is ignored `.demo-agent/` at repository root. Project JSON
  uses its random ID as filename. Writes use private files and atomic rename.
- Startup restores unexpired projects, culls expired ones, and marks interrupted
  builds failed. Ready projects retain their original expiration.
- The service has one in-memory project/rate map and one budget serialization
  lock. Run one replica with a persistent disk. Multiple replicas require shared
  atomic persistence, admission, rate limits and budget ownership first.
- A random HttpOnly, SameSite=Strict `demo_agent` cookie binds build offers to
  the requesting browser session. It is Secure behind the authenticated proxy
  or on an encrypted server connection.
- Direct local requests use the socket IP for throttling. Production accepts
  the client-IP header only behind the configured proxy token. Never trust a
  public `X-Forwarded-For` header for spending controls.
- Production requires an allowlisted Origin and proxy token. The Pages proxy
  overwrites the forwarded token/client-IP headers and validates its backend
  origin. No provider credential reaches the client or generated download.
- The iframe has `sandbox="allow-scripts"` without `allow-same-origin`. Its
  response CSP permits the pinned SuperDoc CDN dependencies and data/blob
  assets, blocks arbitrary network destinations, frames, forms, and access to
  the gallery API. The shell has a separate self-only policy.
- Generated code is untrusted. Never execute it in Node, remove iframe isolation,
  or give it provider keys to make an unsupported request appear to work.

## Local development

Node.js 22.12+ is required. The agent itself uses Node built-ins and has no
separate dependency installation. Do not print credential values while debugging.

```sh
cp .env.example .env.local
# Set OPENAI_API_KEY in .env.local using your editor.
npm run agent
```

The standalone backend listens on port 4180 by default. It serves agent assets
and project pages; it is not the full gallery homepage. Use the full gallery for
normal end-to-end search/build testing:

```sh
npm run build
npm run gallery
```

The full gallery listens on port 4173. Building it also builds the standalone
demos, so install their dependencies as described in the root README first.
For UI-only edits with an existing local build, copy `dist-landing/agent/` into
`dist-gallery/agent/` and refresh. `serve-gallery.mjs` reads project shell HTML
from source, but serves JS/CSS from `dist-gallery/`. Server changes require a
restart; do not erase `.demo-agent/` to reload code.

### Environment settings

| Setting | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Server-only provider credential |
| `DEMO_AGENT_MODEL` | Advanced model override; reasoning remains medium |
| `DEMO_AGENT_DAILY_TOKENS` | Positive integer daily reservation ceiling |
| `DEMO_AGENT_DATA_DIR` | Persistent project/budget directory |
| `DEMO_AGENT_ORIGINS` | Comma-separated allowed gallery origins |
| `DEMO_AGENT_PROXY_TOKEN` | Secret shared by the Pages proxy and backend |
| `DEMO_AGENT_BACKEND_URL` | Pages runtime binding pointing to the HTTPS service origin |
| `DEMO_AGENT_LOCAL` | Use local catalog links when set to `1` |
| `PORT` | Gallery defaults to 4173; standalone agent defaults to 4180 |
| `NODE_ENV` | Production entry point requires Origin/proxy-token configuration |

## Verification and debugging

Run the retained integration checks without a real key or provider charges:

```sh
npm run test:agent
node --test scripts/render-gallery.test.mjs scripts/version-history-release.test.mjs
node --check agent/service.mjs
node --check agent/project.mjs
node --check dist-landing/agent/project.js
```

Tests inject the provider, clock, catalog and temporary storage into
`createAgentService()`. Keep those seams usable. Add regression cases for route,
budget, lifecycle or isolation changes. Do not replace behavioral checks with
assertions that only duplicate implementation strings.

For browser QA:

1. Search for an existing workflow and verify the offered result is a real
   catalog link. Search for a missing workflow and explicitly accept its build.
2. Verify the logo/blue header, download, one title/description and no countdown.
3. Confirm the real editor loads and the generated controls work. Run the browser
   console/error checks; syntax validity alone does not prove SDK compatibility.
4. Submit a follow-up. The previous preview remains usable while building.
   Success changes the URL and ZIP together; refresh and verify that new version.
5. Force a provider or validation failure with the injected test provider. The
   previous preview/download and entered prompt remain available. Also test
   repair after an initial failed build and blocked requests after expiry.
6. Check narrow/mobile widths, keyboard focus, labels and status announcements.
7. Download the source, run `npm install`, `npm run dev`, and `npm run build` in
   a temporary directory when modifying the generated scaffold or package.

For a failed live demo, inspect its ignored project JSON and guidance locally,
then reproduce with a synthetic request. An expired link cannot be repaired;
start a new demo. A 429 may be the IP quota, active slots/project cap, daily
reservation ledger, or provider limit; inspect the returned public message.
Do not clear the ledger or reset a production allowance to hide a failed test.

## Deployment

Build with the repository root as Docker context:

```sh
docker build -f agent/Dockerfile -t superdoc-demo-agent .
```

Deploy one service replica with a persistent writable volume at
`DEMO_AGENT_DATA_DIR` (the image defaults to `/data/demo-agent`). Configure the
server secrets and allowed gallery origins, then set the matching Pages runtime
backend URL/proxy token. The gallery release carries public assets; its existing
Worker forwards API and project routes. Updating browser files alone does not
deploy backend changes. Production deployment remains an explicit operation;
building locally does not provision infrastructure or publish anything.

## Checklist for an agent rebuilding or modifying this feature

1. Read this guide, the root README, and the current source. Preserve other
   uncommitted work; the agent feature may be under active development.
2. Reuse the gallery catalog, logo, existing Pages Worker and deployment flow.
   Keep the server, trusted shell and untrusted generated preview separate.
3. Preserve explicit build consent, strict output schemas, pinned real SuperDoc,
   bounded requests/code, spend reservation, admission, expiry and sandboxing.
4. Keep revisions tied to existing server-stored source and preserve previous
   versions on failure. Update API, UI, downloads and this guide together.
5. Verify new SuperDoc signatures against the pinned package before teaching
   them to the generator. Retain a synthetic regression for every API failure.
6. Run offline integration tests and browser checks before claiming completion.
   State which behaviors were mocked, tested in a real editor, or left unverified.
7. Rebuild/copy the public assets and restart the local service so the user can
   inspect the actual result. Never expose secrets or deploy without authorization.
