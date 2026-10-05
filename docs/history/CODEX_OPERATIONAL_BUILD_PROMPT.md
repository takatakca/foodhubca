You are working on TAKATAK Accounting Control Tower.

Do not rebuild as a generic app. This is specifically for Quadro Holdings LTEE and the restaurant locations/brands in the seed data.

Stack:
- Next.js App Router
- Supabase PostgreSQL/Auth/Storage
- Server-side connector adapters
- TAKATAK Internal Platform Ledger
- UrbanPiper as control/matching layer
- DoorDash, Uber Eats, SkipTheDishes, Too Good To Go, Clover as verification sources

Locked rules:
- (Z) = active but closed
- (I) = deactivated
- grey circle = deactivated
- Every brand/location needs DoorDash + Uber Eats + SkipTheDishes check
- QuickBooks optional/later export only
- AI can detect/suggest/flag, but cannot approve/post/delete/resolve

Next coding tasks:
1. Make Supabase-backed versions of current local-seed pages.
2. Add secure admin connector credential setup forms that store metadata only.
3. Add discovery result persistence into ingest_events.
4. Convert AI findings into fix_tasks.
5. Add owner approval gate before enabling any live connector.
