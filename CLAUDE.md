# TAKATAK Food Hub: rules for every Claude session

> **Pour le propriétaire :** chaque robot lit ce fichier en démarrant. Pour en relancer un, dites-lui
> « lis CLAUDE.md, puis continue la branche `<nom>` ». Le tableau des tâches en direct est `private/TASKS.md` (local,
> dans le dossier principal ; `docs/PROGRESS.md` en garde l'historique). **Seul le propriétaire touche à `main`.**

Several Claude sessions work on this project at the same time (worktrees under `.claude/worktrees/`). Work was done
twice, even three times, because sessions did not see each other. These rules stop that.

## Git: main belongs to the owner (owner's order of 2026-10-08; overrides every other rule in this file)
Nobody but the owner touches `main`, in any TAKATAK repo. Not even a docs-only commit.
- **Never:** commit on local `main`; `git push origin main` or `HEAD:main`; merge into `main`; rebase, reset or rewrite
  `main`; force-push.
- **Work flow:**
  1. `git fetch origin`, then `git switch -c <type>/<name> origin/main`. Type: `feature`, `fix`, `refactor`, `docs` or
     `agent`.
  2. Push only that branch: `git push -u origin <type>/<name>`.
  3. Before you say "done": you are not on `main`, the checks ran, the work is committed, the branch is pushed, the
     working tree is clean.
  4. Report: branch, SHA, what changed, checks and results, env / migration / deploy notes, and "ready for owner
     review/merge". The owner merges and deploys.
- **Never discard uncommitted work you did not create** (`reset --hard`, `clean -fd`, `checkout -- .`, `restore .`).
  Report it to the owner instead.
- The owner works in the main checkout (`C:\Users\fansh\Documents\GitHub\foodhubca`, on `main`). **Never commit
  there.** Use a worktree: `git worktree add .claude/worktrees/<name> -b <type>/<name> origin/main`.
- Safety net: a local `pre-push` hook refuses any push to `main` when the environment variable `CLAUDECODE` is set
  (Claude Code sets it). It never blocks the owner. Do not work around it.

## 1. Start of every session (and after every restart or usage-limit pause), before anything else
1. Run `git fetch origin '+refs/heads/*:refs/remotes/origin/*'`, then check three things. Another session may already
   have done your task.
   - `git log --oneline -15 origin/main`
   - `git for-each-ref --sort=-committerdate --format='%(committerdate:short) %(refname:short) %(subject)' refs/remotes/origin | head -20`
   - `git worktree list`
2. Read **`private/TASKS.md`** in the main checkout (`C:\Users\fansh\Documents\GitHub\foodhubca\private\`): the live
   **Task board** (who owns what, on which branch, the exact next step). Then read the newest entry of
   `docs/PROGRESS.md` and the phase you are on in `docs/MASTER_PLAN.md`.
3. If your task already exists on `main`, on another branch or in an open pull request, **do not redo it**. Continue
   that branch, or write on its pull request.
4. If the owner says "continue branch X", open X in a worktree (never in the main checkout), read its row in the Task
   board, and start from its **Next step**.
5. Unfinished work in a worktree is committed as WIP (on its own branch) before anything else. It is never thrown away.

## 2. Claim before you work: one task, one branch, one owner
- Before writing code, add or update your row in `private/TASKS.md`: task, branch, session, status, next step. This
  file is git-ignored: **no commit and no push to `main`** to claim a task. Only edit your own row.
- If a row for the same task exists and was updated less than 24 h ago, it is taken. Pick another task or ask the
  owner.
- **Operations work** (support tickets, emails, platform portals, hosting panels, Coolify clicks) is **not** in git.
  Claim it in `private/CLAIMS.md` in the main checkout (`C:\Users\fansh\Documents\GitHub\foodhubca\private\`) and log it
  in `private/OPS_LOG.md`. Only **one** agent at a time per account: DoorDash portal, Uber Manager, each Gmail inbox,
  MochaHost, Coolify, Clover.

## 3. While working
- Follow `docs/MASTER_PLAN.md` (phases, acceptance checks, locked rules in section 6: never break those).
- Small, tested steps. Push often to **your** branch. One pull request per finished piece.
- Checks before every push:
  - always: `npm run typecheck`, `npm run lint` (0 errors), `npm test`;
  - for anything touching orders, webhooks, menus or Clover, also: `rm -rf .next && npx next build --webpack`, then
    `npm run verify:foodhub` (set `FOODHUB_E2E_MOCK_PORT` / `FOODHUB_E2E_APP_PORT` when 4799/4800 are busy).
- `main` is deployed by the owner from Coolify (manual Deploy). Never deploy, and never touch `main` (see "Git: main
  belongs to the owner"). The owner merges your branch.

## 4. Hard rules (owner's orders, never break them)
- **Po Poulet NDG (DoorDash store 27982486) is never touched.** No publish, no 86, no Menu Request answer, no support
  request about it.
- **This repository is public.** Never commit: `private/`, keys, tokens, `.env` values, support case numbers, bank
  details, emails, phone numbers of people, device serials or activation codes.
- **Each platform hears only about itself.** A DoorDash message never mentions Uber, Skip or Too Good To Go, and the
  reverse. Our own Food Hub, Clover and UrbanPiper may be named.
- Platform support happens **inside each platform's portal, store by store**, from the account's own email only.
- Never type passwords, SMS/2FA codes, bank or card numbers. The owner does that.

## 5. Handoff notes (owner's standing order): write them as you go, not only at the end
- Connections drop and usage limits hit without warning. Every ~20 minutes, and before any long step, update your note:
  status, the **exact next step**, and the 2–3 files to read. Code: your row in `private/TASKS.md`. Operations: your
  `private/CLAIMS.md` row + one dated line in `private/OPS_LOG.md`.
- A new agent must be able to resume from your note alone, without re-reading the history. Don't write essays.
- Verify before you report "done": re-check the result (page reloaded, test re-run, message visible in the thread).

## 6. End of every work chunk, and before you stop for any reason
- Push your branch (never `main`), even as WIP. Commit everything: the working tree must be clean.
- Update your row in `private/TASKS.md`: status, branch, PR link and an exact **Next step** another session can start
  from without asking.
- Put the short dated entry (what was done, with commit/PR) in `docs/PROGRESS.md` **on your own branch**, or in the
  pull request text. Never on `main`.
- Post the same short status on your pull request, and report to the owner as in "Git: main belongs to the owner" (step
  4: branch, SHA, checks, notes, "ready for owner review/merge").
