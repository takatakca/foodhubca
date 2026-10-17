# Two Clover apps on one backend: Food Hub + the AI phone

The AI phone is sold as its **own** Clover App Market app, priced separately from TAKATAK Food Hub. Both apps run on
this same Food Hub backend (`https://foodhub.on2go.ca`). A merchant can install either one, or both.

| | App 1: TAKATAK Food Hub | App 2: TAKATAK Phone (the AI phone) |
|---|---|---|
| Does | Platform orders into Clover, menu sync, kitchen screen, stores | Answers calls (Québec French, English, Spanish), takes the order with the Duo / Trio / Combo upsell, texts a Clover pay link, creates the Clover order, prints the kitchen ticket |
| Installed alone | Works fully | Works fully (reads the menu from Clover with its own token) |
| Installed with the other | Same merchant ID: the phone uses Food Hub's menu, brand lines and stores; phone orders show in Food Hub's order list and kitchen screen | (same) |

Clover has no "app B needs app A" setting. Each app works alone; the phone listing says "Even better with TAKATAK Food Hub".

## TAKATAK Phone price (owner's decision, 2026-10-17)

- **14-day free trial**, then **CAD $50/month**, set in the Clover dashboard.
- **Plus CAD $0.25 per minute of call**: a Clover metered charge for every minute the AI is on the line, whether or not
  an order is placed. This replaces the earlier per-order idea (no allowance, no tiers).
- Billable minutes of a call = **ceil(AI-handled seconds / 60)**; under 1 second = 0 (nothing sent). 61 s = 2 min.
  - The AI's time starts when the AI answers (its greeting) and ends when it hands the call to a person (the moment
    the transfer starts), says goodbye, or the caller hangs up, whichever comes first.
  - Never counted: the ringing while a person is called (hold), the talk with the person after a transfer, a call that
    went straight to a person (AI off, paused or not set), console and test calls.
  - The end of the call is Twilio's own duration (`CallDuration` of the final status callback).

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
| `CLOVER_PHONE_METERED_MINUTE_ID` | Clover ID of the per-minute metered charge ("Minute d'appel IA / AI call minute", CAD $0.25). Empty = no minute is ever sent. |
| `FOODHUB_PHONE_METERED_ENABLED` | `true` = send AI minutes to Clover. Anything else (default) = dry run: nothing sent, Clover not asked, Settings → Clover app shows what would be billed. |
| `PHONE_OWN_MERCHANTS` | Our own restaurants' Clover merchant IDs, comma-separated: always allowed, never billed. |
| `FOODHUB_BILLING_EXEMPT_MERCHANTS` | Other merchants never billed, comma-separated. |
| `CLOVER_PHONE_APP_NAME` | Listing name if not "TAKATAK Phone". |

## How the backend keeps the two apps apart

- **Registry:** `lib/foodhub/pos/clover-apps.ts` describes each app (key `foodhub` / `phone`, App ID, secret, webhook
  code, token store, callback, webhook path, events, name).
- **Sign-in (OAuth):** `lib/foodhub/pos/clover-oauth.ts` takes the app as an optional last argument (default Food
  Hub). Phone routes: `/api/foodhub/clover-connect/phone/start` and `/api/foodhub/clover-connect/phone/callback`. The
  "wrong app" check, the owner state and the signed launch state are per app: one app's link is refused by the other.
- **Tokens:** kept per (app, merchant). Food Hub: `clover_oauth_merchants` (old records without `appId` are read as
  before). Phone: `clover_oauth_merchants:phone`, each record stamped with the App ID it was issued for (a record from a
  former phone App ID is ignored). Refresh locks are per (app, merchant). Every change to a token map goes through one
  lock per map in the process, so two merchants' writes never undo each other (refresh tokens are single-use).
  The phone's subscription status (what the live-call check reads and writes) has its own key per merchant,
  `clover_phone_billing:<merchantId>`: the per-call check never rewrites the token map.
  Food Hub features use only Food Hub tokens (`cloverToken`, unchanged). Phone features use `phoneCloverToken`: the
  phone token first, then Food Hub's.
- **Webhooks:** `lib/foodhub/pos/clover-webhook-gate.ts` checks each app's own verification key and auth code. Phone
  webhook: `/api/foodhub/webhooks/clover/phone`, **App events only**, so Food Hub's menu and order handlers never run
  twice. Each handler also checks the App ID inside the event.
- **Uninstalling one app** removes only that app's tokens (and, for the phone, its saved subscription status). The phone
  gate then says "not installed": AI lines stop, calls go to the restaurant's own number, no minute is billed. Food
  Hub is not touched. Uninstalling Food Hub leaves the phone app alone.
- **Settings → Clover app → "Clover apps on this server"** shows once `CLOVER_PHONE_APP_ID` is set (before that the
  page is unchanged): keys set or missing (names only), the addresses to paste in Clover, webhook state and
  verification code, and each app's installs (approved / waiting, subscription, "both apps"). The owner (admin) approves
  waiting phone installs and disconnects a merchant from one app there; the other app is not touched.
- **Food Hub's keys** are read raw (never trimmed), exactly as before; the phone app's keys are trimmed.
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

**A live call never waits long on Clover** (Twilio gives the voice webhook about 15 s). Asking Clover (token refresh +
`billing_info`) has a 2.5 s budget; the billing read has a 2.5 s timeout and no 429 retry. When Clover fails or runs
out of time, it is not asked again for 2 minutes: calls in between answer at once from the saved status and rule 5.
A token refresh that runs out of time is not cut short (its answer holds the only copy of the new single-use refresh
token): it finishes in the background and saves its result. A failed phone-token refresh is logged at most once per
merchant every 10 minutes.

`appInstalled(app, merchantId)` takes our key (`'foodhub'` / `'phone'`) or a Clover App ID.

## Per-minute metering: `lib/foodhub/pos/clover-phone-minutes.ts`

When an ordering-line call ends (Twilio's final status callback, `/api/foodhub/webhooks/voice/status`), the route
answers Twilio, then `meterEndedCall` (`lib/foodhub/phone/metering.ts`) counts the AI minutes and calls
`recordCallMinutes`. The merchant is the kitchen's own Clover merchant (a store of the call's brand at that kitchen,
else any store there; never the default merchant). The ON2GO menu (our own line) is never metered.

- **Off unless `FOODHUB_PHONE_METERED_ENABLED=true`.** Off: nothing is sent and Clover is not asked; each call is kept as
  a "preview" with whether it would be billed (from the saved subscription status).
- **Only ACTIVE merchants**: never in the free trial, never `PHONE_OWN_MERCHANTS` or `FOODHUB_BILLING_EXEMPT_MERCHANTS`,
  never LAPSED (even in its 7-day call grace), suspended, inactive, waiting or uninstalled. When Clover does not
  answer and its last answer was ACTIVE (not trial), the minutes wait ("pending") for the next real answer; any other
  answer drops them.
- **Exactly once per call**: the call SID is claimed with one atomic insert (`repo.claimKv`) before anything else;
  each send attempt claims its own key too, so two servers never send the same attempt.
- **Saved before sending** ("sending"). A lost answer (timeout, Clover 5xx, a network error once connected, a database
  error after Clover answered) is **"uncertain"**: logged in the activity log for the owner, shown in Settings →
  Clover app, **never sent again**.
- **Retried only after a definite failure before Clover processed anything**: no token, the connection never opened
  (DNS, refused), or a Clover 4xx (Clover refused: nothing charged). 3 attempts in all, then "failed" (not billed).
  `settlePhoneMinutes()` sends what is pending from the expansion tick, every 10 minutes.
- Clover call: `POST /v3/apps/{appId}/merchants/{mId}/metereds/{CLOVER_PHONE_METERED_MINUTE_ID}?count={minutes}`.
- **Settings → Clover app → "Clover apps on this server" → TAKATAK Phone → "Per-minute billing"**: price, on / dry run,
  this month's calls, AI minutes, minutes sent (or that would be billed), not billed, uncertain, and the estimate.

## Low-credit alert: `lib/foodhub/phone/credit-alert.ts` ("one ping, not a stream")

When Anthropic says the credit balance is too low (the AI circuit breaker in `ai-health.ts`), or Twilio refuses for an
empty balance / suspended account (a text or a call sent through `notify`), the owner gets **one** alert per incident:
team chat, plus an email to `FOODHUB_OWNER_EMAIL` when email is set up, with the action "Recharger les crédits / Top
up" and the fallback in place (the ordering line goes to a person, the ON2GO menu runs on the keypad: never a dead line;
without Twilio texts, payment is taken at the counter). No other ping while the incident lasts, even though the breaker
re-opens every 10 minutes. The alert re-arms only once the provider works again (the next successful AI request or
text). The ping is claimed with one atomic insert per incident, so two servers never both send it.

## Wiring still to do (follow-up pull request)

The per-minute metering is wired (above). The live-call gate is not yet:

```ts
import { voiceAiEntitled } from '@/lib/foodhub/pos/clover-entitlement';
// incoming-call handler (voice.ts / twilio.ts), first thing (answers within 2.5 s even when Clover hangs):
const gate = await voiceAiEntitled(cloverMerchantId, 'call');
if (!gate.ok) return forwardToRestaurant(); // never drop the call
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
5. Pricing: 14-day free trial, CAD $50/month, and one metered charge "AI call minute" at CAD $0.25 per unit (one unit
   = one minute). Copy the metered charge's ID into `CLOVER_PHONE_METERED_MINUTE_ID`.
6. On the server: set `CLOVER_PHONE_APP_ID`, `CLOVER_PHONE_APP_SECRET`, `CLOVER_PHONE_WEBHOOK_AUTH`,
   `CLOVER_PHONE_METERED_MINUTE_ID`, `PHONE_OWN_MERCHANTS` (and `FOODHUB_BILLING_EXEMPT_MERCHANTS` if needed), then restart.
   Check a few days of dry run in Settings → Clover app, then set `FOODHUB_PHONE_METERED_ENABLED=true`.
7. Review package: privacy policy and EULA covering PIPEDA, Québec Law 25, call recording and transcripts (the greeting
   announces the recording); a video call → order → pay link → kitchen ticket; the call simulator as "How to test".

## Open questions (before a public launch)

- Revenu Québec SRM certification: does it apply to an app that only creates orders? Ask Clover Developer Relations.
- The texted pay link through the app's own Clover access (today the phone branch uses keys each merchant generates).
- CAD billing for Canadian prices; available free-trial lengths; production address of the billing check.
- The backend serves one restaurant group: outside merchants stay "pending" until the owner approves them. A space per
  merchant is needed before selling to strangers.
