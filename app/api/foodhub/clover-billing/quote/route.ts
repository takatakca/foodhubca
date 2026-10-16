import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { quoteExtraBrand, quoteExtraStores, type QuoteStore } from '@/lib/foodhub/pos/clover-extra-brands';

export const dynamic = 'force-dynamic';

const MAX_STORES = 50;

// Price shown before connecting a store of an extra brand (?brand=&channel=&merchant=&store=) or adding a brand
// (?brand= [&merchant=]). Read-only: nothing is billed here; Clover bills from the monthly report.
export const GET = withPerm('view', async (req) => {
  const p = new URL(req.url).searchParams;
  const brand = String(p.get('brand') || '').trim();
  if (!brand) return fail('brand is required.');
  return ok({ quote: await quoteExtraBrand({ brandName: brand, channel: p.get('channel'), merchantId: p.get('merchant'), storeId: p.get('store') }) });
});

// Several stores connected together (Uber activation): { stores: [{ brandName, channel, merchantId?, storeId? }] }.
// All are added to the mappings at once, so the total is right (read-only, like GET).
export const POST = withPerm('view', async (req) => {
  const b = await readJson(req);
  const raw: unknown[] = Array.isArray(b.stores) ? b.stores : [];
  const stores: QuoteStore[] = raw.slice(0, MAX_STORES).flatMap((s) => {
    if (!s || typeof s !== 'object') return [];
    const o = s as Record<string, unknown>;
    const brandName = String(o.brandName ?? '').trim().slice(0, 120);
    if (!brandName) return [];
    const opt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
    return [{ brandName, channel: opt(o.channel), merchantId: opt(o.merchantId), storeId: opt(o.storeId) }];
  });
  if (!stores.length) return fail('stores is required.');
  return ok({ quote: await quoteExtraStores(stores) });
});
