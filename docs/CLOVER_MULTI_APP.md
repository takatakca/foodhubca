# Two Clover apps on one backend: Food Hub + the AI phone

The AI phone is sold as its **own** Clover App Market app, priced separately from TAKATAK Food Hub. Both apps run on
this same Food Hub backend (`https://foodhub.on2go.ca`). A merchant can install either one, or both.

| | App 1: TAKATAK Food Hub | App 2: AI phone (default name "TAKATAK Phone") |
|---|---|---|
| Does | Platform orders into Clover, menu sync, kitchen screen, stores | Answers calls (Québec French, English, Spanish), takes the order with the Duo / Trio / Combo upsell, texts a Clover pay link, creates the Clover order, prints the kitchen ticket |
| Installed alone | Works fully | Works fully (reads the menu from Clover with its own token) |
| Installed with the other | Same merchant ID: the phone uses Food Hub's menu, brand lines and stores; phone orders show in Food Hub's order list and kitchen screen | (same) |

Clover has no "app B needs app A" setting. Each app works alone; the phone listing says "Even better with TAKATAK Food Hub".

**Without the phone app's environment variables, nothing changes.** Food Hub keeps its keys, routes, token store and
webhook exactly as before; the phone routes answer 404; the AI phone keeps working for our own restaurants (the gate is
"off").

## Environment variables (names only; values go in Coolify / `npm run setup`, never in git or chat)

Food Hub (unchanged): `CLOVER_CLIENT_ID`, `CLOVER_CLIENT_SECRET`, `CLOVER_WEBHOOK_AUTH`.

Phone app (all optional):

| Name | What |
|---|---|
| `CLOVER_PHONE_APP_ID` | The phone app's Clover App ID (= OAuth client ID). Turns the phone app on for this server. |
| `CLOVER_PHONE_APP_SECRET` | The phone app's App Secret. |
| `CLOVER_PHONE_WEBHOOK_AUTH` | The phone app's webhook auth code (X-Clover-Auth). |
| `CLOVER_PHONE_METERED_ORDER_ID` | Clover ID of the per-order charge ("Phone order / Commande téléphonique"). Empty = never charge per order. |
| `PHONE_OWN_MERCHANTS` | Our own restaurants' Clover merchant IDs, comma-separated: always allowed, never billed. |
| `CLOVER_PHONE_APP_NAME` | Listing name if not "TAKATAK Phone". |

## How the backend keeps the two apps apart

- **Registry:** `lib/foodhub/pos/clover-apps.ts` describes each app (key `foodhub` / `phone`, App ID, secret, webhook
  code, token store, callback, webhook path, events, name).
- **Sign-in (OAuth):** `lib/foodhub/pos/clover-oauth.ts` takes the app as an optional last argument (default Food
  Hub). Phone routes: `/api/foodhub/clover-connect/phone/start` and `/api/foodhub/clover-connect/phone/callback`. The
  "wrong app" check, the owner state and the signed launch state are per app: one app's link is refused by the other.
- **Tokens:** kept per (app, merchant). Food Hub: `clover_oauth_merchants` (old records without `appId` are read as
  before). Phone: `clover_oauth_merchants:phone`, each record stamped with the App ID it was issued for (a record from a
  former phone App ID is ignored). Refresh locks are per (app, merchant).
  Food Hub features use only Food Hub tokens (`cloverToken`, unchanged). Phone features use `phoneCloverToken`: the
  phone token first, then Food Hub's.
- **Webhooks:** `lib/foodhub/pos/clover-webhook-gate.ts` checks each app's own verification key and auth code. Phone
  webhook: `/api/foodhub/webhooks/clover/phone`, **App events only**, so Food Hub's menu and order handlers never run
  twice. Each handler also checks the App ID inside the event.
- **Uninstalling one app** removes only that app's tokens (and, for the phone, its saved subscription status). The phone
  gate then says "not installed": AI lines stop, calls go to the restaurant's own number, no per-order charge. Food
  Hub is not touched. Uninstalling Food Hub leaves the phone app alone.
- **Settings → Clover app → "Clover apps on this server"** lists both apps: keys set or missing (names only), the
  addresses to paste in Clover, webhook state and verification code, and each app's installs (approved / waiting,
  subscription, "both apps"). Waiting phone installs are approved there.
- **Welcome page:** the phone callback lands on `/welcome/clover` with a ticket marked for the phone app (no Food Hub
  set-up steps, no Food Hub test order).

## The gate: `voiceAiEntitled(merchantId, purpose)` (alias `phoneEntitled`)

`lib/foodhub/pos/clover-entitlement.ts`. `purpose` is `'call'` (a live call) or `'setup'` (turning on a line, getting a
number). Answer: `{ ok, reason, billable, status, inTrial, plan, checkedAt, cached }`.

1. Phone app not set on this server → yes (`gate_off`).
2. One of `PHONE_OWN_MERCHANTS` → yes (`own_merchant`), never billed.
3. No phone token → no (`not_installed`); installed but waiting for the owner → no (`pending_approval`).
4. Clover's `billing_info` for the phone app, saved 15 minutes (any phone App event makes it stale):
   ACTIVE → yes, billable · in free trial → yes, not billed · LAPSED → yes for live calls during 7 days, then no; never
   for setup · SUPPRESSED / INACTIVE / unknown → no.
5. Clover does not answer → live call: yes while the last good answer is less than 3 days old; setup: no.

It never checks whether Food Hub is installed. A refused call is never dropped: forward it to the restaurant's number.

`recordPhoneOrder(merchantId, cloverOrderId)` counts one completed, paid phone order (never a call) for the month
(Montréal time) and sends the per-order charge to Clover only when the merchant is ACTIVE (not trial, not ours) and the
tier's allowance is used up (Essentiel 150, Pro 500; plan name containing "Pro" = Pro). Each Clover order is counted
and reported once.

`appInstalled(app, merchantId)` takes our key (`'foodhub'` / `'phone'`) or a Clover App ID.

### Wiring into the phone code (after the AI phone pull request is merged; not done on this branch)

```ts
import { voiceAiEntitled, recordPhoneOrder } from '@/lib/foodhub/pos/clover-entitlement';
// incoming-call handler (voice.ts / twilio.ts), first thing:
const gate = await voiceAiEntitled(cloverMerchantId, 'call');
if (!gate.ok) return forwardToRestaurant(); // never drop the call
// before texting the pay link (order.ts): same check
// after the Clover order is confirmed paid:
await recordPhoneOrder(cloverMerchantId, cloverOrderId);
// turning a line on (settings.ts / brand-lines.ts):
const setup = await voiceAiEntitled(cloverMerchantId, 'setup');
```

## Owner steps in the Clover developer dashboard (the owner does these clicks)

1. Bank details in the production developer account (needed before paid prices).
2. **Create a new app** (do not reuse the older "on2go" Android & Web draft: an app's type and billing country are set
   at creation, and its history is unknown; keep it for a future ON2GO device app).
   - Name: TAKATAK Phone · Type: **Web app** (REST), no Android · Country: Canada.
   - Site URL: the Food Hub public URL. Alternate Launch Path: `/api/foodhub/clover-connect/phone/callback`.
     Default OAuth response: Code.
3. Permissions (final before launch: a change only applies after each merchant reinstalls):
   Merchant read · Inventory read · Orders read + write · Payments read · Ecommerce (online payments) on, to confirm
   with Clover Developer Relations · Customers and Employees: none.
4. Webhook: `<public URL>/api/foodhub/webhooks/clover/phone`, events **Apps only**, then Send Verification Code; the code
   shows in Settings → Clover app → "Clover apps on this server".
5. Pricing: the owner sets the tiers, the per-order charge and the free trial. Measure the real cost per order first
   (the per-order price is hard to change after approval).
6. On the server: set `CLOVER_PHONE_APP_ID`, `CLOVER_PHONE_APP_SECRET`, `CLOVER_PHONE_WEBHOOK_AUTH`,
   `CLOVER_PHONE_METERED_ORDER_ID`, `PHONE_OWN_MERCHANTS`, then restart.
7. Review package: privacy policy and EULA covering PIPEDA, Québec Law 25, call recording and transcripts (the greeting
   announces the recording); a video call → order → pay link → kitchen ticket; the call simulator as "How to test".

## Open questions (before a public launch)

- Revenu Québec SRM certification: does it apply to an app that only creates orders? Ask Clover Developer Relations.
- The texted pay link through the app's own Clover access (today the phone branch uses keys each merchant generates).
- CAD billing for Canadian prices; available free-trial lengths; production address of the billing check.
- The backend serves one restaurant group: outside merchants stay "pending" until the owner approves them. A space per
  merchant is needed before selling to strangers.
