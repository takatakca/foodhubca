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
| the request carries `Authorization` = `DOORDASH_SANDBOX_WEBHOOK_SECRET` (the Sandbox subscriptions' own value) | always a test, **whatever `DOORDASH_ENV` says** |
| `DOORDASH_ENV=sandbox` | every DoorDash Marketplace webhook is a test |
| the payload names a store listed in `DOORDASH_SANDBOX_STORE_IDS` (never a store mapped in Food Hub) | that store's webhooks are tests |
| while one of the three above is set: the payload's store `provider_type` ends with `_sandbox` | that webhook is a test |
| it is about a test order Food Hub already recorded (cancel, Dasher, adjustment…) | that webhook is a test, even after the settings changed |

The decision is taken **when the webhook arrives** and saved on its webhook-inbox entry. A DoorDash retry, the
recovery runner, or a **Replay** (Settings → Platforms → Webhook inbox) made after `DOORDASH_ENV` changed still
treats it as a test: it never reaches the kitchen. The ids of every test order are also kept in a permanent list
(never emptied by "Vider la liste des essais"), so a late DoorDash event about one stays a test. A test entry is
never cut off by DoorDash's 3-minute answer window (it is not cooked), so a late or resent test order never becomes an
inbox failure, an activity-feed line or a Watchtower alert.

A `DOORDASH_PROVIDER_TYPE` ending with `_sandbox` **alone does not turn the mode on**: the test screen only warns
about it. Set `DOORDASH_ENV=sandbox` while the credentials are sandbox ones.

A test order is **saved and shown as TEST** in the "Essais DoorDash (bac à sable)" list, and:

- it is **never** put in the orders table: never sent to Clover, never printed, never rings a kitchen screen, never
  raises a Watchtower alert, SMS or call, never counts in money or reports, never appears in the activity feed;
- its DoorDash side runs **exactly as for a real order**, with the same calls: confirm (PATCH order `success` with
  `prep_time`, automatic on arrival by default), reject (PATCH `fail` with DoorDash's failure reason and `errors[]`),
  ready (`order_ready_for_pickup`), merchant cancel (only with `DOORDASH_MERCHANT_CANCEL=true`), DoorDash cancellations,
  Dasher status, order release and adjustment;
- the **test store** gets the menu pull answer, item availability polling, order cart validation, menu pushes, item /
  option 86s and pause / reopen. It is answered from the brand and location chosen in the test screen and logged in the
  test log only; it is never written to the Stores table (Watchtower and the store sync never see it);
- a store mapped in Food Hub (a **real** store) is never a test store, even if its id is put in
  `DOORDASH_SANDBOX_STORE_IDS` by mistake: its orders stay real (Clover, kitchen) and the test screen refuses to change
  its menu, items or pause. The test screen shows a warning when that happens;
- while the credentials are sandbox ones (`DOORDASH_ENV=sandbox`), **no real store** is ever called: menu push, 86,
  pause and status reads for any store other than the listed test store(s) are refused ("Not sent: DoorDash is in
  sandbox mode"). A real store's status stays at its last known state (no false "deactivated" alert). A sandbox menu
  pull, item polling or cart validation about a real store is answered 409. DoorDash reports are not fetched with the
  sandbox key (a sandbox report never counts in money) unless the Reports integration has its own
  `DOORDASH_REPORTS_*` key;
- Po Poulet NDG (DoorDash store 27982486) is never touched: it can not be listed as a test store, and a sandbox webhook
  that names it is ignored.

**Webhook authentication is not weakened.** Every DoorDash webhook (orders, menu pull, item polling, cart validation)
must carry `Authorization` = `DOORDASH_WEBHOOK_SECRET` (production subscriptions) or `DOORDASH_SANDBOX_WEBHOOK_SECRET`
(Sandbox subscriptions, only when it is set and different from the production value); anything else gets 401.

**Without** `DOORDASH_ENV=sandbox`, `DOORDASH_SANDBOX_STORE_IDS` and `DOORDASH_SANDBOX_WEBHOOK_SECRET`, Food Hub
treats DoorDash orders as before (the only extra work is a lookup of the permanent test-order id list).

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
| `DOORDASH_SANDBOX_WEBHOOK_SECRET` | a new random value you generate (for example `openssl rand -hex 32`), **different** from `DOORDASH_WEBHOOK_SECRET` |

`DOORDASH_WEBHOOK_SECRET` already exists (Food Hub generated it). `LIVE_CONNECTORS_GLOBAL_ENABLED=true` must be on for
Food Hub to answer DoorDash. Save, then Deploy (owner only).

### 2. DoorDash Developer Portal: webhook subscriptions

Developer Portal (org FoodHub By Takatak) → **Webhook subscriptions** → **Configure required endpoints**, in the
**Sandbox** environment ("Requests sent in the Sandbox environment won't create orders"):

1. Endpoint URL: `https://foodhub.on2go.ca/api/foodhub/webhooks/doordash` (no trailing slash; for Menu Request DoorDash
   appends `/<location id>` itself).
2. Event types: Order Create, Order Cancellation, Menu Status, Menu Request, Dasher Status, Order Release, Order
   Adjustment, Store Temporarily Deactivated (any the portal offers).
3. Two more endpoints, if the portal (or DoorDash support) offers them:
   - **Item Polling** (Automatic Item Availability Polling): `https://foodhub.on2go.ca/api/foodhub/webhooks/doordash/item-polling`
     (DoorDash appends `/<location id>`);
   - **Order Cart Validation**: `https://foodhub.on2go.ca/api/foodhub/webhooks/doordash/orderCartValidation`.
4. Authorization header value, for **every Sandbox subscription**: the **sandbox** value. Food Hub → Réglages →
   **Plateformes et Clover** → DoorDash card → "Sandbox webhook Authorization header value" → **Afficher les secrets** →
   **Copier**, then paste it in the portal. Not in a chat. Do **not** use the production "Webhook Authorization header
   value" on a Sandbox subscription: the sandbox value is what marks every request as a test, even after step 6.

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

When DoorDash gives production credentials, in this order:

1. **First**, in the Developer Portal, **delete the Sandbox webhook subscription(s)** created in step 2 (Sandbox
   environment). Nothing should keep sending sandbox orders to Food Hub.
2. Create the **Production** subscriptions with the production value ("Webhook Authorization header value" =
   `DOORDASH_WEBHOOK_SECRET`).
3. Then in Coolify: replace the four DoorDash keys, set `DOORDASH_ENV=production` (or remove it), and Deploy.
   **Keep** `DOORDASH_SANDBOX_STORE_IDS` and `DOORDASH_SANDBOX_WEBHOOK_SECRET` set: the sandbox location id never
   matches a real store, and anything still signed with the sandbox value stays a test instead of reaching the kitchen.

Food Hub then treats DoorDash orders on the production subscriptions as real orders (Clover, kitchen, reports). Old
test entries in the webhook inbox stay tests even if replayed.

## If something looks wrong

- "Mode bac à sable inactif" while testing: none of `DOORDASH_ENV=sandbox`, `DOORDASH_SANDBOX_STORE_IDS` or
  `DOORDASH_SANDBOX_WEBHOOK_SECRET` is set, or the deployment did not restart.
- Warning "DOORDASH_PROVIDER_TYPE ends with _sandbox but DOORDASH_ENV is not sandbox": set `DOORDASH_ENV=sandbox`.
- Warning "… a real store mapped in Food Hub": the id in `DOORDASH_SANDBOX_STORE_IDS` is a real store's; give the
  sandbox location its own id.
- Sandbox webhooks answered 401: the Sandbox subscription's Authorization is not `DOORDASH_SANDBOX_WEBHOOK_SECRET`, or
  that value equals `DOORDASH_WEBHOOK_SECRET` (then it is ignored; the test screen warns).
- Menu push refused "Not sent: DoorDash is in sandbox mode": the store is not in `DOORDASH_SANDBOX_STORE_IDS`.
- Menu pull answered 404 "Choose the brand…": pick the brand in the test screen.
- A test order stays "received": auto-confirm is off, or the confirm call failed (its history says why).
