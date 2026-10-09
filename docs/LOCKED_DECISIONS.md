# Locked Decisions

- App is built specifically for Quadro Holdings LTEE restaurant locations/brands.
- TAKATAK Food Hub is the control/matching layer — direct integrations with Uber Eats, DoorDash,
  SkipTheDishes (JET Connect), Too Good To Go and Clover. UrbanPiper is no longer used (no aggregator).
- Never accept an order Clover did not receive; never show a platform action as done when it was not sent.
- TAKATAK Internal Platform Ledger is the main control ledger.
- QuickBooks is optional/later export only.
- AI supervises incoming data and creates findings/tasks.
- AI cannot approve, post, delete, or resolve financial issues automatically.
- Every brand/location is checked for DoorDash, Uber Eats, SkipTheDishes.
- `(Z)` means active but closed.
- `(I)` means deactivated.
- Grey circle means deactivated.
- No live API connector runs until credentials are securely configured and owner-approved.
- `LIVE_CONNECTORS_GLOBAL_ENABLED` gates every outbound platform call that changes anything on a platform
  (orders, menus, 86, pause/resume, the Uber report request). Explicit exception, by design: read-only
  store-status polls (Uber/DoorDash `GET` status) and the owner-initiated "Connect Uber Eats stores" OAuth
  exchange run as soon as credentials exist, so the dashboard reflects the platforms before go-live.
- Expansion features (own-order delivery, grocery / retail, alcohol, AI phone ordering) are each OFF until the owner turns
  them on (Settings → Expansion). Proposed exception, to be confirmed by the owner: DoorDash Drive / Uber Direct
  **sandbox** calls run without `LIVE_CONNECTORS_GLOBAL_ENABLED` (no real courier is sent; DoorDash requires test
  deliveries before production). Production courier calls need the live switch.
- Alcohol is never enabled automatically: a channel opens only after the owner enters and checks the RACJ permit for
  that location; a grocery permit never allows third-party delivery.
- The AI phone agent takes orders the caller confirmed and can hand off to a person; it has no way to refund, cancel,
  discount or take a payment.
