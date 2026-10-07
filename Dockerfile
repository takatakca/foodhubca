# TAKATAK Food Hub — container image for Coolify / any Docker host.
# Keys are given as environment variables by the host (never baked into the image). No build argument is needed:
# the Supabase URL (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL) is read when the server runs, not when the image is
# built (lib/supabase/server.ts), and SESSION_SECRET / webhook secrets are generated once and kept in the database
# when the host does not set them (lib/foodhub/runtime-secrets.ts).
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
ENV NODE_ENV=production PORT=3000 FOODHUB_MEDIA_DIR=/app/data/media FOODHUB_INTERNAL_SYNC_MIN=5
# Uploaded menu photos. Docker keeps this volume across restarts; on Coolify also add a Persistent Storage mount on
# /app/data/media so photos survive a redeploy (a new container otherwise starts with an empty volume).
VOLUME ["/app/data/media"]
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
