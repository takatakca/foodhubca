# Certification backlog (task 13)

Source: `docs/PLATFORM_API_RESEARCH.md` §6 (branch `api-research`). One commit per item, each with unit tests.
Every field below was re-checked on developer.doordash.com / developer.uber.com before it was coded.

## Status / next step (handoff note)
- **Status (2026-10-08 ~00:15 UTC):** DoorDash items 1-6 done and pushed; SOW (7) skipped. Tests: tests/certification-backlog.test.ts.
- **Next step:** item 9, Uber "Disconnect from Uber" (DELETE pos_data) in `lib/foodhub/adapters/uber-provision.ts`; then 8 (tax categories) and 10 (prep-time TODO + question).
- **Read first:** this file, `lib/foodhub/adapters/uber-provision.ts`, `lib/foodhub/adapters/uber-eats.ts`.

## Items

| # | Platform | Item | Status | Commit |
|---|---|---|---|---|
| 1 | DoorDash | `User-Agent: <ProviderType>/1.0` | done | b42d776 |
| 2 | DoorDash | Failure codes + item-level `errors[]` on reject | done | 63b7ede |
| 3 | DoorDash | Order source (`experience`: DoorDash / Caviar / Storefront) | done (card, drawer, ticket, Clover note) | f277ead |
| 4 | DoorDash | `merchant_tip_amount` (+ `fulfillment_type`) | done | 6434f6a, fa71c75 |
| 5 | DoorDash | Separate pickup prices (dual pricing): `base_price` on items + options; menu setting "DoorDash pickup %" | done | b6f7c35 |
| 6 | DoorDash | Automatic Item Availability Polling: DoorDash calls `GET /api/foodhub/webhooks/doordash/item-polling/{location_id}` | done | 5cb280e |
| 7 | DoorDash | Store Onboarding Webhook (SOW) | skipped: not trivial (sender + status webhook + screen); not needed if DoorDash assigns an EPM | |
| 8 | Uber Eats | Item tax categories | todo | |
| 9 | Uber Eats | "Disconnect from Uber" (`DELETE pos_data`) | todo | |
| 10 | Uber Eats | Store prep-time call | TODO + question for Uber | |
| 11 | Drive | `dropoff_address_components` | todo | |
| 12 | Drive | Per-kitchen business / store ids | todo | |
| 13 | Drive | Block restricted items | todo | |

## Owner actions (portal, after merge)
- DoorDash Developer Portal → Webhook subscriptions → add **Item Polling**: URL `https://foodhub.on2go.ca/api/foodhub/webhooks/doordash/item-polling`, Authorization = the same value as `DOORDASH_WEBHOOK_SECRET` (if the event type is not offered, ask DoorDash support / the TAM to add it).
- Menus → "DoorDash pickup %": set it (0 = in-store price) so DoorDash shows two prices (certification checks `price` and `base_price`), then Publish.

## Questions for the platforms
- DoorDash: the FAQ writes provider_type `doordash_pizza` as `DoorDashPizza/1.0` (not plain CamelCase). Confirm the exact User-Agent for our provider type; `DOORDASH_USER_AGENT` sets it without code.
- DoorDash: Item Polling `start_time` / `end_time` (optional) meaning is not explained; Food Hub sends neither (timed 86s are still pushed in real time).

## Shared files touched (for easy merges)
- `lib/foodhub/types.ts`: new optional `NormalizedOrder.orderSource` + `orderSourceLabel()` (append-only).
- `lib/foodhub/pos/clover-order.ts`: one line in `cloverOrderNote` ("Source: Caviar").
- `components/live/order-card.tsx`, `order-drawer.tsx`, `app/ticket/[id]/page.tsx`: one badge / line each.
- No task 2 file touched (pipeline, inbox, webhook-utils, recovery, order-retry, health, sync, go-live, uber-inbox, watch/*).
