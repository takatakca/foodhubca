import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { quoteExtraBrand } from '@/lib/foodhub/pos/clover-extra-brands';

export const dynamic = 'force-dynamic';

// Price shown before connecting a store of an extra brand (?brand=&channel=&merchant=&store=) or adding a brand
// (?brand= only). Read-only: nothing is billed here; Clover bills from the monthly report.
export const GET = withPerm('view', async (req) => {
  const p = new URL(req.url).searchParams;
  const brand = String(p.get('brand') || '').trim();
  if (!brand) return fail('brand is required.');
  return ok({ quote: await quoteExtraBrand({ brandName: brand, channel: p.get('channel'), merchantId: p.get('merchant'), storeId: p.get('store') }) });
});
