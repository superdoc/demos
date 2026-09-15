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

## License

MIT

---

Built by [SuperDoc](https://superdoc.dev)
