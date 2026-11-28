# DocRAG

Ask your documents. Get cited answers.

Upload `.docx` files, ask questions in natural language, and get answers with citations that navigate to the exact paragraph, comment, or tracked change in the source document. Powered by [SuperDoc](https://superdoc.dev).

## How it Works

1. **Upload** `.docx` files through the UI
2. **Extract** text, comments, and tracked changes using the [SuperDoc SDK](https://docs.superdoc.dev)
3. **Chunk** each paragraph with its stable node ID, embed with OpenAI
4. **Store** chunks with embeddings in PostgreSQL + pgvector, files in R2
5. **Query** — ask a question, relevant chunks are retrieved via vector similarity search
6. **Answer** — Claude generates a response with `[cite:ID]` references
7. **Navigate** — click a citation to scroll to the source in the SuperDoc viewer

## Architecture

```
apps/
  api/              Cloudflare Worker — query, documents, file serving
  web/              React frontend — document viewer + chat sidebar
  ingest/   Docker service — automated extraction for VM deployment
packages/
  shared/           SuperDoc extraction, chunking, embedding client
docs/               Sample .docx files
```

**Stack**: Cloudflare Workers, PostgreSQL + pgvector, Cloudflare R2, React, SuperDoc, Claude, OpenAI embeddings

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.1+
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (installed automatically)
- Cloudflare account (free tier works)
- PostgreSQL database with [pgvector](https://github.com/pgvector/pgvector)
- OpenAI API key (for embeddings)
- Anthropic API key (for Claude)

### Setup

```bash
bun install

# Create the database schema (run against your Neon database)
psql $DATABASE_URL -f apps/api/schema.sql

# Create Cloudflare R2 bucket
cd apps/api
npx wrangler r2 bucket create rag-demo-docs

# Add secrets for local dev
cat > .dev.vars << EOF
DATABASE_URL=postgresql://...your-connection-string...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
INGEST_SERVICE_URL=http://localhost:4000
EOF
cd ../..
```

### Run

```bash
# Terminal 1: API (Cloudflare Worker via wrangler dev)
bun run dev:api

# Terminal 2: Frontend (Vite)
bun run dev:web
```

Open [http://localhost:3000](http://localhost:3000)

### Sample Questions

Try these across the sample documents:

- "What services does Nexus provide under the agreement?" (paragraph citation)
- "What's the monthly fee for the Professional tier?" (table-row citation)
- "What does the reviewer suggest about capping liability?" (comment citation)
- "What changes have been proposed to the termination notice period?" (tracked-change citation)
- "Which customers have confirmed participation in the beta launch?" (paragraph citation)

## Deploy

### Worker + Frontend

```bash
# Deploy API Worker
cd apps/api
wrangler secret put DATABASE_URL
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler deploy

# Deploy frontend to Cloudflare Pages
cd ../..
bun run deploy:web
```

### Ingest Service (VM)

For automated ingestion, deploy the Docker service to a VM:

```bash
docker build -f apps/ingest/Dockerfile -t docrag-ingest .
docker run -d \
  -e API_URL=https://docrag-api.<account>.workers.dev \
  -e OPENAI_API_KEY=sk-... \
  -e AUTH_TOKEN=your-shared-secret \
  -p 4000:4000 \
  docrag-ingest
```

## License

MIT

---

Built by [SuperDoc](https://superdoc.dev)
