# Go-Live Steps

The complete, current guide is **[FOODHUB.md](FOODHUB.md)** (direct integrations — no UrbanPiper).

Short version:

1. Supabase → SQL Editor → run `supabase/INSTALL_ALL.sql`.
2. `npm install && npm run setup` (keys stay on your machine; webhook secrets are generated).
3. Deploy (e.g. Vercel) with the same environment variables + `FOODHUB_PUBLIC_URL`.
4. Channels & Setup → give each platform its webhook URLs and secrets (Clover, Uber Eats,
   DoorDash, SkipTheDishes via JET Connect, optional Too Good To Go).
5. Stores → *Connect Uber Eats stores*; map DoorDash and Skip store ids.
6. Menu Manager → Import from Clover → Publish.
7. `/go-live` must show every required step Done → set `LIVE_CONNECTORS_GLOBAL_ENABLED=true`.
8. Open the Command Center (`/`) on a screen — it syncs store status and Clover sales every 2 minutes.
