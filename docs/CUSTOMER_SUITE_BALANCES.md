# Verified customer balances — Food Hub ↔ LOY4LTY / REW4RD

Implemented 2026-11-04. This is a read-only bridge to the existing app ledgers. It adds no enrollment, point award, gift-card issue, reload, redemption, payment or Clover API operation.

## Identity and authorization

The website signs in through Food Hub's existing customer verification/token flow. `/me` resolves a live token and calls the adapters with the persisted customer and the token's website tenant. The adapters re-read the record and reject deletion, token-version mismatch, changed phone, invalid verification time or a website tenant not attached to the customer. The browser cannot select the service, merchant, phone or customer reference.

Each server has an explicit `FOODHUB_CUSTOMER_SUITE_MERCHANTS` JSON object mapping a website tenant to **one** Clover merchant. Use the same mapping on Food Hub and the relevant app. Only a valid complete map authorizes access; malformed entries, arrays/multiple programs and absent configuration fail closed. No independent loyalty programs are summed. The app additionally requires that the mapped merchant is installed and active in its own merchant store.

The existing suite identity is `customerRef = sha256(merchantId + ':' + verifiedE164Phone).slice(0,32)`. The app's existing enrollment/card association must match this reference under the authorized merchant. The phone is never sent to the app endpoint. Food Hub's separate salted platform `customerKey` is deliberately not joined; platform orders frequently lack a real verified phone.

LOY4LTY reads an existing membership; no membership means `not_linked`, without a fake zero balance or auto-enrollment. A real enrolled member with zero points is returned as zero. REW4RD reads only active cards linked at issue time to the same merchant/customerRef. Anonymous, disabled, other-customer and other-merchant cards are excluded. Linking a transferred bearer card, registering a card code or redeeming it is outside this contract.

## Signed API contract

- LOY4LTY: `POST /api/loyalty/customer-balance`.
- REW4RD: `POST /api/cards/customer-balances`.
- Headers: `Content-Type: application/json`, `X-Takatak-App: foodhub`, existing `X-Takatak-Signature` with the app's dedicated suite key.
- Body fields exactly: `{version:1, app:'loy4lty'|'rew4rd', purpose:'customer.balance.read', requestId:<random UUID>, tenant:<website slug>, merchantId:<mapped merchant>, customerRef:<32 lowercase hex>}`.
- Existing HMAC-SHA256 over `<timestamp>.<raw body>`, maximum five-minute skew. Purpose/app/context are signed. A random one-use nonce rejects replay, including after process restart when PostgreSQL is configured. Only the nonce hash/time are retained for this guard; business records are unchanged.
- A success echoes version, app, requestId, tenant, merchantId and customerRef for Food Hub's internal response validation. These internal IDs are not forwarded to the browser. `program:{scope:'merchant',name?:<trusted installed merchant name>}` identifies the actual program.
- Loyalty projection: `{membership:'linked',points:<non-negative integer>}` or `{membership:'not_linked'}`.
- Gift-card projection: `{cards:[{last4:<four Crockford base32 characters>,balanceCents:<non-negative integer>}]}`. No full code, code hash, card ID, customer name, phone or Clover customer ID is returned.

Both routes disable response caching and publish no browser CORS grant. Inputs are stream-limited to 2 KB. Only known fields are accepted. Signed requests with a wrong tenant/merchant pair or inactive merchant fail; production without PostgreSQL fails. Auth-nonce claims are the only new writes and do not modify business ledgers.

The existing generic store can read at most 10,000 merchant records per query. The bridge uses a bounded merchant scan and returns unavailable when it reaches that cap, rather than inventing absence/zero from a truncated result. More than 100 linked cards also returns unavailable. An indexed customer projection is future scaling work; this bridge does not silently migrate existing ledgers.

## Server configuration (names only)

Food Hub reuses `FOODHUB_SUITE_LOY4LTY_URL`, `FOODHUB_SUITE_LOY4LTY_SECRET`, `FOODHUB_SUITE_REW4RD_URL`, `FOODHUB_SUITE_REW4RD_SECRET`, plus `FOODHUB_CUSTOMER_SUITE_MERCHANTS`. The suite URL can remain the app's existing event URL; the client derives the fixed domain-specific balance path on its origin. HTTPS is required except localhost/127.0.0.1 for local integration tests; credentials in URLs, query strings and fragments are refused.

Each app uses its existing `FOODHUB_URL`, matching dedicated `FOODHUB_SUITE_SECRET`, persistent `DATABASE_URL`, installed merchant records and `FOODHUB_CUSTOMER_SUITE_MERCHANTS`. Configure the authorized mapping in the deployment server UI; never commit real merchant mappings or keys.

The legacy `FOODHUB_LOYALTY_URL` / `FOODHUB_GIFTCARDS_URL` alone do not configure or authorize a lookup. Food Hub's admin readiness reports configuration, while the customer result reports actual successful validated reads. A failed service is unavailable, not an empty balance. The client has a 3.5-second deadline, refuses redirects and limits response bodies to 16 KB. Public card balances are converted from integer cents once. Safe browser program metadata contains only scope/name.

## Verification and limits

Unit tests cover signatures, tampering, expired/replayed requests, explicit merchant/tenant isolation, active installation, unchanged business records, unlinked versus true zero, Crockford suffixes, no bearer secrets, truncated queries, non-persistent production state, response/context validation and timeout behavior.

From Food Hub, run `node scripts/verify-customer-suite.cjs` after building both sibling apps. It creates an isolated local PostgreSQL 16 container with two schemas, starts both actual production app servers, runs Food Hub's real adapters over signed HTTP, restarts both apps and repeats the reads. It also checks durable replay refusal and unchanged customer/card documents. It removes its own processes/container afterwards. Requires local Docker, cached postgres:16, the two sibling checkouts/builds and dependencies. Repository paths can be selected with `CUSTOMER_SUITE_LOYALTY_REPO` / `CUSTOMER_SUITE_REWARDS_REPO`.

The local proof uses synthetic installed merchant/member/card fixtures. Food Hub's verified-customer test record is in memory; both suite app ledgers and replay records use real PostgreSQL. This does not certify live Clover OAuth, actual earning/payments/redemption, merchant approvals, production configuration or deployment. No production credentials or customer data are used.
