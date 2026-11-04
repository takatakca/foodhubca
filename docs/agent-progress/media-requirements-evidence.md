# Food Hub / ON2GO media requirements and evidence

Read-only source audit, 2026-11-04. Historical notes are evidence of prior work, not current deployment or account verification.

## The product requirement

ON2GO is the consumer restaurant discovery/ordering frontend. Food Hub is the restaurant operations hub connected to Clover, delivery channels and the nine suite apps. The requested platform combines familiar provider workflows with one coherent operational experience, a persistent tablet wall, genuine restaurant photography, professional French/English copy and actual product demonstrations. Repository access alone does not establish configured services or tested production flows.

The existing screen requirement is 54 sessions: 18 DoorDash, 18 Uber Eats and 18 Skip, with layouts including 16 visible screens. Preserve existing PC profiles and IDs. The owner signs in manually; do not treat a neutral local relay placeholder as an authenticated provider portal.

Brand source: `BRAND.md`. Electric blue on navy, white/silver text, status colors only for states. Do not use the retired gold TK identity. The older Clover film pack contains gold styling; the later TAKATAK website video plan explicitly requires updating it to the current brand before production.

## Photography and brand evidence

- ON2GO's `public/photos/` contains 167 files: 151 item thumbnails and 16 larger 1200×900 covers. The README identifies them as restaurant Clover-menu photos; the loader maps item IDs to local files. Public-page work should use the existing dish photos rather than newly generated food images.
- The owner's no-AI-food rule is recorded in `on2goca/docs/IMAGE_LIBRARY.md` and [board comment 6513027239](https://github.com/takatakca/foodhubca/issues/105#issuecomment-6513027239). The separate 1,013-image ChatGPT library consists of 512-pixel previews, not original restaurant photography.
- The 17 existing logo previews have conflicting provenance labels: one blueprint calls them official Canva logos, while the image-library note and [comment 6514024041](https://github.com/takatakca/foodhubca/issues/105#issuecomment-6514024041) describe ChatGPT preview extraction. Treat them as existing site assets, not verified original Canva masters.
- `knowledgeAI/brand/README.md` lists the required original logo-circle, wordmark and banner PNGs, but those files are absent in this cloud checkout.
- `takatak-v1/public/photos/CREDITS.md` records five Unsplash-licensed real stock photos and source URLs. These can provide business context without implying that the subjects are TAKATAK staff, customers or endorsers.
- The restaurant-photo files do not carry per-file photographer/licence records. Preserve their existing menu associations and record original source/rights before extending use into a broader paid-media library.

## Existing video production must be reused accurately

[PR #140](https://github.com/takatakca/foodhubca/pull/140), observed head `8af116a21a186abc390aeee7bce1d86cab31b086`, contains the reusable Playwright/ffmpeg recorder and `docs/PROMO_REELS.md`. [The original completion note](https://github.com/takatakca/foodhubca/issues/105#issuecomment-6542603627) reports 47 MP4s plus 47 posters rendered on the owner's PC, with synthetic demo records, no native provider screens, no Runway generation and no posting. Those binaries are not in this cloud checkout. Recover them before repeating the entire library.

The PR documents two staged connection-ready shots. The current film delivery excludes those shots and uses only kitchen/new order, order board and the real app's tablet-wall controls. Relay views remain clearly identified as simulated. Fictional currency text is blurred during capture to obey the existing no-prices rule; no alternative UI or response is fabricated.

`docs/2026-10-28 18-23 — Pack vidéos Marketplace Clover — scripts storyboards prompts Runway.md` already provides film scripts, storyboards, FR/EN voiceovers and export specifications. `takatak-v1/docs/media/` provides the later production pack, raw-material request, photo-loop scripts, screen recorders and Runway generation script. Plans and API-key support do not prove account access or rendered Runway output.

The TAKATAK website checkout contains 31 MP4s: three product captures, 20 social edits and eight website loops. Many are silent ffmpeg edits of licensed stills, not Runway videos. QCMEV contains one local-simulator rehearsal MP4 whose README explicitly says it is not official certification.

## Selected repository coverage

| Repository | Relevant scope |
| --- | --- |
| foodhubca | Restaurant hub, suite events, relay, ordering, marketing page, brand and Clover film plans |
| on2goca | Consumer frontend, restaurant photos/logo previews, full-app blueprint and image-library index |
| skip-platform-reference | Skip workflow specification; internal reference, not public media |
| takatak-platform-reference | Private provider parity/combined-dashboard references; exclude account screenshots from public promotion |
| ON2GO-CLOVER | Clover directory app and a 75-second demo script limited to confirmed functions |
| 4CCOUNTING | Clover accounting/reporting; requires verified synthetic report footage |
| REW4RD | Gift-card app, listing package and video script |
| TR4CKER | Delivery/fleet app; needs synthetic delivery-action footage |
| M4RKETING | Customer segments, discounts and campaign drafts; README says the app sends nothing |
| CH4T | Customer conversations and suite contract; no verified media integration |
| ST4FF | Staff app, listing package and video script; sandbox staff only |
| C4ISSE | Register and picture-register module; photo API and menu workflow |
| T4CTILE | Kiosk/table ordering and photo-menu workflow |
| LOY4LTY | Points app, listing package, video script and website integration specification |
| takatak-v1 | Marketing/backend platform, licensed stock, actual product captures, media pipelines and Runway support |
| Facturations | Invoices; existing raw-material request defers public media until cleared |
| knowledgeAI | Knowledge/prompt standards and required brand-master upload location |
| TAKATAKREVIEW | Review-interface reference; no public marketing media found |
| QCMEV.CA | Local compliance simulator demonstration and recorder; no certification claim |
| takatak-doordash-operations | Generic public operational workflows; never publish actual support/account evidence |
| ACADEMYTAKATAK | Learning app; real lesson-screen material required |
| SEOTAKATAK | SEO/action-plan app; use a synthetic audit as demonstration |

## Requirement-to-owner evidence matrix

| Requirement | Source work possible now | External proof still required |
| --- | --- | --- |
| Coherent connected platform | API/event/tenant-contract tests and adapter fixes | Real app URLs, merchant OAuth installs, configured keys, event delivery |
| Professional Food Hub page | Existing photos, concise bilingual content, genuine product media, responsive checks | Deployment success and matching public SHA |
| Current ON2GO frontend | Repair layout/data fallbacks, inspect static build | Correct native deployment/webhook revision, public SHA and screenshots |
| Customer account and ordering | Align actual customer/storefront response contracts and expose failures | Configured identity delivery, menu, checkout and authorized test order lifecycle |
| 54 persistent sessions | Safe scope/count/profile handling and existing-kit inspection procedure | PC-connected service/profile status; owner enters login/2FA |
| Familiar provider workflows | Private-reference mapping and supported-action inventory | Provider approvals, live sessions and individual receipt/cancellation tests |
| Clover/photo-menu suite | Shared item-photo mapping, deterministic sandbox tests | Authorized merchant/device/payment/receipt checks and App Market status |
| Canva asset library | Named upload manifest, source shortlist and organization plan | Connected account, folder permissions, upload and filing verification |
| Runway media | Existing scripts/prompts and an actual local screen/photo edit | Configured key/network, generation IDs, reviewed outputs |
| Finance/rewards/marketing/staff | Synthetic event/report checks, truthful disconnected states | Real events, settlement reconciliation, configured adapters and consent |
| Front-to-back release | Reviewable source, local verification, prepared smoke checks | Webhook success, public exact SHA, healthy persistence, real controlled transactions |

## Delivery rules

Render actual available screens, use synthetic data, keep the current blue/navy brand and explicit demo caption, show no prices or unproven savings, and supply landscape/square video, poster, FR/EN captions and a source manifest. Use a licensed or genuinely owned soundtrack only; silence is preferable when no cleared audio is available. A screen/photo edit must not be described as Runway production. No account connection, upload, production deployment or full integration is claimed by this audit.

— Codex, Agent 5 @ cloud · 2026-11-04
