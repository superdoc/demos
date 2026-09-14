# SuperDoc canonical collaboration demo

A small reference application showing a browser user and a server-side Python agent editing the same SuperDoc document. Everything runs locally, and model requests go directly to OpenAI with your API key.

## Quick start

Prerequisites:

- Python 3.12 or newer
- Node.js 22 or newer
- `make`
- An OpenAI API key

From this directory:

```bash
cp .env.example .env
```

Add your key to `.env`:

```dotenv
OPENAI_API_KEY=your-key-here
```

Then start the complete stack:

```bash
make dev
```

The first run installs the Python and Node dependencies. Open [http://localhost:15173](http://localhost:15173). Press Ctrl-C once in the terminal to stop all three services.

Do not commit `.env`. It is ignored by Git.

## Use the browser application

The client creates a random room ID and adds it to the URL as `?room=...`. Keep or share that URL to reconnect to the same room while the local services remain running.

1. Open the **File** menu.
2. Choose **New Document** to create a blank document, or **Upload Document** to import a `.docx` file.
3. Edit the document directly in SuperDoc.
4. Enter an instruction in the agent panel and select **Run agent**. Enter submits; Shift+Enter adds a new line.
5. While a job is running, select **Stop agent** to cancel remaining work. Edits already applied before cancellation are not rolled back.
6. Use **Save As** to export the current collaborative document, or **Delete Document** to remove it.

A room contains exactly one document. Creating or uploading another document replaces the existing document and starts a new document generation. The room's previous chat history is discarded with the replaced document.

The chat panel is intentionally isolated in [`client/src/components/ChatPanel.tsx`](client/src/components/ChatPanel.tsx). It communicates only through the public HTTP API and can be replaced with another agent interface.

## Services and ports

`make dev` starts:

| Service | Default address | Responsibility |
| --- | --- | --- |
| React client | `http://localhost:15173` | SuperDoc editor, file controls, and replaceable chat UI |
| FastAPI service | `http://localhost:8000` | Document API, room state, model calls, queue, worker, and Python SuperDoc SDK |
| Fastify/Hocuspocus | `ws://localhost:18081` | Live collaboration synchronization between the browser and backend SDK |

FastAPI owns the room registry, source files, activity timestamps, conversation history, and job records. Hocuspocus owns the live collaborative state. The browser editor and Python worker join the same generation-specific collaboration document, so backend tool edits are delivered to connected browsers without downloading and re-uploading the document.

The backend SDK remains connected independently of the browser. Agent jobs and direct document-tool requests therefore work when no browser is open.

## Configuration

Copy `.env.example` and change any of these values:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | required | Credential sent directly to OpenAI |
| `OPENAI_MODEL` | `gpt-5-mini` | Model used by the document agent |
| `COLLABORATION_PORT` | `18081` | Fastify/Hocuspocus port |
| `ROOM_TTL_SECONDS` | `3600` | Room expiry period since last recorded activity |
| `COMPLETED_JOB_TTL_SECONDS` | `600` | Retention period for terminal job records |

The client and backend URLs are configured for local use by `scripts/dev.py`.

## HTTP API

Room IDs must contain 1–100 letters, numbers, underscores, or hyphens. Interactive API documentation is available at [http://localhost:8000/docs](http://localhost:8000/docs) while the stack is running.

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/health` | Check API health |
| `GET` | `/api/rooms/{roomId}` | Read room state; returns `document: null` when empty |
| `POST` | `/api/rooms/{roomId}/document` | Create or replace with a blank document |
| `PUT` | `/api/rooms/{roomId}/document` | Upload or replace with a `.docx` file |
| `GET` | `/api/rooms/{roomId}/document` | Export and download the current collaborative DOCX |
| `GET` | `/api/rooms/{roomId}/document/info` | Read document and collaboration metadata |
| `PATCH` | `/api/rooms/{roomId}/document` | Dispatch one SuperDoc toolkit operation through the backend SDK |
| `DELETE` | `/api/rooms/{roomId}/document` | Delete the document and room state |
| `POST` | `/api/rooms/{roomId}/activity` | Refresh activity for a specific document generation |
| `GET` | `/api/rooms/{roomId}/chat` | Read completed agent conversation messages |
| `POST` | `/api/rooms/{roomId}/jobs` | Enqueue an agent prompt |
| `GET` | `/api/rooms/{roomId}/jobs/{jobId}` | Read job status and result |
| `DELETE` | `/api/rooms/{roomId}/jobs/{jobId}` | Cancel a queued or running job |

### End-to-end API example

The following sequence creates a blank document, asks the agent to edit it, waits for the job to complete, and downloads the modified DOCX.

1. Create a blank document in `demo-room`:

   ```bash
   curl -X POST http://localhost:8000/api/rooms/demo-room/document
   ```

2. Add an agent job:

   ```bash
   curl -i -X POST http://localhost:8000/api/rooms/demo-room/jobs \
     -H 'Content-Type: application/json' \
     -d '{"prompt":"Add a heading named Project Overview followed by a short introductory paragraph.","isSuggesting":true}'
   ```

   The response is `202 Accepted`. Copy the generated `id` from the response body or the job URL from its `Location` header. It will resemble `job_a1b2c3...`.

3. Get the job status using that generated ID:

   ```bash
   curl http://localhost:8000/api/rooms/demo-room/jobs/job_RETURNED_ID
   ```

   Repeat the request until `status` is `completed`. A terminal job may instead report `failed` or `cancelled`.

4. Download the modified document:

   ```bash
   curl -o modified-document.docx \
     http://localhost:8000/api/rooms/demo-room/document
   ```

### Create or upload a document

Create a blank document:

```bash
curl -X POST http://localhost:8000/api/rooms/demo-room/document
```

Upload a DOCX, replacing any existing document in the room:

```bash
curl -X PUT http://localhost:8000/api/rooms/demo-room/document \
  -F 'file=@./example.docx'
```

Uploads must be non-empty `.docx` files no larger than 25 MB.

Read room state or download the latest collaborative document:

```bash
curl http://localhost:8000/api/rooms/demo-room
curl -o edited.docx http://localhost:8000/api/rooms/demo-room/document
```

### Enqueue and monitor an agent job

A room must have a document before it can accept a job:

```bash
curl -i -X POST http://localhost:8000/api/rooms/demo-room/jobs \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Add a concise executive summary.","isSuggesting":true}'
```

The API creates a random UUID-based job ID and returns `202 Accepted`, the job record, and a `Location` header containing the status URL. Clients cannot choose job IDs. Set `isSuggesting` to `true` (the default) for tracked changes or `false` for direct edits. Job status moves through `queued`, `running`, `applying_edit`, and `completed`; it may instead end as `failed` or `cancelled`.

Copy the returned ID or follow the `Location` header:

```bash
curl http://localhost:8000/api/rooms/demo-room/jobs/job_RETURNED_ID
```

Cancel remaining work:

```bash
curl -X DELETE http://localhost:8000/api/rooms/demo-room/jobs/job_RETURNED_ID
```

Terminal records remain readable for `COMPLETED_JOB_TTL_SECONDS`, then are removed from memory.

The worker processes jobs sequentially. Each prompt includes the completed conversation history for the current document, so subsequent prompts continue the conversation.

### Dispatch a SuperDoc operation directly

`PATCH /document` bypasses the model and dispatches a SuperDoc agent-tool operation through the same backend SDK document session. For example:

```bash
curl -X PATCH http://localhost:8000/api/rooms/demo-room/document \
  -H 'Content-Type: application/json' \
  -d '{"tool":"superdoc_perform_action","arguments":{"action":"insert_heading","text":"Executive Summary","level":1,"placement":{"at":"document_start"}}}'
```

The configured toolkit exposes `superdoc_inspect` and `superdoc_perform_action`. Consult the schemas in the FastAPI documentation or `server/app/agent.py` before constructing direct requests.

### Activity requests

Activity calls include the current generation from the document metadata:

```bash
curl -X POST http://localhost:8000/api/rooms/demo-room/activity \
  -H 'Content-Type: application/json' \
  -d '{"generation":1}'
```

The API returns `409 Conflict` if that generation has been replaced.

## Verify collaboration and recovery

Use this short customer-demo check:

1. Create or upload a document in the browser.
2. Make a manual edit.
3. Ask the agent to make a distinct edit and confirm it appears in the open editor.
4. Choose **Save As**, open the exported DOCX, and confirm both edits are present.
5. Reload the browser at the same room URL and confirm the document and chat return.
6. Close the browser, enqueue another job with `curl`, wait for `completed`, then reopen the room URL and confirm the backend edit appears.
7. Temporarily disconnect and reconnect the browser while leaving the services running, then confirm the shared document returns.

Basic diagnostics are written to the `make dev` terminal, including room replacement/deletion, collaboration connections, job transitions, cleanup, and agent tool calls with durations and results.

Process restart recovery is deliberately not supported. All authoritative registries are in memory, and the app does not reconstruct rooms or jobs after restart.

## Ephemeral state and expiry

- A room holds one document and one conversation.
- Replacing or deleting the document disposes the backend SDK sessions and removes the room's source file.
- Terminal job records expire after 10 minutes by default.
- Rooms expire after one hour without recorded browser, API, or agent activity by default.
- The open client polls room state and sends activity heartbeats, so keeping a room open in a browser keeps it active even when the document is not being edited.
- Cleanup runs once per minute, so removal can occur up to roughly one minute after the configured deadline.
- Active jobs prevent room expiry until they finish or are cancelled.
- Restarting the stack loses room, chat, collaboration, and job state.

## Code map

- Model calls, system prompt, toolkit configuration, and tool dispatch: `server/app/agent.py`
- Room state, SDK sessions, replacement, export, and expiry: `server/app/rooms.py`
- In-memory queue, worker, cancellation, and job state: `server/app/jobs.py`
- HTTP routes: `server/app/routes.py`
- Service lifecycle and cleanup task: `server/app/main.py`
- Browser API client: `client/src/api.ts`
- Replaceable agent UI: `client/src/components/ChatPanel.tsx`
- SuperDoc collaboration editor: `client/src/components/DocumentEditor.tsx`
- Fastify/Hocuspocus service: `collaboration/src/server.js`
- One-command process launcher: `scripts/dev.py`

## Production boundary

This demo packages a runnable local collaboration topology; it is not a hosted SuperDoc service or a production deployment template. A production owner would still need to provide authentication and authorization, secrets management, durable document and job storage, queue recovery, collaboration persistence, horizontal scaling, rate limits, observability, backups, TLS, and deployment-specific CORS and public URLs.

Kyra can replace the chat component and agent orchestration while retaining the HTTP document surface and SuperDoc collaboration connection. They would still operate the Python API/worker and collaboration infrastructure, or replace those services with equivalents that preserve the same synchronization and state contracts.
