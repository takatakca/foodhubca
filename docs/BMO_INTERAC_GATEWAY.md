# BMO Instant Payments / Interac Request Money — Food Hub (NON DEPLOYED)

Status 2026-11-01: **sandbox-only gateway foundation and 10 regression tests committed**.
No live request, SMS, bank transfer, consent, kitchen release, or deployment was executed.

## Existing product (do not break)
- `lib/foodhub/delivery/interac.ts` already supports manual Interac e-Transfer website checkout, hold/expiry, one SMS reminder, manual receipt confirmation and once-only Clover release.
- `lib/foodhub/delivery/paylink.ts` supports Clover secure card links for phone orders. Do not rename those existing methods.
- The new BMO module in `lib/foodhub/delivery/bmo-gateway.ts` is separate and **not wired into checkout or Twilio**. This prevents premature payment activation during BMO approval.
- BMO's **Instant Payments - CA 4.3.1** product lists operations for request creation, status inquiry and cancellation (EMTCreditorPaymentActivationRequest, EMTGetRequestForPaymentTransaction, Cancellation). Those are BMO's operation names, **not verified HTTP route paths**.

## Technical safety boundary already coded
- Deterministic per-merchant/order message ID (35 characters); reused after an ambiguous POST, so a network timeout must never create a new bank request ID.
- Exact integer CAD cents and merchant/order binding.
- Only `ACCC` (Accepted Credit Completed) plus matching message ID, order reference, CAD amount and provider transaction ID can satisfy the settlement guard. `ACTC`, `ACSP`, `ACSC`, `RJCT`, `CANC` and unknown never unlock the kitchen.
- Fulfillment URLs must be HTTPS and match a supplied exact hostname allowlist. Do not text untrusted links.
- Sandbox/preproduction only. All production transport calls fail closed, regardless of environment credentials.
- API request timeout, no automatic POST retry, no secret-containing provider error echo, no redirect, no client-side access to OAuth tokens.
- Never store tokens, bank account numbers or personal information in this public repository, worklog, PR, issue board or Drive note.

## BMO approval and exact contract needed (blocking)
1. BMO approval for the business's **Online Banking for Business** API organization and the authorized accounts/consent. Registration submission alone is not access approval.
2. Portal **Workspace / My applications** sandbox credentials, OAuth test-consent instructions and exact official OpenAPI schemas/samples for Instant Payments - CA 4.3.1 (request money creation, get request status, cancellation).
3. Confirm endpoint base URLs, exact headers, payload field mappings, response fields, fulfillment URL hostname(s), token acquisition/refresh and settlement semantics with BMO. Current generic transport header `x-api-key` is **provisional** and must match the downloaded contract before use.
4. Bank approval for the settlement account of each restaurant. Do NOT assume a Quadro merchant ID can accept payments on behalf of separate legal merchant companies.
5. BMO sandbox test cases proving request URL, status transitions, cancellation, idempotent retry and account permissions. Securely configure keys only in a private secret store after approval.

## Next implementation slice (after approval)
- Write a BMO schema-specific adapter for `EMTCreditorPaymentActivationRequest` and `EMTGetRequestForPaymentTransaction`; use BMO's documented OAuth consent and key names.
- Add a per-kitchen **opt-in** gateway selector; default remains existing manual Interac/Clover, no global fallback.
- On a held website/phone order: claim one request atomically in the persistent order store, create the BMO Request Money with a stable ID, persist BMO transaction ID + secure URL, then send **one** Twilio SMS containing the verified URL and exact price.
- Reconcile with bank status via authenticated polling; do not infer settlement from SMS delivery, link click, redirect, webhooks without authenticated verification or `ACTC`/`ACSP`/`ACSC`.
- After exact `ACCC` match, route through Food Hub's existing once-only release/claim mechanism with a durable compare-and-swap. On uncertain outcome, block new submissions and surface human review.
- Verify bilingual SMS, cancellations, late payment, expired requests, duplicate callbacks and tenant isolation; run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run verify:foodhub` using mocks/sandbox, **never** production.
- Respect Québec pricing/tax disclosures and MEV/SRM before merchant launch.

## Official BMO references (read 2026-11-01)
- https://developer.bmo.com/api/commercial/catalogue
- https://developer.bmo.com/api/commercial/taxonomy/term/2?page=3
- https://developer.bmo.com/api/commercial/faq

## Test and handoff
- Targeted tests: `tests/bmo-gateway.test.ts`.
- PR CI on GitHub tests code on an isolated runner; its PR image workflow does not publish or deploy (production Coolify workflow is disabled and push-to-main is forbidden in this task).
- Do not merge this PR until BMO contract integration and owner acceptance. No production deploy.

— signé : GPT-6 (ChatGPT) · 2026-11-01
