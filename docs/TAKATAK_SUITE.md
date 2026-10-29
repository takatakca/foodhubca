# TAKATAK Suite: nine Clover apps, one SaaS, each one independent

_2026-10-28 · owner's order: "build all these solutions together like one SaaS working together, but each can be
independent". The nine Clover App Market repos (a "4" in the name) were created empty on GitHub; this file is the
contract each of them is built against. Food Hub's side is built (lib/foodhub/suite/, tests/takatak-suite.test.ts)._

## 1. The model in five rules

1. **Each app stands alone.** Its own repo, own Clover app (App ID, listing, price, merchant OAuth tokens), own
   database, own screen in Clover. A merchant can install just one and it works fully, reading Clover with its own token.
2. **Together through Food Hub.** When the merchant also runs Food Hub, the app is "connected": Food Hub sends it
   signed events (orders as they happen) and passes events between apps (LOY4LTY awards points → REW4RD hears it).
   Apps never call each other directly and never share a database. Remove one app: the others keep working.
3. **The merchant is the key.** Every app keys its data by the **Clover merchant ID** (`cloverMerchantId` in events).
   That is how nine separate apps know they are talking about the same restaurant.
4. **No named customer data moves.** Events carry what was ordered, where, when and how much, never a customer's name,
   phone, email or address. With `FOODHUB_SUITE_CUSTOMER_SALT` set, an order with a real phone carries `customerKey`, a
   one-way code that is the same in every app (so loyalty, rewards and messages recognise the same customer) and from
   which no app can get the phone back. An app that needs to text a customer asks the customer itself (opt-in).
5. **One way in for each order.** An app that *takes* orders (T4CTILE kiosk) creates them in **Clover** (Food Hub reads
   them from Clover) or sends them to Food Hub's **Order Relay**, never both, or the kitchen gets the order twice.

## 2. One dashboard

- **Food Hub → Settings → Connected apps**: the nine apps, connected or not, events sent, waiting, failed.
- Each app keeps its own screen (in Clover and on the web) for its own work, so it also sells alone.
- Company-level accounts and agency billing stay in TAKATAK V1 (`docs/FOOD_ECOSYSTEM_MAP.md`). Each app's merchant
  subscription is billed by Clover, like Food Hub and TAKATAK Phone AI today. A bundle price is an owner decision.

## 3. The nine apps (built 2026-10-28, each in its own repo, PR #1 open)

Each repo is a working Next.js 16 app on the same kit (Clover OAuth v2 with sealed tokens, webhooks, PostgreSQL,
tiers from the Clover plan name, Food Hub link at `<APP_BASE_URL>/api/suite/events`, Dockerfile for Coolify).
Owner steps for each: its `DEPLOY.md` § 5. Prices: Base 50 $ · Premium 100 $ · VIP 150 $ per month, billed by Clover.

| Repo | Clover App ID | Purpose (from its README) | Built | PR |
|---|---|---|---|---|
| **C4ISSE** | `VDV7XAH5TPB78` | Register layer next to the Clover Register; Picture Register is its photo module (not a separate app) | menu + photos API, cart → Clover order, day report, cash drawer (VIP) | [C4ISSE#1](https://github.com/takatakca/C4ISSE/pull/1) |
| **T4CTILE** | `SFH7X57N3B5FJ` | Touch ordering + self-service kiosk | web kiosk `/kiosk`, Clover order + kitchen print, ready screen from Food Hub | [T4CTILE#1](https://github.com/takatakca/T4CTILE/pull/1) |
| **4CCOUNTING** | `VQTZE8C31D8MW` | Accounting: sales, GST/QST, tips, tenders | day books, GST/QST split, CSV, platform sales from Food Hub | [4CCOUNTING#1](https://github.com/takatakca/4CCOUNTING/pull/1) |
| **TR4CKER** | `EB2EPCWEJBZ82` | Live tracking of our own deliveries, tip + review | courier / customer links, positions, review routing, Food Hub direct orders | [TR4CKER#1](https://github.com/takatakca/TR4CKER/pull/1) |
| **ST4FF** | `E0BGTY752BZYE` | Schedules, time clock, labour cost | hours from Clover shifts, wages, labour %, planned shifts | [ST4FF#1](https://github.com/takatakca/ST4FF/pull/1) |
| **M4RKETING** | `EQRZ028619JRW` | Promotions, customer segments, campaigns | segments, Clover discounts "M4 · …", approved campaigns, consent-only export | [M4RKETING#1](https://github.com/takatakca/M4RKETING/pull/1) |
| **LOY4LTY** | `WX0Y6313JX1TY` | Loyalty by phone | points from confirmed Clover payments, redeem as order discount | [LOY4LTY#1](https://github.com/takatakca/LOY4LTY/pull/1) |
| **REW4RDS** (repo REW4RD) | `239362NZSVFSC` | Gift cards | hashed codes, partial redemption, reloads, liability, Clover tender | [REW4RD#1](https://github.com/takatakca/REW4RD/pull/1) |
| **CH4T** | `RGE4PFGC9SR7C` | Support; **no sending** until Pierre grants an exception | internal threads with Clover context, templates | [CH4T#1](https://github.com/takatakca/CH4T/pull/1) |

Between the apps, the customer is recognised by phone inside one merchant: LOY4LTY and REW4RDS events carry
`customerRef = sha256("<merchantId>:<phone>")`, never the phone. Food Hub's `customerKey` (platform orders) is a
different, salted key: platform orders rarely have a real phone, so the two are not joined.

What still needs native Android work (Android Studio, outside this container): C4ISSE's counter app and T4CTILE's
on-device payment (Clover Payments API). Their server APIs are ready (device keys).

## 4. Connecting an app (server variables only, never in git)

| Where | Name | Value |
|---|---|---|
| Food Hub (Coolify) | `FOODHUB_SUITE_<APP>_URL` | https address where the app receives events, e.g. `FOODHUB_SUITE_LOY4LTY_URL` |
| Food Hub | `FOODHUB_SUITE_<APP>_SECRET` | 32+ random characters (`openssl rand -hex 32`), one per app |
| Food Hub (optional) | `FOODHUB_SUITE_<APP>_EVENTS` | comma list to override the default events |
| Food Hub (optional) | `FOODHUB_SUITE_CUSTOMER_SALT` | 16+ characters; turns on `customerKey` |
| The app | `FOODHUB_URL` + the same secret | to verify events and to sign its calls |

`<APP>` = `C4ISSE`, `T4CTILE`, `4CCOUNTING`, `TR4CKER`, `ST4FF`, `M4RKETING`, `LOY4LTY`, `REW4RD`, `CH4T`.
The app's address for `FOODHUB_SUITE_<APP>_URL` is `https://<app host>/api/suite/events`.
Without the two variables an app is simply not connected; nothing is sent and nothing changes in Food Hub.

## 5. Food Hub → app: events

`POST <FOODHUB_SUITE_<APP>_URL>` with headers `X-Takatak-Signature`, `X-Takatak-App: foodhub`, `X-Takatak-Event`, body:

```json
{ "id": "ord_<orderId>_completed", "type": "order.status_changed", "createdAt": "2026-10-28T20:00:00.000Z", "source": "foodhub",
  "data": { "previousStatus": "ready", "order": {
    "orderId": "…", "channel": "uber_eats", "displayId": "A1B2", "brandName": "Po Poulet", "locationCode": "SAINT_LEONARD",
    "cloverMerchantId": "…", "cloverOrderId": "…", "status": "completed", "fulfillment": "pickup", "placedAt": "…", "readyBy": null,
    "currency": "CAD", "subtotal": 20, "tax": 3, "deliveryFee": 0, "tip": 2, "discount": 0, "total": 25,
    "lines": [{ "name": "Poulet", "quantity": 1, "unitPrice": 20, "total": 20, "cloverItemId": "…" }],
    "customerKey": "9f1c…" } } }
```

- Types: `order.created`, `order.status_changed` (statuses `new`, `accepted`, `ready`, `dispatched`, `completed`,
  `cancelled`, `failed`), `app.event` (`data = { type, data }`, `source` = the app that sent it).
- **Answer 2xx fast** (store, then work). Anything else is retried with backoff (30 s → 1 h) about 12 times, then marked
  failed in Settings → Connected apps and the activity log.
- **Ignore repeats by `id`.** The same change always has the same id.
- On first connection Food Hub does not replay history: read it with `GET /api/suite/v1/orders`.

## 6. App → Food Hub

Every call carries `X-Takatak-App: <app key, lower case>` and `X-Takatak-Signature` (body for POST, path + query for GET).

| Call | What |
|---|---|
| `GET /api/suite/v1/ping` | Setup check: app name, events, server time. |
| `GET /api/suite/v1/orders?since=<ISO>&limit=<1..500>` | Catch-up, same order shape, at most 7 days back. |
| `POST /api/suite/v1/events` `{ "id", "type": "<app>.<name>", "data" }` | Tell the other apps (e.g. `loy4lty.points_awarded`). 64 KB max; each id once. |

## 7. Signature (both directions)

`X-Takatak-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<payload>")>`, refused after 5 minutes.

```js
// In the app (Node): verify an event from Food Hub
import crypto from 'node:crypto';
export function verify(secret, header, rawBody) {
  const p = Object.fromEntries(String(header).split(',').map((s) => s.trim().split('=')));
  const t = Number(p.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return p.v1?.length === want.length && crypto.timingSafeEqual(Buffer.from(p.v1), Buffer.from(want));
}
// Sign a call to Food Hub: same HMAC over the body (POST) or "/api/suite/v1/orders?since=…" (GET).
export const sign = (secret, payload) => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`; };
```

## 8. Rules for every app repo

- Public repos: never commit secrets, `.env` values, merchant data, customer data (`CLAUDE.md` § 4 of Food Hub applies).
- Brand: `BRAND.md` (electric blue on deep navy). French and English everywhere.
- Same agent rules as the other repos: `AGENTS.md` + `WORKLOG.md`, one task one branch, only the owner merges to `main`.
- Po Poulet NDG (DoorDash 27982486) is never touched by any app.

## 9. Food Hub side (built)

`lib/foodhub/suite/apps.ts` (registry + config), `sign.ts`, `auth.ts`, `bus.ts` (change watch, outbox, delivery, app
events), routes `app/api/suite/v1/{ping,orders,events}`, `app/api/foodhub/suite` (admin), page Settings → Connected apps,
tick in `instrumentation.ts` and `/api/foodhub/cron/watch`. The bus only reads orders: it never changes one and never
blocks the order pipeline.
