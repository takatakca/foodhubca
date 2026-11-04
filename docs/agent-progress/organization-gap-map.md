# Organization and franchise requirements: source-to-code gap map

Agent 04 · 2026-11-04 UTC · implementation branch `docs/drive-project-evidence` (coordinator publishes the isolated changes).

This maps available GitHub evidence and repository copies of Drive notes. The current Drive originals remain inaccessible; no live Drive search, identity synchronization or production deployment is implied.

## Authority and data boundaries

The [October31 round-two request](https://github.com/takatakca/foodhubca/issues/105#issuecomment-6542616510) calls for organization→brands→locations, payout trees, consolidated reporting and a campaign builder. The [ecosystem contract](../ON2GO_HUB_ECOSYSTEM.md#4-modèle-multi-marchands-tenants) defines how to add that structure without building a second account authority:

| Entity | Authoritative source | Existing contract and remaining gap |
| --- | --- | --- |
| Merchant/company account, memberships, plan, B2B billing | TAKATAK V1 `Client`, `ClientMembership`, subscription/product tables | Food Hub must not create competing customer workspaces, passwords or subscriptions to display an organization. Existing Food Hub local staff/PIN access remains its operational access boundary. |
| Master merchant and product-source mapping | V1 `MasterMerchant`, `SourceMerchant` | Source merchant mapping does not establish a `MasterMerchant`→`Client` relationship. V1's [ON2GO master-API contract](https://github.com/takatakca/takatak-v1/blob/main/docs/ON2GO_MASTER_API.md) explicitly says that relationship is absent and requires a separate approved migration. Do not invent its UUID from a slug or Clover merchant ID. |
| Food Hub current storage context | Server `tenantInfo()` / `FOODHUB_TENANT_ID`, default owner instance | [tenant.ts](../../lib/foodhub/tenant.ts) implements the H4-a foundation: one instance/group. Shared multi-merchant H4-b row columns/RLS are future work. A new organization page cannot establish distributed tenant isolation by filtering a URL parameter. |
| Operational brands and physical kitchens | Food Hub `Catalog`, saved in existing `fh_kv['catalog']` | Brands currently use exact names; kitchens use location codes. The owner's default seed is merged for its own instance. On a foreign silo, organization projection must use actual persisted definitions, including legitimate custom entries whose names match an owner seed. |
| Brand×kitchen×platform stores | `ChannelStore` in Food Hub repository | Each saved mapping carries brand name, physical location code and platform, optionally Clover merchant ID. Counts establish saved mappings, not real provider approval, current online state or successful order acceptance. |
| V1 business locations | V1 `BusinessLocation`, keyed to one `BusinessBrand` and `Client` | This differs from a Food Hub kitchen hosting several brands. A physical kitchen code cannot be converted directly into a single V1 location UUID. The mapping is many-to-many at the operational brand/kitchen level and unlinked until explicitly established. |

## Implemented coherent foundation

- [organization-view.ts](../../lib/foodhub/organization-view.ts) projects the current instance's saved hierarchy without writing data or creating accounts. Its organization ID comes from server context. External V1 client ID is explicitly `null`, link status `unlinked` and synchronization `not_verified`.
- [GET `/api/foodhub/organization`](../../app/api/foodhub/organization/route.ts) uses the existing `withPerm('view')` guard and the authenticated actor's location assignments. It accepts no caller-selected tenant or widening location scope. Strict catalog/database reads fail instead of returning a successful synthetic empty result. Successful responses are `no-store` and vary by cookie/authorization.
- Filtering happens **before** brand names, store totals or unique Clover-merchant counts are calculated. A restricted actor sees only brands actually mapped to their visible kitchens. Unassigned global brands are visible only to actors with all-instance location access.
- On a foreign instance, raw persisted catalog membership is the provenance boundary. The projection never inherits an owner's seed address/name simply because a client reused a kitchen code. A client's explicitly saved brand named like an owner seed remains visible with that client's saved facts.
- [The organization page](<../../app/(console)/organization/page.tsx>) shows the actual saved brand→kitchen→platform hierarchy, shared kitchens, authorized totals, empty/error/retry/loading states and FR/EN text. It links to existing restaurant mappings and, for administrators, business setup. It explains that account linkage remains to be confirmed and that store counts do not prove platform connectivity. The coordinator owns navigation integration.
- [Focused tests](../../tests/organization-view.test.ts) exercise many-to-many relationships, unknown assignments, foreign catalog provenance/name collisions, visibility before totals, no private IDs/addresses in the projection, fixed server tenant, actual existing authentication and storage-failure behavior.

No SQL schema, identity, billing, provider connection or customer order path was changed by this foundation.

## Remaining implementation gaps and exact next contracts

Agent 05 is separately implementing the client-side C4/source-metadata and immutable C5 outbox adapter. Its later uncompiled changes are outside this organization browser gate. V1 company linkage, billing authority and receiver-side merchant/tenant authorization still require their own contracts; the table distinguishes those from local client guardrails.

| Gap | Concrete next implementation and validation |
| --- | --- |
| Explicit V1 company linkage | Add a separately reviewed cross-repository contract resolving a Food Hub instance/local merchant to a V1 `Client` plus verified source merchant. Keep mapping server-owned and fail closed for mismatched source/key. Do not populate today's nullable client ID from display names. Approval is required for any V1 schema migration. |
| Merchant launch/SSO | Reuse the V1 signed short-lived launch/exchange pattern with merchant membership and role verification. The existing ON2GO customer launch bridge creates no workspace and is not a merchant-admin authority. Revocation and wrong-source/expired-code tests are required before replacing local operational access. |
| C4 entitlements transport and shape | Food Hub's `parseEntitlements()` expects `{plan,features,limits}`. V1's current `/api/v1/merchants/entitlements` returns source-synchronized merchant subscription fields, not that shape or a verified Stripe `Client` plan. Add an explicit adapter/contract only after defining the missing company linkage; test source scope, disabled/revoked access and cache behavior. A billing outage must never stop an incoming order. |
| Shared H4-b tenancy | Requires request-derived tenant context, tenant columns across every relevant `fh_*` read/write and RLS as second defense. Current one-instance projection must not be advertised as multi-tenant authorization. Test two tenants with identical brand/location identifiers and malicious cross-tenant reads/writes before shared-instance provisioning. |
| Stable cross-system brand/location IDs | Preserve current operational name/code keys while introducing explicit nullable references with ownership checks. A rename cannot silently detach historical orders or reinterpret another brand's store. Test shared kitchen, one brand across kitchens, same names in different V1 companies and stale/deleted mappings. |
| Organization payout tree | Aggregate only records already attributed to authorized brand/location/platform. Provider-wide statements or unattributed lines remain visibly unallocated; do not distribute them by guessed percentages. Verify amounts reconcile and imports preserve provider/scope boundaries. |
| Consolidated reports | Reuse Food Hub authorized order/reconciliation sources; apply location scope before aggregation and avoid counting the same platform store/order through two paths. Show data coverage and unknown amounts explicitly. Cross-system business invoices, app subscriptions and restaurant sales receipts remain separate ledgers. |
| Campaign builder | Existing M4RKETING app/scaffold and provider capabilities are the starting points, not proof of live campaign APIs. Define draft/action/approval contracts per provider, reconcile campaign budgets and permissions, and test the actual authorized provider write path before claiming DoorDash-level publication. |
| Actual rollout | Publish the reviewed Food Hub revision using the existing native Coolify controller, then prove exact release, health and anonymous organization401. Authenticate an isolated restricted user and inspect the rendered organization tree. No current cloud access establishes live control-plane state. |

## Production diagnosis supported by current evidence

Food Hub's native resource is `1ijktzayh4dbcnn37igo8ktv`, root Dockerfile/port3000; ON2GO's is `fbrbc9iwwbgisdeaseg8tu6n`, `Dockerfile.coolify`/port8080. Both historical Actions deployment writers are deliberately disabled. Native GitHub App webhook state, intended branch/SHA, `SOURCE_COMMIT` availability, first failed build log and runtime health must be read from those existing resources. Enabling a second writer is not a diagnosis.

Current source reveals two concrete release gates: missing/invalid build-time `SOURCE_COMMIT` fails a build; Food Hub's documented Coolify health override must use its Node runtime checker rather than missing curl/wget. Old notes record an October30/31 server incident. None of these facts establishes the current cause without native logs.

[verify-platform-readiness.mjs](../../scripts/verify-platform-readiness.mjs) now separates proxy CONNECT rejection, DNS/TLS/timeout, wrong deployed revision, redirects, unhealthy storage, missing routes, CORS failures and soft HTTP200 HTML. It pins both independent expected 40-character revisions before any request and performs no authenticated write or deployment. It uses public reads/preflights and deliberately invalid anonymous `PUT {}` probes for the saved-list routes. Passing these checks does not prove authenticated persistence or provider order acceptance; those remain separate acceptance steps.

Adversarial review: no organization authorization/provenance blocker found. Three diagnostic/lifecycle findings were fixed before the final source freeze: seven-check health validation, curl URL-glob prevention and suppression of intentional-navigation abort noise. The two focused suites pass 41/41 tests; scoped lint is clean. An earlier workspace typecheck passed; the final repeat encountered missing generated `.next/types` files while shared build artifacts were being regenerated, so the coordinated post-build typecheck remains the final gate. Final actual-browser acceptance now passes 13/13 check groups on the fresh combined organization/navigation/avatar build: all four FR/EN desktop/mobile WCAG scans have zero violations; restricted users, refresh, drilldown and overflow checks pass. It does not certify production or later uncompiled control-plane changes.

— signed: Codex (`drive_research`, agent 04) @ Codex cloud · 2026-11-04 UTC
