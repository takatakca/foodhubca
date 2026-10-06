# Back online today: emergency checklist

For when the restaurants are not receiving orders. Do **Part A first**: it reopens sales without waiting for Food Hub or for any platform's API approval. Part B puts Food Hub live alongside it.

## Part A: Take orders again right now (no code involved)

UrbanPiper is cancelled. Any store that a platform still sends to "UrbanPiper / POS integration" is sending its orders nowhere. Switch each store back to **tablet orders** until Food Hub's direct connection is approved.

| Platform | What to do today | Who |
|---|---|---|
| **Uber Eats** | Remove the UrbanPiper integration from each store, so orders go to the Uber Eats Orders app or tablet. In Uber Eats Manager, check the store's integrations; if it is not there, call Uber Eats merchant support and ask to "disconnect the POS integration and go back to the tablet". | You |
| **DoorDash** | Ask DoorDash (Merchant Portal or support) to switch each store's order protocol back to **tablet**. Better for the kitchen: turn on **DoorDash's own Clover integration**, so orders land straight in Clover and print. Food Hub then reads them (Part B, step 7). | You |
| **SkipTheDishes** | Call Skip support: switch each store back to the **Skip tablet** (no POS integration). | You |
| **Too Good To Go** | Not affected (TGTG app). | — |

Check that each store is **open/online** on each platform (not paused or deactivated), and that each tablet is charged, logged in and has sound on.

## Part B: Food Hub live on Coolify (about 1 hour)

1. **Code:** deploy from `main` once the "go live" pull request is merged (it has the Order Relay, shared menus and fixes). In Coolify: Redeploy.
2. **Database (once):** Supabase → SQL Editor → run `supabase/INSTALL_ALL.sql`.
3. **Environment variables in Coolify.** This is the minimum to run:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...            # Supabase → Project settings → API
   SUPABASE_SERVICE_ROLE_KEY=...           # same page (secret)
   DASHBOARD_PASSWORD=<long password>      # owner recovery sign-in: user "owner"
   SESSION_SECRET=<openssl rand -hex 32>   # keep it fixed (changing it signs everyone out)
   FOODHUB_PUBLIC_URL=https://<your domain>
   FOODHUB_TRUST_PROXY=true                # Coolify runs behind Traefik
   FOODHUB_OWNER_EMAIL=matt@takatak.ca
   CLOVER_MERCHANT_ID=...                  # or CLOVER_MERCHANT_TOKENS for several merchants
   CLOVER_ACCESS_TOKEN=...
   LIVE_CONNECTORS_GLOBAL_ENABLED=false    # true only when Go-live is green
   ```
   - Optional, for sign-in codes and alerts: `RESEND_API_KEY` + `AUTH_EMAIL_FROM`, `TWILIO_*`, and `ANTHROPIC_API_KEY` for AI.
   - Add a persistent volume on `/app/data/media`.
   - The image already runs the background sync every 5 minutes (`FOODHUB_INTERNAL_SYNC_MIN=5`).
4. **Sign in:** `https://<domain>/login` → owner recovery sign-in (`owner` + `DASHBOARD_PASSWORD`). There must be **no "Demo mode" banner**; if there is one, step 3's Supabase keys are wrong.
5. **Business setup:**
   - Settings → Business: locations and brands.
   - Settings → Team: managers with cell phones and PINs.
6. **Menu:**
   - Menus → pick one brand → **Import from Clover**.
   - Click **Shared menu**, choose that brand, then "All", and Save. Every brand now uses that one menu.
7. **DoorDash through Clover (works today if Part A's Clover integration is on):**
   - Set `FOODHUB_VIA_CLOVER=doordash` and redeploy.
   - DoorDash orders then show in Food Hub (read from Clover). Menu and 86s for DoorDash are done in Clover.
8. **Kitchen tablets:**
   - Settings → Tablets → enrol each kitchen tablet.
   - On the tablet, open `https://<domain>/kitchen`, enter a PIN, tap once to turn sound on, and add the page to the home screen.
9. **Check:**
   - Settings → Go-live: every required step green.
   - Settings → Platforms & Clover: Clover connected.

## Part C: Direct platform connections, as each approval arrives

Each one replaces the platform's tablet with Food Hub (orders into Clover, printed and accepted automatically).

- **Uber Eats:**
  - Enter `UBER_CLIENT_ID` and `UBER_CLIENT_SECRET` (Uber developer dashboard, with the eats.* scopes approved).
  - Then Stores → **Connect Uber Eats**, Menus → Publish, then `LIVE_CONNECTORS_GLOBAL_ENABLED=true`.
- **DoorDash direct:**
  - Enter `DOORDASH_DEVELOPER_ID`, `DOORDASH_KEY_ID`, `DOORDASH_SIGNING_SECRET` and `DOORDASH_PROVIDER_TYPE` (DoorDash issues this after approval).
  - Remove `doordash` from `FOODHUB_VIA_CLOVER`.
  - Map the stores, then publish.
- **Skip:**
  - Enter `SKIP_JET_API_KEY` (from the Skip partner manager).
  - Give Skip the 6 webhook addresses shown in Settings → Platforms.
  - Map the stores.
- **Too Good To Go:** once the rep sends access and their format, wire it through the Order Relay (`docs/ORDER_RELAY.md`) or a direct adapter.
- **Before switching live:**
  - Never connect a platform both directly **and** through Clover: each order would arrive twice.
  - Switch a platform from tablet to Food Hub only after its first test order goes all the way to Clover.

Full picture and next phases: `docs/MASTER_PLAN.md`.
