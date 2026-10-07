# Food Hub ↔ Clover — the backend, final

_Branch `clover-backend-final` · 2026-10-07 · Uber Eats + DoorDash → Food Hub → Clover (On2GO.CA, Station Duo printer)._

**En bref (pour le propriétaire)**
- Chaque commande Uber Eats ou DoorDash est **enregistrée avant que Food Hub réponde à la plateforme**, puis envoyée à
  Clover avec de **vrais articles et de vraies options Clover** (pas du texte), imprimée en cuisine, affichée sur
  l’écran cuisine, et **acceptée sur la plateforme seulement quand Clover l’a**.
- Si Clover ne répond pas, Food Hub **réessaie tout seul après 30 s puis 2 min** avant d’alerter un gérant. Une
  commande n’est jamais créée deux fois dans Clover.
- Les menus viennent de Clover (y compris le menu « DoorDash (Po Poulet +20%) »). **Po Poulet NDG sur DoorDash (magasin
  27982486) n’est jamais modifié** par Food Hub : ni menu, ni rupture.
- Un **aperçu (rien n’est envoyé)** montre, magasin par magasin, ce qu’une publication changerait.
- `/api/health` et la carte **Connexions et synchro** de l’Aperçu disent si tout est branché ; une **alarme de
  silence** sonne quand une plateforme n’envoie plus de commandes alors que ses magasins sont ouverts.
- Ce qui attend encore Uber et DoorDash est listé à la fin (section 7).

---

## 1. What works now

| Area | What Food Hub does | Where |
|---|---|---|
| Receive | Uber Eats and DoorDash webhooks (and Skip, TGTG, the Relay) are **saved in the webhook inbox before the answer**, then processed. A crash right after the answer, an Uber order fetch refused, a database hiccup: processed again by itself (30 s, 2 min), then **Replay**. Database unreachable → the platform gets 503 and resends. | `lib/foodhub/inbox.ts`, `lib/foodhub/webhooks/*` |
| Link to Clover | Every line → a Clover inventory item, every option → a Clover modifier: **by id** (the ref Food Hub published = the Clover id after an import), **then by name** (accents, case, punctuation, plural s/x and the bilingual "FR / EN" title ignored), **else a free-text line with a visible warning** (order page, kitchen card chip, Clover ticket note "⚠ Hors inventaire Clover"). Never dropped. | `lib/foodhub/pos/clover-order.ts` |
| Clover order | Atomic order with the item ids and **real Clover modifications** (name + amount override the inventory defaults, per Clover's docs), so Clover's pre-tax total = what the platform charged. Platform promotion = order-level discount. Title `"<Platform> #<id>"`. | same |
| Order type | The merchant's own **"Online Order Delivery"** / **"Online Order Pick Up"**, found by label (visible ones first). `CLOVER_ORDER_TYPES` pins ids; `FOODHUB_CLOVER_ORDER_TYPE_MODE=platform` keeps one type per platform. | same |
| Kitchen note | `LIVRAISON / DELIVERY` or `CUEILLETTE / PICKUP`, customer name, the platform's phone + access code, courier, the customer's words, scheduled time, free-text warning. | same |
| Taxes | Clover computes its own tax from each item's tax rates (an atomic order cannot override them). Food Hub compares Clover's total with the platform's after each order and **flags a gap** on the order and in the Activity log — e.g. the stray default **"Sales Tax" 0.14975 %** (TPS 5 % + TVQ 9.975 % + 0.14975 % = 15.12 %). Food Hub never changes merchant data: remove "Sales Tax" in Clover → Setup → Taxes & Fees. Settings → Platforms → "Clover check" lists it too. | `cloverTotalGap` |
| Tips | Pickup and Uber "delivery by restaurant" tips are the restaurant's: recorded as `tipAmount` on the Clover payment (tip-outs, Quebec Pourboire). A delivery tip is the courier's and never is. `FOODHUB_CLOVER_RECORD_TIPS=off` to stop. | `cloverTipCents` |
| Print | Kitchen ticket on the Clover printer right after the order — **each kitchen's own printer** when several kitchens share the merchant (`CLOVER_PRINT_DEVICES={"<merchant id>\|NDG_6284":"<Station Duo device id>"}`), else the merchant's (`CLOVER_PRINT_DEVICE_ID`). Scheduled orders print at fire time. A failed print shows "Ticket not printed" + Reprint. | `printKitchenTicket` |
| Kitchen screen | The order appears on `/kitchen` and the order board with its timer, allergies, courier and free-text warnings. | `/kitchen`, `/orders` |
| Accept | **Only once Clover confirmed the order** (it returned the new order id). Uber gets `external_reference_id` = the Clover id and the pickup time; DoorDash gets `order_status: success` + `prep_time`. Unmapped store → never auto-accepted. | `autoAcceptAfterClover` |
| Clover down | Not accepted. **Automatic retries after 30 s and 2 min** (`FOODHUB_CLOVER_RETRY_S`); the Watchtower shows it on screen meanwhile and only escalates (SMS, calls) once the retries are used up. When the last answer was lost (time-out, 5xx), the retry **looks in Clover by title first** and links the order Clover already has — no second ticket. A cancellation that arrives meanwhile always wins. Skip (direct) still hands the order to the Skip tablet at once (JET backup flow). | `lib/foodhub/recovery.ts` |
| Idempotency | Same platform + order id = same order (duplicate webhooks, replays, both paths). A Clover order is found again by its title before any re-send. Platform statuses only move forward. | |
| Cancellations | A platform / customer cancellation → red alarm on the kitchen screens, the Clover order is **removed from the register** (or renamed CANCELLED when Clover refuses), never accepted over. Cancelled after it was paid in Clover → flagged (refund in Clover). | `clover-settle.ts` |
| Via Clover | `FOODHUB_VIA_CLOVER=doordash`: DoorDash orders that DoorDash's own Clover integration put in Clover are read every sync, read-only, never counted as in-store sales. With one Clover for many brands, the brand is the one the order names, else left unknown (never guessed). | `clover-platform-orders.ts` |
| Menus | Clover is the master menu. Import the whole visible inventory **or one of the merchant's Clover menus** — e.g. "DoorDash (Po Poulet +20%)": only its items, its photos, and its prices on the chosen platforms. Prices that are Clover × 1.20 become a **+20 % markup** (a Clover price change then flows by itself), with an own price only where the menu differs. Hidden and "ARCHIVE · …" items are left out; option groups keep min / max (no Clover maximum = any) / required. One menu shared by all brands (Menu → Shared menu). | `lib/foodhub/menu/clover-import.ts` |
| Publish | Per store, Uber and DoorDash (and Skip), with hours and holidays. **"Preview (nothing sent)"**: per store, whether it would be sent (or why not), counts, sample prices, and what changes since the last publish (new, removed, repriced, 86'd, back, renamed). | `lib/foodhub/menu/preview.ts` |
| Do not touch | **Po Poulet NDG on DoorDash (store 27982486) is menu-locked for good**: no publish (manual, scheduled, every-brand, Uber menu refresh), no DoorDash Menu Request answer (409), no 86 / back in stock (staff, Clover sync, timers). Orders and pauses still work. Any other store: Stores → Mapping → "Never change this store's menu", or `FOODHUB_MENU_LOCKED_STORES`. Checked in the fan-out and again in every adapter. | `lib/foodhub/menu/lock.ts` |
| Health | `/api/health` (public status for an uptime monitor; details with `CRON_SECRET` or a session): database, sync, Watchtower, order recovery, webhook inbox, Clover. 503 when an order could be missed or nobody would be alerted. Overview → **Connections & sync** card. | `lib/foodhub/health.ts` |
| Silence alarm | Watchtower "Platform gone quiet": a platform that used to send orders sends none for 3 h (Settings → Alerts) while some of its stores were open the whole time and are not paused. Texts the manager on duty. | `watch/engine.ts` |

### The order path

```
Uber / DoorDash webhook ──► signature check ──► SAVED (webhook inbox) ──► 200 / 202 to the platform
                                                   │
                                                   ▼ (right after the answer; again by itself if interrupted or failed)
                               fetch order (Uber) · parse · de-duplicate · map store → brand, kitchen, Clover merchant
                                                   │
                                   link lines + options to Clover (id → name → free text ⚠)
                                                   │
                              Clover atomic order (items, modifications, order type, note, promotion)
                                 │ ok                                   │ refused / no answer
                                 ▼                                      ▼
                    kitchen ticket printed · total checked      retry 30 s, 2 min (look in Clover first)
                                 │                                      │ still down → Watchtower wakes a manager
                                 ▼                                      │
                accept on the platform (Clover id, prep time) ◄─────────┘ when Clover has it
                                 │
                 kitchen screen · Ready / Picked up · paid in Clover with the platform tender at hand-off
                 cancelled before that → removed from the Clover register
```

---

## 2. Owner steps — Clover (once)

1. **Keys** (with `npm run setup` or the hosting variables, never in chat): `CLOVER_MERCHANT_ID` (13 characters, in the Clover dashboard address) and
   `CLOVER_ACCESS_TOKEN` (Inventory read, Orders read + write, Payments read + write, Merchant read + write) — or connect
   the merchant with the Clover app (the App Market listing is handled separately).
2. **Printer**: `CLOVER_PRINT_DEVICE_ID` = the Station Duo's device id (Clover → Devices), or leave empty for the
   merchant's default order printer. When the other kitchens get their own Clover devices, give each one its kitchen:
   `CLOVER_PRINT_DEVICES={"<merchant id>|HOCHELAGA":"<device id>"}`. Settings → Platforms → **Clover check** lists items
   that never print (no printer label) and adds the kitchen label in one click.
3. **Taxes**: in Clover → Setup → Taxes & Fees, remove the default **"Sales Tax" (0.14975 %)** — keep TPS 5 % and TVQ
   9.975 %. Until then Clover's totals are about 0.15 % above the platforms' and each order says so.
4. **Order types**: keep "Online Order Delivery" and "Online Order Pick Up" visible in Clover (Food Hub uses them).
5. **Menu**: Menu → **Import from Clover** → choose **"DoorDash (Po Poulet +20%)"**, tick DoorDash (and Uber Eats if the
   Uber prices are the same × 1.20) → Import. Then Menu → **Shared menu** so every brand uses it, check the Menu check
   card, **Preview (nothing sent)**, and publish when the platforms are live.
6. **Monitoring**: add an uptime monitor (cron-job.org, UptimeRobot…) on `https://YOUR-DOMAIN/api/health` every 5
   minutes, alerting by SMS on anything but 200. Keep `/api/foodhub/cron/watch` called every minute when the server
   has no timer (Vercel); the VPS install already runs both.

## 3. Owner steps — switch Uber Eats from the tablet to Food Hub

_Waiting on: Uber's production access for the FOOD HUB app._

1. When Uber approves the scopes (`eats.order`, `eats.store`, `eats.store.status.write`, `eats.pos_provisioning`,
   `eats.report`): enter `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET` and `UBER_WEBHOOK_SIGNING_KEY` (`npm run setup`).
2. Uber developer dashboard → Webhooks → Primary webhook `https://YOUR-DOMAIN/api/foodhub/webhooks/uber-eats`, Basic HMAC
   with the signing key shown in Settings → Platforms & Clover; redirect URI `…/api/foodhub/uber-connect/callback`.
3. Stores → **Connect Uber Eats** → sign in with the Uber Eats Manager owner account → check brand + kitchen → **Activate
   & link**. Each store's orders now come to Food Hub instead of the Uber tablet (Uber confirms with
   `store.provisioned`; Stores shows "waiting for Uber" otherwise).
4. Test with one store: one real order → it prints on the Station Duo, shows on the kitchen screen, is accepted on Uber.
5. `LIVE_CONNECTORS_GLOBAL_ENABLED=true` (needs `DASHBOARD_PASSWORD`) — before that, orders arrive and go to Clover but
   nothing is sent back to Uber (no accept): the Uber tablet still has to accept.
6. Publish the menu to the Uber stores (Preview first), then keep the Uber tablet as a fallback for a few days.

## 4. Owner steps — switch DoorDash from the tablet to Food Hub

_Waiting on: DoorDash Marketplace approval (application submitted 10/07/26, org "FoodHub By Takatak") and DoorDash's
partner technical team (provider_type, credentials, webhooks — a support case is open; its number is in the owner's
private notes)._

**Now (before approval)**
- 3 DoorDash stores show **"Operations suspended"**: their order protocol is still POINT_OF_SALE on the dead UrbanPiper
  integration. Ask DoorDash support to switch them to **TABLET** (a case is being opened) so they take orders again.
- Keep `FOODHUB_VIA_CLOVER=doordash` if DoorDash's own Clover integration is used: DoorDash orders are read from Clover
  (read-only "via Clover"), counted in reports, never as in-store sales; DoorDash menu, prices and 86 stay in Clover /
  the DoorDash portal. Map each DoorDash store under Stores (with its DoorDash store number) so the brand is known.

**When DoorDash approves the Marketplace integration**
1. Enter `DOORDASH_DEVELOPER_ID`, `DOORDASH_KEY_ID`, `DOORDASH_SIGNING_SECRET`, `DOORDASH_PROVIDER_TYPE` (`npm run setup`);
   `DOORDASH_WEBHOOK_SECRET` is generated (Settings → Platforms → Show secrets).
2. Developer Portal → webhook subscriptions, all to `https://YOUR-DOMAIN/api/foodhub/webhooks/doordash` with the
   Authorization value: Order, Menu Status, Dasher Status, **Menu Request**; ask DoorDash to point **Order Cancellation**
   there too.
3. For each store agree a `merchant_supplied_id` with DoorDash (e.g. `NDG_6284-POPOULET`), enter it under Stores, with
   the DoorDash store number. **Po Poulet NDG (27982486) stays menu-locked** — Food Hub answers its Menu Request with
   409 and never publishes or 86s it.
4. Remove `doordash` from `FOODHUB_VIA_CLOVER`, and only then ask DoorDash to switch each store's order protocol from
   TABLET to **POINT_OF_SALE (Food Hub)** — never both paths at once (each order would arrive twice).
5. One test order per kitchen (DoorDash fails an order not confirmed within 3–8 minutes: the confirm goes out as soon as
   Clover has it), then Preview and publish the menus (except the locked store).

## 5. Health and alarms

| Signal | Who sees it |
|---|---|
| `/api/health` 503 | The outside monitor texts the owner (Watchtower dead, sync stopped 45+ min, webhook stuck, an order Clover never got). |
| Overview → Connections & sync | Everyone with the console: each platform (live / via Clover / to connect, last order) and each check. |
| "Platform gone quiet" | Watchtower: screen + chat, then SMS to the manager on duty. Threshold in Settings → Alerts (default 3 h). |
| Clover did not get an order | On screen while Food Hub retries; critical (SMS → call → owner) once the retries are used up. |
| Webhook inbox | Settings → Platforms & Clover: entries waiting, failing or needing Replay; kept unreadable payloads with Replay. |

## 6. Settings added by this work

| Variable | Default | Meaning |
|---|---|---|
| `FOODHUB_CLOVER_RETRY_S` | `30,120` | Seconds before each automatic Clover retry; `off` = manual "Send to Clover" only. |
| `FOODHUB_INBOX_RETRY_S` | `30,120` | Seconds before each automatic re-try of a failed webhook. |
| `FOODHUB_CLOVER_ORDER_TYPE_MODE` | (fulfillment) | `platform` = one Clover order type per platform, as before. |
| `CLOVER_ORDER_TYPES` | — | Pin ids: `{"delivery":"<order type id>","pickup":"<order type id>"}` or per merchant `{"MID":{…}}`. |
| `FOODHUB_CLOVER_ORDER_TYPES_TTL_S` | `600` | How long Clover order types are cached. |
| `FOODHUB_CLOVER_RECORD_TIPS` | on | `off` = never put a tip on the Clover payment. |
| `FOODHUB_MENU_LOCKED_STORES` | — | More menu-locked stores: `doordash:27982486,uber_eats:<uuid>` (Po Poulet NDG is built in). |
| `FOODHUB_RETRY_TIMER` | on | `off` = no in-process retry timer (the cron, sync and screens still run the retries). |
| `CLOVER_PRINT_DEVICES` | — | Now also `{"MERCHANT_ID\|LOCATION_CODE":"deviceId"}`: each kitchen's tickets on its own printer. |

Watchtower defaults changed: "Action not received by a platform" (`menu_failed`) and "Statuses not refreshed"
(`sync_stale`) now text the manager on duty (MASTER_PLAN Phase 1 item 3); "Platform gone quiet" is new and on.

## 7. What still depends on Uber and DoorDash

| Needed from | What | Until then |
|---|---|---|
| Uber | Production access + scopes for the FOOD HUB app; each store provisioned (Connect Uber Eats) | Uber tablet takes the orders. Everything else is ready and tested against a simulated Uber. |
| DoorDash | Marketplace approval: `provider_type`, credentials, webhook subscriptions, Order Cancellation webhook, Menu Request URL; order protocol per store | `FOODHUB_VIA_CLOVER=doordash` (orders read from Clover) or the DoorDash tablet; 3 suspended stores → TABLET. |
| DoorDash | Merchant cancellation allowlist (`DOORDASH_MERCHANT_CANCEL=true`) | Cancel an accepted DoorDash order on the DoorDash tablet / portal. |
| Clover | (Food Hub side is done) — the merchant's own tax setting ("Sales Tax" 0.14975 %) | Totals flagged on each order. |

**To verify on the live merchant** (built from Clover's documentation and the research export, not yet seen live):
- the Clover **Menus** endpoints (`/menus`, `/menus/{id}/items`) are not in Clover's public reference: Food Hub reads
  them defensively and falls back to the inventory; check the import of "DoorDash (Po Poulet +20%)" once on the live
  token (175 items, +20 % detected — the research export gives exactly that);
- that the atomic order honours each line's `price` and each modification's `name` + `amount` (Clover's docs say the
  name + amount override the inventory default) — the first live order's Clover total vs the platform total is logged.

## 8. Proof

```bash
npm run check                              # typecheck + lint + 285 unit tests
npm run build && npm run verify:foodhub    # 409 end-to-end checks against simulated Uber Eats, DoorDash, Skip, Clover…
```

Two checkouts verifying at the same time on one computer: give one of them other ports
(`FOODHUB_E2E_MOCK_PORT=4899 FOODHUB_E2E_APP_PORT=4900 npm run verify:foodhub`) — two runs on the same ports slow each
other down and fail time-window checks.

New tests: `tests/clover-order.test.ts` (linking, Clover body, order types, tips, totals), `tests/order-path.test.ts`
(the whole path against simulated Clover + Uber: modifications, delivery / pickup, accept after Clover, retries with no
second ticket, cancellation wins, webhook inbox), `tests/menu-lock.test.ts`, `tests/menu-import-preview.test.ts`
(including the owner's real Clover export when it is on the computer — git-ignored), `tests/health-silence.test.ts`.
End-to-end section 41 drives the same through the running app: delivery / pickup types, a free-text line, Clover down
then back (retried, confirmed once), Uber refusing the order fetch (retried, then Replay), the Po Poulet NDG lock
(publish, 86, Menu Request), the Clover DoorDash menu import (+20 %), the publish dry run, and `/api/health`.
