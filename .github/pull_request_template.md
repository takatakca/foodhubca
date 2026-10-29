## Branch
`<type>/<name>` (from `origin/main`). Type: feature, fix, refactor, docs or agent.

## What changed
-

## Checks (paste the result)
- [ ] `npm run typecheck`
- [ ] `npm run lint` (0 errors)
- [ ] `npm test`
- [ ] If orders, webhooks, menus or Clover: `npx next build --webpack` and `npm run verify:foodhub`

## Env / migrations
New or changed environment variables, SQL migrations, Coolify settings. Write "none" if none.

## Deploy notes
Order of merge, restart needed, owner actions after deploy. Write "none" if none.

## Merge
The author merges once the checks are green (owner's order 2026-10-29); nobody pushes to `main` directly. A merge may go live
(Coolify deploy on push, `docs/DEPLOYMENT.md` §3): for a code change, the full checks above come first.
Sign: `— signé : <agent> (<session>) @ <where> · <YYYY-MM-DD HH:MM>`
