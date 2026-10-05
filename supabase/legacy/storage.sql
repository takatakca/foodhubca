insert into storage.buckets (id, name, public) values
  ('receipts','receipts',false),
  ('supplier-invoices','supplier-invoices',false),
  ('stock-documents','stock-documents',false),
  ('platform-imports','platform-imports',false)
on conflict (id) do nothing;
