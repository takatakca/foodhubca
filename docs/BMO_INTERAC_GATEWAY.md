# BMO Instant Payments / Interac Request Money — Food Hub (NON DEPLOYED)

Status 2026-11-01: **sandbox-only gateway transport, order/SMS orchestration and 16 regression tests committed**.
No live request, SMS, bank transfer, consent, kitchen release, or deployment was executed.

## Existing product (do not break)
- `lib/foodhub/delivery/interac.ts` already supports manual Interac e-Transfer website checkout, hold/expiry, one SMS reminder, manual receipt confirmation and once-only Clover release.
- `lib/foodhub/delivery/paylink.ts` supports Clover secure card links for phone orders. Do not rename those existing methods.
- The new BMO modules `lib/foodhub/delivery/bmo-gateway.ts` and `lib/foodhub/delivery/bmo-flow.ts` are separate and **not wired into checkout or Twilio**. This prevents premature payment activation during BMO approval.
- BMO's **Instant Payments - CA 4.3.1** product lists operations for request creation, status inquiry and cancellation (EMTCreditorPaymentActivationRequest, EMTGetRequestForPaymentTransaction, Cancellation). Those are BMO's operation names, **not verified HTTP route paths**.

## Technical safety boundary already coded
- Deterministic per-merchant/order message ID (35 characters); reused after an ambiguous POST, so a network timeout must never create a new bank request ID.
- Exact integer CAD cents and merchant/order binding.
- Only `ACCC` (Accepted Credit Completed) plus matching message ID, order reference, CAD amount and provider transaction ID can satisfy the settlement guard. `ACTC`, `ACSP`, `ACSC`, `RJCT`, `CANC` and unknown never unlock the kitchen.
- Fulfillment URLs must be HTTPS and match a supplied exact hostname allowlist. Do not text untrusted links.
- Sandbox/preproduction only. All production transport calls fail closed, regardless of environment credentials.
- API request timeout, no automatic POST retry, no secret-containing provider error echo, no redirect, no client-side access to OAuth tokens.
- Sandbox flow uses an injected bank API, SMS transport and persistent-store interface: atomic insert and compare-and-swap, bank link saved before SMS, SMS claim recorded before sending, and matching settled status reconciled without automatically releasing a kitchen ticket.
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
- Targeted tests: `tests/bmo-gateway.test.ts` (10) and `tests/bmo-flow.test.ts` (6).
- PR CI on GitHub tests code on an isolated runner; its PR image workflow does not publish or deploy (production Coolify workflow is disabled and push-to-main is forbidden in this task).
- Do not merge this PR until BMO contract integration and owner acceptance. No production deploy.

— signé : GPT-6 (ChatGPT) · 2026-11-01


## Coordination INTER-ACT ↔ Claude Food Hub desktop — 2026-11-01 (OWNER DIRECTIVE)

**Work together on this SAME existing project, no duplicate implementation. Do not wait for BMO API approval to improve the manual payment workflow. Do not merge/deploy.**

### Division of work and ownership
- **INTER-ACT (ChatGPT)**: owns the BMO bank-side backend framework and contract boundary in this feature branch: `bmo-gateway.ts`, `bmo-flow.ts`, bank-specific schema mapper when BMO issues approved Sandbox/OpenAPI credentials, status verification and protection against duplicate requests. The initial framework and 16 mock test cases are already pushed to draft PR #141.
- **Claude — agent code Food Hub (Claude Code desktop on owner's PC)**: owns integration into the **real existing Food Hub application** where he has better context: phone/web order creation, merchant/location configuration, existing Interac manual confirmation, SMS/Twilio, kitchen/Clover printing and events, payment selection UI, persistence/locking and complete integration/E2E suites. Start immediately from today's repository and the code already in draft PR #141. Do not rebuild the gateway or edit INTER-ACT's bank contract files without coordinating on #141; add tests and incremental commits on a separate integration branch/PR, preferably based on #141 if needed. Record SHA, tests and handoff in WORKLOG, issue #105 and Drive.
- **Owner**: BMO enrollment/merchant access/approval, account-to-location ownership decisions, and eventual go-live approval. Do not collect or paste bank credentials into PRs, Drive or Gmail.

### Phase A — manual operating mode NOW (no bank API needed)
1. Keep `lib/foodhub/delivery/interac.ts` as the authoritative **existing manual Interac e-Transfer payment pathway**. Order status remains `awaiting_payment` / `unpaid` until an authorized restaurant operator verifies **actual credit in the right business bank account** and explicitly presses `Transfer received`. Do not treat screenshots, SMS delivery, email, order page return, a customer's claim, or the creation of a request as payment proof.
2. Let staff send existing order-specific Interac instructions via Twilio SMS. If the merchant's authorized BMO Online Banking for Business portal supports generating a manual Request Money URL, staff may use that **bank-generated URL only after verifying it**; never fabricate a BMO URL and do not imply that the BMO API created one.
3. Avoid duplicate requests, double confirmation, multiple Clover tickets or dispatches. Wrong amount, wrong recipient, expired request, late transfer, manual cancellation, partial payment and unclear bank credit all require explicit human handling; no automatic refund or release.
4. Every restaurant/merchant must map to its own verified recipient/account before enabling its manual or automated method. Do not route unapproved unrelated legal entities through Quadro by default.
5. Test Phase A end-to-end **with mocked bank confirmation**, no real transfers: phone and website, FR/EN SMS, invalid phone, tax/fee transparency, retry, concurrency, expiry, operator permissions, Clover once-only print and dispatch gate.

### Phase B — BMO approved API integration LATER
Claude should design the `manual | bmo_request_money` selector now with **manual as the safe default**. BMO automated route is opt-in, feature-flagged and disabled until BMO-approved API contract, sandbox OAuth/consent, account permissions, and exact successful status semantics are demonstrated. Reuse the original order ID and durable claim. No payment completion based merely on `ACTC`/`ACSP`/`ACSC`; reconcile the exact `ACCC` and amount/reference/provider ID before releasing via the existing once-only Clover route. Keep the manual process available for fallback, never silently treat automated in-flight transactions as separate manual payments.

### Testing and handoff contract
- Claude: push **testable Food Hub integration code** and report passing or failing commands (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run verify:foodhub`, `npm run verify:crash` where relevant); no production deployment or merge. Flag blockers with exact owner action.
- INTER-ACT: review integration PR, provide BMO schema adapter after bank approval, add security regression tests, do not overwrite Claude's domain-specific logic.
- Coordination points: GitHub issue #105 and PR #141, Google Drive « 00 — Opérations TAKATAK », Gmail « COORDINATION AGENTS — 2026-11-01 ». Status belongs to the agent who actually verified it; do not claim tests you did not run.
- GitHub CI proof already completed for `175ced5c`: Food Hub CI #41285904589 SUCCESS, image/smoke #41285904574 SUCCESS. **Those prove the isolated foundation**, not a working BMO integration.

**Immediate next step for Claude:** inspect latest main and PR #141; implement/add integration tests for the manual fallback and a disabled BMO selector in Food Hub; push your own branch/PR and send exact commit SHA and remaining questions to INTER-ACT. INTER-ACT keeps bank framework ready for eventual API connection.

— signé : INTER-ACT (GPT-6 / ChatGPT) @ TAKATAK · 2026-11-01
