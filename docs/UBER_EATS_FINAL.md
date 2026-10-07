# Uber Eats: the final integration

_Status on 2026-10-07 · branch `uber-eats-final` · checked against Uber's official docs (developer.uber.com/docs/eats)._

## In one minute

- **The code is ready.** Food Hub connects your Uber stores, publishes the shared menu (+20%) to all of them, and takes every Uber order straight into Clover. It accepts the order on Uber only after Clover has it.
- **Uber has not granted production access yet.** Until it does, nothing can reach your real stores.
- **UrbanPiper still holds the stores.** Its offboarding case 00131025 is disconnecting all of them. Food Hub shows each store's state ("still UrbanPiper", "moving", "Food Hub ✓") so you can see when orders really move.
- **What you do**, in order:
  1. Paste the signing key.
  2. Wait for production access.
  3. Connect the stores.
  4. Publish the menu.
  5. Send one test order per kitchen.
  6. Then retire the tablets.

  The steps are below.

---

## 1. Your steps, exactly

### Step 1: Paste the webhook signing key (5 minutes, today)
1. Food Hub → **Settings → Platforms & Clover → Uber Eats** → **Show secrets** → copy `UBER_WEBHOOK_SIGNING_KEY`.
2. Uber developer dashboard → app **FOOD HUB** → **Webhooks → Primary Webhook**:
   - URL: `https://31-220-96-134.sslip.io/api/foodhub/webhooks/uber-eats`
   - Authentication: **Basic HMAC**
   - Signing Key: the value you copied
   - **Save**
3. If Uber's form shows its own key instead of taking yours, put Uber's key in `UBER_WEBHOOK_SIGNING_KEY` with `npm run setup` on the server. **Never paste it in chat or in git.** Food Hub accepts the signing key, a second key during a rotation (`UBER_WEBHOOK_SIGNING_KEY_2`), or the app's client secret (Uber's docs describe signing with the client secret).

### Step 2: Server settings (once, with `npm run setup` on the server)
- `UBER_CLIENT_ID` = `R9NdqpzGaqi220WzyPlBY_t7UCnvw1Dq`. This identifier is public.
- `UBER_CLIENT_SECRET`: from the dashboard. It is secret.
- Leave these empty:
  - `UBER_ENV`: production app.
  - `UBER_ACCESS_TOKEN`: a fixed token expires after 30 days and is never renewed.
  - `UBER_TAX_RATE_PCT`: see section 4.
- `LIVE_CONNECTORS_GLOBAL_ENABLED=true` only when Settings → Go-live is green. Until then, every change on Uber shows as "blocked" (honestly) and nothing is sent.
- Redirect URI and privacy URL are already set on Uber's side:
  - `https://31-220-96-134.sslip.io/api/foodhub/uber-connect/callback`
  - `/legal/privacy`

### Step 3: Wait for Uber production access
- Ask Uber for these scopes:

  | Scope | What it is for |
  |---|---|
  | `eats.pos_provisioning` | Connecting stores |
  | `eats.store` | Menus, 86s, holidays, store details |
  | `eats.order` | Reading, accepting, rejecting and cancelling orders |
  | `eats.store.status.write` | Pause / resume |
  | `eats.store.orders.read` | The missed-order safety net |
  | `eats.store.status.notification` | Store-status webhooks |
  | `eats.report` | Payment reports for reconciliation |

- Follow up by email at **merchants@uber.com**, case **#ef4fe**. Uber's chat agent said multi-store POS integration requests go there.
- Uber's go-live guide also mentions an *integration verification* with Uber's integration tech support. It is a joint end-to-end test, and a pilot store must run 3 days at ≥98% order-injection success. If Uber asks for it, start with one store (Step 6 is exactly that test).

### Step 4: Connect the stores (about 15 minutes, once access is granted)
1. Food Hub → **Stores → Connect Uber Eats**, then sign in with the **Uber Eats Manager owner account**.
2. Food Hub lists every store on that account (17), with brand, location and Clover register pre-filled:
   - The 9 stores at **6280 Av. Somerled** → **NDG MAIN**.
   - The 8 stores at **5839 Rue Jean-Talon E** → **SAINT-LÉONARD**. Food Hub's record says 5837; both numbers are now recognised.
   - **Pizza Algerie** is not a Food Hub brand. Add it in Brands & Locations, or leave it unticked.
   - The **Orders go to** column shows who takes each store's orders today. Expect "other integration (UrbanPiper)" until UrbanPiper lets go.
3. Check each row → **Activate & link**. Each store gets one line saying what happened:
   - **Food Hub now receives this store's orders**: done.
   - **Moving to Food Hub (pending)**: Uber is switching it. Keep the tablet on.
   - **Another integration (UrbanPiper) still receives the orders**: wait for UrbanPiper's offboarding (case 00131025), then press **Check with Uber**.
4. **Check with Uber** (Stores → Connected stores) can be pressed any time. It changes nothing on Uber. If it shows order webhooks still off, **Switch Uber orders on** fixes it.

### Step 5: Publish the menu (10 minutes)
1. **Menus** → the brand whose menu is shared → **Prices by platform**: Uber Eats **+20%** → **Save**. Your current Uber prices are exactly Clover × 1.20. Food Hub reproduces all 175 of them to the cent (checked on your real menu, section 3).
2. **All Uber stores** opens the **dry run**. Nothing is sent yet. Per store you see:
   - items, option groups and options;
   - the +20% with a sample price;
   - hours and holidays;
   - whether Uber has confirmed the store;
   - what blocks it;
   - **JSON**: the exact menu Uber will receive.
3. Turn **Do not touch** on for any store whose menu must stay as it is (for example a store still on UrbanPiper, or Gâteaux Montréal NDG if its cheesecakes must stay at $11.90). Food Hub never sends that store a menu, holiday hours or an 86. Orders and pause still work.
4. **Publish to N Uber stores**. Each line then says **received by Uber**, **refused** (with Uber's reason), **not sent** or **left untouched**.

### Step 6: One test order per kitchen, then retire the tablets
1. Place a small real order on one NDG store and one Saint-Léonard store. It should:
   - arrive in Food Hub (pop-up and kitchen screen);
   - print from Clover;
   - show **accepted** on Uber.
2. Keep each Uber tablet on for one more day as a backup.
3. When a store shows **Food Hub ✓** and its test order went through, the tablet is no longer needed for orders. Log it out in Uber Eats Manager, and ask Uber if you want to return it.

---

## 2. What Food Hub does now (built and tested)

| Area | What happens |
|---|---|
| **Connecting stores** | Sign in with Uber, then Food Hub lists all your stores (every page) with brand, location and Clover suggestions. For each confirmed store: `POST pos_data` (integrator ids, Food Hub as order manager, no manual acceptance, courier webhooks on), then `PATCH pos_data integration_enabled=true` (switches the order webhooks on), then `GET pos_data` (who really receives the orders). When Uber later confirms the store (`store.provisioned`) and the order webhooks are still off, Food Hub switches them on. There is no fake "connected": a store still on UrbanPiper says so. |
| **Menu** | One master menu (shared by all brands) goes to each store under its own brand name, hours and holidays. It carries every option group with its min/max/required rules, Uber price = Clover × (1 + markup), French and English in one text ("Poulet grillé / Grilled chicken"), photos, calories and an empty `tax_info`. It is checked before sending: duplicate ids, missing items or groups, min > max, a required group with too few options, prices, titles, photo links. |
| **Publish to all Uber stores** | Dry run first (what each store gets, what blocks it, JSON), then one click. **Do not touch** stores are never sent, whatever the path: manual, scheduled, "every brand", or Uber's own menu-refresh request. |
| **Orders** | Uber webhook → saved in the inbox **before** the 200 → full order read from Uber → Clover order + kitchen ticket → **accept on Uber only after Clover has it**, with `pickup_time` from the prep time. If Clover fails, the order is never accepted: it waits on the Command Center with Uber's 11.5-minute countdown. |
| **Never losing an order** | 1. Every signed webhook is saved in the shared webhook inbox (with DoorDash's; the entry id is Uber's `event_id`, so a re-delivered event is not processed twice). If processing fails (Uber slow, server restart), the inbox retries it by itself after 30 s and 2 min; after that it raises an alert and waits for **Replay** under Settings → Platforms → Webhook inbox. Processed entries are kept 14 days. 2. The sync also asks Uber for orders still waiting for an accept (`created-orders`) and processes any that no webhook brought. This only runs for stores Uber confirmed as Food Hub's, so UrbanPiper's orders are never put in Clover twice. |
| **Idempotency** | The same Uber event delivered twice is ignored. The same order never creates a second Clover order. Statuses only move forward. |
| **Cancellations** | `orders.cancel` / `orders.failure` → cancelled in Food Hub, removed from the Clover register. A cancel that arrives before the order, or an order already cancelled when Food Hub reads it, is never cooked, sent to Clover or accepted. Staff can cancel an accepted Uber order with Uber's reasons. |
| **Customer changes the order** | `orders.customer_order_edit` (new at Uber in July 2026): the new items are read and shown on the order with a warning. Food Hub never edits a Clover ticket by itself. |
| **Courier** | `delivery.state_changed` (order id in `meta.order_id`, as documented) → assigned / at the store / picked up / delivered. A failed delivery is flagged. |
| **Store status** | Pause / resume (`POST /v1/eats/store/{id}/status`), live status read every sync, `store.status.changed` webhook, holiday hours sent with the menu (removed dates are cleared). |
| **86** | One 86 reaches every Uber store using that menu (items and options; timed 86s turn back on). Never sent to a Do-not-touch store. |
| **Reports** | Uber payment report through the Reporting API → payout reconciliation (unchanged). |
| **Tokens** | One app token is kept 30 days in the database. Uber allows 100 token requests per hour and drops the oldest token past 100. A new secret gets a new token. |
| **Sandbox** | `UBER_ENV=sandbox` switches to Uber's test hosts (`sandbox-login.uber.com`, `test-api.uber.com`) for a Testing app. |

---

## 3. Checked against Uber's docs, and on your real menu

### The "still to confirm with Uber" list (MASTER_PLAN section 3)

| Open item | Answer from Uber's docs | What changed |
|---|---|---|
| Two languages in menu titles (`en_ca` + `fr_ca`) | **No.** The menu reference says to give only one translation, and that it is shown to everyone ([PUT menu](https://developer.uber.com/docs/eats/references/api/v2/put-eats-stores-storeid-menu)). The GET menu page says extra translations are not supported. | French and English now go in **one** text, French first ("Poulet grillé / Grilled chicken"), under one key (`fr_ca`, or `en_ca` for an English-only setting). Before, Uber would have shown only one of the two. |
| `tax_info` for Québec | `tax_info` is a required item field. Both of its parts (`tax_rate` added on top of the price, `vat_rate_percentage` included in it) are optional. Uber says it computes taxes, and its FAQ says to set rates per store with Uber. | Food Hub sends `tax_info: {}` and lets Uber apply the store's GST/QST setup. If Uber's integration team asks for an item rate, set `UBER_TAX_RATE_PCT` (for example 14.975). It is then sent on first-level items only. **Ask Uber** (section 4). |
| Calories (`energy_interval`) | `calories.lower_range` / `upper_range` are marked deprecated. Use `energy_interval {lower, upper}` in E5 (780 cal = 78000000). | Done. |
| `webhooks_config` at activation | It is part of `POST pos_data`. `webhooks_version` decides which order API the webhooks point to: unset → `GET /v2/eats/order`, which Food Hub reads; `"1.0.0"` → the newer `/v1/delivery/order`. Courier webhooks need `delivery_status_webhooks`. Order webhooks are switched on with `PATCH pos_data integration_enabled` ([integration config](https://developer.uber.com/docs/eats/references/api/integration_activation_suite), [going live](https://developer.uber.com/docs/eats/guides/going-live)). | The activation now sends `webhooks_config` (courier on, version unset), then the PATCH, then reads back the order manager. |
| Keeping the Uber token in the database | Tokens last 30 days. 100 token requests per hour; past 100 the oldest token stops working. Uber advises caching tokens ([authentication](https://developer.uber.com/docs/eats/guides/authentication)). | The token is kept in the database as well as in memory. |
| "Store already provisioned to another integrator" | No such error is documented. When Food Hub becomes order manager, the previous order-manager app is demoted, sometimes after a delay. `GET pos_data` names the app that receives the orders (`order_manager_client_id`). | Food Hub reads it before and after activation and says "still UrbanPiper" plainly. If Uber does refuse the activation, the message says the other integration (e.g. UrbanPiper) must disconnect the store, or Uber can move it (merchants@uber.com). |
| Webhook events | `orders.notification`, `orders.cancel` (stores without version 1.0.0), `orders.failure` and `orders.scheduled.notification` (version 1.0.0 only), `orders.release`, `orders.fulfillment_issues.resolved`, `orders.customer_order_edit`, `delivery.state_changed`, `store.provisioned`, `store.deprovisioned`, `store.status.changed`, `store.menu_refresh_request`, `eats.report.success` ([webhooks guide](https://developer.uber.com/docs/eats/guides/webhooks)). | Every one is handled or noted. Courier events now use `meta.order_id`; before, they were never matched to an order. Unknown events are kept, never dropped. |
| Signature | `X-Uber-Signature` = lowercase hex HMAC-SHA256 of the raw body. Uber expects a 200 with an empty body, and retries on 5xx or a timeout. | Unchanged (it was right). If the inbox cannot be saved, Food Hub answers 503 so Uber retries. |
| Endpoints | Every call Food Hub makes matches the docs: accept / deny / cancel, `GET /v2/eats/order`, menus, item suspension, store status, holiday hours, reports, `created-orders`. Uber now labels them **"Previous Version"**: a newer Order / Store suite exists (`/v1/delivery/...`). No retirement date is published. | Kept on the documented previous version (fully supported). Moving to the new suite is listed in section 4. |

### Your real master menu (local check, `private/menu`, nothing committed)

| | |
|---|---|
| Items / categories | 175 / 17 |
| Option groups / options | 218 (166 required) / 857 |
| Uber menu built | 1,032 Uber items (175 + 857 options), 218 groups, 309 KB |
| Uber checks | **0 problems** |
| Food Hub menu checks | **0 errors** |
| Prices | With +20%, **all 175** Uber prices match today's Uber prices to the cent |

---

## 4. What Uber must still grant, confirm or decide

1. **Production access** with the scopes in Step 3. This blocks everything.
2. **UrbanPiper letting go** of each store (case 00131025). Until then, a store's orders keep going to UrbanPiper even if Food Hub activated it. "Check with Uber" shows the moment it changes.
3. **Questions to send Uber** (merchants@uber.com, case #ef4fe):
   - *Tax:* should items carry a `tax_rate` for our Québec stores, or does Uber apply each store's GST/QST setup? (Food Hub sends none today.)
   - *Courier webhooks:* does `delivery.state_changed` arrive with `webhooks_version` unset? (The docs show it only with the newer API.)
   - *API version:* is the previous-version Order API (`/v2/eats/order` + `accept_pos_order`) fine for a new integration, or must we move to `/v1/delivery/order` (`webhooks_version "1.0.0"`)?
   - *Prep time:* the quality standards list "update store prep time", which exists only in the newer Store API. Is it required for our certification? (Food Hub sends the ready time on each order as `pickup_time` today.)
   - *Verification:* do they want the joint integration verification and a 3-day pilot store before switching all 17?
4. **Store-status webhooks** need the `eats.store.status.notification` scope. Without it, status still updates on every sync (every 2–5 minutes).

## 5. Known limits
- **One menu text per name on Uber.** It reads "French / English" (Uber shows one text to every customer).
- **A customer's order edit** is shown and flagged, but the Clover ticket is not changed automatically.
- **No "order ready" call** in Uber's previous-version API: the courier is dispatched from the `pickup_time` sent at acceptance. A "+5 min" in the kitchen does not reach Uber.
- **The missed-order check** runs only for stores Uber confirmed as Food Hub's, and only while live mode is on.
- **The menu (about 309 KB) is sent uncompressed.** Uber recommends gzip for very large menus; this size is well within normal.

## 6. Technical map

| File | Role |
|---|---|
| `lib/foodhub/adapters/uber-eats.ts` | Hosts, tokens (memory + DB), accept / deny / cancel, menu, 86, status, holiday hours, `pos_data` read / enable, `created-orders`, reports |
| `lib/foodhub/adapters/uber-provision.ts` | Connect flow: authorize, code exchange, store list, suggestions, `POST pos_data` body, activation messages |
| `lib/foodhub/adapters/uber-inbox.ts` | Uber front of the shared webhook inbox (`lib/foodhub/inbox.ts`, `fh_docs` collection `webhook_inbox`, kind `uber`): save before 200, `event_id` duplicates; retries, Replay and retention are the inbox's |
| `lib/foodhub/adapters/uber-events.ts` | Every webhook event; `runUberWebhook` (outcome + alerts); `recoverMissedUberOrders` |
| `lib/foodhub/menu/translate.ts` | `toUberMenu`, `checkUberMenu`, `uberTaxInfo`, holiday-hours body |
| `lib/foodhub/menu/uber-publish.ts` | Dry run (`planUberPublish`), exact body per store, `publishAllUber` |
| `lib/foodhub/ops.ts` | `isDoNotTouch`: enforced for every menu publish and 86 |

API routes:
- `app/api/foodhub/webhooks/uber-eats`
- `app/api/foodhub/uber-connect/{start,callback,session,activate,check}`
- `app/api/foodhub/menu/uber` (GET dry run / `?storeId=` JSON, POST publish all)

**Verified on this branch:**
- `npm run check`: typecheck, lint, 266 unit tests (22 of them new for Uber).
- `npm run build`.
- `npm run verify:foodhub`: 403 end-to-end checks against simulated Uber Eats, DoorDash, Skip and Clover.

**Locked rules kept:**
- Never accept an order Clover did not receive.
- Nothing is shown as sent unless Uber answered OK. "Blocked", "not sent" and "left untouched" are said as such.
- AI never acts on its own (nothing here involves AI).
- French and English in the console.
