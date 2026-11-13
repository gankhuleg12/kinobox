# ─────────────────────────────────────────────────────────────
#  KinoBox — нэгдсэн image (Render.com г.м. нэг домэйн deploy)
#  Сайт + API + ffmpeg нэг контейнерт. API нь build хийсэн сайтыг өөрөө үйлчилнэ.
#  RUN_WORKER=true үед background worker мөн энэ процесс дотор ажиллана.
#  (docker-compose-ийн тусдаа image-ууд: server/Dockerfile, client/Dockerfile)
# ─────────────────────────────────────────────────────────────

# ── 1. Frontend build
FROM node:24-bookworm-slim AS client
WORKDIR /client
COPY client/package*.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

# ── 2. Backend build
FROM node:24-bookworm-slim AS server
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
RUN npm ci --no-audit --no-fund
COPY server/prisma ./prisma
RUN npx prisma generate
COPY server/tsconfig*.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

# ── 3. Runtime
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    CLIENT_DIST_DIR=/app/public \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe
WORKDIR /app
# ffmpeg (Debian build-д libx264 + AAC орсон) — видео HLS/MP4 болгоход
RUN apt-get update && apt-get install -y --no-install-recommends openssl ffmpeg tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=server --chown=node:node /app/node_modules ./node_modules
COPY --from=server --chown=node:node /app/dist ./dist
COPY --from=server --chown=node:node /app/prisma ./prisma
COPY --chown=node:node server/package.json ./
COPY --from=client --chown=node:node /client/dist ./public
USER node
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--"]
# Эхлэхдээ migration-ийг хэрэгжүүлнэ (Render free-д pre-deploy command байхгүй)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
