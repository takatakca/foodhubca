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

-- One durable attempt per Food Hub order and per physical Clover receipt.
-- A missing or ambiguous provider response leaves the receipt held, across restarts.
create table if not exists public.fh_skip_clover_payments (
  order_id uuid primary key references public.fh_orders(id),
  merchant_id text not null check (btrim(merchant_id) <> ''),
  pos_order_id text not null check (btrim(pos_order_id) <> ''),
  payment_reference text not null check (char_length(payment_reference) <= 32 and btrim(payment_reference) <> ''),
  attempt_id uuid not null unique default gen_random_uuid(),
  attempted_at timestamptz not null,
  state text not null check (state in ('sending', 'uncertain', 'paid')),
  payment_id text check (btrim(payment_id) <> ''),
  unique (merchant_id, pos_order_id),
  check ((state = 'paid') = (payment_id is not null))
);
alter table public.fh_skip_clover_payments enable row level security;
revoke all on public.fh_skip_clover_payments from public;
alter table public.fh_skip_clover_payments
  add column if not exists recovery_due_at timestamptz,
  add column if not exists recovery_lease_id uuid;
create index if not exists fh_skip_payment_recovery_due_idx on public.fh_skip_clover_payments
  ((coalesce(recovery_due_at, attempted_at)), attempted_at, attempt_id) where state <> 'paid';
create index if not exists fh_skip_payment_terminal_open_idx on public.fh_orders (id)
  where channel = 'skip' and status in ('cancelled', 'failed') and pos_order_id is not null
    and nullif(timeline->>'posClosedAt', '') is null;
create index if not exists fh_orders_physical_clover_receipt_idx on public.fh_orders ((timeline->>'posMerchantId'), pos_order_id)
  where pos_order_id is not null;

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
  payment_mode boolean := p_kind in ('prepare_payment', 'check_payment', 'finish_payment');
  receipt_mode boolean := p_kind in ('record_receipt', 'check_receipt') or payment_mode;
  payment_attempt public.fh_skip_clover_payments%rowtype;
  payment_attempt_id text := p_detail->>'attemptId';
  payment_reference text := p_detail->>'paymentReference';
  payment_result text := p_detail->>'result';
  payment_refusal text := left(p_detail->>'error', 500);
  new_payment_id text := p_detail->>'paymentId';
  close_paid_terminal boolean := coalesce(p_detail->'closeTerminal' = 'true'::jsonb, false);
  completed_closure boolean := false;
  payment_active boolean;
  payment_review boolean := false;
  payment_error text;
  payment_review_prefix constant text := 'Skip Clover payment needs review:';
  payment_review_reason constant text := 'Skip Clover payment needs review: Verify the outcome on the recorded register before retrying.';
  payment_uncertain_code constant text := '^Clover payment HTTP [0-9]+:';
  payment_definite_code constant text := '^Clover payment HTTP (0|400|401|403|404|405|415|422|429):';
  payment_response jsonb := '{}'::jsonb;
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
      'prepare_clover', 'clear_clover_attempt', 'hold_legacy_clover', 'prepare_jet', 'finish_jet', 'apply_driver',
      'prepare_payment', 'check_payment', 'finish_payment')
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
        or (p_kind <> 'record_receipt' and (current_order.pos_order_id is distinct from receipt_pos_id
          or stored_merchant is distinct from clover_merchant))
        or (payment_mode and (coalesce(btrim(payment_reference, blank_store_chars), '') = '' or char_length(payment_reference) > 32))
        or (p_kind = 'finish_payment' and coalesce(payment_result, '') not in ('paid', 'refused', 'uncertain')) then
      return jsonb_build_object('order', null, 'isNew', false, 'outcome', case when payment_mode then 'conflicting_payment' else 'conflicting_receipt' end);
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

  if (prepare_mode or jet_mode or (receipt_mode and not payment_mode) or driver_mode) and cancellation is null and current_order.status in ('new', 'accepted', 'ready')
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
  if payment_mode then
    payment_error := current_order.timeline->>'posPaymentError';
    payment_active := current_order.status in ('dispatched', 'completed')
      and nullif(current_order.timeline->>'posClosedAt', '') is null;
    select * into payment_attempt from public.fh_skip_clover_payments where order_id = current_order.id for update;
    if (payment_attempt.order_id is not null and
        (payment_attempt.merchant_id, payment_attempt.pos_order_id, payment_attempt.payment_reference)
        is distinct from (clover_merchant, receipt_pos_id, payment_reference))
        or (payment_attempt.order_id is null and exists (
          select 1 from public.fh_skip_clover_payments where merchant_id = clover_merchant and pos_order_id = receipt_pos_id
          union all
          -- An older row with this exact receipt may already have posted before the ledger existed.
          select 1 from public.fh_orders o where o.pos_order_id = receipt_pos_id and o.timeline->>'posMerchantId' = clover_merchant
            and o.id <> current_order.id and (nullif(o.timeline->>'posPaymentId', '') is not null
              or o.timeline->>'posPaymentError' like payment_review_prefix || '%'
              or o.timeline->>'posPaymentError' like 'Clover payment error:%'
              or (o.timeline->>'posPaymentError' ~ payment_uncertain_code and o.timeline->>'posPaymentError' !~ payment_definite_code))
        )) then
      return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_payment');
    end if;
    if payment_attempt_id is not null and payment_attempt.attempt_id::text is distinct from payment_attempt_id then
      return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_payment');
    end if;

    if p_kind = 'finish_payment' then
      if payment_attempt_id is null or payment_attempt.order_id is null
          or (nullif(current_order.timeline->>'posPaymentId', '') is not null and not (
            payment_result = 'paid' and current_order.timeline->>'posPaymentId' = new_payment_id
          )) then
        return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_payment');
      end if;
      if payment_attempt.state = 'paid' then
        if payment_result <> 'paid' or payment_attempt.payment_id is distinct from new_payment_id
            or (current_order.timeline->>'posPaymentId' is distinct from new_payment_id and not (
              close_paid_terminal and current_order.status in ('cancelled', 'failed')
              and nullif(current_order.timeline->>'posPaymentId', '') is null
            )) then
          return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_payment');
        end if;
        if current_order.timeline->>'posPaymentId' is distinct from new_payment_id then
          update public.fh_orders set timeline = (timeline - 'posPaymentError') || jsonb_build_object('posPaymentId', new_payment_id),
            updated_at = observed_at where id = current_order.id returning * into current_order;
        end if;
        disposition := 'payment_finished';
      elsif payment_result = 'refused' and payment_attempt.state = 'sending' then
        delete from public.fh_skip_clover_payments where order_id = current_order.id and attempt_id = payment_attempt.attempt_id;
        payment_attempt := null;
        if payment_active and coalesce(btrim(payment_refusal, blank_store_chars), '') <> '' then
          update public.fh_orders set timeline = timeline || jsonb_build_object('posPaymentError', payment_refusal),
            updated_at = observed_at where id = current_order.id returning * into current_order;
          insert into public.fh_order_events (order_id, type, detail) values (current_order.id, 'pos_payment_failed',
            jsonb_build_object('error', payment_refusal, 'attemptId', payment_attempt_id));
        end if;
        disposition := 'payment_finished';
      elsif payment_result = 'uncertain' then
        update public.fh_skip_clover_payments set state = 'uncertain' where order_id = current_order.id returning * into payment_attempt;
        payment_review := true;
        disposition := 'payment_pending';
      elsif payment_result = 'paid' and coalesce(btrim(new_payment_id, blank_store_chars), '') <> '' then
        update public.fh_skip_clover_payments set state = 'paid', payment_id = new_payment_id
          where order_id = current_order.id returning * into payment_attempt;
        if nullif(current_order.timeline->>'posPaymentId', '') is null then
          insert into public.fh_order_events (order_id, type, detail) values (current_order.id, 'pos_paid',
            jsonb_build_object('message', 'Recorded as paid in Clover (Skip tender)', 'paymentId', new_payment_id));
        end if;
        update public.fh_orders set timeline = (timeline - 'posPaymentError') || jsonb_build_object('posPaymentId', new_payment_id),
          updated_at = observed_at where id = current_order.id returning * into current_order;
        disposition := 'payment_finished';
      else
        return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_payment');
      end if;
    elsif payment_attempt.state = 'paid' then
      if nullif(current_order.timeline->>'posPaymentId', '') is not null
          and current_order.timeline->>'posPaymentId' is distinct from payment_attempt.payment_id then
        return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_payment');
      end if;
      if current_order.timeline->>'posPaymentId' is distinct from payment_attempt.payment_id then
        update public.fh_orders set timeline = (timeline - 'posPaymentError') || jsonb_build_object('posPaymentId', payment_attempt.payment_id),
          updated_at = observed_at where id = current_order.id returning * into current_order;
      end if;
      disposition := 'payment_finished';
    elsif nullif(current_order.timeline->>'posPaymentId', '') is not null then
      disposition := 'payment_finished';
    elsif payment_attempt.order_id is not null then
      if current_order.status = 'cancelled' then
        disposition := 'cancelled';
      elsif p_kind = 'prepare_payment' and payment_attempt_id is not null and payment_attempt.state = 'sending' and payment_active then
        disposition := 'payment_prepared';
      else
        disposition := 'payment_pending';
      end if;
    else
      payment_review := coalesce(payment_error like payment_review_prefix || '%'
        or payment_error like 'Clover payment error:%'
        or (payment_error ~ payment_uncertain_code and payment_error !~ payment_definite_code), false);
      if payment_review or (p_kind = 'prepare_payment' and payment_active) then
        insert into public.fh_skip_clover_payments (order_id, merchant_id, pos_order_id, payment_reference, attempted_at, state)
          values (current_order.id, clover_merchant, receipt_pos_id, payment_reference, observed_at,
            case when payment_review then 'uncertain' else 'sending' end)
          on conflict do nothing returning * into payment_attempt;
        if payment_attempt.order_id is null then
          return jsonb_build_object('order', null, 'isNew', false, 'outcome', 'conflicting_payment');
        end if;
        disposition := case when not payment_review then 'payment_prepared'
          when current_order.status = 'cancelled' then 'cancelled' else 'payment_pending' end;
      end if;
    end if;

    if p_kind = 'finish_payment' and payment_result = 'paid' and close_paid_terminal
        and disposition = 'payment_finished' and current_order.status in ('cancelled', 'failed')
        and nullif(current_order.timeline->>'posClosedAt', '') is null
        and (current_order.timeline->'posCloseClaim' is null or current_order.timeline->'posCloseClaim' = 'null'::jsonb
          or ((current_order.timeline->'posCloseClaim'->>'at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
            and (current_order.timeline->'posCloseClaim'->>'at') <= to_char(
              (observed_at - interval '5 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) then
      update public.fh_orders set timeline = (timeline - 'posCloseClaim') || jsonb_build_object('posClosedAt', event_at),
        updated_at = observed_at where id = current_order.id returning * into current_order;
      insert into public.fh_order_events (order_id, type, detail) values (current_order.id, 'pos_paid_then_cancelled',
        jsonb_build_object('message', 'Cancelled after it was recorded as paid in Clover — refund it in the Clover app if the platform did not pay you.'));
      completed_closure := true;
    end if;

    if payment_review then
      if current_order.timeline->>'posPaymentError' is distinct from payment_review_reason then
        update public.fh_orders set timeline = timeline || jsonb_build_object('posPaymentError', payment_review_reason),
          updated_at = observed_at where id = current_order.id returning * into current_order;
      end if;
      if not exists (select 1 from public.fh_order_events where order_id = current_order.id and type = 'needs_attention'
          and detail->>'source' = 'skip_clover_payment' and detail->>'attemptId' = payment_attempt.attempt_id::text) then
        insert into public.fh_order_events (order_id, type, detail) values (current_order.id, 'needs_attention',
          jsonb_build_object('reason', payment_review_reason, 'source', 'skip_clover_payment', 'attemptId', payment_attempt.attempt_id));
      end if;
    end if;
    if payment_attempt.order_id is not null then
      payment_response := jsonb_build_object('paymentAttempt', jsonb_strip_nulls(jsonb_build_object(
        'id', payment_attempt.attempt_id, 'at', to_char(payment_attempt.attempted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'merchantId', payment_attempt.merchant_id, 'posOrderId', payment_attempt.pos_order_id,
        'paymentReference', payment_attempt.payment_reference, 'state', payment_attempt.state, 'paymentId', payment_attempt.payment_id)));
    end if;
  end if;

  return jsonb_build_object('order', to_jsonb(current_order), 'isNew', inserted, 'outcome', disposition)
    || case when transitioned then '{"transitioned":true}'::jsonb else '{}'::jsonb end
    || case when recorded then '{"recorded":true}'::jsonb else '{}'::jsonb end
    || case when completed_closure then '{"completedClosure":true}'::jsonb else '{}'::jsonb end || payment_response;
end;
$skip_lifecycle$;

-- Reserve only a read-only check of an existing attempt. An interrupted worker yields after 90 seconds.
create or replace function public.fh_claim_skip_payment_recoveries(p_limit integer)
returns jsonb language sql security invoker set search_path = pg_catalog
as $claim_recoveries$
  with waiting as materialized (
    select p.attempt_id, p.attempted_at, coalesce(p.recovery_due_at, p.attempted_at) as due_at, to_jsonb(o) as order_data
    from public.fh_skip_clover_payments p join public.fh_orders o on o.id = p.order_id
    where p.state <> 'paid' and p.attempted_at <= statement_timestamp() - interval '2 minutes'
      and coalesce(p.recovery_due_at, p.attempted_at) <= statement_timestamp()
      and o.channel = 'skip' and coalesce(o.data->>'viaHub', '') = '' and coalesce(o.data->>'viaPos', '') = ''
      and o.pos_order_id = p.pos_order_id and o.timeline->>'posMerchantId' = p.merchant_id
      and nullif(o.timeline->>'posPaymentId', '') is null
    order by due_at, p.attempted_at, p.attempt_id
    limit greatest(0, least(coalesce(p_limit, 0), 12)) for update of p skip locked
  ), terminal_paid as materialized (
    select p.attempt_id, p.attempted_at, coalesce(p.recovery_due_at, p.attempted_at) as due_at, to_jsonb(o) as order_data
    from public.fh_orders o join public.fh_skip_clover_payments p on p.order_id = o.id
    where o.channel = 'skip' and o.status in ('cancelled', 'failed') and o.pos_order_id is not null
      and nullif(o.timeline->>'posClosedAt', '') is null and p.state = 'paid'
      and coalesce(p.recovery_due_at, p.attempted_at) <= statement_timestamp()
      and coalesce(o.data->>'viaHub', '') = '' and coalesce(o.data->>'viaPos', '') = ''
      and o.pos_order_id = p.pos_order_id and o.timeline->>'posMerchantId' = p.merchant_id
      and (nullif(o.timeline->>'posPaymentId', '') is null or o.timeline->>'posPaymentId' = p.payment_id)
    order by due_at, p.attempted_at, p.attempt_id
    limit greatest(0, least(coalesce(p_limit, 0), 12)) for update of p skip locked
  ), selected as (
    select * from (select * from waiting union all select * from terminal_paid) eligible
    order by due_at, attempted_at, attempt_id limit greatest(0, least(coalesce(p_limit, 0), 12))
  ), leased as (
    update public.fh_skip_clover_payments p
    set recovery_due_at = statement_timestamp() + interval '90 seconds', recovery_lease_id = gen_random_uuid()
    from selected s where p.attempt_id = s.attempt_id
    returning p.*, s.order_data, s.due_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('order', order_data, 'leaseId', recovery_lease_id,
    'paymentAttempt', jsonb_strip_nulls(jsonb_build_object(
      'id', attempt_id, 'at', to_char(attempted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'merchantId', merchant_id, 'posOrderId', pos_order_id, 'paymentReference', payment_reference,
      'state', state, 'paymentId', payment_id))) order by due_at, attempted_at, attempt_id), '[]'::jsonb)
  from leased;
$claim_recoveries$;

create or replace function public.fh_reschedule_skip_payment_recovery(p_attempt_id uuid, p_lease_id uuid, p_next_check_at timestamptz)
returns boolean language sql security invoker set search_path = pg_catalog
as $reschedule_recovery$
  with moved as (
    update public.fh_skip_clover_payments
    set recovery_due_at = greatest(statement_timestamp() + interval '15 seconds',
      least(p_next_check_at, statement_timestamp() + interval '30 minutes')), recovery_lease_id = null
    where attempt_id = p_attempt_id and recovery_lease_id = p_lease_id
      and recovery_due_at > statement_timestamp() and p_next_check_at is not null
    returning 1
  ) select exists (select 1 from moved);
$reschedule_recovery$;

revoke all on function public.fh_apply_skip_lifecycle(text, text, jsonb, boolean, text, jsonb) from public;
revoke all on function public.fh_claim_skip_payment_recoveries(integer) from public;
revoke all on function public.fh_reschedule_skip_payment_recovery(uuid, uuid, timestamptz) from public;
do $skip_lifecycle_permissions$
declare role_name text;
begin
  for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role') loop
    execute format('%s on function public.fh_apply_skip_lifecycle(text, text, jsonb, boolean, text, jsonb) %s %I',
      case when role_name = 'service_role' then 'grant execute' else 'revoke all' end,
      case when role_name = 'service_role' then 'to' else 'from' end, role_name);
    execute format('%s on function public.fh_claim_skip_payment_recoveries(integer),
      public.fh_reschedule_skip_payment_recovery(uuid, uuid, timestamptz) %s %I',
      case when role_name = 'service_role' then 'grant execute' else 'revoke all' end,
      case when role_name = 'service_role' then 'to' else 'from' end, role_name);
    execute format('%s on public.fh_skip_clover_payments %s %I',
      case when role_name = 'service_role' then 'grant select, insert, update, delete' else 'revoke all' end,
      case when role_name = 'service_role' then 'to' else 'from' end, role_name);
  end loop;
end;
$skip_lifecycle_permissions$;

notify pgrst, 'reload schema';
commit;
