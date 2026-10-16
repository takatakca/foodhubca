# DoorDash sandbox on production Food Hub (sandbox-safe mode)

DoorDash opened Marketplace for the org **FoodHub By Takatak** in **SANDBOX** only (integration display name
"ON2GO Hub"). This page connects DoorDash's sandbox webhooks to the production Food Hub (`https://foodhub.on2go.ca`)
**without any effect on real operations**, then runs DoorDash's certification test orders.

Code: `lib/foodhub/doordash/sandbox.ts` (detection, test list), `lib/foodhub/doordash/sandbox-ops.ts` (DoorDash calls),
`lib/foodhub/webhooks/doordash-sandbox.ts` (webhooks), screen: Settings → Plateformes et Clover → **Essais DoorDash
(bac à sable)**. Tests: `tests/doordash-sandbox.test.ts`.

## What sandbox-safe mode guarantees

A DoorDash webhook is a **sandbox test** when any one of these is true:

| Signal | Effect |
|---|---|
| `DOORDASH_ENV=sandbox` | every DoorDash Marketplace webhook is a test |
| `DOORDASH_PROVIDER_TYPE` ends with `_sandbox` (DoorDash's naming for sandbox provider types) | same |
| the payload names a store listed in `DOORDASH_SANDBOX_STORE_IDS` | that store's webhooks are tests |
| the payload's store `provider_type` ends with `_sandbox` | that webhook is a test |
| it is about a test order Food Hub already holds (cancel, Dasher, adjustment…) | that webhook is a test |

A test order is **saved and shown as TEST** in the "Essais DoorDash (bac à sable)" list, and:

- it is **never** put in the orders table: never sent to Clover, never printed, never rings a kitchen screen, never
  raises a Watchtower alert, SMS or call, never counts in money or reports, never appears in the activity feed;
- its DoorDash side runs **exactly as for a real order**, with the same calls: confirm (PATCH order `success` with
  `prep_time`, automatic on arrival by default), reject (PATCH `fail` with DoorDash's failure reason and `errors[]`),
  ready (`order_ready_for_pickup`), merchant cancel (only with `DOORDASH_MERCHANT_CANCEL=true`), DoorDash cancellations,
  Dasher status, order release and adjustment;
- the **test store** gets the menu pull answer, menu pushes, item / option 86s and pause / reopen. It is answered from
  the brand and location chosen in the test screen; it is never written to the Stores table (Watchtower and the store
  sync never see it);
- while the credentials are sandbox ones (`DOORDASH_ENV=sandbox` or a `_sandbox` provider type), **no real store** is
  ever called: menu push, 86, pause and status reads for any store other than the listed test store(s) are refused
  ("Not sent: DoorDash is in sandbox mode"). A real store's status stays at its last known state (no false
  "deactivated" alert);
- Po Poulet NDG (DoorDash store 27982486) is never touched: it can not be listed as a test store, and a sandbox webhook
  that names it is ignored.

**Webhook authentication is unchanged.** Every DoorDash webhook (orders, menu pull, cart validation) must carry
`Authorization` = the value of `DOORDASH_WEBHOOK_SECRET`; sandbox mode is decided only after that check.

**Without** `DOORDASH_ENV`, a `_sandbox` provider type and `DOORDASH_SANDBOX_STORE_IDS`, Food Hub behaves exactly as
before.

## Owner steps

Never paste a secret, key or signing secret in a chat. Copy them only between the DoorDash portal, Coolify and Food Hub.

### 1. Coolify: environment variables (names only here)

In Coolify → Food Hub → Environment Variables, add or fill:

| Name | Value comes from |
|---|---|
| `DOORDASH_DEVELOPER_ID` | DoorDash Developer Portal → the sandbox credential |
| `DOORDASH_KEY_ID` | same credential |
| `DOORDASH_SIGNING_SECRET` | same credential (shown once by DoorDash) |
| `DOORDASH_PROVIDER_TYPE` | the sandbox provider type DoorDash shows (it ends with `_sandbox`) |
| `DOORDASH_ENV` | `sandbox` |
| `DOORDASH_SANDBOX_STORE_IDS` | the location id of the sandbox store you add in step 3 (fill it after step 3) |

`DOORDASH_WEBHOOK_SECRET` already exists (Food Hub generated it). `LIVE_CONNECTORS_GLOBAL_ENABLED=true` must be on for
Food Hub to answer DoorDash. Save, then Deploy (owner only).

### 2. DoorDash Developer Portal: webhook subscriptions

Developer Portal (org FoodHub By Takatak) → **Webhook subscriptions** → **Configure required endpoints**, in the
**Sandbox** environment ("Requests sent in the Sandbox environment won't create orders"):

1. Endpoint URL: `https://foodhub.on2go.ca/api/foodhub/webhooks/doordash` (no trailing slash; for Menu Request DoorDash
   appends `/<location id>` itself).
2. Event types: Order Create, Order Cancellation, Menu Status, Menu Request, Dasher Status, Order Release, Order
   Adjustment, Store Temporarily Deactivated (any the portal offers).
3. Authorization header value: Food Hub → Réglages → **Plateformes et Clover** → DoorDash card → "Webhook Authorization
   header value" → **Afficher les secrets** → **Copier**, then paste it in the portal. Not in a chat.

### 3. DoorDash Developer Portal: a sandbox location

Developer Portal → **Stores** → **Add a sandbox location**. Give it a location id (for example `takatak-sandbox-1`);
that id is the store's `merchant_supplied_id`. Put the same id in `DOORDASH_SANDBOX_STORE_IDS` in Coolify, then Deploy.

### 4. Food Hub: choose the test store's menu

Réglages → Plateformes et Clover → **Essais DoorDash (bac à sable)**:

- check the badge **Mode bac à sable ACTIF** and the test store id;
- choose the **brand** and the **location** whose menu, prices, hours and 86s the test store gets;
- leave **Confirmer automatiquement à l'arrivée** on (as auto-accept does for a real order), or switch it off to test
  Confirm / Reject by hand;
- click **Envoyer le menu au magasin d'essai** (menu push), and watch the Menu Status line in the test log.

### 5. Run DoorDash's certification test orders

From the Developer Portal sandbox tools, send the test orders DoorDash asks for. Each one appears in the test list with
the TEST badge and its history (received, confirmed, Dasher, cancelled…). Use the buttons for the steps DoorDash checks:
Confirmer, Refuser (rupture), Prête, Annuler, Rupture / Remettre an item id, pause / reopen the test store. Nothing
reaches Clover, the kitchen or the reports.

### 6. After certification (production keys)

When DoorDash gives production credentials: replace the four DoorDash keys in Coolify, set `DOORDASH_ENV=production`
(or remove it), and remove `DOORDASH_SANDBOX_STORE_IDS`, then Deploy. Food Hub then treats DoorDash orders as real
orders again (Clover, kitchen, reports). The test screen disappears once the mode is off and the test list is empty
("Vider la liste des essais").

## If something looks wrong

- "Mode bac à sable inactif" while testing: `DOORDASH_ENV` is not `sandbox` and the provider type does not end with
  `_sandbox`, or the deployment did not restart.
- Menu push refused "Not sent: DoorDash is in sandbox mode": the store is not in `DOORDASH_SANDBOX_STORE_IDS`.
- Menu pull answered 404 "Choose the brand…": pick the brand in the test screen.
- A test order stays "received": auto-confirm is off, or the confirm call failed (its history says why).
