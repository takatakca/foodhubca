# Restaurant platform delivery and acceptance

## Verified local delivery — November 4, 2026

Five individual review branches and their visible progress logs are linked in [the agent index](agent-progress/README.md). The coordinator branch is `feature/restaurant-experience`; the ON2GO companion is `feature/on2go-customer-experience`.

- Food Hub full suite: 2,091 passed, 12 skipped. Final visual/copy corrections: 63 focused tests passed, followed by a successful production rebuild. TypeScript passed; lint has zero errors and one pre-existing devices-page warning.
- Existing simulated platform acceptance: 644 passed, zero failed. Actual local PostgreSQL crash replay: 25 passed, zero failed. The database is real; delivery/Clover services are local stand-ins.
- Actual built ON2GO → built Food Hub browser flow: six checks passed, including a second empty browser and account/token persistence across a Food Hub restart on local Postgres/PostgREST. SMS is simulated; no external texts are sent.
- Nine actual sibling suite source-contract pairs passed. Fifteen built-app workspace checks passed, including all 54 synthetic sessions, provider switching, delayed-response protection and desktop/mobile accessibility.
- Final marketing review: eight FR/EN viewport states, eight media checks, two axe scans with zero violations. Dashboard review: twelve browser checks with zero page errors and no serious/critical axe violations.
- Four finished 30-second FR/EN landscape/square screen/photo films, posters, SRT/VTT, provenance and verification are in [the media package](media/product-film-2026-11-04/README.md). They use actual local app recordings and fictional records. They are not Runway output or recordings of the owner's PC sessions.

Production connectivity and release are not verified. Remaining source gaps include the complete franchise/organization layer, advanced order issue/outcome/courier filters, campaign parity, and working loyalty/gift-card provider adapters. Their audit status must not be replaced by a general “platform complete” claim.

## Roles and data flow

ON2GO is the diner discovery, restaurant and ordering site. Food Hub is the restaurant operating workspace: delivery channels, menus, locations, kitchen, finance and merchant-screen wall. Clover is connected through the existing merchant authorization and order path. The nine suite apps keep their own data and exchange signed authorized events through Food Hub. TAKATAK identity/control-plane bridges remain separate from Food Hub's restaurant/customer records.

Every store must keep one order ingestion path (`direct`, `via Clover` or its configured relay). Adding dashboards or screen sessions must not create a second ingest path. Provider workspace selection changes the operator's view and scope; provider approvals, actual account sign-ins and API activation are separate observable states.

## Companion ON2GO customer contract

The browser uses `/api/public/on2go/*` on Food Hub and an ON2GO-signed customer token in `Authorization`. It never receives the server's website secret. Allowed browser origins remain the configured ON2GO sites. Each route authenticates the customer and writes only that customer's record.

| Route | Contract |
| --- | --- |
| `GET /api/public/on2go/me` | Public customer, structured addresses, favourites, separate preferences, recent website orders, available loyalty/gift-card adapter state |
| `PUT /api/public/on2go/me/addresses` | `{addresses:[{label?,street,unit?,city,province,postalCode,instructions?}]}`; existing validator, maximum five, normalized Canadian postal codes |
| `PUT /api/public/on2go/me/favourites` | `{favourites:[restaurantReference]}`; existing validator, maximum fifty unique references |
| `PATCH /api/public/on2go/me` | Existing profile fields plus optional partial `preferences:{orderUpdates?,offersSms?,offersEmail?}`; strict boolean channel values |

Saved lists have an 8 KB JSON bound; profile requests retain the 2 KB default. Invalid requests save nothing. Data uses the existing customer document and update lock. No new database table or migration is required. Preferences are independently stored; opting into email does not enable SMS or change legacy `marketingConsent`. This stores choices; it does not implement a new campaign sender. Account deletion drops preferences and invalidates existing customer tokens.

The ON2GO companion branch aligns structured Canadian address forms, max-five/max-fifty limits, real order date/name fields, published storefront slugs, and visible retry states. Rewards and gift-card provider adapters remain separate unfinished work; their mere endpoint configuration must not be presented as a working balance integration.

## Reproducible verification

After building both Food Hub and ON2GO, run `node scripts/verify-on2go-customer-bridge.mjs` from Food Hub. It serves both builds locally, preserves the actual ON2GO/Food Hub browser origins through Playwright forwarding, and uses an isolated local SMS transport. It exercises the real sign-in forms, saved restaurant, address, separate channel choice and a second empty browser. All external browser requests are refused. No real texts, provider accounts or production databases are used.

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using a system Chromium. Optional `ON2GO_BRIDGE_OUTPUT` saves sanitized screenshots and a result file. `ON2GO_WORKSPACE_ROOT` selects the companion checkout. To prove persistence across a Food Hub process restart, supply both `ON2GO_BRIDGE_POSTGREST_URL` and `ON2GO_BRIDGE_SERVICE_KEY` for a throwaway loopback Postgres/PostgREST schema. The runner refuses a remote database. Its result explicitly records ephemeral-memory versus real local Postgres mode.

The existing `verify-platform-workspaces.mjs` checks 54 synthetic sessions and workspace behavior. `verify-suite-workspace.cjs` checks the nine actual sibling source contracts. `npm run verify:foodhub` drives simulated delivery/Clover workflows; `npm run verify:crash` additionally needs throwaway Postgres/PostgREST and verifies crash recovery. These checks establish the behavior tested, not live provider operation.

## Production order

Use the existing native Coolify GitHub App controller, not an additional competing deploy writer. Food Hub resource: `1ijktzayh4dbcnn37igo8ktv`, Dockerfile `/Dockerfile`, port 3000. ON2GO resource: `fbrbc9iwwbgisdeaseg8tu6n`, `/Dockerfile.coolify`, port 8080. These identifiers come from repository deployment notes; current control-plane state is not verified here.

1. Deploy the reviewed Food Hub backend first. Confirm durable database configuration, stable session secret, required SMS/identity services, and build-time `SOURCE_COMMIT`. Preserve existing media volume and Windows relay profiles.
2. Confirm the exact served Food Hub SHA, health, anonymous orders rejection, origin preflights and authorized saved-data persistence.
3. Build/deploy reviewed ON2GO with the correct `NEXT_PUBLIC_FOODHUB_URL`; confirm exact release on apex, www and preview, then FR/EN assets and desktop/mobile customer flows.
4. Verify one authorized restaurant's end-to-end service flow: menu, order, Clover, kitchen/printing, cancellation/refund and reconciliation as supported by its actual provider access. Check suite event effects and replay protection. Inspect the existing PC's read-only status before extending its 54-account setup.

Live-site requests are currently blocked by this environment's enforced network proxy, and no Coolify credential/connector is configured. An environment configuration draft has saved the requested live domains, but publication/application of that draft is still a separate environment-settings step. No current production result can be inferred from proxy CONNECT 403, a branch push or a successful local build.
