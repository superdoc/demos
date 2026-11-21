# Demo Bot for Slack

Demo Bot can find SuperDoc examples and offer focused builds from a DM or an
explicit channel mention. It uses the same service instance as the gallery,
including its model settings, impact scorecard, generation queue, token ledger,
code limits, one-hour previews and source downloads.

## Connect the app

The backends are deployed on Railway. Use the **internal** deployment for the
team Slack app; see [DEPLOYMENT.md](./DEPLOYMENT.md) for both services.

1. Open [Slack app management](https://api.slack.com/apps), choose **Create New
   App → From a manifest**, select the workspace and paste
   [`slack-manifest.json`](./slack-manifest.json). It already targets the internal
   deployment's `/slack/events` URL. For an external app, use the external URL
   in both `settings.interactivity.request_url` and
   `settings.event_subscriptions.request_url`.
2. Under **Basic Information**, copy the **Signing Secret**. Install the app
   in the workspace and copy its **Bot User OAuth Token** under **OAuth & Permissions**.
   If Slack asks to verify the event URL before creating/installing the app,
   create the app without `event_subscriptions` first, configure the credentials
   below, then add/verify the request URL and subscribe to `app_mention` and
   `message.im`. Reinstall after adding scopes.
3. In the selected Railway service's **Variables**, set server-only secrets:

   ```dotenv
   DEMO_AGENT_SLACK_ENABLED=1
   SLACK_BOT_TOKEN=xoxb-REPLACE
   SLACK_SIGNING_SECRET=REPLACE
   SLACK_TEAM_ID=T_REPLACE_WITH_WORKSPACE_ID
   ```

4. Redeploy, then set **Event Subscriptions → Request URL** and
   **Interactivity & Shortcuts → Request URL** to:
   `https://demo-bot-int-production.up.railway.app/slack/events`.
   Keep Socket Mode disabled. No app-level token is required.
5. Invite **Demo Bot** to a channel or open its Messages tab and send a DM.
   Workspace policy may require an administrator to approve installation.

`SLACK_TEAM_ID` checks that the bot belongs to the intended workspace. This is
a single-workspace integration, without distributed OAuth installation or token
rotation. Use separate Slack apps if enabling both deployments in the same
workspace; one app has one event URL. Both deployments run identical code.

`DEMO_AGENT_PUBLIC_URL` is already set to each backend's own HTTPS origin so
private previews work without going through the gallery. A personal Slack
connector does not supply a bot token or signing secret for this app. Slack
remains disabled until these app credentials are configured.

Existing catalog examples use `DEMO_AGENT_GALLERY_URL`, which defaults to
`https://demos.superdoc.dev`. For example, Template Builder links to
`https://demos.superdoc.dev/builder/`. Keep this separate from the backend's
`DEMO_AGENT_PUBLIC_URL`, which serves generated previews and ZIP downloads.

Optional allowlists use comma-separated Slack IDs:

```dotenv
SLACK_ALLOWED_USERS=U123ABC,U456DEF
SLACK_ALLOWED_CHANNELS=C123ABC,C456DEF
```

User restrictions apply to every invocation. Channel restrictions apply to
mentions; an allowed user can still DM the bot. Without allowlists, installed
workspace members can DM it or mention it in channels where it has been invited.
To continue channel threads without another mention, add the bot scopes
`channels:history` and `groups:history` under OAuth & Permissions and reinstall
the app, then subscribe to `message.channels` and `message.groups` under Event
Subscriptions. The manifest includes these settings for new installs. Slack
will deliver channel messages, but the bot discards ordinary chatter: it only
responds in an active thread started by an explicit mention, for the same user.
These scopes grant access to messages in public/private channels the bot joins;
leave them off if you prefer to require a mention for every channel reply.

## Use it

- DM **Demo Bot** a request such as `Find a tracked-changes example` or `Build a
  live word count demo`.
- In a channel, invite the bot and mention it: `@Demo Bot find a template demo`.
  Replies stay in the request's thread. With the additional message subscriptions
  enabled, continue that active thread without mentioning the bot again.
- Follow-up conversation retains the opening goal and recommended demo names,
  plus recent exchanges: at most 12 messages, 1,200 characters per message and
  6,000 characters total. It stays isolated by user and channel/thread. Replies
  to a top-level DM from either you or the bot continue the same conversation.
  State expires after an hour of inactivity and survives service restarts.
- Demo Bot enjoys discussing demo ideas and feature tradeoffs, with opinions
  grounded in the six Demo Impact Scorecard categories. It can explain its own
  capabilities and limits. Discussion does not automatically recommend examples
  or offer a build; ask explicitly when you are ready to make one.
- Search never starts a build. Click **Build this demo** on your own offer to
  generate code. Offers last ten minutes and are single use.
- The bot confirms it can DM you before starting a build, then sends a private
  preview link. When ready, that DM contains separate **Open live preview** and
  **Download ZIP** buttons, plus both URLs in plain message text. The ZIP link
  works directly with `curl` or an agent, without a browser, cookies or credentials.
- Open the link and click **Open demo** to bind the project to your browser.
  The preview includes **Download project** and the impact scorecard handoff.
- An unopened link lasts ten minutes. **Refresh links** issues fresh
  preview/download links without another model call or build. Refreshing revokes
  the old download link and any unclaimed preview link. Only the requesting Slack account can
  refresh them, and the project still expires at its original time.

For a fully headless prompt/build/download workflow, see [API.md](./API.md).

## Access and lifecycle

Signed HTTP requests and the installed bot's `auth.test` result identify
one workspace. Signatures cover the raw body, use constant-time comparison and
reject timestamps older than five minutes. Bot messages and message edits are ignored. Interactive actions
are acknowledged before work; only the original requester can consume an offer.

Project links are sent only by DM, with unfurls disabled. Direct ZIP links are
download-only bearer links: anyone holding one can download source until the
project expires. They do not grant preview/status access. Keep them private.

Browser preview links retain the existing claim policy: Treat an unopened link
as a private, single-use bearer link: whoever receives it can claim it. GETs do
not claim links, so Slack unfurls and security scanners cannot consume them.
An explicit same-origin form POST claims the link, consumes its token and stores
a browser session hash. Other browsers cannot use the consumed link or the
project's status, preview or ZIP URLs. Refreshing a private link can connect a
new browser; an earlier claimed browser then loses that secondary access.

By default, gallery and Slack use the shared daily token allowance, with
50,000 tokens/day and 20-search/3-build hourly defaults per Slack account.
On `demo-bot-int` only, `DEMO_AGENT_SLACK_UNLIMITED=1` removes Slack's application
daily token and hourly request quotas. Slack then relies on OpenAI's project/org
rate, credit and enforced spend limits. Usage remains metered in a separate
`budget.slack` ledger, so it does not consume the browser/API daily allowance.
Existing ledger entries are preserved. No HTTP header or JSON field can select
this exemption, and `demo-bot-ext` ignores the flag entirely.

Concurrency, active-project capacity, explicit build consent, per-request output
limits, code size, timeouts and preview TTL remain enforced. Configure the
provider project's enforced spend limit separately in OpenAI; a spend alert
alone does not stop requests.

The existing private data directory stores `slack-state.json`: a random secret
for deriving unguessable service sessions, bounded recent conversations and
offers, duplicate-event IDs, and pending completion notifications. Files use
owner-only permissions. Conversations expire after an hour, offers after ten
minutes, and deduplication records after 24 hours; expired state is pruned when
saved. Notifications resume after restart. A restart during generation marks
the project failed under the existing service policy. Run one service replica
and one Slack event owner with the persistent disk; do not run a separate
Slack service against the same disk or erase the token ledger to recover.

## Verify without a Slack workspace or provider charges

```sh
node --test scripts/demo-agent.test.mjs scripts/demo-agent-slack.test.mjs
```

The tests inject Slack and OpenAI clients. They cover mentions/DMs, explicit
consent, owner checks, duplicate delivery/clicks, private-message failure,
conversation isolation, restart recovery, shared spend controls, plain-text
message safety, public-origin validation and the one-time browser handoff.
The retained browser scenario (`pnpm --dir tests run test:agent`) also checks the
claim form and browser-bound ZIP download with the real pinned SuperDoc editor.

Live workspace delivery still needs verification after the app is installed
and its server-only tokens are configured. A personal Slack connector used by a
coding assistant does not supply these new app credentials.
