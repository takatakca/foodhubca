# Food Hub → Takatak MEV (QCMEV): Revenu Québec invoices

Status: built in Food Hub, **off by default**, tested against a stand-in of QCMEV only (unit tests and
`npm run verify:foodhub`). Takatak MEV (repository `takatakca/QCMEV.CA`) is **not certified** by Revenu Québec yet: run it
in SIMULATOR or DEV only until the certification and the production authorization exist. Nothing here is legal advice.

This file is public. It never holds a file number, a GST/QST number, a device id issued by Revenu Québec, an
authorization code, a key or a secret. Those live only in QCMEV's own per-location configuration and in the server
environment.

## 1. Roles

- **Takatak MEV (QCMEV)** is the SEV in remote-server mode. It alone numbers the transactions, signs them, sends them
  to MEV-WEB and lays out the invoice (80 mm text, QR code, mentions).
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
corrected receipt `{saleKey}:r{n}` (it carries `replacesSaleKey`), credit note `{saleKey}:cn:1`, copies
`{saleKey}:pr:{rpr|dup}{n}`. Same key + same body → QCMEV replays its answer; same key + another body → 409, which
Food Hub never causes on purpose (a change after a receipt is always credit note + corrected receipt).

## 5. Mapping rules (lib/foodhub/mev/map.ts)

- Money in integer cents. Items: `totalCents = quantity × unitPriceCents`; each option is its own item (same tax
  code). `amounts.subtotalCents` (avantTax) = items + options + the restaurant's own delivery fee (LVR only) + service
  fee − the restaurant-funded discount. GST = round(base × 5 %) and QST = round(base × 9.975 %), each rounded half-up on
  its own (the same cents as Clover's Hosted Checkout). `totalCents` (apresTax) = subtotal + GST + QST exactly.
- When a platform's subtotal is not the sum of its lines, the receipt still adds up: a missing amount becomes the item
  « ÉCART DE PRIX », an extra amount is counted with the discount.
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
- Never sent: the Too Good To Go daily bag log (recorded « skipped »), dry-run (phone simulator) orders, kitchens whose
  system of record is not `qcmev`, orders cancelled before their sale was sent.
- Line tax code from the menu: `MenuItem.mevTax` (FP default, F, P, NON), editable in the menu editor.

## 6. Never lose an invoice (lib/foodhub/mev/outbox.ts)

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

Revenu Québec's limit is 48 hours. The Watchtower opens « Facture Revenu Québec en attente » at 15 minutes pending
(critical at 24 h) and for every job that needs a person. QCMEV alerts on its own side from 6 h.

## 7. What the order keeps and prints

- `order.mev` (platform orders: inside the order timeline, merged safely; own orders: on the order document): status,
  sale key, `noTrans`, `datTrans`, MEV number, QR image (QCMEV's SVG or PNG as a data URL, shown in an `<img>` so it
  cannot run anything), the QR link, mentions, `text80mm`, `renderHash`, credit notes and copies. No identity number.
- 80 mm ticket (`/ticket/{id}`, and `/ticket/direct/{id}` for own orders): QCMEV's lines exactly, with its QR where the
  receipt says « [CODE QR] ». While the invoice is not issued: « FACTURE À VENIR / NE PAS REMETTRE AU CLIENT ».
  `?copy=DUP` prints the merchant copy, `?copy=RPR` the reprint.
- Electronic copy: `/r/{token}` (public, the secret token is the credential, no customer data), with « Consulter la
  transaction en ligne » under the QR. Platform orders get the paper copy in the bag (their contact is masked).
- Console: a badge on the order lists, a « Facture (MEV) » panel in the order drawer (preview, Reprint RPR, Merchant
  copy DUP, Send again), and Settings → Add-ons → MEV invoices (switches, kitchens, queue).

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
