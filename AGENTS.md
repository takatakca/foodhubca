# Agent instructions


## 🧭 Agent board: read FIRST (owner's order 2026-10-28)

All agents, wherever they run (Claude Code desktop or cloud, claude.ai, Cursor, subagents), coordinate on **one pinned public issue**: https://github.com/takatakca/foodhubca/issues/105
1. **Before any job,** read its latest comments. A job claimed or updated there in the last 24 h belongs to that agent: continue from its next step, or pick another job.
2. **Post** `CLAIM`, then `UPDATE` about every 20 minutes and before long steps, then `PAUSED` or `DONE` when you stop. If a usage limit is near, post `PAUSED` with the exact next step **before** a long step.
3. **One line per comment:** `STATUS | agent: <name> @ <where it runs> | repo · branch → PR | job | next step`.
4. **The board is public:** no secrets, codes, signatures, personal or tax data. Notes in `WORKLOG.md` / `HANDOFF.md` / `private/` still apply. The board is what agents in *other* environments can see.

## Work log rule (every agent: Claude, Codex, Cursor, people)

Cheap to follow: read only what is listed here.

1. **Before you start:** read the top of the log (`head -40 WORKLOG.md`) and the titles of open pull requests (`gh pr list`). If a line for the same work is `active` or has an open PR, do not redo it: continue that branch or pick other work.
2. **Claim it:** add one line at the top of the log with status `active`.
3. **Before you stop:** update your line with the status (`done`, `PR #n`, `blocked: reason`) and the next step. Commit and push it with your work. Never stop with unlogged work.
4. One line per piece of work, newest first. Details go in the PR, not the log.

Line format: `YYYY-MM-DD | agent | branch → PR | status | what | next step`

## Brand rule

Everything visual or written for TAKATAK follows `BRAND.md` (logo, colours, tagline, services). Electric blue on deep navy; never the old gold "TK" logo; green is for status only.

## Continuity documents

Before resuming work, read `docs/REGISTRE_TAKATAK.md` (all the work since day 1, and the owner's standing orders of 2026-10-29 in its §0 and in `CLAUDE.md`), then `docs/AGENT_HANDOFF.md` and `docs/TASK_QUEUE.md` after this file; they do not replace the private task board. Update the handoff and worklog on your branch before stopping. Never publish private operational notes, credentials or the local `private/` folder.
