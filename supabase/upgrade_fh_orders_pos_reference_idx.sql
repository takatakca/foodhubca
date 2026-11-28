-- TAKATAK Food Hub — add the order reference index to an existing database before deploying PR #195.
-- Run as the database owner with a direct or session-mode connection.
-- Use psql -X -v ON_ERROR_STOP=1 -f supabase/upgrade_fh_orders_pos_reference_idx.sql
-- Run in autocommit mode, with no enclosing transaction and without psql --single-transaction.
-- If a build was interrupted, inspect and remove only the failed invalid index before retrying.
-- The index is non-unique because different merchants can share a POS reference.

create index concurrently if not exists fh_orders_channel_pos_store_idx
  on public.fh_orders (channel, pos_order_id, channel_store_id);

-- IF NOT EXISTS can skip an invalid or differently defined index with the same name.
do $verify$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index as i
    join pg_catalog.pg_class as idx on idx.oid = i.indexrelid
    join pg_catalog.pg_am as am on am.oid = idx.relam
    where i.indexrelid = pg_catalog.to_regclass('public.fh_orders_channel_pos_store_idx')
      and i.indrelid = 'public.fh_orders'::regclass
      and i.indisvalid and i.indisready and i.indislive
      and not i.indisunique and am.amname = 'btree'
      and i.indnkeyatts = 3 and i.indnatts = 3 and i.indpred is null and i.indexprs is null
      and pg_catalog.pg_get_indexdef(i.indexrelid, 1, false) = 'channel'
      and pg_catalog.pg_get_indexdef(i.indexrelid, 2, false) = 'pos_order_id'
      and pg_catalog.pg_get_indexdef(i.indexrelid, 3, false) = 'channel_store_id'
  ) then
    raise exception 'Missing, invalid or unexpected fh_orders_channel_pos_store_idx. Inspect the index before continuing.';
  end if;
end
$verify$;
