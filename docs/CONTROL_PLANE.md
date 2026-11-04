# Food Hub → TAKATAK control plane

This implementation connects Food Hub's existing background runner to the unchanged TAKATAK V1 merchant/status and event endpoints. It does not create or link identities, perform billing, change feature rights or depend on a control-plane response to receive, pay, prepare or print an order.

## Exact server configuration

Set these **server-only** values on Food Hub after the matching `foodhub` source merchant already exists in V1:

```dotenv
FOODHUB_TENANT_ID=your-group
TAKATAK_CONTROL_PLANE_URL=https://your-existing-control-plane.example
TAKATAK_FOODHUB_API_KEY=<dedicated V1 foodhub-scoped key, at least 32 characters>
FOODHUB_CONTROL_PLANE_MERCHANTS={"instanceTenantId":"your-group","merchants":[{"localVendorId":"existing-source-id","masterMerchantId":"818b8f9c-3fcf-4ab9-bf76-8b34c3be4fd9","locationCodes":["EXISTING_LOCATION"]}]}
```

The UUID above is an example, not a live merchant. Obtain actual mappings from the authorized administrator's existing merchant records. Every location maps to exactly one existing source/master merchant; overlapping locations, duplicate source IDs, mismatched instance IDs, malformed URLs and missing keys disable reporting. Maximum 32 merchant groups and 100 locations per group. HTTPS origin only; localhost HTTP is accepted for isolated tests. Changing a URL, instance or mapping holds the old queue for administrator review; it never silently redirects events to a new merchant. Key rotation on the same mapping retains event IDs.

Food Hub uses one explicit instance tenant. This is not new row-level multi-tenant isolation. The default `takatak` identity in the historical health helpers is **not** accepted as an implicit reporting authorization. Existing health `controlPlane.configured` describes transport URL/key presence; the restricted status below also validates the explicit mapping and durable repository.

V1 authenticates `Authorization: Bearer TAKATAK_FOODHUB_API_KEY`, scoped to `foodhub`. It does **not** verify the historical `TAKATAK_ON2GO_HUB_KEY`/HMAC contract. Never expose either key in the browser. Existing signing helpers remain for their separate callers (including MEV); this transport does not claim HMAC verification.

## What is sent and read

- C4: `POST /api/v1/merchants/entitlements` with `{source_application:"foodhub",local_vendor_id}`. A known response must match the explicitly expected master UUID. `known:false` means unlinked. No automatic resolve/create operation is called.
- The returned name, marketplace status, subscription status and plan are source-synchronized metadata. They are **not** authoritative Stripe subscription rights or feature/limit gates. The owner screen labels the last reported plan and check time; no operation is restricted from this response.
- C5: `POST /api/v1/events`, a UUIDv5 `event_id`, matching `Idempotency-Key`, `event_type` (`order.created` or `order.fulfilled`), `aggregate_type:"order"`, opaque UUIDv5 `aggregate_id`, `source_application:"foodhub"` and only `{local_vendor_id,master_merchant_id,occurred_at,counts:{orders:1}}` in `payload`.
- No customer ID/pseudonym, name, address, phone, item, amount, payment/card field or provider payload is sent. In particular no `customer_local_id`, `customer_local_reference` or `guest_reference` is sent: V1 can otherwise perform customer resolution implicitly.
- The current V1 key authorizes a source application, **not each individual merchant**. Local mapping checks guard configuration mistakes; they do not replace a future receiver-side merchant authorization binding. V1's generic event handler does not itself verify order-event merchant ownership. This remains a receiver-side limitation.

## Durable observer and retries

The first background tick establishes a persisted monitoring start; existing historical orders are not backfilled. Later ticks read at most 100 persisted orders by `(updated_at,id)` with a stable cursor. They observe the latest saved state, not every intermediate transition. Only actual `status === completed` creates a fulfillment event; payment, acceptance, readiness and printing are insufficient. A preexisting order completed after monitoring begins can emit a completion count without a historical creation count.

`fh_kv` atomically freezes each event's first serialized body and keeps the observation cursor. `fh_docs` stores queue, retry and merchant-check state. A failed enqueue or invalid canonical claim holds the cursor; a crash before document creation is repairable on the same cursor. Existing source mappings and durable Supabase storage are required for production reporting; production memory mode skips it. These existing collections require no new tables. Optionally apply `supabase/control-plane-indexes.sql` after `foodhub.sql` for the update cursor and pending lookup indexes.

V1 hashes the **entire original body bytes** and has globally unique event IDs. Retrying with the same UUID but a regenerated timestamp/key order can return 409. This sender persists the raw JSON once, retries those exact bytes and namespaces UUIDs by instance + mapped merchant + internal order + event kind. Its response check validates the returned aggregate and V1 synchronization-row UUID; that row UUID is not the request event UUID. Lost responses and concurrent exact-byte replays are deduplicated by the receiver.

Networking runs last in the existing long-running watcher and authenticated `/api/foodhub/cron/watch`, never in webhook/checkout/printing handlers. Each request has a 1.8-second timeout, response cap and redirects disabled. A tick refreshes at most two merchant groups and attempts at most four events after a successful current mapping read. Retries back off from 30 seconds to one hour and honor bounded numeric or HTTP-date `Retry-After`. 400/409 require manual review; transient/auth/network failures remain pending. No reporting exception is allowed to become an order exception. On serverless hosting keep the existing authenticated cron scheduled; disabling the watcher without a cron also pauses reporting.

The operational repository is a latest-state observer with a single-instance timestamp cursor, not an atomic transaction/change-data-capture journal. It cannot reconstruct overwritten intermediate states or certify a billing ledger. Queue/status reads are bounded (1,000 pending candidates per group, 2,000 status documents); the screen reports limited counts. Mapping changes require explicit queue review rather than rekeying or resending old records automatically. Keep database retention/backlog monitoring on the normal administrative release checklist.

## Review and verification

The existing `admin` permission (currently owner) protects `GET /api/foodhub/control-plane`. There is no browser merchant selector, secret read/write or generic proxy. Settings → Connected apps shows configuration, historical mapping/check data, durable storage and queue counts, without claiming a live provider connection. It exposes no mapping IDs, raw event bodies, endpoint URLs or credentials.

```sh
npx vitest run tests/control-plane.test.ts tests/tenant.test.ts
node scripts/verify-control-plane.mjs --out private/verification/control-plane.json
```

The unit contract fixture executes unchanged V1 source/auth/parser handlers when the selected sibling `takatak-v1` checkout is present; standalone Food Hub CI labels its wire stand-in and skips the paired-source assertion. No V1 source is modified. The durable runner creates disposable PostgreSQL 16 + PostgREST 12.2.3 services, uses the actual Food Hub repository/outbox in two fresh test processes, drops one HTTP acknowledgement and verifies exact-byte replay, nested ownership filters and tied timestamp pagination. Its HTTP receiver is an isolated stand-in, not a production V1 service. Test children receive an explicit runtime/proxy/CA environment allowlist plus synthetic credentials; application/provider credentials are not inherited. Own containers/network are cleaned at exit. Cached Docker images and local dependencies are prerequisites.

See [sanitized proof](agent-progress/control-plane-proof.json). These local tests certify the implemented contracts and durable retry path; deployment, a production database and authorized real merchant mappings/keys remain separate release work. No live connection, feature entitlement, billing, identity mutation or provider transaction is certified.
