# Demo Bot deployments

Both backends run the same source, model, reasoning settings, limits, Slack HTTP
transport and project lifecycle. Their OpenAI project keys, proxy credentials
and persistent runtime data are isolated. Neither deployment has extra features.

| Service | Audience | HTTPS origin |
| --- | --- | --- |
| `demo-bot-ext` | Customer gallery | https://demo-bot-ext-production.up.railway.app |
| `demo-bot-int` | Internal integrations | https://demo-bot-int-production.up.railway.app |

[Manage both in Railway](https://railway.com/project/7eebd8ca-a819-4f3d-92cb-62110a88e4fe).
They live in the existing `canonical-collab-demo` project, production environment,
alongside the existing collaboration and version-history backends. Each has one
replica and a separate volume mounted at `/data`; the app stores private files
under `/data/demo-agent`. Do not share or clear these volumes to reset usage.
The image fixes the mounted directory's ownership before running Node as `node`.

## Settings and spending

Railway **Variables** holds each service's `OPENAI_API_KEY` and independent
`DEMO_AGENT_PROXY_TOKEN`. Keys are absent from Git, frontend assets and downloads.
Set or rotate keys on the individual service, then redeploy it. Their provider
projects keep independent billing and budget configuration in OpenAI. A provider
project's monthly budget/alerts are configured there; this deployment does not
change or verify the OpenAI billing dashboard's settings.

Both services use `gpt-5-mini`, low reasoning for conversations/search and high
reasoning for generation. Each independently enforces 300,000 tokens/day,
50,000 tokens/day per network or Slack account, 1,400 output tokens/search,
12,000 output tokens/build, 64 KB generated code, two concurrent builds and
20 active projects. Reservations include input and reasoning/output tokens and
are reconciled with confirmed provider usage. Ready previews and ZIP downloads
expire after one hour; a 15-second cleanup loop deletes expired projects.

`DEMO_AGENT_INSTANCE` labels the service; it does not select a different feature
set. `GET /health` reports that label, limits and a source SHA-256 fingerprint,
with no secrets. Matching fingerprints confirm the same packaged source.
Health confirms configuration, not provider billing availability.

## Gallery routing

This repository's gallery always targets **`demo-bot-ext`**. Its proxy overwrites
the backend token, client IP and `X-Demo-Agent-Target: demo-bot-ext`. A backend
with a different instance label rejects it before making a model call.

Cloudflare Pages `superdoc-demos` needs server-side `DEMO_AGENT_BACKEND_URL`
pointing at the external origin and its matching `DEMO_AGENT_PROXY_TOKEN`, in
both production and preview settings. The existing gallery deployment workflow
configures these from the matching GitHub variable and secret before publishing.
The OpenAI keys stay exclusively on Railway.

For the local gallery, set those same two values in ignored `.env.local` and run
`npm run gallery` on port 4173. Requests proxy to the deployed customer backend;
no local OpenAI key or usage ledger is used in this mode. If the backend URL is
absent, local development can still run an isolated agent using `OPENAI_API_KEY`.
Allow any preview gallery's exact HTTPS origin in `DEMO_AGENT_ORIGINS` on the
external service before using searches/builds from it. Project reads and private
handoffs enforce their own browser/session access; spending APIs require the
gallery proxy credential.

The production gallery receives new UI code through its normal release process.
A backend deployment or runtime-setting change alone does not publish the PR's
frontend. Use the branch preview or local gallery to test before that release.

## Redeploy

Use **Actions → Deploy Demo Bot backends**, selecting `both` (the default) or an
individual service. The workflow becomes available once it is on the default
branch. It tests the agent and uploads an identical, allowlisted source package,
using the existing Railway project token. Keys and volumes remain on Railway.

For a manual deployment from the repository root:

```sh
node --test scripts/demo-agent.test.mjs scripts/demo-agent-slack.test.mjs
node scripts/package-demo-bot.mjs /tmp/demo-bot-release
cd /tmp/demo-bot-release
npx -y @railway/cli@4.58.0 up --project 7eebd8ca-a819-4f3d-92cb-62110a88e4fe --environment production --service demo-bot-ext --ci
npx -y @railway/cli@4.58.0 up --project 7eebd8ca-a819-4f3d-92cb-62110a88e4fe --environment production --service demo-bot-int --ci
```

Choose an empty packaging directory. The packager excludes local `.env` files,
runtime data, installed dependencies, unrelated apps and Git history. It copies
the Railway healthcheck/restart configuration to the package root. Do not upload
the entire working checkout or a package from an untrusted source.

## Slack

Both services expose `/slack/events`, using signed HTTP requests, with Socket
Mode disabled. See [SLACK.md](./SLACK.md) for app installation. Supply the selected
service's Slack bot token, signing secret and workspace ID before setting
`DEMO_AGENT_SLACK_ENABLED=1`. Until then the endpoint returns 503 and no Slack
messages are sent. Each deployment's public preview URL points to its own origin.
