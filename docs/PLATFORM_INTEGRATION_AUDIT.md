# TAKATAK platform integration audit

Audit scope: the 22 checkouts already selected in `/workspace`. This document contains no private merchant identifiers, provider-session data, customer data or secret values. It records source evidence and offline contract compatibility; it does not establish that production deployments or live provider connections work.

## Core architecture established by source

- `takatak-v1` owns master identity, workspaces, memberships, entitlements and agency billing.
- `foodhubca` owns restaurant order operations, platform adapters, store/menu mapping, kitchen sessions/PINs, alerts, dispatch and payout reconciliation. Order operations should continue independently of the control plane.
- The nine Clover suite apps own their own data, Clover app authorization and subscriptions. Food Hub routes signed events between them. The join key is Clover merchant ID, not a shared database.
- Each order must enter Food Hub through one configured path per platform/store: direct adapter, Clover read or Order Relay. A provider browser session is a separate connection from its API integration.
- QCMEV sales receipts, Facturations business invoices, restaurant payout reconciliation and app subscriptions are different financial records; connecting the platform does not authorize posting one into another.

Primary architecture evidence: `foodhubca/docs/FOOD_ECOSYSTEM_MAP.md`, `foodhubca/docs/TAKATAK_SUITE.md`, `foodhubca/docs/ON2GO_HUB_ECOSYSTEM.md`. These documents contain older status tables; current implementation evidence below takes precedence over a stale “to do” or “built” label.

## Repository matrix

“Implemented” means code exists on the selected checkout. “Offline verified” means the paired-contract checker or previous local application checks exercised that capability. “Unwired” means production call sites or standalone deployment wiring are absent. “Unverified” means current-instance/live evidence has not established the behavior.

| Repository | Responsibility and implemented links | Remaining gap or limit | Evidence relative to `/workspace` |
| --- | --- | --- | --- |
| foodhubca | Operational hub; signed nine-app bus, public directory, customer ON2GO bridge, QCMEV client, official platform connectors and screen-relay status | C4 merchant entitlements and C5 usage are foundation functions without application callers. Single-instance tenant identity is not a finished shared multi-tenant SaaS. Live credentials/session hosts and durable services are unverified. | `foodhubca/lib/foodhub/suite/{apps,auth,bus,directory,sign}.ts`; `foodhubca/app/api/suite/v1/*/route.ts`; `foodhubca/lib/foodhub/tenant.ts`; `foodhubca/lib/foodhub/customers/takatak-bridge.ts` |
| on2goca | Static consumer directory; consumes Food Hub public feed, storefront/checkout and browser-safe customer API; launches TAKATAK identity flow | Static build deliberately keeps checked-in directory snapshot when live feed is unavailable. A green build does not prove fresh live data. Full real identity/payment flow unverified. | `on2goca/scripts/fetch-directory.mjs`; `on2goca/scripts/validate-directory.mjs`; `on2goca/lib/auth.ts`; `on2goca/docs/CUSTOMER_SIGN_IN.md` |
| C4ISSE | Clover counter register, photos/cart/report APIs; suite event receiver/emitter/directory | Server contract compatible; native Android/payment/device acceptance still separate. Live Clover authorization and event delivery unverified. | `C4ISSE/lib/domain/index.ts`; `C4ISSE/lib/suite.ts`; `C4ISSE/docs/SUITE_KIT.md`; `C4ISSE/DEPLOY.md` |
| T4CTILE | Self-service kiosk, Clover order creation, suite status linkage | One ingestion path must be enforced at rollout; native on-device Clover payment remains separate work. | `T4CTILE/lib/domain/index.ts`; `T4CTILE/lib/suite.ts`; `T4CTILE/README.md` |
| 4CCOUNTING | Clover daily books/tax/tender reports; records Food Hub platform orders | Advanced payout reconciliation, REW4RDS liability and ST4FF costing are explicitly marked future features. Do not market them as working because bus transport exists. | `4CCOUNTING/lib/domain/{index,books}.ts`; `4CCOUNTING/lib/suite.ts` |
| TR4CKER | Own-delivery courier/customer tracking context and Food Hub order updates | Real courier devices, location permissions, dispatched routes and outage recovery need operational acceptance. | `TR4CKER/lib/domain/index.ts`; `TR4CKER/lib/suite.ts`; `TR4CKER/README.md` |
| ST4FF | Clover hours/shifts, wages/labor analysis and planned shifts; signed suite link | Payroll exports, overtime/break support and labor alerts are marked future features. | `ST4FF/lib/domain/index.ts`; `ST4FF/lib/suite.ts` |
| M4RKETING | Segments, Clover discounts, consent-aware approved campaigns; suite link | Triggered cross-app campaigns and LOY4LTY/REW4RDS campaigns are marked future features. Transport capability does not implement those business workflows. | `M4RKETING/lib/domain/index.ts`; `M4RKETING/lib/suite.ts` |
| LOY4LTY | Points based on confirmed payments and redemption as order discount; suite link | Member tiers and cross-app reward/campaign behavior are marked future features. Its merchant+phone customerRef differs from Food Hub’s salted customerKey and is intentionally not automatically joined. | `LOY4LTY/lib/domain/index.ts`; `LOY4LTY/lib/suite.ts`; `foodhubca/docs/TAKATAK_SUITE.md` §3 |
| REW4RD | Gift card hashing, redemption/reload/liability server workflows; suite link | Online sales, unified phone balance, cross-location liability and accounting export are explicitly future features. | `REW4RD/lib/domain/index.ts`; `REW4RD/lib/suite.ts` |
| CH4T | Internal support context/templates; suite transport | Sending is explicitly unavailable; TR4CKER/loyalty/reward balances in a thread are future features. | `CH4T/lib/domain/index.ts`; `CH4T/README.md`; `CH4T/lib/suite.ts` |
| takatak-v1 | Master identity/control plane; ON2GO launch/exchange/introspect and scoped master API; Academy bridge; SEO signed client; Facturations signed proxy | No application caller for a trusted private KnowledgeAI token issuer found. Food Hub control-plane consumer is incomplete. Live service settings and production behavior unverified. | `takatak-v1/docs/ON2GO_MASTER_API.md`; `takatak-v1/src/lib/integrations/on2go/experience-access.ts`; `takatak-v1/src/lib/experiences/academy-experience-access.ts`; `takatak-v1/src/lib/seo/seotakatak-bridge.ts`; `takatak-v1/src/lib/integrations/facturations/` |
| ACADEMYTAKATAK | Dedicated learning service; free catalog/progress/exams; TAKATAK-only identity via short-lived code exchange | V1 currently returns free-only grant. Paid catalog/refund/entitlement lifecycle must be implemented and verified before paid access. Dedicated migrations/DB and actual SSO flow unverified. | `ACADEMYTAKATAK/docs/TAKATAK_V1_INTEGRATION.md`; `ACADEMYTAKATAK/src/lib/bridge.ts`; `ACADEMYTAKATAK/src/app/api/ready/route.ts`; `takatak-v1/docs/TAKATAK_ACADEMY_BRIDGE.md` |
| SEOTAKATAK | Tenant-scoped SEO engine; trusts short-lived V1 HS256 token; private store; verified imports | Signer/verifier compatible; real store/schema and provider-authorized data ingestion unverified. No implication of measured live ranking or earned backlinks. | `SEOTAKATAK/src/auth.mjs`; `SEOTAKATAK/src/{app,store,server}.mjs`; `takatak-v1/src/lib/seo/seotakatak-bridge.ts` |
| Facturations | Independent B2B draft/approval/provider-state system; V1 JWT integration client and matching receiver contract | Dedicated DB and live provider/issuance/email/payment workflows require their own gates. Integration state is internal approval/draft state, not issuance or delivery. | `Facturations/docs/takatak-dashboard-integration-handoff-v1.md`; `Facturations/src/integration-auth.js`; `takatak-v1/src/lib/integrations/facturations/{service-token,client,contract}.ts` |
| QCMEV.CA | Dedicated fiscal receipt/queue/certificate service; receives HMAC Food Hub sales/credits/prints and returns rendered receipts | Paired HMAC and path prefix compatible. Local backend is blocked by denied verified Prisma engine download; actual runtime/DB simulator completion and regulatory DEV/ESSAI certification remain unverified. Not certified. | `QCMEV.CA/backend/src/integrations/foodhub/{CONTRACT.md,foodhub.guard.ts,foodhub.controller.ts}`; `QCMEV.CA/backend/src/bootstrap.ts`; `foodhubca/lib/foodhub/mev/{client,config}.ts`; `QCMEV.CA/READINESS.md` |
| knowledgeAI | Public curated documentation portal/API; separate private backend with RLS, JWT scopes, source approval and issuer component | Public documentation is not a private customer data bus. Private trusted issuer exists as an isolated component and is not wired into V1; no provisioned dedicated live confidential DB is established. | `knowledgeAI/README.md`; `knowledgeAI/private-knowledge/README.md`; `knowledgeAI/docs/TAKATAK-ISSUER-INTEGRATION.md`; `knowledgeAI/private-knowledge/integrations/takatak-issuer.cjs` |
| ON2GO-CLOVER | Clover app listing/config and OAuth/webhook scaffold | No package.json/build/start workflow. README still says no dedicated repository despite current checkout. This is not an independently deployable finished app. | `ON2GO-CLOVER/README.md`; `ON2GO-CLOVER/DEPLOY.md`; `ON2GO-CLOVER/config/app.config.json` |
| skip-platform-reference | Private screen/label reference evidence | Design reference only, not an API connection or operational service. Keep private capture data out of public repos. | `skip-platform-reference/README.md` |
| takatak-platform-reference | Private provider-portal reference/parity captures | Reference evidence only; a matching UI does not implement API permissions/capabilities. Keep private capture data out of public repos. | `takatak-platform-reference/README.md` |
| takatak-doordash-operations | Generic operational templates | No runtime, automation or sync service. Actual cases/evidence remain private; does not connect providers. | `takatak-doordash-operations/README.md`; `takatak-doordash-operations/AGENTS.md` |
| TAKATAKREVIEW | Empty README/documentation placeholder | No package manifest or implemented runtime integration found. Food Hub already owns review features; do not create duplicate authority solely to make every repo run. | `TAKATAKREVIEW/README.md`; `foodhubca/docs/FOOD_ECOSYSTEM_MAP.md` |

## Offline paired checks performed

`python /workspace/verify-platform-contracts.py` executes actual checked-out signing/verification functions with synthetic payloads in isolated Node VMs. Database/network/session dependencies are replaced only where unused by the functions under test. It makes no network calls and never reads or prints secret values.

Current result: **22 compatibility checks pass; zero compatibility failures; eight separate wiring/configuration gaps**.

- All nine suite apps: actual signer matches Food Hub and verifies in both directions for JSON, path/query and Unicode payloads; tampering, wrong secret and expired timestamps are denied. Actual environment readers accept the matching synthetic config. Existing POST receiver and four Food Hub route methods are checked from AST declarations.
- Food Hub → QCMEV: actual `signMev` output is accepted by actual `verifySignedRequest`, tampering/expiry denied and key rotation supported; source route/global prefixes align.
- V1 → Facturations: actual token maker is accepted by actual verifier; wrong business, expired token and wrong key denied.
- V1 → SEO: actual V1 signer is accepted by actual SEO verifier with tenant and scope preserved; wrong key and expiry denied.
- V1 → Food Hub consumer bridge: actual service authorization and actual V1 session producer/Food Hub session parser agree; wrong service token and inactive session denied; actual exchange POST route exists.

The script also uses TypeScript AST call-expression scanning to distinguish defined foundation helpers from production callers. Configuration gaps report variable names/presence in the current process only. `--strict` exits 2 when wiring/configuration is incomplete; a default zero exit means compatibility tests passed, not platform readiness.

## Hard gaps that affect the user's platform goal

1. **Merchant control-plane connection is incomplete.** Food Hub `tenant.ts` defines entitlement parsing and usage-event signing but `app/` and `lib/` contain no calls to `parseEntitlements` or `usageEvent`. V1 has scoped `/api/v1/merchants/entitlements` and `/api/v1/events` endpoints (`TAKATAK_FOODHUB_API_KEY`), whereas the old Food Hub foundation references `TAKATAK_ON2GO_HUB_KEY`. This needs an explicit client/wire-format alignment; setting the old key alone cannot connect the implementations.
2. **Session/API/runtime readiness is distinct from transport compatibility.** Current shell does not contain suite destination, ON2GO bridge, MEV, Academy or SEO application settings. This does not prove deployed settings are missing; those remain unknown. No live deployment should be called connected based on this audit.
3. **The suite has implemented transport but incomplete business consumers.** Many premium cross-app workflows are labelled future in the actual domain files. Wiring LOY4LTY to REW4RD or M4RKETING transport does not create joint reward/campaign accounting automatically.
4. **ON2GO-CLOVER is a scaffold.** It lacks a deployable package; the working consumer directory is `on2goca`. Its role should be reconciled before building an additional overlapping entry point.
5. **Current Food Hub tenant model is one instance per merchant group.** It is not evidence for shared multi-tenant table isolation. Extending to client SaaS requires authenticated tenant context and persisted tenant scoping; do not turn a slug environment variable into an authorization boundary.

## Best next acceptance checks

These are ordered to support the restaurant workflow rather than requiring every optional product first.

1. Run the suite against real local HTTP processes and dedicated ephemeral databases: install announcement → directory visible in a second app; new order → signed outbox → app storage; status change → app view; retry after receiver outage; dedupe and restart persistence. Verify independent app operation with Food Hub down.
2. Run a disposable V1/Food Hub/ON2GO identity flow through the actual 90-second one-time DB code exchange, verified-phone customer link and logout/expiry. Include replay, suspended identity, wrong workspace/product and CORS denials.
3. Exercise the actual Food Hub public feed through ON2GO's validator without overwriting tracked directory data. Verify expected schema/freshness, safe URLs and fallback disclosure. Do not infer live feed freshness from the successful static export alone.
4. After verified Prisma downloads become available, complete QCMEV's existing isolated local runner: sale/credit/reprint, idempotent replay, local queue, backend restart and exact returned receipt rendering. Regulatory DEV/ESSAI and actual physical print acceptance remain separate.
5. Implement and test Food Hub's missing V1 entitlement/usage adapter using the existing scoped master API. Preserve the locked rule that billing/control-plane failure cannot stop restaurant order intake or kitchen work.

Academy, SEO, B2B billing and private KnowledgeAI can follow independent product acceptance gates. None should be made prerequisites for receiving restaurant orders.

## Other repositories mentioned by current ecosystem docs

The selected 22 repositories are all present. The architecture also references `pppmtl` (brand storefronts), `qmaps` (places/QR), `deli-aden-online` (optional independent relay source), and `takatak-automate` (agency service marketplace). These are not present among the selected checkouts. `pppmtl` and `qmaps` are relevant when their storefront/map workflows are in scope; optional relay/agency products do not need to be connected to complete the core Food Hub screen work. Do not revive retired `takatakbackend` or an empty starter just to add repositories.

GitHub API was denied in this environment. The primary agent read the public agent board and open pull-request list through GitHub HTML; Drive and other-chat history were unavailable. No claim is made that unavailable sources were read. Private reference data is deliberately not reproduced here.

PC continuity: the full public agent-board timeline was subsequently retrieved through GitHub HTML pagination (360 timeline items, 354 comments). It confirms Windows kit installation testing and the 54-screen implementation; see [EXISTING_PC_RELAY.md](EXISTING_PC_RELAY.md). Current PC sessions and later private/Drive notes remain unverified.
