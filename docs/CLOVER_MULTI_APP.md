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
| `PHONE_OWN_MERCHANTS` | Our own restaurants' Clover merchant IDs, comma-separated: always allowed, never billed. The default `CLOVER_MERCHANT_ID`, the keys of `CLOVER_MERCHANT_TOKENS` and `FOODHUB_BILLING_EXEMPT_MERCHANTS` count as ours too. |
| `FOODHUB_BILLING_EXEMPT_MERCHANTS` | Other merchants never billed, comma-separated (also always allowed on the phone app). |
| `CLOVER_PHONE_APP_NAME` | Listing name if not "TAKATAK Phone AI". |

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
- **Exactly once per call**: the call SID is claimed with one atomic insert (`repo.claimKv`) before anything else.
- **Every change out of "pending" is claimed**, so a server working from an out-of-date copy never writes over
  another one's result: each attempt has one owner (`claimKv` on call + attempt), whether it sends the minutes or closes
  the record (not billable, no metered ID). A record that only keeps waiting for Clover is never written. The POST has
  its own claim, shared with the clean-up of an interrupted attempt: an attempt is either sent or given up, never both.
- **The AI's end time survives late writes**: the hand-off also stores the AI-end time outside the call record (one
  atomic insert, `phone_ai_end:<CallSid>`), and a slow AI turn that finishes after the hand-off never writes its older
  copy of the call back. The hold and the person are never billed, even when Anthropic is slow.
- **Saved before sending** ("sending"). A lost answer (timeout, Clover 5xx, a network error once connected, a database
  error after Clover answered, a server stopped mid-charge) is **"uncertain"**: logged once in the activity log for
  the owner, shown in Settings → Clover app, **never sent again**. A "sending" left behind for 10 minutes becomes
  "uncertain" (and is logged) at the next settle.
- **Retried only after a definite failure before Clover processed anything**: no token, the connection never opened
  (DNS, refused), or a Clover 4xx (Clover refused: nothing charged). 3 attempts in all, then "failed" (not billed).
  `settlePhoneMinutes()` sends what is pending from the expansion tick, every 10 minutes: oldest first, at most 25
  sends per run, one Clover check per merchant per run. Minutes waiting for Clover do not count in that budget, so
  one unreachable merchant never holds up the others.
- Calls ended while metering was on but `CLOVER_PHONE_METERED_MINUTE_ID` was not set are never billed and show as a
  warning in Settings → Clover app.
- Clover call: `POST /v3/apps/{appId}/merchants/{mId}/metereds/{CLOVER_PHONE_METERED_MINUTE_ID}?count={minutes}`.
- **Settings → Clover app → "Clover apps on this server" → TAKATAK Phone → "Per-minute billing"**: price, on / dry run,
  this month's calls, AI minutes, minutes sent (or that would be billed), not billed, uncertain, and the estimate.

## Low-credit alert: `lib/foodhub/phone/credit-alert.ts` ("one ping, not a stream")

When Anthropic says the credit balance is too low (the AI circuit breaker in `ai-health.ts`), or Twilio refuses for an
empty balance / suspended account (a text or a call sent through `notify`), the owner gets **one** alert per incident:
team chat, plus an email to `FOODHUB_OWNER_EMAIL` when email is set up, with the action "Recharger les crédits / Top
up" and the fallback in place (the ordering line goes to a person, the ON2GO menu runs on the keypad; without Twilio
texts, payment is taken at the counter). An ordering line with no hand-off number and no kitchen phone has no person
to go to: its calls are hung up, and the alert names it. No other ping once the alert was delivered, even though the
breaker re-opens every 10 minutes; a send that reached nobody (chat down, no email) is tried again on the next failure,
at most once per 10 minutes. The alert re-arms only once the provider works again (the next successful AI request or
text). State: one `fh_kv` key per provider (`phone_credit_alert_v2:<provider>`), saved as open before the ping is
claimed (a failed write never silences a later incident); each send is claimed with one atomic insert per incident and
10-minute slot, so two servers never both send it.

## The gate in the phone module: `lib/foodhub/phone/gate.ts`

`kitchenPhoneGate(kitchen, purpose)` / `linePhoneGate(line, purpose)` run `voiceAiEntitled` for the kitchen's own
Clover merchant, found the same way as for metering (a store of the brand at that kitchen, else any store there; never
the default merchant).

- **`CLOVER_PHONE_APP_ID` not set: no check at all**, nothing is read; every call, pay link and line works exactly as
  before. **Ours: always allowed** (`PHONE_OWN_MERCHANTS`, plus `CLOVER_MERCHANT_ID`, `CLOVER_MERCHANT_TOKENS` and
  `FOODHUB_BILLING_EXEMPT_MERCHANTS`, so one ID forgotten in `PHONE_OWN_MERCHANTS` never takes the AI off the owner's
  lines). A kitchen with no Clover merchant of its own is ours: allowed (and never billed; kitchens are only created by
  the owner). Settings → Expansion → AI phone ("Ready for test calls?") shows one line per kitchen with the app check:
  a refused kitchen is a stop, naming its merchant and `PHONE_OWN_MERCHANTS`; each refused live call is also logged
  on the server.
- **Live call** (`voice.ts` `startCall`, first thing after the line, the AI key and the switch): `'call'`, so LAPSED
  within 7 days and Clover unreachable within 3 days of the last good answer still go through; the check answers
  within 2.5 s even when Clover hangs. The check itself failing (a database blip) lets the AI answer (logged; metering
  still decides billing). Refused: **the call is never dropped**. The caller
  hears the short "Je vous transfère à un membre de notre équipe" and the call rings the line's hand-off number, else
  the kitchen's phone (Settings → Business), exactly like a line whose AI is off. The call log says why
  ("TAKATAK Phone not active for kitchen NDG (lapsed)"); no AI minute starts. A line with no hand-off number and no
  kitchen phone rings ON2GO's person (`FOODHUB_IVR_HANDOFF_NUMBER` / `FOODHUB_MAIN_PHONE`), else ON2GO's voicemail
  takes a message (ticket + email); a hand-off nobody answers also ends in that voicemail. The team chat gets the
  number to call back.
- **A line with several kitchens** is allowed only when every kitchen is (the caller may pick any of them). The
  kitchens are checked at once, so the call still waits at most one 2.5 s budget. Switching on a line that mixes our
  kitchens with a client's is refused (the client's subscription would gate ours): put them on two numbers.
- **ON2GO menu** (our own line, never gated itself): "place an order" hands the call to the ordering line's AI only when
  that line passes the same live-call check; otherwise a person takes the order (`dialPerson`, else voicemail), as
  when the AI is off. This webhook may already have waited on the menu's AI turn, so Clover gets 1 s here
  (`ORDERING_GATE_BUDGET_MS`), then the saved status and the grace rules decide.
- **Texted Clover pay link** (`order.ts` `phonePaymentPlan`, used by the AI's instructions and by `placePhoneOrder`):
  `'call'` check; refused = no link, pickup paid at the counter and a delivery paid on a call back, as when the link is
  not set up.
- **Switching a line on** (`settings.ts` `savePhoneSettings`): `'setup'`, strict (no grace, Clover must answer). Checked
  for a line turned on, a new line saved on, or a kitchen (location) added to a line that is on; kitchens already on
  keep saving (renaming, reordering brands). A refused change to a line already on says « Les changements ne sont pas
  enregistrés ; la ligne reste comme avant. / Changes not saved; the line stays as it was. » Refused: nothing is saved and the console shows the reason in French then English, e.g. « TAKATAK Phone
  n’est pas actif pour Pi Pita NDG (cuisine NDG) : l’abonnement est échu (paiement en retard dans Clover). La ligne
  reste éteinte. / TAKATAK Phone is not active for Pi Pita NDG (kitchen NDG): the subscription has lapsed (payment
  overdue in Clover). The line stays off. »
- **Brand lines** (`brand-lines.ts`, `FOODHUB_BRAND_PHONES`) only ring the main number and take voicemail: no AI, no
  Clover app, no gate.

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
   Open Settings → Expansion → AI phone: every kitchen of ours must show "TAKATAK Phone OK"; a stop names the merchant
   to add to `PHONE_OWN_MERCHANTS`.
   Check a few days of dry run in Settings → Clover app, then set `FOODHUB_PHONE_METERED_ENABLED=true`.
7. Review package: privacy policy and EULA covering PIPEDA, Québec Law 25, call recording and transcripts (the greeting
   announces the recording); a video call → order → pay link → kitchen ticket; the call simulator as "How to test".

## Open questions (before a public launch)

- Revenu Québec SRM certification: does it apply to an app that only creates orders? Ask Clover Developer Relations.
- The texted pay link through the app's own Clover access (today the phone branch uses keys each merchant generates).
- CAD billing for Canadian prices; available free-trial lengths; production address of the billing check.
- The backend serves one restaurant group: outside merchants stay "pending" until the owner approves them. A space per
  merchant is needed before selling to strangers.
