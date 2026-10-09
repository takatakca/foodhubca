# Expansion — own delivery, grocery / retail, alcohol, AI phone ordering

_Branch `expansion-features` · October 2026 · sandbox only — nothing here is live until the owner says so._

Four new lines of business, built on top of Food Hub, each behind **its own switch**:

| Feature | What it does | Where in the console | Needs from you | Needs from a platform |
|---|---|---|---|---|
| **Own-order delivery** | Our own orders (AI phone, phone by staff, Clover "Delivery", website) get a courier: DoorDash Drive first, Uber Direct as comparison / fallback | **Own orders** (side menu) · kitchen screen strip · Settings → Expansion → Delivery | Drive keys, kitchen phones, a rule per kitchen | DoorDash: Drive **production access** (after sandbox test deliveries). Uber: Uber Direct account (optional) |
| **Grocery / retail** | Product catalogue with SKU, barcodes (UPC / EAN / PLU), units, goods sold by weight, stock per location, linked to Clover | Menus → **Grocery** | Import from Clover or a CSV | **DoorDash Marketplace Retail** and **Uber Eats grocery** approvals — payloads are built, nothing is sent |
| **Alcohol** | RACJ permit per location, legal hours, ID check (18+) at delivery; blocked everywhere without a checked permit | Settings → Expansion → Alcohol | The permit, your check, the written delivery agreement | DoorDash alcohol addendum (Marketplace), Uber alcohol-enabled market, Drive alcohol deliveries |
| **AI phone ordering** | An AI agent answers, takes the order from the live menu, confirms the total, sends it to Clover, texts a confirmation, hands off to a person on request | **Own orders → Calls (AI)** · Settings → Expansion → AI phone | Twilio number(s), Claude API key | Nothing (Twilio and Anthropic are pay-per-use accounts) |

All four start **off**. Turning one on (Settings → **Expansion**, owner only) makes it visible and usable inside Food Hub; it
still sends nothing to a platform without that platform's keys, and — in production — without
`LIVE_CONNECTORS_GLOBAL_ENABLED=true`. The server can force a feature with `FOODHUB_FEATURE_DELIVERY|RETAIL|ALCOHOL|PHONE=on|off`
(the environment wins over the switch).

## Rules kept (docs/LOCKED_DECISIONS.md)

- **AI never refunds, cancels, discounts or approves money.** The phone agent's only tools are: add / remove an item in the
  cart of *this* call, view the cart, record pickup / delivery details, place the order the caller confirmed, switch
  French / English, transfer to a person, hang up. A unit test checks that list. It never takes card numbers.
- **Couriers never collect money.** An unpaid delivery waits until a person taps *Payment taken* (unless the owner turns on
  "send a courier even if not paid" — not recommended).
- **Nothing is shown as done when it was not sent.** "Blocked" fleets and "needs platform approval" stay visible as such.
- **Alcohol is never turned on automatically.** Every channel starts closed and opens only after the owner enters the
  permit, ticks *I checked this permit* and opens the channel. A new permit number or type cancels the check.
- **One explicit exception, to confirm by the owner:** DoorDash Drive **sandbox** calls run without the live switch
  (they dispatch no real courier and DoorDash requires test deliveries before granting production). Production Drive
  and Uber Direct calls need `LIVE_CONNECTORS_GLOBAL_ENABLED=true` like every other platform call.
- **Keys only through `npm run setup` or the server variables.** Settings shows which are missing, never their values
  (the two webhook tokens the owner must paste elsewhere are revealed to the owner only, with the same rule as
  *Platforms & Clover → Show secrets*).

---

## 1. Own-order delivery (DoorDash Drive, Uber Direct)

```
AI phone ──┐
Phone/staff┼─► direct order ─► Clover ticket (📞 IA-1043 · Po Poulet) ─► kitchen
Website ───┤        │                                  
Clover "Delivery" ──┘        ready − N min (auto) or "Call a courier"
                             │
              quote DoorDash Drive (+ Uber Direct) → cheapest → book
                             │
   Drive webhooks: Dasher assigned → at the counter → picked up → delivered / cancelled / returned
        │                 │                │
   text tracking link   kitchen strip    order completed (or flagged for a person)
```

**Sources of direct orders**
- **AI phone** — the order the caller confirmed (pickup paid at the counter; delivery: a person calls back for the payment).
- **Phone / counter, by a person** — *Own orders → New order*.
- **Clover "Delivery"** — Clover orders whose order type says *Delivery / Livraison* and are **not** a platform's (DoorDash,
  Uber, Skip, TGTG bring their own couriers). Read every 2 minutes; the customer's name, phone and address come from the
  Clover customer on the order, else from the order note. Missing address → the order waits with *Add the address*.
- **Website** — your site POSTs each order (format below).

**When a courier is sent** — every condition is checked by Food Hub, whatever asked for the courier:
own delivery on · the kitchen's rule on · full address with a Canadian postal code · inside the kitchen's area (postal
prefixes, and distance when both ends have coordinates) · customer phone · **paid** · kitchen address and phone set ·
alcohol allowed for third-party delivery right now (permit, written agreement, legal hours, with food).

**Auto-dispatch** (per kitchen): at *ready time − N minutes*. Above the kitchen's price limit, a person decides. Retried
every 2 minutes, 3 tries, then *Auto-dispatch stopped* on the order. A courier that cancels is never re-booked
automatically. Auto-dispatch (and reading Clover "Delivery" orders) runs right after each Watchtower check — every
20–30 s while a screen is open, from the server timer, or from the 1-minute cron — so keep the Watchtower running 24/7
(docs/FOODHUB.md → *Keep the Watchtower running when no screen is open*).

**Quotes**: the primary fleet (DoorDash Drive), and Uber Direct when *compare quotes* is on and Uber Direct is configured;
the cheapest working quote is booked; if that fleet refuses, the next one is tried. Both prices are kept on the delivery.

**Statuses** move forward only: requested → assigned → at the counter → on the way → at the customer → delivered (or
cancelled / returning / returned). A cancellation or a return flags the order for a person and posts to the team chat.

**Customer texts**: confirmation when the order is taken (phone, website, optional for staff orders), and the tracking link
once when a courier has it. DoorDash's own status texts can also be on (*dropoff_contact_send_notifications*).

**Money**: the order keeps what the customer paid (delivery fee, tip) and the delivery keeps what the courier costs; the
board and the Overview tile show *couriers vs fees charged* for the day. Nothing is posted to the ledger automatically.

### DoorDash Drive — required features (Developer Portal → Drive → Features)

| DoorDash requirement | What Food Hub sends (lib/foodhub/delivery/doordash-drive.ts) |
|---|---|
| Send Dropoff Address | `dropoff_address` — one line with unit, city, province, postal code |
| Pass Order Value | `order_value` in cents (subtotal + taxes) |
| Send Pickup Business Name | `pickup_business_name` = the brand (Po Poulet, Pi Pita…) |
| Create deliveries | `POST /drive/v2/quotes` then `POST /drive/v2/quotes/{id}/accept` (or `POST /drive/v2/deliveries`) |
| Set up tips | `tip` in cents on every delivery (customer's tip, else the default tip in Settings) |
| Pickup and dropoff info | `pickup_phone_number`, `pickup_instructions`, `pickup_reference_tag` (our order number), `dropoff_contact_given_name` / `family_name`, `dropoff_phone_number`, `dropoff_instructions` |
| Item Level Details | `items[]` with name, quantity, price (cents), options as description |
| Cancel Delivery | `PUT /drive/v2/deliveries/{id}/cancel` (*Cancel the courier*, manager PIN by default) |
| Delivery status SMS | `dropoff_contact_send_notifications` (setting *Text the tracking link*) |
| Alcohol | `order_contains.alcohol=true`, `action_if_undeliverable=return_to_pickup`, `contactless_dropoff=false` — the Dasher scans the ID |

### Owner steps — sandbox to production

1. **Keys** on your computer: `npm run setup` → *OWN-ORDER DELIVERY* → Drive Developer ID, Key ID, Signing secret
   (Developer Portal, the org that has Drive access → Drive → Credentials → the **sandbox** key), `DOORDASH_DRIVE_ENV=sandbox`.
   On Coolify / the VPS, the same names as server variables.
2. **Settings → Business**: each kitchen's **phone** (the Dasher calls it) and street address.
3. **Settings → Expansion**: turn on *Own-order delivery*.
4. **Settings → Expansion → Delivery**: turn on each kitchen that delivers its own orders; tip, customer fee, postal
   prefixes, auto-dispatch and its price limit.
5. **DoorDash Developer Portal → Drive → Webhooks** (sandbox): URL shown on that page
   (`https://<domain>/api/foodhub/webhooks/doordash-drive`), authentication **Basic**, header **Authorization**, token =
   *Show the token* on the same page (`DOORDASH_DRIVE_WEBHOOK_SECRET`, generated by Food Hub).
6. **Test**: *Own orders → New order* (delivery, *Already paid*), then *Call a courier*. Move it in the portal's
   **Simulator** (assigned → picked up → delivered) and watch the order, the kitchen strip and the customer text. Do one
   *Cancel the courier*. Repeat until every required feature shows complete in the portal.
7. **Request production** in the portal. When granted: production key in the server variables, `DOORDASH_DRIVE_ENV=production`,
   the production webhook (same URL and token), and `LIVE_CONNECTORS_GLOBAL_ENABLED=true`.
8. **Uber Direct** (optional, comparison / fallback): direct.uber.com → Developer → customer ID, client ID / secret, webhook
   signing key → `UBER_DIRECT_*`; webhook URL `https://<domain>/api/foodhub/webhooks/uber-direct`. Confirm in their sandbox
   that alcohol uses `dropoff_verification.identification.min_age` before sending alcohol through Uber Direct.

### Our own couriers (3rd fleet)

Next to DoorDash Drive and Uber Direct: **our own couriers** (`lib/foodhub/delivery/own-fleet.ts`, `courier-app.ts`), off by default.

- **Settings → Expansion → Our couriers** (`/settings/expansion/couriers`): turn the fleet on, set what one delivery costs us
  (pay per delivery, gas…), add couriers (name, phone, kitchens served). **New link** gives one courier his personal link
  (`https://<domain>/courier#t=…`, no password, valid 180 days); a new link cancels every older one; *Active* off locks him out.
- **Dispatch**: when the fleet is on, our cost is compared with Drive (and Uber Direct when comparing) and the cheapest
  working price is booked. Our quote works only when a courier is **on shift** for that kitchen; the delivery goes to
  the one with the fewest running deliveries. Same checks as every fleet (paid, address, area, alcohol rules).
- **The courier's page** (`/courier`, phone-first): his running deliveries with pickup and drop-off (map link, call
  buttons), tip, alcohol/ID flag, *not paid → collect nothing*; taps *At the kitchen → Picked up → At the customer →
  Delivered*, *Decline* (before pickup) and *Problem* (flags the order, posts to the team chat). Each tap goes through the
  same path as the Drive / Uber Direct webhooks (forward only; picked up = on the road; delivered = completed).
- **Privacy**: a courier only sees his own running deliveries; the customer's address and phone leave his page when the
  delivery is over. The token stays in the link's fragment and the phone's storage (never in a server log or Referer).
- Next (roadmap H2 in `docs/ON2GO_HUB_ECOSYSTEM.md`): shifts and pay per delivery, proof of delivery photo, live position, zones, native app.

### Website orders

```
POST https://<domain>/api/foodhub/webhooks/website-order
Authorization: Bearer <FOODHUB_WEBSITE_ORDER_SECRET>      (Settings → Expansion → Delivery → Show the token)
{
  "id": "W-123",                       // your order id — the same id twice never makes two orders
  "brand": "Po Poulet", "location": "NDG_MAIN",
  "customer": { "name": "Ana", "phone": "514-555-1234", "email": "ana@…", "lang": "fr" },
  "fulfillment": "delivery",           // or "pickup"
  "address": { "street": "5555 av. Monkland", "unit": "3", "city": "Montréal", "postalCode": "H4A 1E1", "instructions": "Code 1234" },
  "items": [{ "ref": "<menu item ref>", "name": "Poulet entier", "quantity": 1, "price": 24.99, "options": [{ "name": "Piri-piri", "price": 0 }] }],
  "tip": 3, "deliveryFee": 4.99, "paid": true, "wantedAt": "2026-10-08T23:00:00Z"
}
→ { "ok": true, "number": "W-1044", "id": "dir_…", "total": 38.21, "duplicate": false }
```
Alcohol in a website order is refused (422) unless the alcohol rules allow the *website* channel (and, for a delivery, *own delivery*).

---

## 2. Grocery / retail

- **Products**: SKU, barcodes (UPC-A, EAN-13, EAN-8, GTIN-14 with check digit; PLU for produce), English / French name,
  manufacturer brand, category, size, sold **by the item** or **by weight** (kg, g, lb, oz), price (per item or per weight
  unit), stock per location with a low-stock level, taxable or zero-rated (basic groceries), alcohol % and volume.
- **Clover**: *Import from Clover* reads items that have a barcode or SKU (price type, unit, stock count) and keeps the
  link; *Send price & stock to Clover* writes them back (`/item_stocks`, `/items`). Food Hub-only fields (French name,
  alcohol, low-stock level) survive a re-import.
- **CSV**: *Check* first (row-by-row errors), then *Import*. Comma or semicolon, French or English headers.
- **Barcode scanner**: any USB / Bluetooth scanner works in the scan field (it types the code + Enter): known product → it
  opens; unknown → a new product with the code filled in.
- **Platforms (designed, not sent)** — `lib/foodhub/retail/platforms.ts` builds the exact payloads, shown under *See planned
  payloads*:
  - **DoorDash Marketplace Retail** — catalogue items (`merchant_supplied_item_id`, `other_identifiers` UPC/PLU/GTIN,
    `brand_info`, `item_categorizations`, `images`, `product_traits` ALCOHOL / WEIGHTED, `weighted_item_info`) and store
    items (price in cents or per measurement unit, `ACTIVE` / `INACTIVE`, `balance_on_hand`). **Needs:** DoorDash approval
    of "Marketplace for Retail" (Developer Portal → Add integrations), a business_id and store ids, photos ≥ 1400×800,
    and a signed alcohol addendum for alcohol.
  - **Uber Eats grocery** — Menu API items with `product_info.gtin` / `plu`, `selling_info.sold_by_unit` for weight,
    `suspension_info` when out of stock (Uber has no stock count), `beverage_info.alcohol_by_volume`. **Needs:** Uber's
    written approval for retail menus, a grocery-type store, alcohol-enabled market for alcohol.
  - The day a platform approves, only the send call is added; the switch, the alcohol filter and the preview stay.

---

## 3. Alcohol (Québec)

| | Restaurant permit (permis de restaurant) | Grocery permit (permis d'épicerie) |
|---|---|---|
| Take-out / delivery hours | 8:00 – 23:00 | 7:00 – 23:00 |
| With food | Always, prepared by the permit holder | Not required |
| Delivery by a third party (DoorDash, Uber, Skip, our Drive couriers) | Only with a **written agreement** with that company, kept 3 years after it ends | **Never** — the holder delivers itself |
| Minimum age | 18 — photo ID at the door | 18 — photo ID at the door |

Sources: RACJ pages *Permis de restaurant* and *Permis d'épicerie* (checked October 2026). **Check them against your own
permit** — Food Hub enforces what you enter, it does not read the RACJ registry.

**Where the rules apply** (only while the *Alcohol* switch is on — with it off, platform menus stay exactly as before,
and the phone agent and our couriers sell no alcohol at all):
- **Platform menus**: items tagged *alcohol* are left out of the menu sent to a store whose location / platform is not open.
- **AI phone**: alcohol is offered only when the *phone* channel is open and it is legal hours; never alone with a
  restaurant permit; the caller is told photo ID (18+) is checked.
- **Own delivery**: not dispatched unless *own delivery* is open (agreement signed, legal hours, with food); the courier
  gets the alcohol / ID-check flags.
- **Website orders** and the **grocery catalogue** payloads: same decision.

**Owner steps**: Settings → Expansion → turn on *Alcohol* → Settings → Expansion → Alcohol → for each location: permit
type, number, holder, expiry → *I checked this permit* → (restaurant) tick the written agreement once signed with each
delivery company → open channels one by one. The page shows, live, what is allowed *right now* and why not.

**Platforms**: DoorDash Marketplace and Uber Eats each approve alcohol separately (contract addendum / alcohol-enabled
market). DoorDash Drive alcohol deliveries are a Drive feature ("Deliver alcohol"). Opening a channel in Food Hub does not
replace any of those.

---

## 4. AI phone ordering

**A call**: Twilio → `POST /api/foodhub/webhooks/voice` (signed with `TWILIO_AUTH_TOKEN`, refused otherwise) → greeting in
French with *"For English, press 2 or say English"* (Twilio cannot detect the language by itself) → each sentence is
transcribed (fr-CA, or en-US — Twilio has no en-CA speech model) → Claude answers with tools → the answer is spoken
(Polly Gabrielle / Joanna neural voices by default) → … → *place order* only after the caller confirms the read-back
total → Clover ticket + confirmation text → goodbye.

- **Model**: `FOODHUB_PHONE_MODEL` (default `claude-opus-5-5`) through the official Anthropic SDK, low effort for quick
  answers, strict tool schemas, the rules + the line's live menu as a cached prompt prefix, server-side refusal fallback
  (a declined request goes to a person).
- **The tools decide, not the model**: 86'd items and options are not on the menu it sees; required choices (min / max per
  option group) are enforced; open hours, delivery area, alcohol and the confirmed total are re-checked before the order.
- **15-second limit**: Twilio waits at most 15 s per answer. A slower turn says *"Un instant, je vérifie"* and continues on
  `/voice/wait`.
- **Hand-off**: on request, for refunds / complaints / earlier orders / payment / allergies it cannot answer / large
  orders, after 40 turns, if the AI fails or declines, or when the AI key is missing — `<Dial>` to the line's hand-off
  number, else the kitchen phone. Nobody answers → the caller hears that we will call back and the **team chat gets the
  number to call back**; the call shows *Call back* in the log.
- **Call log** (Own orders → Calls): every call with transcript, cart, outcome, duration and AI usage. Lists show masked
  numbers. The AI message history is deleted when the call ends; the readable transcript stays.
- **Try the agent** (same page): type like a caller; same model, menu and rules; nothing is ever sent to the kitchen.
- **Privacy**: the agent says it is a virtual assistant; calls are **not recorded** (Twilio default kept). Announce any
  recording you add later (federal privacy commissioner guidance).

**Owner steps**
1. `ANTHROPIC_API_KEY` (already used by the Watchtower) and Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`).
2. Buy a local number in Twilio (514 / 438). Phone Numbers → the number → **A call comes in**: Webhook,
   `https://<domain>/api/foodhub/webhooks/voice`, POST; **Call status changes**: `https://<domain>/api/foodhub/webhooks/voice/status`.
   (Both are shown with a copy button in Settings → Expansion → AI phone.)
3. Settings → Expansion → turn on *AI phone ordering* → AI phone → add the line: number, spoken name, kitchen, brands,
   delivery yes / no, hand-off number.
4. Own orders → Calls → **Try the agent** until it sounds right; then call the number yourself.
5. Optional: forward a brand's existing number to the Twilio number after hours first, then all day.

**Cost** (pay-per-use): Twilio voice minutes + speech recognition, and Claude tokens (shown per call in the log).

---

## 5. Screens

| Path | Screen |
|---|---|
| `/direct` | Own orders: KPIs, cards with courier status, order drawer (courier, quotes, timeline, actions), *New order* |
| `/direct/calls` | AI phone: call log with transcripts, *Try the agent* |
| `/menu/retail` | Grocery catalogue: scan / search, stock, product drawer, CSV, Clover import, platform preview |
| `/settings/expansion` | Switches + what each feature still needs |
| `/settings/expansion/delivery` · `/alcohol` · `/phone` | Rules per feature |
| `/kitchen` | Courier strip above the tickets (own delivery only) |
| `/` | One tile per feature that is on |

Manager PIN rules (Settings → Manager PIN → *Own delivery*): *Call a courier* (open by default), *Cancel a booked courier*
(manager by default). Cancelling a direct order uses *Cancel an accepted order*.

## 6. Environment variables

| Variable | |
|---|---|
| `FOODHUB_FEATURE_DELIVERY` / `_RETAIL` / `_ALCOHOL` / `_PHONE` | Optional `on` / `off` — forces the switch from the server |
| `DOORDASH_DRIVE_DEVELOPER_ID`, `DOORDASH_DRIVE_KEY_ID`, `DOORDASH_DRIVE_SIGNING_SECRET` | Drive access key (the Drive org's own key) — separate from the Marketplace keys |
| `DOORDASH_DRIVE_ENV` | `sandbox` (default) or `production` |
| `DOORDASH_DRIVE_WEBHOOK_SECRET` | Generated by Food Hub; the token DoorDash sends in `Authorization` |
| `UBER_DIRECT_CUSTOMER_ID`, `UBER_DIRECT_CLIENT_ID`, `UBER_DIRECT_CLIENT_SECRET`, `UBER_DIRECT_WEBHOOK_SECRET`, `UBER_DIRECT_ENV` | Optional second fleet |
| `FOODHUB_WEBSITE_ORDER_SECRET` | Generated by Food Hub; bearer token for website orders |
| `FOODHUB_PHONE_MODEL` | Claude model for the phone agent (default `claude-opus-5-5`) |

## 7. What each platform must approve

| Platform | Approval | Status (October 2026) |
|---|---|---|
| DoorDash Drive | Production access after sandbox test deliveries covering the required features | Drive org: build access (sandbox) |
| DoorDash Drive | Alcohol deliveries (Features → Deliver alcohol) | Not requested |
| DoorDash Marketplace Retail | "Marketplace for Retail" integration, then a technical account manager | Not requested |
| DoorDash Marketplace | Alcohol contract addendum (restaurant menus with alcohol) | Not requested |
| Uber Direct | An Uber Direct (business) account with API access | Not requested |
| Uber Eats | Written approval for retail / grocery menus; alcohol-enabled market | Not requested |
| RACJ | Your permit; a written agreement with each delivery company before third-party alcohol delivery (restaurant permit) | Owner |
| Twilio / Anthropic | None (accounts and keys) | — |

## 8. Known limits

- Food Hub does not geocode: the distance limit applies when coordinates are known (website orders can send them); postal
  prefixes always apply, and the fleet's own quote refuses addresses it cannot serve.
- Phone delivery orders are not paid by phone (no card numbers): a person calls back, takes the payment in Clover and taps
  *Payment taken*. A payment link (Clover Hosted Checkout) is a possible next step.
- Clover "Delivery" orders without a Clover customer address rely on the order note; check the address on the order.
- Retail publishing to DoorDash / Uber is not sent until approved (by design).
- Own-delivery problems post to the team chat and show on the board and the Overview tile; they are not Watchtower
  incidents (no escalating calls) yet.
- Uber Direct alcohol verification field to confirm in their sandbox before use.

## 9. Proof

`npm run check` (unit tests: `tests/expansion-rules.test.ts`, `tests/own-delivery.test.ts`, `tests/phone-agent.test.ts`) ·
`npm run build && npm run verify:foodhub` (section 41: website order → Clover → Drive quote/accept → webhooks → texts →
completed; unpaid order blocked; cancel; signed voice webhook → kitchen hand-off without an AI key; grocery barcodes and
payload preview; alcohol closed by default).
