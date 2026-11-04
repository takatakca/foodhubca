# Five-agent delivery index

The owner requested five separately followable GitHub branches on November 4, 2026. Each linked page contains its agent's findings, implementation decisions, checks and remaining work. These are review branches; publication to a branch does not establish deployment.

| Agent | Responsibility | Branch and progress |
| --- | --- | --- |
| 1 | ON2GO diner site and customer flows | [on2goca · feature/on2go-customer-experience](https://github.com/takatakca/on2goca/blob/feature/on2go-customer-experience/docs/agent-progress/01-on2go.md) |
| 2 | Food Hub merchant marketing, FR/EN | [feature/foodhub-restaurant-marketing](https://github.com/takatakca/foodhubca/blob/feature/foodhub-restaurant-marketing/docs/agent-progress/02-foodhub-marketing.md) |
| 3 | Food Hub authenticated dashboard and payment recovery | [feature/foodhub-operator-dashboard](https://github.com/takatakca/foodhubca/blob/feature/foodhub-operator-dashboard/docs/agent-progress/03-foodhub-dashboard.md) |
| 4 | Recovered requirements, organization and independent review | [docs/drive-project-evidence](https://github.com/takatakca/foodhubca/blob/docs/drive-project-evidence/docs/agent-progress/04-drive-research.md) |
| 5 | GitHub audit, suite balances, control-plane transport and video | [feature/foodhub-media-production](https://github.com/takatakca/foodhubca/blob/feature/foodhub-media-production/docs/agent-progress/05-github-media.md) |

Coordinator integration: `feature/restaurant-experience`, combining the Food Hub changes and the companion customer API. The initial Food Hub branches started from the unified-workspace review (`d79586c`); the subsequent wave shares the first combined delivery (`d6d7838`). Current review branches include required common payment/SMS foundations where needed for their changes. Release the coordinated integration candidate with its ON2GO companion, rather than deploying an isolated intermediate agent snapshot. The marketing site consumes the media agent's reviewed video assets. ON2GO's saved-address, favourites and preference changes require the companion backend release.

No agent is required to switch the shared integration checkout to publish its branch. The coordinator stages each exact owned-file manifest with a separate temporary Git index and pushes that branch independently. Agents' private reasoning is not published; these progress logs provide their work discussion, decisions and evidence.

Live Google Drive, Canva, Runway, Coolify administration and the owner's PC browser are not callable here. Known repository copies and linked public notes are identified separately from unavailable originals in agent 4's evidence report. Native production release verification remains an explicit acceptance step.
