# Food Hub: progress log and task board

Newest first. Every session reads this before starting (see `CLAUDE.md`) and updates its own row at the end of each
piece of work. The plan itself is `docs/MASTER_PLAN.md`. Operations (support, emails, portals) are tracked privately in
`private/CLAIMS.md` and `private/OPS_LOG.md` in the main checkout, never in git.

## Task board (one task = one branch = one owner; edit only your own row)

| # | Task | Branch / place | Owner (session) | Status | Next step |
|---|---|---|---|---|---|
| 1 | Production database key | Coolify env `SUPABASE_SERVICE_ROLE_KEY` | **owner** | BLOCKED: Supabase answers "Invalid API key" | Owner pastes the service-role (secret) key of the project in `NEXT_PUBLIC_SUPABASE_URL`, then Restart. Then check `/api/health` and run `supabase/INSTALL_ALL.sql` if tables are missing. |
| 2 | Reconcile PR #6 with `main` | `reconcile-pr6` (from `main` 7b0c93b), one PR | Food Hub ↔ Clover backend session | IN PROGRESS (claimed 2026-10-07 ~23:00 UTC) | Port PR #6 fixes onto main's inbox (no inbox swap): late-ticket refusal, retry cap, 503→refused, relay/TGTG max age, relay cancel, location-scoped records, crash-before-Clover resend; Clover retry guards; /api/health 10 s cache; go-live truth; menu_failed; check SESSION_SECRET. |
| 3 | "Extra loud" kitchen alarm | `uber-eats-final` (`46e5046`, not in `main`) | the Uber session | TODO | Open a small PR of `46e5046` onto `main`. |
| 4 | Stray commit `7e99455` (types for inbox / Clover retry) | `claude/brave-sagan-lmgsnp` | Food Hub ↔ Clover backend session (with task 2) | TO CHECK | Checked inside the task 2 PR; close the branch if superseded. |
| 5 | Point platforms at `https://foodhub.on2go.ca` | Coolify env `FOODHUB_PUBLIC_URL` + Uber / DoorDash / Clover developer settings | main session (this log) | WAITING on task 1 | After the DB works: set `FOODHUB_PUBLIC_URL`, then update the Uber redirect URI + webhook, DoorDash webhooks + Menu Request, Clover site URL. Keep the sslip.io address as a fallback until each platform is switched. |
| 6 | Phase 3 look and feel | local `wf/look`, `wf/kitchen` (PR #6 session) | the PR #6 session | PAUSED | Finish after task 2. |
| 7 | Brand websites without WordPress | separate repo `brand-sites` (local, no GitHub repo yet) | main session | READY, needs a GitHub repo | Owner creates private repo `takatakca/brand-sites` → push → Coolify resource (Dockerfile, port 80, `/healthz`). |
| 8 | SEO + consent kit on 12 website repos | branch `seo-legal-kit` in each `takatakca/*` site repo | main session | DONE, pushed | Owner reviews and merges each pull request. |

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
