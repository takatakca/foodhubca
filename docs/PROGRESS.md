# Food Hub — progress log

Newest first. Every session reads this before starting (see `CLAUDE.md`) and updates it at the end of each piece of work.
The plan itself is `docs/MASTER_PLAN.md`; this file says where we are in it.

## 2026-10-07 16:40 UTC

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
