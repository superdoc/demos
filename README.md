# SuperDoc Demos

Working demos built with [SuperDoc](https://superdoc.dev) — the document engine for the modern web.

Live at [demos.superdoc.dev](https://demos.superdoc.dev)

## Demos

### [`rag/`](./rag) — DocRAG

Ask your documents. Get cited answers. Upload `.docx` files and get AI-powered answers with citations that scroll to the exact paragraph, comment, or tracked change in the source document.

**Stack**: Cloudflare Workers + R2, PostgreSQL + pgvector, React, SuperDoc, Claude, OpenAI embeddings

### [`superdoc-inline-revisions/`](./superdoc-inline-revisions) — Inline Revisions

Comments and tracked-change review controls built with SuperDoc's custom UI API.

**Stack**: React, SuperDoc

### [`template-builder-document-api-v2-demo/`](./template-builder-document-api-v2-demo) — Template Builder Document API v2

Template-field workflow built with SuperDoc's public Document API v2.

**Stack**: Vue, SuperDoc

## Running a Demo

Install, build, and run the local gallery and collaboration backend:

```bash
bun start
```

Open [http://localhost:4173](http://localhost:4173). The collaboration demo is
available at [http://localhost:4173/collab/](http://localhost:4173/collab/).
The command builds the locally hosted demos, starts the collaboration API on
port 8000, and serves the gallery and frontend routes on port 4173. DocRAG
retains its hosted link because its managed storage and database services are
not part of the local launcher.

The collaboration backend requires an API key before the first run:

```bash
cp canonical-collaboration-demo/.env.example canonical-collaboration-demo/.env
# Add OPENAI_API_KEY to canonical-collaboration-demo/.env
```

Each demo is a standalone app. The general pattern:

```bash
cd <demo>
bun install
bun run dev
```

See each demo's directory for specific setup instructions.

## Automatic SuperDoc updates

The **SuperDoc npm release** workflow polls `https://registry.npmjs.org/superdoc/latest`
three times a day at 00:17, 08:17, and 16:17 UTC. A new stable version runs
**Update SuperDoc**, then **Deploy Demos V2**
to production after the builds and tests pass. It uses the existing Cloudflare and
Railway secrets; no token or change to the SuperDoc source repository is needed.
GitHub schedules run from the default branch and may be delayed.
Merged pull requests into `main` also run this workflow to deploy the current
source, and manual runs remain available.

`.github/superdoc-release.json` records the last successful automated deployment.
The first scheduled run establishes that baseline by validating and deploying npm's
current stable version. The marker only advances after deployment succeeds, so a
failed update or deployment is retried on the next check. Prereleases, repeated
versions, and npm rollbacks are skipped. Polling observes the current `latest` tag;
versions superseded between checks are not individually deployed.

For a simulation, choose **Actions → SuperDoc npm release → Run workflow**, keep
`dry_run` enabled, set `simulated_latest` to an existing published stable version
(at least as new as every demo's dependency), and set `simulated_deployed` to
`0.0.0`. Either simulation input forces dry-run even if the checkbox is disabled.
For example:

```bash
gh workflow run superdoc-npm-release.yml \
  -f dry_run=true \
  -f simulated_latest=2.25.0 \
  -f simulated_deployed=0.0.0
```

The simulation updates real dependencies in the runner, runs the existing update
and deployment validation, and uploads release bundles. It never commits changes,
updates the deployment marker, or deploys Cloudflare/Railway resources. Updated
manifests, lockfiles, and gallery labels are passed between jobs as an artifact so
deployment validation tests the update even without a commit. Live runs also pin
every checkout to the resulting update commit.

Pull requests changing this automation run the same full dry-run chain against
npm's actual latest version, simulating a previous deployed version of `0.0.0`.
Release-detection tests can also be run locally:

```bash
node --test scripts/check-superdoc-release.test.mjs
```

## Deployment notifications

The release workflow sends success and failure notifications to Google Chat using
the `GOOGLE_CHAT_WEBHOOK_URL` repository secret. Each message includes the SuperDoc
version, failed stages when applicable, a workflow-log link, and all demo titles
and production links from `demos.json`. Adding a demo to that catalog automatically
includes it in future notifications. Routine checks with no release stay silent.

Dry-run messages are labeled **DRY RUN** and describe validation rather than a live
deployment. Their demo links open the current production demos. Failure messages
list the targeted demos without claiming that a failed deployment updated them.
A failure to record the deployed version is reported separately from a successful
production deployment. Webhook delivery failures fail the notification job and do
not roll back a successful deployment or reset its recorded version.

The full simulated release command above sends a dry-run success notification
after validation succeeds. To deliberately exercise the failure notification,
run:

```bash
gh workflow run superdoc-npm-release.yml \
  -f simulated_latest=2.25.0 \
  -f simulated_deployed=0.0.0 \
  -f simulate_failure=true
```

`simulate_failure` always forces dry-run and fails immediately after release
detection, skipping dependency updates and deployments. The workflow is expected
to be red while **Notify Google Chat** succeeds and delivers a clearly labeled
simulated-failure message. Both kinds of simulation send real messages to the
configured Chat space.

```bash
node --test scripts/check-superdoc-release.test.mjs scripts/notify-superdoc-release.test.mjs
```

## License

MIT

---

Built by [SuperDoc](https://superdoc.dev)
