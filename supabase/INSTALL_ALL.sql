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
create index if not exists fh_skip_backup_inbox_reference_idx on public.fh_docs ((data->>'reference'), at desc)
  where collection = 'webhook_inbox' and data->>'channel' = 'skip' and data->>'kind' = 'skip_backup';

-- Arbitrate direct JET Connect intake and lifecycle notices on the same order lock, even before a row exists.
create or replace function public.fh_apply_skip_lifecycle(
  p_kind text, p_external_id text, p_order jsonb, p_mapped boolean, p_message text, p_detail jsonb
) returns jsonb
language plpgsql security invoker set search_path = pg_catalog
as $skip_lifecycle$
declare
  current_order public.fh_orders%rowtype;
  seed public.fh_orders%rowtype;
  current_mapping public.fh_channel_stores%rowtype;
  expected_mapping jsonb := p_detail->'storeMapping';
  pending jsonb;
  cancellation jsonb;
  inbox_notice jsonb;
  inbox_backup jsonb;
  backup_message constant text := 'Skip sent this order to the tablet. Make it from the Skip tablet.';
  event_detail jsonb;
  cancel_timeline jsonb := '{}'::jsonb;
  pending_key text := 'pending:skip:' || p_external_id;
  blank_store_chars constant text := E' \t\n\r\f' || chr(11);
  legacy_error_prefix constant text := '^(?:(?:clover )?(?:network error|(?:(?:request|operation) (?:was )?|(?:the|this) operation was )?(?:timeout|timed out|aborted)|(?:returned )?http 5[0-9]{2}|(?:response )?did not include an order id)|skip clover receipt needs review)(?:[[:space:]:.]|$)';
  definite_error_prefix constant text := '^Clover returned HTTP (?:400|401|403|404|405|415|422|429)(?:[[:space:]:.]|$)';
  legacy_hold constant text := 'Skip Clover receipt needs review: Verify the original register and the earlier result before retrying.';
  legacy_hold_source constant text := 'legacy_skip_clover_receipt';
  previous_pos_error text;
  held_pos_error text;
  held_timeline jsonb;
  event_at text;
  observed_at timestamptz;
  cancellation_reason text;
  desired_status text;
  disposition text;
  inserted boolean := false;
  parked_cancel boolean := false;
  transitioned boolean := false;
  receipt_mode boolean := p_kind in ('record_receipt', 'check_receipt');
  prepare_mode boolean := p_kind = 'prepare_clover';
  jet_mode boolean := p_kind in ('prepare_jet', 'finish_jet');
  driver_mode boolean := p_kind = 'apply_driver';
  driver_input jsonb := p_detail->'driver';
  driver_status text := p_detail->'driver'->>'status';
  driver_courier jsonb;
  driver_timestamps jsonb;
  jet_attempt jsonb;
  invalid_jet_attempt boolean;
  jet_signal text := p_detail->>'signal';
  jet_manual boolean := coalesce(p_detail->'manual' = 'true'::jsonb, false);
  jet_result text := p_detail->>'result';
  jet_fields jsonb := p_detail->'fields';
  jet_timeline jsonb;
  has_pos_order boolean;
  known_pos_order boolean;
  receipt_pos_id text := p_detail->>'posOrderId';
  clover_merchant text := p_detail->>'merchantId';
  stored_merchant text;
  clover_attempt jsonb;
  invalid_attempt boolean := false;
  legacy_retry jsonb;
  resume_only_lease boolean;
  legacy_uncertain boolean := false;
  active_order boolean;
  active_attempt_check boolean;
  receipt_timeline jsonb;
  retry jsonb;
  receipt_evidence jsonb;
  recorded boolean := false;
begin
  if p_kind is null or p_kind not in ('backup', 'cancel', 'intake', 'check_intake', 'record_receipt', 'check_receipt',
      'prepare_clover', 'clear_clover_attempt', 'hold_legacy_clover', 'prepare_jet', 'finish_jet', 'apply_driver')
      or p_external_id is null or p_external_id = '' then
    raise exception 'Invalid Skip lifecycle notice' using errcode = '22023';
  end if;
  if p_kind in ('backup', 'intake') then
    seed := jsonb_populate_record(null::public.fh_orders, p_order);
    if seed.channel is distinct from 'skip' or seed.external_order_id is distinct from p_external_id then
      raise exception 'Invalid Skip order seed' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('foodhub:skip:' || p_external_id, 0));
  observed_at := clock_timestamp();
  event_at := to_char(observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  event_detail := coalesce(p_detail, '{}'::jsonb);
  select * into current_order from public.fh_orders
    where channel = 'skip' and external_order_id = p_external_id for update;

  if driver_mode then
    if current_order.id is null or current_order.id::text is distinct from p_detail->>'orderId'
        or coalesce(current_order.data->>'viaHub', '') <> '' or coalesce(current_order.data->>'viaPos', '') <> ''
        or coalesce(driver_status, '') not in ('assigned', 'arriving', 'at_store', 'picked_up', 'delivered', 'unassigned') then
      return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'ignored');
    end if;
    driver_courier := (case when jsonb_typeof(current_order.timeline->'courier') = 'object' then current_order.timeline->'courier' else '{}'::jsonb end)
      || jsonb_strip_nulls(jsonb_build_object('status', driver_status, 'updatedAt', event_at, 'source', 'skip:driver_status',
        'name', nullif(driver_input->>'name', ''), 'phone', nullif(driver_input->>'phone', ''),
        'vehicle', nullif(driver_input->>'vehicle', ''), 'etaAt', nullif(driver_input->>'etaAt', '')));
    update public.fh_orders set timeline = jsonb_set(timeline, '{courier}', driver_courier), updated_at = observed_at
      where id = current_order.id returning * into current_order;
  end if;

  stored_merchant := current_order.timeline->>'posMerchantId';
  clover_attempt := current_order.timeline->'posCreateAttempt';
  invalid_attempt := clover_attempt is not null and (jsonb_typeof(clover_attempt) <> 'object'
    or jsonb_typeof(clover_attempt->'id') is distinct from 'string' or coalesce(clover_attempt->>'id', '') = ''
    or jsonb_typeof(clover_attempt->'at') is distinct from 'string' or coalesce(clover_attempt->>'at', '') = ''
    or jsonb_typeof(clover_attempt->'merchantId') is distinct from 'string'
    or coalesce(btrim(clover_attempt->>'merchantId', blank_store_chars), '') = '');
  active_order := current_order.status in ('new', 'accepted', 'ready', 'dispatched');
  active_attempt_check := active_order and clover_attempt is not null and not invalid_attempt;
  legacy_retry := current_order.timeline->'posRetry';
  resume_only_lease := coalesce(legacy_retry->'resumeOnly' = 'true'::jsonb and legacy_retry->'uncertain' = 'true'::jsonb
    and legacy_retry->'attempts' = '0'::jsonb and legacy_retry->'nextAt' = 'null'::jsonb
    and jsonb_typeof(legacy_retry->'claim') = 'string' and coalesce(btrim(legacy_retry->>'claim', blank_store_chars), '') <> ''
    and jsonb_typeof(legacy_retry->'claimedAt') = 'string' and coalesce(btrim(legacy_retry->>'claimedAt', blank_store_chars), '') <> ''
    and legacy_retry->>'lastError' is null and legacy_retry->>'gaveUpAt' is null and legacy_retry->>'doneAt' is null, false);
  -- Without a confirmed pair or new durable marker, a legacy timeout/abort can still represent a physical Clover order.
  legacy_uncertain := clover_attempt is null and not (coalesce(btrim(current_order.pos_order_id, blank_store_chars), '') <> ''
      and coalesce(btrim(stored_merchant, blank_store_chars), '') <> '')
    and (coalesce(btrim(current_order.pos_error, blank_store_chars), '') ~* legacy_error_prefix
      or coalesce(btrim(legacy_retry->>'lastError', blank_store_chars), '') ~* legacy_error_prefix
      or (legacy_retry->'uncertain' = 'true'::jsonb and not resume_only_lease));
  if p_kind = 'hold_legacy_clover' then
    if current_order.id is null or current_order.id::text is distinct from p_detail->>'orderId'
        or coalesce(current_order.data->>'viaHub', '') <> '' or coalesce(current_order.data->>'viaPos', '') <> '' then
      return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_attempt');
    end if;
    if not coalesce(legacy_uncertain, false) then
      return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'ignored');
    end if;
    previous_pos_error := case when coalesce(btrim(current_order.pos_error, blank_store_chars), '') <> '' then current_order.pos_error
      when jsonb_typeof(legacy_retry->'lastError') = 'string' and coalesce(btrim(legacy_retry->>'lastError', blank_store_chars), '') <> ''
        then legacy_retry->>'lastError' end;
    held_pos_error := case when left(previous_pos_error, length(legacy_hold)) = legacy_hold then previous_pos_error
      else legacy_hold || coalesce(' ' || previous_pos_error, '') end;
    held_timeline := case when jsonb_typeof(legacy_retry) = 'object' then jsonb_set(current_order.timeline, '{posRetry,nextAt}', 'null'::jsonb)
      else current_order.timeline end;
    if current_order.pos_error is distinct from held_pos_error or current_order.timeline is distinct from held_timeline then
      update public.fh_orders set pos_error = held_pos_error, timeline = held_timeline, updated_at = observed_at
        where id = current_order.id returning * into current_order;
    end if;
    if not exists (select 1 from public.fh_order_events where order_id = current_order.id and type = 'needs_attention'
        and detail->>'source' = legacy_hold_source) then
      insert into public.fh_order_events (order_id, type, detail) values (current_order.id, 'needs_attention',
        jsonb_build_object('reason', held_pos_error, 'source', legacy_hold_source));
    end if;
    return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'legacy_clover_uncertain');
  end if;
  jet_attempt := current_order.timeline->'skipJetAttempt';
  invalid_jet_attempt := jet_attempt is not null and (jsonb_typeof(jet_attempt) <> 'object'
    or jsonb_typeof(jet_attempt->'id') is distinct from 'string' or coalesce(jet_attempt->>'id', '') = ''
    or jsonb_typeof(jet_attempt->'at') is distinct from 'string' or coalesce(jet_attempt->>'at', '') = ''
    or coalesce(jet_attempt->>'signal', '') not in ('accept', 'fallback')
    or (jet_attempt ? 'outcome' and coalesce(jet_attempt->>'outcome', '') not in ('accepted', 'fallback', 'uncertain')));
  if jet_mode and (current_order.id is null or current_order.id::text is distinct from p_detail->>'orderId'
      or coalesce(current_order.data->>'viaHub', '') <> '' or coalesce(current_order.data->>'viaPos', '') <> ''
      or (p_kind = 'prepare_jet' and coalesce(jet_signal, '') not in ('accept', 'fallback'))
      or (p_kind = 'finish_jet' and (invalid_jet_attempt or jet_attempt is null
        or jet_attempt->>'id' is distinct from p_detail->>'attemptId' or coalesce(jet_result, '') not in ('accepted', 'fallback', 'refused', 'uncertain')
        or (jet_result = 'accepted' and jet_attempt->>'signal' <> 'accept')
        or (jet_result = 'fallback' and jet_attempt->>'signal' <> 'fallback')))) then
    return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_jet');
  end if;
  if prepare_mode or p_kind = 'clear_clover_attempt' then
    if current_order.id is null or current_order.id::text is distinct from p_detail->>'orderId'
        or coalesce(current_order.data->>'viaHub', '') <> '' or coalesce(current_order.data->>'viaPos', '') <> ''
        or coalesce(btrim(clover_merchant, blank_store_chars), '') = '' then
      return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_attempt');
    end if;
    if (coalesce(current_order.pos_order_id, '') <> '' and (not prepare_mode or not coalesce(legacy_uncertain, false)))
        or (prepare_mode and not active_order and current_order.status <> 'cancelled') then
      return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'ignored');
    end if;
    if p_kind = 'clear_clover_attempt' then
      if invalid_attempt or clover_attempt is null or clover_attempt->>'id' is distinct from p_detail->>'attemptId'
          or clover_attempt->>'merchantId' is distinct from clover_merchant then
        return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_attempt');
      end if;
      update public.fh_orders set timeline = timeline - 'posCreateAttempt', updated_at = observed_at,
        pos_error = case when p_detail->>'definiteError' ~* definite_error_prefix then p_detail->>'definiteError' else current_order.pos_error end
        where id = current_order.id returning * into current_order;
      return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'attempt_cleared');
    end if;
  end if;
  if receipt_mode then
    if current_order.id is null or current_order.id::text is distinct from p_detail->>'orderId'
        or coalesce(current_order.data->>'viaHub', '') <> '' or coalesce(current_order.data->>'viaPos', '') <> ''
        or coalesce(btrim(receipt_pos_id, blank_store_chars), '') = '' or coalesce(btrim(clover_merchant, blank_store_chars), '') = ''
        or invalid_attempt or (clover_attempt is not null and clover_attempt->>'merchantId' is distinct from clover_merchant)
        or (coalesce(current_order.pos_order_id, '') <> '' and current_order.pos_order_id is distinct from receipt_pos_id)
        or (coalesce(stored_merchant, '') <> '' and stored_merchant is distinct from clover_merchant)
        or (p_kind = 'check_receipt' and (current_order.pos_order_id is distinct from receipt_pos_id
          or stored_merchant is distinct from clover_merchant)) then
      return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_receipt');
    end if;
    if p_kind = 'record_receipt' then
      receipt_timeline := current_order.timeline || jsonb_build_object('posMerchantId', clover_merchant);
      retry := receipt_timeline->'posRetry';
      if jsonb_typeof(retry) = 'object' and (retry->'nextAt' is distinct from 'null'::jsonb or coalesce(retry->>'doneAt', '') = '') then
        receipt_timeline := jsonb_set(receipt_timeline, '{posRetry}', retry || jsonb_build_object(
          'nextAt', null, 'doneAt', coalesce(nullif(retry->>'doneAt', ''), event_at)));
      end if;
      if current_order.pos_order_id is distinct from receipt_pos_id or current_order.pos_error is not null
          or current_order.timeline is distinct from receipt_timeline then
        update public.fh_orders set pos_order_id = receipt_pos_id, pos_error = null,
          timeline = receipt_timeline, updated_at = observed_at where id = current_order.id returning * into current_order;
      end if;
      if not exists (select 1 from public.fh_order_events where order_id = current_order.id
          and type in ('pos_injected', 'pos_adopted') and detail->>'posOrderId' = receipt_pos_id) then
        receipt_evidence := case when jsonb_typeof(p_detail->'evidence') = 'object' then p_detail->'evidence' else '{}'::jsonb end;
        insert into public.fh_order_events (order_id, type, detail) values (
          current_order.id, case when p_detail->'adopted' = 'true'::jsonb then 'pos_adopted' else 'pos_injected' end,
          receipt_evidence || jsonb_build_object('posOrderId', receipt_pos_id, 'merchantId', clover_merchant));
        recorded := true;
      end if;
    end if;
  end if;

  if p_kind = 'check_intake' and (current_order.id is null or (current_order.status <> 'new' and not active_attempt_check)
      or coalesce(current_order.pos_order_id, '') <> ''
      or coalesce(current_order.data->>'viaHub', '') <> '' or coalesce(current_order.data->>'viaPos', '') <> '') then
    return jsonb_build_object('order', case when current_order.id is null then null else to_jsonb(current_order) end,
      'isNew', false, 'outcome', 'ignored');
  end if;
  if p_kind = 'intake' then
    if coalesce(seed.data->>'viaHub', '') <> '' or coalesce(seed.data->>'viaPos', '') <> '' then
      return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'ignored');
    end if;
    if coalesce(btrim(current_order.channel_store_id, blank_store_chars), '') <> ''
        and coalesce(btrim(seed.channel_store_id, blank_store_chars), '') <> ''
        and current_order.channel_store_id is distinct from seed.channel_store_id then
      return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_store');
    end if;
    if current_order.id is not null and (current_order.status <> 'new'
        or coalesce(current_order.data->>'viaHub', '') <> '' or coalesce(current_order.data->>'viaPos', '') <> '') then
      return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'received');
    end if;
  end if;

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
      -- Legacy intake or another source may insert outside this lock while the cancellation is parked.
      select * into current_order from public.fh_orders
        where channel = 'skip' and external_order_id = p_external_id for update;
      if current_order.id is null then
        return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'parked');
      end if;
    end if;
  else
    desired_status := case when p_kind = 'backup' then 'failed' when receipt_mode then current_order.status else 'new' end;
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

  if (prepare_mode or jet_mode or receipt_mode or driver_mode) and cancellation is null and current_order.status in ('new', 'accepted', 'ready')
      and coalesce(btrim(current_order.channel_store_id, blank_store_chars), '') <> '' then
    -- The failed-order route persisted this authenticated notice before starting its worker.
    select data->'body' into inbox_backup from public.fh_docs
      where collection = 'webhook_inbox' and data->>'channel' = 'skip' and data->>'kind' = 'skip_backup'
        and data->>'reference' = left(p_external_id, 200) and data->'body'->'order'->>'orderId' = p_external_id
        and jsonb_typeof(data->'body'->'order'->'orderId') in ('string', 'number')
        and data->'body'->'order'->'restaurant'->>'id' = current_order.channel_store_id
        and jsonb_typeof(data->'body'->'order'->'restaurant'->'id') in ('string', 'number')
        and key in ('received', 'processing', 'failed', 'done')
      order by at desc, id desc limit 1;
    if inbox_backup is not null then
      update public.fh_orders set status = 'failed', channel_error = backup_message, updated_at = observed_at
        where id = current_order.id returning * into current_order;
      insert into public.fh_order_events (order_id, type, detail) values (current_order.id, 'routed_to_skip_tablet',
        jsonb_strip_nulls(jsonb_build_object('validationError', inbox_backup->'validationError',
          'unknownReference', inbox_backup->'unknownReference', 'menuId', inbox_backup->'menuId',
          'message', backup_message, 'source', 'signed_skip_backup_inbox')));
      return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'backed_up')
        || case when recorded then '{"recorded":true}'::jsonb else '{}'::jsonb end;
    end if;
  end if;

  if driver_mode and cancellation is null then
    if driver_status = 'picked_up' and current_order.status in ('new', 'accepted', 'ready') then
      desired_status := 'dispatched';
      driver_timestamps := jsonb_build_object('readyAt', coalesce(current_order.timeline->>'readyAt', event_at),
        'dispatchedAt', coalesce(current_order.timeline->>'dispatchedAt', event_at));
    elsif driver_status = 'delivered' and current_order.status in ('new', 'accepted', 'ready', 'dispatched') then
      desired_status := 'completed';
      driver_timestamps := jsonb_build_object('dispatchedAt', coalesce(current_order.timeline->>'dispatchedAt', event_at),
        'completedAt', coalesce(current_order.timeline->>'completedAt', event_at));
    else
      return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'received');
    end if;
    update public.fh_orders set status = desired_status, timeline = timeline || driver_timestamps, updated_at = observed_at
      where id = current_order.id returning * into current_order;
    return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'received', 'driverAdvanced', true);
  end if;

  if cancellation is null and legacy_uncertain and ((prepare_mode and active_order) or (p_kind = 'prepare_jet' and current_order.status = 'new')) then
    return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'legacy_clover_uncertain');
  end if;

  if jet_mode and cancellation is null then
    if current_order.status = 'cancelled' then
      return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'cancelled');
    end if;
    if p_kind = 'prepare_jet' then
      if current_order.status <> 'new' then
        return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'ignored');
      end if;
      if jet_attempt is not null then
        if invalid_jet_attempt then
          return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_jet');
        end if;
        return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'jet_pending');
      end if;
      has_pos_order := coalesce(btrim(current_order.pos_order_id, blank_store_chars), '') <> '';
      known_pos_order := has_pos_order and coalesce(btrim(stored_merchant, blank_store_chars), '') <> '';
      if not has_pos_order and clover_attempt is not null then
        return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'attempt_pending');
      end if;
      if (jet_signal = 'accept' and not jet_manual and not known_pos_order)
          or (jet_signal = 'fallback' and has_pos_order and (not jet_manual or not known_pos_order)) then
        return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_jet');
      end if;
      jet_attempt := jsonb_build_object('id', gen_random_uuid(), 'at', event_at, 'signal', jet_signal)
        || case when jet_manual then '{"manual":true}'::jsonb else '{}'::jsonb end;
      update public.fh_orders set timeline = timeline || jsonb_build_object('skipJetAttempt', jet_attempt), updated_at = observed_at
        where id = current_order.id returning * into current_order;
      return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'jet_prepared');
    end if;
    if jet_attempt->>'outcome' in ('accepted', 'fallback') then
      if jet_attempt->>'outcome' is distinct from jet_result then
        return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_jet');
      end if;
      return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'jet_finished');
    end if;
    if current_order.status <> 'new' then
      return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'ignored');
    end if;
    if jet_attempt->>'outcome' = 'uncertain' and jet_result = 'uncertain' then
      return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'jet_pending');
    end if;
    jet_timeline := current_order.timeline - 'skipJetAttempt';
    if jet_result <> 'refused' then
      jet_timeline := jet_timeline || jsonb_build_object('skipJetAttempt', jet_attempt || jsonb_build_object('outcome', jet_result));
    end if;
    if jet_result = 'accepted' then
      jet_timeline := (jet_timeline - 'acceptedBy') || jsonb_strip_nulls(jsonb_build_object('acceptedAt', event_at,
        'acceptedBy', coalesce(nullif(jet_fields->>'acceptedBy', ''), case when jet_attempt->'manual' is distinct from 'true'::jsonb then 'auto' end)));
    end if;
    if jet_result in ('accepted', 'fallback') then
      jet_timeline := jet_timeline || jsonb_strip_nulls(jsonb_build_object(
        'seenAt', coalesce(nullif(jet_timeline->>'seenAt', ''), nullif(jet_fields->>'seenAt', '')),
        'seenBy', coalesce(nullif(jet_timeline->>'seenBy', ''), nullif(jet_fields->>'seenBy', '')),
        'approvedBy', nullif(jet_fields->>'approvedBy', '')));
    end if;
    update public.fh_orders set timeline = jet_timeline, updated_at = observed_at,
      status = case jet_result when 'accepted' then 'accepted' when 'fallback' then 'failed' else current_order.status end,
      channel_error = case jet_result when 'accepted' then null
        when 'fallback' then coalesce(jet_fields->>'channelError', 'Sent to the Skip tablet (backup flow).')
        else coalesce(jet_fields->>'channelError', current_order.channel_error) end
      where id = current_order.id returning * into current_order;
    return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'finished', true,
      'outcome', case when jet_result = 'uncertain' then 'jet_pending' else 'jet_finished' end);
  end if;

  if prepare_mode and cancellation is null then
    if current_order.status = 'cancelled' then
      return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'cancelled');
    end if;
    if invalid_attempt or coalesce(stored_merchant, '') <> '' then
      return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_attempt');
    end if;
    if clover_attempt is not null then
      return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'attempt_pending');
    end if;
    if jet_attempt is not null and not coalesce(not invalid_jet_attempt and jet_attempt->'manual' = 'true'::jsonb
        and jet_attempt->>'signal' = 'accept' and jet_attempt->>'outcome' = 'accepted' and current_order.status <> 'new'
        and p_detail->'allowAfterManualAcceptance' = 'true'::jsonb, false) then
      return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'jet_pending');
    end if;
    -- Check only before taking a new attempt. An existing receipt is always reconciled on its saved register.
    select * into current_mapping from public.fh_channel_stores
      where channel = 'skip' and channel_store_id = current_order.channel_store_id for share;
    if (case when expected_mapping = 'null'::jsonb then current_mapping.id is not null else
      jsonb_typeof(expected_mapping) is distinct from 'object'
      or current_mapping.id is null or current_mapping.id::text is distinct from expected_mapping->>'id'
      or current_mapping.channel_store_id is distinct from expected_mapping->>'channelStoreId'
      or current_mapping.location_code is distinct from expected_mapping->>'locationCode'
      or current_mapping.location_code is distinct from current_order.location_code
      or current_mapping.updated_at is distinct from (expected_mapping->>'updatedAt')::timestamptz
      or current_mapping.clover_merchant_id is distinct from expected_mapping->>'cloverMerchantId'
      or (coalesce(current_mapping.clover_merchant_id, '') <> '' and current_mapping.clover_merchant_id <> clover_merchant)
    end) then
      return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'mapping_changed');
    end if;
    update public.fh_orders set timeline = (case when resume_only_lease then
      jsonb_set(timeline, '{posRetry}', (legacy_retry - 'resumeOnly') || '{"uncertain":false}'::jsonb)
      else timeline end) || jsonb_build_object('posCreateAttempt',
      jsonb_build_object('merchantId', clover_merchant, 'at', event_at, 'id', gen_random_uuid())), updated_at = observed_at
      where id = current_order.id returning * into current_order;
    return jsonb_build_object('order', to_jsonb(current_order), 'isNew', false, 'outcome', 'prepared');
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

  if p_kind = 'backup' and coalesce(current_order.channel_store_id, '') <> ''
      and current_order.channel_store_id is distinct from seed.channel_store_id
      and (p_mapped or (coalesce(btrim(current_order.channel_store_id, blank_store_chars), '') <> ''
        and coalesce(current_order.data->>'viaHub', '') = '' and coalesce(current_order.data->>'viaPos', '') = '')) then
    return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_store');
  end if;
  -- An intake outside this lock may have won the unique insert since the first read.
  if p_kind = 'intake' and not inserted and coalesce(btrim(current_order.channel_store_id, blank_store_chars), '') <> ''
      and coalesce(btrim(seed.channel_store_id, blank_store_chars), '') <> ''
      and current_order.channel_store_id is distinct from seed.channel_store_id then
    return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_store');
  end if;
  if not inserted then
    if receipt_mode and cancellation is null then
      disposition := case when current_order.status = 'cancelled' then 'cancelled' else 'received' end;
    elsif p_kind in ('intake', 'check_intake') and (desired_status = 'new'
        or (current_order.status <> 'new' and not (p_kind = 'check_intake' and active_attempt_check))
        or coalesce(current_order.data->>'viaHub', '') <> '' or coalesce(current_order.data->>'viaPos', '') <> '') then
      disposition := 'received';
      parked_cancel := false;
    elsif p_kind = 'backup' and (coalesce(current_order.data->>'viaHub', '') <> '' or coalesce(current_order.data->>'viaPos', '') <> '') then
      disposition := 'ignored';
    elsif desired_status = 'cancelled' and current_order.status = 'cancelled' then
      disposition := 'cancelled';
    elsif p_kind = 'backup' and desired_status = 'failed' and current_order.status = 'failed' and (
      (not invalid_jet_attempt and jet_attempt->>'signal' = 'fallback' and jet_attempt->>'outcome' = 'fallback')
      or exists (select 1 from public.fh_order_events where order_id = current_order.id and type = 'routed_to_skip_tablet')
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
    elsif desired_status = 'failed' then
      insert into public.fh_order_events (order_id, type, detail)
        values (current_order.id, 'routed_to_skip_tablet', event_detail || jsonb_build_object('message', p_message));
      disposition := 'backed_up';
    else
      disposition := 'received';
    end if;
  elsif disposition = 'ignored' and p_kind = 'backup' then
    event_detail := event_detail || jsonb_build_object('status', current_order.status);
    if not exists (select 1 from public.fh_order_events where order_id = current_order.id and type = 'skip_backup_ignored' and detail = event_detail) then
      insert into public.fh_order_events (order_id, type, detail) values (current_order.id, 'skip_backup_ignored', event_detail);
    end if;
  end if;
  return jsonb_build_object('order', to_jsonb(current_order), 'isNew', inserted, 'outcome', disposition)
    || case when transitioned then '{"transitioned":true}'::jsonb else '{}'::jsonb end
    || case when recorded then '{"recorded":true}'::jsonb else '{}'::jsonb end;
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

