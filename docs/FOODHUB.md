# TAKATAK Food Hub — your own direct connections (no aggregator, no monthly fee)

TAKATAK Food Hub replaces UrbanPiper. It talks **directly** to Uber Eats, DoorDash,
SkipTheDishes and Clover, so there is no aggregator in the middle and no monthly
integration fee. Everything shows on one screen: the **Command Center** (`/`).

```
Uber Eats ─┐                                   ┌─► Clover (kitchen gets the order)
DoorDash ──┼─► webhook ─► TAKATAK Food Hub ────┼─► accept on the platform
Skip ──────┤    (signed)                       └─► Command Center (one screen)
TGTG ──────┘
             ◄── status sync every 2 min: Uber + DoorDash store status, Clover in-store sales
```

## What runs by itself

| Automatic | What happens |
|---|---|
| New order | Arrives by signed webhook → saved → created in Clover → accepted on the platform, in seconds. Duplicate deliveries are ignored. |
| Clover is down | The order is **never** accepted blind. Uber Eats / DoorDash: it waits on the Command Center with a countdown (Uber gives 11.5 min). Skip: it is handed to the Skip tablet right away (JET backup flow). |
| Store status | Every 2 minutes while the Command Center is open (or by schedule): Uber Eats and DoorDash store status is read; Skip pushes its offline/cancel notices. Closed (Z), paused and deactivated (I / grey) are shown per brand × location × app. |
| In-store sales | Clover payments since local midnight, minus refunds, **excluding** delivery orders Food Hub put in Clover (no double counting). |
| Alerts | Waiting orders, Clover failures, deactivated or platform-paused stores, missing required services (DoorDash + Uber Eats + Skip for every brand/location), unreadable webhooks, failed menu/item/store actions. |
| Menu / 86 / pause | One click → every platform. Timed pauses re-open by themselves (each platform's native timer). |
| Housekeeping | Orders still "in kitchen" after 90 minutes are closed automatically (logged; `FOODHUB_AUTO_COMPLETE_MIN`), so the screen only shows what needs you. |
| Clover bookkeeping | Every delivery order gets its platform **order type** in Clover. When it leaves the kitchen (picked up, completed, delivered, auto-closed) it is recorded **paid** with an "Uber Eats" / "DoorDash" / "SkipTheDishes" / "Too Good To Go" tender, so the Clover closeout matches. Cancelled before that → removed from the Clover register. (Clover payments cannot be deleted by API — that is why payment waits for the hand-off.) |
| Clover → every platform | An item made unavailable / out of stock in Clover is 86'd on Uber Eats, DoorDash and Skip at every location on that Clover, and comes back by itself; an 86 made by staff in Food Hub is never undone. A price changed in Clover is flagged — one click uses it. Instant with Clover webhooks, otherwise checked on every sync. |
| Scheduled orders | Orders due later (60 min+, `FOODHUB_SCHEDULED_AFTER_MIN`) are accepted and put in Clover right away (⏰ SCHEDULED), but the kitchen ticket prints at due time − prep time. They wait in their own lane. |
| Couriers | Skip driver status, DoorDash Dasher status and Uber courier details show on the order (name, car, arriving / at the store). Picked up → "Picked up"; delivered → "Completed". |
| Skip extras | Out-of-stock item after accepting → *Report missing item* (Skip adjusts the bill). Orders Skip sent straight to the tablet (backup flow) are recorded and alerted, never invisible. |
| Payouts | After each statement import and once a day: every order is checked against its commission plan and the statements. Missing, short-paid, error charges, refunds and paid orders Food Hub never received open dispute cases by themselves, and close by themselves when a later payout fixes them. Uber Eats statements can arrive by themselves (Reporting API). |

## Setup — once

### 1. Database (Supabase, free tier is fine)
Create a project at supabase.com → SQL Editor → paste **`supabase/INSTALL_ALL.sql`** → Run.

### 2. Keys — on your computer only
```bash
npm install
npm run setup     # asks for each key, writes .env.local, generates the webhook secrets
npm run dev       # http://localhost:3000  → sign in as "owner" with your DASHBOARD_PASSWORD
```
Never paste keys in a chat or an email. For hosting (Vercel), copy the same values into
Project → Settings → Environment Variables, and set `FOODHUB_PUBLIC_URL` to your domain.

### 3. Connect each platform

Everything you must give a platform (URLs and secrets) is on **Channels & Setup**
(`/foodhub/channels`) → *Show secrets to give platforms*.

**Clover** (orders into the kitchen + menu import + in-store sales)
1. Clover web dashboard → *Account & Setup* → *API Tokens* → create a token with
   **Inventory: read**, **Orders: read + write**, **Payments: read + write**, **Merchant: read + write**
   (payments + merchant are for the platform tenders and order types).
2. `npm run setup` → `CLOVER_MERCHANT_ID` (13 characters, in the dashboard URL) and `CLOVER_ACCESS_TOKEN`.
3. Other locations with their own Clover: `CLOVER_MERCHANT_TOKENS={"MERCHANT_ID":"token",...}`
   and pick that merchant on the store mapping.
4. Optional, instant 86 from Clover: in a Clover developer app, set the webhook URL shown on Channels
   (`/api/foodhub/webhooks/clover`), subscribe to *Inventory*; Clover sends a verification code that
   Food Hub shows on Channels — paste it back in Clover; put the auth code Clover then shows in
   `CLOVER_WEBHOOK_AUTH`. Without it, the same sync runs every few minutes.

**Uber Eats** (direct Marketplace API)
1. developer.uber.com → create an app → request Uber Eats Marketplace access
   (scopes `eats.order`, `eats.store`, `eats.store.status.write`, `eats.pos_provisioning`, and
   `eats.report` for automatic payment reports).
   Uber approves the app — this is on Uber's side.
2. `npm run setup` → Client ID + Client Secret.
3. In the Uber app settings: webhook URL `https://YOUR-DOMAIN/api/foodhub/webhooks/uber-eats`
   and redirect URI `https://YOUR-DOMAIN/api/foodhub/uber-connect/callback` (both shown on Channels).
4. Food Hub → **Stores → Connect Uber Eats stores** → sign in with the Uber Eats Manager owner
   account → brand and location are pre-filled from each store's name/address → **Activate & map**.

**DoorDash** (Marketplace API — DoorDash grants access per partner)
1. developer.doordash.com → request Marketplace API access → Developer ID, Key ID, Signing Secret.
   DoorDash gives you a `provider_type` when they approve the integration.
2. `npm run setup` → those 4 values.
3. Give DoorDash: webhook URL `https://YOUR-DOMAIN/api/foodhub/webhooks/doordash` and the
   Authorization header value (Channels → Show secrets), for Order, Menu Status **and Dasher Status** events.
4. For each store, agree a `merchant_supplied_id` with DoorDash (e.g. `NDG_MAIN-POPOULET`) and
   enter the same id on Stores.

**SkipTheDishes** (JET Connect — Skip is part of Just Eat Takeaway)
1. Ask your Skip partner manager for **JET Connect POS integration** for your own POS.
   They issue the `X-Flyt-Api-Key` → `npm run setup` → `SKIP_JET_API_KEY`.
2. Give Skip (Channels → Skip card): the order URL, cancel URL, offline URL, **driver status URL**,
   **failed order (backup flow) URL**, the **webhook HMAC secret** and the **API key for notifications**.
   The menu callback is automatic.
3. For each Skip restaurant, agree a `posLocationId` (e.g. `NDG-POPOULET`) and enter it on Stores.
4. Skip has no "order ready" call; couriers follow the collect time. If Skip sends a payload in a
   shape Food Hub does not know, it is kept under *Channels → Unparsed payloads* — nothing is lost.

**Too Good To Go**
TGTG has no public merchant API — bags are set in the TGTG Store app. At closing, enter the day on
**TGTG Bags** (bags offered, sold, price): it becomes a TGTG sale in the Command Center, analytics,
reports and reconciliation. If TGTG gives you an order feed, give them
`https://YOUR-DOMAIN/api/foodhub/webhooks/tgtg` and the token from Channels; bag orders then go to
Clover too, and the day log is not counted twice.

### 4. Hours, menu, stores, team, go live
1. **Store Hours** → opening hours for each location (several slots a day, overnight is fine),
   brand exceptions, and holidays (*Add Québec holidays* fills the fixed ones). Without hours a
   published menu shows 24/7.
2. **Menu Manager** → *Import from Clover* per brand → platform prices, descriptions, photos (link),
   tags, allergens, category schedules (e.g. lunch) → fix anything in *Menu check* → *Publish…*
   (now, or scheduled; all stores or chosen ones).
3. **Stores** → map every brand + location on each app (Uber is one click, see above); set the
   normal and busy prep time per location.
4. **Users & Roles** → one login per person; store staff can be limited to their location.
5. **Menu Manager → Languages** → French names (item, category, option) and which language each
   app gets: Uber Eats bilingual by default, DoorDash / Skip English or French.
6. **Payouts & Money → Commission Plans** → check your plan per app (Uber Eats and DoorDash
   rate cards are pre-filled; Skip and TGTG from your contract) and tick *Matches my contract*.
7. **Go-Live Checklist** (`/go-live`) shows what is left, computed from your real configuration.
8. Last step: `LIVE_CONNECTORS_GLOBAL_ENABLED=true`. Before that, orders are received and shown,
   but nothing is sent back to the platforms. A `DASHBOARD_PASSWORD` is mandatory once live.

### 5. 24/7 status sync (optional)
The Command Center syncs every 2 minutes while it is open (leave it on a screen in the
kitchen/office — *Screen mode* hides the menu). For sync even when no screen is open:
- `vercel.json` already schedules a daily sync (works on every Vercel plan). On Vercel Pro, change
  the schedule to `*/5 * * * *`.
- Or use any free pinger (e.g. cron-job.org): `GET https://YOUR-DOMAIN/api/foodhub/cron/sync`
  with header `Authorization: Bearer <CRON_SECRET>` every 5 minutes.

## Payouts & money — where is my money

1. **Statements** — import each payout statement (CSV or Excel). Uber Eats *Payment details* and
   DoorDash transaction exports are recognised; any other layout (Skip, TGTG) asks once which column
   is the order number and which is the net amount, then is remembered. Uber Eats can send its
   report by itself: *Request from Uber*. The same line imported twice is counted once.
2. **Orders vs payouts** — every order: what the customer paid, what you should get (sales + tax −
   commission − tax on commission), what the statement paid, the difference and why.
3. **Disputes** — missing orders, short payments, error charges and refunds, opened automatically
   with the amount. Note the platform's case number, then *Recovered* or *Written off*.
   "Paid order not in Food Hub" is a data gap (missed webhook / unmapped store), not money lost.
4. **Payouts & deposits** — each payout from its statement; enter the bank deposit to check it.
5. **Internal ledger** — one balanced journal entry per payout: bank, delivery sales, GST + QST
   collected, commissions, GST + QST paid on fees (input tax credits), promotions, refunds, ads.
   Drafts until you approve; nothing is posted anywhere. *Download CSV* for your accountant.

Finance covers every location's money, so it is only for logins that see all locations.

## Daily use

| Screen | Use it for |
|---|---|
| **Command Center** `/` | Everything at once: sales today (delivery + in-store), orders to handle with countdowns, alerts, each app's sales and connection, every brand × location × app status (click a cell to pause / resume), sales by hour, top brands, by location. Sound on new orders. |
| Order Board | Today's orders: New → Preparing → Ready → Picked up → Done. Reject / cancel with a reason. |
| Orders | History with filters and search; each order shows its full timeline, Clover id, ticket and reprint. |
| Menu Manager | Master menu per brand, platform prices, item details, category schedules, menu check, publish now or later. |
| 86 Board | Items **and options** off/on per location or everywhere, for a set time or until you turn them back. |
| Store Hours | Opening hours, brand exceptions, holidays → published to every platform. |
| Stores | Map store ids, connect Uber stores, pause/resume a whole location, prep time and busy mode. |
| Analytics | Sales, orders, average order, cancellations (who / when / why), items, busiest hours, accept & prep times, store uptime — vs the previous period. |
| Reports | 7 reports in CSV or Excel; *Email* sends one now, *Schedule* sends it daily / weekly / monthly (needs `RESEND_API_KEY` + `REPORT_EMAIL_FROM`). |
| Activity Log | Who paused, 86'd, published, changed hours or users, signed in — and whether the platform accepted it. |
| Users & Roles / Brands & Locations | Team logins (owner, manager, store operator, menu editor, analyst) and your business structure. |
| TGTG Bags | 10 seconds at closing: bags offered, sold, price per location. |
| Payouts & Money | Where is my money, orders vs payouts, disputes, deposits, internal ledger, statements, commission plans. |

**Kitchen tablet app.** Open Food Hub on the tablet → browser menu → *Add to Home Screen* /
*Install app*. It opens full screen, keeps the screen awake (🔔 Alerts → keep awake) and shows a red
bar if the connection drops.

**Kitchen printing.** Every order that reaches Clover prints a kitchen ticket on the Clover printer
(`FOODHUB_CLOVER_AUTOPRINT=on`, optional `CLOVER_PRINT_DEVICE_ID`); *Reprint* sends it again, and
*Print ticket* opens an 80 mm ticket for any receipt printer.

**Alerts on each screen.** 🔔 *Alerts* sets the sound, repeat-until-handled, platform-cancel and
desktop notifications for that device (kitchen tablet and office PC can differ).
| Channels & Setup | Connection status, webhook URLs, secrets to give platforms, recent jobs, unparsed payloads. |

## Rules that never change
- Never accept an order Clover did not receive.
- Never show a platform action as done when it was not sent (`blocked` / `skipped` are shown as such).
- Store status checks are read-only; changes (pause, 86, menu, accept) need the live switch.
- Keys only through `npm run setup` or the host's environment variables — the dashboard never shows
  platform API keys; it only reveals the webhook secrets *you* give to platforms.

## Proof
```bash
npm test                                   # 62 unit tests (signatures, parsers, menus, hours, 86, roles, reports,
                                           # analytics, statements, expected payouts, ledger, couriers, scheduling)
npm run build && npm run verify:foodhub    # 275 end-to-end checks against simulated Uber Eats (incl. Reporting API),
                                           # DoorDash, Skip (JET Connect), Clover and Resend
npm run demo:foodhub                       # same, then keeps running with a new order every 40 s
```

## Honest limits
- Each platform must approve API access (Uber app review, DoorDash Marketplace access, Skip JET
  Connect). Food Hub is ready; the approvals are on their side and are free.
- Payouts are only as complete as the statements: DoorDash, Skip and TGTG statements are imported by
  you (Uber Eats can send its own). Commission defaults are the public Canadian rate cards — confirm
  yours. GST/QST in the ledger is for your accountant to review.
- Clover payments cannot be deleted or refunded by API: an order cancelled *after* it was recorded
  paid is flagged on the order and in the Activity Log — refund it in the Clover app if needed.
- DoorDash and Skip do not let a store cancel an accepted order by API — cancel in their portal /
  tablet; Food Hub updates the order when they confirm. Prep time / busy mode is sent to DoorDash with
  each confirmation; for Uber Eats and Skip it is printed on the ticket only — set their prep time in
  their own store settings.
- Too Good To Go has no public store API: bags are logged, not synced.
- What Atlas has that is not built yet (combos, ratings and reviews, own-courier dispatch for phone
  orders, SSO) is listed in [ATLAS_PARITY.md](ATLAS_PARITY.md).
