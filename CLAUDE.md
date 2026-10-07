# TAKATAK Food Hub: rules for every Claude session

> **Pour le propriétaire :** chaque robot lit ce fichier en démarrant. Pour en relancer un, dites-lui
> « lis CLAUDE.md, puis continue la branche `<nom>` ». Le tableau des tâches est dans `docs/PROGRESS.md`.

Several Claude sessions work on this project at the same time (worktrees under `.claude/worktrees/`). Work was done
twice, even three times, because sessions did not see each other. These rules stop that.

## 1. Start of every session (and after every restart or usage-limit pause), before anything else
1. Run `git fetch origin '+refs/heads/*:refs/remotes/origin/*'`, then check three things. Another session may already
   have done your task.
   - `git log --oneline -15 origin/main`
   - `git for-each-ref --sort=-committerdate --format='%(committerdate:short) %(refname:short) %(subject)' refs/remotes/origin | head -20`
   - `git worktree list`
2. Read **`docs/PROGRESS.md`**: the **Task board** (who owns what, on which branch, the exact next step) and the newest
   entry. Then read the phase you are on in `docs/MASTER_PLAN.md`.
3. If your task already exists on `main`, on another branch or in an open pull request, **do not redo it**. Continue
   that branch, or write on its pull request.
4. If the owner says "continue branch X", check out X, read its row in the Task board, and start from its **Next step**.
5. Unfinished work in a worktree is committed as WIP before anything else. It is never thrown away.

## 2. Claim before you work: one task, one branch, one owner
- Before writing code, add or update your row in the **Task board** in `docs/PROGRESS.md`: task, branch, session,
  status, next step. Commit it and push it to `main` right away (docs-only commit; `git pull --rebase` first). Only
  edit your own row.
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
- `main` is deployed by the owner from Coolify (manual Deploy). Never deploy, and never push code straight to `main`.
  Pull requests only.

## 4. Hard rules (owner's orders, never break them)
- **Po Poulet NDG (DoorDash store 27982486) is never touched.** No publish, no 86, no Menu Request answer, no support
  request about it.
- **This repository is public.** Never commit: `private/`, keys, tokens, `.env` values, support case numbers, bank
  details, emails, phone numbers of people, device serials or activation codes.
- **Each platform hears only about itself.** A DoorDash message never mentions Uber, Skip or Too Good To Go, and the
  reverse. Our own Food Hub, Clover and UrbanPiper may be named.
- Platform support happens **inside each platform's portal, store by store**, from the account's own email only.
- Never type passwords, SMS/2FA codes, bank or card numbers. The owner does that.

## 5. End of every work chunk, and before you stop for any reason
- Push your branch, even as WIP.
- Update your **Task board** row in `docs/PROGRESS.md`: status, PR link and an exact **Next step** another session
  can start from without asking.
- Add a short dated entry at the top of `docs/PROGRESS.md` (what was done, with commit/PR).
- Post the same short status on your pull request.
