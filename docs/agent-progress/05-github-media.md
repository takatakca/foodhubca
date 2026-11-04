# Agent 5 — GitHub, product media and customer app integration

Updated: 2026-11-04, Codex cloud. Review branch: `feature/foodhub-media-production` (publication coordinated by the parent agent; this worker does not switch or commit the shared checkout).


## Continued delivery — durable TAKATAK control-plane transport

The missing production callers of the old tenant foundations have been replaced with a wire-compatible client and a background observer/outbox under `lib/foodhub/control-plane/`. The unchanged V1 source was audited and exercised directly in contract tests. It uses the dedicated `TAKATAK_FOODHUB_API_KEY` Bearer credential, **not** historical HMAC headers or the old `TAKATAK_ON2GO_HUB_KEY`. V1 remains read-only because another agent owns its active work.

- Configuration requires an explicit instance ID and existing source/master-merchant/location mapping. A current C4 response must match the expected master UUID before events are sent. No identity resolution/creation or browser mapping override is available. Changed mappings hold old pending events for administrator review.
- C4 returns source-synchronized merchant/subscription metadata. The owner status widget labels the last reported plan/check; it does not invent feature rights, Stripe authority or billing gates. The existing `admin` permission protects the status route. No endpoint, keys, mapping IDs or raw event payloads are returned.
- C5 observes persisted `order.created` and actual `status === completed` only. It sends opaque mapped identifiers, timestamp and one order count, with no customer, payment, amount, item or provider payload. Paid, accepted, ready or printed do not imply fulfilled.
- Existing `fh_kv`/`fh_docs` hold the immutable original JSON bytes, deterministic UUIDv5, change cursor, merchant observations and retries. Corrupt/mismatched canonical claims or failed enqueues hold the cursor. Exact-byte retries preserve V1's global UUID/raw-body-hash deduplication contract. A 409 requires manual attention; transient failures back off with bounded Retry-After. Production memory mode does not report.
- Networking runs last in the existing watcher/authorized cron, with bounded request size/timeout, group rotation and send budget; order intake, payment and printing paths do not call it. No reporting exception becomes an order exception.
- The actual PostgreSQL 16/PostgREST 12.2.3 proof passed through two fresh application test processes. A lost HTTP acknowledgement caused three requests for two unique event counts; the retry body was byte-identical after restart. Durable cursor/queue state, nested ownership containment before limit2 and tied six-fraction UTC timestamp/id pagination passed. The receiver in that restart proof is explicitly an isolated HTTP wire stand-in. Separate contract tests execute unchanged actual V1 handlers/auth/parser in this selected multi-repository workspace, with a synthetic receiver DB fixture.
- The focused control-plane/tenant suite passed 22/22, targeted ESLint and runner syntax passed, and the final durable proof rerun passed. A full typecheck completed with no C5-file errors; concurrent payment-source narrowing errors were sent to that file’s owner, who reports them corrected. The parent tracks the final global typecheck/build. Reproducible command: `node scripts/verify-control-plane.mjs`; [sanitized proof](control-plane-proof.json), [contract/configuration/limits](../CONTROL_PLANE.md). No source build was run by this worker during the shared release window.

Material limits: V1's key is application-scoped, not bound receiver-side to individual merchants; local mapping validation is not a substitute for that future receiver authorization. The observer sees the latest persisted state, starts monitoring now without historical backfill and is not a transaction/billing journal. Status/backlog scans are bounded and report limited counts. Real URLs, authorized mappings, durable production storage and deployment still need the normal release path. No live connection, new feature authority, identity write, billing sender or production transaction is claimed.

## Continued delivery — verified loyalty and gift-card balances

The stale Food Hub adapters claimed the suite apps did not exist. The actual LOY4LTY membership and REW4RD card stores were audited, then connected through new read-only signed app routes and Food Hub adapters. The shared nine-app kit and all enrollment/earning/issuance/redemption/payment semantics remain unchanged.

- [LOY4LTY feature branch](https://github.com/takatakca/LOY4LTY/tree/feature/customer-balance-bridge), head `65b77a2`: typecheck, 39 tests and production build passed.
- [REW4RD feature branch](https://github.com/takatakca/REW4RD/tree/feature/customer-balance-bridge), head `1c2cb0b`: typecheck, 38 tests and production build passed.
- Food Hub adapters re-read the live verified customer, token version and website tenant; derive the existing merchant-scoped pseudonym; sign the server-only request; validate context/nonce/financial data; return only points or masked card suffix/balance and safe program metadata. A missing membership or unavailable service is not converted to zero.
- Both servers require an explicit website-to-one-merchant mapping and a matching per-app suite key. The app requires an active installed merchant. Independent programs are never pooled. No browser phone/reference/merchant override, bearer card code/hash or cross-merchant card data is accepted/exposed.
- Requests/responses are bounded; redirects are refused; requests expire and have durable replay protection. Production reads require PostgreSQL. Truncated scans fail closed. Current scaling limit is fewer than 10,000 records per mapped merchant and at most 100 linked cards.
- [Contract and configuration](../CUSTOMER_SUITE_BALANCES.md); [sanitized proof](customer-suite-proof.json). `node scripts/verify-customer-suite.cjs` reproduced 12 live assertions around two actual app servers, two real PostgreSQL schemas and two process restarts, plus active scope/replay/business-record checks. Authenticated ON2GO `/me` uses token context and ignores query overrides. Food Hub's customer fixture store was memory; app ledgers/replay records were real PostgreSQL. No actual Clover OAuth, payment or production deployment certification is implied.
- The reproducible runner uses an explicit fixture environment allowlist for app/test children; it excludes inherited application/provider credentials, preserves required proxy/CA runtime settings, and cleans its own local services/container. Final hardened run passed.

Deployment still requires the reviewed Food Hub/app branches, actual server URLs/keys, explicit authorized mappings, PostgreSQL and installed merchant records. These are implemented and locally verified connections, not an assertion that production is configured. No source branch was merged to main or deployed by this worker.

## Completed

- Searched all 22 selected repositories and the full available public agent-board snapshot for Food Hub, ON2GO, Clover, restaurant, photography, Canva, Runway and video requirements. The evidence summary is [media-requirements-evidence.md](media-requirements-evidence.md).
- Located prior Food Hub PR #140: its notes report 47 locally rendered reels and posters on the owner's PC. The binaries are not available in this cloud checkout. They were not regenerated by Runway and were not published, according to the original notes. The reusable recorder was recovered from Git without switching application branches.
- Identified 167 existing ON2GO dish-photo files, 17 logo previews and five explicitly licensed Unsplash context photos in the TAKATAK website repository. Distinguished restaurant-menu photos from the separate ChatGPT image library. The official brand-master PNG files are absent from the knowledge repository's brand folder.
- Recorded six actual local Food Hub clips with synthetic data: kitchen/new order, order board and the tablet wall, in vertical and landscape. The recorder handled 238 external-service calls through localhost stand-ins, with no production credentials, external platform sessions or account writes.
- Re-recorded final French landscape scenes with capture-only blur of fictional currency amounts, following the existing no-prices media requirement. The real application code and API values were not changed. Original synthetic-data recordings remain internal review evidence.
- Rendered four finished 30-second French/English edits: 1920×1080 landscape and 1080×1080 square in each language. They combine existing restaurant photography, genuine language-matched local product footage, current blue/navy typography, explicit local-demo wording, and a clear Food Hub / TAKATAK closing card. They are silent, with no unlicensed music or artificial voice.

## Final package and verification

- English recordings use the app's actual English language cookie and translated controls. Kitchen, tablet wall and order board have succeeded. A recorder-only selector issue was corrected by scoping status filters to the actual Status group. All capture services are stopped; other agents can build.
- Finished films, four steady-frame posters, FR/EN SRT and native WebVTT tracks, provenance, the expected historical 47-clip filename inventory, and SHA/property verification are versioned under [docs/media/product-film-2026-11-04](../media/product-film-2026-11-04/README.md).
- Verified all four outputs: H.264, 30 fps, exactly 30.000 seconds, correct landscape/square dimensions and no audio stream. Both caption tracks have five timed cues ending at 30 seconds. Posters and representative product frames were visually reviewed.
- OCR sampled 60 frames, one every two seconds across the four films. Ten currency candidates were reviewed as relay IDs (`S10` read as `$10`, including adjacency to `S09`), with no unredacted currency value identified in the sample. This is not exhaustive frame-by-frame proof.
- The new-order poster shows a positive green `11:23` countdown, consistent with the actual app's 11.5-minute Uber response window and a fresh synthetic order created inside the shot. Exact API remaining milliseconds were not retained and are not claimed.
- A portable renderer and documented input/output contract are available at `scripts/media/render-product-film.py` and `scripts/media/README.md`.
- The public-page agent has copied the reviewed landscape edits, refreshed posters and captions into the landing page's public media directory. The parent agent coordinates Git publication and the release; a live deployment is not claimed here.

## Remaining external dependencies

- Canva: historical notes record created folders, but uploads were unnamed and folder organization failed. No functioning Canva API integration or connected Canva account is available in this cloud session.
- Runway: a reusable image-to-video script and encrypted provider-key support exist in the TAKATAK website repository. A configured key/provider connection and completed generation are not verified here. These local edits are screen/photo films, not Runway output.
- Brand: obtain the official original blue logo/banner masters before replacing existing previews or preparing high-resolution brand exports.
- Production: the reviewed source still needs the normal release path, successful native deployment, exact public release SHA, healthy services and authorized real provider/merchant transaction tests. A local demo does not certify production integration.

No application deployment, social upload, provider login, Canva write, Runway call or production-service change was performed by this worker.

— Codex, Agent 5 @ cloud · 2026-11-04

## Coordinator verification — final combined candidate

The combined candidate passed 2,272 unit tests (22 skipped), production webpack build/TypeScript, lint with zero errors/one existing warning, 644 simulated acceptance checks and 25 real PostgreSQL crash checks. Thirteen built ON2GO/Food Hub browser checks passed on real PostgreSQL, including response-loss recovery and simultaneous checkout through two real servers. Nine sibling suite pairs passed. These checks use isolated provider/SMS receivers; no live deployment or real merchant-session certification is implied. See [current delivery record](../RESTAURANT_PLATFORM_DELIVERY.md).

— signé : Codex, coordinator @ Codex cloud · 2026-11-04
