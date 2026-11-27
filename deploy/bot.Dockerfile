# Discord bot image (Coolify, docs/deployment.md "Coolify"). Build context: the repo root.
# Includes chrome-headless-shell for the map images (spec 038); the bot state lives on the /data volume.
FROM node:24-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates unzip libnss3 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libgbm1 libasound2 libxcomposite1 libxdamage1 libxrandr2 libxfixes3 libpango-1.0-0 libcairo2 libatk1.0-0 libdbus-1-3 \
    libexpat1 libglib2.0-0 fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund
# Pinned to the chrome-headless-shell revision of puppeteer-core 25.19.0.
RUN npx @puppeteer/browsers install chrome-headless-shell@158.0.8127.88 --path /opt/chrome \
 && ln -s "$(find /opt/chrome -type f -name chrome-headless-shell | head -n 1)" /usr/local/bin/chrome-headless-shell
# No Chrome sandbox: the host (Ubuntu 24.04) blocks the unprivileged user namespaces it needs ("No usable sandbox!"); the
# container is the isolation boundary and Chrome only opens our own viewer.
ENV NODE_ENV=production \
    MBRG_CHROME_PATH=/usr/local/bin/chrome-headless-shell \
    MBRG_CHROME_NO_SANDBOX=1 \
    MBRG_BOT_STATE_FILE=/data/bot-state.json
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/apps/bot
CMD ["/app/node_modules/.bin/tsx", "src/main.ts"]
