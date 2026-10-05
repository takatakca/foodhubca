# TAKATAK Food Hub — Final Product Readiness (1.4.0)

This is the production release of **TAKATAK Food Hub + Finance Control Tower** for Quadro Holdings LTEE.
It replaces the earlier "Accounting Control Tower" release candidates (RC2–RC9); their reports are kept
under [history/](history/) for provenance only.

## Locked architecture

- **TAKATAK Food Hub** is the control/matching layer. It talks **directly** to Uber Eats, DoorDash,
  SkipTheDishes (JET Connect), Too Good To Go and Clover — there is no aggregator (UrbanPiper is not used).
- **Clover** is the POS / kitchen / in-store sales source. An order is never accepted on a platform
  unless Clover received it.
- **TAKATAK Internal Ledger** is the main control ledger (drafted from payout statements, approved by the owner).
- **QuickBooks** is optional/later export only.
- **AI** is a supervisor only: it reads records and raises findings and fix tasks; it never posts,
  approves, deletes or resolves money issues.
- The dashboard never shows a platform action as done when it was not sent.

The rules every change must respect are in [LOCKED_DECISIONS.md](LOCKED_DECISIONS.md).

## Release gates (all enforced by CI on every push and pull request)

| Gate | Command | What it proves |
|---|---|---|
| Production dependency audit | `npm audit --omit=dev --audit-level=high` | no known high/critical vulnerability ships to production |
| Typecheck | `npm run typecheck` | the whole app compiles under TypeScript strict |
| Lint | `npm run lint` | React/Next rules (hooks, refs, static components) hold |
| Unit tests | `npm test` | 62 tests across orders, menus, reconciliation, RC9 features |
| Production build | `npm run build` | every page and API route builds |
| Release readiness | `npm run release:check` | required files present, env contract and connector readiness reported (never prints secrets) |
| Food Hub verification | `npm run verify:foodhub` | 275 end-to-end checks against simulated Uber Eats, DoorDash, Skip (JET Connect), Clover and Resend |

## Live-data rule

Nothing is sent to a platform until **all** of the following are true:

1. `supabase/INSTALL_ALL.sql` has been run (otherwise the app runs in demo memory mode and says so).
2. Keys were entered with `npm run setup` (or as hosting environment variables) — never in chat, never in Git.
3. `DASHBOARD_PASSWORD` and `SESSION_SECRET` are set (mandatory once live; the proxy refuses to serve a live dashboard without them).
4. `/go-live` shows every required step **Done**.
5. `LIVE_CONNECTORS_GLOBAL_ENABLED=true`.

Before that, orders are received and shown, but nothing is sent back to the platforms.

## Locked store status rules

- `(Z)` = active but closed · `(I)` = deactivated · grey circle = deactivated · normal = active
- Database fields: `activation_status` (`active` / `deactivated`) and `open_status` (`open` / `closed` / `unknown`)
- Required services per brand/location: DoorDash, Uber Eats, SkipTheDishes. Too Good To Go is an extra sales/payout source.

## Go-live order

The short path is [GO_LIVE_NOW.md](GO_LIVE_NOW.md); the complete guide is [FOODHUB.md](FOODHUB.md).

1. Database: run `supabase/INSTALL_ALL.sql` once.
2. `npm install && npm run setup`, then deploy with the same environment variables plus `FOODHUB_PUBLIC_URL`.
3. Channels & Setup → give each platform its webhook URLs and secrets.
4. Stores → connect Uber Eats stores; map DoorDash and Skip store ids.
5. Menu Manager → import from Clover → publish.
6. Users & Roles, Store Hours, Commission Plans.
7. `/go-live` all green → `LIVE_CONNECTORS_GLOBAL_ENABLED=true`.
8. Leave the Command Center open on a screen (status sync every 2 minutes) or schedule the cron endpoints.

## What "operational" means

The product is operational when it can, against real credentials:

- receive every platform order by signed webhook, create it in Clover and accept it automatically;
- hold (never accept blind) when Clover is down, with the platform's countdown visible;
- publish one master menu per brand to every platform, 86 items and pause stores everywhere in one click;
- sync store status and Clover in-store sales every 2 minutes and alert on anything that needs a person;
- reconcile every order against commission plans and payout statements, open dispute cases by itself,
  and draft balanced ledger entries for the owner to approve;
- keep a complete activity log of who did what and whether the platform accepted it.

External accounting posting/export stays blocked until a future owner-approved phase.
