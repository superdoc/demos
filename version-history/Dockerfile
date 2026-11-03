FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY server ./server
ENV HOST=0.0.0.0 DATA_DIRECTORY=/data
EXPOSE 4191
CMD ["node", "server/server.mjs"]
