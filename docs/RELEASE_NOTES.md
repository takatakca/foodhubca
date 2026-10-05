# Release notes

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
