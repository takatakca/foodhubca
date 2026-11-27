-- TAKATAK Food Hub — ONE-PASTE DATABASE INSTALL
-- Paste this entire file into the Supabase SQL Editor and click Run. Safe to run again after an upgrade.
-- It contains 2 install files in order. Regenerate with: node scripts/build-install-sql.mjs

-- ============================================================
-- FILE: foodhub.sql
-- ============================================================
-- TAKATAK Food Hub — operations tables (orders, stores, menus, jobs).
-- File 1 of 2 (then rc10.sql). Both are included in INSTALL_ALL.sql.

create table if not exists fh_channel_stores (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('uber_eats','doordash','skip','tgtg')),
  channel_store_id text not null,
  brand_name text not null,
  location_code text not null,
  clover_merchant_id text,
  auto_accept boolean not null default true,
  online boolean not null default true,
  paused_until timestamptz,
  last_status_source text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, channel_store_id)
);

create table if not exists fh_orders (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  marketplace text not null,
  external_order_id text not null,
  channel_store_id text,
  brand_name text,
  location_code text,
  status text not null default 'new' check (status in ('new','accepted','ready','dispatched','completed','cancelled','failed')),
  total numeric(12,2) not null default 0,
  pos_order_id text,
  pos_error text,
  channel_error text,
  placed_at timestamptz,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, external_order_id)
);
create index if not exists fh_orders_created_idx on fh_orders (created_at desc);
create index if not exists fh_orders_status_idx on fh_orders (status);

create table if not exists fh_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references fh_orders(id) on delete cascade,
  type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists fh_order_events_order_idx on fh_order_events (order_id, created_at);

create table if not exists fh_menus (
  brand_name text primary key,
  menu jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists fh_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  channel text not null,
  reference text,
  status text not null default 'queued' check (status in ('queued','done','error')),
  request jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fh_jobs_reference_idx on fh_jobs (reference);

create table if not exists fh_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- RC8 (Atlas parity): order timeline, courier step, activity log, users.
alter table fh_orders add column if not exists timeline jsonb not null default '{}'::jsonb;
alter table fh_orders drop constraint if exists fh_orders_status_check;
alter table fh_orders add constraint fh_orders_status_check check (status in ('new','accepted','ready','dispatched','completed','cancelled','failed'));
create index if not exists fh_orders_location_idx on fh_orders (location_code, created_at desc);

create table if not exists fh_activity (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor text not null,
  source text not null,
  kind text not null,
  action text not null,
  status text not null,
  summary text not null,
  channel text,
  brand_name text,
  location_code text,
  store_id text,
  order_id text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists fh_activity_at_idx on fh_activity (at desc);
create index if not exists fh_activity_kind_idx on fh_activity (kind, at desc);

create table if not exists fh_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  name text not null,
  role text not null check (role in ('owner','manager','operator','menu','analyst')),
  locations text[] not null default '{}',
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- Security: server-only tables (service-role key bypasses RLS; anon key gets nothing).
alter table fh_channel_stores enable row level security;
alter table fh_orders enable row level security;
alter table fh_order_events enable row level security;
alter table fh_menus enable row level security;
alter table fh_jobs enable row level security;
alter table fh_kv enable row level security;
alter table fh_activity enable row level security;
alter table fh_users enable row level security;

-- ---------------------------------------------------------------------------
-- RC9: generic documents (statement imports, payout lines, reconciliation cases,
-- ledger approvals, TGTG bag log, courier events…). One table, keyed by collection.
-- ---------------------------------------------------------------------------
create table if not exists fh_docs (
  collection text not null,
  id text not null,
  key text,
  at timestamptz,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
create index if not exists fh_docs_collection_at_idx on fh_docs (collection, at desc);
create index if not exists fh_docs_collection_key_idx on fh_docs (collection, key);
alter table fh_docs enable row level security;

-- Publish the function and its service-only grants in one transaction.
begin;

-- Signed Skip lifecycle receipts are matched by both the recorded and the signed order reference.
create index if not exists fh_skip_cancel_inbox_reference_idx on public.fh_docs ((data->>'reference'), at desc)
  where collection = 'webhook_inbox' and data->>'channel' = 'skip' and data->>'kind' = 'skip_cancel';

-- Apply direct JET Connect notices without exposing a transient new order. The lock also covers an absent order row.
create or replace function public.fh_apply_skip_lifecycle(
  p_kind text, p_external_id text, p_order jsonb, p_mapped boolean, p_message text, p_detail jsonb
) returns jsonb
language plpgsql security invoker set search_path = pg_catalog
as $skip_lifecycle$
declare
  current_order public.fh_orders%rowtype;
  seed public.fh_orders%rowtype;
  pending jsonb;
  cancellation jsonb;
  inbox_notice jsonb;
  event_detail jsonb;
  cancel_timeline jsonb := '{}'::jsonb;
  pending_key text := 'pending:skip:' || p_external_id;
  event_at text;
  observed_at timestamptz;
  cancellation_reason text;
  desired_status text;
  disposition text;
  inserted boolean := false;
  parked_cancel boolean := false;
  transitioned boolean := false;
begin
  if p_kind is null or p_kind not in ('backup', 'cancel') or p_external_id is null or p_external_id = '' then
    raise exception 'Invalid Skip lifecycle notice' using errcode = '22023';
  end if;
  if p_kind = 'backup' then
    seed := jsonb_populate_record(null::public.fh_orders, p_order);
    if seed.channel is distinct from 'skip' or seed.external_order_id is distinct from p_external_id then
      raise exception 'Invalid Skip backup order' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('foodhub:skip:' || p_external_id, 0));
  observed_at := clock_timestamp();
  event_at := to_char(observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  event_detail := coalesce(p_detail, '{}'::jsonb);
  select * into current_order from public.fh_orders
    where channel = 'skip' and external_order_id = p_external_id for update;

  if p_kind = 'cancel' then
    desired_status := 'cancelled';
    cancellation := jsonb_build_object('platformState', 'cancelled', 'detail', event_detail, 'at', event_at);
    if current_order.id is null then
      -- Merge with the current pending document inside this statement. Keep courier fields and clear an old consumed flag.
      insert into public.fh_kv as existing (key, value, updated_at)
        values (pending_key, jsonb_build_object('status', cancellation), observed_at)
        on conflict (key) do update set
          value = (existing.value - 'consumedAt') || excluded.value, updated_at = excluded.updated_at;
      parked_cancel := true;
      -- Ordinary intake is outside this lock and may have inserted while the cancellation was parked.
      select * into current_order from public.fh_orders
        where channel = 'skip' and external_order_id = p_external_id for update;
      if current_order.id is null then
        return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'parked');
      end if;
    end if;
  else
    desired_status := 'failed';
    select value into pending from public.fh_kv where key = pending_key for update;
    if coalesce(pending->>'consumedAt', '') = '' and pending->'status'->>'platformState' ~* 'cancel|fail' then
      cancellation := pending->'status';
      parked_cancel := true;
    else
      select data into inbox_notice from public.fh_docs
        where collection = 'webhook_inbox' and data->>'channel' = 'skip' and data->>'kind' = 'skip_cancel'
          and data->>'reference' = left(p_external_id, 200) and data->'body'->>'orderID' = p_external_id
          and key in ('received', 'processing', 'failed', 'done')
        order by at desc, id desc limit 1;
      if inbox_notice is not null then
        cancellation := jsonb_build_object('platformState', 'cancelled',
          'detail', jsonb_strip_nulls(jsonb_build_object('reason', inbox_notice->'body'->'reason'->'code',
            'happenedAt', inbox_notice->'body'->'happenedAt')), 'at', inbox_notice->>'receivedAt');
      end if;
    end if;
    if cancellation is not null then desired_status := 'cancelled'; end if;
  end if;

  if desired_status = 'cancelled' then
    cancellation_reason := coalesce(cancellation->'detail'->>'reason', cancellation->'detail'->>'event', 'Cancelled on the platform');
    cancel_timeline := jsonb_build_object('cancelledAt', event_at, 'cancelReason', cancellation_reason,
      'cancelledBy', case when cancellation_reason ~* 'customer|eater' then 'customer' else 'platform' end);
  end if;

  if current_order.id is null then
    if coalesce(seed.data->>'viaHub', '') <> '' or coalesce(seed.data->>'viaPos', '') <> '' then
      return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'ignored');
    end if;
    insert into public.fh_orders (channel, external_order_id, marketplace, channel_store_id, brand_name, location_code,
      status, total, placed_at, data, timeline, channel_error, created_at, updated_at)
    values ('skip', p_external_id, seed.marketplace, seed.channel_store_id, seed.brand_name, seed.location_code,
      desired_status, seed.total, seed.placed_at, seed.data,
      case when desired_status = 'cancelled' then cancel_timeline || '{"cancelStage":"before_accept"}'::jsonb else '{}'::jsonb end,
      case when desired_status = 'failed' then p_message end, observed_at, observed_at)
    on conflict (channel, external_order_id) do nothing returning * into current_order;
    inserted := found;
    if not inserted then
      select * into strict current_order from public.fh_orders
        where channel = 'skip' and external_order_id = p_external_id for update;
    end if;
  end if;

  if p_kind = 'backup' and p_mapped and coalesce(current_order.channel_store_id, '') <> ''
      and current_order.channel_store_id is distinct from seed.channel_store_id then
    return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_store');
  end if;
  if not inserted then
    if p_kind = 'backup' and (coalesce(current_order.data->>'viaHub', '') <> '' or coalesce(current_order.data->>'viaPos', '') <> '') then
      disposition := 'ignored';
    elsif desired_status = 'cancelled' and current_order.status = 'cancelled' then
      disposition := 'cancelled';
    elsif p_kind = 'backup' and desired_status = 'failed' and current_order.status = 'failed' and exists (
      select 1 from public.fh_order_events where order_id = current_order.id and type = 'routed_to_skip_tablet'
    ) then
      disposition := 'backed_up';
    elsif p_kind = 'backup' and current_order.status not in ('new', 'accepted', 'ready')
        and not (desired_status = 'cancelled' and current_order.status = 'failed') then
      disposition := 'ignored';
    else
      update public.fh_orders set status = desired_status, updated_at = observed_at,
        channel_error = case when desired_status = 'failed' then p_message when p_kind = 'backup' then null else current_order.channel_error end,
        timeline = case when desired_status = 'cancelled' then current_order.timeline || cancel_timeline ||
          jsonb_build_object('cancelStage', case when coalesce(current_order.timeline->>'acceptedAt', '') <> '' then 'after_accept' else 'before_accept' end)
          else current_order.timeline end
        where id = current_order.id returning * into current_order;
    end if;
  end if;

  if parked_cancel then
    update public.fh_kv set value = value || jsonb_build_object('consumedAt', event_at), updated_at = observed_at
      where key = pending_key;
  end if;
  if disposition is null then
    if desired_status = 'cancelled' then
      insert into public.fh_order_events (order_id, type, detail)
        values (current_order.id, 'platform_status', coalesce(cancellation->'detail', '{}'::jsonb) ||
          jsonb_build_object('state', cancellation->>'platformState', 'at', coalesce(cancellation->>'at', event_at)));
      disposition := 'cancelled';
      transitioned := true;
    else
      insert into public.fh_order_events (order_id, type, detail)
        values (current_order.id, 'routed_to_skip_tablet', event_detail || jsonb_build_object('message', p_message));
      disposition := 'backed_up';
    end if;
  elsif disposition = 'ignored' and p_kind = 'backup' then
    event_detail := event_detail || jsonb_build_object('status', current_order.status);
    if not exists (select 1 from public.fh_order_events where order_id = current_order.id and type = 'skip_backup_ignored' and detail = event_detail) then
      insert into public.fh_order_events (order_id, type, detail) values (current_order.id, 'skip_backup_ignored', event_detail);
    end if;
  end if;
  return jsonb_build_object('order', to_jsonb(current_order), 'isNew', inserted, 'outcome', disposition)
    || case when transitioned then '{"transitioned":true}'::jsonb else '{}'::jsonb end;
end;
$skip_lifecycle$;

revoke all on function public.fh_apply_skip_lifecycle(text, text, jsonb, boolean, text, jsonb) from public;
do $skip_lifecycle_permissions$
declare role_name text;
begin
  for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role') loop
    execute format('%s on function public.fh_apply_skip_lifecycle(text, text, jsonb, boolean, text, jsonb) %s %I',
      case when role_name = 'service_role' then 'grant execute' else 'revoke all' end,
      case when role_name = 'service_role' then 'to' else 'from' end, role_name);
  end loop;
end;
$skip_lifecycle_permissions$;

commit;

-- ============================================================
-- FILE: rc10.sql
-- ============================================================
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

