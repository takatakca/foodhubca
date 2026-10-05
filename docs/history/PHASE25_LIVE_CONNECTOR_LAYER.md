# Phase 25 — Operational Live Connector Layer

This phase upgrades the operational MVP so the app can fetch live data once real credentials are added securely.

## Locked project decisions

- UrbanPiper is the control/matching layer.
- TAKATAK Internal Platform Ledger is the main control ledger.
- DoorDash, Uber Eats, SkipTheDishes, Too Good To Go, Clover and UrbanPiper are verification sources.
- QuickBooks is optional/later export only.
- AI supervises incoming data, creates findings and fix tasks, but does not approve, delete, post, or resolve money issues.
- No secrets are stored in chat or committed to the repo.

## New operational flow

```text
Admin enters connector setup in secure app/admin environment
→ Connector metadata is saved
→ Secret values remain in env/server vault
→ Test connection runs
→ Owner enables connector
→ Auto-discovery fetches locations/stores/channels
→ Sync Now fetches operational records
→ AI ingestion supervisor reviews incoming data
→ Fix tasks and verification findings are created
```

## Live connector readiness

Live API calls are blocked unless all are true:

1. connector is enabled
2. feature flag is enabled
3. required environment variables exist
4. owner approval flag is true
5. connector passes health check

## Platforms included

- UrbanPiper
- Clover
- DoorDash
- Uber Eats
- SkipTheDishes
- Too Good To Go

## What is still required from the owner

The owner must configure credentials in `.env.local`, Supabase Edge secrets, Vercel/hosting secrets, or a real vault. Do not paste secrets into ChatGPT.
