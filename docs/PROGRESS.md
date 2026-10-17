# Food Hub: progress log and task board

## 2026-10-16 — Client dashboard: simple view, full view, platform scope (task 40)

- Branch `feature/client-dashboard-easy` (from `origin/main` 444e8f2), not merged. Spec and status: `docs/CLIENT_DASHBOARD.md`.
- Simple view by default (6-item rail, phone bar of 4, avatar menu with language, text size and the "Vue complète" switch for owners and managers; cookie `fh_view` read on the server). Full view = the console before, unchanged.
- Scope gains the platform (`?channel=`) with store counts in the switcher (bottom sheet on phones) and filter chips; Home (4 numbers, To do, By platform, Get started), Orders (Actives / Planifiées / Historique), Alerts, Sales & trends, Reports and the new Restaurants → Tous les magasins follow it. Alarms, bell, badges and the kitchen screen never follow a brand or a platform.
- Read-only API additions: `channels=` on `/api/foodhub/command` (output unchanged without it, tested), `locations=` on `/api/foodhub/incidents`. The owner's DoorDash list is gated to the owner's tenant. No webhook, order write, Clover or menu-publish change; no env var, no migration.
- Review fixes (all majors and minors): Home numbers fit a phone, contrast, "Demander le branchement" on Get started, pause on the picked platform only, `/alerts?i=` links always show their alert, chip ARIA, 44 px targets, Épuisés wording, page titles, plain words. List in `docs/CLIENT_DASHBOARD.md` §22.
- Checks after the review fixes: typecheck OK, lint 0 errors, 983 tests passed + 1 skipped (1 failure in `tests/tgtg-email.test.ts`, also on `origin/main`, not touched here), webpack build OK, verify:foodhub 554/0 (32 screens). Env check: `FOODHUB_TENANT_ID` unset or `takatak` in production. Not merged, not deployed: ready for owner review/merge.

## 2026-10-16 — Uber store kitchen mapping (task 39, `fix/uber-store-kitchen-mapping`)

- The 7 Uber UUIDs in `data/actual/platform-stores-uber.json` are at 5839 Jean-Talon E (Saint-Léonard) in Uber's own records (Uber names them "(Hochelaga)"); production maps them to `NDG_6284`. That mapping was typed by hand in the console, so it lives only in the production `fh_channel_stores` rows: no repo seed or code defaulted Uber stores to NDG.
- Repo: data file records `SAINT_LEONARD` + Uber's name/address for the 7, plus the 9 live NDG UUIDs as an unmapped reference list (no Po Poulet). Stores → Mapping suggests the recorded kitchen (never a guess from the "(Hochelaga)" name) and warns about a known store mapped elsewhere, with a **Move** button. Production fix = owner steps / SQL in the pull request; production not changed.
- Checks: typecheck OK, lint 0 errors, 816 tests (1 skipped), webpack build OK, verify 541/0.
## 2026-10-16 — Menu safety + per-brand menus (task 37, `feature/menu-safety-brand-menus`)

- Clover → platforms: the Clover webhook now obeys `FOODHUB_CLOVER_INVENTORY_SYNC=off` (the polling already did). Locked and "Do not touch" stores are left out BEFORE the fan-out (no call, no Food Hub 86 state). A store follows the Clover merchant set on it under Stores → Mapping, or the default one (`CLOVER_MERCHANT_ID`) when none is set — as before, so nothing changes for today's stores. A location where the stores follow different merchants is not 86'd; one `clover_86_skipped` activity line per out-of-stock says why. An 86 Clover made earlier is always switched back on when Clover restocks, even where no store follows that merchant any more (`clover_86` origin keys).
- Deviation from C1 as first written ("stores without a merchant never count"): rejected after review, because with no mapping done every Clover 86 would stop silently and old Clover 86s would stay stuck. Owner can still ask for the stricter rule.
- DoorDash Menu Request (pull) and Item Polling answer 409 for a "Do not touch" store, like a locked one; the Deliverect product push refuses locked and "Do not touch" stores.
- Clover import: `excludeCategories` (default "Menu Employés", "INSTORE PROMOTIONS", "Menu promotionnel"; accents and case ignored) — the real export now imports exactly the 175 DoorDash-menu dishes.
- Per-brand dishes on a shared menu (`menu_brand_dishes_v1`): a follower brand shows only its picked dishes (by ref or Clover id), with the option groups they use (Duo / Trio / Combo) and their categories; applied in `getBrandMenu` and the 86 fan-out; edited in Menu → Menu partagé. A list that matches nothing never publishes an empty menu. Order line mapping still uses the whole shared menu.
- Review fixes: a follower with a dish list that stops sharing gets a copy of ITS dishes only (never the whole master menu; no copy at all when its list matches nothing); the "moved to another menu" timer copy keeps only its dishes' timers. A staff 86 reads the dish lists before saving any state. DoorDash Menu Request for a follower whose list matches nothing answers 409 with the reason and logs `menu_pull_refused`. Dish refs longer than 120 characters are refused by the API and dropped when read.
- Checks: typecheck OK, lint 0 errors, 841 tests passed, 1 skipped (+30 in tests/menu-safety-brand-menus.test.ts), webpack build OK, verify:foodhub 554/0. Not deployed.
- Owner after merge: nothing required for Clover 86s (stores without a merchant still follow `CLOVER_MERCHANT_ID`); set a merchant under Stores → Mapping only for a store that uses another Clover register. Menu → Shared menu: pick each brand's dishes, then publish those brands.
## 2026-10-16 — AI phone go-live (task 34, branch `feature/ai-phone-quebec-paylink`)

- Finished the paused WIP (f1402bf) and verified it. Voices and words: Québec French by default (understands France French), North-American English, Latin-American Spanish (Mexican / Cuban words), professional and short. Audit fixes: the keypad menu takes over when the AI fails (never a loop, never "je n'ai pas compris"); the order number, time and payment are always said, even with end_call in the same answer; each kitchen's real hours go to both assistants and hours never set refuse the order (a person takes it); AI authentication / credit failures pause the AI (keypad mode, one team-chat alert); texted links are pages that answer; a voicemail is marked emailed only once sent; FOODHUB_PUBLIC_URL trimmed and Twilio URL errors caught.
- Payment link by text (Clover Hosted Checkout, only when CLOVER_ECOMM_PRIVATE_KEY is set): the order is held, released exactly once when paid (pickup: kitchen ticket; delivery: courier), one reminder, expiry with a courtesy text, late or double payments flagged for a refund by a person.
- Duo (+2,50 $) / Trio (+5,42 $) / Combo (+7,58 $) read from the item's Clover modifier groups: offered once per call, at most one per item, the drink always asked (add_upsell); the Clover modifier id travels on the order line and goes to Clover as a real modification. Ticket printed on the kitchen's printer (CLOVER_PRINT_DEVICES "MID|LOCATION"). FOODHUB_CLOVER_NO_REGISTER keeps orders of a kitchen without a register out of Clover. Po Poulet only at Saint-Léonard (Hochelaga allowance removed).
- Console: Settings → Expansion → AI phone gets « Prêt pour les appels de test ? » (read-only checks) and a call simulator (real handlers, dry run: nothing sent). Without the new env vars, ordering works as before (pay at the counter).
- Review fixes (13 findings): a language word inside an order ("French fries", "Spanish rice", "frites à l'anglaise") never switches the language, and keys 2 / 3 switch it only on the greeting; in keypad mode a sentence starting with "no" is routed, only "non merci" / "that's all" alone ends the call; a delivery paid while the kitchen is closed (or for the wrong amount) gets no automatic courier and booking a courier keeps that flag; the courier tip is an untaxed line on Clover's page and the texted total is what Clover charges; merchants without GST / QST rates get no link, and a failed link lets the caller pay at the counter; only credit / billing / model 400s pause the AI, simulator and test calls never touch the breaker; the poller matches our whole mark and never releases a short payment; simulator owner-only with the fictional 555 caller; /p/ rate limit on the proxy's client IP, pruned, and a 10 s check cooldown; stored voices kept when well-formed.
- Deploy notes (behaviour that changes with no new env var): AI phone orders are refused when a brand's hours were never set (check Settings → Hours for every phone brand before merging, the readiness panel flags it); tickExpansion runs tickIvr even with every expansion switch off; on2go.ca placeholders resolve to https://on2go.ca; the IVR menu and yes/no steps use googlev2_telephony_short; Po Poulet lines outside Saint-Léonard are stripped / disabled; the payment-link release is "exactly once" with ONE Food Hub process (one Coolify container) — add an atomic claim before scaling out.
- Checks: typecheck OK, lint 0 errors, 849 tests (1 skipped), webpack build OK, verify:foodhub 541/0. Ready for owner review/merge.
## 2026-10-16 — Too Good To Go order e-mails (task 36)

- Branch `feature/tgtg-email-orders`: TGTG reservation / cancellation e-mails → Food Hub order on the same pipeline (kitchen screen, Clover order type "Too Good To Go", ticket with customer, bags, pickup window and TGTG code, paid with the "Too Good To Go" tender at pickup). Cancel = order cancelled, Clover order flagged "CANCELLED" (never deleted). Idempotent by Message-ID + TGTG code; unreadable e-mails go to an attention list.
- Sources: read-only IMAP poller (`imapflow`, `mailparser`) on the existing heartbeat, and a token-protected webhook for forwarding services. Feature off unless `TGTG_IMAP_*` or `TGTG_EMAIL_WEBHOOK_SECRET` is set. Owner steps: `docs/TGTG_EMAIL_ORDERS.md`.
- Review fixes (same day): a code needs a digit and a marker ("Order confirmation" is never a code); only From counts and the mailbox server must show dkim=pass / dmarc=pass; the "Too Good To Go" order type is forced only for e-mail orders; unmapped stores are never sent to Clover (unmap stops routing); one bad e-mail is kept as "error" and never blocks the poller; price paid by priority; cancel flag honours FOODHUB_CLOVER_DELETE_CANCELLED=off and keeps the note; webhook ?token= is opt-in and the 5 MB cap is enforced while reading. Checks: typecheck, lint 0 errors, 846 tests, webpack build, e2e 554/0.
## 2026-10-16 — DoorDash sandbox-safe mode (task 38, `feature/doordash-sandbox-safe-mode`, PR #56)

- DoorDash opened Marketplace for the org in SANDBOX only. New sandbox-safe mode lets the sandbox webhooks reach production
  Food Hub with no effect on real operations: sandbox traffic (DOORDASH_ENV=sandbox, a `_sandbox` provider type,
  DOORDASH_SANDBOX_STORE_IDS, a `_sandbox` provider_type in the payload, or an event about a held test order) becomes a
  TEST order in Settings → Plateformes et Clover → Essais DoorDash (bac à sable): never in the orders table, so never
  Clover, print, kitchen ring, Watchtower, SMS/calls, money or reports.
- The DoorDash side runs with the same calls as a real order (confirm with prep_time, reject with DoorDash failure codes,
  ready, merchant cancel, DoorDash cancel / Dasher / release / adjustment, menu pull, menu push, 86, pause), aimed only at
  the test store (a virtual store, never in the Stores table). With sandbox keys, real stores are refused for every
  DoorDash call and their status is not read (no false "deactivated" alert). Po Poulet NDG can never be a test store.
- Webhook auth (DOORDASH_WEBHOOK_SECRET in Authorization) unchanged and checked first. Without the new settings, behaviour
  is unchanged. Owner steps: docs/DOORDASH_SANDBOX.md. Tests: tests/doordash-sandbox.test.ts.
- Review fixes (same PR): the sandbox decision is taken when the webhook arrives and saved on its inbox entry, so a retry,
  the recovery runner or a Replay after DOORDASH_ENV changed never sends a test order to the kitchen; every test order id
  is kept in a permanent set (never emptied by the 50-order cap or Clear); a sandbox entry is never cut off by the
  3-minute answer window (no failed entry, activity line or Watchtower incident). New DOORDASH_SANDBOX_WEBHOOK_SECRET:
  the Sandbox subscriptions' own Authorization value, every request with it is a test whatever DOORDASH_ENV says. Item
  polling and cart validation answer the test store and refuse real stores under sandbox (409). A store mapped in Food
  Hub is never a test store (even if listed; the screen warns). The Reporting API is refused with the sandbox key unless
  DOORDASH_REPORTS_* is set. A `_sandbox` DOORDASH_PROVIDER_TYPE alone no longer turns the mode on (warning only).
  Docs step 6: delete the Sandbox subscriptions first, keep DOORDASH_SANDBOX_STORE_IDS and the sandbox secret.

## 2026-10-15 — Owner-authorized automatic production activation

- Reusing PR #49. Existing Coolify resource rebound to its installed GitHub App, push deployment enabled, source commit available to Docker and health monitoring enabled. Historical Actions deployment controller disabled to keep one production writer while GitHub runner billing is blocked.
- Dockerfile enforces isolated audit/check/build/E2E plus final pruned runtime smoke; production health requires a real healthy database. Fixed Vitest to include the verifier's `.mjs` regressions. Local audit/typecheck/lint/build passed, 807 unit tests passed (2 skipped), E2E 536/0.
- Private media/configuration backup and rollback image retained on Contabo. Existing Supabase/session/media preserved. Automatic Webhook success and exact live main-SHA proof still pending at this commit; no live connector certification claimed.

## 2026-10-14 — Live release proof and agent handoff

- Branch `agent/foodhub-deployment-verifier`: new `npm run verify:live` command and mock-only tests for exact SHA, ON2GO public feed/CORS, health, login and private orders route. Five public continuity docs added without copying local private task files.
- PR #48 remains open and green; `main` = `bb353ccfa82a7ba5e3d7af488e0da6bf03746c09` at inspection. Coolify deployment workflow remains gated/skipped; production success is **not** claimed. See `docs/AGENT_HANDOFF.md` and issue #46.

Newest first. Every session reads this before starting (see `CLAUDE.md`) and updates its own row at the end of each
piece of work. The plan itself is `docs/MASTER_PLAN.md`. Operations (support, emails, portals) are tracked privately in
`private/CLAIMS.md` and `private/OPS_LOG.md` in the main checkout, never in git.

## Task board (one task = one branch = one owner; edit only your own row)

> Since 2026-10-08 the **live board is `private/TASKS.md`** (local, git-ignored, main checkout). This copy is a snapshot, updated by pull requests only, never by a commit on `main`.

| # | Task | Branch / place | Owner (session) | Status | Next step |
|---|---|---|---|---|---|
| 1 | Production database | Coolify env | owner + main session | FIXED 2026-10-08: NEXT_PUBLIC_SUPABASE_URL pointed to the wrong project (TAKATAK Dashboard V1, eu-west-1); now takatak-foodhub (ca-central-1, Montréal), which already has all fh_* tables. Key pasted by owner | Restart after the running deploy if /api/health database is not ok. |
| 2 | Reconcile PR #6 with `main` | `reconcile-pr6` | Food Hub ↔ Clover backend session | MERGED (PR #9, 1fb58d6). Re-verified after task 9: 386/386 tests, webpack OK, verify 492/0 | Owner closes PR #6 without merging; deletes branch claude/brave-sagan-lmgsnp. |
| 3 | "Extra loud" kitchen alarm | `uber-eats-final` (`46e5046`, not in `main`) | the Uber session | TODO | Open a small PR of `46e5046` onto `main`. |
| 4 | Stray commit `7e99455` | `claude/brave-sagan-lmgsnp` | Food Hub ↔ Clover backend session | DONE: superseded (main has a superset posRetry type; job kind unused) | Owner may delete the branch `claude/brave-sagan-lmgsnp`. |
| 5 | Point platforms at `https://foodhub.on2go.ca` + end-to-end connections (Clover, Uber, DoorDash, sign-in codes) | Coolify env + Uber / DoorDash / Clover developer settings + branch `connections-golive` if code is needed | Connections agent (main session) | IN PROGRESS (claimed 2026-10-08 ~02:45 UTC) | Production DB key first (task 1, owner). Then FOODHUB_PUBLIC_URL, platform URLs, Clover connect, SMS/email codes (Twilio/Resend), test order through each path. |
| 6 | Phase 3 look and feel | local `wf/look`, `wf/kitchen` (PR #6 session) | the PR #6 session | PAUSED | Finish after task 2. |
| 7 | Brand websites without WordPress | separate repo `brand-sites` (local, no GitHub repo yet) | main session | READY, needs a GitHub repo | Owner creates private repo `takatakca/brand-sites` → push → Coolify resource (Dockerfile, port 80, `/healthz`). |
| 8 | SEO + consent kit on 12 website repos | branch `seo-legal-kit` in each `takatakca/*` site repo | main session | DONE, pushed | Owner reviews and merges each pull request. |
| 9 | SESSION_SECRET never generated + webpack client build fix | `fix/session-secret-stable` | Clover Marketplace session | MERGED (PR #8, 3a949e6) | Owner sets SESSION_SECRET in Coolify once (never change it). |
| 10 | Website orders through Clover (pppmtl.com first) shown on the Food Hub kitchen tablet, Clover keeps control | `clover-website-orders` (b8a818b) | Clover integration agent (main session) | MERGED (PR #10, f6c7bef), deployed 2026-10-08 04:35 UTC | Owner opens https://github.com/takatakca/foodhubca/compare/main...clover-website-orders?expand=1 after task 9 is merged; rerun the webpack build; merge, deploy; then follow docs/CLOVER_WEBSITE_ORDERS.md §4 (Clover online ordering on, pppmtl.com button, Orders webhook, FOODHUB_CLOVER_WEBSITE_BRAND) and place one test order + one refund. |
| 11 | Platform API research for Marketplace approval | `api-research` (277588f, docs only) | API research agent (main session) | DONE, pushed | Owner merges https://github.com/takatakca/foodhubca/compare/main...api-research?expand=1 ; owner starts the DoorDash application + asks for an Enterprise Partner Manager. Developer backlog (section 6) = task 13. |
| 12 | pppmtl.com wired to Clover (real items/photos/options, Clover Hosted Checkout) + tablet mirror | pppmtl `clover-direct` (d7b4366) + foodhubca `clover-website-menu` (0d7c76a, on top of task 10) | Clover website menu agent | DONE, pushed. pppmtl 79/79, build OK; foodhubca 372/372, verify 486/0 | Owner: pppmtl docs/integrations/clover.md §4–5 (host on Lovable or Coolify, Clover Hosted Checkout token + webhook secret + REST token); merge foodhubca 10 → 12; open pppmtl PR (syncs to Lovable); one real test order + refund. |
| 13 | Certification backlog (PLATFORM_API_RESEARCH §6) | `certification-backlog` (1a5fe62, main merged in) | Certification agent | DONE, pushed. 11 items coded, SOW skipped, Uber prep time TODO. Checks: 426/426 tests, webpack OK, verify 506/0 | Owner opens the PR (https://github.com/takatakca/foodhubca/compare/main...certification-backlog?expand=1), merges after task 12, deploys; then the owner actions and platform questions in docs/CERTIFICATION_BACKLOG.md |
| 14 | Move Supabase project "TAKATAK User Official Dashboard V1" from eu-west-1 (Ireland) to ca-central-1 (Montréal) | none | main session | CANCELLED 2026-10-08 by the owner: the project stays in Europe as long as it works. Nothing was changed. | None. Do not restart this task unless the owner asks. |
| 18 | Brand phone lines: one Twilio number per brand rings one main number (whisper "Appel pour <marque>", voicemail and texts by email); numbers also serve Google Business Profile verification | `feature/brand-phone-lines` | Brand phone agent | DONE, pushed. Checks: typecheck OK, lint 0 errors, 420/420 tests, webpack OK | Owner merges and deploys; then creates the Twilio account (upgrade), buys the numbers, pastes the two webhook URLs on each number and adds the env names listed in `.env.example` (`FOODHUB_MAIN_PHONE`, `FOODHUB_BRAND_PHONES`, `FOODHUB_VOICEMAIL_EMAIL`, `TWILIO_*`). The owner guide is outside git. |
| 20 | takatak.ca brand section connected to Food Hub's multi-brand data (feed `GET /api/public/directory`, task 19) + one TAKATAK V1 workspace per restaurant brand (Quadro Holding admin owns all; brand logins by invitation) | foodhubca `claude/google-doordash-id-extraction-wg2f5l` (decision note `docs/TAKATAK_BRANDS_BRIDGE.md`, being written there); takatak-v1 local branch `claude/provision-brand-workspaces` (not pushed: no write access in that session) | DoorDash/Google session (claude, 2026-10-09) | IN PROGRESS (claimed 2026-10-09) | Read the note on that branch. A new session needs takatak.ca allowed in Network access, the takatak-v1 DB secrets and write access to takatak-v1; then push the setup script, run it dry-run, show the owner, `--apply` only after the owner says yes. |
| 27 | DoorDash: every store back to tablet after UrbanPiper; store list and IDs; Google listings / Ads prep (operations, outside git) | owner's private Google Drive folder "TAKATAK OPS (private)" (README, CLAIMS, APPROVED_VALUES, OPS_LOG) | DoorDash/Google session (claude, 2026-10-09) | IN PROGRESS | Read the Drive folder README first. Never redo, undo or re-send anything its OPS_LOG records without the owner. One agent at a time in the DoorDash portal and each Gmail inbox. |

## 2026-10-08 06:20 UTC (brand phone agent, task 18: `feature/brand-phone-lines`)

**Done:** a Twilio voice webhook for one phone number per brand. Nothing was bought or created in Twilio.
- `POST /api/foodhub/voice/incoming` rings `FOODHUB_MAIN_PHONE`; the person who answers hears "Appel pour <marque>" (whisper); no answer after 20 s: bilingual greeting and voicemail, emailed (existing notify email) with a signed 30-day listen link. A text sent to a brand number is emailed too (`/voice/sms`).
- The number to brand map is `FOODHUB_BRAND_PHONES` (JSON, env only, no numbers in git). A line for Po Poulet NDG is refused. Every Twilio request is checked with `TWILIO_AUTH_TOKEN`; `/api/foodhub/voice/` is public in `proxy.ts` for that reason.
- Separate from the AI order-taking agent (`/api/foodhub/webhooks/voice`): a number points at one or the other.
- Checks: typecheck OK, lint 0 errors, 420/420 unit tests (20 new), webpack build OK.

**Next:** owner merges, deploys, then the Twilio steps in the owner guide.

## 2026-10-09 02:50 UTC (ON2GO agent, task 19: `feature/public-directory-api`)

**Done:** public read-only directory feed `GET /api/public/directory` for ON2GO.ca and QMAPS (docs/PUBLIC_DIRECTORY_API.md).
- 17 brands, NDG + Saint-Léonard kitchens, hours (Settings → Hours win), open now / open late, 10–12 dishes (Clover id, price, photo), order links (Clover first when `FOODHUB_PUBLIC_CLOVER_ORDER_URL` is set), 7-day trending rank.
- Public facts only; Po Poulet NDG never linked; never "24 h" (open late until about 3 AM). Cached 5 min, CORS on2go.ca / qmaps.ca / localhost.
- Checks: typecheck OK, lint 0 errors, 413/413 tests (+ snapshot export), webpack build OK, verify 506/0.
- **Next (owner):** merge, deploy, set `FOODHUB_PUBLIC_CLOVER_ORDER_URL` in Coolify. ON2GO site: repo takatakca/on2goca, branch `feature/on2go-directory`.

## 2026-10-08 06:00 UTC (infra architect agent, task 16: `ci/prebuilt-image`)

- New workflow `.github/workflows/image.yml` ("Food Hub image"): GitHub builds the existing Dockerfile, starts the image
  and checks `/api/health`, then stores it as `ghcr.io/takatakca/foodhubca` (tags `main`, `sha-<short>`, `v*`).
  Pull requests and `ci/**` branches build and test only. No new secret (built-in GITHUB_TOKEN). Dockerfile unchanged:
  Coolify keeps building as today until the owner creates a "Docker Image" resource on `ghcr.io/takatakca/foodhubca:main`.
- First run on the branch: build + smoke test green in 3 min (cold cache), nothing published.
- Checks: typecheck OK, lint 0 errors, 400/400 tests, workflow YAML parsed.
- Owner steps (merge, package visibility, Coolify switch) are in the private hosting plan.

## 2026-10-09 09:45 UTC (Uber API coverage agent, task 22: `feature/uber-api-coverage` → PR #21)
- Every official Uber Eats Marketplace endpoint and webhook and all of Uber Direct are in Food Hub: 61/61 endpoints (was 21), 17/17 webhooks (was 14). Table, scopes and the 176 github.com/uber repos: `docs/UBER_API_COVERAGE.md`.
- Kitchen: Ready / +5 min / prep time go to Uber; Uber missing item and price change in the order drawer; new Stores → Uber Eats tab; Uber Direct proof / PIN options in Settings → Delivery.
- Checks: typecheck OK, lint 0 errors, 475/475 tests, clean webpack build OK, verify:foodhub 508/0 (ports 5499/5500).
- Next: owner merges PR #21 and deploys; owner asks Uber for the optional scopes (doc, Owner steps).

## 2026-10-09 10:15 UTC (Finance A–Z session, task 30: `claude/nostalgic-dhawan-8f5bae`)

**Done**
- **Finance A–Z report** (`scripts/finance-report.ts`, `lib/foodhub/finance/*`; how to use: `docs/FINANCE_REPORT.md`).
  - It reads the owner's exports and the portal scans from git-ignored `private/` only.
  - It builds a workbook with live formulas: P&L per platform / brand / location / month, platform comparison by year,
    GST/QST summary, dispute register, payouts vs bank, money held, to-do.
- **Pure helpers extracted for reuse** (old exports unchanged):
  - `lib/foodhub/brand-match.ts`, now holding main's newer matcher with the 5839 alias and the street fallback;
  - `lib/foodhub/pos/platform-labels.ts`.
- **Checks** (origin/main `ac9848a` merged in):
  - typecheck OK, lint 0 errors, **466/466 tests**, `next build --webpack` OK;
  - Excel recalculation of the workbook: 8,398 formulas, 0 errors, 0 differences.

**Next**
- Owner reviews and merges the PR. No env var, no migration, nothing deployed.
- The per-order exports are being downloaded into `private/finance/inbox/`; the live status is in `private/TASKS.md` row 30.

## 2026-10-08 05:35 UTC (SMTP agent, task 16: `feature/smtp-email`)

**Done:** email can go out by SMTP (the owner's own mailboxes, e.g. MochaHost) as well as Resend. Not merged: the owner reviews and merges.
- One sender, `lib/foodhub/notify/email.ts` (nodemailer). SMTP is used when `SMTP_HOST` + `SMTP_USER` + `SMTP_PASS` are all set (`SMTP_PORT` default 465 = TLS, 587 = STARTTLS; optional `SMTP_SECURE`, `SMTP_TLS_SERVERNAME`); otherwise Resend, as before. 10 s timeout, the password is never logged or returned.
- Sign-in codes, invitations, alerts (`notify`) and reports (`reports.ts`) both go through it. Reports now fall back to `AUTH_EMAIL_FROM` when `REPORT_EMAIL_FROM` is empty.
- `SMTP_*` added next to `RESEND_API_KEY` in `.env.example`, `npm run setup`, Go-live, Alerts, Profile, Reports banner, docs and the privacy page.
- Tests: `tests/email-smtp.test.ts` (SMTP vs Resend vs none, transport mocked, no network). Checks: typecheck, lint 0 errors, 422/422 tests, webpack build OK, verify:foodhub 506/0.
- Owner on Coolify: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` (full mailbox address), `SMTP_PASS`, `AUTH_EMAIL_FROM`; then Settings → Alerts → "Email me" to test.

## 2026-10-09 (IVR agent, task 26: `feature/on2go-phone-ivr`, based on `feature/ai-phone-kitchens`)

- ON2GO phone menu on the main line: greeting (owner's text, editable; safer wording offered), then the AI talks and
  routes with `route_to`; keypad fallback (0 = person, star = repeat, 2 misses → keypad menu); FR / EN / ES.
- Branches: own online order (lookup, ticket, ordering agent), platform order (order number → reference saved → official
  DoorDash line / Uber Eats and Skip help link by text), billing, merchant, courier, customer service, person, voicemail
  (live transcription, ticket, email). Spanish added to the AI ordering agent.
- Screens: Settings → Expansion → AI phone → Menu téléphonique; Own orders → ON2GO line. Docs: EXPANSION_FEATURES §4b.
- Next: owner merges after `feature/ai-phone-kitchens`, sets the two Twilio webhooks and `FOODHUB_IVR_NUMBER`.

## 2026-10-08 05:30 UTC (Food Hub ↔ Clover backend session, task 2: `reconcile-pr6`)

**Done:** PR #6's fixes ported onto `main`'s webhook inbox and Clover retry. No inbox swap.
- **Inbox:**
  - An automatic run never cooks a late order. Past the platform's answer window (or 30 min for relay and Too Good To Go), the order waits for a person.
  - An entry interrupted 5 times goes to a person.
  - A copy saved although Food Hub answered 503 is marked "refused" and never processed.
  - Managers limited to some locations only see and replay theirs.
  - A relay cancel waits for its order.
  - An order stored before a server stop is **finished** by the next delivery or Replay (Clover is checked first) instead of answering "duplicate".
- **Clover retry:**
  - Never sends into a guessed register.
  - Re-reads the order after each send: someone else's copy wins; a cancelled order gets no ticket.
  - One send per order at a time.
  - Stops at the platform deadline or after 30 min.
  - Still retries an order the platform accepted on its side.
- **/api/health:**
  - Computed once per 10 s for the public answer, with a 4 s database limit, using a tiny `sync:at` key.
  - Memory mode in production and a locked console count as "down".
  - Public on the exact path only.
- **Watchtower:**
  - "Order from an unmapped store" incident.
  - Silence alarm counted in opening minutes, Too Good To Go left out.
  - `menu_failed` ignores blocked actions.
  - A webhook waiting for a person now opens an on-screen incident.
- **Go-live:**
  - SESSION_SECRET row: set, 32+ characters, stable. The generation itself stays task 9's.
  - The Clover row stays to-do while a mapped store cannot reach its register.
- e2e section 42b covers the relay, shared menus and a late DoorDash order. 28 new unit tests.
- Task 4: `7e99455` is superseded; branch `claude/brave-sagan-lmgsnp` can be deleted.

**Checks:** typecheck OK, lint 0 errors, 385/385 unit tests, webpack build OK, `verify:foodhub` 492/0.
- The webpack build needs task 9's `public-url.ts` fix: main's own build fails without it. That fix was applied locally for the run, not committed here.

**Next:** merge task 9, then this PR (rerun the webpack build after task 9). PR #6 can then be closed without merging: its fixes are here, and its inbox swap is not wanted.

## 2026-10-07 22:45 UTC (main session)

**Done**
- **PR #7 merged into `main` (`e97c1f7`) and deployed:**
  - It brings in `clover-backend-final`, `clover-marketplace-launch`, `uber-eats-final` and `expansion-features`.
  - Conflicts were resolved by keeping both sides. Only one webhook inbox is kept: clover-backend-final's, plus the Uber
    event_id dedupe and the full Uber event handling.
  - Checks: 357/357 unit tests, build OK, `verify:foodhub` 470/0.
  - Po Poulet NDG lock hole fixed: clearing or re-adding the mapping now returns 409.
  - DoorDash Menu Request now applies the alcohol rules.
- `https://foodhub.on2go.ca` answers (DNS A record → VPS, Coolify domain, HTTPS).

**Found**
- `/api/health` is **down**: the logs say `Supabase: Invalid API key`.
- Earlier builds inlined `NEXT_PUBLIC_SUPABASE_URL` at build time. Built without it, they silently ran in **memory mode**,
  which is why the bad key never showed.
- `main` now reads the URL at run time (from clover-marketplace-launch), so it really connects and the key is refused.
  Owner action: task 1.
- PR #6 was not merged before PR #7. Its comparison of the three inboxes still applies, on top of `main` now (task 2).

**Next**: tasks 1 → 5, then 2 and 3.

## 2026-10-07 16:40 UTC (PR #6 session, copied from its branch)

**Branches found (all based on `main` `a8705ec`; none contains another, none has a PR)**

| Branch | What it has | Overlap |
|---|---|---|
| `expansion-features` | **DoorDash Drive + Uber Direct couriers for our own orders**, auto-dispatch, AI phone ordering, Québec alcohol rules, grocery catalogue | none |
| `clover-backend-final` | Clover-linked lines and modifiers, order types, inbox UI with Replay, **Clover auto-retry with lookup-before-retry** | its own order inbox and Clover retry |
| `uber-eats-final` | Uber activation, menu body and webhook fixes; Uber-only inbox `uber_webhooks` | a third inbox |
| `clover-marketplace-launch` | App Market launch flow, runtime Supabase URL, media volume; generated `SESSION_SECRET` | go-live, `SESSION_SECRET` |

- **Courier dispatch withdrawn on this branch.** It already exists on `expansion-features`; the claim in the 10:05 entry is cancelled.
- **Comparison run (evidence: the PR #6 review's failing tests, run against every branch):**
  - **Order inbox:** keep PR #6's `order_inbox`.
    - It is the only one that refuses a late Clover ticket, caps the retries and covers all five channels.
    - Port into it:
      - from `uber-eats-final`: `handleUberEvent`, with its Uber CANCELED check;
      - from `clover-backend-final`: its DoorDash event classification, its more frequent recovery runs (timer, cron, pulse) with a claim, the auto-retry delays and the replay of unreadable payloads.
    - Drop the other two inboxes.
  - **Clover retry:** keep `clover-backend-final`'s.
    - It is the only one that looks in Clover before re-sending after a lost answer, so a timeout never prints a second ticket.
    - Port into it from PR #6: the re-read after the Clover call (cancelled or settled by hand in the meantime), the platform deadline, the in-process guard, and the "several registers" guard.
    - Drop PR #6's `retryFailedInjections`.
  - **Go-live, `/api/health`, `SESSION_SECRET`:** keep PR #6's.
    - A generated `SESSION_SECRET` breaks when the database is down at boot, on a first boot with two instances, and in memory mode.
    - Port from `clover-marketplace-launch`: the runtime Supabase URL, the media `VOLUME` and the public-URL check.
    - Note: `next build --webpack` fails on `clover-marketplace-launch`.

**Done (this push)** — review fixes that hold whichever way the branches are merged:
- Go-live: Clover, and each platform row, stay to-do while a mapped store cannot reach its register (no merchant, no token, Clover app access expired). The store is resolved exactly as `injectOrder` resolves it.
- `/api/health`: one database check at a time, reused for 10 s; reads a tiny `sync:at` key instead of the whole sync report.
- Order inbox:
  - a 503 whose write actually went through is marked `refused`, so the sweep never cooks an order the platform kept;
  - relay and TGTG orders are not recovered after 30 min (`FOODHUB_INBOX_MAX_AGE_MIN`);
  - a relay cancel for an order still in the inbox now stops its Clover ticket;
  - managers limited to some locations see only their locations' records.
- Watchtower: `menu_failed` no longer counts never-sent ("blocked") actions as refused by a platform.
- Checks: typecheck clean; lint 0 errors; 312 unit tests (7 new regression files); webpack build; e2e 414/414.

**Still open (to do while merging, so nothing is coded twice)**
- Crash after the order was stored but before Clover: recovery and Replay report it as done. Fix it with `clover-backend-final`'s `resendToClover`, which looks in Clover first.
- The Clover retry ports listed above.

**Next**
1. The owner picks who merges the branches: this PR as the integration branch (recommended), or each session in turn.
2. Merge order:
   1. PR #6;
   2. `clover-backend-final` (its retry kept, its inbox dropped);
   3. `uber-eats-final` (its Uber handler kept, its inbox dropped);
   4. `clover-marketplace-launch` (minus the generated `SESSION_SECRET`);
   5. `expansion-features`.
3. Phase 3 look and feel: WIP saved locally on `wf/look` and `wf/kitchen`; finish after the merge.

## 2026-10-07 10:05 UTC

**Done**
- **PR #5, merged into `main` (`a8705ec`):**
  - Food Hub Order Relay, which replaces UrbanPiper.
  - One menu shared by all brands.
  - DoorDash and Uber Eats fixed against their documented APIs.
  - Strict Docker build, in-server sync every 5 minutes.
  - Docs: `docs/BACK_ONLINE_TODAY.md` and `docs/MASTER_PLAN.md`.
- **PR #6, open, CI green on `065fd34`:** Phase 0 + Phase 1, "never lose an order":
  - Durable order intake + Replay (`lib/foodhub/inbox.ts`).
  - `GET /api/health`.
  - Watchtower: `sync_stale` and `menu_failed` now text the managers; new `platform_silent` and `store_unmapped` alarms.
  - Automatic Clover retry: 30 s → 2 min → 5 min.
  - Go-live checklist that tells the truth (Clover merchant really usable, Skip through the relay, `SESSION_SECRET`).
  - End-to-end script: 414 checks (relay, shared menus, health).
  - Unit tests: 302.

**In progress**
- **Independent review of PR #6** (intake, Clover retry and alarms, public endpoints), re-run after the usage limit. Merge after it.
- **Phase 3 look and feel.** Work in progress is saved on two local branches, to be finished, checked with screenshots and merged:
  - `wf/look` (`75f7bef`):
    - Motion tokens and the reduced-motion rule.
    - Contrast.
    - Layered surfaces and card variants.
    - Exit animations for overlays and toasts.
    - Micro-interactions.
    - CountUp, CopyButton.
  - `wf/kitchen` (`d84fc4e`):
    - Kitchen dark theme on `<html>`, so pop-ups and the drawer are dark.
    - 48 px touch targets.
    - Sound banner.
    - TableSkeleton.
    - `loading.tsx` / `error.tsx`.
    - New-order landing animation.

- **(Withdrawn 16:40 UTC: already built on `expansion-features`.) Own-courier dispatch, started 2026-10-07 10:30 UTC on `claude/practical-wright-pnhgtl`, backend first.** Food Hub requests and tracks a courier for the restaurant's own orders:
  - **DoorDash Drive API v2 first.** Research of the API and the code map are under way.
  - **Uber Direct later, behind the same provider interface.** Skip only if they offer a courier-only API.
  - MASTER_PLAN lists this as "own-courier dispatch (DoorDash Drive / Uber Direct)". Do not start it on another branch.

**Coordination**
- Branch `claude/brave-sagan-lmgsnp` (one commit, 07:43 UTC) starts a "durable webhook inbox" and a "Clover auto-retry". Both are already fully built in PR #6, so build on PR #6 instead of starting them again.

**Next (MASTER_PLAN)**
1. Merge PR #6, then redeploy on Coolify from `main`.
2. Finish Phase 3: P0/P1 above, then P2 — page transitions, scroll-linked top bar, Connections strip on the Overview, Go-live stepper, celebrations.
3. Phase 2 needs the owner: platform approvals (Uber scopes, DoorDash `PROVIDER_TYPE`, Skip JET key, TGTG spec) and the Clover App Market submission.
4. Phase 4: Autopilot.

**Owner actions still open** (see `docs/BACK_ONLINE_TODAY.md`):
- Switch the stores back to the platform tablets.
- Redeploy from `main` with the environment variables.
- Set up the uptime monitor on `/api/health`.
- Ask DoorDash to configure the Order Cancellation webhook.
