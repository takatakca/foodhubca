# TAKATAK Food Hub — container image for Coolify / any Docker host.
# Keys are given as environment variables by the host (never baked into the image). SOURCE_COMMIT is only a public
# release marker: the Supabase URL (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL) is read when the server runs, not when
# the image is built (lib/supabase/server.ts), and webhook secrets are generated once and kept in the database when
# the host does not set them (lib/foodhub/runtime-secrets.ts). SESSION_SECRET is never generated: set it once in the
# host's environment (without it the sign-in key is derived from DASHBOARD_PASSWORD).
FROM node:22-bookworm-slim
ARG SOURCE_COMMIT=""
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV FOODHUB_RELEASE_SHA=${SOURCE_COMMIT}
LABEL org.opencontainers.image.revision="${SOURCE_COMMIT}"
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=error
COPY . .
# Release checks run on Contabo as well as CI. No host/runtime credentials enter tests or builds.
RUN node -e 'if (!/^[0-9a-f]{40}$/i.test(process.env.FOODHUB_RELEASE_SHA || "")) process.exit(1)'
RUN env -i PATH="$PATH" HOME="$HOME" NEXT_TELEMETRY_DISABLED=1 npm run audit:prod \
 && env -i PATH="$PATH" HOME="$HOME" NEXT_TELEMETRY_DISABLED=1 npm run check \
 && env -i PATH="$PATH" HOME="$HOME" NEXT_TELEMETRY_DISABLED=1 npm run build \
 && env -i PATH="$PATH" HOME="$HOME" NEXT_TELEMETRY_DISABLED=1 \
    FOODHUB_INTERNAL_SYNC_MIN=0 FOODHUB_E2E_MOCK_PORT=18090 FOODHUB_E2E_APP_PORT=18091 npm run verify:foodhub
RUN npm prune --omit=dev --no-audit --no-fund --loglevel=error
# Start the final, pruned runtime without production credentials or remote data. Only this build probe permits
# the expected database-free 503; the real Docker healthcheck below requires health200 and database=ok.
RUN set -eu; \
    env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=18092 \
      FOODHUB_FORCE_MEMORY=true LIVE_CONNECTORS_GLOBAL_ENABLED=false FOODHUB_INTERNAL_SYNC_MIN=0 \
      FOODHUB_WATCH_INTERVAL_S=0 SESSION_SECRET=isolated-build-smoke-session-key DASHBOARD_PASSWORD=isolated-build-only \
      FOODHUB_RELEASE_SHA="$SOURCE_COMMIT" node node_modules/next/dist/bin/next start -p 18092 -H 127.0.0.1 >/tmp/foodhub-build-smoke.log 2>&1 & \
    fh_probe_pid=$!; trap 'kill "$fh_probe_pid" 2>/dev/null || true' EXIT; \
    node -e 'for(let i=0;i<45;i++){try{if((await fetch("http://127.0.0.1:18092/api/release")).status===200)process.exit(0)}catch{}await new Promise(r=>setTimeout(r,1000))}process.exit(1)' --input-type=module; \
    env -i PATH="$PATH" HOME="$HOME" PORT=18092 FOODHUB_FORCE_MEMORY=true LIVE_CONNECTORS_GLOBAL_ENABLED=false \
      FOODHUB_INTERNAL_SYNC_MIN=0 FOODHUB_RELEASE_SHA="$SOURCE_COMMIT" node scripts/check-runtime.mjs --build-smoke
# FOODHUB_INTERNAL_SYNC_MIN=5: the platform sync (store status, Clover orders, timed re-opens/86s, scheduled publishes,
# reports) runs every 5 min inside the server — Coolify/Docker hosts have no system cron. Set 0 to turn it off.
ENV NODE_ENV=production PORT=3000 FOODHUB_MEDIA_DIR=/app/data/media FOODHUB_INTERNAL_SYNC_MIN=5
# Uploaded menu photos. Docker keeps this volume across restarts; on Coolify also add a Persistent Storage mount on
# /app/data/media so photos survive a redeploy (a new container otherwise starts with an empty volume).
VOLUME ["/app/data/media"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=90s --start-period=60s --retries=3 CMD ["node", "scripts/check-runtime.mjs"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
