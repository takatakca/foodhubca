# Certification backlog (task 13)

Source: `docs/PLATFORM_API_RESEARCH.md` §6 (branch `api-research`). One commit per item, each with unit tests.
Every field below was re-checked on developer.doordash.com / developer.uber.com before it was coded.

## Status / next step (handoff note)
- **Status (2026-10-08 ~00:05 UTC):** DoorDash items 1-4 done and pushed (+ fulfillment_type). Tests in tests/certification-backlog.test.ts.
- **Next step:** item 5, DoorDash dual pricing: `base_price` (pickup) next to `price` (delivery) on items and options in `toDoorDashMenu` (lib/foodhub/menu/translate.ts); pickup markup setting per platform in the menu editor + /api/foodhub/menu schema.
- **Read first:** this file, `lib/foodhub/menu/translate.ts` (toDoorDashMenu, priceFor), `app/api/foodhub/menu/route.ts`.

## Items

| # | Platform | Item | Status | Commit |
|---|---|---|---|---|
| 1 | DoorDash | `User-Agent: <ProviderType>/1.0` | done | b42d776 |
| 2 | DoorDash | Failure codes + item-level `errors[]` on reject | done | 63b7ede |
| 3 | DoorDash | Order source (`experience`: DoorDash / Caviar / Storefront) | done (card, drawer, ticket, Clover note) | f277ead |
| 4 | DoorDash | `merchant_tip_amount` (+ `fulfillment_type`) | done | 6434f6a, fa71c75 |
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
- `lib/foodhub/types.ts`: new optional `NormalizedOrder.orderSource` + `orderSourceLabel()` (append-only).
- `lib/foodhub/pos/clover-order.ts`: one line in `cloverOrderNote` ("Source: Caviar").
- `components/live/order-card.tsx`, `order-drawer.tsx`, `app/ticket/[id]/page.tsx`: one badge / line each.
- No task 2 file touched (pipeline, inbox, webhook-utils, recovery, order-retry, health, sync, go-live, uber-inbox, watch/*).
