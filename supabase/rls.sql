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
