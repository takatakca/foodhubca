# TAKATAK Food Hub — container image for Coolify / any Docker host.
# Keys are given as environment variables by the host (never baked into the image).
FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=error
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund --loglevel=error || true
ENV NODE_ENV=production PORT=3000 FOODHUB_MEDIA_DIR=/app/data/media
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
