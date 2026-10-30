# TAKATAK Food Hub — Master Plan

_Plan written 2026-10-06. Sections 1, 2, 3b and 5b brought up to date on 2026-10-30 from `main` (f023fc7) and
[PROGRESS.md](PROGRESS.md). Item-by-item status of every phase: [MASTER_PLAN_STATUS.md](MASTER_PLAN_STATUS.md) (comes
with the release PR #130). The phases (section 5) and the locked rules (section 6) are unchanged, except finished items
marked ✅ with their PR._

This file has two jobs:
1. **For the owner:** what is done, why logins and connections may not be showing, and what is left.
2. **For the next work session:** section 8 has prompts ready to paste into Claude Code at the root of this repository,
   one per phase. **Before you start any item, read section 3b and the status file: most of phases 0–2 is built.**

---

## 1. In one minute (2026-10-30)

- **Food Hub does UrbanPiper's job itself, with no aggregator.**
  - One menu per brand, or one menu shared by several brands, sent straight to Uber Eats, DoorDash and Skip.
  - Every platform order goes into Clover, prints in the kitchen and shows on the kitchen screen.
  - Partners that push orders use Food Hub's own **Order Relay**. Too Good To Go orders arrive by **e-mail** (#59).
- **It grew past this plan** (section 3b): commission-free ordering pages per brand and on on2go.ca, website orders
  paid in Clover, the AI phone and brand lines, our own couriers next to DoorDash Drive and Uber Direct, Revenu Québec
  invoices (MEV, off and not certified), customer accounts with ON2GO sign-in, taxes by province, and a wall of the
  platforms' own order screens.
- **Where the phases stand:**
  - Phase 0 (ship) and Phase 1 (never lose an order) are built.
  - Phase 2 (approvals) waits on DoorDash, Uber, Skip and Clover, not on code.
  - Phase 3 (experience) is about half done. Phase 4 (Autopilot) is mostly still to do. Phase 5 is about 40 % done.
- **Live server:** `main` is deployed from Coolify at `https://foodhub.on2go.ca`, by the owner. The Phase 0 checks were
  green from 2026-10-15 to 2026-10-18; they must be run again once the server is back after the 2026-10-30 outage.
- **Waiting for the owner, in order:**
  1. Bring the server back, merge the release PR #130 (Interac e-transfer, kitchen tablet app with printing, Twilio
     Verify on its own account) and deploy.
  2. An outside uptime monitor on `/api/health` that texts you.
  3. Chase DoorDash production, Uber production, the Skip key and the Clover App Market review.
  4. Decide on the Deliverect code (section 5b).
- **Next for agents:** the "Next ten steps" at the end of [MASTER_PLAN_STATUS.md](MASTER_PLAN_STATUS.md): Lighthouse /
  axe ≥ 95, brand colour and logo, Settings → Autopilot, an end-to-end test that kills the server mid-order, e-mail/SMS
  and AI on the Connections card.

---

## 2. Why you don't see your logins and connections

Check these in order. Each line gives the cause and the fix.

| # | Cause | How to check | Fix |
|---|---|---|---|
| 1 | **The server is down, or runs an older `main`.** Work in an open pull request (for example the release PR #130) is not live until it is merged and deployed. | `https://foodhub.on2go.ca/api/health` (200 = up) and `/api/release` (the commit it runs). `npm run verify:live -- --url https://foodhub.on2go.ca/ --sha <main SHA>` checks both ([DEPLOYMENT.md](DEPLOYMENT.md)). | Owner: restart the server, then deploy `main` from Coolify. On a server without Coolify: [INSTALLER_SERVEUR.md](INSTALLER_SERVEUR.md) § 7. |
| 2 | **No database: memory mode.** Without the Supabase URL and service key, Food Hub runs in memory. Users, connected Clover merchants and generated secrets disappear at every restart. | A "Demo mode" banner at the top. Go-live shows the database step as not done. `/api/health` answers 503. | Set `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY` as **runtime** variables in Coolify (the URL is read at run time since Phase 0), and run `supabase/INSTALL_ALL.sql` once. |
| 3 | **Not signed in as owner.** Platforms & Clover, Go-live, "Show secrets" and the warning banners are owner (admin) only. | Settings → Team & PINs shows your role. | Sign in with the owner account. The recovery sign-in is username `owner` with `DASHBOARD_PASSWORD`. « Continuer avec Google » works for team members once `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are set. |
| 4 | **Secrets stay hidden.** They show as `••••` until "Show secrets" is clicked, and that only works when `DASHBOARD_PASSWORD` is set. | Click Show secrets; nothing changes. | Set `DASHBOARD_PASSWORD` and `SESSION_SECRET` (stable, never generated) on the server. |
| 5 | **Keys were never entered.** Coolify has no setup wizard, so every connection shows "Needs setup" or "Missing: …". | Settings → Platforms & Clover, each card. | Add the keys as environment variables (list in section 4). |
| 6 | **The platforms have not approved production access yet** (last owner note 2026-10-23: confirm before acting). | Card says blocked / not approved. | DoorDash: Marketplace is open in sandbox (sandbox-safe mode, #56); `DOORDASH_PROVIDER_TYPE` for production comes after approval. Uber: production access. Skip: `SKIP_JET_API_KEY` from a partner manager. Too Good To Go has no API: e-mail intake (#59). |
| 7 | **The Clover apps are not published yet.** Food Hub and TAKATAK Phone AI were submitted on 2026-10-17 and wait for Clover's review. | Settings → Clover app (checklist) · [CLOVER_MARKETPLACE_LAUNCH.md](CLOVER_MARKETPLACE_LAUNCH.md). | Clover reviews. After approval: `NEXT_PUBLIC_CLOVER_APPS_LIVE` shows the App Market badges. |
| 8 | **Safe mode is on.** Nothing is sent to any platform until live mode is turned on. | Orange "safe mode" banner. | Set `LIVE_CONNECTORS_GLOBAL_ENABLED=true` once Go-live is all green. |
| 9 | **Sign-in codes never arrive.** No email (SMTP or Resend) or SMS (Twilio) is set up. An unknown email still says "code sent" on purpose, so outsiders cannot guess who has access. | The code never arrives. | Set `SMTP_HOST` + `SMTP_USER` + `SMTP_PASS` (a mailbox on your own domain) or `RESEND_API_KEY` (verified domain), plus `AUTH_EMAIL_FROM`, and/or `TWILIO_*`. Until then, use the owner recovery sign-in. |
| 10 | **Nothing runs in the background.** The platform sync only runs while a screen is open. | Store status, payouts and Clover orders go stale overnight; the stale-sync alert. | The Docker image sets `FOODHUB_INTERNAL_SYNC_MIN=5`: check that Coolify does not override it with 0. With the VPS script, its cron jobs do it. |
| 11 | **A platform order screen says "sign-in needed".** The screens wall shows the platforms' own pages from a relay host; nobody has signed in there yet. | Stores → Platform screens. | Set `FOODHUB_SCREENS_AGENT_TOKEN`, set up the relay host, then the owner signs in once in each screen ([PLATFORM_SCREENS_RELAY.md](PLATFORM_SCREENS_RELAY.md)). Food Hub never stores or types a platform password. |
| 12 | **An add-on is off.** Ordering pages, own couriers, AI phone and MEV are off until switched on. Too Good To Go e-mails and WhatsApp are not add-on switches: they stay off until their keys are set. | Settings → Add-ons; Settings → Storefront (per brand); Settings → Platforms → Too Good To Go by e-mail. | Turn on the add-on and add its keys (section 4). Too Good To Go e-mails: `TGTG_IMAP_*` (docs/TGTG_EMAIL_ORDERS.md). WhatsApp: `FOODHUB_WHATSAPP_AUTH_TOKEN` (#115). MEV stays off until Revenu Québec's test environment. |

**Where connections live in the console:**
- **Settings → Platforms & Clover:** every platform, its webhook address, Clover, the Clover app and the Food Hub Order
  Relay.
- **Settings → Go-live:** a self-checking list of about 20 steps.
- **Settings → Add-ons:** delivery (Drive, Uber Direct, our couriers), AI phone, MEV invoices, grocery, alcohol.
- **Stores → Platform screens:** the platforms' order screens, with their status.
- **Overview → Connections & sync:** every platform and the database at a glance (#7). E-mail/SMS and AI status are still
  to add (Phase 3).

---

## 3. What is done (built in code)

| Area | What it does |
|---|---|
| **Orders** | Every platform order is received, duplicates removed, mapped to brand / location / Clover merchant, injected into Clover, printed, auto-accepted per store, and shown on the kitchen screen and the order board. An order Clover did not receive is never accepted. |
| **Menus** | A master menu per brand, or **one menu shared by several brands** (new). Import from Clover. A check before publishing. Publish now or on a schedule, per brand or every sharing brand at once. Price markup per platform. Category schedules. Hours and holidays sent with the menu. |
| **Out of stock (86)** | An 86 at one location goes to every platform. Timed 86s turn back on automatically. Clover "out of stock" becomes an 86 everywhere and comes back by itself. With a shared menu, one 86 reaches every brand's stores. |
| **Stores** | Pause / resume / prep time on every platform at once. Timed pauses re-open automatically, with retries. Holiday closures. |
| **Order Relay** (new) | Food Hub's own order intake, replacing UrbanPiper's, in UrbanPiper's format. Partner statuses only move an order forward. Reject is never faked. Payloads it cannot use are kept, not dropped. Relay stores (`relay:<id>`) receive orders only. |
| **Watchtower** | 15 incident types. Escalates on screen → team chat → kitchen phone → manager SMS and calls → owner. Quiet hours. With an Anthropic key, Claude explains each incident. |
| **Money** | Reconciliation, payouts, statement imports, disputes, commission plans, an owner-approved ledger, and the Too Good To Go bag log. |
| **Team & security** | Code or link sign-in, roles, locations, kitchen tablets with PIN lock, manager PIN for sensitive actions, owner recovery sign-in. |
| **Insights** | Analytics, 7 reports (CSV/Excel, emailed on a schedule), and the full activity log. |
| **AI** | A Copilot drawer that answers questions about today, and incident explanations. It only explains; it never acts. |
| **Clover App Market app** | Per-merchant OAuth, token refresh, approval of unknown merchants, `/welcome/clover`, legal pages (drafts). |

**Shipped on 2026-10-07 in #5 (branch `claude/practical-wright-pnhgtl`):**
- `aa1888d` Order Relay, converted from the UrbanPiper code.
- `11ecf86` One menu for all brands.
- `f213a76` and `bb4cbe3` Hardening from an adversarial review:
  - Relay: relayed Skip orders no longer use the Skip tablet shortcut; reject is never faked; statuses only move forward; payloads are kept, never dropped; no duplicate orders.
  - Shared menu: a brand that stops sharing keeps its 86s; a sharing-map read error stops the action instead of guessing; "publish every brand" schedules are listed and cancelled together.
- **Platform audit fixes** (checked against DoorDash's and Uber's documented API shapes):
  - **DoorDash:**
    - Cancellations from the Order Cancellation webhook now reach the kitchen and Clover.
    - Menu Status reads `event.reference` and `event.status`, and shows DoorDash's refusal reason.
    - Dasher Status reads `dasher_status`.
    - Overnight hours go out as one interval, so stores no longer stop taking orders at 23:39.
    - Closed special days carry full-day times.
    - New **Menu Request** (menu pull) endpoint.
    - Merchant cancellation, available once DoorDash allowlists it (`DOORDASH_MERCHANT_CANCEL=true`).
  - **Uber Eats:**
    - Store status on `/v1/eats/store/{id}/status`, so pause and resume work.
    - Closed holiday = `00:00–00:00`, and removed holidays are cleared on Uber.
    - `pickup_time` sent on accept, so prep and busy mode reach Uber.
    - Menu refresh requests re-publish the menu.
    - An 86 batch keeps going past a refused item.
    - Orders keep working while Uber has not approved the status scope.
  - **Every platform:** errors now say *why* the platform refused.
- Tests: 211 unit tests and 374 end-to-end checks pass. Typecheck is clean and lint has 0 errors.

**Formerly "still to confirm with Uber": resolved on 2026-10-07 from Uber's docs (branch `uber-eats-final`, details and evidence in [UBER_EATS_FINAL.md](UBER_EATS_FINAL.md) section 3):**
- Two translations: **not supported** (one translation, shown to everyone). French and English now go in one text, French first.
- `webhooks_config`: sent at activation (courier webhooks on, `webhooks_version` left unset so orders stay on `GET /v2/eats/order`). The order webhooks are switched on with `PATCH pos_data integration_enabled`, and who receives the orders is read back.
- `tax_info`: a required field with optional members. It is sent empty (Uber applies the store's tax setup). `UBER_TAX_RATE_PCT` exists if Uber asks for an item rate. **Still to ask Uber.**
- Calories: `energy_interval` (E5) is sent; `lower_range` / `upper_range` are deprecated.
- Token: kept in the database too (Uber allows 100 token requests per hour).
- Still to ask Uber:
  - whether `delivery.state_changed` arrives without `webhooks_version "1.0.0"`;
  - whether the previous-version Order API is fine for certification;
  - whether "update store prep time" (newer Store API) is required.

---

## 3b. Built since the plan was written (2026-10-07 → 2026-10-30)

Not in the phases below, but on `main` (or in the release PR #130). **Do not rebuild these:** continue from their doc.

| What | PR | What it does | Where · doc | State |
|---|---|---|---|---|
| **Platform screens wall + relay kit** | #102, #107 (+ #109–#112) | The DoorDash, Uber Eats and Skip order screens, run on a relay host and shown live in Food Hub: 1, 2, 4, 8, 12, 16, 20 or 24 at a time, tabs, a custom board, rings on one device; Watchtower `screen_down` / `screen_waiting`. Relay kit: one-command `setup.sh`, one address for every screen, Android mode, in-store Windows PC. It never clicks, never reads orders, never stores a platform password. | Stores → Platform screens · [PLATFORM_SCREENS.md](PLATFORM_SCREENS.md), [PLATFORM_SCREENS_RELAY.md](PLATFORM_SCREENS_RELAY.md), [ORDER_SCREENS_RESCUE.md](ORDER_SCREENS_RESCUE.md) | On main. Owner: `FOODHUB_SCREENS_AGENT_TOKEN`, relay host, one sign-in per screen. |
| **Customer accounts + ON2GO sign-in** | #123, #124 | Customer accounts for the brand websites, verified by text; signed customer token; « Mon compte » (profile, addresses, favourites, delete under Loi 25); ON2GO sign-in through TAKATAK (launch code); the on2go.ca browser API (ON2GO sites only). | Settings → Customers · [CUSTOMER_IDENTITY.md](CUSTOMER_IDENTITY.md) | On main. |
| **MEV / QCMEV (Revenu Québec invoices)** | #99, #100 | Food Hub orders and Clover register sales become Takatak MEV invoices (QCMEV); TAKATAK MEV Clover app and device endpoint; Québec kitchens only. | Settings → Add-ons → MEV invoices · [MEV_INTEGRATION.md](MEV_INTEGRATION.md), [HANDOFF-CLOVER-MEV.md](HANDOFF-CLOVER-MEV.md) | On main, **off** until Revenu Québec's test environment. **Not certified.** |
| **Too Good To Go e-mail orders** | #59 (+ #76) | Reservation and cancellation e-mails become orders: Clover order, kitchen ticket, TGTG tender at pickup. Read-only IMAP or a webhook; the sender is checked (DKIM / DMARC). | [TGTG_EMAIL_ORDERS.md](TGTG_EMAIL_ORDERS.md) | On main, off until `TGTG_IMAP_*` or `TGTG_EMAIL_WEBHOOK_SECRET`. |
| **Own fleet + courier app** | #34 (+ #21, #28, #45, #93) | Our own couriers as a third fleet next to DoorDash Drive and Uber Direct, the courier's page `/courier` (a link, no password), the tracking text sent once. | Settings → Add-ons → Our couriers · [EXPANSION_FEATURES.md](EXPANSION_FEATURES.md) § 1 | Built, behind switches. Owner: production keys. |
| **Taxes by province** | #121 | The 13 provinces and territories; each kitchen carries a province; direct orders, ordering pages, delivery and the finance split use the same table. | Settings → Business · [TAXES.md](TAXES.md) | On main. |
| **Direct orders, website orders, Clover checkout** | #10, #11, #75, #117, #118 | Website orders paid in Clover show on the kitchen tablet (pppmtl.com first); a commission-free ordering page per brand (`/commander/<slug>`), paid by Clover Hosted Checkout or at the counter; on2go.ca lists it first and orders through it. | Settings → Storefront · [STOREFRONT.md](STOREFRONT.md), [CLOVER_WEBSITE_ORDERS.md](CLOVER_WEBSITE_ORDERS.md) | On main, each brand off until switched on. |
| **AI phone** | #17, #18, #30, #38, #58, #61, #68 | Phone ordering in Québec French, English and Spanish, payment link by text, Duo / Trio / Combo, brand phone lines, the ON2GO phone menu; TAKATAK Phone AI is its own Clover app with per-minute billing. | Settings → Add-ons → AI phone · [EXPANSION_FEATURES.md](EXPANSION_FEATURES.md) § 4, [CLOVER_MULTI_APP.md](CLOVER_MULTI_APP.md) | Built, behind switches. |
| **WhatsApp / SMS** | #115 | Signed WhatsApp webhook with brand routing, per-customer memory, STOP / START, rate limit and replay guard. | `/api/foodhub/webhooks/whatsapp` (`FOODHUB_WHATSAPP_AUTH_TOKEN`) | On main. Meta templates and Messenger: to do. |
| **Restaurant leads API** | #87 | The on2go.ca « Rejoindre ON2GO » form: stored, owner e-mailed, FR / EN auto-reply. | Settings → Restaurant leads · [RESTAURANT_LEADS.md](RESTAURANT_LEADS.md) | On main. |
| **Store availability centre** | #74 | Reopens-at per kitchen / brand / channel, busy schedule, tablet-off guard (off by default), special days, status history. | `/stores/availability` · [STORE_AVAILABILITY.md](STORE_AVAILABILITY.md) | On main. |
| **In the release PR #130 (not merged yet)** | #127, #128, #129 | Interac e-transfer for website orders (held until a person confirms, fee shown before checkout); the kitchen tablet app (Android, Bluetooth / network printing, loud alert, APK from `/tablette`); Twilio Verify on its own Twilio account. | PR #130 | Waiting for the owner's merge. |

Also merged since 2026-10-07: DoorDash sandbox-safe mode (#56), menu safety and per-brand dishes on shared menus (#60),
reviews hub (#73), sales mix (#64), operations quality (#65), customer insights (#67), kitchen order tools (#71), client
dashboard (#72), premium console (#88, #90, #91, #94), Google sign-in (#86), Clover billing (#69), legal pages (#66),
finance A–Z (#25, #43), public directory feed (#16), ON2GO.ca hub pages (#80, #116), TAKATAK Suite bus (#102),
integration platform plan (#120).

---

## 4. Connection board

| System | Built | What you must get or enter | Where to check |
|---|---|---|---|
| Clover (API) | Yes | `CLOVER_MERCHANT_ID`, `CLOVER_ACCESS_TOKEN` (or `CLOVER_MERCHANT_TOKENS` for several merchants), `CLOVER_PRINT_DEVICE(S)`, `CLOVER_WEBHOOK_AUTH` | Platforms & Clover → Clover POS |
| Clover App Market app | Yes | `CLOVER_CLIENT_ID` (App ID `629HFYHNVMZYR`), `CLOVER_CLIENT_SECRET`, `FOODHUB_SUPPORT_EMAIL`, `FOODHUB_LEGAL_APPROVED=true`, a real domain, the listing submitted | Platforms & Clover → Clover app; Go-live |
| Uber Eats | Yes | `UBER_CLIENT_ID` / `UBER_CLIENT_SECRET`, with Uber's approval of `eats.order`, `eats.store`, `eats.store.status.write`, `eats.pos_provisioning`, `eats.report` | Platforms; Stores → Connect Uber Eats |
| DoorDash | Yes | `DOORDASH_DEVELOPER_ID`, `DOORDASH_KEY_ID`, `DOORDASH_SIGNING_SECRET`, and `DOORDASH_PROVIDER_TYPE` (issued by DoorDash after approval). Fallback: `FOODHUB_VIA_CLOVER=doordash` (orders read from Clover; menu managed in Clover) | Platforms |
| Skip | Yes | `SKIP_JET_API_KEY` from a Skip partner manager. If Skip says no, a partner can send Skip orders through the Relay (`FOODHUB_RELAY_CHANNELS=skip,tgtg`) | Platforms |
| Too Good To Go | Inbound by e-mail (#59) | A read-only mailbox (`TGTG_IMAP_HOST`, `TGTG_IMAP_USER`, `TGTG_IMAP_PASSWORD`…) or `TGTG_EMAIL_WEBHOOK_SECRET`, then map the stores. No TGTG API exists, so bags and cancellations stay in TGTG's own app | Platforms; Money → TGTG |
| Order Relay | Yes (#5) | Nothing required (the secret is generated). Optional: `FOODHUB_RELAY_CALLBACK_URL` / `_TOKEN` from the partner | Platforms → Food Hub Order Relay |
| Platform screens (#102, #107) | Yes | `FOODHUB_SCREENS_AGENT_TOKEN`, a relay host, one sign-in per screen by the owner | Stores → Platform screens |
| Ordering pages and website orders | Yes, off per brand | Switch each brand on; `FOODHUB_PUBLIC_URL` in https; `CLOVER_ECOMM_PRIVATE_KEY` to pay online (else pay at the counter); `FOODHUB_WEBSITE_ORDER_SECRET` for a brand website | Settings → Storefront |
| Customer accounts (#123, #124) | Yes | Texts through Twilio (`TWILIO_VERIFY_SERVICE_SID` optional); `TAKATAK_CONTROL_PLANE_URL` + `TAKATAK_ON2GO_SERVICE_TOKEN` for ON2GO sign-in | Settings → Customers |
| Google sign-in (#86) | Yes | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (team members only) | Sign-in page |
| WhatsApp (#115) | Yes | A Twilio WhatsApp number; `FOODHUB_WHATSAPP_AUTH_TOKEN` when that number is on another Twilio account | Twilio console |
| Database | Yes | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, then run `INSTALL_ALL.sql` | Go-live |
| Email / SMS / calls | Yes | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` or `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `TWILIO_*`, `ALERT_WEBHOOK_URL` (team chat) | Settings → Alerts & watchtower |
| AI | Yes | `ANTHROPIC_API_KEY` (optional `ANTHROPIC_MODEL`) | Settings → Alerts & watchtower |
| Security | Yes | `DASHBOARD_PASSWORD`, `SESSION_SECRET`, `FOODHUB_TRUST_PROXY=true` behind Caddy/Traefik | Go-live |
| Background jobs | Yes | VPS: the cron jobs from `install-vps.sh`. Coolify: `FOODHUB_INTERNAL_SYNC_MIN=5` | Go-live; the stale-sync alert |
| Revenu Québec invoices (Takatak MEV / QCMEV) | Yes, off by default, simulator only until certified | `FOODHUB_MEV` (off/shadow/simulator/on), `FOODHUB_MEV_URL`, `FOODHUB_MEV_SECRET`, `FOODHUB_MEV_LOCATIONS`; optional `FOODHUB_MEV_TRIGGER`, `FOODHUB_MEV_TIMEOUT_MS`, `FOODHUB_MEV_RETRY_S`, `FOODHUB_MEV_OFFLINE_POLL_S`, `FOODHUB_MEV_USER`, `FOODHUB_MEV_CLOVER_NOTE`, `FOODHUB_MEV_SEND_RECEIPT`, `FOODHUB_FEATURE_MEV`. QCMEV itself (repo QCMEV.CA) on the same Coolify network. See docs/MEV_INTEGRATION.md | Settings → Add-ons → MEV invoices |

---

## 5. What is left: the roadmap

Each phase ends with **acceptance checks**. A phase is done only when all of them pass.

### Phase 0: Ship what is built (days)

1. ✅ Merge `claude/practical-wright-pnhgtl` into `main` through a pull request. Deploy from `main`. **Done (#5, 2026-10-07);** `main` is deployed from Coolify.
2. Fix the deploy traps — **done** (branch `clover-marketplace-launch`, merged in #7; `SESSION_SECRET` in #8):
   - ✅ The `Dockerfile` no longer hides a failed build.
   - ✅ Instead of a build-time `ARG` (an empty one would inline an empty string), the Supabase URL is now read at run time (`lib/supabase/server.ts`); `SUPABASE_URL` is accepted too.
   - ✅ `FOODHUB_INTERNAL_SYNC_MIN` is documented in `.env.example` (the image sets 5).
   - ✅ `SESSION_SECRET` is **required and stable, never generated at run time** (task 9). A generated key broke sign-in when the database was down at boot, with two instances, and in memory mode. Without it, the key is derived from `DASHBOARD_PASSWORD`.
   - ✅ `VOLUME /app/data/media` in the image; on Coolify also add a Persistent Storage mount.
3. Fix the Go-live checklist — **done** (#7):
   - ✅ The Clover line needs a merchant token or a connected merchant.
   - ✅ A platform arriving on the Relay counts as done.
4. ✅ Update `docs/ATLAS_PARITY.md`, `docs/RELEASE_NOTES.md` and `docs/INSTALLER_SERVEUR.md` (old zip and folder names) for the Relay and shared menus. **Done (#131, 2026-10-30).**

**Acceptance:**
- The live console shows the Relay card and the Shared menu button.
- No "Demo mode" banner.
- Go-live shows the database and secrets as done.
- The sync timestamp updates with no screen open.

### Phase 1: Never lose an order or miss an alarm (1–2 weeks)

> **Status (branch `clover-backend-final`, merged in #7; `reconcile-pr6` merged in #9):** items 1 (webhook inbox + Replay), 2 (`/api/health`), 3 (texts by default
> for `menu_failed` / `sync_stale`), 4 (silence alarm), 6 (Clover auto-retry 30 s / 2 min, no second ticket) and the
> Clover side of 7 are built and tested — see [CLOVER_BACKEND_FINAL.md](CLOVER_BACKEND_FINAL.md). Branch
> `reconcile-pr6` (task 2) adds PR #6's fixes on top: 5 (the "Order from an unmapped store" incident with a mapping
> hint), the rest of 7 (Order Relay and shared menus in the end-to-end script), no late ticket from an automatic
> run, the order stored before a server stop finished instead of "duplicate", Clover retry guards, and a cheaper,
> stricter `/api/health`.

1. ✅ (#7) **Save the raw webhook body before answering 200** (`lib/foodhub/webhook-utils.ts`), then process it. Add a **Replay** button for unparsed or failed payloads in Settings → Platforms.
2. ✅ (#7, #9) Add **`/api/health`** (database, last sync, last order per platform, and whether the watchtower timer is alive). Add an outside uptime monitor that texts the owner (👤 still to set up).
3. ✅ (#7) Send texts by default for `menu_failed` and `sync_stale` (`lib/foodhub/watch/types.ts`).
4. ✅ (#7) Add a **silence alarm**: no orders from one platform for N hours while its stores are open (`lastOrderAt` already exists in `command.ts`).
5. ✅ (#9) **Unmapped store:** hold auto-accept when there are several kitchens, raise an escalating alarm, and suggest the mapping (relay orders carry the brand name).
6. ✅ (#7) **Retry Clover injection automatically** (30 s, then 2 min) before waking a manager.
7. ✅ (#7, #9) Add the Relay and shared menus to the end-to-end script `scripts/foodhub-e2e.mjs`.

**Acceptance:**
- Killing the server between receiving an order and processing it loses nothing; the order is replayed.
- Stopping the scheduler texts the owner within 15 minutes.
- Breaking a platform webhook raises the silence alarm.

### Phase 2: Connections and approvals (depends on the platforms)

1. **DoorDash:**
   - ✅ The audit is done and its fixes are in (#5, #28; sandbox-safe mode #56).
   - Get `DOORDASH_PROVIDER_TYPE`.
   - Subscribe the Order, Menu Status and Dasher Status webhooks.
   - **Ask DoorDash to configure the Order Cancellation webhook** to the same address.
   - Give DoorDash the Menu Request URL.
   - Until approval, `FOODHUB_VIA_CLOVER=doordash` is the working fallback.
2. **Uber Eats:** code finished on branch `uber-eats-final` (✅ merged in #7; every Marketplace and Uber Direct API in #21); the owner's steps are in [UBER_EATS_FINAL.md](UBER_EATS_FINAL.md):
   - paste the signing key;
   - get production access (merchants@uber.com, on the open case);
   - UrbanPiper lets go of the stores (its offboarding case);
   - Stores → Connect Uber Eats;
   - Menus → All Uber stores (dry run, then publish);
   - one test order per kitchen, then retire the tablets.
3. **Skip:** get the JET Connect key, or agree a partner feed through the Relay. (✅ Code: every JET Connect operation, #35.)
4. **Too Good To Go:** when the rep delivers the spec, write a real `tgtgAdapter`: read their orders (replacing the best-guess reader), send bag quantities and pickup windows, and cancel. Remove the permanent "blocked" results. _(2026-10-30: no spec came. ✅ Their order e-mails are read instead, #59. See 5b for the Deliverect code.)_
5. **Clover App Market** — code ready (branch `clover-marketplace-launch`, ✅ merged in #7); the full list is in `docs/CLOVER_MARKETPLACE_LAUNCH.md`:
   - ✅ Launch flow, pre-filled welcome wizard, test order, billing_info, 429 back-off, support page with FAQ, listing texts, screenshots.
   - ✅ Domain with HTTPS: `foodhub.on2go.ca`. 👤 Switch `FOODHUB_PUBLIC_URL` and the Clover Site URL to it (task 5).
   - ✅ Legal pages complete (#66, #79). 👤 Approve the legal pages (`FOODHUB_LEGAL_APPROVED=true`), support email and phone.
   - 👤 Record the functional video, fill in the dashboard, ask Clover about SRM (Québec), submit. ✅ Submitted on 2026-10-17 (Food Hub and TAKATAK Phone AI); waiting for Clover's review.

**Acceptance:**
- One real order per platform goes all the way to Clover, prints, and has its accept and ready confirmed on the platform.
- A menu publish and an 86 reach each platform.

### Phase 3: The experience upgrade

Goal: feel premium, alive, easy and smart, with no bare white screens, while keeping the kitchen fast and readable. Use native CSS first (View Transitions, `@starting-style`, scroll-driven animations, `@property`). Add the `motion` library only for drag and swipe, loaded lazily, never in the kitchen bundle.

**P0: foundations and fixes**
- ✅ (#52) Add motion settings and one `prefers-reduced-motion` rule in `app/globals.css`.
- ✅ (#52) Add the missing `shake` keyframe (the PIN pad uses it).
- ✅ (#52) Contrast: darken `ink-3` to at least 4.5:1; use `ink-4` only for borders and icons; kitchen order text at 7:1.
- ✅ (#52) **Kitchen dark theme on `<html>`.** Today the new-order pop-up, the cancel alarm and the order drawer show white on the dark kitchen screen.
- Touch targets of at least 48 px in the kitchen (✅ #52). Always-visible reorder handles. A tap legend for the store-health grid.
- ✅ (#52, #55) A route-level `loading.tsx` / `error.tsx`, and a `TableSkeleton` replacing the seven plain "Chargement…" rows. Public pages still have none.

**P1: depth and identity**
- Layered surfaces: a faint warm gradient canvas, two-layer shadows, `tinted` and `hero` card variants. Frosted glass only on the chrome (top bar, bottom bar, sheets).
- **A colour per brand** (and an optional logo) on the brand record, exposed as `--brand-accent` on order cards, pop-ups, the menu header and overview tiles.
- An optional OS dark mode for the console. Chart colours become CSS variables.

**P2: motion with meaning**
- Page transitions with React `<ViewTransition>` and `Link` `transitionTypes` (150–200 ms; off in the kitchen).
- Exit animations for modals, drawers and toasts.
- A new order "lands" once (scale up plus a brand glow); cards glide New → Cooking → Ready; vibration on Android; a full-width "tap to turn sound on" banner.
- Numbers count up on the overview. The top bar compacts on scroll. Sticky headers on money tables.
- Micro-interactions: button press, switch overshoot, sliding segmented pill, copy-to-check.
- A celebration, once each: Go-live reaches 100%, the first publish, Clover connected. (✅ `feature/golive-ring-connections`: once per device, localStorage.)
- **Guided onboarding:** a Go-live stepper with a progress ring, and a **Connections strip on the Overview** (Clover, Uber, DoorDash, Skip, TGTG, Relay, database, email/SMS, AI), each with a live status dot. (✅ Overview → Connections & sync, #7; e-mail/SMS, AI, screens relay and TGTG mailbox + the Go-live ring and stepper: `feature/golive-ring-connections`.)

**Guardrails:**
- Animate only `transform` and `opacity`. UI motion ≤ 200 ms; overlays ≤ 300 ms.
- The only looping animation is the new-order alert.
- At most +25 KB of JavaScript (gzipped). INP under 200 ms, measured on the real kitchen tablet.
- Everything works in French and English, whatever the text length.

**Acceptance:**
- Lighthouse accessibility ≥ 95.
- No bare white page while loading.
- The reduced-motion setting is respected.
- The kitchen screen stays dark everywhere.

### Phase 4: Autopilot (runs by itself, AI-assisted, within safe rules)

Food Hub already runs a lot by itself: the sync, timed re-opens, 86 re-enables, Clover inventory sync, scheduled publishes, reports and the escalating watchtower. Autopilot adds the rest **without breaking the locked rules** (section 6).

1. **An Autopilot page** (Settings → Autopilot). Each automation has an on/off switch, its rule, the last time it ran, and an undo where possible. Everything it does is written to the activity log with the actor "Autopilot". _(2026-10-30: claimed on board #105, branch `feature/autopilot`.)_
2. **Safe automations** (each one switchable):
   - Re-publish 10 minutes after "Use Clover price" or after hours are saved (reuses `menu/schedule.ts`).
   - Retry failed menu, 86 and pause jobs with back-off.
   - Fetch the Uber payment report weekly.
   - Suggest store mappings from relay and Uber store names. (✅ A hint on the unmapped-store incident, #9.)
   - Auto-close stale orders (already done).
   - ✅ (#74, tablet-off guard, off by default) Pause a store whose kitchen tablet has been offline for N minutes during opening hours.
   - ✅ (#74) Resume it when the tablet is back.
3. **An AI daily brief** (Claude, using the existing Copilot snapshot): yesterday's sales by brand and platform, what went wrong, money to recover, and what to fix today. Sent by email and SMS at 08:00 Montréal and pinned on the Overview.
4. **AI suggests, a person approves in one tap.** The Copilot proposes actions ("86 the poutine at NDG on every brand?", "Pause Pizza Inntime for 20 min, the kitchen is 12 min late") as cards with **Approve / Dismiss**. The action runs through the same gated route as a manual click, so the manager PIN still applies when it should.
5. **Anomaly watch:** cancellations spiking, a platform going silent, prep times drifting, payout gaps. Each becomes a watchtower incident with an AI explanation. (Cancellation spike, platform silent and payout gap exist; prep-time drift is still to do.)

**Acceptance:**
- Every Autopilot action appears in the activity log and can be turned off.
- AI never approves, posts, deletes or settles money (locked rule).
- With every Autopilot switch off, Food Hub behaves exactly as it does today.

### Phase 5: A product other merchants want

- ✅ A Clover App Market onboarding that feels effortless: install → `/welcome/clover` with a guided 3-step wizard (connect platforms, import the menu, tablet and PIN) and a celebration at the end (branch `clover-marketplace-launch`, #7).
- Brand kits (colour, logo, photos) used across the console and menus.
- From Atlas "not built": combo and nested options, ratings and reviews (✅ #73), own-courier dispatch (DoorDash Drive / Uber Direct) for phone orders (✅ built behind switches: #21, #28, #34, #58), Google (✅ #86) / Microsoft sign-in.

---

## 5b. Open owner decisions (2026-10-30)

| Decision | Why it is open | Options | Until then |
|---|---|---|---|
| **Deliverect code on `main` vs the no-aggregator rule of 2026-10-16** | #35 added a Too Good To Go path through Deliverect (`app/api/foodhub/deliverect/`, `app/api/foodhub/webhooks/deliverect/`, `lib/foodhub/adapters/deliverect.ts`, `lib/foodhub/adapters/deliverect-api.ts`, `lib/foodhub/deliverect-ops.ts`). It is also referenced from `lib/foodhub/adapters/partner.ts`, `lib/foodhub/menu/lock.ts`, `lib/foodhub/menu/shared.ts`, `lib/foodhub/pipeline.ts`, `lib/foodhub/pos/clover-order.ts`, `lib/foodhub/tgtg-feed.ts`, `lib/foodhub/tgtg.ts`, `lib/foodhub/types.ts` and `scripts/foodhub-e2e.mjs`, so removing it is a real code change with its own tests. The owner then ruled: no third-party aggregator, only direct platform ↔ Clover links or our own Food Hub ([LOCKED_DECISIONS.md](LOCKED_DECISIONS.md): "no aggregator"). | **Keep it dormant** (never configured, nothing sends to it) or **remove it** in its own PR. | No agent changes, configures or extends this code. Too Good To Go orders come by e-mail (#59). |

---

## 6. Locked rules (never break these)

- Never accept an order Clover did not receive, unless Clover is not part of the deployment. The explicit "Accept without Clover" override stays.
- Nothing is shown as sent or done unless the platform really received it. "Blocked" and "skipped" stay honest.
- AI explains and suggests. It never approves, posts, deletes or resolves money matters on its own (`docs/LOCKED_DECISIONS.md`).
- Nothing is sent to platforms until `LIVE_CONNECTORS_GLOBAL_ENABLED=true` and Go-live is green.
- French and English everywhere. The kitchen screen stays high-contrast, dark and touch-first.
- A payload that cannot be read is kept, never dropped.
- Never accept the same order twice from two paths (direct, through Clover, through the Relay).

---

## 7. Known limits to keep in mind

- **Shared menu:**
  - Price markups belong to the shared menu, so a brand that shares cannot have its own prices yet. A per-brand markup is a future option.
  - If a sharing brand's store is on another Clover merchant, its orders reach Clover as free-text lines, not as inventory items.
- **Cancel after accepting:** only Uber Eats has an API for it. DoorDash and Skip cancellations are done in their portal or tablet.
- **TGTG:** no outbound API until the rep provides one.
- **Sign-in throttling and PIN lockouts** are per server instance.

---

## 8. Prompts ready to paste (one per phase)

Paste one at a time into Claude Code at the repository root. Each prompt is self-contained.

> **2026-10-30:** the Phase 0 and Phase 1 prompts and the DoorDash / Uber audit of Phase 2 are **done** (kept as a
> record). Do not run them again. Start from the open items in [MASTER_PLAN_STATUS.md](MASTER_PLAN_STATUS.md) and claim
> the job on board #105 first.

**Phase 0**
> Read docs/MASTER_PLAN.md (sections 2, 4 and 5 / Phase 0). Get branch `claude/practical-wright-pnhgtl` ready to merge into `main`:
> - Dockerfile: no `|| true` on the build; a build-time ARG for `NEXT_PUBLIC_SUPABASE_URL`.
> - Document `FOODHUB_INTERNAL_SYNC_MIN` in `.env.example`.
> - `SESSION_SECRET`: required and stable, never generated at run time (done, task 9).
> - Go-live: the Clover line needs a connected merchant; Skip counts as done through the Relay.
> - Update ATLAS_PARITY, RELEASE_NOTES and INSTALLER_SERVEUR for the Relay and shared menus.
>
> Run typecheck, lint and the tests, then open a pull request.

**Phase 1**
> Read docs/MASTER_PLAN.md Phase 1 and do items 1–7 with tests:
> - Persist the raw webhook before the 200, and add a Replay button.
> - Add `/api/health`.
> - Text by default for `menu_failed` and `sync_stale`.
> - Add a silence alarm per platform during opening hours.
> - Hold auto-accept for unmapped stores when there are several kitchens, with an escalating alarm.
> - Retry Clover injection automatically.
> - Add the Relay and shared menus to `scripts/foodhub-e2e.mjs`.
>
> Keep every locked rule in section 6.

**Phase 2 (DoorDash first)**
> Audit `lib/foodhub/adapters/doordash.ts`, `toDoorDashMenu` in `lib/foodhub/menu/translate.ts` and `app/api/foodhub/webhooks/doordash/route.ts` against DoorDash's official Marketplace API docs. Check:
> - every path, method, header and JWT claim;
> - menu JSON field names and types; hours; extras and options;
> - menu id handling (PATCH vs POST);
> - item and option status endpoints; store status and deactivation;
> - the order confirm body and `prep_time`; webhook payloads;
> - several brand stores sharing one menu (unique merchant_supplied_id values).
>
> Fix every confirmed mismatch, with tests. Then do the same for Uber Eats.

**Phase 3**
> Read docs/MASTER_PLAN.md Phase 3. Implement P0, then P1, then P2, with CSS first and the guardrails as hard limits. Start with: the reduced-motion rule, the `shake` keyframe, contrast tokens, the kitchen theme on `<html>`, 48 px kitchen targets, `loading.tsx` / `error.tsx` and `TableSkeleton`. Then add layered surfaces and brand colours (`--brand-accent`), then View Transitions, exit animations, the live-order landing animation, the Connections strip on the Overview and the Go-live stepper. Check it in the browser at phone, tablet and desktop widths, in French and English.

**Phase 4**
> Read docs/MASTER_PLAN.md Phase 4 and section 6. Build Settings → Autopilot (per-automation switches, last run, activity log as "Autopilot"). Add the safe automations, the AI daily brief (Claude with the Copilot snapshot, sent at 08:00 Montréal) and Copilot action cards (Approve / Dismiss through the existing gated routes). AI must never approve, post, delete or settle money. With every switch off, behaviour must be unchanged.
