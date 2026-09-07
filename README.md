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

Build and serve the local gallery (excluding DocRAG):

```bash
bun run start
```

Open [http://localhost:4173](http://localhost:4173). The command builds both
static demos before serving the landing page and their route directories.

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
