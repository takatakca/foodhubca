# Food Hub / ON2GO: Drive requirements and source evidence

Research date: 2026-11-04 UTC. Owner: Codex `drive_research`, cloud environment. Individual publication branch: `docs/drive-project-evidence`. This is a source audit for the five-agent implementation; it does not claim a new live Drive search or production acceptance.

## What was actually accessible

- All **22 selected Git repositories** exist in `/workspace`. A keyword inventory covered visible Markdown across all 22, excluding private folders, dependencies and generated builds. The local research index at `/workspace/platform-review/drive-source-index.json` records repository HEADs, matching paths, content hashes and reference line numbers; it is retained as a local research artifact rather than a file on this documentation branch. It is a discovery inventory, not a claim that every line of all 22 repositories was read.
- Read relevant source copies in Food Hub, ON2GO, TAKATAK V1, knowledgeAI and the Skip reference, plus the existing snapshot of **354 public agent-board comments**. The local snapshot is retained at `/workspace/platform-review/agent-board-comments.json`; the original public comments remain linked below. The public issue is https://github.com/takatakca/foodhubca/issues/105 .
- Exhausted current tool discovery for Drive, Google, search, ChatGPT, Canva, Runway and files. **No Google Drive/Docs/search, Canva, Runway or ChatGPT-history connector is callable in this session.** Available cloud-environment tooling does not provide these services.
- Current managed-environment status has no configured secrets, runtime variables or outbound identities. Its enforced restricted network has no Google Drive/Docs hosts allowed. A process variable named `GOOGLE_APPLICATION_CREDENTIALS` points to an empty JSON object; this is not usable Drive authorization. No credential value was printed or copied.
- Two legitimate read requests were tested: the documented hosting MAIN Google Doc's text-export URL, and the Operations Drive folder. Both stopped at **proxy CONNECT 403 / HTTP 000**. This is the environment proxy rejecting the connection; it is not a response from Drive, and proves neither that the files are missing nor that the user's Drive permissions are wrong.
- No Drive file, folder, account or permission was changed. No external message, post, paid generation, deployment or provider-account action was performed.

## Why older notes say the connectors are already connected

[KLEAN-CONNECTORS-INVENTORY-2026-10-29.md](https://github.com/takatakca/takatak-v1/blob/main/docs/KLEAN-CONNECTORS-INVENTORY-2026-10-29.md) records a **different environment's** inspection on October 29: 46 connectors inventoried, 36 connected, and 335 items listed in Operations Drive. It explicitly describes Muse connectors and commands under `/opt/hatch/connectors`. Drive, Canva and Runway were reported connected there; Runway's stored credentials were not proof of a successful generation call. Those historical findings explain the owner's expectation. They do not transfer authorization, files or callable tools to this cloud session.

The same report distinguishes three things that must remain separate: a conversation connector, an integration implemented inside the product, and agent coordination notes. A product button or a historical status entry is not proof that this agent can read the owner's connected account now.

## Drive locations recovered from repository copies

These are **known pointers**, not files opened in live Drive during this audit. Original titles and dates come from the cited repository copies.

| Source | Direct location | Known repository copy / scope |
| --- | --- | --- |
| `00 — Opérations TAKATAK` | https://drive.google.com/drive/folders/11B5CeNU_lZgO2VFA_fzejoLJNkSZdnv- | Central project notes, full registry including private repos, hosting, restaurants, screens, ON2GO. Historical 335-item inventory is October 29, not today's count. |
| Hosting MAIN, MochaHost → Coolify | https://docs.google.com/document/d/1wTC-CFM38Phq6BNLvF6vE2OE7pQjsxBNxtQ8_ET3DAE/edit | Summarized in V1 KLEAN inventory §2.3. Text-export request blocked by proxy. |
| Main dossier | https://drive.google.com/drive/folders/1OhyntKbk_k35gx-TJgLqU8FCnENX-Vzq | Pointer in Food Hub's `00 — COMMENCE ICI…`. |
| PPP restaurant dossier | https://drive.google.com/drive/folders/1yM2IlDsbgPlQyVaWmawnotFN0TxIQMwj | Restaurant source assets and operational notes. |
| 168 official finished Canva product exports | https://drive.google.com/drive/folders/18eXYO8o335TiL1LktCcO1sTSduow_jEf | Food Hub Tools S3 and image/video start document. Asset bytes were not available from Drive here. |
| `COMMENCE ICI — images et vidéos` | https://drive.google.com/file/d/1hNZ2Gu4xgi7IBcBVRhdayhMXz9IOCr0q/view | Copy: Food Hub `docs/00 — COMMENCE ICI — IMAGES ET VIDÉOS — SUIS-MOI.md`, October 28 18:34. |
| Clover video production pack | https://drive.google.com/file/d/1LxNRPwIUJ__4h0OTvzB4A6S14vGrhtLm/view | Copy: Food Hub `docs/2026-10-28 18-23 — Pack vidéos Marketplace Clover — scripts storyboards prompts Runway.md`. |
| Tools TAKATAK | https://drive.google.com/file/d/1HJBspm1fihF9LCC5_xJo2cmKQ_YpVyGx/view | Copy: Food Hub `docs/2026-10-28 18-23 — Tools TAKATAK — tableau de bord.md`. |
| Clover API/Robot Notepad base | https://drive.google.com/file/d/1eQb9gg8h62_-nEDslueLBGFB-1TTEX--/view | Pointer to 67-entry source database; not read here as a Drive original. |
| Restaurant standing instructions, Lévesque | https://drive.google.com/file/d/1cfuj73vqLOP_vIGUVd8fKFm6tcNpQJQc/view | Metadata/themes in KLEAN inventory §2.3: 18 brands, finishing standard, anti-duplication, imagery. Full text not verified here. |
| PPP closing checklist | https://drive.google.com/file/d/1WEL0gmYcOxFEvgTL-r6d59jA2EyL56tz/view | Title/date only in KLEAN inventory; full completion requirements require the original. |
| Skip portal spec | https://docs.google.com/document/d/1bx6d7ieujOQXsonUh4pUeNKZv5jruXO5p83qJGdjssI/edit | Explicit local copy: `skip-platform-reference/spec-portail-skip.md`. |

The historical Operations folder also contains “54 écrans + espace client ON2GO (Mon compte)” (October 29 16:40 EDT), ON2GO app handoff notes, the full registry, and restaurant dossier notes. Their exact file IDs were not recovered from this selected repository snapshot. Do not fabricate them.

## Confirmed requirements to implement and verify

| Requirement | Source and date | Acceptance implication / current evidence limit |
| --- | --- | --- |
| Food Hub is the single restaurant operations dashboard; ON2GO is the consumer app | Food Hub `docs/FOOD_ECOSYSTEM_MAP.md`, October 28; ON2GO `docs/ON2GO_APP_BLUEPRINT.md`, October 29/30 | Public navigation and copy must distinguish merchant software, customer ordering and TAKATAK company services. Linking repositories does not wire APIs or deploy them. |
| Clover remains restaurant POS/payment; Food Hub owns menus, orders, kitchen, customer operations | ON2GO blueprint §§1–3 | Verify actual menu/cart/checkout/tracking contracts, per-brand storefront switch and Clover handoff; an available adapter alone is insufficient. |
| TAKATAK V1 owns master identity, merchant accounts/plans/B2B billing; Food Hub keeps restaurant order/address data | Blueprint §§1,3 and Food Hub ecosystem map | API/short sign-in handoff across separate databases. Do not copy restaurant customer details into V1 analytics or build competing identity authorities. |
| No duplicate order path per store | Food Hub ecosystem map §§1,4 | A store uses exactly one `direct`, `via Clover` or `relay:<id>` ingestion path. Joined dashboards must not ingest the same order twice. |
| Nine Clover Suite apps communicate through Food Hub signed contracts | Food Hub registry §4.1 and `docs/TAKATAK_SUITE.md` | Each app owns its own data. Verify signatures/replay protection and real consumers; no cross-database writes or false claim that every business feature exists. |
| 54 independent sessions, 18 each DoorDash/Uber/Skip, owner signs in manually | [Board request](https://github.com/takatakca/foodhubca/issues/105#issuecomment-6507103682), [completion note](https://github.com/takatakca/foodhubca/issues/105#issuecomment-6507462334), October 29 | Keep existing PC profile/session IDs and platform assignments. 54 Hub records are not 54 running signed-in browsers. Session hosting and freshness must be verified on the PC/relay. |
| Wall supports 1/2/4/8/12/16/20/24, tabs/free layout/list, one alarm device, Watchtower | Food Hub registry §4.2, `ORDER_SCREENS_RESCUE.md` | Check wall behavior, authorized cross-platform alerting, offline/login/waiting states and focus. No bot accepts platform orders or enters passwords. |
| Familiar provider workspaces with real platform reference structures | [Private reference creation](https://github.com/takatakca/foodhubca/issues/105#issuecomment-6542282018), October 31; selected private `takatak-platform-reference` repo and Skip spec | Use information architecture and interaction research. Do not publish private merchant screenshots/data or treat UI parity as provider API approval. |
| Dashboard home: Needs attention, Opportunities, AOV, cancellation KPI, quick actions and store status | [Board task](https://github.com/takatakca/foodhubca/issues/105#issuecomment-6542677810), October 31 | Verify corresponding source and real metrics/empty states; display unavailable values honestly. |
| Orders: issue/outcome/courier filters, issue banner, timeline, option groups, payout/dispute detail | [Board task](https://github.com/takatakca/foodhubca/issues/105#issuecomment-6542710915), October 31 | Validate field contracts, filtering and detail state; no fabricated payout or courier facts. |
| Franchise organization → brands → locations, payout tree, consolidated reports, campaign builder | [Round-two note](https://github.com/takatakca/foodhubca/issues/105#issuecomment-6542616510), October 31 | Audit against source before claiming implemented. Cross-brand scope and authorization matter, including finance/imports. |
| ON2GO clean front, hierarchical hamburger, Canada only/QC first | Blueprint §§4–5 and [owner-brief note](https://github.com/takatakca/foodhubca/issues/105#issuecomment-6513027239), October 29/30 | Preserve discovery/search/restaurant/order/account flows; operations complexity belongs behind navigation. |
| ON2GO real Clover food photos only; no AI food pictures, invented ratings, distances or delivery promises | Blueprint §5; `IMAGE_LIBRARY.md` owner rule October 29 | Real repository restaurant photos are usable existing material; record provenance. A seed-source banner remains mandatory until a verified current feed replaces the snapshot. |
| Official product listing imagery uses finished Canva exports, not raw substitution | Food Hub image/video start document and `COMPANY-INFORMATION.md` §restaurant rules, October 28 | Distinguish official product/menu merchandising shots from contextual restaurant photography. Drive's 168 finished exports are not downloaded or matched to item IDs here. Later ON2GO rule explicitly selects real Clover photos for its site. |
| Logos come from actual approved assets, never invented or redrawn | ON2GO blueprint; `BRAND.md`; image library | Existing ON2GO repo has 15/17 brand badges plus ON2GO/TAKATAK WebP previews. `knowledgeAI/brand` currently holds a README only; do not claim missing official high-resolution files were recovered. |
| Video shows genuine sandbox product screens; Runway generates atmosphere only | Food Hub image/video start document and Clover production pack, October 28; V1 `docs/media/RAW_MATERIAL_REQUEST.md` | Capture actual local/demo app operations; label demo. Never pass a generated UI or personal/live-merchant recording off as product proof. |
| Existing production pack is the source for Clover films | Food Hub start document and V1 `docs/media/VIDEO_PLAN.md` | Reuse storyboard/FR-EN scripts. Current brand supersedes retired gold. Distinguish a locally edited review video from the completed connected Runway/voice/music/QC/Drive pipeline. |
| Film delivery: landscape and square MP4/poster, FR/EN SRT; no prices in video/posts | Food Hub image/video start document, October 28 | Produce real files, inspect duration/resolution and subtitle timing. Official pipeline additionally calls for ElevenLabs, Suno, Twelve Labs QC and Drive delivery; none is silently implied by ffmpeg output. |
| Current brand is electric blue/deep navy; status colors only for status | Current `BRAND.md`; explicit supersession in V1 `VIDEO_PLAN.md` final paragraph | Older media pack's black/gold instruction is retired. Preserve old evidence but execute current brand. |
| “Breuvage”, approved business phone only, no secrets; each provider-specific clip names only that platform | Food Hub start document; V1 raw-material request | Check copy/screens/frame contents and credits. Keep all private platform reference screenshots out of public media. |
| Production means tested, connected and actually served, not a script or successful branch push | Food Hub media start document; registry §0; deployment handoffs | Confirm exact served revision, health, page/assets, cross-origin backend and real authorized service acceptance. Local tests alone do not establish production function. |

## Existing media work: what is done and what is still missing

1. **ChatGPT image library:** ON2GO `docs/IMAGE_LIBRARY.md` records 1,013 **512px previews**, sorted into 22 local folders on the owner's PC. Original full-resolution files remain in ChatGPT. Fifteen restaurant badges and ON2GO/TAKATAK previews were committed. The Canva parent `FAHZc7ZmK7Q` and 22 folders were created, but the old connector uploaded without names and refused filing. The note explicitly says Drive upload was not completed. Creating folders is not successful media delivery. [Board proof](https://github.com/takatakca/foodhubca/issues/105#issuecomment-6514024041).
2. **Screen reels:** [October 31 board completion](https://github.com/takatakca/foodhubca/issues/105#issuecomment-6542603627) records 47 MP4 + 47 posters in the owner's PC `private/video/reels/`, PR140. Demo app data only, no provider screens, nothing posted, **Runway not called**. This preserves previous work; it does not establish that those private output files exist in the current cloud checkout.
3. **Runway:** V1 has `scripts/media/runway-generate.mjs`, shot lists and a production pack. The documented key name is `RUNWAYML_API_SECRET`; generation also needs permitted access to `api.dev.runwayml.com` and spends credits. No usable key or connector is configured here. Do not trigger duplicate production merely because earlier files are inaccessible.
4. **Product AI key store:** V1 `docs/AI_PROVIDER_KEYS.md` describes encrypted keys via `GROWTH_TOKEN_ENCRYPTION_KEY_V1` and `resolveProviderKey`. This is application implementation, not a connected Runway conversation tool. Its historical migration readiness is not evidence that the live database or keys are configured today.

## Outstanding direct-source checks

Once legitimate read access is present, search the Operations/PPP folders for `Food Hub`, `ON2GO`, `Clover`, `Restaurant`, `écrans`, `54`, `relais`, `Canva`, `Runway`, `vidéo`, `MAIN`, `registre` and the Lévesque/PPP checklists. Open source files and record IDs, modification dates and current decisions. Start from the existing full registry and MAIN file; do not create duplicate central notes. Compare newer Drive decisions with GitHub dates before changing implementation.

Priority missing originals are: the full current registry (private repo index included), MAIN hosting state, latest Windows/relay actual installation status, restaurant closing checklist, approved final logo/product asset files, latest Canva delivery state, current AI media account availability and third-party Clover marketplace-data approval. Their absence from this cloud session is **not** evidence that they do not exist or were never completed on the PC.

## Minimum access needed to finish the Drive-specific task

- A **callable read-only Google Drive/Docs connector in this same session**, signed into the authorized account with access to Operations and PPP. No password/token should be pasted into chat or committed. The current tool list does not offer an installable/recommended Google Drive plugin, so no unsupported installation flow was invoked.
- Alternatively, user-authorized exports of the named project notes/assets in the shared workspace let us read the supplied snapshot, but are not a substitute for searching live Drive and verifying current modification dates.
- For direct public/shared export URLs, the environment's allowlist must additionally permit `drive.google.com` and `docs.google.com` (and actual download host if Google returns one). Network permission alone does **not** authenticate private Drive access. No attempt was made to bypass the proxy.
- Read access is enough for requirements extraction. Writing the final signed handoff back into Drive is a separate unavailable capability; the local evidence file is ready for synchronization once a legitimate writer exists.

## Production-access appendix: Food Hub and ON2GO saved-account rollout

Added 2026-11-04 from repository deployment sources; no live control-plane access or deployment was performed.

### Exact existing Food Hub target

| Setting | Evidence-backed target |
| --- | --- |
| Coolify application | **`1ijktzayh4dbcnn37igo8ktv`** |
| Project / environment | `ci7kj4c0vvthwhqpvebogolb` / `theoc1ynrzvwglqhyowcikka` |
| Control plane | `https://coolify.takatak.ca` |
| Source/controller | Existing GitHub App **`g-r-o-u-p-e-t-a-k-a-t-a-k-github`**, repository `takatakca/foodhubca`, `main`, HEAD. Native “Deploy on push (webhooks)” was documented enabled October 15. Reconfirm its current state. |
| Build/runtime | Root `/Dockerfile`, internal port **3000**, Node22 |
| Revision | Build argument **`SOURCE_COMMIT`**, complete 40-character Git SHA; image sets `FOODHUB_RELEASE_SHA` and OCI revision label from it. Dockerfile rejects a missing/invalid SHA. Do not use a runtime-only value to repair a failed build argument. |
| Persistence | Existing volume **`1ijktzayh4dbcnn37igo8ktv-foodhub-media`** mounted at `/app/data/media`; existing Supabase persistence and stable session secret must remain attached. |
| Coolify readiness override | On documented Coolify4.4.6, use **Container command** `node /app/scripts/check-runtime.mjs`; interval30s, timeout90s, startup60s, retries3. Its UI overrides the image healthcheck; generic curl/wget HTTP probes failed because those programs are not in the Food Hub image. Reconfirm installed version/settings. |

Primary sources: [Food Hub deployment §§2–4](../../docs/DEPLOYMENT.md), [Dockerfile](../../Dockerfile), [handoff](../../docs/AGENT_HANDOFF.md), [historical native deployment](https://coolify.takatak.ca/project/ci7kj4c0vvthwhqpvebogolb/environment/theoc1ynrzvwglqhyowcikka/application/1ijktzayh4dbcnn37igo8ktv/deployment/aq1pgwnyhwlebyteeqyhrmlr).

The last exact **Food Hub release proof recovered in these deployment documents** is October15: `Webhook / Success`, SHA **`027b602a12da39b1244e17b813bc51a7496a0217`**, documented in [PR49](https://github.com/takatakca/foodhubca/pull/49). This does not claim that production is still at that SHA. Later board notes report an October30/31 VPS outage, and current proxy-blocked requests cannot establish today's server state. Historical VPS target `31.220.96.134` must be confirmed before any DNS changes.

Food Hub's `.github/workflows/coolify-deploy.yml` is deliberately guarded by `false && …`. Its historical `FOODHUB_COOLIFY_DEPLOY_WEBHOOK`, `FOODHUB_COOLIFY_DEPLOY_TOKEN`, `FOODHUB_COOLIFY_RESOURCE_UUID` and `FOODHUB_HTTPS_URL` names describe the retired Actions path, not the active writer. Do not enable a second deployment controller to work around missing access. An Actions `skipped` result is not a native Coolify failure or success.

### Runtime dependencies for the new public customer routes

| Dependency | Configuration / distinction |
| --- | --- |
| Durable saved addresses/favourites/preferences | Existing server runtime **`SUPABASE_URL`** or **`NEXT_PUBLIC_SUPABASE_URL`**, plus **`SUPABASE_SERVICE_ROLE_KEY`**, and the existing `fh_docs`/`fh_kv` schema. Customers are `fh_docs` JSON documents in collection `customers`. If the patch adds fields inside those documents, it does not itself imply a new SQL table; still test with the real Supabase repository and across a restart. Memory-mode unit tests are not durability proof. |
| Customer Bearer tokens | Existing stable **`SESSION_SECRET`**. Replacing it invalidates current customer tokens. Public `/api/public/on2go/*` accepts the customer token signed for fixed tenant `on2go`; it must not receive or expose the server-to-server website secret. |
| Browser CORS | `allowedOrigin()` defaults include `https://on2go.ca`, `https://www.on2go.ca`, `https://preview.on2go.ca`; optional **`FOODHUB_PUBLIC_CORS_ORIGINS`** supplies additional origins. New PUT/PATCH routes must export OPTIONS, allow `Content-Type, Authorization`, return matching origin and `Vary: Origin`, and send `Cache-Control: no-store` on customer responses. |
| Static frontend API target | ON2GO **build-time** **`NEXT_PUBLIC_FOODHUB_URL`**; normal/default value `https://foodhub.on2go.ca`. Changing a runtime variable in its Nginx container does not rebuild already-exported browser JS. **`FOODHUB_DIRECTORY_URL`** is also a build argument for refreshing its directory snapshot. |
| New SMS sign-in | **`TWILIO_VERIFY_SERVICE_SID`** with **`TWILIO_VERIFY_ACCOUNT_SID`** / **`TWILIO_VERIFY_AUTH_TOKEN`**, falling back to **`TWILIO_ACCOUNT_SID`** / **`TWILIO_AUTH_TOKEN`**. Without Verify, own-code SMS requires the latter plus **`TWILIO_FROM`** or **`TWILIO_MESSAGING_SERVICE_SID`**. These are not prerequisites for reading saved data with an already valid token, but are prerequisites for a fresh SMS login acceptance run. |
| TAKATAK launch sign-in alternative | Food Hub **`TAKATAK_CONTROL_PLANE_URL`** plus **`TAKATAK_ON2GO_SERVICE_TOKEN`**, matching the V1 bridge configuration. This is separate from OTP and ordinary saved-list persistence. |
| Brand-website server routes | **`FOODHUB_WEBSITE_ORDER_SECRET`** protects `/api/foodhub/customers/*`; ON2GO's static browser must use `/api/public/on2go/*` instead. Do not put this secret in `NEXT_PUBLIC_*`, the static export or request examples. |
| Rewards/gift cards | **`FOODHUB_LOYALTY_URL`** / **`FOODHUB_GIFTCARDS_URL`** are historical future-adapter names; their presence alone does not implement rewards or gift cards. Keep unconnected status truthful. |

Sources: Food Hub [customer-identity contract](../../docs/CUSTOMER_IDENTITY.md), [public customer wrapper](../../lib/foodhub/customers/on2go-public.ts), [origin allowlist](../../lib/foodhub/public-directory.ts), [customer store](../../lib/foodhub/customers/store.ts), [Supabase runtime config](../../lib/supabase/server.ts), ON2GO [Dockerfile](https://github.com/takatakca/on2goca/blob/main/Dockerfile.coolify) and [API origin helper](https://github.com/takatakca/on2goca/blob/main/lib/leads.ts). No configured values were inspected or published.

### Concrete deployment and acceptance sequence

1. Reach the existing Coolify target through legitimate authorized control-plane access. Read the current application source, domain, port, native webhook state, last deployment SHA/status and first failed build/runtime log. Confirm server readiness after the historical incident; do not infer outage merely from this environment's proxy403.
2. Reconcile and verify the complete Food Hub change first, retaining its current database/session/media configuration and a recoverable previous release. Let the **existing native controller** build the reviewed target revision. Docker checks include production dependency audit, typecheck/lint/unit tests, build, simulated Food Hub E2E and a final pruned-runtime probe. An isolated memory probe may accept the expected database-free503; production never may.
3. Prove Food Hub's exact revision using `npm run verify:live -- --url https://foodhub.on2go.ca/ --sha FULL_40_CHARACTER_EXPECTED_SHA`. The verifier requires `/api/release` exact SHA, `/api/health` HTTP200 with database `ok`, directory data and ON2GO CORS, login200, anonymous merchant orders401. Neither a200 home page nor an old valid marker is enough.
4. From each actual ON2GO origin, test the new public account route preflights and JSON responses: disallowed origin403, missing/expired token401, malformed list/preferences422, no caching, valid isolated customer PUT/PATCH→GET round trip. Confirm one customer's data cannot be read using another customer's or another tenant's token. Do not send diagnostic writes to real customer records.
5. With isolated authorized test identity, verify saved-data persistence in a second browser and after backend restart, then logout/deletion invalidation and data anonymization. Verify separate marketing choices round-trip without silently granting bundled consent. This is the additional evidence needed beyond28 local identity tests; it requires durable backend access, not new provider API approval.
6. Publish the compatible ON2GO frontend using its existing native resource **`fbrbc9iwwbgisdeaseg8tu6n`**, `/Dockerfile.coolify`, port8080, complete `SOURCE_COMMIT` at build. Verify **its own** `/release.txt` exact SHA and `/healthz` on apex/www/preview, then FR/EN home/restaurant/account flows at phone/desktop widths and inspect console/network failures. Food Hub and ON2GO have different repository SHAs and release endpoints.

Remaining access conditions are concrete: current proxy permission for live/control-plane hosts, legitimate authenticated access to the existing Coolify application, and isolated durable test identity/backend access. No current Coolify session/token is bound to this environment. A reviewed branch push has not repaired native deployment, and successful local tests have not established production readiness.

— signed: Codex (`drive_research`) @ Codex cloud · 2026-11-04 UTC
