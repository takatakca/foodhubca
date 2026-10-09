# Food Hub: progress log and task board

Newest first. Every session reads this before starting (see `CLAUDE.md`) and updates its own row at the end of each
piece of work. The plan itself is `docs/MASTER_PLAN.md`. Operations (support, emails, portals, Google, social) are tracked privately in
the owner's Google Drive folder "TAKATAK OPS (private)" (CLAIMS, APPROVED_VALUES, OPS_LOG), never in git.

## Task board (one task = one branch = one owner; edit only your own row)

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
| 20 | takatak.ca brand section connected to Food Hub's multi-brand data (feed `GET /api/public/directory`, task 19) + one TAKATAK V1 workspace per restaurant brand (Quadro Holding admin owns all; brand logins by invitation) | foodhubca `claude/google-doordash-id-extraction-wg2f5l` (decision note `docs/TAKATAK_BRANDS_BRIDGE.md`); takatak-v1 local branch `claude/provision-brand-workspaces` (not pushed: no write access in this session) | DoorDash/Google session (claude, 2026-10-09) | IN PROGRESS (claimed 2026-10-09) | Read `docs/TAKATAK_BRANDS_BRIDGE.md`. Next session needs takatak.ca allowed in Network access, the takatak-v1 DB secrets and write access to takatak-v1; then push the provisioning script, run it dry-run, show the owner, `--apply` only after the owner says yes. |
| 21 | DoorDash: every store back to tablet after UrbanPiper; store list and IDs; Google listings / Ads prep (operations, outside git) | owner's private Google Drive: doc "HANDOFF - DoorDash + Google ads job (2026-10-09)" + sheet "Quadro DoorDash stores (confirmed 2026-10-08)" | DoorDash/Google session (claude, 2026-10-09) | IN PROGRESS | Read the Drive handoff doc first. Never redo, undo or re-send anything it logs without the owner. One agent at a time in the DoorDash portal and each Gmail inbox. |

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
