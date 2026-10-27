# Food Hub → Takatak MEV (QCMEV): Revenu Québec invoices

Status: built in Food Hub, **off by default**, tested against a stand-in of QCMEV only (unit tests and
`npm run verify:foodhub`). Takatak MEV (repository `takatakca/QCMEV.CA`) is **not certified** by Revenu Québec yet: run it
in SIMULATOR or DEV only until the certification and the production authorization exist. Nothing here is legal advice.

This file is public. It never holds a file number, a GST/QST number, a device id issued by Revenu Québec, an
authorization code, a key or a secret. Those live only in QCMEV's own per-location configuration and in the server
environment.

## 1. Roles

- **Takatak MEV (QCMEV)** is the SEV, in mode SEV (SW-76 §4.1.2: it creates, numbers and signs every transaction and
  sends it to MEV-WEB itself; it is not a forwarding « serveur distant »). It alone lays out the invoice (80 mm text,
  QR code, mentions) in Revenu Québec's published order.
- **Food Hub** takes the orders (Uber Eats, DoorDash, Skip, Too Good To Go relay, phone, website, storefront) like a
  terminal of that SEV. It never signs, never talks to Revenu Québec, and prints only the exact lines QCMEV returns.
- Because Food Hub takes the orders, it must be declared inside the certified product's scope (owner decision).

## 2. The switches (all must say yes)

| Setting | Values | Default | Where |
|---|---|---|---|
| `FOODHUB_MEV` | `off` · `shadow` (map and check, no call) · `simulator` (training sales, modTrans FOR) · `on` (production) | `off` | server env |
| Owner switch « Factures Revenu Québec (MEV) » | on / off; `FOODHUB_FEATURE_MEV=on|off` overrides it | off | Settings → Add-ons → Switches |
| `FOODHUB_MEV_LOCATIONS` | comma list of kitchen codes allowed to send | empty = none | server env |
| System of record, per kitchen | `none` · `qcmev` (Takatak MEV) · `clover_app` (the Clover MEV app) | `none` | Settings → Add-ons → MEV invoices |
| `FOODHUB_MEV_TRIGGER` | `accept` · `ready` (when a platform order becomes a sale) | `accept` | server env |
| `FOODHUB_MEV_URL` | QCMEV base URL on the internal network, e.g. `http://qcmev-backend:3001` | — | server env |
| `FOODHUB_MEV_SECRET` | HMAC key shared with QCMEV, 32+ random characters (`openssl rand -hex 32`) | — | server env only |
| `FOODHUB_MEV_TIMEOUT_MS` | per request | `8000` | server env |
| `FOODHUB_MEV_RETRY_S` | seconds between attempts; the last value repeats | `15,60,300` | server env |
| `FOODHUB_MEV_OFFLINE_POLL_S` | how often an offline receipt is read again | `300` | server env |
| `FOODHUB_MEV_USER` | `auto` (always `FOODHUB-AUTO`) · `staff` (the person who accepted, once registered in QCMEV) | `auto` | server env |
| `FOODHUB_MEV_CLOVER_NOTE` | `on` writes « Facture n° … : voir facture imprimée » as the Clover order note (replaces that note) | off | server env |
| `FOODHUB_MEV_SEND_RECEIPT` | `on` texts / e-mails the receipt link of an own order that gave a contact | off | server env |

Switching the owner switch off (or removing a kitchen from the list) stops **new** sales only: an order that already
has a receipt still gets its credit note or corrected receipt, and sales already in the outbox still go out (they are
owed: their invoice is due at payment). Only `FOODHUB_MEV=off` stops everything.

`on` is refused unless QCMEV's `GET /health` answers `environment=PROD` and `certified=true`. `simulator` is refused
when QCMEV answers `PROD`: training sales never reach a production SEV. With `FOODHUB_MEV=off` Food Hub does not even
read the other settings.

## 3. Transport and signature

Internal network only (Coolify), no public port. Prefix `/api/v1/integrations/foodhub`.

Headers on every call: `Content-Type: application/json`, `X-Integration-Id: foodhub`, `X-Tenant-Id` (Food Hub's
tenant slug), `X-Event-Id`, `X-Timestamp` (Unix **milliseconds**; QCMEV also accepts seconds), `Idempotency-Key`
(the sale, credit or print key), `X-Signature: sha256=hex(HMAC_SHA256(secret, "<ts>.<eventId>.<raw body>"))` — the
same HMAC as `lib/foodhub/tenant.ts`. `X-Event-Id = sha256(key + payloadHash)`, so a retry is byte-for-byte the same
request. No staff session rides on these calls.

## 4. Calls

| Call | When |
|---|---|
| `POST /sales` (foodhub.sale.v1) | a platform order is accepted (or ready), a Skip order goes to the tablet, an own order is paid online or paid / handed over at the counter |
| `POST /sales/{saleKey}/credit-notes` (foodhub.credit.v1, `full: true`, amounts as magnitudes) | cancelled after its receipt; or its content changed after the receipt (then a corrected sale follows) |
| `POST /sales/{saleKey}/prints` (foodhub.print.v1, `RPR` or `DUP`) | Reprint / Merchant copy buttons on the order |
| `GET /sales/{saleKey}` | an offline receipt is read again until MEV-WEB numbered it |
| `GET /health` | Settings, and before sending in `simulator` / `on` (cached 60 s) |

Keys: `saleKey = fh:{tenant}:{stored|direct}:{channel}:{order id}` (characters `A-Z a-z 0-9 . _ # -` and `:`),
corrected receipt `{saleKey}:r{n}` (it carries `referenceSaleKey`), credit note `{saleKey}:cn:1`, copies
`{saleKey}:pr:{rpr|dup}{n}`. Same key + same body → QCMEV replays its answer; same key + another body → 409, which
Food Hub never causes on purpose (a change after a receipt is always credit note + corrected receipt).

## 5. Mapping rules (lib/foodhub/mev/map.ts)

- Money in integer cents. Items: `totalCents = quantity × unitPriceCents`; each option is its own item (same tax
  code). `amounts.subtotalCents` (avantTax) = items + options + the restaurant's own delivery fee (LVR only) + service
  fee − the restaurant-funded discount. GST = round(base × 5 %) and QST = round(base × 9.975 %), each rounded half-up on
  its own (the same cents as Clover's Hosted Checkout). `totalCents` (apresTax) = subtotal + GST + QST exactly.
- **Nothing is invented.** The items are the receipt. When a platform's subtotal differs from the sum of its lines by
  more than 2 cents, when an item (or a paid option) has no name, or when the order has no item, the sale is **held for
  a person** (status « Facture à vérifier », reason `amounts_mismatch` / `description_missing` / `no_lines`, a
  Watchtower alert); it is never sent with an « ÉCART », « COMMANDE », « Article », « Option » or « divers » line, and a
  « Rabais » is only a discount the restaurant really gave (Revenu Québec, « Description détaillée »). Fixing the order
  (or « Renvoyer ») maps it again; it goes out as soon as the numbers agree. A 1–2 cent rounding gap: the lines are the
  receipt (`subtotalRounded`).
- Skip (JET Connect): item prices are **before tax** — every example in JET's API shows `items_in_cart.inc_tax − tax` =
  the items (e.g. Skip « Delivery by restaurant »: Cheesy Pasta 500, inc_tax 600, tax 100). A Skip tablet order (tax 0
  in the feed) therefore gets its tax computed on top. A Skip order whose items add up to the tax-included total is
  held (it does not follow JET's documented shape), never printed with a « Rabais » equal to the tax.
- Too Good To Go shows its price **taxes included** and sends no tax: each item's pre-tax price is worked out
  (5,99 $ → 5,21 $ + TPS 0,26 $ + TVQ 0,52 $), flagged `taxIncluded`.
- When the platform charged one combined tax that differs from the computed split by more than 1 cent, its tax is
  split instead and flagged `taxGap`. A Skip order handed to the tablet (tax 0 in the feed) gets its tax computed
  (`taxComputed`). DoorDash orders whose tax DoorDash remits keep the tax as charged.
- Platform orders → `LVT` (mention « COMMANDE PAR UNE PLATEFORME NUMÉRIQUE »), payment `AUT` collected by the platform
  (SPEC), no tip (pourb), no platform delivery or service fee, only the restaurant-funded part of a promotion.
- Own orders: delivery → `LVR` (with the delivery fee), pickup → `CMP`. Paid online (payment link, website,
  storefront, Clover Online Ordering) → e-commerce, card (`CRE`). Paid at the counter → the Clover tender (cash `ARG`,
  debit `DEB`, credit `CRE`, gift card `CPR`, several `MIX`); when Clover's payment cannot be read, the sale **waits**
  and the order shows « Payée par : » buttons — it is never sent as `INC`. The tip of an own order is its pourb.
- $0 → `AUC`. Simulator mode → `testMode: true` (modTrans FOR).
- Too Good To Go: **each bag is its own `LVT` sale, printed when the customer takes it** (« Remise de la facture –
  restauration »: the invoice is handed over right after payment; « Transmission des renseignements exigés »: each sale is
  sent « sans délai »). Two ways, both normal platform sales (`PAP`, mention « COMMANDE PAR UNE PLATEFORME NUMÉRIQUE »,
  price taxes included → pre-tax worked out):
  - a per-order feed: TGTG reservation e-mails (or Deliverect) → one order per reservation, its invoice prints with the
    kitchen ticket and the bag labels;
  - **« Sac remis »** (Money → Too Good To Go, only on a Takatak MEV kitchen): staff tap it when a customer takes their
    bag → one order (`tgtg-pickup-…`, completed), recorded by QCMEV before the answer (up to 8 s) and its invoice opens to
    print once. With the reservation code, a reservation already read from an e-mail prints that order's invoice instead
    (never a second sale; a paper already printed with the kitchen ticket is not printed again), and the same code twice
    is the same sale. The order id is the code (`tgtg-pickup-CODE`): a TGTG e-mail read later for that reservation is a
    `duplicate` (no second order, ticket or invoice). When TGTG e-mails are read for that kitchen (switch on and a store
    mapped to it), the code is **required**, so a reservation already received never becomes a second sale. A bag whose
    invoice is not out yet stays on the list, read again every 10 s, with « Imprimer la facture » as soon as it is issued.
- The Too Good To Go **daily bag count** (Money → Too Good To Go, « Enregistrer la journée ») is **never a sale**
  (`log_order`): it is typed after the day, for many customers at once, with nobody left to hand an invoice to. It stays
  Food Hub's report (sales, analytics, payouts). On a Takatak MEV kitchen the screen says so, each day shows how many bags
  had their own invoice, and bags sold without one are flagged « N sans facture » (activity `tgtg_bags_without_invoice`).
  Food Hub does not turn them into a late combined sale: that would not be an invoice per meal either. Bags handed over
  one by one are their own sales, so the day's log order counts only the **other** bags (3 sold, 1 « Sac remis » → the
  log counts 2), also when the bag is handed over after the day was logged: the reports never count a bag twice.
- Never sent: dry-run (phone simulator) orders, the Too Good To Go daily bag count, kitchens whose system of record is
  not `qcmev`, orders cancelled before their sale was sent, sales held for a person.
- Line tax code from the menu: `MenuItem.mevTax` (FP default, F, P, NON), editable in the menu editor.

## 6. Never lose a sale (lib/foodhub/mev/outbox.ts)

Every sale, credit note and copy is first written to the outbox (`fh_docs` collection `mev_outbox`), then sent.
Statuses `pending → sending → done | needs_human | skipped`; random claim + re-read, 90 s expiry. Runs right after a
job is written, from the Watchtower timer (every 30 s, through the order recovery) and from `/api/foodhub/cron/watch`.

| QCMEV answers | Food Hub does |
|---|---|
| 200 accepted | done; the receipt goes on the order |
| 200 offline_pending | done with QCMEV's offline receipt (local QR); read again until MEV-WEB numbers it |
| 200 rejected | needs a person (red badge, « Renvoyer ») |
| 202 queued | waits `retryAfterS` |
| 400 / 422 / 401 / 403 / 409 | needs a person (activity log) |
| 423 location not ready | waits 5 min, alert |
| 429 / 5xx / time-out / network | retries on `FOODHUB_MEV_RETRY_S` with the same key and body |

**A sale still in Food Hub's outbox has no invoice.** Takatak MEV has not recorded it, so nothing can be handed to the
customer, and the invoice is due right after payment. Revenu Québec's 48 hours (« Problème de communication ») only cover
sales the SEV has **already recorded and stored** while MEV-WEB cannot be reached: here, a job `done` with an
`offline_pending` receipt, which QCMEV signed and printed (« PROBLÈME DE COMMUNICATION »), sends later and alerts on from
6 h. They never cover a sale the SEV has not seen. So the Watchtower opens « Facture Revenu Québec en attente »:

| Job | Alert |
|---|---|
| sale or credit note waiting (QCMEV silent, 202 queued, 423, 5xx, not certified…) | critical after **1 minute** |
| sale waiting for its tender (pay at pickup) | critical at once |
| sale or credit note held for a person (rejected, amounts_mismatch, description_missing, no_lines) | critical at once |
| copy (RPR / DUP) waiting | warning after 15 minutes (held for a person: warning) |
| receipt signed offline by QCMEV (`offline_pending`) | none in Food Hub (QCMEV's 48 h side) |

The alert says it plainly: no invoice exists yet, keep the bag until it is out, restart Takatak MEV now; a bag that left
without its invoice will not get it (the sale is still recorded, late, as soon as QCMEV answers).

**When Takatak MEV itself cannot be reached.** Food Hub is a terminal of the SEV: SW-76 §2 (« Terminal ») says every
action on a terminal is completed by the SEV, including the printing. Revenu Québec's offline mode (SW-76 §4.1.1) is
the SEV's mode when MEV-WEB cannot be reached — QCMEV has it (it signs, prints « PROBLÈME DE COMMUNICATION » and sends
the batch later). If the SEV itself is down, no terminal can make an invoice, and Food Hub must never make one itself:
the ticket says « FACTURE À VENIR / NE PAS REMETTRE AU CLIENT », the sale waits in the outbox with the same key, and the
invoice is printed from the order (« Imprimer la facture ») as soon as QCMEV answers. That is not « nothing lost »: a
customer whose bag leaves meanwhile never gets that invoice. So QCMEV runs **next to** Food Hub, on the same Coolify
server and internal network (no internet hop between the terminal and its SEV), the ticket says « Garder le sac :
imprimer la facture dès qu'elle sort et la joindre », and the alert above calls a person after one minute. A
pay-at-pickup order needs its payment mode before the invoice: Clover's tender is read automatically; when it cannot be
read, staff tap « Payée par : » when they take the payment.

QCMEV's `CONTRACT.md` §8 still says « Food Hub alerts at 15 minutes pending »: Food Hub is stricter on purpose (1 minute,
critical, for a sale or credit note), because a sale QCMEV has not recorded has no invoice at all.

## 7. What the order keeps and prints

- `order.mev` (platform orders: inside the order timeline, merged safely; own orders: on the order document): status,
  sale key, `noTrans`, `datTrans`, MEV number, QR image (QCMEV's SVG or PNG as a data URL, shown in an `<img>` so it
  cannot run anything), the QR link, mentions, `text80mm`, `renderHash`, credit notes and copies. No identity number.
- 80 mm ticket (`/ticket/{id}`, and `/ticket/direct/{id}` for own orders): when Takatak MEV issues the order's invoice,
  the ticket carries **no amount of its own** (no Food Hub subtotal, taxes, platform delivery fee, courier tip or
  platform total): the kitchen part (items, options, notes) and QCMEV's invoice, its lines exactly, the QR on the
  « [CODE QR] » line, 42 columns at 2,5 mm (they fit the 64 mm of paper; the font shrinks if a printer's font is wider).
  While the invoice is not issued: « FACTURE À VENIR / NE PAS REMETTRE AU CLIENT / Garder le sac : imprimer la facture
  dès qu’elle sort et la joindre ».
- **Printed once** (Revenu Québec, « Modes d'impression »: an invoice or credit note is printed or sent once; any other
  copy is a reproduction or a duplicate made by the SEV). The first ticket that prints a document claims it
  (`POST /api/foodhub/mev/orders/{id}/print`, kept apart from the order); every later ticket shows « FACTURE DÉJÀ
  IMPRIMÉE le … — Autre copie : « Réimprimer (RPR) » ». « Réimprimer (RPR) » asks Takatak MEV for a transmitted
  reproduction, then « Imprimer la reproduction » prints it, once; the same for the merchant copy (DUP).
  `?autoprint=0` is a preview: the invoice shows on screen and prints as « APERÇU — PAS UNE FACTURE ».
- Electronic invoice: `/r/{token}` only for an electronic receipt (`ELE`, or `PEL` when the customer ordered online
  with a contact): QCMEV's electronic document, the QR inside the block and « Consulter la transaction en ligne » right
  under it, « Copie électronique » on PEL, kept as it was sent. A paper receipt (platform orders: their contact is
  masked, the paper goes in the bag) has no public copy.
- Corrected receipt (credit note + new receipt after a change): QCMEV prints « Facture corrigée ».
- Console: a badge on the order lists, a « Facture (MEV) » panel in the order drawer (preview, « Imprimer la facture
  (une fois) », when it was printed, Reprint RPR, Merchant copy DUP, print each copy once, Send again), and Settings →
  Add-ons → MEV invoices (switches, kitchens, queue).

## 8. How it is tested

- `tests/mev-map.test.ts`: rounding (same cents as Clover for every base up to 300 $), the 23:30 civil date in summer
  and winter, one fixture per channel checked against QCMEV's own contract rules, keys, hashes, credit notes, tenders.
- `tests/mev-outbox.test.ts`: off = no call and nothing written; each switch alone says no; one receipt per order; credit
  note on cancel; credit + corrected receipt on a change; QCMEV down then up (same key, body, event id: one invoice);
  MEV-WEB down (offline receipt, then numbered); shadow mode; tender unknown then chosen; Watchtower alerts.
- `npm run verify:foodhub` section 48 (`scripts/e2e/mev-scenarios.mjs` against `scripts/e2e/mock-qcmev.mjs`): the whole
  suite first runs with the owner switch off (zero calls), then S1–S11 end to end through the real app.

What this does **not** prove: conformity with Revenu Québec. That needs the SW-73 / SW-77 documents and Revenu Québec's
DEV and ESSAI environments with the partner credentials, on the QCMEV side.

## 9. Turning it on (owner)

1. Run QCMEV on the same Coolify network with `MEV_ENVIRONMENT=SIMULATOR` (or DEV) and `QCMEV_FOODHUB_ENABLED=true`;
   map each kitchen to its operator and device in QCMEV; register `FOODHUB-AUTO`.
2. Food Hub env: `FOODHUB_MEV=simulator`, `FOODHUB_MEV_URL`, `FOODHUB_MEV_SECRET` (the same value as QCMEV's `QCMEV_FOODHUB_SECRET`),
   `FOODHUB_MEV_LOCATIONS=<kitchen codes>`.
3. Settings → Add-ons → Switches: turn on « Factures Revenu Québec (MEV) ». Settings → Add-ons → MEV invoices: choose
   « Takatak MEV » for the kitchen, then « Vérifier Takatak MEV ».
4. Production only after Revenu Québec certifies the product: QCMEV in PROD with its certification number, then
   `FOODHUB_MEV=on`.

## 10. Clover register sales (`FOODHUB_MEV_CLOVER_REGISTER=on`)

What staff ring up **on the restaurant's own Clover register** gets its Revenu Québec invoice from Takatak MEV too, through
the same outbox, keys and reconciliation as every other sale (`lib/foodhub/mev/clover-register.ts`). Off by default;
on, it still needs every switch of § 2 for the kitchen.

- **Which Clover orders.** Only the ones nothing else in Food Hub invoices: not Food Hub's own (platform orders it pushed
  to Clover, its phone / website orders, known Clover ids and titles), not a delivery platform's, not an online order
  (Clover Online Ordering type, the brand website's « Site web » mark). What is left was rung up at the register.
- **When.** Once Clover says the order is paid (an open tab is not a sale). Whole order refunded, voided or deleted →
  full credit note. Items refunded in Clover → credit note + corrected receipt naming the original. Refunded by an
  amount only → the old receipt is credited and the corrected one **waits for a person** (it would have to invent which
  items).
- **Sources.** The Clover webhook's Orders events (the Food Hub app's webhook already receives them) and a catch-up
  poll of orders modified since the last run, every `FOODHUB_MEV_CLOVER_REGISTER_POLL_S` (60 s), from the live pulse
  and the cron. One record per Clover order (`mev_pos:<id>`): a sale is found again after a missed webhook, never twice.
- **Kitchen.** The kitchen whose stores use that Clover merchant; when one merchant serves several kitchens,
  `FOODHUB_MEV_REGISTER_LOCATION` must name it (one code, or JSON per merchant). Food Hub never guesses the SEV device:
  without it, nothing is invoiced and the activity log says so (`mev_register_unplaced`, at most once an hour).
- **Mapping** (`toMevSaleFromRegister`, model `pos`, channel `clover_pos` — QCMEV's CONTRACT.md accepts both).
  - The Clover lines are the items (refunded lines left out; options as their own items; tax codes from the menu's
    `mevTax`, FP by default).
  - Money from Clover's payments minus its refunds, in cents: `amount` (taxes included, no tip), `taxAmount`,
    `tipAmount`. Pre-tax = amount − tax.
  - Items − pre-tax within 2 cents: the items are the receipt. More, with a Clover discount on the order or a line:
    that difference is the restaurant's discount. Anything else waits for a person (`amounts_mismatch`).
  - TPS + TVQ of the receipt must equal Clover's tax within 1 cent; otherwise a tax rate in Clover is wrong (the stray
    « Sales Tax » found on our own merchants is the known case) and the sale **waits for a person**: never sent with a
    tax the customer was not charged.
  - Tender from Clover: cash `ARG` (collected `cash`), debit `DEB`, credit `CRE`, gift card `CPR`, several `MIX`, a tender
    Clover names otherwise `AUT`, $0 `AUC`. Tip → `pourb`. Service: `TBL` when the order type says table
    (`FOODHUB_MEV_REGISTER_TABLE_TYPES` to name yours), else `CMP`. Paper receipt (`PAP`), printed at the register.
  - A Clover service charge comes as a percentage, not an amount: such a sale waits for a person.
- **Not a Food Hub order.** The record is read only by the MEV pipeline: never on the kitchen screen, the courier
  dispatch or Food Hub's sales reports (Clover already counts these sales).
- **To verify on a real Clover sandbox before use:** that a refund's `amount` excludes its tip like a payment's, the
  exact tender labels of each merchant, and that the Orders webhook fires on payment and refund.
- **Printing the invoice at the register:** Clover's REST API cannot print a QR code. The invoice text and QR are on the
  record (`mev`) for the TAKATAK MEV app on the Clover device to print; until that app is installed, the Clover order
  note can say where the invoice is (`FOODHUB_MEV_CLOVER_NOTE=on`).
- **Before any real restaurant:** this changes what Takatak MEV records, so it belongs in the certified scope (owner
  decision 6 in docs/clover-visual-register/OWNER_DECISIONS.md on the research branch; Revenu Québec's written answer).

