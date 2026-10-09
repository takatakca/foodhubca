# Go-live checklist — what only the owner can do

The code is verified against simulated platforms (`npm run verify:foodhub`, 382 checks). What is left is on the
platforms' side and in your accounts: approvals, credentials, your server, and one test order per platform.
Settings → **Go-live** (`/settings/go-live`) checks most of these rows by itself.

Rules that hold the whole way: keys are typed on your server with `npm run setup` (never in a chat, never in Git);
`LIVE_CONNECTORS_GLOBAL_ENABLED` stays `false` until the last phase.

## 1. Accounts and approvals (these take days — start now)

| Platform | What to obtain | Where |
|---|---|---|
| Uber Eats | Marketplace API access for a POS / order-manager integration: scopes `eats.order`, `eats.store`, `eats.store.status.write`, `eats.pos_provisioning`, `eats.report` (ask whether cancelling an accepted order needs `eats.store.orders.cancel`), production access, and **one test store** attached to your app | developer.uber.com → your app → Uber Eats → Request access; your Uber integrations contact |
| DoorDash | Marketplace API access (gated; DoorDash assigns a partner manager), your `provider_type`, Sandbox and Production credentials (Developer ID, Key ID, Signing Secret), and an agreed `merchant_supplied_id` (location id) for **every** store | developer.doordash.com → Marketplace; your DoorDash partner manager |
| SkipTheDishes | A **JET Connect POS integration for TAKATAK's own POS** (not through an aggregator): the `X-Flyt-Api-Key` for sandbox and production, the base URL, and the `posLocationId` JET will send for each restaurant | your Skip partner manager → JET Connect integrations team |
| Clover | For the first orders: a merchant **API token** (merchant dashboard → Account & Setup → API Tokens, with Orders, Inventory, Payments). Later: submit the App Market listing so other merchants connect with one click | clover.com (merchant login); Clover developer dashboard |
| Too Good To Go | Ask your TGTG account manager whether a **direct order feed** exists for your account. Today TGTG's POS integration is offered through Deliverect (one-way: orders to the POS; no editing or cancelling from the POS). Without a feed, use the daily bag log (below) — nothing else is needed for go-live | your TGTG account manager |
| Email (SMTP or Resend) | SMTP: a mailbox on your own domain (host `mail.your-domain`, user = the full address, port 465 or 587; no extra account). Or Resend: verify your sending domain (DKIM + SPF + DMARC records), create an API key | your mail host (e.g. MochaHost cPanel → Email Accounts); resend.com → Domains, API Keys |
| Twilio (SMS + calls) | Upgrade from trial, buy a **Canadian** number with Voice + SMS, allow Canada in Messaging and Voice geographic permissions | console.twilio.com |

## 2. Your server

1. Domain and HTTPS: point `foodhub.your-domain` at the server; run `deploy/install-vps.sh` (Caddy or Traefik,
   systemd, cron pingers, `FOODHUB_TRUST_PROXY=true`). Updates later: `deploy/update-vps.sh`.
2. Supabase: run `supabase/INSTALL_ALL.sql` once in the SQL Editor (safe to run again after an upgrade).
3. `npm run setup` on the server: `FOODHUB_PUBLIC_URL` (exact https domain, no trailing slash),
   `FOODHUB_OWNER_EMAIL`, a long random `DASHBOARD_PASSWORD`, `SESSION_SECRET`, Supabase keys, email (SMTP or Resend), Twilio,
   Clover, and each platform's keys as they arrive. Leave `FOODHUB_INSECURE_SHOW_CODES` unset.
4. First visit: *Create the owner account* with your email, then Settings → Profile: your cell, *On duty*, *Text*,
   *Call for urgent alerts*.

## 3. Configuration in Food Hub

1. **Clover**: Setup → Taxes & Fees = 14.975 % (GST 5 % + QST 9.975 %) on every item; an online device with an Order
   printer; Menu Manager → **Import from Clover** for each brand; check Clover → Setup → Tenders for old tenders named
   after a platform.
2. **Uber Eats**: Redirect URI and webhook URL exactly as shown on Settings → Channels; copy the signing key Uber
   shows into `UBER_WEBHOOK_SIGNING_KEY` (if Uber shows none, the client secret is used); `UBER_OAUTH_SCOPE` must list
   only granted scopes; Stores → Mapping → *Connect Uber Eats* — a store is live only once the Activity Log shows
   "Uber Eats connected store …" (Food Hub shows *waiting for Uber* until then).
3. **DoorDash**: Developer Portal → webhook subscriptions to `https://YOUR-DOMAIN/api/foodhub/webhooks/doordash`
   with the Authorization value from Channels: Order, Order Cancel, Menu Status, Dasher Status, and **Menu Request**
   (menu pull). Enter each store's `merchant_supplied_id` on Stores → Mapping. Decide per store: direct, or kept on
   Clover's own DoorDash integration (`FOODHUB_VIA_CLOVER=doordash` only if all of them stay on Clover).
4. **Skip**: give JET the 6 webhook URLs and 2 secrets from the Skip card (Settings → Channels → Show secrets); enter
   each `posLocationId` exactly on Stores → Mapping; keep **Auto-accept on** for Skip stores (JET gives 5 minutes).
5. **Every store mapped**: an order from an unmapped store is never accepted automatically — it waits for a person.
6. Team (managers with a cell and a PIN, staff with a PIN), Settings → Business (each kitchen's phone), Settings →
   Tablets (enrol each kitchen tablet on the tablet itself), Money → Commission plans (*Matches my contract*).
7. Test every channel to yourself: Profile → *Test text* / *Test call* / email; Alerts → *Messages sent* must show ok.

## 4. One test order per platform (sandbox or test store, on a staging copy)

For each platform: the order rings, appears in Clover with the platform order type, the ticket prints, it is
accepted (DoorDash: confirmed only after Clover has it), *Ready* reaches the platform, and after pickup the Clover
order is paid with the platform tender. Then test a cancellation and a rejection. Watch Settings → Channels →
*Unparsed payloads* and the Activity Log: anything a platform sends that Food Hub cannot read lands there, never lost.

Confirm with the platforms during these tests (assumed from their public documentation):
- Uber Eats: whether activation needs a menu first or an extra "integration enabled" step; locale keys `en_ca`/`fr_ca`.
- DoorDash: tax remitted by DoorDash or not; per-unit item prices; menu pull accepted by their onboarding tool.
- Promotions (all platforms): the promotion in the order is the one **you** fund (Uber's order payload does not say
  who funds it — compare one promoted Uber order with its statement).
- Skip / JET: header names, `transmission_id`, timestamps, menu-status callback shape.
- Clover: a custom price on an item-linked line, the payment fields, `print_event`, deleting a cancelled order.

## 5. Go-live and the first week

1. Settings → Go-live all green → set `LIVE_CONNECTORS_GLOBAL_ENABLED=true` and restart.
2. First service with someone watching the Clover register and the Command Center; keep each platform's tablet on and
   staffed (Skip's backup flow uses it).
3. Daily: Too Good To Go bag log at closing (Money → TGTG, 10 seconds) unless a TGTG feed exists.
4. Weekly: import DoorDash and Skip statements (Money → Statements); Uber's arrive by themselves when `eats.report`
   is granted.

## Decisions for the owner (code works either way)

- **Clover in safe mode**: Food Hub creates orders, prints and records payments in Clover even while
  `LIVE_CONNECTORS_GLOBAL_ENABLED=false` (the switch only gates the delivery platforms). Test with a sandbox merchant
  or expect real Clover orders during tests.
- **Promotions in Clover** (1.5.9): a restaurant-funded platform promotion is sent to Clover as an order discount
  (*DoorDash promotion −$3.50*), so the order closes as paid. Confirm on one sandbox order that Clover's total is
  lines − discount + tax and that the hand-off payment closes it.
- **Skip manual accept**: if a Skip store is set to manual accept and nobody answers within 5 minutes, JET hands the
  order to the tablet but Food Hub keeps it open. Keep Skip on auto-accept.
- **Order Relay and shared menus** (branch `claude/practical-wright-pnhgtl`, from another session): ready to review
  and merge after 1.5.9; its menu-editor and channels-page changes then get the same autosave and help treatment.
