# Master plan: where we are (2026-10-30)

> **Pour le propriétaire :** les phases 0 et 1 sont bâties. La phase 2 attend DoorDash, Uber, Skip et Clover, pas le
> code. La phase 3 est à moitié faite. La phase 4 (Autopilot) est surtout à faire. La phase 5 est à environ 40 %.
> Vos gestes sont marqués **owner**. Tout le reste, un agent peut le faire maintenant.

Status of every item of [MASTER_PLAN.md](MASTER_PLAN.md), checked against `origin/main` f023fc7 plus
`release/2026-10-30` (PRs #127, #128, #129). Platform approval states come from the owner's private log (newest platform
entry 2026-10-23): re-confirm before acting. Agents: update this file when you finish an item, in your own PR.

## Phase 0: ship what is built
| Item | Status | Left / who |
|---|---|---|
| Relay + shared menu merged | done (#5) | — |
| Deploy traps | done (`Dockerfile`, `lib/supabase/server.ts`, stable `SESSION_SECRET`) | Coolify persistent storage for `/app/data/media`: **owner** confirms |
| Go-live checklist | done | — |
| Docs: ATLAS_PARITY, INSTALLER_SERVEUR | partial (no Relay / shared menu; installer names the old rc10 zip) | agent |
| Acceptance (Relay card, no demo banner, Go-live green, sync with no screen open) | was green 10-15 to 10-18 | re-check after the 2026-10-30 server outage: **owner** brings the server back, then agent |

## Phase 1: never lose an order
| Item | Status | Left / who |
|---|---|---|
| Save webhook before 200 + Replay | done (`webhook-utils.ts`, `inbox.ts`, `recovery.ts`) | — |
| `/api/health` | done | outside uptime monitor that texts the owner: **owner** (5-min check on `/api/health`) |
| Texts for `menu_failed` / `sync_stale`, silence alarm, unmapped store, Clover auto-retry, e2e for Relay + shared menu | done | — |
| Acceptance: kill the server mid-order, nothing lost | done for the window the acceptance names: CI job "Crash replay (real Postgres)", `npm run verify:crash` on postgres:16 + PostgREST kills the server after the webhook is saved and before processing (replayed exactly once), then after processing (not replayed). A stop in the middle of the pipeline (order row stored, or Clover order / ticket made) is covered by unit tests only (`resumeUnsentOrder`, Clover lost answer), not by this check ([CRASH_REPLAY_E2E.md](CRASH_REPLAY_E2E.md), branch `test/crash-replay-postgres`) | — |
| Acceptance: scheduler stops → owner texted in 15 min | partial | the outside monitor (**owner**) |

## Phase 2: connections and approvals (waits on platforms)
| Platform | Code | Left / who |
|---|---|---|
| DoorDash | done (#12, #28, #56) | production `DOORDASH_PROVIDER_TYPE`; webhook subscriptions; cancellation webhook: **DoorDash, then owner** |
| Uber Eats | done (#14, `UBER_EATS_FINAL.md`) | production access; UrbanPiper release; connect stores; one test order per kitchen: **Uber, then owner** |
| Skip | done (60/60 operations) | `SKIP_JET_API_KEY`: **owner / Skip** |
| Too Good To Go | e-mail intake done (#59) | no TGTG API exists; mailbox env `TGTG_IMAP_*` + store mapping: **owner** |
| Clover App Market | submitted 10-17 | Clover review, then `NEXT_PUBLIC_CLOVER_APPS_LIVE`: **Clover, then owner** |
| Acceptance: one real order per platform, menu + 86 reach each | not met | needs the approvals above |

Order screens meanwhile: the wall (#102) and the relay kit (#107) are on main; the owner signs in once per screen
(docs/PLATFORM_SCREENS_RELAY.md, Windows kit for a store PC).

## Phase 3: experience upgrade
| Item | Status | Left / who |
|---|---|---|
| P0 reduced motion, `shake`, contrast, kitchen dark on `<html>`, 48 px, loading/error, `TableSkeleton` | done (#52) | public pages have no loading/error: agent |
| P1 layered surfaces | partial | `tinted` variant, warm canvas: agent |
| P1 colour (+ logo) per brand, OS dark mode | not started | agent |
| P2 View Transitions, exit animations, count-up, vibration | not started | agent |
| P2 Connections strip | done | add e-mail/SMS + AI status: agent |
| P2 Go-live stepper ring, celebrations | partial (welcome wizard only) | agent |
| Guardrails (+25 KB JS, INP < 200 ms), Lighthouse a11y ≥ 95 | a11y: axe WCAG 2.1 AA, 0 violations on 11 page states × phone + desktop, reduced motion asserted (system + console setting, phone + desktop), CI step (`npm run verify:a11y`, docs/ACCESSIBILITY.md, branch `feature/a11y-axe-check`); JS size + INP not measured | agent (INP needs the real tablet) |

## Phase 4: Autopilot
| Item | Status | Left / who |
|---|---|---|
| Settings → Autopilot page | not started | agent |
| Safe automations | partial (tablet-off pause/resume guard #74, daily reconciliation, store-mapping hint) | re-publish 10 min after price/hours change; weekly Uber payment report: agent |
| AI daily brief | not started | agent + **owner** keys (`ANTHROPIC_API_KEY`, e-mail/SMS) |
| Copilot Approve / Dismiss cards | not started | agent |
| Anomaly watch | partial (cancel spike, platform silent, payout gap) | prep-time drift: agent |

## Phase 5: a product other merchants want
| Item | Status | Left / who |
|---|---|---|
| Clover onboarding wizard | done | — |
| Ratings and reviews | done (#73) | — |
| Google sign-in | done | `GOOGLE_OAUTH_CLIENT_ID`: **owner** |
| Own couriers (Drive / Uber Direct / own fleet) | built, behind switches | production keys: **owner** |
| Brand kits, combos / nested options, Microsoft sign-in | not started | agent |

## On main but not in the plan (add to the plan)
Platform screens wall + relay kit (#102, #107) · customer accounts + ON2GO sign-in (#123, #124) · MEV / QCMEV
(#99, #100, off until Revenu Québec test environment, not certified) · Too Good To Go e-mail orders (#59) · own fleet +
courier app · taxes by province (#121) · direct orders, website orders, Clover checkout (`/commander/<slug>`) · AI phone ·
WhatsApp/SMS (#115) · restaurant leads API (#87) · store availability centre (#74). In `release/2026-10-30`: Interac
e-transfer (#128), kitchen tablet app with printing (#129), Twilio Verify on its own account (#127).

**Owner decision needed:** Deliverect code (`app/api/foodhub/webhooks/deliverect`, `lib/foodhub/deliverect-ops.ts`)
exists on main but contradicts the no-aggregator rule (2026-10-16): keep it dormant, or remove it.

## Next ten steps
1. **Owner:** bring the server back (down since 2026-10-30 ~12:05 UTC), then merge the release PR and deploy.
2. **Owner:** outside uptime monitor on `/api/health` (texts you).
3. **Owner:** chase DoorDash production, Uber production, Skip key, Clover review.
4. **Owner:** decide on Deliverect.
5. Agent: refresh ATLAS_PARITY, INSTALLER_SERVEUR and MASTER_PLAN sections 1–2.
6. Agent: Lighthouse / axe ≥ 95 locally, then a CI check. (Done on `feature/a11y-axe-check`: `npm run verify:a11y` + CI step.)
7. Agent: brand colour + logo on each brand (`--brand-accent`).
8. Agent: Settings → Autopilot around the automations that already exist.
9. ~~Agent: e2e that kills the server mid-order (exactly once).~~ Done: `npm run verify:crash` in CI (`test/crash-replay-postgres`): kill after the inbox save and after processing; mid-pipeline stops stay unit-tested.
10. Agent: Connections strip shows e-mail/SMS and AI; Go-live stepper ring.
