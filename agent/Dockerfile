# Build from the repository root: docker build -f agent/Dockerfile -t demo-agent .
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4180 DEMO_AGENT_DATA_DIR=/data/demo-agent
COPY agent/package.json agent/package-lock.json ./agent/
RUN apk add --no-cache su-exec && npm --prefix agent ci --omit=dev --ignore-scripts
COPY agent/ ./agent/
COPY dist-landing/agent/ ./dist-landing/agent/
COPY dist-landing/superdoc-logo.png ./dist-landing/superdoc-logo.png
COPY demos.json ./
COPY DEMO_IMPACT_SCORECARD.md ./
COPY custom-word-editor/README.md ./custom-word-editor/README.md
COPY canonical-collaboration-demo/README.md ./canonical-collaboration-demo/README.md
COPY template-builder-document-api-v2-demo/README.md ./template-builder-document-api-v2-demo/README.md
COPY rag/README.md ./rag/README.md
COPY version-history/README.md ./version-history/README.md
RUN mkdir -p /data/demo-agent && chown -R node:node /data /app
EXPOSE 4180
ENTRYPOINT ["sh", "agent/entrypoint.sh"]
CMD ["node", "agent/server.mjs"]
