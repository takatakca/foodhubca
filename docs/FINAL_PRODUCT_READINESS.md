# TAKATAK Accounting Control Tower — Final Product Readiness

This package is the operational release candidate for the TAKATAK Accounting Control Tower.

## Locked architecture

- **UrbanPiper** is the control/matching layer.
- **Clover, DoorDash, Uber Eats, SkipTheDishes, Too Good To Go** are verification sources.
- **TAKATAK Internal Platform Ledger** is the main internal accounting/control ledger.
- **QuickBooks** is optional/later export only.
- **AI** reads incoming records, detects mismatches, creates findings/fix tasks, and prepares summaries; it does not approve, delete, post, or resolve money issues automatically.

## Live-data rule

The system is ready to extract live data only after:

1. Supabase schema and seeds are installed.
2. Secrets are added to `.env.local`, Supabase secrets, Vercel/hosting secrets, or a real vault.
3. `LIVE_CONNECTORS_GLOBAL_ENABLED=true` is set.
4. The platform-specific feature flag is owner-approved and enabled.
5. The connector health check passes.

Do not paste secrets into chat or commit them to Git.

## Locked store status rules

- `(Z)` = active but closed
- `(I)` = deactivated
- Grey circle = deactivated
- Normal/available = active

The database uses two fields:

- `activation_status`: `active` / `deactivated`
- `open_status`: `open` / `closed` / `unknown`

## Required service rule

Each brand/location should be checked for the three required services:

- DoorDash
- Uber Eats
- SkipTheDishes

Too Good To Go is tracked as an additional sales/payout source. Clover is POS/inventory/payment source.

## Go-live order

1. Deploy database and storage.
2. Run seed data.
3. Run preflight and QA checks.
4. Connect UrbanPiper first.
5. Run UrbanPiper health check.
6. Run UrbanPiper auto-discovery.
7. Review discovered stores/services.
8. Connect Clover.
9. Connect DoorDash, Uber Eats, SkipTheDishes.
10. Connect Too Good To Go if account/report/API access is available.
11. Run first controlled sync.
12. Review AI ingestion findings and fix tasks.
13. Only after review, enable scheduled sync.

## What is considered operational

The app is operational when it can:

- load actual company/location/brand data,
- connect credentials securely,
- health-check connectors,
- auto-discover real platform entities,
- ingest real records,
- run AI supervision on ingested records,
- generate fix tasks and review items,
- maintain raw data and audit logs,
- show owner dashboard summaries.

External accounting posting/export stays blocked until a future owner-approved phase.
