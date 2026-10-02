# TAKATAK Food Hub + Finance Control Tower

Your own direct connection to **Uber Eats, DoorDash, SkipTheDishes, Too Good To Go and Clover** —
no UrbanPiper, no aggregator, no monthly integration fee — on **one screen**.

- **Command Center** (`/`): sales today (delivery + Clover in-store), orders to handle with
  countdowns, alerts, every app's status, every brand × location × app, sales by hour/brand/location.
- Orders arrive by signed webhook → go straight into Clover → are accepted automatically.
- One master menu per brand → published to every app; 86 items and pause stores everywhere in one click.
- Store status and Clover in-store sales sync every 2 minutes, automatically.
- Everything Atlas (UrbanPiper) gives you, built in: order history + timelines, cancel/reject reasons,
  busy mode + prep time, Clover ticket printing, store hours + holidays, category schedules, menu checks,
  scheduled publish, modifier 86, analytics, 7 reports (CSV/Excel/email/schedules), activity log,
  team logins with roles and location limits. Feature-by-feature: [docs/ATLAS_PARITY.md](docs/ATLAS_PARITY.md).
- **Where is my money**: every order checked against your commission plan and the platforms' payout
  statements (Uber Eats sends its own) → missing orders, short payments, error charges and refunds
  become dispute cases; bank deposits; internal ledger with GST/QST, approved by you.
- Clover follows each order to the end: platform order type, paid with a platform tender when it leaves
  the kitchen, cancelled orders removed; out of stock in Clover → 86 on every app.
- Couriers, scheduled orders, Skip missing items + backup flow, Too Good To Go bag log, French menus,
  installable kitchen tablet app.

**Full guide: [docs/FOODHUB.md](docs/FOODHUB.md)** — exactly what to request from each platform and where to paste it.

## Quick start

```bash
npm install
npm run setup          # asks for keys, writes .env.local on your machine, generates webhook secrets
npm run dev            # http://localhost:3000  → sign in as "owner" with your DASHBOARD_PASSWORD
```

Database: paste `supabase/INSTALL_ALL.sql` into the Supabase SQL editor and click Run once.
Without Supabase the app runs in demo memory mode (the screen says so).

## Proof

```bash
npm test                                  # 62 unit tests
npm run build && npm run verify:foodhub   # 275 end-to-end checks against simulated Uber Eats,
                                          # DoorDash, Skip (JET Connect), Clover and Resend
npm run demo:foodhub                      # keeps running with a simulated order every 40 s
npm run release:check                     # what is configured / missing (never prints secrets)
```

## Screens

| Path | Screen |
|---|---|
| `/` | Command Center (one screen; *Screen mode* for a wall TV) |
| `/login` | Sign in (owner = `DASHBOARD_PASSWORD`; staff accounts from Users & Roles) |
| `/foodhub` | Order Board (New → Preparing → Ready → Picked up → Done) |
| `/foodhub/orders` | Order history, filters, search, CSV/Excel; click an order for its timeline + ticket |
| `/foodhub/menu` | Menu Manager (check, publish now or scheduled, category schedules, item details) |
| `/foodhub/availability` | 86 Board (items and options, per location, timed) |
| `/foodhub/hours` | Store Hours (locations, brand exceptions, holidays) |
| `/foodhub/stores` | Stores (incl. *Connect Uber Eats stores*, prep time, busy mode) |
| `/foodhub/analytics` | Analytics (any period vs the previous one) |
| `/foodhub/reports` | 7 reports — download, email, schedule |
| `/foodhub/activity` | Activity log (who did what, and whether the platform accepted it) |
| `/foodhub/channels` | Channels & Setup (webhook URLs + secrets to give platforms) |
| `/foodhub/business` | Brands & Locations |
| `/foodhub/users` | Users & Roles |
| `/foodhub/tgtg` | Too Good To Go daily bag log |
| `/go-live` | Go-Live Checklist (computed from your real configuration) |
| `/finance` | Payouts & Reconciliation — where is my money |
| `/finance/reconciliation` · `/disputes` · `/payouts` · `/ledger` · `/imports` · `/fees` | Orders vs payouts, disputes, bank deposits, internal ledger, statements, commission plans |
| `/fix-tasks`, `/store-health`, `/service-check` … | Control Tower (fix tasks incl. payout problems, store health, 3-service check, documents) |

## Locked rules

- `(Z)` = active but closed · `(I)` = deactivated · grey circle = deactivated · normal = active
- Required services per brand/location: DoorDash, Uber Eats, SkipTheDishes (TGTG is extra)
- TAKATAK Food Hub = control/matching layer (direct integrations, no aggregator)
- Clover = POS / kitchen / in-store sales · TAKATAK Internal Ledger = main control ledger
- QuickBooks = optional/later export only · AI = supervisor only (never posts, approves or deletes)
- Never accept an order Clover did not receive · never show a platform action as done when it was not sent
- Keys only through `npm run setup` or hosting environment variables — never in chat
- `DASHBOARD_PASSWORD` is mandatory once `LIVE_CONNECTORS_GLOBAL_ENABLED=true`

## Project layout

```text
app/                    pages + API routes (app/api/foodhub/* = Food Hub, app/api/backend/* = finance)
lib/foodhub/            adapters (uber-eats, doordash, skip = JET Connect, partner = TGTG), Clover,
                        order pipeline, sync engine, command center aggregation, menu translators
supabase/INSTALL_ALL.sql  one-paste database install (regenerate: node scripts/build-install-sql.mjs)
scripts/                setup wizard, e2e verification, readiness checks
data/actual/            your locations, brands and the 43 DoorDash stores from your screenshots
docs/FOODHUB.md         the go-live guide
docs/ATLAS_PARITY.md    Atlas module → TAKATAK equivalent → status
```
