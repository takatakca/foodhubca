# Work log

Newest first, one line per piece of work. Rule: `AGENTS.md` › Work log rule.
Format: `YYYY-MM-DD | agent | branch → PR | status | what | next step`

- 2026-10-09 | claude (Food Hub ↔ Clover backend) | fix/clover-merchant-id-check → PR pending | active | Refuse the card processor's all-digits merchant number as a Clover merchant ID (prod: 7 Uber stores were on 29759040017, corrected to YJ4W50YPJQSQ1); Clover webhook URL set, verification code sent to Food Hub | build + verify:foodhub rerunning, then gh pr create; owner: paste the code + VERIFY in Clover, Brancher un marchand Clover, Coolify keys + Deploy
- 2026-10-08 | claude (owner setup) | default branch | done | Added the work log rule, this log and the stop reminder | every agent follows AGENTS.md › Work log rule
