# Too Good To Go (TGTG) API coverage

_Researched 2026-10-09 from official sources only. Owner order: every official endpoint and webhook, used today or not (ON2GO Hub: restaurants, grocery and retail). This repository is public: no ids, keys, contacts or case numbers below._

## The answer in one line
**Too Good To Go publishes no public API for stores or partners** (no store, bag, reservation or webhook API; its developer sub-domain answers 401 behind a company sign-in). Its **one official order feed to a point of sale is Deliverect** (one-way: Surprise Bag orders go to the POS; editing or cancelling stays in TGTG MyStore; Canada is a supported region). So Food Hub implements **Deliverect's published POS, Store, KDS and Retail APIs completely** (they are the documented surface of the TGTG integration) and keeps a tolerant feed reader for any partner or automation that forwards TGTG notifications. Bag quantities, prices and pickup windows are set in TGTG MyStore / the Store app; nothing in Food Hub pretends otherwise.

**Before: TGTG orders only through a best-guess webhook and the relay (accept / ready "skipped"), no Deliverect, no cancel, pickup, no-show or bag-count reading. After: all 29 outbound Deliverect operations, all 19 Deliverect webhooks (the order events counted as three), every TGTG feed event kind, end-of-day bag counts.**

## Sources checked
| Source | What it says |
|---|---|
| TGTG developer portal (developers sub-domain) | Sign-in only (HTTP 401): no public documentation |
| TGTG "business solution" pages, MyStore | Bags are listed and sized in MyStore / the Store app |
| Deliverect "Too Good To Go integration" page | One-way link to the POS, orders handled like delivery orders, order ids shown for pickup, **no editing or cancelling from the POS**, regions include Canada |
| TGTG press releases (grocery platform) | Grocery partners can export donation records (CSV) or connect an ERP "through an API": no public specification, so nothing can be coded; ask the TGTG partner team (owner click below) |
| Community clients (consumer-app reverse engineering) | **Not official, not used**: they target the shopper app and can be blocked |
| Deliverect developer portal (https://developers.deliverect.com, llms.txt indexes of the restaurants and retail documentation) | Complete, versioned, public reference: the tables below |

## Deliverect outbound operations (Food Hub → Deliverect): 29 of 29 coded
Base URLs are never guessed: `DELIVERECT_BASE_URL` (staging `https://api.staging.deliverect.com`, production `https://api.deliverect.com`) and, for retail, `DELIVERECT_RETAIL_BASE_URL` (`https://api.staging.deliverect.io` / `https://api.deliverect.io`). Token: `POST /oauth/token` with client credentials, cached until it expires. Code: `lib/foodhub/adapters/deliverect-api.ts` (`DELIVERECT_OPS`, `deliverectCall`, `deliverect.*`); console: `POST /api/foodhub/deliverect`. Tests: `tests/tgtg-deliverect.test.ts`.

| API | Operation | Method and path | Used by Food Hub for |
|---|---|---|---|
| POS | `pos.orderStatus` | `POST /orderStatus/{orderId}` | ACCEPTED 20 when the kitchen accepts, PICKUP_READY 70 when ready, FINALIZED 90 when picked up, CANCELED 110 after a channel cancel (the pipeline sends them) |
| POS | `pos.preparationTime` | `POST /updatePreparationTime` | prep time change (channels that support it) |
| POS | `pos.updateBill` | `POST /updateBill/{locationId}` | open bill details |
| POS | `pos.health` | `PUT /locations/{locationId}/readiness/pos` | POS health heartbeat (every 10 min per location) |
| POS | `pos.validationResponse` | `POST /orderValidation/{validationId}` | async answer to order validation |
| POS | `pos.insertProducts` | `POST /productAndCategories` | products and categories from the master menu (`previewSync`, `forceUpdate`) |
| Store | `store.accounts`, `store.brands` | `GET /accounts`, `GET /accounts/{accountId}/brands` | find the account and brands |
| Store | `store.locations`, `store.channelLinks` | `GET /locations`, `GET /channelLinks` | map locations and channel links |
| Store | `store.channels` | `GET /allChannels` | find the Too Good To Go channel id (`DELIVERECT_TGTG_CHANNEL_IDS`) |
| Store | `store.allergens` | `GET /allAllergens` | allergen and tag ids |
| Store | `store.products`, `store.snoozed` | `GET /products`, `GET /channelDisabledProducts` | read POS products and snoozed products |
| Store | `store.snoozeByPlu`, `store.snoozeByTag` | `POST /products/snoozeByPlus`, `POST /products/snoozeByTags` | out of stock / back in stock |
| Store | `store.syncProducts` | `POST /v2/locations/{locationId}/syncProducts` | ask Deliverect to start a product sync |
| Store | `store.openingHoursSet`, `…Account`, `…Location` | `POST /locations/openingHours`, `GET /account/{accountId}/openingHours`, `GET /location/{locationId}/openingHours` | opening hours |
| Store | `store.holidaysSet`, `store.holidaysLocation` | `POST /locations/holidays`, `GET /location/{locationId}/holidays` | holiday closures per location |
| Store | `store.holidaysChannelSet`, `store.holidaysChannel` | `POST /locations/channels/holidays`, `GET /locations/channels/{locationId}/holidays` | holiday closures per channel link |
| Store | `store.busyMode` | `POST /updateStoreStatus/{locationId}` | pause / resume online orders |
| Store | `store.orders` | `GET /my-orders` | read Deliverect's orders |
| KDS | `kds.orderStatus` | `POST /kds/orderStatus/{orderId}` | KDS statuses 50 / 60 / 70 / 80 |
| Retail | `retail.itemsUploadUrl`, `retail.inventoryUploadUrl` | `POST /catalog/accounts/{accountId}/itemsUploadUrl`, `POST /catalog/accounts/{accountId}/inventoryUploadUrl` | grocery / retail item and inventory CSV (signed URL, then `PUT` to Google storage: `deliverectUploadCsv`) |

## Deliverect webhooks (Deliverect → Food Hub): 19 of 19 coded
One catch-all route: `app/api/foodhub/webhooks/deliverect/[...kind]/route.ts`, logic in `lib/foodhub/deliverect-ops.ts` and `lib/foodhub/adapters/deliverect.ts`. Signed with `x-server-authorization-hmac-sha256` (hex HMAC-SHA256 of the raw body, empty for GET) using `DELIVERECT_HMAC_SECRET`; before certification (staging) Deliverect signs with the channel link / location id; the URLs Food Hub returns at registration also carry `?token=DELIVERECT_WEBHOOK_SECRET`.

| Webhook | Address (`…/webhooks/deliverect/`) | What Food Hub does |
|---|---|---|
| Register POS | `register` | remembers the location, returns every URL below (empty string for what is not supported) |
| Order notification | `orders` | a **Too Good To Go** order enters the normal pipeline (Clover ticket, kitchen, alerts, payout checks); another channel's order is kept, not taken (it is connected directly) |
| Order cancel (`status` 100 on the same address) | `orders` | cancels the order (stops its Clover ticket) and confirms CANCELED 110 on the original `_id`; a cancel that beats the order is held for it |
| Sync Products (GET) | `sync-products` | answers 204, then pushes the brand's master menu with Insert Products |
| Product Update Callback (async) | `product-sync-callback` | keeps the report, logs inserted / updated / removed / errors |
| Sync Tables, Sync Floors (GET) | `sync-tables`, `sync-floors` | one "delivery" table, no floors |
| Tax Calculation | `tax-calculation` | taxes from `DELIVERECT_TAX_RATES` (tax-exclusive regions) or the channel's own |
| Order Validation | `validate-order` | every cart line must still be on sale in the master menu; unavailable → `product_snoozed` |
| Store Status | `store-status` | store opened / closed on a channel, kept on the store, logged |
| Reporting: new order, order status, courier update | `reporting` | order status and courier events are attached to the order |
| KDS: Register, Order Notification, Order Status Update, Product Update | `kds/register`, `kds/orders`, `kds/order-status`, `kds/product-update` | registration URLs, orders like the POS ones, statuses and product counts kept |
| Retail channel: Picking status, Picking amendments, Picking substitutes (GET) | `retail/events`, `retail/amendments`, `retail/substitutes/{channelOrderId}/{plu}` | kept and logged (a rejected picking raises an alert); no substitute offered |

## The feed reader (any partner, the relay, an automation forwarding TGTG alerts)
TGTG publishes no notification format, so `lib/foodhub/tgtg-feed.ts` reads the **meaning** (English and French words, any field layout) and keeps everything it cannot place. Address: `POST /api/foodhub/webhooks/tgtg` (token) or the Order Relay; one notification or a list.

| TGTG notification | Food Hub order |
|---|---|
| reservation created | an order for the kitchen (normal pipeline) |
| cancelled (customer or store) | order cancelled (a late "collected" never reopens it) |
| collected / picked up | **pickup confirmed**: order completed |
| no-show / expired | completed and flagged (the bag stays paid) |
| day summary (bags offered / sold / collected) | the bag log (Money → TGTG) |

**End of day:** `GET /api/foodhub/cron/tgtg-bags` (Bearer `CRON_SECRET`; `vercel.json` schedules it daily at 06:30 UTC, on Coolify add a daily scheduled call after closing) counts the feed orders per location (reserved, collected, no-show, cancelled, revenue, average price) and writes yesterday and today into the bag log, so sales, analytics and payout checks have the day without anyone typing it. E-mail: TGTG's alerts are push notifications inside the Store app and no e-mail format is published, and this repository has no inbound-e-mail path, so an e-mail parser would be a guess; forward the alerts to the feed address instead.

## Deliverect families that are not Too Good To Go endpoints (listed, not coded)
Ordering Experience (Channel API, ~215 pages: building an ordering channel), Payments, Loyalty, CRM, Coupons, Gift Cards, Upsells, Dispatch (courier networks) and Reporting subscriptions. They belong to Deliverect's own products, not to TGTG; the Reporting webhooks that carry TGTG order events are covered above. Index: https://developers.deliverect.com/v3.0-ordering-experience/llms.txt.

## What the owner has to click (not code)
1. **Deliverect**: ask Deliverect to enable the Too Good To Go channel for the location and to issue **POS partner credentials** (client id and secret, staging first, then production after certification). Give them the Register URL: `https://<your-domain>/api/foodhub/webhooks/deliverect/register?token=<DELIVERECT_WEBHOOK_SECRET>`.
2. In Food Hub: set `DELIVERECT_CLIENT_ID`, `DELIVERECT_CLIENT_SECRET`, `DELIVERECT_BASE_URL`, `DELIVERECT_WEBHOOK_SECRET` (and `DELIVERECT_HMAC_SECRET` once production), then (signed in as owner) `POST /api/foodhub/deliverect` with `{ "action": "channels" }` lists Deliverect's channels and flags Too Good To Go: put its id in `DELIVERECT_TGTG_CHANNEL_IDS`. Map the store in Stores → Mapping as `dlv:<location id>` (Deliverect tells you the id when it registers the location; it is logged in the activity feed).
3. **TGTG partner team** (through MyStore → Help): ask whether a direct order feed exists for your account, and about the grocery / retail platform's API (not public).

## Environment
`DELIVERECT_CLIENT_ID`, `DELIVERECT_CLIENT_SECRET`, `DELIVERECT_BASE_URL`, `DELIVERECT_RETAIL_BASE_URL`, `DELIVERECT_RETAIL_VERSION`, `DELIVERECT_WEBHOOK_SECRET`, `DELIVERECT_HMAC_SECRET`, `DELIVERECT_TGTG_CHANNEL_IDS`, `DELIVERECT_TGTG_CHANNEL_LINKS`, `DELIVERECT_TAX_RATES` (JSON, for example `[{"name":"TPS","rate":5},{"name":"TVQ","rate":9.975}]`). Existing: `TGTG_WEBHOOK_SECRET`, `FOODHUB_RELAY_*`. Production calls also need `LIVE_CONNECTORS_GLOBAL_ENABLED=true`; a Deliverect staging base URL runs without it.

## Rules kept
- Too Good To Go cannot be cancelled from a POS: reject / cancel answer "blocked" with the reason; a cancel made in MyStore arrives as a notification.
- A Deliverect order is acknowledged with 200 before any status is sent; nothing is sent while the keys, the base URL or the live switch are missing (the kitchen is never blocked: "skipped").
- A Too Good To Go platform linked through Clover (`FOODHUB_VIA_CLOVER=tgtg`) never takes its orders from Deliverect twice.
