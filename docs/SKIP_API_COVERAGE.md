# SkipTheDishes (Just Eat Takeaway "JET Connect") API coverage

_Source: Just Eat Takeaway's published OpenAPI specification, https://uk.api.just-eat.io/docs/openapi.yaml (the JET Connect part is also published alone at https://uk.api.just-eat.io/docs/jetconnect/openapi.yaml; both read on 2026-10-09). Owner order: **every** operation and webhook, used today or not (ON2GO Hub: restaurants, grocery and retail). The specification has **60 operations**; all 60 are coded (calls we make, webhooks we receive), checked before they are sent, and covered by mocked-HTTP tests. This repository is public: no ids, keys or contacts below._

**Before: 12 of the 60 operations (20%): Receive Order, sent-to-pos success / failed, menus, item availability, online / offline, the out-of-stock modification, and the cancel, driver, failed-order and temporarily-offline notifications. After: 60 of 60.**

## What Skip needs from the owner (not code)
1. Ask Skip (restaurant portal or account manager) for **JET Connect** for your own POS: the `X-Flyt-Api-Key` (`SKIP_JET_API_KEY`), your restaurants linked to your store ids, and the webhook addresses below. A restaurant live with another integrator must be released by Skip first (the onboarding API answers 409: switching is not supported yet).
2. For Skip couriers on your own orders (**Delivery as a Service**): ask for DaaS client credentials (`SKIP_DAAS_CLIENT_ID`, `SKIP_DAAS_CLIENT_SECRET`) and your collect-point ids; staging first.
3. For the delivery-pool / delivery-state calls (only if you run a courier fleet for Skip orders): the partner API key and the regional host JET gives (`SKIP_PARTNER_API_KEY`, `SKIP_PARTNER_API_BASE_URL`). The specification lists uk / i18n / aus hosts and none for Canada, so nothing is guessed.
4. Give Skip the webhook addresses (Settings → Platforms → Skip shows them with the public domain).

## Environment
| Variable | Used for |
|---|---|
| `SKIP_JET_API_KEY`, `SKIP_WEBHOOK_HMAC_SECRET`, `SKIP_WEBHOOK_API_KEY` | JET Connect calls and the signature / key of the notifications (existing) |
| `SKIP_ONBOARDING_HMAC_SECRET` | Signature of the onboarding notification (`X-Webhook-Signature`); without it the notification is refused |
| `SKIP_ONBOARDING_ORDER_URL` | Optional: the order address sent in the onboarding configuration (default: this hub's `/webhooks/skip/orders`) |
| `SKIP_DAAS_CLIENT_ID`, `SKIP_DAAS_CLIENT_SECRET`, `SKIP_DAAS_ENV` (`production` for real couriers), `SKIP_DAAS_WEBHOOK_SECRET`, `SKIP_DAAS_COLLECT_POINTS`, `SKIP_DAAS_CONTACT_EMAIL`, `SKIP_DAAS_DEFAULT_EMAIL` | Skip Delivery (see the header of `lib/foodhub/delivery/skip-daas.ts`) |
| `SKIP_PARTNER_API_KEY`, `SKIP_PARTNER_API_BASE_URL` | Delivery pools and delivery state |

Everything that changes something on Skip needs the keys **and** `LIVE_CONNECTORS_GLOBAL_ENABLED=true` (Skip Delivery staging runs without it). A call without them answers "blocked", never "done".

## Table: all 60 operations

### JET Connect (POS integration, `X-Flyt-Api-Key`) (23)

| # | Operation | Direction | Status | Code | Tests |
|---|---|---|---|---|---|
| 1 | `POST /final/{finalPickedOrder}` — Final Picked Order (`finalFinalPickedOrderPost`) | JET → us | new | `app/api/foodhub/webhooks/skip/final/route.ts`, `handleSkipFinalOrder` in `lib/foodhub/skip-ops.ts` | skip-api-coverage.test.ts |
| 2 | `POST /initial/{receiveOrder}` — Receive Order (`initialReceiveOrderPost`) | JET → us | done (fixed) | `app/api/foodhub/webhooks/skip/orders/route.ts`, `parseSkipOrder` in `lib/foodhub/adapters/skip.ts` | foodhub.test.ts, skip-api-coverage.test.ts |
| 3 | `POST /item-availability` — Update the availability of menu items (`ItemAvailability`) | us → JET | done | `setItemAvailability` in `lib/foodhub/adapters/skip.ts` | foodhub.test.ts, e2e |
| 4 | `POST /menus` — Ingest menu from POS (`menusPost`) | us → JET | done + new | `publishMenu` (restaurant menu from the master menu) in `lib/foodhub/adapters/skip.ts`; `publishSkipMenus` + `validateSkipMenusPayload` (whole menu model, grocery / retail) in `lib/foodhub/menu/skip-catalogue.ts`; `app/api/foodhub/skip/catalogue` | foodhub.test.ts, skip-api-coverage.test.ts |
| 5 | `POST /order/{id}/sent-to-pos-failed` — Update JET Connect with the unsuccessful result of an async order (`SentToPosFailed`) | us → JET | done (fixed) | `denyOrder`, `skipFailureBody` in `lib/foodhub/adapters/skip.ts` | skip-api-coverage.test.ts |
| 6 | `POST /order/{id}/sent-to-pos-success` — Update JET Connect with the successful result of an async order (`SentToPosSuccess`) | us → JET | done | `acceptOrder` in `lib/foodhub/adapters/skip.ts` | foodhub.test.ts, e2e |
| 7 | `POST /order-time-updated` — Order time updated (`orderTimeUpdatedPost`) | JET → us | new | `app/api/foodhub/webhooks/skip/order-time/route.ts`, `handleSkipOrderTime` | skip-api-coverage.test.ts |
| 8 | `GET /orders/{brandSlug}/{orderId}/amend` — Get amendment (`ordersBrandSlugOrderIdAmendGet`) | us → JET | new (obsolete in the spec) | `getSkipAmendmentLegacy` in `lib/foodhub/adapters/skip-api.ts` | skip-api-coverage.test.ts |
| 9 | `POST /orders/{brandSlug}/{orderId}/amend` — Amend order (`ordersBrandSlugOrderIdAmendPost`) | us → JET | new (obsolete in the spec) | `amendSkipOrderLegacy` in `lib/foodhub/adapters/skip-api.ts` | skip-api-coverage.test.ts |
| 10 | `GET /orders/{orderId}/modification` — Get modified order state (`ordersOrderIdModificationGet`) | us → JET | new | `getSkipModificationState` in `lib/foodhub/adapters/skip-api.ts` | skip-api-coverage.test.ts |
| 11 | `POST /orders/{orderId}/modification` — Indicate out of stock and substituted items in an order (`ordersOrderIdModificationPost`) | us → JET | done + new | `reportSkipMissingItems` in `lib/foodhub/adapters/skip.ts`; `modifySkipOrder` (removed, substituted, weighed items) in `lib/foodhub/adapters/skip-api.ts`; `app/api/foodhub/skip/modification` | skip-api-coverage.test.ts |
| 12 | `POST /orders/{orderId}/validation` — Validate an order modification request (`ordersOrderIdValidationPost`) | us → JET | new | `validateSkipModification` in `lib/foodhub/adapters/skip-api.ts` | skip-api-coverage.test.ts |
| 13 | `POST /partners/locations/{locationReference}/go-live` — Activate the restaurant (go live) (`partnersLocationsLocationReferenceGoLivePost`) | us → JET | new | `goLiveSkipLocation` in `lib/foodhub/adapters/skip-api.ts`; `goLiveSkipOnboarding` | skip-api-coverage.test.ts |
| 14 | `PUT /partners/onboarding/{sessionId}/configuration` — Submit onboarding configuration (`partnersOnboardingSessionIdConfigurationPut`) | us → JET | new | `submitSkipOnboardingConfiguration` in `lib/foodhub/adapters/skip-api.ts`; `configureSkipOnboarding` | skip-api-coverage.test.ts |
| 15 | `POST /partners/{market}/locations/onboard` — Start onboarding a location (`partnersMarketLocationsOnboardPost`) | us → JET | new | `onboardSkipLocation` in `lib/foodhub/adapters/skip-api.ts`; `startSkipOnboarding` in `lib/foodhub/skip-ops.ts`; `app/api/foodhub/skip/onboarding` | skip-api-coverage.test.ts |
| 16 | `PUT /restaurants/{restaurantReference}/offline` — Set a restaurant offline (`PutRestaurantOffline`) | us → JET | done | `setStoreOnline` in `lib/foodhub/adapters/skip.ts` | e2e |
| 17 | `PUT /restaurants/{restaurantReference}/online` — Set a restaurant online (`PutRestaurantOnline`) | us → JET | done | `setStoreOnline` in `lib/foodhub/adapters/skip.ts` | e2e |
| 18 | `PUT /restaurants/{restaurantReference}/servicetimes` — Updates restaurant's opening times (`PutServiceTimes`) | us → JET | new | `toSkipServiceTimes`, `setSkipServiceTimes` in `lib/foodhub/adapters/skip-api.ts`; `pushSkipServiceTimes` in `lib/foodhub/skip-ops.ts`; `app/api/foodhub/skip/service-times` | skip-api-coverage.test.ts |
| 19 | `POST /your-cancel-order-notification-endpoint` — Cancel Order Notification (`CancelOrderNotification`) | JET → us | done (fixed) | `app/api/foodhub/webhooks/skip/cancel/route.ts` (answers with the same payload) | e2e |
| 20 | `POST /your-driver-status-notification-endpoint` — Driver Status Notification (`DriverStatusNotification`) | JET → us | done | `app/api/foodhub/webhooks/skip/driver/route.ts` | e2e |
| 21 | `POST /your-failed-order-for-backup-flow-endpoint` — Failed Order For Backup Flow (`FailedOrderForBackupFlow`) | JET → us | done (fixed) | `app/api/foodhub/webhooks/skip/failed/route.ts`, `parseSkipFailedOrder` | e2e |
| 22 | `POST /your-onboarding-notification-endpoint` — Receive onboarding status notification (`yourOnboardingNotificationEndpointPost`) | JET → us | new | `app/api/foodhub/webhooks/skip/onboarding/route.ts`, `verifySkipOnboardingSignature`, `recordSkipOnboarding` | skip-api-coverage.test.ts |
| 23 | `POST /your-restaurant-temp-offline-endpoint` — Restaurant Temporarily Offline Notification (`RestaurantTempOfflineStatusChanged`) | JET → us | done (fixed) | `app/api/foodhub/webhooks/skip/offline/route.ts` | e2e |

### Delivery supplier (delivery pools and order delivery state, `JE-API-KEY`) (24)

| # | Operation | Direction | Status | Code | Tests |
|---|---|---|---|---|---|
| 24 | `GET /delivery/pools` — Get your delivery pools (`deliveryPoolsGet`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 25 | `POST /delivery/pools` — Create a new delivery pool (`deliveryPoolsPost`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 26 | `GET /delivery/pools/{deliveryPoolId}/availability/relative` — Get availability for pickup (`deliveryPoolsDeliveryPoolIdAvailabilityRelativeGet`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 27 | `PUT /delivery/pools/{deliveryPoolId}/availability/relative` — Set availability for pickup (`deliveryPoolsDeliveryPoolIdAvailabilityRelativePut`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 28 | `POST /delivery/pools/{deliveryPoolId}/change-risk` — Update delivery pool risk signal (`deliveryPoolsDeliveryPoolIdChangeRiskPost`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 29 | `GET /delivery/pools/{deliveryPoolId}` — Get an individual delivery pool (`deliveryPoolsDeliveryPoolIdGet`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 30 | `PATCH /delivery/pools/{deliveryPoolId}` — Modify a delivery pool (`deliveryPoolsDeliveryPoolIdPatch`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 31 | `PUT /delivery/pools/{deliveryPoolId}` — Replace an existing delivery pool (`deliveryPoolsDeliveryPoolIdPut`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 32 | `PUT /delivery/pools/{deliveryPoolId}/hours` — Set the delivery pools daily start and end times (`deliveryPoolsDeliveryPoolIdHoursPut`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 33 | `DELETE /delivery/pools/{deliveryPoolId}/offline-events` — Delete offline events (`deliveryPoolsDeliveryPoolIdOfflineEventsDelete`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 34 | `POST /delivery/pools/{deliveryPoolId}/offline-events` — Take delivery pool offline (`deliveryPoolsDeliveryPoolIdOfflineEventsPost`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 35 | `DELETE /delivery/pools/{deliveryPoolId}/restaurants` — Remove restaurants from a delivery pool (`deliveryPoolsDeliveryPoolIdRestaurantsDelete`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 36 | `PUT /delivery/pools/{deliveryPoolId}/restaurants` — Add restaurants to an existing delivery pool (`deliveryPoolsDeliveryPoolIdRestaurantsPut`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 37 | `GET /delivery/pools/{deliveryPoolId}/status` — Get status of delivery pool (`deliveryPoolsDeliveryPoolIdStatusGet`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 38 | `PUT /orders/deliverystate/driverlocation` — Update current driver locations (bulk upload) (`ordersDeliverystateDriverlocationPut`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 39 | `PUT /orders/{orderId}/deliverystate/atdeliveryaddress` — Update order with driver at delivery address details (`ordersOrderIdDeliverystateAtdeliveryaddressPut`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 40 | `PUT /orders/{orderId}/deliverystate/atrestaurant` — Update order with driver at restaurant details (`ordersOrderIdDeliverystateAtrestaurantPut`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 41 | `PUT /orders/{orderId}/deliverystate/atrestauranteta` — Update the driver's estimated time to arrive at the Restaurant (`ordersOrderIdDeliverystateAtrestaurantetaPut`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 42 | `PUT /orders/{orderId}/deliverystate/delivered` — Update order with delivered details (`ordersOrderIdDeliverystateDeliveredPut`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 43 | `PUT /orders/{orderId}/deliverystate/driverassigned` — Update order with driver assigned details (`ordersOrderIdDeliverystateDriverassignedPut`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 44 | `PUT /orders/{orderId}/deliverystate/driverlocation` — Update the driver's current location (`ordersOrderIdDeliverystateDriverlocationPut`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 45 | `PUT /orders/{orderId}/deliverystate/driverunassigned` — Update order with driver unassigned details (`ordersOrderIdDeliverystateDriverunassignedPut`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 46 | `PUT /orders/{orderId}/deliverystate/onitsway` — Update order with driver on its way details (`ordersOrderIdDeliverystateOnitswayPut`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |
| 47 | `PUT /restaurants/driver/eta` — Set ETA for pickup (`restaurantsDriverEtaPut`) | us → JET | new | `jetPools` / `jetDelivery` / `jetLogisticsCall` in `lib/foodhub/adapters/jet-logistics.ts`; `app/api/foodhub/skip/logistics` | skip-logistics-daas.test.ts |

### Delivery as a Service (Skip couriers, JWT) (13)

| # | Operation | Direction | Status | Code | Tests |
|---|---|---|---|---|---|
| 48 | `POST /auth/realms/daas/protocol/openid-connect/token` — Generate JSON Web Token (`authRealmsDaasProtocolOpenidConnectTokenPost`) | us → Skip | new | `skipDaasToken` in `lib/foodhub/delivery/skip-daas.ts` | skip-logistics-daas.test.ts |
| 49 | `PUT /v1/delivery/cancellation-request` — Cancel a Delivery (`v1DeliveryCancellationRequestPut`) | us → Skip | new | `skipDaas.cancel` | skip-logistics-daas.test.ts |
| 50 | `GET /v1/delivery/collect-points` — Get Collect Points (`v1DeliveryCollectPointsGet`) | us → Skip | new | `listSkipCollectPoints`, `resolveCollectPoint` in `lib/foodhub/delivery/skip-daas.ts` | skip-logistics-daas.test.ts |
| 51 | `POST /v1/delivery/estimate` — Estimate delivery (`v1DeliveryEstimatePost`) | us → Skip | new | `skipDaas.quote`, `skipDaasEstimate` in `lib/foodhub/delivery/skip-daas.ts` | skip-logistics-daas.test.ts |
| 52 | `DELETE /v1/delivery/notification-config` — Delete Notification config (`v1DeliveryNotificationConfigDelete`) | us → Skip | new | `skipDaasNotificationConfig.delete` | skip-logistics-daas.test.ts |
| 53 | `GET /v1/delivery/notification-config` — Get Notification config (`v1DeliveryNotificationConfigGet`) | us → Skip | new | `skipDaasNotificationConfig.get` | skip-logistics-daas.test.ts |
| 54 | `PATCH /v1/delivery/notification-config` — Update Notification config (`v1DeliveryNotificationConfigPatch`) | us → Skip | new | `skipDaasNotificationConfig.patch` | skip-logistics-daas.test.ts |
| 55 | `POST /v1/delivery/notification-config` — Create Notification config (`v1DeliveryNotificationConfigPost`) | us → Skip | new | `skipDaasNotificationConfig.create`, `registerSkipDaasWebhook` | skip-logistics-daas.test.ts |
| 56 | `POST /v1/delivery` — Create a Delivery (`v1DeliveryPost`) | us → Skip | new | `skipDaas.create` in `lib/foodhub/delivery/skip-daas.ts` (the third courier fleet next to DoorDash Drive and Uber Direct) | skip-logistics-daas.test.ts |
| 57 | `POST /v1/delivery/request-assistance` — Create Assistance Request (`v1DeliveryRequestAssistancePost`) | us → Skip | new (CA market) | `skipDaasRequestAssistance`; `app/api/foodhub/skip/daas` | skip-logistics-daas.test.ts |
| 58 | `POST /v1/delivery/simulate` — Simulate delivery (`v1DeliverySimulatePost`) | us → Skip | new (staging only) | `skipDaasSimulate`; `app/api/foodhub/skip/daas` | skip-logistics-daas.test.ts |
| 59 | `GET /v1/delivery/status/{requestId}` — Get Delivery Status (`v1DeliveryStatusRequestIdGet`) | us → Skip | new | `skipDaas.get` | skip-logistics-daas.test.ts |
| 60 | `POST /your-notification-endpoint` — Notify Partner (`yourNotificationEndpointPost`) | Skip → us | new | `app/api/foodhub/webhooks/skip-daas/route.ts`, `parseSkipDaasWebhook` (9 event types), `skipDaas.verifyWebhook` | skip-logistics-daas.test.ts |

## Corrections to code that already existed (found by reading the specification)
- **`sent-to-pos-failed`** needs `{ errorCode, errorMessage }` (`happenedAt`, `transmissionId` optional). Food Hub sent only the transmission id: a refusal could fail with 400. Now the reason is mapped to JET's codes (`MENU_ERROR`, `STORE_CLOSED`, `INACTIVE`, `IN_USE`, `TIMEOUT`, `UNKNOWN`).
- **Receive Order**: the order's `total` is only "the pre-adjustment subtotal of the items"; what the customer paid is `payment.final.inc_tax`, and the delivery fee, driver tip and discount are in `payment.adjustments[]`. Food Hub stored the subtotal as the total and left fees and tip at zero; it now reads them (payout checks depend on it). `deliver_at` (restaurant-delivered orders), the customer's substitution choice and the picked weight are read too. The 202 answer carries `{ OrderId }` as documented.
- **Cancel, failed-order and temporarily-offline notifications**: JET wants 200 and the **same payload** back as the acknowledgement (a non-2xx is retried up to 5 times). They answered with an empty body or `{ ok: true }`.
- Every call now sends the optional `x-jet-application` header.

## Webhook addresses to give Skip (public domain from `FOODHUB_PUBLIC_URL`)
`/api/foodhub/webhooks/skip/orders` (Receive Order) · `…/skip/final` (Final Picked Order, only if the brand manager enables it) · `…/skip/cancel` · `…/skip/driver` · `…/skip/failed` · `…/skip/offline` · `…/skip/modification` · `…/skip/order-time` · `…/skip/onboarding` · menu callback `…/skip/menu-status` (automatic) · Skip Delivery: `/api/foodhub/webhooks/skip-daas` (registered by the console with one click).

## Console / API endpoints added (all need a signed-in user; none is public)
| Address | Who | Does |
|---|---|---|
| `POST app/api/foodhub/skip/modification` | orders:act (manager PIN to send) | validate / send / read the state of an out-of-stock, substitution or weight change |
| `GET`, `POST app/api/foodhub/skip/service-times` | menu:edit | preview / send the Food Hub opening hours as JET service times, store by store |
| `GET`, `POST app/api/foodhub/skip/onboarding` | stores:map | start, configure, go live; sessions and next step |
| `POST app/api/foodhub/skip/catalogue` | menu:edit | check (dry run) and send a catalogue already in JET's shape |
| `GET`, `POST app/api/foodhub/skip/daas` | admin | collect points, register the delivery webhook, notification configuration, assistance, simulation |
| `GET`, `POST app/api/foodhub/skip/logistics` | admin | the 24 delivery-pool / delivery-state operations, with a dry run |

## Not Skip's: the "Just Eat API"
The same host publishes a second document, https://uk.api.just-eat.io/docs/openapi.json ("Just Eat API", 98 operations: consumers, checkout, restaurant claims, order acceptance, restaurant events…), served from uk / i18n / aus hosts for the Just Eat markets (UK, IE, DK, ES, IT, NO, AU, NZ). It is a different product from JET Connect and from the Skip operations above, so it is **not** coded; the delivery-pool and order-delivery operations it shares with the 60 above are covered.
