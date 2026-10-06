# TAKATAK Food Hub — Master Plan

_Updated 2026-10-06 · branch `claude/practical-wright-pnhgtl` · based on the code (the live server was not visible)._

This file has two jobs:
1. **For the owner:** what is done, why logins and connections may not be showing, and what is left.
2. **For the next work session:** section 8 has prompts ready to paste into Claude Code at the root of this repository, one per phase.

---

## 1. In one minute

- **Food Hub now does UrbanPiper's job itself.**
  - One menu, shared by all brands, sent straight to Uber Eats, DoorDash and Skip.
  - Every platform order goes into Clover, prints in the kitchen and shows on the kitchen screen.
  - Partners that send orders (for example a Too Good To Go feed) use Food Hub's own **Order Relay**.
- **The code is ready. Your live server is not yet.** Most of what feels "missing" is one of these:
  - the new work has not been deployed;
  - keys have not been entered on the server;
  - the platforms (DoorDash, Uber, Skip, Clover App Market) have not approved access yet.
- **What's next, in order:**
  1. Put the new version live.
  2. Make sure no order can ever be lost.
  3. Finish the platform approvals.
  4. Give the console a premium, animated look.
  5. Add an Autopilot that runs the routine work by itself, within safe rules.

---

## 2. Why you don't see your logins and connections

Check these in order. Each line gives the cause and the fix.

| # | Cause | How to check | Fix |
|---|---|---|---|
| 1 | **The live server runs older code.** This session's work (Order Relay, shared menu, fixes) is only on branch `claude/practical-wright-pnhgtl`. `main` is release 1.5.7. | Settings → Platforms & Clover has no "Food Hub Order Relay" card, and the Menus page has no "Shared menu" button. | Merge the branch into `main` (open a pull request), then redeploy. On the VPS, updates come from a zip (`deploy/update-vps.sh`); on Coolify, redeploy from `main`. |
| 2 | **No database: memory mode.** Without the Supabase URL and service key, Food Hub silently runs in memory. Users, connected Clover merchants and generated secrets disappear at every restart. | A "Demo mode" banner at the top. Go-live shows the database step as not done. | Set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and run `supabase/INSTALL_ALL.sql` once. On Docker/Coolify, `NEXT_PUBLIC_*` values are read when the image is **built**, so set them as build-time variables too. |
| 3 | **Not signed in as owner.** Platforms & Clover, Go-live, "Show secrets" and the warning banners are owner (admin) only. | Settings → Team shows your role. | Sign in with the owner account. The recovery sign-in is username `owner` with `DASHBOARD_PASSWORD`. |
| 4 | **Secrets stay hidden.** They show as `••••` until "Show secrets" is clicked, and that only works when `DASHBOARD_PASSWORD` is set. | Click Show secrets; nothing changes. | Set `DASHBOARD_PASSWORD` and `SESSION_SECRET` on the server. |
| 5 | **Keys were never entered.** Coolify has no setup wizard, so every connection shows "Needs setup" or "Missing: …". | Settings → Platforms & Clover, each card. | Add the keys as environment variables (list in section 4). |
| 6 | **The platforms have not approved access yet.** | Card says blocked / not approved. | Uber must approve the scopes. DoorDash issues `DOORDASH_PROVIDER_TYPE` only after it approves the integration. Skip issues `SKIP_JET_API_KEY` through a partner manager. |
| 7 | **The Clover app is not in the App Market yet.** It has not been submitted, and its Site URL is still `31-220-96-134.sslip.io`. | `docs/CLOVER_APP_LISTING.md` (not submitted). | Phase 2: a real domain, legal pages approved, then submit the listing. |
| 8 | **Safe mode is on.** Nothing is sent to any platform until live mode is turned on. | Orange "safe mode" banner. | Set `LIVE_CONNECTORS_GLOBAL_ENABLED=true` once Go-live is all green. |
| 9 | **Sign-in codes never arrive.** No email (Resend) or SMS (Twilio) is set up. An unknown email still says "code sent" on purpose, so outsiders cannot guess who has access. | The code never arrives. | Set `RESEND_API_KEY` + `AUTH_EMAIL_FROM` (on a verified domain) and/or `TWILIO_*`. Until then, use the owner recovery sign-in. |
| 10 | **Nothing runs in the background on Coolify/Docker.** The platform sync only runs while a screen is open. | Store status, payouts and Clover orders go stale overnight. | Set `FOODHUB_INTERNAL_SYNC_MIN=5`, or add an outside cron that calls `/api/foodhub/cron/sync` every 5 minutes. |

**Where connections live in the console:**
- **Settings → Platforms & Clover:** every platform, its webhook address, Clover, the Clover app and the Order Relay.
- **Settings → Go-live:** a self-checking list of about 20 steps.

Phase 3 adds a **Connections strip on the Overview** so you see all of this at a glance.

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

**This session (branch `claude/practical-wright-pnhgtl`):**
- `aa1888d` Order Relay, converted from the UrbanPiper code.
- `11ecf86` One menu for all brands.
- `f213a76` and `bb4cbe3` Hardening from an adversarial review:
  - Relay: relayed Skip orders no longer use the Skip tablet shortcut; reject is never faked; statuses only move forward; payloads are kept, never dropped; no duplicate orders.
  - Shared menu: a brand that stops sharing keeps its 86s; a sharing-map read error stops the action instead of guessing; "publish every brand" schedules are listed and cancelled together.
- Tests: 197 unit tests pass, typecheck clean, lint has 0 errors.

---

## 4. Connection board

| System | Built | What you must get or enter | Where to check |
|---|---|---|---|
| Clover (API) | Yes | `CLOVER_MERCHANT_ID`, `CLOVER_ACCESS_TOKEN` (or `CLOVER_MERCHANT_TOKENS` for several merchants), `CLOVER_PRINT_DEVICE(S)`, `CLOVER_WEBHOOK_AUTH` | Platforms & Clover → Clover POS |
| Clover App Market app | Yes | `CLOVER_CLIENT_ID` (App ID `629HFYHNVMZYR`), `CLOVER_CLIENT_SECRET`, `FOODHUB_SUPPORT_EMAIL`, `FOODHUB_LEGAL_APPROVED=true`, a real domain, the listing submitted | Platforms & Clover → Clover app; Go-live |
| Uber Eats | Yes | `UBER_CLIENT_ID` / `UBER_CLIENT_SECRET`, with Uber's approval of `eats.order`, `eats.store`, `eats.store.status.write`, `eats.pos_provisioning`, `eats.report` | Platforms; Stores → Connect Uber Eats |
| DoorDash | Yes | `DOORDASH_DEVELOPER_ID`, `DOORDASH_KEY_ID`, `DOORDASH_SIGNING_SECRET`, and `DOORDASH_PROVIDER_TYPE` (issued by DoorDash after approval). Fallback: `FOODHUB_VIA_CLOVER=doordash` (orders read from Clover; menu managed in Clover) | Platforms |
| Skip | Yes | `SKIP_JET_API_KEY` from a Skip partner manager. If Skip says no, a partner can send Skip orders through the Relay (`FOODHUB_RELAY_CHANNELS=skip,tgtg`) | Platforms |
| Too Good To Go | Inbound only | Your rep's access and **their API spec**. Outbound actions (menu, bags, cancel) still have to be built once the spec arrives | Platforms; Money → TGTG |
| Order Relay | Yes (new) | Nothing required (the secret is generated). Optional: `FOODHUB_RELAY_CALLBACK_URL` / `_TOKEN` from the partner | Platforms → Food Hub Order Relay |
| Database | Yes | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, then run `INSTALL_ALL.sql` | Go-live |
| Email / SMS / calls | Yes | `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `TWILIO_*`, `ALERT_WEBHOOK_URL` (team chat) | Settings → Alerts & watchtower |
| AI | Yes | `ANTHROPIC_API_KEY` (optional `ANTHROPIC_MODEL`) | Settings → Alerts & watchtower |
| Security | Yes | `DASHBOARD_PASSWORD`, `SESSION_SECRET`, `FOODHUB_TRUST_PROXY=true` behind Caddy/Traefik | Go-live |
| Background jobs | Yes | VPS: the cron jobs from `install-vps.sh`. Coolify: `FOODHUB_INTERNAL_SYNC_MIN=5` | Go-live; the stale-sync alert |

---

## 5. What is left: the roadmap

Each phase ends with **acceptance checks**. A phase is done only when all of them pass.

### Phase 0: Ship what is built (days)

1. Merge `claude/practical-wright-pnhgtl` into `main` through a pull request. Deploy from `main`.
2. Fix the deploy traps:
   - The `Dockerfile` hides a failed build with `npm run build … || true`. Remove `|| true`.
   - Add build-time `ARG` for `NEXT_PUBLIC_SUPABASE_URL`.
   - Document `FOODHUB_INTERNAL_SYNC_MIN` in `.env.example` and set it to 5 on Coolify.
   - Make `SESSION_SECRET` generated like the other internal secrets, or required.
   - Mount `/app/data/media` as a persistent volume.
3. Fix the Go-live checklist:
   - The Clover line turns green with only the app keys; it should need a connected merchant.
   - Skip should count as done when it comes through the Relay.
4. Update `docs/ATLAS_PARITY.md`, `docs/RELEASE_NOTES.md` and `docs/INSTALLER_SERVEUR.md` (old zip and folder names) for the Relay and shared menus.

**Acceptance:**
- The live console shows the Relay card and the Shared menu button.
- No "Demo mode" banner.
- Go-live shows the database and secrets as done.
- The sync timestamp updates with no screen open.

### Phase 1: Never lose an order or miss an alarm (1–2 weeks)

1. **Save the raw webhook body before answering 200** (`lib/foodhub/webhook-utils.ts`), then process it. Add a **Replay** button for unparsed or failed payloads in Settings → Platforms.
2. Add **`/api/health`** (database, last sync, last order per platform, and whether the watchtower timer is alive). Add an outside uptime monitor that texts the owner.
3. Send texts by default for `menu_failed` and `sync_stale` (`lib/foodhub/watch/types.ts`).
4. Add a **silence alarm**: no orders from one platform for N hours while its stores are open (`lastOrderAt` already exists in `command.ts`).
5. **Unmapped store:** hold auto-accept when there are several kitchens, raise an escalating alarm, and suggest the mapping (relay orders carry the brand name).
6. **Retry Clover injection automatically** (30 s, then 2 min) before waking a manager.
7. Add the Relay and shared menus to the end-to-end script `scripts/foodhub-e2e.mjs`.

**Acceptance:**
- Killing the server between receiving an order and processing it loses nothing; the order is replayed.
- Stopping the scheduler texts the owner within 15 minutes.
- Breaking a platform webhook raises the silence alarm.

### Phase 2: Connections and approvals (depends on the platforms)

1. **DoorDash:**
   - Finish the audit of the direct menu push against DoorDash's Marketplace API docs: menu JSON fields, the PATCH-vs-POST menu id, hours, item status endpoints, the store-status 404 read as "deactivated", and unique ids across several brand stores.
   - Get `DOORDASH_PROVIDER_TYPE`.
   - Until then, `FOODHUB_VIA_CLOVER=doordash` is the working fallback.
2. **Uber Eats:** get the scopes approved; connect each brand's stores through OAuth; check the menu PUT and the 86 calls on one store, then roll out.
3. **Skip:** get the JET Connect key, or agree a partner feed through the Relay.
4. **Too Good To Go:** when the rep delivers the spec, write a real `tgtgAdapter`: read their orders (replacing the best-guess reader), send bag quantities and pickup windows, and cancel. Remove the permanent "blocked" results.
5. **Clover App Market:**
   - Get a real domain with HTTPS.
   - Approve the legal pages (`FOODHUB_LEGAL_APPROVED=true`).
   - Fill in support details, categories and screenshots (`docs/CLOVER_APP_LISTING.md`).
   - Submit the listing.

**Acceptance:**
- One real order per platform goes all the way to Clover, prints, and has its accept and ready confirmed on the platform.
- A menu publish and an 86 reach each platform.

### Phase 3: The experience upgrade

Goal: feel premium, alive, easy and smart, with no bare white screens, while keeping the kitchen fast and readable. Use native CSS first (View Transitions, `@starting-style`, scroll-driven animations, `@property`). Add the `motion` library only for drag and swipe, loaded lazily, never in the kitchen bundle.

**P0: foundations and fixes**
- Add motion settings and one `prefers-reduced-motion` rule in `app/globals.css`.
- Add the missing `shake` keyframe (the PIN pad uses it).
- Contrast: darken `ink-3` to at least 4.5:1; use `ink-4` only for borders and icons; kitchen order text at 7:1.
- **Kitchen dark theme on `<html>`.** Today the new-order pop-up, the cancel alarm and the order drawer show white on the dark kitchen screen.
- Touch targets of at least 48 px in the kitchen. Always-visible reorder handles. A tap legend for the store-health grid.
- A route-level `loading.tsx` / `error.tsx`, and a `TableSkeleton` replacing the seven plain "Chargement…" rows.

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
- A celebration, once each: Go-live reaches 100%, the first publish, Clover connected.
- **Guided onboarding:** a Go-live stepper with a progress ring, and a **Connections strip on the Overview** (Clover, Uber, DoorDash, Skip, TGTG, Relay, database, email/SMS, AI), each with a live status dot.

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

1. **An Autopilot page** (Settings → Autopilot). Each automation has an on/off switch, its rule, the last time it ran, and an undo where possible. Everything it does is written to the activity log with the actor "Autopilot".
2. **Safe automations** (each one switchable):
   - Re-publish 10 minutes after "Use Clover price" or after hours are saved (reuses `menu/schedule.ts`).
   - Retry failed menu, 86 and pause jobs with back-off.
   - Fetch the Uber payment report weekly.
   - Suggest store mappings from relay and Uber store names.
   - Auto-close stale orders (already done).
   - Pause a store whose kitchen tablet has been offline for N minutes during opening hours.
   - Resume it when the tablet is back.
3. **An AI daily brief** (Claude, using the existing Copilot snapshot): yesterday's sales by brand and platform, what went wrong, money to recover, and what to fix today. Sent by email and SMS at 08:00 Montréal and pinned on the Overview.
4. **AI suggests, a person approves in one tap.** The Copilot proposes actions ("86 the poutine at NDG on every brand?", "Pause Pizza Inntime for 20 min, the kitchen is 12 min late") as cards with **Approve / Dismiss**. The action runs through the same gated route as a manual click, so the manager PIN still applies when it should.
5. **Anomaly watch:** cancellations spiking, a platform going silent, prep times drifting, payout gaps. Each becomes a watchtower incident with an AI explanation.

**Acceptance:**
- Every Autopilot action appears in the activity log and can be turned off.
- AI never approves, posts, deletes or settles money (locked rule).
- With every Autopilot switch off, Food Hub behaves exactly as it does today.

### Phase 5: A product other merchants want

- A Clover App Market onboarding that feels effortless: install → `/welcome/clover` with a guided 3-step wizard (connect platforms, import the menu, tablet and PIN) and a celebration at the end.
- Brand kits (colour, logo, photos) used across the console and menus.
- From Atlas "not built": combo and nested options, ratings and reviews, own-courier dispatch (DoorDash Drive / Uber Direct) for phone orders, Google / Microsoft sign-in.

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

**Phase 0**
> Read docs/MASTER_PLAN.md (sections 2, 4 and 5 / Phase 0). Get branch `claude/practical-wright-pnhgtl` ready to merge into `main`:
> - Dockerfile: no `|| true` on the build; a build-time ARG for `NEXT_PUBLIC_SUPABASE_URL`.
> - Document `FOODHUB_INTERNAL_SYNC_MIN` in `.env.example`.
> - Generate `SESSION_SECRET` like the other internal secrets (`lib/foodhub/runtime-secrets.ts`).
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
