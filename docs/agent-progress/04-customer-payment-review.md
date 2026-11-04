# Agent 04 — customer payment-state source review

2026-11-04 UTC · Scope: current integration worktree. This is an independent source review, not a new real-card payment or deployed-release acceptance run. The coordinator owns financial-core changes; Agent01 owns ON2GO presentation changes.

## Source reviewed

- Food Hub `app/p/[token]/route.ts`, `app/commander/[slug]/suivi/[token]/page.tsx`, `lib/foodhub/customers/me.ts`, `lib/foodhub/storefront/checkout.ts`.
- Supporting state contracts in `lib/foodhub/delivery/paylink.ts`, plus ON2GO `lib/order.ts`, `lib/account.ts`, `components/track-client.tsx` and `components/account-client.tsx`.

## Findings and current source status

| Finding | Concrete trigger and risk | Current source status |
| --- | --- | --- |
| Paid-but-held flag lost by consumer adapters | Backend emits `paymentReceived:true` while order remains `awaiting_payment`, but older ON2GO parsers dropped it. The tracking page then said payment was unconfirmed and encouraged resuming payment. | Agent01 now preserves the flag in account/tracking parsers. Paid-hold copy says payment is received and restaurant confirmation is pending. No resume-payment notice/button for that state. Browser regressions and final build belong to Agent01/coordinator. |
| First frontend fix hid ordinary paid progress | Backend also emits `paymentReceived:true` for released/preparing/ready/completed orders. Treating every received flag as a hold replaced valid progress with “awaiting restaurant” and removed ETA/reorder indefinitely. | Reported before finalization. Current source derives `paidHold = paymentReceived && status === 'awaiting_payment'`; review always overrides. Normal paid preparing/ready/completed states retain their status/ETA/progress/reorder. `parseTrack` suppresses ETA for review or awaiting payment, not all received payments. |
| Contradictory Interac instructions | Tracking previously included Interac recipient/amount whenever its own receipt field was absent, even if an overlapping paylink was paid or under review. Such a mixed/legacy record could display transfer instructions below “do not pay again”. | Current `trackOrder()` computes payment state once, omits Interac details for review/received payment, suppresses ready time for review/held orders. The Food Hub tracking component also guards pay links/Interac/ETA/steps using review/paid-hold state. |
| Payment POST uncertainty offered another payment form | An unknown/error result could fall through to a generic error plus another payment form. The outcome was uncertain rather than a verified non-payment. | Coordinator changed the fallback to a safe status-refresh link. Review and received-payment branches show no payment form. Source changed; this review did not run the coordinator's new financial acceptance suite. |
| Return-query text asserted a failed payment | Pending `?r=fail` / `?r=cancel` used to state that payment failed/cancelled and suggested another card, though the query is caller-controlled and not provider evidence. | FR/EN/ES copy now says payment needs confirmation/check status or contact the restaurant before retrying. Paid/review state still takes priority over return-query hints. |
| Late payment after cancellation may lack a customer review notice | `flagExtraPayment()` can store `paylink.extraPayments` plus operator attention while `payLinkState()` remains `cancelled`. Existing account projection may expose plain cancellation/reorder without disclosing the known late payment/manual refund review. | Coordinator now projects late/extra payments as payment review in `me.ts` and `checkout.ts`, suppressing resume-payment links and misleading preparation/Interac output. The core financial state was not changed. Cancelled late-payment fixtures passed in the coordinator's combined 62-case identity/presentation run; final combined build remains pending. |

An additional direct review/received-state guard on the account renderer was suggested as defense in depth. The current renderer receives orders through the parser, which already removes conflicting payment URLs; no failing current response path was established for that suggestion. Agent01 kept the redundant guard unchanged during its frozen acceptance run and added normal paid preparing/ready/completed regressions. This suggestion is not recorded as an unresolved blocker.

## Positive checks in current source

- `/p/<token>` prioritizes review/confirmed receipt before expiry/cancellation or return-query hints. The opaque token is the credential; responses are private/no-store. The return query never proves that payment was received.
- New checkout retries retain the original order/receipt and do not create another order to recover a missing response. A cached payment URL leads to the same token's current status page; it does not itself create a new charge.
- Food Hub customer/order projections expose a resume link only for a genuinely pending held paylink. Review and recorded receipt suppress it.
- Food Hub tracking distinguishes payment received but awaiting restaurant confirmation from kitchen preparation. Review/held state hides ETA, preparation progress and transfer instructions.
- ON2GO's corrected state predicate retains normal paid-order progress while suppressing payment actions for a paid hold or review.

## Separate contact-presentation fix

`app/legal/terms/page.tsx` and `app/legal/privacy/page.tsx` now reuse the already verified `publicSupportEmail()` fallback. Missing/whitespace support configuration renders the published group email rather than raw configuration placeholders. Configured contact email/optional phone remain authoritative. Corporate company/address, privacy officer, legal obligations and approval/draft gates were preserved; the existing support page/helper was not changed.

Validation performed by Agent04: **29 legal tests passed** (six new contact cases plus 23 existing legal-page regressions), scoped lint clean. The old test expecting a raw placeholder was changed to assert the requested published fallback and absence of support configuration tokens; configured legal-details and draft-gate assertions remain.

## Additional regression evidence

The coordinator's [presentation/identity run](evidence/04-financial/presentation-tests.txt) passed 62/62 tests across four files, including the late cancelled-payment fixture. Agent04 read the current projection changes and the successful log; the [provenance record](evidence/04-financial/presentation-tests-provenance.json) distinguishes that coordinator run from Agent04's own 29 legal regressions and the earlier organization browser snapshot. No live payment/refund or later combined-build claim follows from the targeted run.

## Acceptance boundary

The earlier organization browser proof (13 checks, four zero-violation accessibility scans) covers that compiled organization/navigation/avatar snapshot. It does not prove these later payment/contact/control-plane changes. The final combined build must exercise review, paid-held, mixed Interac/paylink, normal paid preparing/completed, unknown-result and late-payment cases with isolated data and verify no extra payment action or false preparation message. Live provider payment/refund acceptance remains separate.

— signed: Codex (`drive_research`, Agent04) @ Codex cloud · 2026-11-04 UTC
