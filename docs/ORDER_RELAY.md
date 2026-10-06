# Food Hub Order Relay

Food Hub's own order intake for partners that **push** orders to you, in place of the UrbanPiper hub. Examples: a
Too Good To Go partner feed, an ordering website, or a delivery partner. Platforms connected directly (Uber Eats and
DoorDash APIs) do not use the relay.

- **Order** payload: the order enters the normal pipeline (Clover order and kitchen ticket, kitchen screen, alerts, money checks).
- **Status** payload: cancellations and completions made on the partner side are applied to the order.
- **Accept / Ready / Reject** are POSTed back to the partner's callback address when one is set. Without one, nothing is
  sent and every action says "Not sent".

## Setup (owner)
1. Food Hub → Settings → Platforms & Clover → "Food Hub Order Relay" → **Show secrets** → copy the relay address (it contains the token).
2. Give that address to the partner. They POST each order to it, and each status change too.
3. Map the stores: the first order of each partner store shows as "unmapped". In Food Hub → Stores, link that store id
   (`order.store.merchant_ref_id`) to the brand, location and Clover merchant.
4. Optional, so that accept / ready / reject are sent back: set `FOODHUB_RELAY_CALLBACK_URL` (and `FOODHUB_RELAY_CALLBACK_TOKEN`
   if the partner wants a Bearer token).

## Settings
| Variable | Default | Meaning |
|---|---|---|
| `FOODHUB_RELAY_CHANNELS` | `skip,tgtg` | Platforms accepted on the relay. Never list a platform that is also connected directly, or each order arrives twice. |
| `FOODHUB_RELAY_SECRET` | generated | Token in the relay address (or an `Authorization` / `X-Api-Key` header). |
| `FOODHUB_RELAY_CALLBACK_URL` | — | Where status changes are POSTed. |
| `FOODHUB_RELAY_CALLBACK_TOKEN` | — | Sent as `Authorization: Bearer <token>` on each callback. |

Callbacks go out only when live connectors are on (`LIVE_CONNECTORS_GLOBAL_ENABLED=true`).

## Payloads (UrbanPiper "Order Relay" compatible)
Order:
```json
{ "order": { "details": { "id": 3444567, "channel": "tgtg", "order_type": "pickup", "created": 1760000000000,
    "order_subtotal": 24, "total_taxes": 3.6, "order_total": 27.6, "brand": { "name": "Po Poulet" },
    "ext_platforms": [{ "id": "TGTG-998877", "name": "tgtg" }] },
  "items": [{ "merchant_id": "clv-1", "title": "Surprise Bag", "quantity": 1, "total": 5.99,
    "options_to_add": [], "options_to_remove": [] }],
  "store": { "merchant_ref_id": "182304" } },
  "customer": { "name": "Ana B." } }
```
Status: `{ "order_id": 3444567, "new_state": "customer_cancelled", "message": "…", "additional_info": { "external_channel": { "name": "tgtg" } } }`

Callback body sent by Food Hub: `{ "order_id", "external_order_id", "channel", "new_status": "Acknowledged" | "Food Ready" | "Cancelled", "message", "reason_code", "extra"? }`.
