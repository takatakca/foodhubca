-- Final operational patch — live onboarding, sync orchestration, and webhook/event audit.

create table if not exists connector_owner_approvals (
  id uuid primary key default gen_random_uuid(),
  platform_key text not null,
  action text not null check (action in ('enable_live','enable_autodiscovery','enable_sync_now','enable_scheduled_sync','disable_live')),
  decision text not null check (decision in ('approved','rejected','revoked')),
  decided_by uuid,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists connector_schedules (
  id uuid primary key default gen_random_uuid(),
  platform_key text not null,
  sync_type text not null check (sync_type in ('stores','orders','payouts','inventory','documents','full')),
  cadence text not null check (cadence in ('hourly','daily','weekly','manual')) default 'manual',
  enabled boolean not null default false,
  last_run_at timestamptz,
  next_run_at timestamptz,
  owner_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform_key, sync_type)
);

create table if not exists connector_webhook_events (
  id uuid primary key default gen_random_uuid(),
  platform_key text not null,
  event_type text not null,
  external_event_id text,
  signature_valid boolean,
  raw_headers jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  processing_status text not null default 'received' check (processing_status in ('received','validated','processed','failed','ignored')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(platform_key, external_event_id)
);

create table if not exists platform_entities (
  id uuid primary key default gen_random_uuid(),
  platform_key text not null,
  entity_type text not null check (entity_type in ('account','location','store','brand','menu','item','order','payout','inventory','document','unknown')),
  external_id text,
  display_name text,
  brand_hint text,
  location_hint text,
  status text,
  raw_payload jsonb not null default '{}'::jsonb,
  matched_brand_id uuid references brands(id),
  matched_location_id uuid references locations(id),
  match_status text not null default 'unmatched' check (match_status in ('unmatched','suggested','approved','rejected','ignored')),
  match_confidence numeric(5,2) default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(platform_key, entity_type, external_id)
);

create table if not exists sync_orchestration_runs (
  id uuid primary key default gen_random_uuid(),
  run_scope text not null check (run_scope in ('manual','scheduled','webhook','backfill')),
  platform_key text,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','blocked','cancelled')),
  started_at timestamptz,
  finished_at timestamptz,
  health_check_status text,
  autodiscovery_status text,
  sync_status text,
  ai_review_status text,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists ai_post_sync_reviews (
  id uuid primary key default gen_random_uuid(),
  sync_orchestration_run_id uuid references sync_orchestration_runs(id) on delete cascade,
  platform_key text not null,
  total_records integer not null default 0,
  findings_created integer not null default 0,
  high_risk_count integer not null default 0,
  summary text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into connector_schedules (platform_key, sync_type, cadence, enabled, owner_approved) values
('urbanpiper','stores','manual',false,false),
('urbanpiper','orders','manual',false,false),
('clover','orders','manual',false,false),
('clover','inventory','manual',false,false),
('doordash','payouts','manual',false,false),
('uber_eats','payouts','manual',false,false),
('skip_the_dishes','payouts','manual',false,false),
('too_good_to_go','payouts','manual',false,false)
on conflict (platform_key, sync_type) do nothing;
