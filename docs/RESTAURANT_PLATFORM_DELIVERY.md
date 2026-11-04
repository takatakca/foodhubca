# Restaurant platform delivery and acceptance

## Verified combined candidate — November 4, 2026

Runtime source: `12dc660c05c08aecbd683f9bc90e5c476274b8e1`, build `yhf2mGUexeH-1RWM0dX4e`, pruned image `sha256:b3f83baec1d042fe4a0268e7031063e290fd831f3d6feab0d326b2b6e506a1d2`. The source is pushed on `feature/restaurant-experience`; later evidence-only commits may advance that branch. ON2GO companion: `feature/on2go-customer-experience` at `237a0258f6df0263a30c33c12f09ca740d1cfc41`.

The five individually followable branches and work discussions are in [the agent index](agent-progress/README.md). Use the coordinated backend and companion branch set for release. Individual worker snapshots contain their owned source and common prerequisites; the final browser evidence is captured on the combined runtime above. No current public deployment is inferred from these branches or tests.

Implemented and reviewed:

- Public Food Hub: real restaurant photography, four actual local product films, concise FR/EN journeys, pricing, provider/Clover availability, kitchen, Phone AI, help and native contact forms. Requests reach the existing owner-only inbox with source/language attribution and durable exact-request retries. Acceptance means the request is stored; actual email delivery is separately observed.
- ON2GO/direct ordering: server-priced quote review, explicit reapproval after price changes, durable idempotent checkout, response-loss recovery, receipts and independent optional order-update SMS choices.
- Accounts: owner-aware address/favourite editing, explicit stale-revision conflicts and preserved drafts, serialized writes, secure sign-in/storage recovery and independent preferences. Conditional row-version writes protect concurrent profile/verification/identity/deletion changes. Valid large Unicode profiles remain editable without oversized URLs. Default document read shapes remain unchanged; CAS readers explicitly request versions. No schema migration is introduced.
- Operations: provider/location workspaces and the 54-slot wall; scoped Orders/disputes and organization views; paid-held, uncertain Clover and late/extra-payment follow-through. The direct board includes older unresolved work, applies database scope before limits, validates courier ownership, bounds lookup URLs and discloses incomplete coverage.
- Connected apps: signed nine-app transport/directory/replay checks; read-only LOY4LTY/REW4RD balances; actual V1 application-scoped Bearer reporting with durable immutable usage events. Nine companion Clover installation paths verify authoritative merchant identity before saving credentials/billing.
- M4RKETING: merchant-owned campaign draft, current Clover preview, approval of that exact version and current-consent CSV export, including role/tenant boundaries and concurrent-edit refusal. V1 retains its original fonts using integrity-locked local assets and licenses.

| Final check | Observed result |
| --- | --- |
| Food Hub unit / TypeScript / lint | 2,332 passed; 25 skipped; typecheck passed; 0 lint errors/1 existing devices warning |
| Production dependency audit | 0 vulnerabilities |
| Actual Docker release build | Production build, 644 simulated acceptance checks, pruning and final build-smoke passed |
| Actual pruned runtime + PostgreSQL | Strict release/health/directory/login/protected-order probe passed twice; database=ok; genuine watch/recovery execution; application remains on an internal network |
| ON2GO/Food Hub built-browser + PostgreSQL | 15 passed using the unchanged image output; includes response loss/restarts, actual contact/inbox and two-server order/list races |
| PostgreSQL crash recovery | 25 passed; server-owned recovery timer; no duplicate order/Clover/ticket/acceptance |
| Customer concurrency and valid-size PostgreSQL | 12 passed; largest conditional URL 157 bytes versus old 28,585/HTTP431 |
| Operator read scope/batching + PostgreSQL | 2 passed; 500/500 deliveries in 6 HTTP 200 batches, maximum 3,562-byte request target |
| Final-image operator browser | 27 passed; 8 FR/EN mobile/desktop axe scans, 0 violations/page errors/overflow |
| Final-image contact browser | 32 passed; 20 Phone AI/query/language repetitions; 4 axe scans, 0 violations/page errors/overflow |
| ON2GO companion | 120 unit tests, 107 exported entries, 100-page site check; 56 fixture browser cases |
| Nine companion Clover apps | 505 unit tests; all 9 typechecks and normal production builds; 9/9 signed source-contract pairs |
| M4RKETING workflow + PostgreSQL | 9 browser/concurrency checks; 0 external messages/provider writes |
| V1 local fonts | Production build/105 static pages; 6 font byte matches, 5 licenses, 3 browser states; DB runtime separately unverified |

[Machine-readable verification](agent-progress/release-verification.json) · [Docker transcript](agent-progress/evidence/release-2026-11-04/docker-checks.txt) · [Crash transcript](agent-progress/evidence/release-2026-11-04/crash-checks.txt) · [Clean main merge proof](agent-progress/evidence/release-2026-11-04/merge-proof.json) · [Compiled-artifact origin](agent-progress/evidence/release-2026-11-04/build-origin.json).

[Actual cross-repository proof](agent-progress/evidence/ordering-recovery/results.json) · [Source/build provenance](agent-progress/evidence/ordering-recovery/provenance.json) · [Contact accepted](agent-progress/evidence/ordering-recovery/contact-accepted-fr.png) · [Owner inbox](agent-progress/evidence/ordering-recovery/contact-owner-inbox.png) · [Payment/tracking mobile](agent-progress/evidence/ordering-recovery/ordering-tracking-mobile.png) · [Customer size/concurrency proof](agent-progress/evidence/customer-concurrency/postgres-proof.json). Operator and contact screenshots/scans are linked from their individual agent logs.

All service receivers and records in these checks are isolated stand-ins/synthetic. The pruned container was tested directly; its unchanged compiled output was also extracted for the two-process host runners using the identical lockfile. Test preparation removed only two completed synthetic crash orders so unrelated incoming alerts did not obstruct the merchant-inbox journey. The operator harness isolates the same unrelated alerts in its fixture responses. Actual alert behavior remains covered separately by platform acceptance.

A first coupled run during environment startup load timed out on a saved-restaurant check. Two quiet real-API diagnostics confirmed correct ownership, revision and persistence (the cold confirmation returned the read in 78 ms and write in 44 ms), followed by the unchanged 15-check runner passing. No app or timeout change was made. An earlier host-only intermittent React hydration warning did not recur in the final unmodified-image 32 contact groups/20 repeats; its cause is not asserted to have been fixed.

The initial full container gate also caught legacy document-shape regressions and a wall-clock-dependent Clover test. The final code preserves exact legacy reads and verifies the 150 ms response budget independently from the 400 ms refresh deadline with controlled timers. Both original mapping assertions remain unchanged. The full final container gate passed after those corrections.

Four 30-second FR/EN landscape/square films, posters, SRT/VTT, source credits and verification are in [the media package](media/product-film-2026-11-04/README.md). They use real local app recordings and restaurant photographs with fictional test records. Existing private PC reels and approved Canva/Runway originals remain to be reconciled through actual access.

Production/service acceptance remains open. The 54-slot wall does not establish 54 signed-in merchant sessions. Real provider approvals/transactions, the existing PC status, current Drive originals and native release verification require working authorized access. Broader master/franchise write administration and automatic campaign triggers/delivery remain separately scoped work; the verified reporting, organization projection and reviewed export do not establish those features. V1 database runtime and QCMEV native Prisma setup retain their documented prerequisites.

## Roles and data flow

ON2GO is the diner discovery, restaurant and ordering site. Food Hub is the restaurant operating workspace: delivery channels, menus, locations, kitchen, finance and merchant-screen wall. Clover is connected through the existing merchant authorization and order path. The nine suite apps keep their own data and exchange signed authorized events through Food Hub. TAKATAK identity/control-plane bridges remain separate from Food Hub's restaurant/customer records.

Every store must keep one order ingestion path (`direct`, `via Clover` or its configured relay). Adding dashboards or screen sessions must not create a second ingest path. Provider workspace selection changes the operator's view and scope; provider approvals, actual account sign-ins and API activation are separate observable states.

## Companion ON2GO customer contract

The browser uses `/api/public/on2go/*` on Food Hub and an ON2GO-signed customer token in `Authorization`. It never receives the server's website secret. Allowed browser origins remain the configured ON2GO sites. Each route authenticates the customer and writes only that customer's record.

| Route | Contract |
| --- | --- |
| `GET /api/public/on2go/me` | Public customer, structured addresses/favourites and their `addressesRevision`/`favouritesRevision`, separate preferences, recent website orders, available loyalty/gift-card adapter state |
| `PUT /api/public/on2go/me/addresses` | `{addresses:[{label?,street,unit?,city,province,postalCode,instructions?}],expectedRevision?}`; existing validator, maximum five, normalized Canadian postal codes |
| `PUT /api/public/on2go/me/favourites` | `{favourites:[restaurantReference],expectedRevision?}`; existing validator, maximum fifty unique references |
| `PATCH /api/public/on2go/me` | Existing profile fields plus optional partial `preferences:{orderUpdates?,offersSms?,offersEmail?}`; strict boolean channel values |

Saved lists have an 8 KB JSON bound; profile requests retain the 2 KB default. Invalid requests save nothing. Data uses the existing customer document, a local contention lock and a conditional database row-version write. Optional list revisions preserve legacy replace requests; current ON2GO sends the observed revision. A stale list returns HTTP409 with the current list/revision; it never silently overwrites the other device. No new database table or migration is required. Preferences are independently stored; opting into email does not enable SMS or change legacy `marketingConsent`. This stores choices; it does not implement a new campaign sender. Account deletion drops preferences and invalidates existing customer tokens.

The ON2GO companion aligns structured Canadian address forms, max-five/max-fifty limits, actual order date/name fields, published storefront slugs and visible retry states. Balance adapters require explicit matching configuration on Food Hub and their respective suite app; an unconfigured or unavailable provider is not displayed as a known zero. See [balance contract and configuration](CUSTOMER_SUITE_BALANCES.md).

## Reproducible verification

After building both Food Hub and ON2GO, run `node scripts/verify-on2go-customer-bridge.mjs` from Food Hub. It serves both builds locally, preserves the actual ON2GO/Food Hub browser origins through Playwright forwarding, and uses an isolated local SMS transport. It exercises the real sign-in forms, saved restaurant, address, separate channel choice and a second empty browser. All external browser requests are refused. No real texts, provider accounts or production databases are used. Set `ON2GO_BRIDGE_ORDERING=true` to include quote changes, lost checkout responses, receipt and native storefront cases. `ON2GO_BRIDGE_PARALLEL=true` additionally requires the real local database and exercises simultaneous checkout through two actual Food Hub processes; it synchronizes real counter reads without altering their database responses, and verifies conflicting saved-list edits through those same two workers. `ON2GO_BRIDGE_CONTACT=true` adds the real merchant contact/inbox journey and response-loss recovery across a process restart.

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using a system Chromium. Optional `ON2GO_BRIDGE_OUTPUT` saves sanitized screenshots and a result file. `ON2GO_WORKSPACE_ROOT` selects the companion checkout. To prove persistence across a Food Hub process restart, supply both `ON2GO_BRIDGE_POSTGREST_URL` and `ON2GO_BRIDGE_SERVICE_KEY` for a throwaway loopback Postgres/PostgREST schema. The runner refuses a remote database. Its result explicitly records ephemeral-memory versus real local Postgres mode.

The existing `verify-platform-workspaces.mjs` checks 54 synthetic sessions and workspace behavior. `verify-suite-workspace.cjs` checks the nine actual sibling source contracts. `npm run verify:foodhub` drives simulated delivery/Clover workflows; `npm run verify:crash` additionally needs throwaway Postgres/PostgREST and verifies crash recovery. These checks establish the behavior tested, not live provider operation.

## Production order

Use the existing native Coolify GitHub App controller, not an additional competing deploy writer. Food Hub resource: `1ijktzayh4dbcnn37igo8ktv`, Dockerfile `/Dockerfile`, port 3000. ON2GO resource: `fbrbc9iwwbgisdeaseg8tu6n`, `/Dockerfile.coolify`, port 8080. These identifiers come from repository deployment notes; current control-plane state is not verified here.

1. Deploy the reviewed Food Hub backend first. Confirm durable database configuration, stable session secret, required SMS/identity services, and build-time `SOURCE_COMMIT`. Preserve existing media volume and Windows relay profiles.
2. Confirm the exact served Food Hub SHA, health, anonymous orders rejection, origin preflights and authorized saved-data persistence.
3. Build/deploy reviewed ON2GO with the correct `NEXT_PUBLIC_FOODHUB_URL`; confirm exact release on apex, www and preview, then FR/EN assets and desktop/mobile customer flows.
4. Verify one authorized restaurant's end-to-end service flow: menu, order, Clover, kitchen/printing, cancellation/refund and reconciliation as supported by its actual provider access. Check suite event effects and replay protection. Inspect the existing PC's read-only status before extending its 54-account setup.

Live-site requests are currently blocked by this environment's enforced network proxy, and no Coolify credential/connector is configured. Git transport temporarily failed with 401/502 during an executor disconnect, then authenticated read/push recovered after reconnection; the verified source `12dc660` is now pushed. GitHub API access still returns Forbidden and live-domain access still returns proxy CONNECT403, so PR/native release and exact public SHA remain unverified. An environment configuration draft has saved the requested live domains, but publication/application of that draft is still a separate environment-settings step. No current production result can be inferred from proxy CONNECT 403, a branch push or a successful local build.

— signé : Codex @ Codex cloud · 2026-11-04
