# Certification backlog (task 13)

Source: `docs/PLATFORM_API_RESEARCH.md` §6 (branch `api-research`). One commit per item, each with unit tests.
Every field below was re-checked on developer.doordash.com / developer.uber.com before it was coded.

## Status / next step (handoff note)
- **Status (2026-10-08):** branch created from `main` (89ed540). Nothing coded yet.
- **Next step:** item 1, DoorDash `User-Agent` header in `headers()` of `lib/foodhub/adapters/doordash.ts`.
- **Read first:** this file, `lib/foodhub/adapters/doordash.ts`, `tests/platform-fixes.test.ts` (test style).

## Items

| # | Platform | Item | Status | Commit |
|---|---|---|---|---|
| 1 | DoorDash | `User-Agent: <ProviderType>/1.0` | todo | |
| 2 | DoorDash | Failure codes + item-level `errors[]` on reject | todo | |
| 3 | DoorDash | Order source (`experience`: DoorDash / Caviar / Storefront) | todo | |
| 4 | DoorDash | `merchant_tip_amount` | todo | |
| 5 | DoorDash | Separate pickup prices (dual pricing) | todo | |
| 6 | DoorDash | Item-availability polling (if documented) | todo | |
| 7 | DoorDash | Store Onboarding Webhook (SOW) | skip unless trivial (EPM) | |
| 8 | Uber Eats | Item tax categories | todo | |
| 9 | Uber Eats | "Disconnect from Uber" (`DELETE pos_data`) | todo | |
| 10 | Uber Eats | Store prep-time call | TODO + question for Uber | |
| 11 | Drive | `dropoff_address_components` | todo | |
| 12 | Drive | Per-kitchen business / store ids | todo | |
| 13 | Drive | Block restricted items | todo | |

## Questions for the platforms
(filled in as items are done)

## Shared files touched (for easy merges)
(filled in as items are done)
