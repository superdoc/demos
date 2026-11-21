# Demo agent: implementation and maintenance guide

This directory owns the server for the gallery's demo agent. Its browser UI
lives in `../dist-landing/agent/`. Read this guide before modifying or rebuilding
the feature. The repository root README describes the broader demo gallery.

## Purpose and current scope

The agent helps a gallery visitor find a relevant existing SuperDoc demo, then
offers to generate a small runnable browser demo if the catalog has no close
match. Visitors can download the generated source as a ZIP and continue locally.

SuperDoc is always the product context, even for a short request such as
"ASCII animations": that means animating ASCII text inside the SuperDoc
document, not building a separate animation beside an unused editor. Demo Bot
clarifies only missing behavior, never whether to use SuperDoc. Requests to
remove SuperDoc or build an independent app do not receive a standalone build
offer. Keep this rule in search, generation and downloaded guidance
through the shared `agent/scope.mjs` instructions.

This is a constrained example builder. It generates JavaScript, CSS, and useful
handoff guidance around a host-owned real SuperDoc editor. It does not execute
generated server code, install arbitrary dependencies, run generated tool calls,
or implement additional AI/backend services for the resulting demo.

## Source map

All paths below are relative to the repository root.

| File | Responsibility |
| --- | --- |
| `agent/service.mjs` | Catalog context, OpenAI requests and schemas, token ledger, build lifecycle, project storage, limits, HTTP routes, expiry, CSP |
| `agent/progress.mjs` | Provider stream parsing, generated-text callbacks and host-owned build stages |
| `agent/project.mjs` | Pinned SuperDoc version, generated-source validation, sample DOCX, preview/standalone HTML scaffold, ZIP file inventory and agent handoff text |
| `agent/scope.mjs` | Mandatory SuperDoc-only scope shared by search, generation and downloaded agent guidance |
| `agent/zip.mjs` | ZIP generation used for the DOCX and downloadable project |
| `agent/server.mjs` | Standalone Node HTTP entry point and public UI/branding assets |
| `agent/Dockerfile` | Standalone service image, built with the repository root as context |
| `dist-landing/agent/gallery.js` | Gallery search form, catalog results, explicit build offer and new-tab flow |
| `dist-landing/agent/project.html` | Trusted temporary-project shell, branding, title/summary, build progress, preview iframe and guidance |
| `dist-landing/agent/project.js` | Status/progress polling, downloads, expiry presentation and recovery |
| `dist-landing/agent/agent.css` | Gallery search styles and temporary-project shell styles |
| `dist-landing/superdoc-logo.png` | Shared gallery logo; reused at the far left of the project header |
| `demos.json` | Existing-demo search catalog; entries marked `hidden` are excluded |
| `scripts/serve-gallery.mjs` | Local gallery server; delegates `/agent/` requests to the service |
| `scripts/demo-agent-proxy.mjs` | Cloudflare Pages forwarding of API/project routes to the standalone service |
| `scripts/build-gallery.mjs` | Builds the local gallery and copies browser assets into ignored `dist-gallery/` |
| `scripts/assemble-release.mjs` | Copies `dist-landing/` assets into the production release |
| `scripts/version-history-release.mjs` | Independent Version History forwarding; gallery composition lives in assemble-release.mjs |
| `scripts/demo-agent.test.mjs` | Offline HTTP, generation, persistence, expiry, budget and proxy integration checks |

`dist-landing/agent/` is source despite its directory name. Edit it directly.
`dist-gallery/` and `dist/` are build output. Copy/rebuild them from source;
editing only their copies does not change the next release.

## Request and generation flow

1. The prompt starts hidden. A successful `GET /agent/api/health` with
   `configured: true` reveals it. Unconfigured, unavailable or invalid health
   responses leave the gallery usable without Demo Bot. The composer has a stable
   height on focus, grows with typed content up to 216px and keeps the send
   button at the bottom right. The gallery sends `POST /agent/api/search` with `{ "prompt": "...", "history": [...] }`.
   History stays in browser memory and contains at most four user/assistant
   messages, each limited to 600 characters. Other roles are rejected.
   Short confirmations and refinements use that context. Successful replies
   clear the input for the next message; failed sends retain its draft.
2. The service reports real catalog preparation, reads the catalog demos’
   local setup guides and reports matching before its provider call. These
   phases do not claim an external docs/repository search. One low-reasoning
   Responses API call produces a public acknowledgement,
   a conversational answer, a build-readiness decision and catalog matches.
   The acknowledgement streams to the page before the final reply; raw model
   reasoning and partial JSON never reach the visitor. Returned demo IDs are
   filtered against the real catalog and deduplicated (at most three matches).
3. When Demo Bot has enough detail for a feasible editor example and a new build is
   requested or needed, the service issues a random, session-bound,
   single-use build offer valid for ten minutes. Search never starts a build.
   Related catalog suggestions can appear alongside that offer. Finding an
   existing demo does not override an explicit request for a new example.
4. The visitor explicitly clicks **Build this demo**. The browser opens a blank
   tab during the click, removes its opener, and posts the offer to
   `/agent/api/projects`. The service consumes the offer and reserves a build
   slot synchronously before persistence or generation can yield.
5. The new tab loads `/agent/projects/:id/` and polls its status once per
   second while it is building. The service makes one streamed generation request.
6. Valid output becomes a ready project and starts that version's one-hour
   lifetime. The trusted shell loads the sandboxed preview and enables source
   download. Failed output becomes a failed project with
   a public error. There is no automatic retry or model-driven tool loop.

## Slack interface

The optional [Slack app](SLACK.md) uses the same service instance through its
server-only `search`, `startProject`, `projectStatus` and `createHandoff` methods.
The HTTP routes delegate to the same search/build operations. `slack.mjs` owns
Signed HTTP event handlers, user/thread isolation, owner-bound offers, private delivery,
retry deduplication and persisted completion notifications. `slack-manifest.json`
contains the installable app settings; the optional runtime dependencies are
pinned in `agent/package-lock.json`. Slack is explicitly opt-in.

`GET /agent/open/:project/:token/` displays a trusted claim form. Its same-origin
POST consumes the ten-minute handoff token and binds the project to a browser
session. GETs never transfer access. Slack retains its separate owner session;
only one secondary browser session is accepted at a time. Handoff URLs are sent
only in private DMs, with unfurls disabled. See SLACK.md for the bearer-link trust
boundary and setup requirements.

## Access and recovery

Projects are bound to the creating browser's HttpOnly cookie. Status, shell,
preview and download routes all check the persisted session hash, including
after restart. Sharing a URL does not grant another browser access. The cookie
lasts two hours and is refreshed on agent requests; the project still expires
one hour after completion. Existing projects without a session hash cannot be
opened after upgrading.

The preview has no follow-up form or revision API. Return to the gallery for a
fresh offer and explicit build action, or download the source to continue
locally. Failed builds free active-project capacity immediately; their error
state is retained for five minutes and then culled.

## Browser UI contract

- The prompt says "Describe the demo you’re looking for". Keep the keyboard hint
  without an extra find/build tagline. The blue Demo Bot speaker label has no colon
  in replies, acknowledgements, errors, or build progress.
- Each message has its own card below the prompt, newest first, in normal page
  flow so it pushes the gallery down. Visitor messages use a green **You**
  prefix; Demo Bot messages use a blue **Demo Bot** prefix, without colons. Keep the full
  page-session log, including public acknowledgement/status cards, after the
  final reply arrives. Private model reasoning is never displayed or retained.
  Only the newest build offer stays actionable after a follow-up.
- The far-left header link uses the shared SuperDoc logo and blue brand text.
  The temporary ID badge and primary download button use `#1355ff`.
- No countdown appears. Expiration is still enforced by the server and an
  internal client timeout removes an expired preview/download.
- Title and description appear once in the trusted outer shell. The iframe
  starts with the demo's controls/status/editor, without repeated headings.
  Downloaded standalone HTML retains its own title and introduction.
- The custom-demo loading panel has a butterfly moving along a wave. Reduced
  motion preferences disable the movement and all loading spinners.
- A single accessible progress line sits below the loading description and
  updates as provider events arrive: planning, interactions, styling, and setup
  guidance. Code validation and preview preparation run before publication.
  These are host-owned messages; private reasoning and partial code stay off
  the page. No extra model calls or simulated percentage estimates are used.
- The preview page has no follow-up prompt box. Download the project to keep
  working with your own coding agent.
- The trusted shell uses `textContent` for generated titles, descriptions,
  guidance and errors. Generated content must not become shell HTML.

## Demo impact review

Demo Bot applies the shared [Demo Impact Scorecard](../DEMO_IMPACT_SCORECARD.md)
to the SuperDoc examples it generates. It uses all six categories to guide each
example and includes a provisional assessment, total, decision and next
improvement in generated guidance. The agent and its gallery/Slack interfaces
do not receive demo impact scores. This does not add a model call or raise the
existing code, token or time limits. Without browser verification, the prompt
caps credibility at 3 and prohibits claims of validated status or measured
customer outcomes. Model-generated scores remain untrusted reference data.

Every downloaded project includes `DEMO_IMPACT_SCORECARD.md`. Its host-owned
README and AGENTS instructions require the next contributor to review the
rubric and maintain `DEMO_SCORECARD.md` after verifying the actual behavior.
The repository's root AGENTS.md applies the same workflow to maintained demos.

## Model contract and SuperDoc integration

The default model is `gpt-5-mini`, with low reasoning for catalog search, high
reasoning for code generation, and `store = false`. This reserves the small
search output allowance for matching results rather than extensive reasoning.
`completion()` in `service.mjs` owns the Responses API envelope
and strict JSON schemas. The gallery model returns
`{ acknowledgement, message, canBuild, matches: [{ id, reason }] }`. Questions,
greetings, unclear goals and unrelated requests have `canBuild: false`, so
empty matches alone never force a build offer. `canBuild` is independent of
`matches`: a feasible requested build gets its CTA even alongside related or
exact catalog matches. Acknowledgements are public intent statements, not
chain-of-thought. Both acknowledgement and reply share the existing 1,400-token
allowance and one model request.
Generation returns nonempty strings for `title`, `summary`, `javascript`, `css`
and `guidance`.

`agent/superdoc-version.json` pins SuperDoc, exported as `SUPERDOC_VERSION`.
The file also pins SuperDoc's required DOCX Engine dependency. The stable
dependency updater writes this file and includes it in automated release
commits and source artifacts. Both preview and standalone
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
`sample.docx`, `package.json`, `README.md`, `AGENTS.md`, `demo-context.json`,
`DEMO_IMPACT_SCORECARD.md` and `.gitignore`.

The download uses Vite for local development and builds. README/AGENTS are
host-owned instructions with the version pin and entry-point contract. Visitor
prompts are omitted entirely. Model-generated titles, summaries and guidance
are reference data in `demo-context.json`, explicitly marked untrusted by
AGENTS.md; they are never interpolated into agent instructions. It needs no API
key to run. When changing the host contract, update both generated documents along with the scaffold and
generator instructions.

## HTTP routes

| Method and path | Input / response |
| --- | --- |
| `GET /agent/open/:id/:token/` | Private browser claim form; same-origin POST consumes the link |
| `GET /agent/api/health` | Configuration boolean and public limits; no credentials |
| `POST /agent/api/search` | `{ prompt, history? }` → message, real matches and optional offer; optional NDJSON progress + acknowledgement + result stream |
| `POST /agent/api/projects` | `{ offer }` → HTTP 202 with ID and project URL |
| `GET /agent/api/projects/:id` | Session-bound state, current build progress, title, summary, guidance, expiry and error |
| `GET /agent/projects/:id/` | Trusted preview shell |
| `GET /agent/projects/:id/preview` | Sandboxed generated demo HTML; ready projects only |
| `GET /agent/projects/:id/download` | Source ZIP; ready projects only |
| `GET /agent/gallery.js`, `/agent/project.js`, `/agent/agent.css` | Trusted browser assets |
| `GET /superdoc-logo.png` | Branding asset, served by the gallery or standalone server |

POSTs require JSON and a valid Origin. Invalid/expired offers and unfinished
projects return 409. Missing/expired projects return 410. Limits return 429;
missing provider configuration returns 503. Valid project IDs from another
session return 404. Empty, null, array and scalar JSON bodies return 400. Generation failures are persisted
and reported through project state; an accepted HTTP 202 does not imply success.

Gallery requests set `Accept: application/x-ndjson`. The stream contains an
`progress` events (`message`) for catalog/setup-guide/matching work, an
`acknowledgement` event (`message`), then a `result` event (`data`: the usual JSON
response), or an `error` event (`data.error`). Failures after streaming headers
arrive through that error event. Clients without this Accept header still get
the original JSON response and HTTP error status. No extra AI call is made for
the acknowledgement or progress. Local setup guides are read during each
search so those public stages describe actual work. Build offers include the validated recent conversation
so an answer to a clarification reaches generation with its original context.

## Limits and spending

`LIMITS` in `service.mjs` owns committed defaults.

| Limit | Default |
| --- | --- |
| User prompt | 1,200 characters |
| JSON request body | 8,192 bytes |
| Search / generation output | 1,400 / 12,000 tokens, including reasoning |
| JavaScript + CSS | 65,536 bytes combined |
| Title / summary / guidance | 100 / 1,000 / 6,000 characters |
| Daily token allowance | 150,000 across all visitors and actions; settled against actual usage |
| Per-IP hourly allowance | 20 searches; 3 builds |
| Per-IP daily token allowance | 50,000, persisted and settled against actual usage |
| Failed project retention | Five minutes; failed projects do not occupy capacity |
| Concurrent generations | 2 |
| Stored temporary projects | 20 |
| Outstanding build offers | 200 |
| Provider request timeout | 150 seconds |
| Successful version lifetime | One hour from completion |
| Expiry cleanup interval | 15 seconds, plus request/startup checks |

Before every provider call, the service reserves its maximum output plus UTF-8
input bytes and 1,024 overhead tokens. The byte count is deliberately
conservative. A separate per-network daily allowance prevents a single IP from
consuming the shared allowance; both holds and actual usage count against it. After a terminal provider response, reported actual
input plus output tokens (including reasoning) replace the reservation; unused
allowance is released. This also applies to incomplete responses with confirmed
usage. Rejected HTTP 4xx requests and explicit authentication/quota/rate-limit
stream errors release their holds and return a public provider error. Provider
failures log only stage/status/code, never raw payloads. Timeouts, interrupted
streams and unknown failures retain the full hold, as do older ledger entries
without usage records.

Reservations and settlements share one serialized queue and persist in
`budget.json`, surviving restarts and resetting at midnight UTC. A request
finishing after rollover cannot reduce the new day's ledger. `reserved` is the
total charged allowance (actual usage plus outstanding/unknown holds), and
`actualTokens` records confirmed usage since this accounting update.
`identities` stores daily charges by hashed IP, so changing cookies or restarting
does not reset a network's allowance; raw addresses are not persisted. Do not erase
historical reservations or increase limits without reviewing spend implications.

## Storage and trust boundaries

- Default storage is ignored `.demo-agent/` at repository root. Project JSON
  uses its random ID as filename. Writes use private files and atomic rename.
- Startup restores unexpired projects, culls expired ones, and marks interrupted
  builds failed. Ready projects retain their original expiration.
- The service has one in-memory project/rate map and one budget serialization
  lock. Run one replica with a persistent disk. Multiple replicas require shared
  atomic persistence, admission, rate limits and budget ownership first.
- A random HttpOnly, SameSite=Strict `demo_agent` cookie binds build offers to
  the requesting browser session; persisted projects store its hash and enforce
  it on every read and download. It is Secure behind the authenticated proxy
  or on an encrypted server connection.
- Direct local requests use the socket IP for throttling. Production accepts
  the client-IP header only behind the configured proxy token. Never trust a
  public `X-Forwarded-For` header for spending controls.
- Production requires an allowlisted Origin and proxy token. The Pages proxy
  overwrites the forwarded token/client-IP headers and validates its backend
  origin. No provider credential reaches the client or generated download.
- The iframe has `sandbox="allow-scripts"` without `allow-same-origin`. Its
  response CSP permits only the exact pinned SuperDoc and DOCX Engine scripts on jsDelivr
  (alongside the inline host and generated data module). Other CDN asset access
  is scoped to those pinned packages' dist-cdn directories. It permits data/blob
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
`dist-gallery/agent/` and refresh. `serve-gallery.mjs` serves trusted agent
JS/CSS and the project shell from source to keep them in sync. Server changes require a
restart; do not erase `.demo-agent/` to reload code.

### Environment settings

| Setting | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Server-only provider credential |
| `DEMO_AGENT_MODEL` | Advanced model override; search uses low reasoning, generation uses high |
| `DEMO_AGENT_DAILY_TOKENS` | Positive integer daily reservation ceiling |
| `DEMO_AGENT_IP_DAILY_TOKENS` | Positive integer per-network daily ceiling, default 50,000 |
| `DEMO_AGENT_DATA_DIR` | Persistent project/budget directory |
| `DEMO_AGENT_ORIGINS` | Comma-separated allowed gallery origins |
| `DEMO_AGENT_PROXY_TOKEN` | Secret shared by the Pages proxy and backend |
| `DEMO_AGENT_BACKEND_URL` | Gallery/Pages server setting pointing to `demo-bot-ext` |
| `DEMO_AGENT_INSTANCE` | Deployment label: `demo-bot-ext` or `demo-bot-int`; same behavior |
| `DEMO_AGENT_REVISION` | Identical source fingerprint on both services |
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

The focused browser scenario is retained in `tests/demo-agent-ux.mjs`. With
`tests/` dependencies and Chromium installed, run `pnpm --dir tests run test:agent`.
It uses a synthetic provider, loads the real pinned CDN editor, and checks focus,
typing/height limits, progress, suggestion/CTA spacing, the first-click popup,
loading and reduced motion, mobile overflow, download and error recovery.
It writes screenshots to a printed temporary directory and makes no OpenAI calls.

For browser QA:

1. Search for an existing workflow and verify the offered result is a real
   catalog link. Search for a missing workflow and explicitly accept its build.
2. Verify the logo/blue header, download, one title/description and no countdown.
3. Confirm the real editor loads and the generated controls work. Run the browser
   console/error checks; syntax validity alone does not prove SDK compatibility.
4. Open a project URL in a separate browser context. Status, shell, preview
   and download must all be denied; the original context must still work.
5. Force provider/validation failures with the injected test provider; check
   errors, budget settlement, immediate capacity release and five-minute cleanup.
6. Check narrow/mobile widths, keyboard focus, labels and status announcements.
7. Download the source, run `npm install`, `npm run dev`, and `npm run build` in
   a temporary directory when modifying the generated scaffold or package.

For a failed live demo, inspect its ignored project JSON and guidance locally,
then reproduce with a synthetic request. An expired link cannot be repaired;
start a new demo. A 429 may be the IP quota, active slots/project cap, daily
reservation ledger, or provider limit; inspect the returned public message.
Do not clear the ledger or reset a production allowance to hide a failed test.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the managed Railway services, gallery
routing, persistent volumes and redeployment procedure.


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
4. Keep project reads session-bound and downloaded agent instructions free of
   visitor/model text. Update API, UI, downloads and this guide together.
5. Verify new SuperDoc signatures against the pinned package before teaching
   them to the generator. Retain a synthetic regression for every API failure.
6. Run offline integration tests and browser checks before claiming completion.
   State which behaviors were mocked, tested in a real editor, or left unverified.
7. Rebuild/copy the public assets and restart the local service so the user can
   inspect the actual result. Never expose secrets or deploy without authorization.
