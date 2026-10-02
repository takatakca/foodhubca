# RC3 — Fixes Applied and Verified

This build (RC3) is RC2 with the following verified fixes. No locked business
rules were changed (Z / I / grey-circle status rules, required services,
UrbanPiper control layer, TAKATAK internal ledger, AI supervisor-only,
QuickBooks optional/later).

## Bugs fixed

1. **Production build failure (webhook route).**
   `app/api/backend/webhooks/[platform]/route.ts` used the old Next.js params
   signature. Next.js 15+ passes `params` as a Promise. Fixed; `npm run build`
   now completes.

2. **Live health check crashed without Supabase.**
   `GET /api/backend/connectors/live-health` returned HTTP 500 before Supabase
   was configured, because health logging created a Supabase client
   unconditionally. Logging is now best-effort: skipped when Supabase env is
   missing, and insert failures never break the health result.

3. **Unhandled errors returned raw 500s.**
   `live-health`, `autodiscover-live`, `sync-now`, and `controlled-sync` now
   return clean JSON errors, with HTTP 400 for unsupported platform keys.

4. **`sync-now` without Supabase.**
   Now returns a clear 503 JSON explaining that persisting ingested records
   requires Supabase, and points to `controlled-sync` for a non-persisting
   preview, instead of crashing mid-run.

5. **AI ingestion review without Supabase.**
   `GET /api/backend/ai/live-ingestion-review` now returns a friendly
   `configured:false` payload instead of an error page.

6. **TypeScript config deprecation.**
   Added `"ignoreDeprecations": "6.0"` so `tsc --noEmit` passes on current
   TypeScript.

## Features completed

7. **/integrations/live is now a working control panel.**
   Each platform card loads credential readiness live and has working
   **Test connection**, **Auto-discover**, and **Sync now** buttons wired to
   the backend APIs, with results shown inline. Previously this page was
   static instructions only.

8. **Sidebar navigation.**
   Added missing links: Live Connectors, Credential Setup, Go-Live Checklist,
   AI Ingestion.

## Verified in this build

- `npx tsc --noEmit` — passes
- `npm run build` — passes (29 routes)
- `npm test` — 3/3 pass
- `npm run release:check` and `npm run sync:dry-run` — pass (credential
  warnings expected until secrets are added)
- End-to-end pipeline test against a simulated UrbanPiper API:
  health check → auto-discovery (4 locations) → controlled sync (4 records)
  → AI supervisor produced 2 findings, correctly detecting `(I)` deactivated
  and `(Z)` active-but-closed store markers.

## Still required to go fully live (cannot be done without your accounts)

- Create a Supabase project and run the 6 SQL files in order (see README).
- Fill `.env.local` (copy from `.env.example`) with Supabase keys, then real
  platform credentials — UrbanPiper first, then Clover, then delivery
  platforms. Secrets go in env vars / hosting secrets only, never in chat,
  Git, or database tables.
- Set `LIVE_CONNECTORS_GLOBAL_ENABLED=true` only after health checks pass.
- Confirm exact API endpoints per platform once real access is granted
  (UrbanPiper order/report paths, Clover OAuth, DoorDash reporting access,
  Uber Eats OAuth approval, Skip partner access, TGTG export path). The
  connector adapters are structured for this; only the endpoint specifics
  depend on the access level each platform grants you.
- Per-platform webhook signature validation before enabling webhook
  processing in production.
- Production RLS review once auth/users are connected.
