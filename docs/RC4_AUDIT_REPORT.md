# RC4 — Audit Report: Flaws Found and Fixed

Second full audit pass. Build, type check, tests, release checks, and a
two-platform simulated pipeline test all pass after these fixes.

## Flaw 1 (CRITICAL): DoorDash / Skip / TGTG connectors faked "healthy"
They reported `status: healthy, canCallLive: true` without making any API
call. A sync would then report "completed" with 0 records — silently missed
money, the exact failure this system exists to catch, and the go-live
checklist would have shown green.
**Fixed:** these connectors now report `blocked` with an honest message and
refuse discovery/sync until their account-specific endpoint is configured.
Verified: DoorDash sync attempt now returns `blocked` with explanation.

## Flaw 2 (SECURITY): 13 tables had no Row-Level Security
All connector/ingestion tables (connector_health_checks, connector_sync_runs,
ingested_platform_records, ai_ingestion_findings, platform_entities, webhook
events, approvals, schedules, and more) were created without RLS. With
Supabase defaults, anyone holding the public anon key could read AND write
those financial records via the REST API.
**Fixed:** new `supabase/rc4_security_patch.sql` (run as file 7 of 7) enables
RLS on all of them. The server keeps working via the service-role key.

## Flaw 3 (ACCOUNTING CORRECTNESS): Clover sync ignored dates and pagination
It always fetched the first 100 orders ever created — wrong data for any
reconciliation window, capped at 100 records.
**Fixed:** Clover order sync now honors startDate/endDate (default: last 7
days), paginates (up to 5,000 orders per manual run), and uses the order's
own currency. Verified against a simulated Clover API: a 5-day window over a
250-order dataset returned exactly the 120 in-window orders across 2 pages.

## Flaw 4 (SILENT FAILURE): UrbanPiper order sync returned empty quietly
`syncType: orders` completed "successfully" with 0 records.
**Fixed:** unsupported sync types now fail loudly with a clear message
instead of pretending to complete.

## Flaw 5 (RELIABILITY): Uber Eats required a hand-pasted access token
Uber tokens expire (~30 days), so the connector would silently break.
**Fixed:** the connector now accepts UBER_CLIENT_ID + UBER_CLIENT_SECRET and
fetches/refreshes its own token via OAuth client-credentials (scope
configurable via UBER_OAUTH_SCOPE, default `eats.store`). A static
UBER_ACCESS_TOKEN still works and takes priority.

## Flaw 6 (DATA DISCONNECT): dashboard pages never read Supabase
Owner Dashboard, Store Health, 3-Service Check, AI Verification, and Fix
Tasks read only the static seed JSON — synced data would never appear in the
UI. This was the project's own stated Priority 1.
**Fixed:** new `lib/data/store-data.ts` layer: pages read `platform_stores`
from Supabase when configured (with brand/location/platform joins), fall
back to seed data otherwise, and always show a visible "data source" badge
so the owner knows exactly what they are looking at.

## Flaw 7 (MISLEADING METADATA): credential requirements table wrong
`connector_secret_requirements` in the database listed different required
secrets than the code actually checks (e.g., Clover listed CLIENT_ID/SECRET
but the code needs BASE_URL/MERCHANT_ID/ACCESS_TOKEN).
**Fixed:** rc4_security_patch.sql aligns the metadata with the code.

## Re-verified in this build
- `tsc --noEmit`, `npm test` (3/3), `npm run build` (29 routes),
  `npm run release:check`, `npm run sync:dry-run` — all pass.
- Simulated two-platform run: UrbanPiper health+discovery+stores sync OK;
  Clover date-filtered paginated order sync OK; DoorDash/Skip/TGTG honestly
  blocked; unsupported sync types fail loudly.

## SQL run order is now 7 files
1. schema.sql  2. seed.sql  3. storage.sql  4. rls.sql
5. phase25_live_connectors.sql  6. final_operational_patch.sql
7. rc4_security_patch.sql
