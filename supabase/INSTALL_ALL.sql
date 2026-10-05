-- TAKATAK Accounting Control Tower + Food Hub — ONE-PASTE DATABASE INSTALL
-- Paste this entire file into Supabase SQL Editor and click Run once.
-- It contains all 9 install files in the correct order. Regenerate with: node scripts/build-install-sql.mjs

-- ============================================================
-- FILE: schema.sql
-- ============================================================
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

-- Re-running the installer must not duplicate the seeded stores: one row per platform × brand × location × store name.
delete from platform_stores a using platform_stores b
  where a.platform_id is not distinct from b.platform_id and a.brand_id is not distinct from b.brand_id and a.location_id is not distinct from b.location_id
    and a.store_name = b.store_name and (b.created_at < a.created_at or (b.created_at = a.created_at and b.id < a.id));
create unique index if not exists platform_stores_identity_uidx on platform_stores (platform_id, brand_id, location_id, store_name);

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

-- One connector configuration per platform.
delete from platform_connector_configs a using platform_connector_configs b
  where a.platform_id = b.platform_id and (b.created_at < a.created_at or (b.created_at = a.created_at and b.id < a.id));
create unique index if not exists platform_connector_configs_platform_uidx on platform_connector_configs (platform_id);

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

-- ============================================================
-- FILE: seed.sql
-- ============================================================
insert into companies (name) values ('Quadro Holdings LTEE') on conflict (name) do nothing;

insert into platforms (key, name, required_for_service_check) values
  ('clover','Clover',false),
  ('doordash','DoorDash',true),
  ('uber_eats','Uber Eats',true),
  ('skip_the_dishes','SkipTheDishes',true),
  ('too_good_to_go','Too Good To Go',false)
on conflict (key) do update set name = excluded.name, required_for_service_check = excluded.required_for_service_check;

insert into locations (company_id, code, name, address_line_1, city, province, postal_code, country) values
((select id from companies where name='Quadro Holdings LTEE'), 'NDG_MAIN', 'NDG MAIN', '6280 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA'),
((select id from companies where name='Quadro Holdings LTEE'), 'NDG_6284', 'NDG 6284', '6284 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA'),
((select id from companies where name='Quadro Holdings LTEE'), 'HOCHELAGA', 'HOCHELAGA', '3583 Rue Sainte-Catherine E', 'Montréal', 'QC', 'H1W 2E6', 'CA'),
((select id from companies where name='Quadro Holdings LTEE'), 'SAINT_LEONARD', 'SAINT-LÉONARD', '5837 Rue Jean-Talon E', 'Saint-Léonard', 'QC', 'H1S 1M4', 'CA')
on conflict (code) do update set name=excluded.name, address_line_1=excluded.address_line_1, city=excluded.city, province=excluded.province, postal_code=excluded.postal_code;

insert into brands (company_id, name) values
((select id from companies where name='Quadro Holdings LTEE'), 'Nutrition Shake'),
((select id from companies where name='Quadro Holdings LTEE'), 'OOeuf'),
((select id from companies where name='Quadro Holdings LTEE'), 'Po Poulet'),
((select id from companies where name='Quadro Holdings LTEE'), 'Pi Pita'),
((select id from companies where name='Quadro Holdings LTEE'), 'OCRÊPE'),
((select id from companies where name='Quadro Holdings LTEE'), 'PPP Pizzeria'),
((select id from companies where name='Quadro Holdings LTEE'), 'Bin molle & Bin Dure'),
((select id from companies where name='Quadro Holdings LTEE'), 'Gateau Montreal'),
((select id from companies where name='Quadro Holdings LTEE'), 'Pizza Inntime'),
((select id from companies where name='Quadro Holdings LTEE'), 'Dejeuner & Dinner'),
((select id from companies where name='Quadro Holdings LTEE'), 'Pita Libanais'),
((select id from companies where name='Quadro Holdings LTEE'), 'Poulet Poulet'),
((select id from companies where name='Quadro Holdings LTEE'), 'Taco Mexican'),
((select id from companies where name='Quadro Holdings LTEE'), 'Cafe Bolon'),
((select id from companies where name='Quadro Holdings LTEE'), 'Mythos 2 Go'),
((select id from companies where name='Quadro Holdings LTEE'), 'Place Afrique'),
((select id from companies where name='Quadro Holdings LTEE'), 'Crèmerie Bin Molle Bin Dure'),
((select id from companies where name='Quadro Holdings LTEE'), 'Too Good To Go')
on conflict (name) do nothing;

insert into platform_stores (platform_id, brand_id, location_id, external_business_id, external_store_id, store_name, address_line_1, city, province, postal_code, country, activation_status, open_status, status_symbol, needs_review, review_note, raw_payload) values
((select id from platforms where key='doordash'), (select id from brands where name='Nutrition Shake'), (select id from locations where code='NDG_6284'), '12606537', '', 'Nutrition', '6284 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'active', 'closed', 'Z', false, '', '{"brand_name": "Nutrition Shake", "store_name": "Nutrition", "location_code": "NDG_6284", "address_line_1": "6284 Av Somerled", "activation_status": "active", "open_status": "closed", "status_symbol": "Z", "external_business_id": "12606537"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Nutrition Shake'), (select id from locations where code='SAINT_LEONARD'), '12606537', '', 'Nutrition Shake Saint Leonard', '5837 Rue Jean-Talon E', 'Saint-Léonard', 'QC', 'H1S 1M4', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Nutrition Shake", "store_name": "Nutrition Shake Saint Leonard", "location_code": "SAINT_LEONARD", "address_line_1": "5837 Rue Jean-Talon E", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "12606537"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Nutrition Shake'), (select id from locations where code='NDG_MAIN'), '12606537', '', 'Nutrition Shake (NOTRE-DAME-DE-GRÂCE)', '6280 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Nutrition Shake", "store_name": "Nutrition Shake (NOTRE-DAME-DE-GRÂCE)", "location_code": "NDG_MAIN", "address_line_1": "6280 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "12606537"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Nutrition Shake'), (select id from locations where code='HOCHELAGA'), '12606537', '', 'Nutrition Shake (HOCHELAGA)', '3583 Rue Sainte-Catherine E', 'Montréal', 'QC', 'H1W 2E6', 'CA', 'active', 'closed', 'Z', false, '', '{"brand_name": "Nutrition Shake", "store_name": "Nutrition Shake (HOCHELAGA)", "location_code": "HOCHELAGA", "address_line_1": "3583 Rue Sainte-Catherine E", "activation_status": "active", "open_status": "closed", "status_symbol": "Z", "external_business_id": "12606537"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='OOeuf'), (select id from locations where code='NDG_6284'), '12748843', '', 'OOEUF Express NDG', '6284 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'active', 'closed', 'Z', false, '', '{"brand_name": "OOeuf", "store_name": "OOEUF Express NDG", "location_code": "NDG_6284", "address_line_1": "6284 Av Somerled", "activation_status": "active", "open_status": "closed", "status_symbol": "Z", "external_business_id": "12748843"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='OOeuf'), (select id from locations where code='NDG_6284'), '12748843', '', 'OOEUF SUPREME', '6284 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'active', 'closed', 'Z', false, '', '{"brand_name": "OOeuf", "store_name": "OOEUF SUPREME", "location_code": "NDG_6284", "address_line_1": "6284 Av Somerled", "activation_status": "active", "open_status": "closed", "status_symbol": "Z", "external_business_id": "12748843"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='OOeuf'), (select id from locations where code='HOCHELAGA'), '12748843', '', 'OOEUF (HOCHELAGA)', '3583 Rue Sainte-Catherine E', 'Montréal', 'QC', 'H1W 2E6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "OOeuf", "store_name": "OOEUF (HOCHELAGA)", "location_code": "HOCHELAGA", "address_line_1": "3583 Rue Sainte-Catherine E", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "12748843"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='OOeuf'), (select id from locations where code='NDG_MAIN'), '12748843', '', 'OOEUF (NOTRE-DAME-DE-GRÂCE)', '6280 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "OOeuf", "store_name": "OOEUF (NOTRE-DAME-DE-GRÂCE)", "location_code": "NDG_MAIN", "address_line_1": "6280 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "12748843"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Po Poulet'), (select id from locations where code='NDG_6284'), '12796649', '', 'Po Poulet NDG', '6284 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'active', 'closed', 'Z', false, '', '{"brand_name": "Po Poulet", "store_name": "Po Poulet NDG", "location_code": "NDG_6284", "address_line_1": "6284 Av Somerled", "activation_status": "active", "open_status": "closed", "status_symbol": "Z", "external_business_id": "12796649"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Po Poulet'), (select id from locations where code='HOCHELAGA'), '12796649', '', 'Poulet Poulet (HOCHELAGA)', '3583 Rue Sainte-Catherine E', 'Montréal', 'QC', 'H1W 2E6', 'CA', 'active', 'closed', 'Z', false, '', '{"brand_name": "Po Poulet", "store_name": "Poulet Poulet (HOCHELAGA)", "location_code": "HOCHELAGA", "address_line_1": "3583 Rue Sainte-Catherine E", "activation_status": "active", "open_status": "closed", "status_symbol": "Z", "external_business_id": "12796649"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Po Poulet'), (select id from locations where code='SAINT_LEONARD'), '12796649', '', 'Po Poulet (ST LEONARD)', '5837 Rue Jean-Talon E', 'Saint-Léonard', 'QC', 'H1S 1M4', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Po Poulet", "store_name": "Po Poulet (ST LEONARD)", "location_code": "SAINT_LEONARD", "address_line_1": "5837 Rue Jean-Talon E", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "12796649"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Po Poulet'), (select id from locations where code='NDG_MAIN'), '12796649', '', 'Po Poulet Hochelaga', '6280 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', true, 'Name says Hochelaga but address is NDG MAIN.', '{"brand_name": "Po Poulet", "store_name": "Po Poulet Hochelaga", "location_code": "NDG_MAIN", "address_line_1": "6280 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "12796649", "needs_review": true, "review_note": "Name says Hochelaga but address is NDG MAIN."}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Pi Pita'), (select id from locations where code='NDG_6284'), '12798384', '', 'Pi Pita', '6284 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Pi Pita", "store_name": "Pi Pita", "location_code": "NDG_6284", "address_line_1": "6284 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "12798384"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Pi Pita'), (select id from locations where code='HOCHELAGA'), '12798384', '', 'Pi Pita (HOCHELAGA)', '3583 Rue Sainte-Catherine E', 'Montréal', 'QC', 'H1W 2E6', 'CA', 'active', 'closed', 'Z', false, '', '{"brand_name": "Pi Pita", "store_name": "Pi Pita (HOCHELAGA)", "location_code": "HOCHELAGA", "address_line_1": "3583 Rue Sainte-Catherine E", "activation_status": "active", "open_status": "closed", "status_symbol": "Z", "external_business_id": "12798384"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Pi Pita'), (select id from locations where code='NDG_MAIN'), '12798384', '', 'Pi Pita (Montréal NOTRE-DAME-DE-GRÂCE)', '6280 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Pi Pita", "store_name": "Pi Pita (Montréal NOTRE-DAME-DE-GRÂCE)", "location_code": "NDG_MAIN", "address_line_1": "6280 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "12798384"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='OCRÊPE'), (select id from locations where code='NDG_6284'), '12798510', '', 'OCRÊPE', '6284 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'active', 'closed', 'Z', false, '', '{"brand_name": "OCRÊPE", "store_name": "OCRÊPE", "location_code": "NDG_6284", "address_line_1": "6284 Av Somerled", "activation_status": "active", "open_status": "closed", "status_symbol": "Z", "external_business_id": "12798510"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='OCRÊPE'), (select id from locations where code='HOCHELAGA'), '12798510', '', 'OCRÊPE (HOCHELAGA)', '3583 Rue Sainte-Catherine E', 'Montréal', 'QC', 'H1W 2E6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "OCRÊPE", "store_name": "OCRÊPE (HOCHELAGA)", "location_code": "HOCHELAGA", "address_line_1": "3583 Rue Sainte-Catherine E", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "12798510"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='OCRÊPE'), (select id from locations where code='NDG_MAIN'), '12798510', '', 'OCRÊPE (NOTRE-DAME-DE-GRÂCE)', '6280 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "OCRÊPE", "store_name": "OCRÊPE (NOTRE-DAME-DE-GRÂCE)", "location_code": "NDG_MAIN", "address_line_1": "6280 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "12798510"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='PPP Pizzeria'), (select id from locations where code='HOCHELAGA'), '12820103', '', 'PPP Pizzeria (HOCHELAGA)', '3583 Rue Sainte-Catherine E', 'Montréal', 'QC', 'H1W 2E6', 'CA', 'active', 'closed', 'Z', false, '', '{"brand_name": "PPP Pizzeria", "store_name": "PPP Pizzeria (HOCHELAGA)", "location_code": "HOCHELAGA", "address_line_1": "3583 Rue Sainte-Catherine E", "activation_status": "active", "open_status": "closed", "status_symbol": "Z", "external_business_id": "12820103"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='PPP Pizzeria'), (select id from locations where code='NDG_6284'), '12820103', '', 'PPP Pizzeria', '6284 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'active', 'closed', 'Z', false, '', '{"brand_name": "PPP Pizzeria", "store_name": "PPP Pizzeria", "location_code": "NDG_6284", "address_line_1": "6284 Av Somerled", "activation_status": "active", "open_status": "closed", "status_symbol": "Z", "external_business_id": "12820103"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='PPP Pizzeria'), (select id from locations where code='NDG_MAIN'), '12820103', '', 'PPP Pizzeria (NOTRE-DAME-DE-GRÂCE)', '6280 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "PPP Pizzeria", "store_name": "PPP Pizzeria (NOTRE-DAME-DE-GRÂCE)", "location_code": "NDG_MAIN", "address_line_1": "6280 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "12820103"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Bin molle & Bin Dure'), (select id from locations where code='HOCHELAGA'), '12844632', '', 'Bin Molle & Bin Dure (HOCHELAGA)', '3583 Rue Sainte-Catherine E', 'Montréal', 'QC', 'H1W 2E6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Bin molle & Bin Dure", "store_name": "Bin Molle & Bin Dure (HOCHELAGA)", "location_code": "HOCHELAGA", "address_line_1": "3583 Rue Sainte-Catherine E", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "12844632"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Bin molle & Bin Dure'), (select id from locations where code='NDG_6284'), '12844632', '', 'Bin molle & Bin Dure NDG', '6284 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Bin molle & Bin Dure", "store_name": "Bin molle & Bin Dure NDG", "location_code": "NDG_6284", "address_line_1": "6284 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "12844632"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Gateau Montreal'), (select id from locations where code='NDG_MAIN'), '12847317', '', 'Gateau Montréal (NOTRE-DAME-DE-GRÂCE)', '6280 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Gateau Montreal", "store_name": "Gateau Montréal (NOTRE-DAME-DE-GRÂCE)", "location_code": "NDG_MAIN", "address_line_1": "6280 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "12847317"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Gateau Montreal'), (select id from locations where code='HOCHELAGA'), '12847317', '', 'Gâteau Montréal (HOCHELAGA)', '3583 Rue Sainte-Catherine E', 'Montréal', 'QC', 'H1W 2E6', 'CA', 'active', 'closed', 'Z', false, '', '{"brand_name": "Gateau Montreal", "store_name": "Gâteau Montréal (HOCHELAGA)", "location_code": "HOCHELAGA", "address_line_1": "3583 Rue Sainte-Catherine E", "activation_status": "active", "open_status": "closed", "status_symbol": "Z", "external_business_id": "12847317"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Gateau Montreal'), (select id from locations where code='NDG_6284'), '12847317', '', 'Gateau Montreal', '6284 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'active', 'closed', 'Z', false, '', '{"brand_name": "Gateau Montreal", "store_name": "Gateau Montreal", "location_code": "NDG_6284", "address_line_1": "6284 Av Somerled", "activation_status": "active", "open_status": "closed", "status_symbol": "Z", "external_business_id": "12847317"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Pizza Inntime'), (select id from locations where code='NDG_MAIN'), '12885507', '', 'Pizza INNTIME Montréal', '6280 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Pizza Inntime", "store_name": "Pizza INNTIME Montréal", "location_code": "NDG_MAIN", "address_line_1": "6280 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "12885507"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Pizza Inntime'), (select id from locations where code='NDG_6284'), '12885507', '', 'Pizza INNTIME', '6284 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'active', 'closed', 'Z', false, '', '{"brand_name": "Pizza Inntime", "store_name": "Pizza INNTIME", "location_code": "NDG_6284", "address_line_1": "6284 Av Somerled", "activation_status": "active", "open_status": "closed", "status_symbol": "Z", "external_business_id": "12885507"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Pizza Inntime'), (select id from locations where code='HOCHELAGA'), '12885507', '', 'PIZZA INNTIME (HOCHELAGA)', '3583 Rue Sainte-Catherine E', 'Montréal', 'QC', 'H1W 2E6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Pizza Inntime", "store_name": "PIZZA INNTIME (HOCHELAGA)", "location_code": "HOCHELAGA", "address_line_1": "3583 Rue Sainte-Catherine E", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "12885507"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Place Afrique'), (select id from locations where code='NDG_6284'), '13838349', '', 'PLACE AFRIQUE NDG', '6284 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Place Afrique", "store_name": "PLACE AFRIQUE NDG", "location_code": "NDG_6284", "address_line_1": "6284 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "13838349"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Place Afrique'), (select id from locations where code='HOCHELAGA'), '13838349', '', 'Place D''Afrique HOCHELAGA', '3583 Rue Sainte-Catherine E', 'Montréal', 'QC', 'H1W 2E6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Place Afrique", "store_name": "Place D''Afrique HOCHELAGA", "location_code": "HOCHELAGA", "address_line_1": "3583 Rue Sainte-Catherine E", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "13838349"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Place Afrique'), (select id from locations where code='NDG_MAIN'), '13838349', '', 'PlaceAfrique(NOTRE-DAME-DE-GRÂCE)', '6280 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Place Afrique", "store_name": "PlaceAfrique(NOTRE-DAME-DE-GRÂCE)", "location_code": "NDG_MAIN", "address_line_1": "6280 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "13838349"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Mythos 2 Go'), (select id from locations where code='NDG_6284'), '13837955', '', 'Mythos 2 Go NDG', '6284 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Mythos 2 Go", "store_name": "Mythos 2 Go NDG", "location_code": "NDG_6284", "address_line_1": "6284 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "13837955"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Mythos 2 Go'), (select id from locations where code='HOCHELAGA'), '13837955', '', 'Mythos 2 Go HOCHELAGA', '3583 Rue Sainte-Catherine E', 'Montréal', 'QC', 'H1W 2E6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Mythos 2 Go", "store_name": "Mythos 2 Go HOCHELAGA", "location_code": "HOCHELAGA", "address_line_1": "3583 Rue Sainte-Catherine E", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "13837955"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Mythos 2 Go'), (select id from locations where code='NDG_MAIN'), '13837955', '', 'Mythos 2 Go(NOTRE-DAME-DE-GRÂCE)', '6280 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Mythos 2 Go", "store_name": "Mythos 2 Go(NOTRE-DAME-DE-GRÂCE)", "location_code": "NDG_MAIN", "address_line_1": "6280 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "13837955"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Cafe Bolon'), (select id from locations where code='NDG_6284'), '13080151', '', 'Cafe Bolon NDG', '6284 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Cafe Bolon", "store_name": "Cafe Bolon NDG", "location_code": "NDG_6284", "address_line_1": "6284 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "13080151"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Cafe Bolon'), (select id from locations where code='NDG_MAIN'), '13080151', '', 'Cafe Bolon(NOTRE-DAME-DE-GRÂCE)', '6280 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Cafe Bolon", "store_name": "Cafe Bolon(NOTRE-DAME-DE-GRÂCE)", "location_code": "NDG_MAIN", "address_line_1": "6280 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "13080151"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Cafe Bolon'), (select id from locations where code='HOCHELAGA'), '13080151', '', 'Cafe Bolon (HOCHELAGA)', '3583 Rue Sainte-Catherine E', 'Montréal', 'QC', 'H1W 2E6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Cafe Bolon", "store_name": "Cafe Bolon (HOCHELAGA)", "location_code": "HOCHELAGA", "address_line_1": "3583 Rue Sainte-Catherine E", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "13080151"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Taco Mexican'), (select id from locations where code='NDG_MAIN'), '13080099', '', 'Taco Mexican (NOTRE-DAME-DE-GRÂCE)', '6280 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Taco Mexican", "store_name": "Taco Mexican (NOTRE-DAME-DE-GRÂCE)", "location_code": "NDG_MAIN", "address_line_1": "6280 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "13080099"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Taco Mexican'), (select id from locations where code='HOCHELAGA'), '13080099', '', 'Taco Mexican HOCHELAGA', '3583 Rue Sainte-Catherine E', 'Montréal', 'QC', 'H1W 2E6', 'CA', 'active', 'closed', 'Z', false, '', '{"brand_name": "Taco Mexican", "store_name": "Taco Mexican HOCHELAGA", "location_code": "HOCHELAGA", "address_line_1": "3583 Rue Sainte-Catherine E", "activation_status": "active", "open_status": "closed", "status_symbol": "Z", "external_business_id": "13080099"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Taco Mexican'), (select id from locations where code='NDG_6284'), '13080099', '', 'Taco Mexican NDG', '6284 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'active', 'closed', 'Z', false, '', '{"brand_name": "Taco Mexican", "store_name": "Taco Mexican NDG", "location_code": "NDG_6284", "address_line_1": "6284 Av Somerled", "activation_status": "active", "open_status": "closed", "status_symbol": "Z", "external_business_id": "13080099"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Crèmerie Bin Molle Bin Dure'), (select id from locations where code='SAINT_LEONARD'), '14353843', '', 'Crèmerie Bin Molle Bin Dure ST LÉONARD', '5837 Rue Jean-Talon E', 'Saint-Léonard', 'QC', 'H1S 1M4', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Crèmerie Bin Molle Bin Dure", "store_name": "Crèmerie Bin Molle Bin Dure ST LÉONARD", "location_code": "SAINT_LEONARD", "address_line_1": "5837 Rue Jean-Talon E", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "14353843"}'::jsonb),
((select id from platforms where key='doordash'), (select id from brands where name='Crèmerie Bin Molle Bin Dure'), (select id from locations where code='NDG_MAIN'), '14353843', '', 'Crèmerie Bin Molle Bin Dure (NOTRE-DAME-DE-GRÂCE)', '6280 Av Somerled', 'Montréal', 'QC', 'H3X 2B6', 'CA', 'deactivated', 'unknown', 'grey_circle', false, '', '{"brand_name": "Crèmerie Bin Molle Bin Dure", "store_name": "Crèmerie Bin Molle Bin Dure (NOTRE-DAME-DE-GRÂCE)", "location_code": "NDG_MAIN", "address_line_1": "6280 Av Somerled", "activation_status": "deactivated", "open_status": "unknown", "status_symbol": "grey_circle", "external_business_id": "14353843"}'::jsonb)
on conflict (platform_id, brand_id, location_id, store_name) do nothing;


-- Connector config placeholders. Secrets are not stored here; secret_reference points to env/vault names only.
insert into platform_connector_configs (platform_id, mode, enabled, credential_status, secret_reference, notes)
select id,
  case key when 'clover' then 'oauth' when 'doordash' then 'api_key' when 'uber_eats' then 'oauth' when 'skip_the_dishes' then 'api_key' when 'too_good_to_go' then 'api_key' else 'disabled' end,
  false,
  'missing',
  upper(key) || '_SERVER_SECRET',
  'Live connector disabled until credentials, health check, and owner approval are complete.'
from platforms
on conflict (platform_id) do nothing;

-- Generate initial fix tasks for deactivated DoorDash stores.
insert into fix_tasks (source_type, source_id, priority, title, detail)
select 'platform_store', ps.id, 'high', 'Reactivate or verify deactivated DoorDash store', b.name || ' / ' || ps.store_name || ' / ' || l.code
from platform_stores ps
join brands b on b.id = ps.brand_id
join locations l on l.id = ps.location_id
join platforms p on p.id = ps.platform_id
where p.key='doordash' and ps.activation_status='deactivated'
  and not exists (select 1 from fix_tasks f where f.source_type = 'platform_store' and f.source_id = ps.id);

-- ============================================================
-- FILE: storage.sql
-- ============================================================
insert into storage.buckets (id, name, public) values
  ('receipts','receipts',false),
  ('supplier-invoices','supplier-invoices',false),
  ('stock-documents','stock-documents',false),
  ('platform-imports','platform-imports',false)
on conflict (id) do nothing;

-- ============================================================
-- FILE: rls.sql
-- ============================================================
alter table companies enable row level security;
alter table locations enable row level security;
alter table brands enable row level security;
alter table platforms enable row level security;
alter table platform_stores enable row level security;
alter table platform_connector_configs enable row level security;
alter table connector_runs enable row level security;
alter table ingest_events enable row level security;
alter table ai_supervision_findings enable row level security;
alter table fix_tasks enable row level security;
alter table verification_runs enable row level security;
alter table verification_findings enable row level security;
alter table ledger_accounts enable row level security;
alter table ledger_drafts enable row level security;
alter table ledger_draft_lines enable row level security;
alter table review_events enable row level security;
alter table receipts enable row level security;
alter table stock_documents enable row level security;
alter table audit_logs enable row level security;

-- MVP read policies. Production should replace with strict role/permission policies.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='companies' and policyname='authenticated read companies') then
    create policy "authenticated read companies" on companies for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='locations' and policyname='authenticated read locations') then
    create policy "authenticated read locations" on locations for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='brands' and policyname='authenticated read brands') then
    create policy "authenticated read brands" on brands for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platforms' and policyname='authenticated read platforms') then
    create policy "authenticated read platforms" on platforms for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_stores' and policyname='authenticated read platform stores') then
    create policy "authenticated read platform stores" on platform_stores for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='fix_tasks' and policyname='authenticated read fix tasks') then
    create policy "authenticated read fix tasks" on fix_tasks for select to authenticated using (true);
  end if;
end $$;

-- ============================================================
-- FILE: phase25_live_connectors.sql
-- ============================================================
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

-- ============================================================
-- FILE: final_operational_patch.sql
-- ============================================================
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
('clover','orders','manual',false,false),
('clover','inventory','manual',false,false),
('doordash','payouts','manual',false,false),
('uber_eats','payouts','manual',false,false),
('skip_the_dishes','payouts','manual',false,false),
('too_good_to_go','payouts','manual',false,false)
on conflict (platform_key, sync_type) do nothing;

-- ============================================================
-- FILE: rc4_security_patch.sql
-- ============================================================
-- RC4 security + metadata patch.
-- Run AFTER final_operational_patch.sql (file 7 of 7).

-- 1) SECURITY: enable Row-Level Security on every connector/ingestion table.
--    Without this, these tables are fully readable AND writable through the
--    public Supabase REST API using only the anon key. These tables hold
--    financial ingestion data, so they must be locked down.
--    No policies are created for them: the server uses the service-role key
--    (which bypasses RLS), and browser clients have no reason to touch these
--    tables directly. Add explicit policies later if authenticated dashboard
--    reads are wanted.
alter table if exists connector_secret_requirements enable row level security;
alter table if exists connector_feature_flags enable row level security;
alter table if exists connector_health_checks enable row level security;
alter table if exists connector_autodiscovery_runs enable row level security;
alter table if exists connector_sync_runs enable row level security;
alter table if exists ingested_platform_records enable row level security;
alter table if exists ai_ingestion_findings enable row level security;
alter table if exists connector_owner_approvals enable row level security;
alter table if exists connector_schedules enable row level security;
alter table if exists connector_webhook_events enable row level security;
alter table if exists platform_entities enable row level security;
alter table if exists sync_orchestration_runs enable row level security;
alter table if exists ai_post_sync_reviews enable row level security;

-- 2) METADATA FIX: align connector_secret_requirements with what the code
--    actually requires (lib/backend/connectors/*.ts requiredEnv), so the
--    credential setup UI does not mislead the owner.
insert into connector_secret_requirements (platform_key, secret_key, label, required, storage_mode, description) values
('clover','CLOVER_BASE_URL','Clover Base URL',true,'server_env','https://api.clover.com (or sandbox URL).'),
('clover','CLOVER_ACCESS_TOKEN','Clover Access Token',true,'server_env','Merchant API token used for REST calls.'),
('uber_eats','UBER_BASE_URL','Uber Base URL',true,'server_env','https://api.uber.com'),
('uber_eats','UBER_ACCESS_TOKEN','Uber Access Token',false,'server_env','Optional if Client ID + Secret are set; a token is then fetched automatically.'),
('skip_the_dishes','SKIP_BASE_URL','Skip Base URL',true,'server_env','Partner API base URL when access is granted.'),
('too_good_to_go','TGTG_BASE_URL','TGTG Base URL',true,'server_env','Partner/report base URL when access is granted.')
on conflict (platform_key, secret_key) do nothing;

update connector_secret_requirements set required = false, description = 'OAuth app client ID. Used with the secret to auto-fetch access tokens.' where platform_key='clover' and secret_key='CLOVER_CLIENT_ID';
update connector_secret_requirements set required = false, description = 'OAuth app secret. Used with the client ID to auto-fetch access tokens.' where platform_key='clover' and secret_key='CLOVER_CLIENT_SECRET';
update connector_secret_requirements set required = false, description = 'Uber OAuth client id. With the secret, an access token is fetched automatically.' where platform_key='uber_eats' and secret_key='UBER_CLIENT_ID';
update connector_secret_requirements set required = false, description = 'Uber OAuth secret. With the client id, an access token is fetched automatically.' where platform_key='uber_eats' and secret_key='UBER_CLIENT_SECRET';

-- ============================================================
-- FILE: foodhub.sql
-- ============================================================
-- TAKATAK Food Hub — operations tables (orders, stores, menus, jobs).
-- Run AFTER rc4_security_patch.sql (file 8 of 8). Also included in INSTALL_ALL.sql.

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

-- ============================================================
-- FILE: release_1_4_0_patch.sql
-- ============================================================
-- Release 1.4.0 patch.
-- Run AFTER foodhub.sql (file 9 of 9). Safe to re-run: every statement is idempotent.

-- 1) Sync-now dedupe. Manual syncs overlap (Clover defaults to the last 7 days), so the same
--    order was inserted again on every click, each time with a fresh AI finding. One row per
--    (platform, record type, external id) from now on; the server upserts with "ignore duplicates".
--    Existing duplicates are removed first (keeping the earliest copy; their AI findings cascade)
--    so the unique index can be created on installs that already have data.
delete from ingested_platform_records r
using ingested_platform_records older
where r.external_id is not null
  and older.platform_key = r.platform_key
  and older.record_type = r.record_type
  and older.external_id = r.external_id
  and (older.created_at < r.created_at or (older.created_at = r.created_at and older.id < r.id));

create unique index if not exists ingested_platform_records_platform_type_external_uidx
  on ingested_platform_records (platform_key, record_type, external_id);

-- 2) UrbanPiper is no longer used (LOCKED_DECISIONS): remove its table and seed rows from
--    installs made with an earlier installer. The platform row is only removed when no
--    platform_stores row still points at it.
drop table if exists urbanpiper_locations;
delete from connector_secret_requirements where platform_key = 'urbanpiper';
delete from connector_feature_flags where platform_key = 'urbanpiper';
delete from connector_schedules where platform_key = 'urbanpiper';
delete from platform_connector_configs where platform_id in (select id from platforms where key = 'urbanpiper');
delete from platforms p where p.key = 'urbanpiper' and not exists (select 1 from platform_stores s where s.platform_id = p.id);

-- 3) Secret requirements now name the variables the setup wizard actually writes.
delete from connector_secret_requirements where (platform_key, secret_key) in (('skip_the_dishes','SKIP_API_KEY'), ('too_good_to_go','TGTG_API_KEY'));
insert into connector_secret_requirements (platform_key, secret_key, label, required, storage_mode, description) values
('skip_the_dishes','SKIP_JET_API_KEY','SkipTheDishes JET Connect API key',true,'server_env','JET Connect (Flyt) API key used for menus, item 86 and order confirmation.'),
('too_good_to_go','TGTG_WEBHOOK_SECRET','Too Good To Go webhook secret',true,'server_env','Webhook-only integration: there is no public merchant API to call.')
on conflict (platform_key, secret_key) do nothing;

