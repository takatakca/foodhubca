# Certification backlog (task 13)

Source: `docs/PLATFORM_API_RESEARCH.md` §6 (branch `api-research`). One commit per item, each with unit tests.
Every field below was re-checked on developer.doordash.com / developer.uber.com before it was coded.

## Status / next step (handoff note)
- **Status (2026-10-08 ~00:50 UTC): DONE, pushed.** 11 items coded (+ DoorDash fulfillment_type), SOW skipped (EPM), Uber prep time = TODO + question. Branch merged with main after PRs #8/#9/#10 (no conflicts). Checks: typecheck OK, lint 0 errors (1 old warning), 426/426 tests, clean webpack build OK, verify:foodhub 506 passed / 0 failed (ports 4999/5000).
- **Next step:** owner opens the PR https://github.com/takatakca/foodhubca/compare/main...certification-backlog?expand=1, merges, deploys; then the owner actions and the platform questions below.
- **Read first:** this file, then tests/certification-backlog.test.ts (one describe per item).

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
| 8 | Uber Eats | Item tax categories: `tax_label_info` from documented TaxLabels rows, brand default + per-item class | done | d822594 |
| 9 | Uber Eats | "Disconnect from Uber" (`DELETE pos_data`, merchant token) on Stores → Mapping | done | cf307cf |
| 10 | Uber Eats | Store prep-time call | TODO in `uber-eats.ts` (endpoint not public) + question below | (this commit) |
| 11 | Drive | `dropoff_address_components` (sample keys; `DOORDASH_DRIVE_ADDRESS_COMPONENTS=off` escape) | done | 42897b7 |
| 12 | Drive | Per-kitchen business / store ids (Business + Store APIs, "Register / update kitchens" button) | done | 5fdceb4 |
| 13 | Drive | Block restricted items (tobacco, cannabis/drugs, weapons, explosives) + alcohol re-checked with the alcohol rules | done | be6dd42 |

## Owner actions (portal, after merge)
- DoorDash Developer Portal → Webhook subscriptions → add **Item Polling**: URL `https://foodhub.on2go.ca/api/foodhub/webhooks/doordash/item-polling`, Authorization = the same value as `DOORDASH_WEBHOOK_SECRET` (if the event type is not offered, ask DoorDash support / the TAM to add it).
- Settings → Expansion → Delivery → DoorDash Drive → **Register / update kitchens** once the Drive keys are in (sandbox first).
- Menus → "DoorDash pickup %": set it (0 = in-store price) so DoorDash shows two prices (certification checks `price` and `base_price`), then Publish.

## Questions for the platforms
- DoorDash: the FAQ writes provider_type `doordash_pizza` as `DoorDashPizza/1.0` (not plain CamelCase). Confirm the exact User-Agent for our provider type; `DOORDASH_USER_AGENT` sets it without code.
- Uber: "Update Store Prep Time" is listed as required in the quality standards, but its endpoint is not in the public API reference. Please send the official path, body and scope. (Today the prep time reaches Uber per order as `pickup_time` on accept.)
- Uber: which `tax_label_info` labels should a Québec restaurant send for a hot main dish? The TaxLabels table has `CAT_PREPARED_FOOD` only with `TEMP_UNHEATED`. And where is the store tax area id set? It is not in the public V2 menu reference.
- DoorDash Drive: the API reference shows `dropoff_address_components` only for the US sample (street_address, sub_premise, city, state, zip_code, country). Which keys does the Canada object use? Food Hub sends the sample keys with Canadian values.
- DoorDash: Item Polling `start_time` / `end_time` (optional) meaning is not explained; Food Hub sends neither (timed 86s are still pushed in real time).

## Shared files touched (for easy merges)
Small, append-only changes; no task 2 file is edited (pipeline, inbox, webhook-utils, recovery, order-retry, health,
sync, go-live, uber-inbox, watch/*). `webhook-utils` is only imported.
- `lib/foodhub/types.ts`: optional `NormalizedOrder.orderSource` + `orderSourceLabel()`, `MasterMenu.pickupMarkupPct`,
  `MasterMenu.uberTaxClass`, `MenuItem.uberTaxClass`.
- `lib/foodhub/menu/translate.ts`: `base_price` in `toDoorDashMenu`, `tax_label_info` in `toUberMenu`, new `toDoorDashItemPolling`.
- `lib/foodhub/pos/clover-order.ts`: one line in `cloverOrderNote` ("Source: Caviar").
- `lib/foodhub/alcohol/rules.ts`: new `courierRestriction()` after `isAlcoholItem`.
- `lib/foodhub/delivery/doordash-drive.ts` (task 10 edits other delivery files, not this one).
- `app/api/foodhub/menu/route.ts` + `menu/import/route.ts`: schema + keep the new menu settings.
- UI: `components/live/order-card.tsx`, `order-drawer.tsx`, `app/ticket/[id]/page.tsx`, `app/(console)/menu/menu-editor.tsx`,
  `app/(console)/stores/mapping/mapping-view.tsx`, `app/(console)/settings/expansion/delivery/page.tsx`.
- New: `app/api/foodhub/webhooks/doordash/item-polling/[locationId]`, `app/api/foodhub/uber-connect/disconnect`,
  `app/api/foodhub/delivery/drive-stores`, `lib/foodhub/menu/uber-tax.ts`, `tests/certification-backlog.test.ts`.
- `.env.example`: `DOORDASH_USER_AGENT`, `DOORDASH_DRIVE_ADDRESS_COMPONENTS`, `DOORDASH_DRIVE_BUSINESS_ID` (all optional).
