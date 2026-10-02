create extension if not exists "pgcrypto";

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  code text not null unique,
  name text not null,
  address_line_1 text not null,
  city text not null,
  province text not null default 'QC',
  postal_code text,
  country text not null default 'CA',
  created_at timestamptz not null default now()
);

create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  name text not null unique,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists platforms (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  required_for_service_check boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists platform_stores (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid references platforms(id),
  brand_id uuid references brands(id),
  location_id uuid references locations(id),
  external_business_id text,
  external_store_id text,
  store_name text not null,
  address_line_1 text,
  city text,
  province text,
  postal_code text,
  country text not null default 'CA',
  activation_status text not null check (activation_status in ('active','deactivated')),
  open_status text not null check (open_status in ('open','closed','unknown')),
  status_symbol text,
  needs_review boolean not null default false,
  review_note text,
  raw_payload jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists urbanpiper_locations (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id),
  urbanpiper_location_id text not null unique,
  account_name text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists platform_connector_configs (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid references platforms(id),
  mode text not null check (mode in ('oauth','api_key','manual_report','screen_capture','disabled')),
  enabled boolean not null default false,
  credential_status text not null default 'missing',
  secret_reference text,
  health_status text not null default 'not_checked',
  last_health_check_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists connector_runs (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid references platforms(id),
  run_type text not null,
  status text not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ingest_events (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid references platforms(id),
  entity_type text not null,
  external_id text not null,
  raw_payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(platform_id, entity_type, external_id)
);

create table if not exists ai_supervision_findings (
  id uuid primary key default gen_random_uuid(),
  ingest_event_id uuid references ingest_events(id) on delete cascade,
  severity text not null check (severity in ('low','medium','high','critical')),
  finding_type text not null,
  title text not null,
  detail text,
  suggested_action text,
  review_status text not null default 'new',
  created_at timestamptz not null default now()
);

create table if not exists fix_tasks (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id uuid,
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  title text not null,
  detail text,
  status text not null default 'open' check (status in ('open','in_progress','held','done','cancelled')),
  assigned_to uuid,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists verification_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,
  status text not null default 'completed',
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists verification_findings (
  id uuid primary key default gen_random_uuid(),
  verification_run_id uuid references verification_runs(id) on delete cascade,
  severity text not null check (severity in ('low','medium','high','critical')),
  finding_type text not null,
  brand_id uuid references brands(id),
  location_id uuid references locations(id),
  platform_id uuid references platforms(id),
  title text not null,
  detail text,
  suggested_action text,
  review_status text not null default 'new',
  created_at timestamptz not null default now()
);

create table if not exists ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_type text not null,
  platform_id uuid references platforms(id),
  created_at timestamptz not null default now()
);

create table if not exists ledger_drafts (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_external_id text,
  status text not null default 'draft_review_required',
  expected_amount numeric(12,2),
  actual_amount numeric(12,2),
  difference_amount numeric(12,2),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ledger_draft_lines (
  id uuid primary key default gen_random_uuid(),
  ledger_draft_id uuid references ledger_drafts(id) on delete cascade,
  account_name text not null,
  debit numeric(12,2) not null default 0,
  credit numeric(12,2) not null default 0,
  memo text,
  created_at timestamptz not null default now()
);

create table if not exists review_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  decision text not null,
  note text,
  decided_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id),
  brand_id uuid references brands(id),
  supplier_name text,
  document_date date,
  total_amount numeric(12,2),
  tax_amount numeric(12,2),
  storage_path text,
  review_status text not null default 'new',
  raw_extraction jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists stock_documents (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id),
  brand_id uuid references brands(id),
  supplier_name text,
  stock_cost_group text,
  total_amount numeric(12,2),
  storage_path text,
  review_status text not null default 'new',
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
