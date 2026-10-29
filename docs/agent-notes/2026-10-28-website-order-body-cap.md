# Food Hub — website-order body cap, 2026-10-28

Draft PR #104: https://github.com/takatakca/foodhubca/pull/104
Source branch: security/website-order-payload-limit-20261028
Base main SHA: 2aabf3fcceef0aff487d57e0cce3806f8e767807
Code/test SHA before docs: 577530c6a6b8a97e44dc6fc7adc8e81afe68ba68

## Change
The existing authenticated website-order POST used unbounded req.text() once delivery was enabled. The draft adds a streaming 128 KiB body cap before JSON parse, rejects excessive Content-Length and unknown-length streams (413), rejects malformed streams and UTF-8 (400), and returns no-store. The existing auth and delivery feature checks remain first. Unit tests cover normal data and rejection cases.

## This does not launch PPP orders
Food Hub still trusts caller-supplied paid, item/modifier price, tip, deliveryFee, brand and location, and relies on a shared bearer token. Issue #103 requires tenant/merchant mapping, scoped signed identity, server-authoritative pricing and payment proof, durable transaction/inbox/outbox/replay, and one Clover ticket. Do not enable PPP connection on this route.

## Next
Verify CI on final PR head, review Next build/typecheck/lint/unit/mock E2E; staging fake payload tests only. No main merge or deployment was made. Owner controls main/Coolify. Do not change live merchant integrations.
