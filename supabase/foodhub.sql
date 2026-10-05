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
