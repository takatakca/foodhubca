# Crash replay check: kill the server mid-order (Phase 1 acceptance)

> **Pour le propriétaire :** ce test prouve qu'une commande n'est jamais perdue quand le serveur s'arrête net. Il reçoit
> une commande Uber Eats, coupe le serveur juste après l'avoir enregistrée et avant de la traiter, le redémarre, puis
> vérifie qu'il y a exactement une commande, un ticket Clover et une impression. Un arrêt en plein milieu du traitement
> est couvert par les tests unitaires, pas par ce test. Il tourne tout seul dans GitHub (Food Hub CI → « Crash replay »). Rien à
> faire de votre côté.

MASTER PLAN Phase 1 acceptance: *"Killing the server between receiving an order and processing it loses nothing; the
order is replayed."* `npm run verify:crash` (`scripts/foodhub-crash-e2e.mjs`) proves it on a real database, in CI, on
every push to `main`, `develop/**`, `claude/**` and `test/**` and on every pull request to `main` / `develop/**`
(job **Crash replay (real Postgres)** in `.github/workflows/ci.yml`).

## Why a real database

`verify:foodhub` runs in memory mode (`FOODHUB_FORCE_MEMORY`): everything lives in the Node process, so a killed server
forgets the order and the proof is impossible. The crash check runs the built app on **postgres:16 + PostgREST**, the
pair a Supabase project runs, set up the way Supabase sets it up:

| Piece | Where |
|---|---|
| Supabase roles (`anon`, `authenticated`, `service_role` with BYPASSRLS, `authenticator` with LOGIN) + default grants | `scripts/e2e/supabase-roles.sql` |
| Food Hub schema, unchanged | `supabase/INSTALL_ALL.sql` |
| PostgREST, pinned | `postgrest/postgrest:v12.2.3`, random `PGRST_JWT_SECRET` per run, `PGRST_DB_ANON_ROLE=anon` |
| `service_role` key (HS256 JWT, `node:crypto`, no new dependency) | `node scripts/e2e/postgrest.mjs service-jwt` |
| `/rest/v1` → PostgREST (supabase-js calls `<url>/rest/v1/<table>`) | `startRestProxy()` in `scripts/e2e/postgrest.mjs`, started by the check |
| Simulated Uber Eats / Clover / … (the same as verify:foodhub) | `scripts/e2e/platform-mock.mjs` |

## What it does

1. **Killed after the inbox save, before processing.** A signed Uber Eats `orders.notification` arrives. Food Hub saves it in the webhook inbox
   (`fh_docs`, collection `webhook_inbox`) and answers 200. The test-only delay hook holds the entry in `processing`. The
   check sends SIGKILL to the server's process group (`taskkill /F /T` on Windows): no shutdown hook, no `after()`
   callback finishes. Checked at that moment: the entry is `processing`, no order row, no Clover order, no ticket.
   The check waits past the "interrupted" time and restarts the server on the same database, with its timer on. The
   recovery runner (`lib/foodhub/recovery.ts` → `sweepInbox`) must process the saved webhook: entry `done` on its 2nd
   try, `recovery:last` written by the timer after the restart, **exactly one** `fh_orders` row (accepted), **one** Clover
   order (the id on the row), **one** kitchen ticket (`print_event` for that Clover order), **one** Uber accept with that
   id, no `duplicate_delivery` event, no unique-key error in the logs.
2. **Killed after processing.** A second order is processed live (entry `done`, 1 try), the server is killed and
   restarted; after two recovery runs: the entry is untouched (still `done`, 1 try) and there is still one order row, one
   Clover order, one ticket, one Uber accept.
3. No background job crashed in any of the four boots.

Kill points covered here: after the inbox save and before any processing, and after processing. A stop in the middle of
the pipeline is handled by the pipeline itself, not proven end to end by this check: an order stored but never sent to
Clover is finished by the next run (`resumeUnsentOrder` in `lib/foodhub/pipeline.ts`), and a Clover order whose answer
was lost is looked up by its title before a second send (`tests/order-path.test.ts`, "the lost answer").

## Test-only hooks (`lib/foodhub/e2e-hooks.ts`)

| Variable | Effect | Default |
|---|---|---|
| `FOODHUB_E2E_PROCESS_DELAY_MS` | the inbox waits this long after marking an entry `processing`, before processing it (max 120 000) | off |
| `FOODHUB_E2E_INBOX_STUCK_MS` | an entry still `received` / `processing` after this long counts as interrupted (min 1 000, max 120 000) | 2 minutes |

They act **only** when `FOODHUB_E2E=1` **and** the run-time `NODE_ENV` is `test` or `development`. Anywhere else
(production, or `NODE_ENV` not set) they are refused: one warning in the log, then ignored. The Docker image sets
`NODE_ENV=production`, so a deployed Food Hub can never use them. `NODE_ENV` is read through a computed key because
`next build` replaces every literal `process.env.NODE_ENV` with `"production"`; the check starts `next start` with
`NODE_ENV=test`. `tests/e2e-hooks.test.ts` proves production ignores both.

Keep `FOODHUB_E2E_INBOX_STUCK_MS` above the time one entry takes to process, or a sweep could start a second copy of an
entry that is still running (the same reason the real value is 2 minutes).

A future kill point **after the order row is stored** needs `FOODHUB_E2E_INBOX_STUCK_MS` above `RESUME_AFTER_MS`
(90 s, `lib/foodhub/pipeline.ts`). With the 3 s this check uses, the replay would find the row too young for
`neverSentToClover`, log `duplicate_delivery`, mark the entry `done`, and the order would never reach Clover. Production
is safe: its 2-minute stuck time is longer than 90 s.

## Run it yourself

Without a database the script prints `SKIP` and exits 0 (this PC has no Docker). With Docker and Node 22:

```bash
docker run -d --name fh-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
export PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres
psql -v ON_ERROR_STOP=1 -v authenticator_password=authpw -f scripts/e2e/supabase-roles.sql
psql -v ON_ERROR_STOP=1 -f supabase/INSTALL_ALL.sql
SECRET=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")
docker run -d --name fh-rest --network host -e PGRST_DB_URI=postgres://authenticator:authpw@127.0.0.1:5432/postgres \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRET" postgrest/postgrest:v12.2.3
export FOODHUB_CRASH_POSTGREST_URL=http://127.0.0.1:3000
export FOODHUB_CRASH_SERVICE_KEY=$(PGRST_JWT_SECRET="$SECRET" node scripts/e2e/postgrest.mjs service-jwt)
npm run build && npm run verify:crash
```

The check refuses a PostgREST that is not on 127.0.0.1 / localhost: it writes test orders. Ports:
`FOODHUB_E2E_MOCK_PORT` / `FOODHUB_E2E_APP_PORT` (as verify:foodhub) and `FOODHUB_CRASH_PROXY_PORT` (default app port + 1).
