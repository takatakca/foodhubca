# TAKATAK Food Hub — rules for every Claude session

## Start of every session (and after every restart or usage-limit pause) — before writing any code
1. `git fetch origin` and look at what changed: `git log --oneline -15 origin/main`, open pull requests, and recent
   branches (`git branch -r --sort=-committerdate | head`). Another session may already be doing the work.
2. Read **`docs/PROGRESS.md`** (what is done, what is in progress and by whom, what is next) and the phase you are on
   in **`docs/MASTER_PLAN.md`**.
3. If the work you were about to do already exists on `main`, in an open pull request or on another branch, do not
   redo it: build on it, or say so on that pull request.
4. Unfinished work in a worktree (`.claude/worktrees/*`) is committed as WIP before anything else, never thrown away.

## While working
- Follow `docs/MASTER_PLAN.md` (phases, acceptance checks, locked rules in section 6 — never break those).
- Small, tested steps; push often to the session's branch; one pull request per finished piece.
- Checks before every push: `npm run typecheck`, `npm run lint` (0 errors), `npm test`; for anything touching orders,
  webhooks, menus or Clover also `rm -rf .next && npx next build --webpack` then `npm run verify:foodhub`
  (set `E2E_MOCK_PORT` / `E2E_APP_PORT` when 4799/4800 are busy).

## End of every work chunk
- Update **`docs/PROGRESS.md`**: date, what was done (commit / PR), what is in progress, what comes next.
- Post the same short status on the open pull request, so the owner sees it in GitHub.
