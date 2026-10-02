# Operational Plan

## Step 1 — Deploy project shell

1. Create Supabase project.
2. Run `supabase/schema.sql`.
3. Run `supabase/seed.sql`.
4. Run `supabase/storage.sql`.
5. Run `supabase/rls.sql`.
6. Configure `.env.local`.
7. Start Next.js.

## Step 2 — Verify actual data

Run:

```bash
npm run qa:seed
npm run qa:env
```

Then open:

- `/store-health`
- `/service-check`
- `/verification`
- `/fix-tasks`

## Step 3 — Connect actual APIs securely

Do not paste secrets in chat.

Use server environment variables or deployment secret manager. Then change:

```env
LIVE_CONNECTORS_GLOBAL_ENABLED=true
```

only after owner approval.

## Step 4 — Run auto-discovery

POST to:

```text
/api/backend/connectors/autodiscover
```

With body:

```json
{"platform":"urbanpiper"}
```

Or omit platform to try all configured connectors.

## Step 5 — AI ingestion supervision

Every discovered store/order/payout becomes an ingest event. The ingestion supervisor creates findings and fix tasks for:

- deactivated stores
- active but closed stores
- missing services
- negative money events
- unmatched stores/orders/payouts

## Step 6 — Internal ledger

Use `/ledger` and `/api/backend/ledger/preview` for review-only draft entries. Nothing posts automatically.
