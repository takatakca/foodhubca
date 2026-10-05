-- Phase 25 — Live Connector Layer
-- Run after the base schema. This patch is safe/idempotent where possible.

create table if not exists connector_secret_requirements (
  id uuid primary key default gen_random_uuid(),
  platform_key text not null,
  secret_key text not null,
  label text not null,
  required boolean not null default true,
  storage_mode text not null default 'server_env',
  description text,
  created_at timestamptz not null default now(),
  unique(platform_key, secret_key)
);

create table if not exists connector_feature_flags (
  id uuid primary key default gen_random_uuid(),
  platform_key text not null unique,
  live_enabled boolean not null default false,
  owner_approved boolean not null default false,
  allow_autodiscovery boolean not null default false,
  allow_sync_now boolean not null default false,
  allow_scheduled_sync boolean not null default false,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists connector_health_checks (
  id uuid primary key default gen_random_uuid(),
  platform_key text not null,
  status text not null check (status in ('not_configured','blocked','healthy','unhealthy','error')),
  can_call_live boolean not null default false,
  missing_secret_keys text[] not null default '{}',
  checked_at timestamptz not null default now(),
  latency_ms integer,
  error_message text,
  raw_result jsonb not null default '{}'::jsonb
);

create table if not exists connector_autodiscovery_runs (
  id uuid primary key default gen_random_uuid(),
  platform_key text not null,
  status text not null check (status in ('queued','running','completed','failed','blocked')) default 'queued',
  discovered_count integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  raw_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists connector_sync_runs (
  id uuid primary key default gen_random_uuid(),
  platform_key text not null,
  sync_type text not null check (sync_type in ('stores','orders','payouts','inventory','documents','full')),
  status text not null check (status in ('queued','running','completed','failed','blocked')) default 'queued',
  source_window_start timestamptz,
  source_window_end timestamptz,
  records_fetched integer not null default 0,
  records_ingested integer not null default 0,
  ai_findings_created integer not null default 0,
  fix_tasks_created integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  raw_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ingested_platform_records (
  id uuid primary key default gen_random_uuid(),
  platform_key text not null,
  connector_run_id uuid,
  record_type text not null,
  external_id text,
  brand_hint text,
  location_hint text,
  store_hint text,
  occurred_at timestamptz,
  amount numeric(12,2),
  currency text default 'CAD',
  raw_payload jsonb not null,
  normalized_payload jsonb not null default '{}'::jsonb,
  ai_status text not null default 'pending' check (ai_status in ('pending','reviewed','needs_review','ignored')),
  created_at timestamptz not null default now()
);

create table if not exists ai_ingestion_findings (
  id uuid primary key default gen_random_uuid(),
  ingested_record_id uuid references ingested_platform_records(id) on delete cascade,
  platform_key text not null,
  finding_type text not null,
  severity text not null check (severity in ('info','low','medium','high','critical')) default 'medium',
  title text not null,
  description text,
  confidence numeric(5,2) default 0,
  suggested_action text,
  review_status text not null default 'open' check (review_status in ('open','accepted','rejected','resolved','ignored')),
  created_at timestamptz not null default now()
);

insert into connector_secret_requirements (platform_key, secret_key, label, required, storage_mode, description) values
('clover','CLOVER_CLIENT_ID','Clover Client ID',true,'server_env','OAuth app client ID.'),
('clover','CLOVER_CLIENT_SECRET','Clover Client Secret',true,'server_env','OAuth app secret.'),
('clover','CLOVER_MERCHANT_ID','Clover Merchant ID',true,'server_env','Merchant/location ID for Clover.'),
('doordash','DOORDASH_DEVELOPER_ID','DoorDash Developer ID',true,'server_env','DoorDash developer/reporting access value.'),
('doordash','DOORDASH_KEY_ID','DoorDash Key ID',true,'server_env','DoorDash signing/key id.'),
('doordash','DOORDASH_SIGNING_SECRET','DoorDash Signing Secret',true,'server_env','DoorDash signing secret.'),
('uber_eats','UBER_CLIENT_ID','Uber Client ID',true,'server_env','Uber OAuth client id.'),
('uber_eats','UBER_CLIENT_SECRET','Uber Client Secret',true,'server_env','Uber OAuth secret.'),
('skip_the_dishes','SKIP_JET_API_KEY','SkipTheDishes JET Connect API key',true,'server_env','JET Connect (Flyt) API key used for menus, item 86 and order confirmation.'),
('too_good_to_go','TGTG_WEBHOOK_SECRET','Too Good To Go webhook secret',true,'server_env','Webhook-only integration: there is no public merchant API to call.')
on conflict (platform_key, secret_key) do nothing;

insert into connector_feature_flags (platform_key, live_enabled, owner_approved, allow_autodiscovery, allow_sync_now, allow_scheduled_sync, notes) values
('clover', false, false, false, false, false, 'POS source for orders/payments/inventory.'),
('doordash', false, false, false, false, false, 'Delivery platform verification source.'),
('uber_eats', false, false, false, false, false, 'Delivery platform verification source.'),
('skip_the_dishes', false, false, false, false, false, 'Delivery platform verification source.'),
('too_good_to_go', false, false, false, false, false, 'Additional sales/payout source.')
on conflict (platform_key) do nothing;
