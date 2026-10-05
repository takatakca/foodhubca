# API Onboarding Checklist

## Never paste secrets into chat

Use:

- `.env.local` locally
- Supabase Edge secrets
- Vercel/Render/Railway environment variables
- external vault/KMS

## UrbanPiper

Needed:

- API base URL
- API key/token
- account/business identifier if required
- allowed endpoints for locations, stores, orders, reports

## Clover

Needed:

- merchant ID(s)
- OAuth access token or app OAuth flow
- permissions for orders, payments, inventory, refunds

## DoorDash

Needed:

- developer/reporting API access
- developer ID / key ID / signing secret or OAuth info
- business IDs / store IDs will be auto-discovered when possible

## Uber Eats

Needed:

- developer app/client ID
- OAuth access token/refresh flow
- store IDs/reporting access

## SkipTheDishes

Needed:

- partner/API access if available
- otherwise scheduled earning report/import access

## Too Good To Go

Needed:

- partner/store reporting access
- invoice/payout report export access, or API if granted
