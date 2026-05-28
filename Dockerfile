# syntax=docker/dockerfile:1.6
# Ground Control — multi-stage build. Build stage compiles the React/Vite
# bundle; runtime stage runs the zero-dep Node collector and serves the bundle.

# ── build ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Install build deps (React, Vite, TS — all devDeps).
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source needed for the bundle.
COPY web ./web
COPY server ./server
COPY vite.config.ts tsconfig.json ./
RUN npm run build

# ── runtime ───────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# The collector has zero npm dependencies — we only need the source + built UI.
COPY server ./server
COPY setup ./setup
COPY --from=build /app/server/public ./server/public

ENV NODE_ENV=production \
    GC_PORT=4242 \
    GC_DATA_DIR=/data \
    GC_NOTIFY=0

EXPOSE 4242
VOLUME ["/data"]

# Liveness probe — collector exposes /api/health.
HEALTHCHECK --interval=30s --timeout=2s --retries=3 \
    CMD wget -qO- http://127.0.0.1:4242/api/health || exit 1

CMD ["node", "server/index.mjs"]
