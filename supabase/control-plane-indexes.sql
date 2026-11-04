-- Optional additive indexes for the background control-plane observer and outbox.
-- Run after foodhub.sql on the normal release path. No new authority, tables or billing data.
create index if not exists fh_orders_changed_cursor_idx on fh_orders (updated_at, id);
create index if not exists fh_docs_pending_at_idx on fh_docs (collection, key, at desc);
