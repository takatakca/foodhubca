# Website orders through Clover (pppmtl.com first)

> **Pour le propriétaire :** le bouton « Commander en ligne » de pppmtl.com ouvre la page Clover Online Ordering.
> Clover encaisse, imprime à la caisse et envoie au KDS, tout seul. La tablette Food Hub (`/kitchen`) montre la même
> commande en même temps, « Acceptée dans Clover ». Clover reste le maître : annuler ou rembourser se fait dans Clover,
> et Food Hub suit. Vos étapes sont à la section 4.

Task 10 of `docs/PROGRESS.md`. Research checked on 2026-10-07, official Clover and Fiserv sources only. Nothing in this
file names a merchant id, a device or a secret (public repository).

## 1. What Clover offers restaurants now

| Feature | What it does | On by default? | API Food Hub can use |
|---|---|---|---|
| **Clover Online Ordering** | Your own ordering page (or a link from your existing website), menu synced from Clover, pickup, curbside, scheduled orders, pause / stop, QR codes, Scan to Order for dine-in. Orders "fire straight to your kitchen team and Clover POS". Shows up in the Clover mobile app too. | **No.** Turned on in the dashboard (Ordering tools → Online ordering). Included in select plans with no subscription fee; card-not-present processing rates apply. Needs a Clover POS device (Station Solo, Station Duo, Mini or Flex) with a printer; not on Payments Plus / Register Lite. Local delivery through DoorDash Drive is U.S. only. | No public API to create or read "online" orders as such. They are normal Clover orders, readable with the Orders REST API, with the merchant's online-ordering **order type**. |
| **Online-order printing** | A **remote firing device** (priority Station, then Mini, then Flex) prints each online order on its **remote firing printer**: an expo receipt, label printing per item (kitchen / bar), or both. If the printer is offline, orders stay in the Orders app and Clover emails the owner. | Yes, with a default device; check it. | Clover marks line items `printed: true` when an order is printed, and sends that as an order webhook update. |
| **Clover Rewards** (loyalty) | Points (1 point per dollar, pre-tax), rewards (discounts, free items), sign-up bonus, birthday and VIP bonuses; customers join with a phone number or email; synced across devices and locations. Clover's online-ordering page says customers can "earn and redeem perks, rewards, and promotions through the Clover mobile app". | **No.** 2-step setup on the device, the Go app or the dashboard. Included in select plans with no additional fee. | No public Rewards API found. Loyalty stays entirely in Clover; Food Hub does nothing with it. |
| **Clover KDS** | Kitchen screen (14" or 24"): orders from every device and from online ordering fire to it; item routing, colour-coded status, prep-time and fulfilment reports; works offline with Clover Local Connect. | **No.** Hardware purchase; needs a Register, Table Service or Counter Service Restaurant plan. | No public KDS / bump API. A KDS can be set as the order printer of a firing device (Clover developer FAQ). |
| **Webhooks** (developers) | Event types include **O = Orders** (created, updated, deleted; needs *Read orders*), plus Inventory, App, Payments, Customers… Body: `merchants → { "<merchant>": [{ objectId: "O:<orderId>", type: "CREATE"\|"UPDATE"\|"DELETE", ts }] }`, header `X-Clover-Auth`. HTTPS only, verification code. | Per app, in the Clover developer dashboard. | Yes: Food Hub's existing webhook URL. |
| **Print REST API** | `POST /v3/merchants/{mId}/print_event` prints an order on the firing device's order printer. | — | Yes, but **never used for website orders** (it would be a second ticket). |

Newer Clover restaurant launches (U.S. focused, nothing to switch on for PPP today): Clover Hospitality by BentoBox
(2025), Clover Reserve powered by Tabit for fine dining (Fiserv release, 12 May 2026), Scan to Pay with Apple Pay in
Clover Dining, and Fiserv's Investor Day 2026 plan to bring Clover Restaurant, Clover Hospitality and Bento together in
the second half of 2026. Developer announcements for 2026: inventory webhook changes, new server-side limits on line
items, and the end of app updates for 1st-generation devices (Station Duo is not one of them).

**Embedding:** Clover's ordering pages answer with `Content-Security-Policy: frame-ancestors *.clover.com …`, so they
cannot be shown inside pppmtl.com (no iframe). A button or link is the only way, and it is what Clover's own help
recommends ("adding a button or a link on the header/home page, such as 'Order online'").

**Sources**
- Online ordering: [overview](https://www.clover.com/en-CA/help/offer-online-restaurant-ordering) ·
  [sign up / link your existing website](https://www.clover.com/en-CA/help/sign-up-for-online-ordering) ·
  [pause, stop, pickup / curbside](https://www.clover.com/en-CA/help/manage-additional-online-ordering-options) ·
  [printing for online orders](https://www.clover.com/en-CA/help/olo-manage-order-printing) ·
  [customize the website](https://www.clover.com/en-CA/help/customize-online-restaurant) ·
  [promote the page](https://www.clover.com/en-CA/help/a-market-online-ordering-webpage) ·
  [product page](https://www.clover.com/pos-systems/online-ordering)
- Rewards: [set up](https://www.clover.com/en-CA/help/set-up-rewards-program) ·
  [create a program](https://www.clover.com/en-CA/help/create-rewards-program) ·
  [FAQ](https://www.clover.com/en-CA/help/rewards-program-faqs) ·
  [App Market: Rewards by Clover](https://www.clover.com/appmarket/apps/1EVSVRM8SV8RC)
- KDS: [product](https://www.clover.com/kitchen-display-system) · [set up](https://www.clover.com/en-CA/help/set-up-kds) ·
  [offline](https://www.clover.com/en-CA/help/use-kds-offline) ·
  [launch post (June 2023)](https://blog.clover.com/new-clover-kitchen-display-system-for-restaurants/)
- Developers: [webhooks](https://docs.clover.com/dev/docs/webhooks) ·
  [print orders (REST)](https://docs.clover.com/dev/docs/printing-orders-rest-api) ·
  [orders FAQ](https://docs.clover.com/dev/docs/orders-faqs) · [orders data](https://docs.clover.com/dev/docs/working-with-orders) ·
  [developer FAQ](https://docs.clover.com/dev/docs/faqs) · [announcements](https://docs.clover.com/dev/docs/release-notes-announcements)
- Fiserv: [news releases](https://investors.fiserv.com/news-events/news-releases)

## 2. Design

### Website → Clover
- **Chosen: the Clover Online Ordering link.** pppmtl.com gets a "Commander en ligne / Order online" button that opens
  the Clover ordering page. Clover takes the payment, applies its menu, prep time (20 min), printing, KDS routing,
  customer messages and refunds. Food Hub writes nothing for these orders, so nothing can go wrong with money or tickets.
- *Later, if ever needed:* our own order page posting to `/api/foodhub/webhooks/website-order` (already built, behind
  the own-delivery switch). Food Hub would then inject into Clover and need its own payment step (Clover Hosted
  Checkout). Not chosen: the owner wants control in Clover.
- "Same server network": nothing to host. The button works from WordPress today and from the static brand-sites
  container later (task 7) without change.

### Clover → Food Hub
A Clover order is a **website order** when all three are true (Clover publishes no "source" field for online orders):
1. Food Hub did not create it: not one of Food Hub's Clover ids, and not a Food Hub title (`DoorDash #…`,
   `CANCELLED — Uber Eats #…`, `🌐 W-1043 · …`). Food Hub's own tickets use the same "Online Order Pick Up" type.
2. No delivery platform is named in its order type, tender, title or note (those stay platform orders "via Clover").
3. Its order type is one of the merchant's online-ordering types: a label containing "online", "en ligne" or "web"
   ("Online Order Pick Up"…), or exactly the ids / labels in `FOODHUB_CLOVER_WEBSITE_ORDER_TYPES`.

It reaches Food Hub two ways, both writing **the same document** (its id comes from the Clover order id):
- **Webhook** `O:<orderId>` (instant) on the existing `/api/foodhub/webhooks/clover`, checked with `X-Clover-Auth`.
  CREATE → read once and kept if it is a website order. UPDATE / DELETE → mirrored for website orders only (other
  orders cost one read, then are remembered for 30 min).
- **Poller** (fallback): every 30 s while a Food Hub screen is open or the cron runs, and at every sync. Reads the new
  orders since its last run (with a 2-minute overlap, in case Clover's clock and ours differ), then re-reads the open
  website orders (at most 25). An order first seen more than 90 minutes after it was placed (first run after a deploy)
  is kept as history only, never put on the kitchen screen.

It is stored as an **own order** (source `clover_online`, number `WEB-1043`), not as a platform order: no payout or
commission check, and it stays in the Clover sales total (it is a Clover sale). It shows on `/kitchen` with a green
globe mark, the customer's first name, the items, "Acceptée dans Clover" and "Imprimée par Clover".
Why not a new platform channel: the order table, payouts, publishing and reconciliation all loop over platforms; adding
"website" there touched about 70 places, many in the files task 2 is reworking. The own-order model already exists for
our phone and website orders and fits exactly.

### Mirror rule (Clover is the source of truth)

| In Clover | On the Food Hub kitchen screen |
|---|---|
| Order created and paid online | Shown in "À préparer" as **Acceptée dans Clover** (Clover always accepts first). "pas vue" until someone taps **Vu**. |
| Lines printed (printer or KDS) | **Imprimée par Clover**. Until then: "Impression Clover en attente". Food Hub never prints. |
| Refunded, credited, payment voided, or order deleted | **Cancelled** here too, even after a local "Prête" / "Terminée". |
| Partly refunded | Noted on the order. |
| Ready / completed | Clover's public API has no such state, so Food Hub cannot see it. The kitchen taps **Prête** then **Remise / terminée** on its own screen; open website orders close by themselves after 4 h. |

| Tapped first in Food Hub | Result |
|---|---|
| Vu, Prête, Remise / terminée | Allowed, **on the Food Hub screen only**, logged "nothing sent to Clover". |
| Accept | Not needed: Clover accepted it already. |
| Reject, cancel, refund, reprint, send to Clover, edit, call a courier | **Blocked (409): "faites-le dans Clover"**. |

Why block instead of sending to Clover: (1) money: Clover's Platform REST API cannot refund an order ("Not supported.
Use the Dashboard or the Ecommerce API", Orders FAQ), so a Food Hub "cancel" would leave the customer charged;
(2) tickets: a Food Hub print would be the second ticket; (3) the customer's confirmations come from Clover;
(4) there is no "ready" state in Clover to write. One controller, Clover, means no two people can do opposite things.

### First one to act, no double ticket
- Clover always acts first: it fires the online order to its printer and KDS before any API sees it.
- Food Hub never creates a Clover order for a website order (guard in `createDirectOrderInClover`), never calls
  `print_event` for it, and the own-courier dispatcher skips it.
- One document per Clover order id: the webhook, the poller and several open screens can meet; the second writer only
  updates (the same "look it up first" idea as the Clover retry's lookup-before-retry).
- The own-delivery reader (`delivery/clover-source.ts`) leaves Clover online types to this mirror, so an order is never
  shown twice.
- KDS: routing is Clover's (labels, remote firing printer, KDS as order printer). The Food Hub tablet is a mirror, not
  a printer.

## 3. What was built (branch `clover-website-orders`)
- `lib/foodhub/pos/clover-website-orders.ts`: recognition, Clover state reader, mirror, poller, webhook handler,
  kitchen-screen actions, "do it in Clover" guard.
- `app/api/foodhub/website-orders` (GET list for the kitchen) and `website-orders/[id]` (GET, POST `ack` / `ready` /
  `complete`; anything else 409).
- `components/live/website-orders.tsx` + `/kitchen`: website cards in "À préparer" and "Prêtes".
- Wiring: Clover webhook route (Orders events), live pulse and cron heartbeat (tick), sync report (`websiteOrders`).
- Guards in the own-order code: source `clover_online`, never re-sent to Clover, no courier, no cancel / refund.
- Tests: `tests/clover-website-orders.test.ts`; e2e section 44 in `scripts/foodhub-e2e.mjs` (mock Clover serves the
  online orders and their single-order reads).

### Settings (all optional)
| Variable | Default | Meaning |
|---|---|---|
| `FOODHUB_CLOVER_WEBSITE_ORDERS` | on | `off` stops the mirror. |
| `FOODHUB_CLOVER_WEBSITE_LOCATION` | the only kitchen on that Clover | Kitchen code for website orders, or JSON `{"<merchant id>": "NDG_6284"}`. Needed when several kitchens share one Clover (otherwise the order is flagged "kitchen guessed"). |
| `FOODHUB_CLOVER_WEBSITE_BRAND` | the brand the order names, else the only brand of that kitchen, else "Site web" | e.g. `PPP Pizzeria` (or JSON per merchant). |
| `FOODHUB_CLOVER_WEBSITE_ORDER_TYPES` | labels with "online" / "en ligne" / "web" | Pin the Clover order types (ids or labels, comma-separated) if the test order does not show. |
| `FOODHUB_CLOVER_WEBSITE_POLL_S` | 30 | Poller interval (min 10). |
| `FOODHUB_CLOVER_WEBSITE_CLOSE_MIN` | 240 | Open website orders close by themselves on the Food Hub screen after this. |

## 4. Owner steps (Clover, pppmtl.com, Food Hub)

**Clover dashboard** (clover.com → Dashboard)
1. **Ordering tools → Online ordering**: "Accepting orders" ON. *Settings → Manage → Fulfillment methods*: In-store
   pickup (and Curbside if you want). Prep time 20 min stays.
2. **Ordering tools → My website → "I want to use my existing website"** → enter `https://pppmtl.com` → Continue →
   Publish. Copy the online-ordering link Clover shows (it looks like `https://www.clover.com/online-ordering/…`).
3. **Printing** (on the Station Duo): *Setup app → Online ordering → Settings* → "Remote firing device" = the Station
   Duo, "Remote firing printer" = the kitchen printer, expo receipt on. Dashboard *Settings → View all settings → Order
   receipts* → tick "Order note". Device *Setup → Order receipts & sticky labels* → "Customer information enabled".
   [Help](https://www.clover.com/en-CA/help/olo-manage-order-printing)
4. **KDS** (only if you buy one): set it as the order printer of the firing device and route the kitchen labels to it.
   [Help](https://www.clover.com/en-CA/help/set-up-kds)
5. **Rewards** (loyalty): device or dashboard → Rewards → 2-step setup; choose the rewards and the sign-up bonus.
   [Help](https://www.clover.com/en-CA/help/set-up-rewards-program) · [FAQ](https://www.clover.com/en-CA/help/rewards-program-faqs)

**Food Hub Clover app** (Clover *developer* dashboard → Your Apps → the Food Hub app)
6. *App Settings → Webhooks*: keep the Food Hub URL, tick **Orders** next to Inventory and App, Save. The app already has
   **Orders: Read** (no new permission). If a merchant installed the app before Orders read was granted, it reinstalls
   the app once. Without the webhook (or with a merchant API token instead of the app), the 30-second poller still
   brings the orders.

**pppmtl.com (WordPress)**
7. Pages → Home → add a **Custom HTML** block, paste, replace the link with the one from step 2, Update:

   ```html
   <a href="https://www.clover.com/online-ordering/VOTRE-LIEN" target="_blank" rel="noopener"
      style="display:inline-block;padding:14px 28px;background:#c62828;color:#fff;font-weight:700;font-size:18px;border-radius:8px;text-decoration:none">
     Commander en ligne · Order online</a>
   ```
   Menu too: Appearance → Menus → Custom Links → same URL, text "Commander en ligne" → Add to Menu → Save.

**Food Hub (Coolify environment, once)**
8. `FOODHUB_CLOVER_WEBSITE_BRAND=PPP Pizzeria`, and `FOODHUB_CLOVER_WEBSITE_LOCATION=<code of the PPP kitchen>` if
   several kitchens use the same Clover. Restart.

**Test (5 minutes)**
9. Order a small item on pppmtl.com → Clover prints at the register (and KDS) → the Food Hub `/kitchen` tablet shows it
   within 30 s (at once with the webhook): "Acceptée dans Clover", "Imprimée par Clover". Tap Prête, then
   Remise / terminée. Order again and refund it in Clover → it leaves the Food Hub screen by itself. If the order never
   shows: Clover → Orders → open it, note its "Order type", and set `FOODHUB_CLOVER_WEBSITE_ORDER_TYPES` to that label.

## 5. Coordination
- Task 2 (`reconcile-pr6`): this branch only adds one line each in `lib/foodhub/sync.ts`, the Clover webhook route, the
  pulse route and the cron/watch route. Inbox, retry, recovery and health are untouched.
- Clover App Market listing (`docs/CLOVER_APP_LISTING.md`, Clover Marketplace session): the webhook list gains
  **Orders**, and the Orders permission reason can add "website orders from Clover Online Ordering shown on the kitchen
  screen (read-only)". Left to that session.
