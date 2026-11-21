# Demo Bot for API clients and coding agents

Agents can request a demo, receive a browser preview link and download its ZIP
without launching a browser or maintaining cookies. Both Railway backends expose
the same API. Internal integrations should use `demo-bot-int`; the gallery uses
`demo-bot-ext`. See [DEPLOYMENT.md](./DEPLOYMENT.md).

## One command

Store the chosen service's `DEMO_AGENT_PROXY_TOKEN` as `DEMO_BOT_TOKEN` in your
agent's secret manager/environment. This is the backend access credential; the
OpenAI key remains on Railway. Never put either credential in a public browser,
prompt, source archive or shared log. Optionally set `DEMO_BOT_URL` to override
the default internal backend origin.

```sh
node scripts/request-demo.mjs \
  --prompt "Build a new SuperDoc demo with a button to show the document text" \
  --build \
  --output demo.zip
```

`--build` explicitly accepts the bot's build offer; without it, the command only
searches/replies. It never automatically retries a paid search or generation.
If the bot needs clarification or only recommends an existing example, no build
starts. Existing catalog matches include their live and source links; generated
projects additionally receive the direct ZIP links described here.

Progress goes to stderr. Successful generated-project output on stdout is JSON:

```json
{
  "id": "temporary-project-id",
  "title": "Document text example",
  "previewUrl": "https://backend.example/agent/open/PROJECT/PRIVATE_TOKEN/",
  "downloadUrl": "https://backend.example/agent/projects/PROJECT/download/PRIVATE_TOKEN",
  "previewExpiresAt": 1800000000000,
  "expiresAt": 1800003000000,
  "output": "demo.zip"
}
```

`--output` is optional. If supplied, the client fetches the ZIP directly and
creates that file without overwriting an existing file. Download URLs work with
plain HTTP clients, without cookies or the backend credential:

```sh
curl --fail --output demo.zip "$DOWNLOAD_URL"
```

The ZIP contains runnable source, the sample document, README, `AGENTS.md`,
the Demo Impact Scorecard and generated guidance in `demo-context.json`.

## HTTP integration

Generate a cryptographically random 16-byte hex session ID for each workflow and
retain it until links are issued. Send these headers on API requests:

```http
Authorization: Bearer BACKEND_ACCESS_CREDENTIAL
X-Demo-Agent-Session: 32_HEXADECIMAL_CHARACTERS
Content-Type: application/json
```

1. `POST /agent/api/search` with `{"prompt":"Build a focused new demo…"}`.
   The response contains `message`, `matches` and an optional single-use `offer`.
   For follow-ups, send back the response's `history` array (up to 12
   `user`/`assistant` entries, 1,200 characters each and 6,000 total). It retains
   the opening goal and demo references. Discussion/capability questions need
   neither catalog cards nor a build offer. Search never starts generation.
2. To explicitly accept a build, `POST /agent/api/projects` with
   `{"offer":"OFFER_FROM_SEARCH"}` using the same session. Receive the project ID.
3. Poll `GET /agent/api/projects/PROJECT_ID` until `state` is `ready` or `failed`.
4. Once ready, `POST /agent/api/projects/PROJECT_ID/links` with `{}`. Receive
   `previewUrl`, `downloadUrl`, `previewExpiresAt` and `expiresAt`. API paths are
   root-relative; resolve them against the backend origin. The CLI returns
   absolute URLs. Only the owner session can issue or refresh these links.
5. Fetch `downloadUrl` with an ordinary GET. No browser handoff or API credential
   is required. Never forward the backend credential to a download destination.

Machine mode requires the explicit bearer credential. The gallery proxy strips
machine-session and Authorization headers; its automatically attached proxy
credential alone cannot authorize a browser visitor as an API client. Browser
sessions continue to use the existing cookie/Origin checks. API sessions use the
same reservations, per-caller budget, build limits, code cap and cleanup policy.
The current access credential is shared per deployment; per-client credentials
or SSO are not implemented by this endpoint.

## Links and access

The preview is a private, one-use browser handoff: open within ten minutes and
click **Open demo** to bind it to that browser. Its subsequent page/preview/ZIP
access remains browser-session protected. Link previews/scanner GETs do not
consume the browser handoff.

The direct ZIP link is a separate **download-only bearer link**. Anyone holding
it can fetch that project's source until the original one-hour project expiry.
It can be fetched repeatedly, so an unfurl or download scanner cannot consume it.
It does not grant access to the preview, status, other projects or generation.
The project stores only the token hash. Link creation does not extend project
expiry. Refreshing links revokes the previous direct ZIP link and unclaimed
preview token; already claimed preview sessions retain their normal access.
Expiration/culling removes both the project and its download access.

Treat returned links as private. Use them in the requesting Slack user's DM or
the authenticated agent's result, rather than public channels or CI logs.
