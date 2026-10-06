# TAKATAK Food Hub — container image for Coolify / any Docker host.
# Keys are given as environment variables by the host (never baked into the image).
FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=error
COPY . .
# A failed build must fail the image (never ship a broken console); only the dev-dependency cleanup may be skipped.
RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund --loglevel=error || true
# FOODHUB_INTERNAL_SYNC_MIN=5: the platform sync (store status, Clover orders, timed re-opens/86s, scheduled publishes,
# reports) runs every 5 min inside the server — Coolify/Docker hosts have no system cron. Set 0 to turn it off.
# Mount a persistent volume on /app/data/media (uploaded menu photos).
ENV NODE_ENV=production PORT=3000 FOODHUB_MEDIA_DIR=/app/data/media FOODHUB_INTERNAL_SYNC_MIN=5
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
