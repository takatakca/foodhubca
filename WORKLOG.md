# Work log

Newest first, one line per piece of work. Rule: `AGENTS.md` › Work log rule.
Format: `YYYY-MM-DD | agent | branch → PR | status | what | next step`

- 2026-10-09 | claude (e2e Watchtower, task 29) | fix/e2e-watchtower-flaky → PR #37 | done (owner merges) | e2e Watchtower step polls the non-forced cron/watch (1/s, max 25 s) until it really runs, NOTE line on a skip; product throttle unchanged; check green, 3× build + verify 508/0 | owner merges PR #37; if a verify run prints the NOTE line, its last-run age says throttled (< 20 s) or a run still going
- 2026-10-09 | claude (chief architect, task 25) | feature/product-name → PR pending | done | Product name on screen from FOODHUB_PRODUCT_NAME (default Food Hub, unchanged): translator renames console texts, page title, manifest; Clover listing name and legal pages kept | owner sets FOODHUB_PRODUCT_NAME="ON2GO Hub" in Coolify when ready; after console-store-switcher merges, use useProduct() for the shell logo text
- 2026-10-09 | claude (Uber API coverage, task 22) | feature/uber-api-coverage → PR #21 | done (owner merges) | Every Uber Eats Marketplace + Uber Direct endpoint/webhook in Food Hub (61/61, 17/17), Stores → Uber Eats page, Uber Direct options; docs/UBER_API_COVERAGE.md | owner merges PR #21 + deploys; Uber grants the optional scopes (doc, Owner steps)
- 2026-10-09 | claude (ON2GO agent, task 19) | feature/public-directory-api → no PR (open from the compare link) | done, pushed | Public directory feed GET /api/public/directory for ON2GO.ca and QMAPS (seed + live hours/menu, CORS, cache, tests; 413 tests, webpack OK, verify 506/0) | owner merges https://github.com/takatakca/foodhubca/compare/main...feature/public-directory-api?expand=1 , deploys, sets FOODHUB_PUBLIC_CLOVER_ORDER_URL in Coolify
- 2026-10-08 | claude (owner setup) | default branch | done | Added the work log rule, this log and the stop reminder | every agent follows AGENTS.md › Work log rule
