# Uber API coverage (task 22)

_Branch `feature/uber-api-coverage` (main merged in after PR #12). Sources: developer.uber.com API reference
pages (Eats `*_suite` pages, Direct `api-reference/*`), read 2026-10-09. Public repository: no ids or secrets here._

## Status / next step (handoff note)
- **Status:** every Uber Eats Marketplace endpoint and webhook, and all of Uber Direct, is in the code with tests
  (`tests/uber-api-coverage.test.ts`, `tests/uber-api-full.test.ts`, mocked HTTP).
- **Coverage:** endpoints **61/61** (before: 21/61); webhooks **17/17** (before: 14, one only noted).
- **Next step:** owner merges this branch's pull request and deploys; Uber grants the scopes below (nothing works live before).
- **Read first:** `lib/foodhub/adapters/uber-api.ts`, `lib/foodhub/adapters/uber-eats.ts`, `lib/foodhub/delivery/uber-direct.ts`.

Status: **done** = coded + tested; **new** = added by this branch. Reads work as soon as the keys exist; every write
also needs the live switch (`LIVE_CONNECTORS_GLOBAL_ENABLED`). Menu-locked / "Do not touch" stores are never changed.

## Uber Eats Marketplace (base `https://api.uber.com`)

| Endpoint | What it does for the owner | Status | File / where | Scope / approval |
|---|---|---|---|---|
| `POST /oauth/v2/token` client_credentials | App token (30 days, cached) | done | `uber-eats.ts` fetchClientToken | NDA + licence |
| `GET /oauth/v2/authorize` + code exchange | "Connect Uber Eats" with the owner's login | done | `uber-provision.ts` | `eats.pos_provisioning` |
| **Integration Configuration suite** | | | | |
| `POST /v1/eats/stores/{id}/pos_data` | Link a store to Food Hub (order manager) | done | `activateUberStores` | `eats.pos_provisioning` |
| `PATCH /v1/eats/stores/{id}/pos_data` | Orders on / off for one store | done + **new** off | `setUberIntegrationEnabled`, Stores → Uber Eats | `eats.store` |
| `GET /v1/eats/stores/{id}/pos_data` | Who receives the orders (Food Hub or another app) | done | `fetchUberPosData` | `eats.store` |
| `DELETE /v1/eats/stores/{id}/pos_data` | "Disconnect from Uber" | done (PR #12) | `disconnectUberStore` | `eats.pos_provisioning` |
| **Store suite (current)** | | | | |
| `GET /v1/delivery/stores` | List stores (current suite) | **new** | `listUberStoresCurrent` | `eats.store` |
| `GET /v1/delivery/store/{id}` | Prep time, orderable, next open/close, price-change limits | **new** | `fetchUberStoreInfo`, Stores → Uber Eats | `eats.store` |
| `POST /v1/delivery/store/{id}` | Courier pickup instructions | **new** | `setUberPickupInstructions`, Stores → Uber Eats | `eats.store` |
| `GET /v1/delivery/store/{id}/status` | Store status (current suite) | **new** | `fetchUberStoreStatusCurrent` | `eats.store` |
| `POST /v1/delivery/store/{id}/update-store-status` | Pause / resume (current suite) | **new** | `setUberStoreStatusCurrent` | `eats.store.status.write` |
| `POST /v1/delivery/store/{id}/update-store-prep-time` | Prep time follows Settings / busy mode (certification item) | **new** | `pushPrepTimeToUber` from `/api/foodhub/prep` | `eats.store` |
| `POST /v1/delivery/store/{id}/update-fulfillment-configuration` | Own-courier stores: minimum delivery time | **new** | `setUberByocFulfillment` | `eats.byoc.fulfillment.config` |
| **Store API (previous version)** | | | | |
| `GET /v1/eats/stores`, `GET /v1/eats/stores/{id}` | Store list / details | done | `listUberStorePages`, `fetchUberStoreDetails` | `eats.store` |
| `GET /v1/eats/store/{id}/status` | Status on the Stores screen | done | `fetchUberStoreStatus` | `eats.store` |
| `POST /v1/eats/store/{id}/status` | Pause / resume from Food Hub | done | `setStoreOnline` | `eats.store.status.write` |
| `GET /v1/eats/stores/{id}/holiday-hours` | Holidays Uber has | **new** | `fetchUberHolidayDates` | `eats.store` |
| `POST /v1/eats/stores/{id}/holiday-hours` | Holidays sent with the menu | done | `publishMenu` | `eats.store` |
| **Menu suite** | | | | |
| `GET /v2/eats/stores/{id}/menus` | What Uber shows (items, sold out) | **new** | `fetchUberMenuSummary` | `eats.store` |
| `PUT /v2/eats/stores/{id}/menus` | Publish the menu | done | `publishMenu` | `eats.store` |
| `POST /v2/eats/stores/{id}/menus/items/{item}` | 86 / back in stock; price | done + **new** price | `setItemAvailability`, `setUberItemPrice` | `eats.store` |
| **Order Fulfillment suite (current)** | | | | |
| `GET /v1/delivery/order/{id}` | Full order (carts, deliveries, payment) | **new** | `fetchUberOrderCurrent`, `GET /api/foodhub/uber-orders/{id}` | `eats.store.orders.read` |
| `GET /v1/delivery/store/{id}/orders` | Order history, 60 days | **new** | `listUberOrders` | `eats.store.orders.read` |
| `POST /v1/delivery/order/{id}/accept` · `/deny` · `/cancel` | Same as below, current suite | **new** (`UBER_ORDER_API=current`) | adapter | `eats.order` |
| `POST /v1/delivery/order/{id}/ready` | Kitchen "Ready" tells Uber (better courier timing) | **new** | adapter `markReady` (`UBER_MARK_READY=off` stops it) | `eats.order` |
| `POST /v1/delivery/order/{id}/adjust-price` | "Change the price" (customer confirms, ≤ 50 $) | **new** | order drawer → `adjust_price` | `eats.order` |
| `POST /v1/delivery/order/{id}/update-ready-time` | "+5 min" moves Uber's ready time | **new** | adapter `updateReadyTime` | `eats.order` |
| `POST /v1/delivery/order/{id}/resolve-fulfillment-issues` | "Missing item": Uber asks the customer; retail remove/replace | **new** | `reportUberOutOfItems`, `resolveUberRetailIssues` | `eats.order` |
| `POST /v1/delivery/order/{id}/validate-item-fulfillment` | Retail barcode dry run | **new** | `validateUberItemFulfillment` | `eats.order` |
| `POST /v1/delivery/get-replacement-recommendations` | Retail replacement ideas | **new** | `getUberReplacementRecommendations` | `eats.order` |
| `POST /v1/delivery/order/{id}/update-delivery-partner-count` | 2–5 couriers for a big order (not offered in Canada yet) | **new** | `setUberCourierCount` | `delivery.multiple.courier` |
| `POST /v1/eats/byoc/restaurants/orders/event/location` | Own driver's live position on Uber's map | **new** | `sendUberByocCourierLocation` | BYOC (Uber setup) |
| **Order API (previous version)** | | | | |
| `GET /v2/eats/order/{id}` | Read each new order | done | `fetchUberOrder` | `eats.order` |
| `GET /v1/eats/stores/{id}/created-orders` | Missed-order check | done | `listUberCreatedOrders` | `eats.store.orders.read` |
| `GET /v1/eats/stores/{id}/canceled-orders` | Missed-cancellation check (nobody cooks a cancelled order) | **new** | `recoverMissedUberCancellations` (every sync) | `eats.store.orders.read` |
| `POST /v1/eats/orders/{id}/accept_pos_order` · `deny_pos_order` · `cancel` | Accept / reject / cancel | done | adapter | `eats.order` |
| `PATCH /v2/eats/orders/{id}/cart` | Grocery stores: remove / replace items | **new** | `patchUberGroceryCart` | `eats.order` |
| `POST /v1/eats/orders/{id}/restaurantdelivery/status` | Own driver: "on the way" / "delivered" for the customer | **new** | pipeline (Picked up / Completed) | `eats.store.orders.restaurantdelivery.status` |
| **Promotions suite** | | | | |
| `POST /v1/delivery/stores/{id}/promotion` | "X $ off from Y $" offer | **new** | Stores → Uber Eats | ask Uber (no scope named) |
| `GET /v1/delivery/stores/{id}/promotions`, `GET /v1/delivery/promotions/{id}` | List / read offers made by Food Hub | **new** | Stores → Uber Eats | same |
| `POST /v1/delivery/promotions/{id}/revoke` | Stop an offer | **new** | Stores → Uber Eats | same |
| **Reporting suite** | | | | |
| `POST /v1/eats/report` (9 report types) | Payment, finance, orders, errors, downtime, feedback reports | done + **new** 3 types + range rules | `requestUberReport` | `eats.report` |

Webhooks (one URL, `X-Uber-Signature`): `orders.notification`, `orders.scheduled.notification`, `orders.release`,
`orders.failure`, `orders.cancel`, `orders.customer_order_edit`, `delivery.state_changed`, `store.provisioned`,
`store.deprovisioned`, `store.status.changed` (`eats.store.status.notification`), `store.menu_refresh_request`,
`eats.report.success` — done; `orders.fulfillment_issues.resolved` — **new** (customer's answer flagged, cancel applied).

## Uber Direct (base `https://api.uber.com/v1`)

| Endpoint | What it does for the owner | Status | File / where | Scope / approval |
|---|---|---|---|---|
| `POST /customers/{cid}/delivery_quotes` | Price + ETA for a website / phone order | done (+ CPP fields) | `uberDirect.quote` | `eats.deliveries` |
| `POST /customers/{cid}/deliveries` | Book the courier (proof, leave at door, PIN, idempotency) | done + **new** options | `uberDeliveryBody`, Settings → Delivery | `eats.deliveries` |
| `GET /customers/{cid}/deliveries/{id}` | Track | done | `uberDirect.get` | `eats.deliveries` |
| `GET /customers/{cid}/deliveries` | All deliveries, by kitchen | **new** | `listUberDirectDeliveries`, `/api/foodhub/uber-direct` | `eats.deliveries` |
| `POST /customers/{cid}/deliveries/{id}` | Change courier note / tip / times | **new** | `updateUberDirectDelivery`, delivery action `courier_note` | `eats.deliveries` |
| `POST /customers/{cid}/deliveries/{id}/cancel` | Cancel the courier | done | `uberDirect.cancel` | `eats.deliveries` |
| `POST /customers/{cid}/deliveries/{id}/proof-of-delivery` | Photo / signature for a dispute | **new** | delivery action `proof` | `eats.deliveries` |
| `GET /direct/organizations/{cid}/stores` | Find Stores near a customer | **new** | `findUberDirectStores` | `direct.organizations` |
| Courier Pick & Pack (`pickup_action: pick_pack_pay`) | Courier shops the order (grocery) | **new** | Settings → Delivery switch | Uber agreement |
| `POST /direct/{cid}/submit_refund` | Ask Uber to refund a failed delivery | **new** | `/api/foodhub/uber-direct` `refund` | Uber agreement |
| `POST /direct/organizations` | Sub-organization per ON2GO merchant | **new** | `createUberDirectOrganization` | `direct.organizations` |
| `GET /direct/organizations/{id}` | Account / billing status | **new** | Stores → Uber Eats (Uber Direct card) | `direct.organizations` |
| `POST /direct/organizations/{id}/memberships/invite` | Invite a manager to the Direct dashboard | **new** | `/api/foodhub/uber-direct` `invite` | `direct.organizations` |
| `GET` / `PATCH /direct/organizations/{id}/business_locations[/{bl}]` | Uber Direct stores; set the kitchen code | **new** | `list/get/updateUberDirectBusinessLocation` | `direct.organizations` |

Direct webhooks (`x-uber-signature`): `event.delivery_status`, `event.courier_update` — done;
`event.refund_request` — **new** (money split in the activity log); `event.shopping_progress` — **new** (ETA / courier only).

## Other Uber API families (not restaurant operations — nothing coded)

Guest Rides, Vouchers (`organizations.voucher_programs`), Uber Drivers, Uber Pay, Uber for Business, Uber for
Suppliers. **Uber Ads** (campaigns, ad groups, restaurant ad reports; `ads.*` scopes, authorization_code + refresh
token) could feed the ads plan later: needs an Uber Ads partner account first.

## github.com/uber: 176 open-source repositories (code libraries, not restaurant APIs)

`*` = archived. Cadence, Ludwig and Pyro moved to their own organisations and are not in this list.
- **Maps and geo (10):** h3, h3-js, h3-py, h3-go, h3-java, h3-py-notebooks, geojson2h3, nebula.gl, xviz-data, openlr-go
- **Uber product SDKs and samples (9):** uber-direct-sdk, uber-direct-sdk-samples, ads-api-example, uber-pay-reference-app, uber-ios-sdk, rides-android-sdk, rides-java-sdk, rides-python-sdk, Python-Sample-Application
- **Web UI and data visualisation (9):** baseweb, base-design-docs, react-vis, react-vis-force, react-digraph, react-view, graph.gl*, manifold, react-global-hooks
- **Mobile apps (31):** RIBs, RIBs-iOS, AutoDispose, needle, motif, mockolo, ios-snapshot-test-case, UberSignature*, nanoscope, nanoscope-art, homebrew-nanoscope, RxDogTag, signals-ios, cyborg, swift-concurrency, swift-common, swift-abstract-class, SwiftCodeSan, uber-poet, startup-reason-reporter, simple-store, RxCentralBle, RxCBCentral, UBTokenBar*, android-template, stylist, artist, crumb, lint-checks, okbuck, tree-sitter-strings
- **Machine learning and forecasting (12):** causalml, orbit, petastorm, neuropod, fiber*, bayesmark, hypothesis-gufunc, ADR, Moirai-SOSP25-code, Moirai-SOSP25-logs, timesfm-fork, ussi
- **Big data, streaming, databases (17):** aresdb, uReplicator, uForwarder, uGroup, marmaray*, storagetapper, RemoteShuffleService, uberscriptquery, queryparser, athenadriver, dynamodb-cross-region-library, percona-server*, presto, lucene, gluten-fork, ray, uber-graph-benchmark
- **Servers, RPC, cloud, monitoring (50):** kraken, prototool*, tchannel*, tchannel-go, tchannel-node*, tchannel-java, tchannel-python*, tcap*, ringpop-go, ringpop-ui*, sevnup, zanzibar, peloton, clay, astro, arachne, pam-ussh, assume-role-cli, cadvisor, airlock, mutornadomon, grafana-dash-gen, dosa-idl, jaeger, jaeger-ui, hystrix-go, opentelemetry-go, opentelemetry-go-contrib, opentelemetry-java, grafana-tempo-fork, kubernetes, kubernetes-test-infra, kubernetes-enhancements, kubernetes-community, kubernetes-website, kubernetes-scheduler-plugins, go.uber.org, gqlgen, starlark-go, client-platform-engineering, puppet-homebrew, terraform-provider-googleworkspace-fork, concurrency-loadbalancer, go-vertex-ai, velociraptor, RedELK, phonenumbers, aristotle, pymegacli, denial-by-dns*
- **Developer tools, code quality, build (26):** NullAway, piranha, NEAL, hermetic_cc_toolchain, submitqueue, uberalls, tango, scip-lsp, vscode-bazel-bsp, vscode-go, tree-sitter-go, arcanist, libphutil, gonduit, sublime-phabricator, py-find-injection, py-look-for-timeouts, standard*, uber-ngen*, build-changelog*, uber-licence, kotlin, doubles, cassette, eight-track*, charlatan*
- **Small Node.js / Python libraries (9):** logtron, sentry-logger, uncaught-exception, bufrw, json-schema-filter, cache-dir*, typed-request-client*, multidimensional_urlencode, kafka-logger*
- **Other (3):** trucking-labor-analysis, uber-career-prep-playbook, .github

**Picks for Food Hub / ON2GO / QMAPS:**
1. **h3-js** (Apache-2.0): delivery zones as hexagons per kitchen and an order heatmap in reports; QMAPS can use the
   same cells. Proposed, not added: ~7.7 MB package, server-side only; first step = store the dropoff H3 cell (res 8)
   on own-delivery orders, then a "Zones" report.
2. **uber-direct-sdk** (beta, Apache-2.0): not needed — Food Hub already calls every Direct endpoint itself (same
   paths); useful only as a cross-check of field names.
3. **ads-api-example**: starting point if Uber Ads is opened (see above).
4. **baseweb / react-vis**: ideas only; Food Hub's own UI stays (no new dependency).
The rest is Uber's internal infrastructure (RPC, Kafka, Kubernetes forks, mobile build tools): nothing to plug in.

## Owner steps (Uber portals, nothing done by Food Hub)
- Uber Eats: ask Uber to whitelist the optional scopes in the table (`eats.store.orders.restaurantdelivery.status`,
  `delivery.multiple.courier`, `eats.byoc.fulfillment.config`) and to confirm the scope for the Promotions suite.
- Uber Direct: account at direct.uber.com → Developer → keys (`UBER_DIRECT_*`), webhook signing key, ask for
  `direct.organizations` (sub-organizations for ON2GO merchants); Refund API and Courier Pick & Pack need a sales agreement.
