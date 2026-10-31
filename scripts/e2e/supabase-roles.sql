-- Throwaway Postgres for the crash-replay check (npm run verify:crash, docs/CRASH_REPLAY_E2E.md): the roles a Supabase
-- project already has, so supabase/INSTALL_ALL.sql runs unchanged and PostgREST behaves like Supabase's REST API.
-- Run it BEFORE INSTALL_ALL.sql, as the database owner:
--   psql -v ON_ERROR_STOP=1 -v authenticator_password=<random> -f scripts/e2e/supabase-roles.sql
-- Only for a disposable test database (CI's postgres:16 service). Never on a real one.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  -- As on Supabase: the service role bypasses row-level security (every Food Hub table has RLS on and no policy).
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  -- PostgREST logs in as authenticator, then switches to the role named in the request's JWT.
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
end
$$;
alter role authenticator with login password :'authenticator_password';
grant anon, authenticated, service_role to authenticator;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase gives the API roles every privilege on new public tables by default; INSTALL_ALL.sql then revokes anon and
-- authenticated itself, and the service role keeps them — the same end state as on a Supabase project.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
