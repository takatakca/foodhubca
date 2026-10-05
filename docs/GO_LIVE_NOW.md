# GO LIVE NOW — the shortest path

The complete, current guide is **[FOODHUB.md](FOODHUB.md)** (direct integrations — no UrbanPiper).

Short version:

1. Supabase → SQL Editor → run `supabase/INSTALL_ALL.sql`.
2. `npm install && npm run setup` (keys stay on your machine; webhook secrets and `SESSION_SECRET` are generated — keep both `DASHBOARD_PASSWORD` and `SESSION_SECRET` in the hosting environment).
3. Deploy (e.g. Vercel) with the same environment variables + `FOODHUB_PUBLIC_URL`.
4. Channels & Setup → give each platform its webhook URLs and secrets (Clover, Uber Eats,
   DoorDash, SkipTheDishes via JET Connect, optional Too Good To Go).
5. Stores → *Connect Uber Eats stores*; map DoorDash and Skip store ids.
6. Menu Manager → Import from Clover → Publish.
7. `/go-live` must show every required step Done → set `LIVE_CONNECTORS_GLOBAL_ENABLED=true`.
8. Keep the sync running: the Command Center (`/`) syncs store status, Clover sales, timed re-opens and scheduled
   publishes every 2 minutes while it is open on a screen. When no screen is open, a pinger must call
   `GET /api/foodhub/cron/sync` with `Authorization: Bearer <CRON_SECRET>` every 5 minutes (Vercel Pro cron or
   cron-job.org) — Vercel Hobby only runs the daily cron in `vercel.json`. The Command Center warns after
   10 minutes without a sync.
