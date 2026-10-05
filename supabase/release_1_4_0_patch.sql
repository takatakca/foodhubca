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
