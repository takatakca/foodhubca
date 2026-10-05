-- TAKATAK Food Hub RC10 — passwordless sign-in, staff PINs, kitchen devices, Watchtower.
-- Safe to run more than once. Run after foodhub.sql (INSTALL_ALL.sql already contains both).

-- People sign in with a one-time code or link sent to their email / phone. Passwords become optional
-- (kept only for the owner's recovery login and older scripts).
alter table fh_users alter column password_hash drop not null;
alter table fh_users add column if not exists email text;
alter table fh_users add column if not exists phone text;
alter table fh_users add column if not exists pin_hash text;
alter table fh_users add column if not exists prefs jsonb not null default '{}'::jsonb;
create unique index if not exists fh_users_email_key on fh_users (lower(email)) where email is not null;
create unique index if not exists fh_users_phone_key on fh_users (phone) where phone is not null;

-- Everything else RC10 stores (sign-in challenges, kitchen devices, incidents, the message outbox,
-- policy and alert settings) lives in fh_docs / fh_kv, created and indexed by foodhub.sql.

-- Defence in depth: Food Hub tables are read and written by the server only (service role). Row-level
-- security is on with no policy, and the public API roles get no privilege at all on them.
revoke all on table fh_channel_stores, fh_orders, fh_order_events, fh_menus, fh_jobs, fh_kv, fh_activity, fh_users, fh_docs from anon, authenticated;
