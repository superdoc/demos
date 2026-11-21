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

Optional allowlists use comma-separated Slack IDs:

```dotenv
SLACK_ALLOWED_USERS=U123ABC,U456DEF
SLACK_ALLOWED_CHANNELS=C123ABC,C456DEF
```

User restrictions apply to every invocation. Channel restrictions apply to
mentions; an allowed user can still DM the bot. Without allowlists, installed
workspace members can DM it or mention it in channels where it has been invited.
The app does not subscribe to ordinary public/private channel messages.

## Use it

- DM **Demo Bot** a request such as `Find a tracked-changes example` or `Build a
  live word count demo`.
- In a channel, invite the bot and mention it: `@Demo Bot find a template demo`.
  Replies stay in the request's thread. Mention it again for channel follow-ups.
- Follow-up conversation is bounded to four recent messages of at most 600
  characters each, isolated by user and thread. Unthreaded DMs retain that user's
  recent direct conversation.
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

Both gallery and Slack use a shared global daily token allowance and the same
build/project capacity. Slack identities have the existing 50,000-token daily
and 20-search/3-build hourly defaults per account, instead of per network. Slack
cannot increase model effort, generation tokens, project size or preview TTL.
The provider project's dollar spending limit is configured separately in the
OpenAI dashboard.

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
