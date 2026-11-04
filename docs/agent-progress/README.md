# Five-agent delivery index

The owner requested five separately followable GitHub branches on November 4, 2026. Each linked page contains its agent's findings, implementation decisions, checks and remaining work. These are review branches; publication to a branch does not establish deployment.

| Agent | Responsibility | Branch and progress |
| --- | --- | --- |
| 1 | ON2GO diner site and customer flows | [on2goca · feature/on2go-customer-experience](https://github.com/takatakca/on2goca/blob/feature/on2go-customer-experience/docs/agent-progress/01-on2go.md) |
| 2 | Food Hub merchant marketing, FR/EN | [feature/foodhub-restaurant-marketing](https://github.com/takatakca/foodhubca/blob/feature/foodhub-restaurant-marketing/docs/agent-progress/02-foodhub-marketing.md) |
| 3 | Food Hub authenticated dashboard and payment recovery | [feature/foodhub-operator-dashboard](https://github.com/takatakca/foodhubca/blob/feature/foodhub-operator-dashboard/docs/agent-progress/03-foodhub-dashboard.md) |
| 4 | Recovered requirements, organization and independent review | [docs/drive-project-evidence](https://github.com/takatakca/foodhubca/blob/docs/drive-project-evidence/docs/agent-progress/04-drive-research.md) |
| 5 | GitHub audit, suite identity/balances, control-plane transport and video | [feature/foodhub-media-production](https://github.com/takatakca/foodhubca/blob/feature/foodhub-media-production/docs/agent-progress/05-github-media.md) |

Coordinator integration: `feature/restaurant-experience`, combining the Food Hub changes and the companion customer API. The initial Food Hub branches started from the unified-workspace review (`d79586c`); the subsequent wave shares the first combined delivery (`d6d7838`). The continued snapshots share the verified `1df1415` baseline and required common payment/SMS/test foundations where needed. The final combined runtime source is `12dc660`; later evidence commits can advance branch heads. Browser evidence always names that combined source/image, rather than certifying each intermediate worker snapshot. Release the coordinated integration candidate with its ON2GO companion, rather than deploying an isolated intermediate agent snapshot. The marketing site consumes the media agent's reviewed video assets. ON2GO's saved-address, favourites and preference changes require the companion backend release.

## Companion review branches for the continuation

These links extend the same five workstreams; they do not declare a production release or replace the individual
logs above. The coordinator owns the final combined Food Hub checks and the PR/native deployment sequence.

| Companion | Reviewed source and purpose | Evidence scope |
| --- | --- | --- |
| ON2GO | [feature/on2go-customer-experience](https://github.com/takatakca/on2goca/tree/feature/on2go-customer-experience), `237a025`: owner/revision-safe saved lists, consent, tracking language and truthful sign-in recovery | 120 unit tests and type/build/site gates;22 collection, 5 sign-in,25 privacy/financial and4 ordering browser cases against isolated replies; actual backend acceptance remains coordinator-owned |
| Campaigns and app installation | [M4RKETING feature/foodhub-campaign-workflows](https://github.com/takatakca/M4RKETING/tree/feature/foodhub-campaign-workflows), documentation head `88f5837` / verified runtime `12d071c`, plus [the nine-app identity branch matrix](05-github-media.md#shared-clover-installation-identity-across-nine-apps) | Nine campaign/PostgreSQL browser checks with isolated Clover, and each reviewed app's normal test/type/build gates; no messages or live OAuth certification |
| Master website build | [takatak-v1 feature/cloud-local-fonts](https://github.com/takatakca/takatak-v1/tree/feature/cloud-local-fonts), `8072f39`: original fonts served locally | Production build and local desktop/mobile/OAuth font proof; database runtime/provider configuration and public deployment unverified |

The nine-app matrix identifies the newer `fix/clover-merchant-identity` branches for the eight non-campaign apps.
The original LOY4LTY/REW4RD balance branches remain preserved. Select the coordinated companion set instead of
assuming an older isolated branch contains the subsequent identity guard. Food Hub customer compare-and-swap and
public contact changes are still under the coordinator's current verification; earlier combined counts are historical.

No agent is required to switch the shared integration checkout to publish its branch. The coordinator stages each exact owned-file manifest with a separate temporary Git index and pushes that branch independently. Agents' private reasoning is not published; these progress logs provide their work discussion, decisions and evidence.

Live Google Drive, Canva, Runway, Coolify administration and the owner's PC browser are not callable here. Known repository copies and linked public notes are identified separately from unavailable originals in agent 4's evidence report. Native production release verification remains an explicit acceptance step.

## Final continuation evidence

The combined `12dc660` runtime passed2,332 unit/25 skipped, production build/type/lint, audit0, 644 simulated acceptance and strict PostgreSQL-backed pruned-container health. Its unchanged image output passed15 real cross-repo browser checks and25 crash checks; customer PG 12, operator PG 2, operator browser 27/8 clean scans and contact browser 32/4 clean scans. [Coordinated delivery](https://github.com/takatakca/foodhubca/blob/feature/restaurant-experience/docs/RESTAURANT_PLATFORM_DELIVERY.md) and [machine-readable evidence](https://github.com/takatakca/foodhubca/blob/feature/restaurant-experience/docs/agent-progress/release-verification.json) carry exact provenance and limits. ON2GO `237a025` and the companion branch matrix above identify the coordinated source set. Git read/push recovered after temporary transport failure; API/live-site policy is still unapplied. Production is unverified.

— signé : Codex coordinator @ Codex cloud · 2026-11-04

The five remote worker heads were checked after publication; see [publication record](https://github.com/takatakca/foodhubca/blob/feature/restaurant-experience/docs/agent-progress/publication.json). Final evidence is scoped to runtime source `12dc660`; the coordinator branch can advance with documentation only.
