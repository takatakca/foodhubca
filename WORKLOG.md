# Work log

Newest first, one line per piece of work. Rule: `AGENTS.md` › Work log rule.
Format: `YYYY-MM-DD | agent | branch → PR | status | what | next step`

- 2026-10-09 | claude (Skip + TGTG coverage agent) | feature/skip-tgtg-api-coverage | done, PR open | All 60 Skip/JET operations (JET Connect, delivery pools and state, Delivery-as-a-Service as a 3rd courier fleet) + Too Good To Go through Deliverect (29 calls, 19 webhooks) + TGTG feed events and end-of-day bag counts; tables docs/SKIP_API_COVERAGE.md, docs/TGTG_API_COVERAGE.md | owner merges, then the owner clicks listed in the PR (Skip JET key, Deliverect POS credentials, daily call to /api/foodhub/cron/tgtg-bags)
- 2026-10-09 | claude (ON2GO agent, task 19) | feature/public-directory-api → no PR (open from the compare link) | done, pushed | Public directory feed GET /api/public/directory for ON2GO.ca and QMAPS (seed + live hours/menu, CORS, cache, tests; 413 tests, webpack OK, verify 506/0) | owner merges https://github.com/takatakca/foodhubca/compare/main...feature/public-directory-api?expand=1 , deploys, sets FOODHUB_PUBLIC_CLOVER_ORDER_URL in Coolify
- 2026-10-08 | claude (owner setup) | default branch | done | Added the work log rule, this log and the stop reminder | every agent follows AGENTS.md › Work log rule
