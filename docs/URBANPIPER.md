# Skip and DoorDash through UrbanPiper (no platform API needed)

UrbanPiper already receives the SkipTheDishes and DoorDash orders of the stores linked in Atlas.
Food Hub takes them from UrbanPiper:
- **Order Placed** webhook: the order enters the normal pipeline (Clover order and kitchen ticket, kitchen screen, alerts, money checks).
- **Order Status Change** webhook: cancellations and completions made on the platform or in UrbanPiper are applied to the order.
- **Accept / Ready / Reject** go back to the platform through UrbanPiper's status API, once the UrbanPiper POS API key is set. Until then they stay in Food Hub, and every action says "Not sent".

## Setup (owner)
1. Food Hub → Settings → Platforms & Clover → "Skip and DoorDash through UrbanPiper" → **Show secrets** → copy the webhook address (it contains the token).
2. UrbanPiper Atlas → Settings → **Webhooks** → add that address twice: event **Order Placed** and event **Order Status Change**.
3. Map the stores: the first order of each UrbanPiper store shows as "unmapped". In Food Hub → Stores, link that store id (the UrbanPiper `merchant_ref_id`, e.g. 182304) to the brand, location and Clover merchant.
4. Optional, so that accept/ready are sent: ask `pos.support@urbanpiper.com` for a POS API username + key. Put them in the host settings as `URBANPIPER_USERNAME` and `URBANPIPER_API_KEY`.

## Settings
| Variable | Default | Meaning |
|---|---|---|
| `FOODHUB_VIA_URBANPIPER` | `skip,doordash` | Platforms taken from UrbanPiper. Add `uber_eats` while the direct Uber API is not approved. |
| `URBANPIPER_WEBHOOK_SECRET` | generated | Token in the webhook address. |
| `URBANPIPER_USERNAME`, `URBANPIPER_API_KEY` | — | POS API key, used for status updates. |
| `URBANPIPER_POS_API_URL` | `https://pos-int.urbanpiper.com` | Status API base URL. |

## Do not double up
Do not also connect the same platform directly to Clover (Clover ↔ DoorDash) **and** through UrbanPiper. Each order would arrive twice. Pick one path per platform:
- DoorDash: through Clover (`FOODHUB_VIA_CLOVER=doordash`) **or** through UrbanPiper (`FOODHUB_VIA_URBANPIPER`), not both.

Reference: api-docs.urbanpiper.com/downstream (Order Relay, Order Status Update, Authentication).
