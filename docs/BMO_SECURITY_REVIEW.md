# INTER-ACT — BMO/Interac security review — 2026-11-01

**STATUS: DEVELOPMENT ONLY — NO PRODUCTION USE, NO BMO SANDBOX REQUEST SENT, NO DEPLOYMENT.**

Banking software cannot truthfully be certified "100% secure" by a unit-test suite, a developer, or an AI. The safe target is independently verifiable controls, testing and explicit production approval. This is a **threat-model and remediation report**, not a penetration-test certificate.

## Reviewed scope

- `lib/foodhub/delivery/bmo-gateway.ts` — BMO sandbox/preprod server transport and pure settlement validation.
- `lib/foodhub/delivery/bmo-flow.ts` — simulation-only order reserve, one SMS claim, authenticated-status seam.
- `tests/bmo-gateway.test.ts`, `tests/bmo-flow.test.ts`.
- Existing Food Hub **manual Interac checkout remains unchanged**; Claude desktop handles its integration; see PR #141 and issue #105.

## Security hardening implemented on this PR (in addition to original baseline)

| Risk | Control |
| --- | --- |
| Outbound API credentials sent to the wrong destination | Every outgoing BMO transport call requires a trusted, exact **HTTPS origin allowlist**; an arbitrary `baseUrl` is rejected before networking. Configure allowlist only from approved BMO onboarding records. No implicit hostname fallback. |
| Insecure/unknown environments | Runtime environment must be exactly `sandbox` or `preproduction`; `production` and unknown values fail closed. |
| Malformed references or SMS body injection | Restrictive ASCII identifiers, max 64 characters, integer positive CAD cents; payment fingerprint includes the amount; Twilio recipient must be E.164; FR/EN selection enforced at runtime. |
| Customer receiving an unapproved payment link | Require exact HTTPS hostname allowlist; refuse userinfo, ports, fragments and control characters; revalidate the persisted link before texting. |
| API response parser exhaustion or unexpected responses | Require JSON MIME type; cap downloaded JSON at 128 KiB; reject wrong content, missing body, malformed JSON and HTTP failures. Do not echo bank response bodies or credentials. |
| Wrong outcome after bank/transport failures | No automatic repeat of uncertain POSTs; a durable reservation must precede bank submission. A late payment for a cancelled or rejected order may not automatically release kitchen work. |
| Stale/concurrent payment state | Optimistic compare-and-swap is required at the database boundary. A CAS conflict produces a **not-verified** result; never trust a competing state as a release authorization. |
| Incorrect payment marked paid | Only exact Interac `ACCC`, original message ID, order ID, CAD cents and matching bank transaction ID qualifies; persist the matched bank evidence. A stored paid state without matching bank evidence does not verify. |

BMO's official public FAQ states Interac `ACCC` represents beneficiary credit completed and earlier `ACTC/ACSP/ACSC` are not appropriate substitutes. It also says OAuth 2.0 authorization is used and consent is scoped to entitled accounts.

## Hard release blockers (P0): MUST complete before connecting real bank accounts

1. **Bank schema and consent** — BMO-approved organization/application, official versioned Instant Payments - CA 4.3.1 OpenAPI, sandbox OAuth 3-legged flow, approved client ID/key and token refresh rotation. Current request header `x-api-key` is provisional; verify it against contract. Obtain the exact API host, fulfillment link host, request/response fields and cancellation behavior from BMO. No real hostnames or secrets should be guessed or stored here.
2. **Merchant-to-bank entitlement** — hard map each restaurant legal entity/location to a BMO-approved recipient settlement account ID, with owner sign-off and consent. Do not assume that all 42 client businesses can collect through Quadro. Verify consent and beneficiary identity for *every* transaction, not simply matching order IDs.
3. **Durable database transaction** — implement atomic uniqueness on (tenant, merchant, order, payment attempt), durable idempotency locks and payment evidence, tenant-level row access controls, a scheduled reconciliation worker and crash recovery. The current `BmoFlowStore` is an **interface only**; in-memory test mocks are not a secure production implementation.
4. **Authorization + dual controls** — RBAC/ABAC checks on every backend route, least privilege, MFA for staff with payment confirmation privileges, step-up/second approver for sensitive refunds/account routing changes, CSRF protection on staff actions, audit records including actor/time/bank evidence and tamper detection. Payment status is server-only; never set by a customer/client callback.
5. **Twilio/communications** — explicit marketing vs transactional consent, phone ownership/format check, rate limits, SMS quota/abuse monitoring, safe URLs, sensitive-token redaction in logs, locked resend behavior after uncertain sends, phishing-resistant operator instructions.
6. **Payments & reconciliation** — exact amount including GST/QST and disclosed fees, CAD only; cancellations, late deposits, over/under-payments, mismatched recipient, double requests, refunds and notification failure must enter a reconciliation queue, not automatically release food. Manual fallback must never create a second active payment attempt while BMO status is uncertain.
7. **Secrets + transport** — secrets in dedicated store with encryption at rest, environment isolation, minimal BMO scopes, key/refresh-token rotation and revocation; TLS certificate verification and egress firewall allowlisting. No BMO credentials in GitHub/Drive/Gmail, CI logs or client JavaScript.
8. **Security assessment** — full threat modeling, SAST and dependency/secret scanning, dynamic API tests, unauthorized tenant/merchant abuse tests, penetration test by a qualified independent reviewer, review against OWASP ASVS 5.0 (target L2+; adjust per risk), incident runbook, offsite backups/recovery and transaction monitoring. Tests must include real BMO Sandbox and Preproduction scenarios, not only mocked requests.
9. **Launch approval** — explicit owner's authorization **after** bank onboarding and PCI/security/legal review if applicable. No merge to an auto-deploying `main` branch or production changes until separately authorized.

## Evidence and runbook

- PR: https://github.com/takatakca/foodhubca/pull/141
- Agent board: https://github.com/takatakca/foodhubca/issues/105
- GitHub CI on each latest PR head: typecheck, lint, Vitest, build, Playwright accessibility, Food Hub verification and PostgreSQL crash replay. Do not mark PASS until the exact head SHA's GitHub runs conclude successfully.
- Previous baseline SHA `175ced5c`: CI #41285904589 and Docker #41285904574 **SUCCESS**; newer security commits require new CI runs.
- BMO developer documentation: https://developer.bmo.com/api/commercial/faq and https://developer.bmo.com/api/commercial/doc/payments
- OWASP: https://asvs.owasp.org/ and https://owasp.org/API-Security/
- NIST: https://csrc.nist.gov/pubs/sp/800/63/b/4/final

**Owner's standing instruction: DO NOT DEPLOY OR MERGE.** The simulated BMO backend is not connected to any bank account or to an order release route. Claude Food Hub desktop retains ownership of manual checkout and app integration.

— signé : INTER-ACT (GPT-6 / ChatGPT) @ TAKATAK · 2026-11-01
