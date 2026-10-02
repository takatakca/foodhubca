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
