# TAKATAK Food Hub — RC10

Your own direct connection to **Uber Eats, DoorDash, SkipTheDishes, Too Good To Go and Clover** —
no UrbanPiper, no aggregator, no monthly integration fee — with a kitchen-first console in French and English.

**What RC10 adds**
- **Sign-in without passwords**: a 6-digit code (or one-tap link) by email or SMS. Kitchen tablets show a **PIN screen**.
- **New order → beep beep → full screen**: accept in one tap with the prep time, or reject with a reason. Loops until someone looks.
- **Order cancelled by the customer or the platform → red alarm** on every screen until someone taps "Got it — stopping".
- **Manager PIN**: staff cannot reject, cancel, refund, pause a store, change a price or text a customer alone
  (you choose per action). Every approval is logged with the approver's name.
- **Watchtower** (background supervisor): orders waiting, orders nobody looked at, late orders, couriers waiting,
  Clover failures, stores offline or deactivated, **tablet off or muted**, cancellation spikes, money to recover.
  It rings the screen, **calls the kitchen phone** (like Uber), **texts then calls the managers on duty**, then the
  owner and the support line, and posts to the team chat. Claude explains each alert (optional); without a key,
  built-in rules do. AI only explains — it never approves, refunds, posts or deletes anything.
- **Text / call the customer** from the order (when the platform shares a number), with ready-made late messages.
- **Copilot** (⌘K → ✨): ask "what's wrong right now?" in plain French or English.
- A redesigned console: Overview, Orders, Kitchen (KDS), Stores, Menus, Alerts, Insights, Money, Settings.

Everything from RC9 stays: Clover injection and bookkeeping, menus to every platform, 86 and pauses,
hours and holidays, reports, analytics, payouts reconciliation, disputes, internal ledger, TGTG bag log.

**Full guide: [docs/FOODHUB.md](docs/FOODHUB.md)**
All documents: [docs/README.md](docs/README.md) · what changed in this release: [docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md) ·
security policy: [SECURITY.md](SECURITY.md).

## Quick start

```bash
npm install
npm run setup     # asks for each key on YOUR computer, writes .env.local, generates secrets
npm run dev       # http://localhost:3000 → "Create the owner account" with your email → enter the code
```

Database: paste `supabase/INSTALL_ALL.sql` into the Supabase SQL editor and click Run once
(it includes the RC10 changes; regenerate with `npm run sql:install`). Without Supabase the app runs in demo memory mode.

**Your own server (Contabo VPS):** `sudo bash deploy/install-vps.sh foodhub.takatak.ca` installs everything with HTTPS and the 24/7 Watchtower — step by step in French: [docs/INSTALLER_SERVEUR.md](docs/INSTALLER_SERVEUR.md).

Then: **Settings → Team** (managers with cell + PIN, staff with PIN) → **Settings → Tablets** (open Food Hub on
each kitchen tablet and "Enrol this screen") → **Settings → Business** (each kitchen's phone) →
**Settings → Go-live** (the checklist, computed from your real configuration).

Keys only through `npm run setup` or the hosting environment variables — never in chat.

## Proof

```bash
npm run check                              # typecheck + lint + 190 unit tests
npm run build && npm run verify:foodhub    # 382 end-to-end checks against simulated Uber Eats, DoorDash,
                                           # Skip (JET Connect), Clover, Resend, Twilio and a team chat
npm run demo:foodhub                       # same, then keeps running with a simulated order every 40 s
npm run audit:prod                         # production dependencies carry no high/critical advisory
```

CI runs every one of these on each push and pull request (`.github/workflows/ci.yml`).

## Screens

| Path | Screen |
|---|---|
| `/login` | Sign in: email or cell → 6-digit code (or the link). First run: create the owner. Recovery password link at the bottom. |
| `/kitchen/lock` | Kitchen tablet PIN screen (beeps when orders wait, red when one is cancelled) |
| `/` | Overview: what needs you now, sales, platforms, kitchens, tablets, store health (brand × location) |
| `/orders` | Live board (New → Preparing → Ready → Out) + scheduled; History with filters and CSV; `/orders/{id}` full page |
| `/kitchen` | Kitchen display (big cards, bump, busy mode, full screen) |
| `/stores` · `/stores/hours` · `/stores/mapping` | Pause / resume / busy per location · hours and holidays · platform store mapping (+ Connect Uber Eats) |
| `/menu` · `/menu/86` | Menu editor and publish · 86 board |
| `/alerts` | Watchtower incidents (escalation steps, explanation, I'm on it / fixed / snooze, text the customer) and the message log |
| `/insights` · `/insights/reports` · `/insights/activity` | Analytics · 7 reports (download, email, schedule) · who did what |
| `/money` | Where is my money · `/reconciliation` · `/disputes` · `/payouts` · `/ledger` · `/statements` · `/fees` · `/tgtg` |
| `/settings` | Profile and PIN · Team · Tablets · Manager PIN rules · Alerts · Platforms and Clover · Business · Go-live |
| `/ticket/{id}` | 80 mm kitchen ticket |

Old RC2–RC9 addresses (`/foodhub/...`, `/finance/...`, `/go-live`, `/imports`, `/ledger`…) redirect to the new pages.

## Locked rules

- `(Z)` = active but closed · `(I)` = deactivated · grey circle = deactivated · normal = active
- Required services per brand/location: DoorDash, Uber Eats, SkipTheDishes (TGTG is extra)
- TAKATAK Food Hub = control/matching layer (direct integrations, no aggregator)
- Clover = POS / kitchen / in-store sales · TAKATAK Internal Ledger = main control ledger
- QuickBooks = optional/later export only · AI = supervisor only (never posts, approves, refunds or deletes)
- Never accept an order Clover did not receive · never show a platform action as done when it was not sent
- Keys only through `npm run setup` or hosting environment variables — never in chat

## Project layout

```text
app/(console)/          the console pages (overview, orders, kitchen, stores, menu, alerts, insights, money, settings)
app/login, app/kitchen/lock, app/ticket
app/api/foodhub/        API: auth (code, link, PIN, setup), devices, orders, stores, menu, recon, watch, incidents,
                        pulse, copilot, webhooks (Uber, DoorDash, Skip, TGTG, Clover), cron (sync, watch, reports, reopen)
components/             ui kit, live (pop-up, cancel alarm, order drawer, pulse), shell, charts
lib/foodhub/            adapters, Clover, pipeline, sync, identity (otp, pin, devices), policy, notify (Resend, Twilio,
                        chat), watch (Watchtower engine, AI explanations, customer contact), recon, reports
lib/i18n/               French / English
supabase/INSTALL_ALL.sql  one-paste database install (foodhub.sql + rc10.sql)
scripts/                setup wizard, e2e verification, SQL bundler
data/actual/            your locations, brands and the 43 DoorDash stores from your screenshots
```
