# Game server image (Coolify, docs/deployment.md "Coolify"). Build context: the repo root.
# The predefined maps ship in the image under /app/maps; the database and imported maps live on the /data volume.
FROM node:24-slim
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund
ENV NODE_ENV=production \
    MBRG_HOST=0.0.0.0 \
    MBRG_PORT=8787 \
    MBRG_DATABASE=/data/mbrg.sqlite
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/apps/server
EXPOSE 8787
# tsx relays SIGTERM to the server, which flushes and stops within 5 s.
CMD ["/app/node_modules/.bin/tsx", "src/main.ts"]
