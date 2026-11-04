# Agent 5 — GitHub, product media and customer app integration

Updated: 2026-11-04, Codex cloud. Review branch: `feature/foodhub-media-production` (publication coordinated by the parent agent; this worker does not switch or commit the shared checkout).


## Shared Clover installation identity across nine apps

The continued cross-repository review found that installation needed a verified merchant identity before credentials
or billing could be saved. The common OAuth path now requires the authoritative Clover merchant response to match
the requested installation identity. Unavailable, malformed and mismatched replies leave installed records unchanged.
The same four changed shared files have matching SHA256 values in all nine reviewed sources, and the documented
checksum recipe was executed. The recorded verification commits were pushed and verified; M4RKETING then added documentation-only head `88f5837`
with runtime source still `12d071c`. No main merge or live Clover installation is implied.

| Repository | Current reviewed branch | Verified code commit | Passing unit tests |
| --- | --- | --- | ---: |
| M4RKETING | [feature/foodhub-campaign-workflows](https://github.com/takatakca/M4RKETING/tree/feature/foodhub-campaign-workflows) | `12d071c` |73 |
| C4ISSE | [fix/clover-merchant-identity](https://github.com/takatakca/C4ISSE/tree/fix/clover-merchant-identity) | `7c87e7b` |52 |
| LOY4LTY | [fix/clover-merchant-identity](https://github.com/takatakca/LOY4LTY/tree/fix/clover-merchant-identity) | `a87ba77` |60 |
| REW4RD | [fix/clover-merchant-identity](https://github.com/takatakca/REW4RD/tree/fix/clover-merchant-identity) | `7650721` |59 |
| 4CCOUNTING | [fix/clover-merchant-identity](https://github.com/takatakca/4CCOUNTING/tree/fix/clover-merchant-identity) | `25a2018` |52 |
| CH4T | [fix/clover-merchant-identity](https://github.com/takatakca/CH4T/tree/fix/clover-merchant-identity) | `a82ec6c` |52 |
| ST4FF | [fix/clover-merchant-identity](https://github.com/takatakca/ST4FF/tree/fix/clover-merchant-identity) | `41165a6` |52 |
| T4CTILE | [fix/clover-merchant-identity](https://github.com/takatakca/T4CTILE/tree/fix/clover-merchant-identity) | `a51ed6e` |52 |
| TR4CKER | [fix/clover-merchant-identity](https://github.com/takatakca/TR4CKER/tree/fix/clover-merchant-identity) | `5b6f399` |53 |

Every row passed TypeScript and its normal production build with mocked Clover transport. Each app includes 21 shared
identity regressions; the numbers above also include its existing app-specific tests. The original LOY4LTY/REW4RD
balance-only branches are preserved at `65b77a2` / `1c2cb0b`; the newer guard branches carry that work alongside the
shared installation safeguard. The separately rerun signed-suite source-contract checker reports 9/9 pairs; those
in-process delivery/replay/body/query/identity/expiry checks have a separate scope from real OAuth authorization.

Evidence: [nine-app verification matrix](evidence/05-suite-identity/results.json) and [shared-file checksums](evidence/05-suite-identity/shared-checksums.json). The published copies retain the verified code commits and omit irrelevant absolute execution paths. They describe local sources and mocked transport, not production configuration. Review the
coordinated integration and the intended companion branch set before the normal PR/native deployment path.

## Merchant campaign review and consent workflow

[M4RKETING's workflow](https://github.com/takatakca/M4RKETING/blob/feature/foodhub-campaign-workflows/docs/CAMPAIGN_WORKFLOW.md)
now connects a merchant-owned draft to a current Clover offer/segment preview, an approval of that exact version and
a real downloadable CSV of currently consenting contacts. Roles and merchant boundaries are enforced. An edit clears
approval; an old preview/export is refused. Consent is re-read at export, and a concurrent campaign edit during the
provider audience read prevents contact details leaving the route. Unknown Clover data fails closed.

The latest coordinator rerun passed nine checks on disposable real PostgreSQL, using three fresh app processes with
two running simultaneously. It exercised the actual merchant UI, admin/manager boundaries, an approved CSV download,
consent withdrawal, restart/JSONB ordering, a locked-row edit race and an edit during the audience lookup. The [final nine-check workflow proof](https://github.com/takatakca/M4RKETING/blob/feature/foodhub-campaign-workflows/docs/proofs/campaign-workflow-2026-11-04/results.json), build `b2siEtry9F116sazCYQai`, records zero page errors, provider writes or external messages. Documentation head `88f5837` publishes that result and its [source provenance](https://github.com/takatakca/M4RKETING/blob/feature/foodhub-campaign-workflows/docs/proofs/campaign-workflow-2026-11-04/provenance.json), identifying runtime commit `12d071c`. Its combined campaign/identity source passes 73 tests, TypeScript and production build as recorded in the shared-kit matrix.

Clover traffic in these checks stays on an isolated loopback receiver. No campaign messages were sent, discounts
published or production provider accounts changed. Installed suite transport, automatic campaign triggers, delivery
and live merchant authorization are separate acceptance steps.

## V1 build continuity with the original fonts

The [local-font review branch](https://github.com/takatakca/takatak-v1/tree/feature/cloud-local-fonts), `8072f39`, replaces
remote font-build fetches with integrity-locked local Fontsource assets for Geist, Geist Mono, Inter, Montserrat and
Instrument Serif. All six emitted WOFF2 files match their installed package bytes and cover the tested Canadian
French accented letters plus Œ/œ. The five original licenses remain available. The current loader/lockfile hashes
still match the recorded proof; its Git metadata correctly identifies the pre-commit base `b853bb6` with tracked
changes rather than pretending it was already the later commit.

The real production build, TypeScript, source/module checks, access/auth/identity suites,11 SEO checks and theme check
passed. Three actual local browser states cover English desktop, French mobile and the French OAuth notice, loading
all five families and the serif styles with zero page errors or external font requests. Only the intended website
and OAuth families preload. [Proof and captures](https://github.com/takatakca/takatak-v1/blob/feature/cloud-local-fonts/docs/proofs/2026-11-04/local-fonts/README.md).

This cloud's official Prisma bootstrap supplies genuine schema-specific types only. The module audit explicitly
skips its normal generated checksum stamp; database queries/migrations, authenticated provider behavior, CI, merge
and production are not certified. The font change closes the earlier remote-font build failure without claiming
those remaining runtime requirements are complete.

The earlier control-plane, balance and media deliveries below retain their original scopes. Current Food Hub
customer-write/public-page changes are still under the coordinator's final combined checks; historical aggregate
counts below are not a new release result.

— signé : Codex, documentation continuation @ Codex cloud · 2026-11-04

## Continued delivery — durable TAKATAK control-plane transport

The missing production callers of the old tenant foundations have been replaced with a wire-compatible client and a background observer/outbox under `lib/foodhub/control-plane/`. The unchanged V1 source was audited and exercised directly in contract tests. It uses the dedicated `TAKATAK_FOODHUB_API_KEY` Bearer credential, **not** historical HMAC headers or the old `TAKATAK_ON2GO_HUB_KEY`. That control-plane implementation did not edit V1 business handlers; the later font-only build work is recorded separately above.

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

## Earlier combined candidate — before this continuation

The earlier published integration candidate (`1df1415`) passed 2,272 unit tests (22 skipped), production webpack build/TypeScript, lint with zero errors/one existing warning, 644 simulated acceptance checks and 25 real PostgreSQL crash checks. Thirteen built ON2GO/Food Hub browser checks passed on real PostgreSQL, including response-loss recovery and simultaneous checkout through two real servers. Nine sibling suite pairs passed. These checks use isolated provider/SMS receivers; no live deployment or real merchant-session certification is implied. See [current delivery record](../RESTAURANT_PLATFORM_DELIVERY.md).

— signé : Codex, coordinator @ Codex cloud · 2026-11-04
