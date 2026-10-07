# Release notes

## Unreleased — never lose an order or miss an alarm (MASTER_PLAN Phase 1)

### Orders are saved before the platform gets its answer
- Every order route (Uber Eats, DoorDash, Skip, Too Good To Go, Order Relay) saves the order in an **inbox** before
  answering the platform. If it cannot be saved, the platform gets a `503` (it retries; Skip and DoorDash fall back to
  their tablet), never a "received".
- **Crash recovery:** the sync picks up any order still waiting after 2 minutes (oldest first) and runs it again.
  After 5 tries, or once the platform's answer window has passed (DoorDash 3 min, Skip 5, Uber 11.5 — a late Clover
  ticket could cook it twice), the order is handed to a person instead.
- **Replay:** Settings → Platforms & Clover lists orders that failed or got stuck, with a *Rejouer / Replay* button
  (owner only), a warning when the platform's window has passed, and the result in the activity log. Replaying twice
  never makes two orders.

### `GET /api/health` for an outside uptime monitor
- Public, exact path only. It shows the version, the database mode, the seconds since the last sync and the last
  Watchtower run, and the live switch — never a key, a name, an order or a count.
- Answers `503` when the database does not answer, the app runs in memory mode in production, the scheduled sync
  stopped for 20+ minutes, or the console is locked. Set up the monitor with `docs/BACK_ONLINE_TODAY.md`, Part B
  step 10.

### Watchtower
- **`sync_stale` and `menu_failed` now text** the managers on duty by default (warnings never call and stay quiet
  during quiet hours; rules an owner already saved keep the owner's choice).
- **`platform_silent`:** no order from Uber Eats, DoorDash or Skip for N opening minutes (Settings → Alerts, default
  180) while one of its stores is open. Closed hours never count; relay-only, paused and closed stores are ignored;
  it closes by itself with the next order.
- **`store_unmapped`** (critical): orders held because their platform store is not mapped, one alarm per store,
  with the waiting orders, the platform deadline and a suggested mapping.

### Clover is retried by itself
- When Clover did not take a new order, Food Hub tries again 30 s, 2 min and 5 min later, then asks a person. On
  success the order goes on as on arrival (kitchen ticket, auto-accept when the store wants it).
- Never retried: a cancelled order, one on the Skip tablet, one followed through Clover's own integration, or one a
  person already accepted. Every try is on the order history and in the activity log.

### Go-live checklist tells the truth
- **Clover** is green only when at least one merchant can really receive orders (`CLOVER_MERCHANT_ID` +
  `CLOVER_ACCESS_TOKEN`, a `CLOVER_MERCHANT_TOKENS` entry, or an approved Clover app merchant whose access has not
  expired) — no longer with the Clover app keys alone. A merchant to reconnect, one waiting for approval and an
  unreadable token map are named; `FOODHUB_POS_INJECTION=off` is shown as such.
- **Uber Eats / DoorDash / Skip** count when reached through the **Food Hub Order Relay** (in
  `FOODHUB_RELAY_CHANNELS`, with a store mapped as `relay:<id>`), labelled *Food Hub Order Relay*. A relay store no
  longer makes a direct connection look done, and direct keys plus the relay for the same platform are flagged (each
  order would come in twice).
- **`SESSION_SECRET`** is its own required row: set, at least 32 characters, and stable — a change in the last 7 days
  is pointed out (a host that makes a new one at each deploy signs everyone out, tablets included). It is never
  generated at runtime: `proxy.ts` checks every request before anything is loaded from the database.
- **Uptime monitor on `/api/health`**: an information row with the address to watch and the guide; it cannot be
  checked from inside the server, so it is left out of the progress count.

### Verification (so far)

| Gate | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | pass (0 errors) |
| `npm test` | 302 tests pass (new: `order-inbox`, `health`, `watch-alarms`, `clover-retry`, `go-live`) |
| `npm run build` | pass |
| `npm run verify:foodhub` | 414 end-to-end checks pass (new: Order Relay, shared menus, `/api/health`) |

## Go live — Order Relay, one menu for all brands, platform API fixes (pull request #5, 2026-10-06)

UrbanPiper is cancelled: Food Hub now does its job itself.

### Food Hub Order Relay
- `POST /api/foodhub/webhooks/relay` (token `FOODHUB_RELAY_SECRET`, generated): Food Hub's own intake for partners
  that push orders (a Too Good To Go feed, an ordering website…), in UrbanPiper's "Order Relay" format so a partner
  that already speaks it plugs in unchanged. Relayed orders run the normal pipeline (Clover ticket, kitchen, alerts).
- Accept / Ready / Reject / Cancel are sent to `FOODHUB_RELAY_CALLBACK_URL` only when live connectors are on, and say
  *Not sent* otherwise; Reject / Cancel without a callback are refused, never shown as done.
- Partner statuses only move an order forward; a closed order never reopens; the partner cannot accept an order Clover
  did not receive. Unreadable payloads are kept, never dropped.
- `FOODHUB_RELAY_CHANNELS` defaults to `tgtg`; a platform linked through Clover is always refused (no double orders).
  Relay stores are mapped as `relay:<id>`: orders only, no menu, 86, pause or status call to the platform's API.
  Relayed Skip orders never use the Skip tablet shortcut or Skip's "missing items" call.
- Settings → Platforms & Clover card with the relay address; `docs/ORDER_RELAY.md`.

### One menu for all brands
- A brand can use another brand's master menu (UrbanPiper's Menu Aggregator). The shared menu is the only one edited,
  imported from Clover, price-checked and 86'd; each brand publishes it under its own name, hours and stores, one by
  one or all at once (scheduled "all brands" publishes are listed and cancelled together).
- An 86 on any brand of the group reaches every brand's stores; timed re-enables and Clover stock / price sync work on
  the shared menu. A brand that stops sharing gets its own menu back with its 86s still on.
- Menus → *Shared menu* dialog; brands that share show a banner and are read-only.

### DoorDash and Uber Eats checked against their documented APIs
- **DoorDash:** the Order Cancellation webhook reaches the kitchen and Clover; Menu Status reads `event.reference` /
  `event.status` and shows DoorDash's refusal reason; Dasher Status reads `dasher_status`; overnight hours go out as
  one interval (stores no longer stop at 23:39); closed special days carry full-day times; Menu Request uses the
  shared menu and refuses relay stores; merchant cancellation once DoorDash allowlists it (`DOORDASH_MERCHANT_CANCEL=true`).
- **Uber Eats:** store status on `/v1/eats/store/{id}/status` (pause and resume work); a closed holiday is
  `00:00–00:00` and removed holidays are cleared; `pickup_time` on accept (prep and busy mode reach Uber);
  `store.menu_refresh_request` re-publishes the menu; an 86 batch keeps going past a refused item; orders keep
  working while the status scope is not approved.
- **Every platform:** a refused call says why, and the platform's answer is kept on the job.

### Deploy
- `Dockerfile`: a failed `npm run build` now fails the image (the old `|| true` hid it); only the dev-dependency
  prune may be skipped.
- The image sets `FOODHUB_INTERNAL_SYNC_MIN=5`: Coolify / Docker hosts keep syncing store status, Clover orders,
  timed re-opens and 86s, and scheduled publishes with no screen open.
- `docs/BACK_ONLINE_TODAY.md` (reopen orders on the tablets now, then Food Hub live on Coolify) and
  `docs/MASTER_PLAN.md`.

### Verification

| Gate | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | pass (0 errors) |
| `npm test` | 244 tests pass |
| `npm run verify:foodhub` | 383 end-to-end checks pass |
| `npm run audit:prod` | clean (high and above) |

## 1.5.9 — nothing typed is lost, help on every screen, promotions in Clover (2026-10-06)

### Every settings screen saves by itself
- **Alert rules, manager PIN rules, commission plans and each kitchen's prep time** now save by themselves like store
  hours and your profile: no Save button, the chip says *Saved · 14:02* or what to fix, ⌘Z / ↶ ↷ undo, and an
  unsaved change survives a closed tab or a dead battery. Numbers out of range are outlined in red and block only
  the save, never the typing.
- **Alert rules**: support numbers are a list (add, × to remove with 6 s *Undo*); turning the watchtower off can be
  taken back for 6 s.
- **Manager PIN rules**: *Strict preset* changes only what differs and can be undone; when saving these rules
  needs a PIN, changes are grouped so one PIN covers several taps; a warning appears if the owner has no PIN yet.
- **Prep time**: typed minutes save by themselves; *Busy mode* sends the typed minutes first.

### Pop-up forms keep what you typed
- Adding a person, a location, a store link, a deposit, a dispute, a tablet, a report email, or a day of Too Good To
  Go bags: closing by X, Cancel, Esc or by mistake keeps what was typed (*Kept — reopen to finish*). Reopening shows
  *Picked up where you left off — nothing was sent yet* with *Start over*. Nothing is sent until the form's own
  button. PINs, passwords and one-time codes are never kept.

### TakTak explains every main screen
- Guided tours and first-tap explanations on Orders, Kitchen, Stores, Store connections, Out of stock (86), Alerts,
  Money, Commission plans, Deposits, Disputes, Too Good To Go, Insights, Reports, Team, Business, Tablets, Security
  and Alert rules. Nothing used during service (accept, ready, 86, pause) ever waits for an explanation.

### Clover
- **Platform promotions reach Clover as a discount line** (*DoorDash promotion −$3.50*), capped at the order's
  lines, so a promoted order closes as paid instead of showing a balance due.

### Money checks
- **A promotion is counted once in reconciliation**: when the order already carries a restaurant-funded promotion
  and the platform statement lists the same promotion, a correctly paid order no longer shows as *over paid* by the
  promotion (only what the statement shows beyond the order's own discount explains a difference).

### Fixes
- The *PIN cancelled — Save* chip no longer stays on screen after undoing back to the saved values.
- A guided tour skips steps whose button this person cannot see (no permission), instead of describing it.
- A first-tap explanation never covers a pop-up or the manager PIN pad that the tap opened.
- Report email and schedule buttons are disabled for the accountant/analyst role (the server always refused them).
- Removing a store link in Store connections can be undone for 6 seconds (the platform is told after that).

### Verification

| Gate | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | pass (0 errors) |
| `npm test` | 206 tests pass |
| `npm run build` | pass |
| `npm run verify:foodhub` | 383 end-to-end checks pass (new: the Clover promotion line) |
| Browser (Chromium) | 36 new scenarios (pop-up drafts survive Esc and reload, *Start over*, autosave with refused values, two-step undo saved, strict preset undo, prep time, a guided tour on 18 screens) + the 25 scenarios of 1.5.8, 33 console screens without errors, 29/29 security and role probes |
| Review | each screen group built by one agent and attacked by an independent reviewer; findings fixed |

## 1.5.8 — go-live fixes and the fluent console (2026-10-06)

### A console that never loses work and explains itself
- **No Save buttons on store hours and your profile**: changes save by themselves 1.2 s after you stop, and the
  chip says exactly where things are — *Editing… kept on this screen*, *Saved · 14:02*, *Offline — kept here, sent
  when the network is back*, *Fix: Monday 11:00*, or *Not saved — Retry*. ⌘S saves at once.
- **Close by mistake, nothing is lost**: every change is kept on the device the moment it is made (per person, per
  screen; cleared at sign-out). Reopen the screen and the unsaved change comes back and is saved, with a one-tap
  *Go back to the saved version*.
- **Undo everywhere it makes sense**: ⌘Z / ⇧⌘Z (or the ↶ ↷ buttons on touch screens) on hours and profile; removing a
  holiday, a brand's own hours, or stopping a report email shows *Removed — Undo* for 6 seconds instead of an
  "are you sure?" question. Platform actions (86, pause, publish, orders) are never "undone" silently.
- **TakTak, the help robot**: always at the bottom right. First sign-in: TakTak spins in, says hello, lets you pick
  the language and text size, and offers a 1-minute guided tour. Each important button explains itself the first
  time you tap it; buttons that reach a platform explain **before** anything is sent ("Got it, continue" / "Not now").
  The help panel has this screen's guide and tour, display settings, connection status and a "send a report" button.
- **Text size and spacing per screen**: A / A+ / A++ in the top bar scales the whole console, buttons included;
  touch screens start bigger with 44 px touch targets. Kitchen tablets keep their setting whoever signs in.
- **Screen supervisor**: page crashes, failing or slow server calls and connection gaps are reported to the server
  (Activity Log, and `GET /api/foodhub/client-report` for the owner); a crashed screen shows TakTak with "Reload the
  screen" while orders, the new-order pop-up and the cancel alarm keep working; a "data not refreshing" banner
  appears after 45 s without live data. Help never covers the new-order pop-up or the cancellation alarm.
- Browser `confirm()` pop-ups replaced by a clear confirm sheet (store disconnect).

### Go-live fixes (verified against the code and the platforms' documentation)
- **DoorDash**: a new order is answered 202 and confirmed only once Clover has it (DoorDash counts a 200 as
  "confirmed"); cancellations and Dasher updates read DoorDash's documented fields (`external_order_id`,
  `client_order_id`, `dasher_status` with its 5 values); Menu Status closes the queued push; new **Menu Request**
  (menu pull) endpoint `GET /api/foodhub/webhooks/doordash/{location_id}`, required to onboard stores; DoorDash's
  3–8 minute answer window shows on the countdown.
- **Orders from a store nobody mapped** are never accepted automatically and never dropped into a guessed Clover
  register when several exist (they wait for a person, with the reason on the order).
- **Clover**: a merchant connected through the Clover app counts as "Clover expected" (no accepting without Clover
  because there is no env token); the only connected merchant is the default; in-store orders with "skip the
  pickles" in a note are no longer imported as SkipTheDishes orders.
- **Skip**: order timestamps in seconds, milliseconds or ISO-8601; an unreadable order is kept and refused so JET
  uses the tablet at once (never a 500).
- **Uber Eats**: token refusals show Uber's reason (e.g. `invalid_scope`); courier details from v2 `deliveries[]`;
  "unassigned" is no longer read as "assigned"; the countdown starts when the order was placed; a store activation
  is shown as *waiting for Uber* until Uber's `store.provisioned` webhook (warning after 15 minutes).
- **Sign-in**: codes are never shown on screen while live connectors are on; a correct code is burned only when the
  sign-in succeeds; public sign-in routes never echo database errors; profile preferences accept known fields only.
- `FOODHUB_AUTO_ACCEPT_DEFAULT` is gone (it only applied to unmapped stores, which are now never auto-accepted).

### Verification

| Gate | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | pass (0 errors) |
| `npm test` | 190 tests pass |
| `npm run build` | pass |
| `npm run verify:foodhub` | 382 end-to-end checks pass |
| Browser (Chromium) | 25 fluent-console scenarios (welcome, help drawer, text size, tour, autosave, offline draft recovery, undo, 6 s Undo, explain-before-publish), 33 console screens, security and role probes |

## 1.5.7 — production release of the RC10 console (2026-10-05)

Production release of **TAKATAK Food Hub + Finance Control Tower**: the RC10 kitchen-first console
(`1.5.7-foodhub-rc10.7`) with the full 1.4.0 audit and finalization merged in (every fix below is in this
release). Nothing here changes a locked decision ([LOCKED_DECISIONS.md](LOCKED_DECISIONS.md)); UrbanPiper stays
the **feature reference only** ([ATLAS_PARITY.md](ATLAS_PARITY.md)) — the product talks to the platforms
directly, with Clover as the POS.

### What RC10 brings (new since 1.4.0)

- **Sign-in without passwords** (6-digit code or one-tap link by email / SMS), first-run owner setup, kitchen
  tablets with a **PIN screen**, 14-hour staff sessions, tablet health (off / muted alerts).
- **New-order pop-up** with beep loop, prep time and reject reasons; **cancellation alarm** on every screen until
  someone acknowledges it.
- **Manager PIN** for gated actions (reject, cancel, refund-like changes, store pause, price changes, customer
  texts), logged with the approver's name.
- **Watchtower** supervisor with escalation (screen, team chat, kitchen phone, managers on duty, owner, support
  line), optional Claude explanations and Copilot. AI only explains — it never approves, refunds, posts or deletes.
- Customer texts / calls through the platform relay, message log, team chat webhook.
- Clover App Market app (OAuth per merchant, uninstall handling), Clover platform orders followed read-only,
  platform price markups, legal pages, VPS installer (`deploy/`), Docker image.
- A redesigned console: Overview, Orders, Kitchen (KDS), Stores, Menus, Alerts, Insights, Money, Settings
  (French and English).

### What this release fixes on top of RC10.7

**Sign-in and sessions**
- Session cookies carry a **version**: resetting a team member's password, or rotating `DASHBOARD_PASSWORD`,
  signs that person's devices out immediately (passwordless, PIN and recovery sessions alike). Everyone signs in
  once after this deploy.
- Sign-in attempts are **throttled per client and per user** (recovery login, legacy passwords and `Basic` auth):
  5 failures lock 60 s, doubling up to 15 min; the owner can never be locked out by someone else's attempts, and
  the owner password only counts under the owner username. Failed Basic attempts are logged (never the password).
- The client address comes from `x-forwarded-for` only behind a trusted proxy (automatic on Vercel;
  `FOODHUB_TRUST_PROXY=true` behind Caddy / Traefik / nginx / Cloudflare — the VPS installer sets it). Manager-PIN
  lockouts use the same rule and are keyed per signed-in person, so one person's wrong PINs never lock approvals for
  everyone.
- Without `SESSION_SECRET` the cookie key is **derived with scrypt** from the recovery password, never the raw
  password; a leaked cookie is no longer an offline oracle for `DASHBOARD_PASSWORD`. With live connectors on,
  `DASHBOARD_PASSWORD` is mandatory regardless of `SESSION_SECRET`.
- `Authorization: Basic` is honoured on `/api/foodhub/*` only (routes re-verify it); pages pass only with the owner
  password or a session cookie. The sign-in redirect refuses `/\evil.com`-style targets as well as `//evil.com`.
- No UrbanPiper hub: the inbound "Skip / DoorDash through UrbanPiper" webhook, its adapter, secret, settings panel
  and docs are removed (RC10's own check *no UrbanPiper channel anywhere* passes again).

**Orders, Clover, platforms** (from the 1.4.0 audit, now on the RC10 pipeline)
- *Accept without Clover (entered by hand)* replaces a plain Accept on orders Clover did not receive; a mapped
  merchant without a token is a configuration fault, never a reason to accept blind. A platform cancel that lands
  while an order is being put in Clover or accepted wins over the acceptance (nothing is accepted on the platform;
  the Clover copy is removed).
- Scheduled orders are never auto-closed before their time; a kitchen ticket that did not print is retried at fire
  time and shown as *Ticket not printed* with Reprint. The Skip backup flow is honest about what was not sent.
- 86 / pause results report how many platform stores actually received the change; blocked or failed sends are
  never shown as done. Clover: payments at hand-off use the platform's amounts (subtotal − discount + tax), voided
  payments and refunds of delivery orders are excluded from in-store sales, one kitchen printer per merchant
  (`CLOVER_PRINT_DEVICES`), orders handed to the Skip tablet are removed from the Clover register.
- Uber Eats store status uses `/v1/eats/stores/{id}/status`; a failed poll keeps the last known state. Uber menus
  send `en_ca` / `fr_ca` locale keys; closed days are sent the way Uber and DoorDash expect. Restaurant-funded
  discounts reach Food Hub; Too Good To Go amounts use one unit per feed (`TGTG_AMOUNTS_IN_CENTS`).
- Sync engine: per-platform pools (one platform that stops answering never starves the others), a KV claim prevents
  two dashboards or the cron from running housekeeping twice, partial reports are kept, the stale-sync alert fires
  after 10 minutes. Deferred webhook work that fails is kept under *Channels → Unparsed payloads*.
- Re-importing a Clover menu keeps items, categories, option groups, French names, descriptions **and platform
  markups** created in Food Hub; the menu editor validates its payload (zod allow-list), refuses unknown brands and
  keeps the 86 state owned by the 86 Board; price and markup changes go through the manager-PIN gate.

**Payout reconciliation**
- Restaurant-funded promotions are not short payments; short order codes match only on the same day and store;
  statement coverage derives from payout dates; deleting an overlapping statement keeps the others' imports; a
  problem that comes back reopens its case; an approved ledger entry whose figures changed is marked *Changed since
  approval*; bank-deposit gaps open their own case; Uber report downloads only follow https links on `uber.com` /
  `amazonaws.com` (or `UBER_REPORT_ALLOWED_HOSTS`), capped at 15 MB.

**Data and infrastructure**
- Supabase mode clears error flags the way memory mode does, patches order timelines concurrently-safe (optimistic
  concurrency), pages large tables deterministically and normalises partner timestamps.
- Server errors never echo database messages to the browser; prototype-named keys are rejected everywhere a key is
  looked up; report schedules and ad-hoc emails need the *finance* permission.

### Release engineering

- Dependencies **pinned** to the versions the lockfile installs (no more `latest`); `engines.node >= 22`;
  `npm run audit:prod` (production dependencies, high+).
- CI restored: production dependency audit, typecheck, lint, unit tests, build and the Food Hub end-to-end
  verification on every push and pull request (`.github/workflows/ci.yml`); weekly security audit.
- `supabase/INSTALL_ALL.sql` regenerated from `foodhub.sql` + `rc10.sql` (idempotent); legacy install files kept
  under `supabase/legacy/` for provenance only. Docs index: [README.md](README.md).

### Known limitations (documented, not fixed in this release)

- Sign-in throttling and PIN lockouts are per server instance (serverless instances do not share the counter), and
  when the app faces clients directly (no trusted proxy) every client shares one bucket.
- Vercel Hobby runs crons once a day: timed re-opens, timed 86s, scheduled publishes, scheduled orders and the
  Watchtower need the 5-minute / 1-minute pingers described in [FOODHUB.md](FOODHUB.md) (the VPS installer sets
  them up).
- Promotion / discount field names for Uber Eats, DoorDash and Skip come from their public payload documentation;
  confirm against the first real promoted order (an unknown field leaves the discount at 0).
- DoorDash store-status `404` is still read as *deactivated* (Uber's is *unknown*); the e2e mocks do not reject
  invalid menu shapes.
- The master menu holds one Clover item id per item; brands sold at a second Clover merchant inject custom line
  items instead of foreign item ids.

### Verification

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass (0 errors) |
| `npm test` | 173 tests pass |
| `npm run build` | pass |
| `npm run verify:foodhub` | 374 end-to-end checks pass against simulated Uber Eats, DoorDash, Skip (JET Connect), Clover, Resend, Twilio and a team chat |
| `npm run audit:prod` | 0 high/critical advisories in production dependencies (Next.js 16.3.8) |
| Browser (Chromium) | recovery sign-in, 33 console screens, order detail, logout, bogus-Basic gate on pages, throttle, roles and location scope, password reset / deactivation sign-out, open-redirect guard |

## 1.4.0 — production release (2026-10-05)

First production release of **TAKATAK Food Hub + Finance Control Tower**. It is the RC9 baseline
(`1.4.0-foodhub-rc9`, imported from the verified source archive) plus a full audit of every subsystem
and the fixes below. Nothing here changes a locked decision ([LOCKED_DECISIONS.md](LOCKED_DECISIONS.md)).

### What operators will notice

- **Everyone signs in once after the deploy.** Session cookies now carry a version; resetting a team
  member's password or rotating `DASHBOARD_PASSWORD` signs that person's devices out immediately.
- **"Accept without Clover (entered by hand)"** replaces a plain Accept on orders Clover did not receive.
  Nothing is accepted on a platform without a Clover order unless the operator explicitly says the order
  was entered by hand.
- **Scheduled (advance) orders are never auto-closed before their time** and stay on the board whatever day
  they arrived. A kitchen ticket that did not print is retried at fire time and shown as *Ticket not printed*
  with a Reprint button, on the board and as a Command Center alert.
- **Skip backup flow is honest.** When the hand-off to the Skip tablet could not be sent (live switch off,
  JET error) the order stays *New* with its buttons; the activity log says exactly what was not sent.
- **86 / pause results are real.** The 86 Board, publish dialog and activity log report how many platform
  stores actually received the change; blocked or failed sends are never shown as done.
- **Payout reconciliation** no longer flags restaurant-funded promotions as short payments, matches short
  order codes only on the same day and store, derives statement coverage from payout dates, survives
  deleting an overlapping statement, reopens a problem that comes back, and marks an approved ledger entry
  *Changed since approval* when a later import changed its figures. Bank-deposit gaps open their own case.
- **Uber Eats store status works against the real API** (`/v1/eats/stores/{id}/status`); a failed poll keeps
  the last known state instead of flipping every store to *deactivated*. An untimed DoorDash pause made
  from TAKATAK is shown as *paused*, not *DEACTIVATED*.
- **Uber menus** send locale keys (`en_ca` / `fr_ca`); closed days are sent the way Uber and DoorDash expect.
- Daily report emails fire at 08:05 Montréal time year-round and catch up a missed day; report schedules and
  ad-hoc emails need the *finance* permission (analysts stay read-only).
- Re-importing a Clover menu keeps every item, category and modifier group created in Food Hub, and the
  owner's descriptions; variable-price Clover items import as unavailable instead of $0.
- Statement uploads are limited to 4 MB per file (the hosting body limit); split larger exports by month.
- `/settings`, `/documents` and `/ai-ingestion` redirect to the real screens; the Control Tower store screens
  are labelled as the screenshot snapshot they are, with a link to the live Command Center.

### Security

- `Authorization: Basic` is honoured only on `/api/foodhub/*` (routes that re-verify it). Every
  `/api/backend/*` route authenticates itself; the unauthenticated legacy webhook stub and the generic REST
  connectors (which sent the DoorDash signing secret as a bearer token) are gone.
- Sign-in attempts are throttled per client and per user (login form and Basic auth), failed Basic attempts
  are logged, the owner password only counts under the owner username, and the owner can never be locked
  out by someone else's attempts. The client address comes from `x-forwarded-for` only behind a trusted proxy
  (automatic on Vercel, `FOODHUB_TRUST_PROXY=true` behind nginx/Caddy/Cloudflare).
- Without `SESSION_SECRET` the cookie key is derived with scrypt from the password (never the raw password);
  `npm run qa:env` warns when the secret is missing. With live connectors on, `DASHBOARD_PASSWORD` is
  mandatory regardless of `SESSION_SECRET`.
- Open redirect after sign-in closed; store mappings, Uber activation and forced syncs respect each user's
  location scope and role; prototype-named keys (`constructor`, `__proto__`) are rejected everywhere a key
  is looked up; Uber report downloads only follow https links on `uber.com` / `amazonaws.com`, capped at 15 MB;
  server errors never echo database messages to the browser; deferred webhook work that fails is kept under
  *Channels → Unparsed payloads* instead of being lost; a platform cancel that lands while an order is being
  put in Clover or accepted wins over the acceptance; Uber `resource_href` links are only followed on the Uber API origin.

### Data and infrastructure

- Supabase mode now clears error flags the way memory mode does, patches order timelines concurrently-safe
  (optimistic concurrency), pages large tables deterministically and normalises partner timestamps.
- The installer is idempotent: re-running `supabase/INSTALL_ALL.sql` never duplicates seeded stores, connector
  configurations or fix tasks; sync-now de-duplicates ingested records (`supabase/release_1_4_0_patch.sql`).
- UrbanPiper remnants removed from code, seeds and the installer.
- Sync engine: one platform that stops answering no longer starves the others (per-platform pools, 5 s status
  reads, partial reports); a KV claim prevents two dashboards or the cron from running housekeeping twice;
  a pause made from TAKATAK keeps its origin across syncs; the stale-sync alert fires after 10 minutes.
- Clover: payments recorded at hand-off use the platform's own amounts (subtotal − discount + tax), voided
  payments and refunds of delivery orders are excluded from in-store sales, one kitchen printer per merchant
  (`CLOVER_PRINT_DEVICES`), and orders handed to the Skip tablet are removed from the Clover register.
- Platform payloads now carry restaurant-funded discounts into Food Hub; Too Good To Go feed amounts use one
  unit per payload (`TGTG_AMOUNTS_IN_CENTS`).

### Release engineering

- `npm run lint` works again (Next.js 16 removed `next lint`): ESLint 9 flat config with the Next core-web-vitals
  and TypeScript rules; two real React Hooks defects fixed.
- Dependencies pinned to the versions the lockfile already installed; `engines.node >= 22`; Vitest resolves the
  `@/` alias so route handlers are unit-testable.
- CI gates on the production dependency audit, typecheck, lint, unit tests, build, release readiness and the
  Food Hub end-to-end verification on every push and pull request; the security audit runs weekly and on
  dependency changes.
- Docs reorganised: [README.md](README.md) index, [FINAL_PRODUCT_READINESS.md](FINAL_PRODUCT_READINESS.md)
  rewritten for the direct-integration architecture, UrbanPiper-era reports moved to [history/](history/),
  `SECURITY.md` added.

### Known limitations (documented, not fixed in this release)

- Sign-in throttling is per server instance (serverless instances do not share the counter), and when the app
  faces clients directly (no trusted proxy) every client shares one bucket.
- Vercel Hobby runs the sync cron once a day; timed re-opens, timed 86s, scheduled publishes and scheduled
  orders fire while a Command Center screen is open or when a 5-minute pinger calls `/api/foodhub/cron/sync`
  ([GO_LIVE_NOW.md](GO_LIVE_NOW.md), step 8). The Command Center warns after 10 minutes without a sync.
- Promotion / discount field names for Uber Eats, DoorDash and Skip were taken from their public payload
  documentation; confirm against the first real promoted order (an unknown field simply leaves the discount at 0).
- DoorDash store-status `404` is still read as *deactivated* (Uber's is now *unknown*); the e2e mocks do not yet
  reject invalid menu shapes.
- The master menu holds one Clover item id per item; brands sold at a second Clover merchant inject custom line
  items instead of foreign item ids (a per-merchant menu link is future work).

### Verification

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass (0 errors; remaining warnings are `no-explicit-any` at the platform edges) |
| `npm test` | 160 tests pass |
| `npm run build` | pass |
| `npm run release:check` | pass |
| `npm run verify:foodhub` | 276 end-to-end checks pass against simulated Uber Eats, DoorDash, Skip (JET Connect), Clover and Resend |
| `npm run audit:prod` | 0 vulnerabilities in production dependencies |
| Browser (Chromium) | sign-in, wrong password, session cookie flags, 35 screens, logout, role/location scoping, Basic-auth gate, open-redirect guard |
