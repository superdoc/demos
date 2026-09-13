# SuperDoc canonical collaboration demo

A deliberately small reference app showing a browser user and a Python agent editing the same SuperDoc document. It runs entirely on your machine and calls OpenAI with your API key.

## Start

Prerequisites: Python 3.12+, Node.js 22+, `make`, and an OpenAI API key.

```bash
cp .env.example .env
# Add OPENAI_API_KEY to .env
make dev
```

`make dev` installs dependencies when necessary and starts all three processes. Open [http://localhost:15173](http://localhost:15173), upload a `.docx`, and prompt the agent from the right-hand panel. Press Ctrl-C once to stop the complete stack.

## What runs

- `client`: React, SuperDoc, and the replaceable [`ChatPanel`](client/src/components/ChatPanel.tsx).
- `api`: FastAPI, room/document CRUD, the in-memory queue, worker, OpenAI calls, and the Python SuperDoc backend SDK.
- `collaboration`: Fastify WebSocket transport with Hocuspocus collaboration, shared by the browser and Python SDK.

The Python service owns room metadata, source files, activity timestamps, per-document agent conversation history, and job records. The collaboration service owns the live shared editing session. Both the browser and worker join the same generation-specific collaboration document.

This demo is intentionally ephemeral and single-instance. Jobs are forgotten 10 minutes after completion. A room and its document are deleted after one hour without browser, API, or agent activity. Process restarts, authentication, horizontal scaling, durable queues, and production infrastructure are outside its scope.

## Public API

All room IDs may contain letters, numbers, `_`, and `-`.

```text
PUT    /api/rooms/{roomId}/document       Upload or replace the room's DOCX
GET    /api/rooms/{roomId}/document       Download the current collaborative DOCX
GET    /api/rooms/{roomId}/document/info  Read room and collaboration metadata
GET    /api/rooms/{roomId}                Read room state without a missing-document 404
PATCH  /api/rooms/{roomId}/document       Run a SuperDoc toolkit operation
DELETE /api/rooms/{roomId}/document       Delete the room document
POST   /api/rooms/{roomId}/activity       Refresh the room activity timer
GET    /api/rooms/{roomId}/chat           Read the room's agent conversation
POST   /api/rooms/{roomId}/jobs           Enqueue an agent prompt
GET    /api/rooms/{roomId}/jobs/{jobId}   Read job status
```

Example agent request:

```bash
curl -X POST http://localhost:8000/api/rooms/demo-room/jobs \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Add a concise executive summary."}'
```

The response is `202 Accepted` and includes a `Location` header for the job status URL. A caller may provide `job_id` in the request. Reusing an existing ID returns `409 Conflict` without enqueuing duplicate work.

## Code map

- Model calls and agent loop: `server/app/agent.py`
- Tool configuration and direct Document API dispatch: `server/app/agent.py`
- Room state, SDK sessions, replacement, export, and expiry: `server/app/rooms.py`
- Queue, worker, and job state: `server/app/jobs.py`
- HTTP surface: `server/app/routes.py`
- Lifecycle and cleanup task: `server/app/main.py`
- Browser API client: `client/src/api.ts`
- Replaceable agent UI: `client/src/components/ChatPanel.tsx`
- SuperDoc collaboration editor: `client/src/components/DocumentEditor.tsx`

## Production boundary

Kyra would still need to operate authentication/authorization, secrets, durable document and job storage, queue recovery, observability, rate limits, backups, and the collaboration service. This repository packages a runnable collaboration topology; it is not a commitment to a SuperDoc-managed hosted service.
