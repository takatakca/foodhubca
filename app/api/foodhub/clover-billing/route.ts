import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { billingLog, previewExtraBrandBilling, runExtraBrandBilling, setPrimaryBrand } from '@/lib/foodhub/pos/clover-extra-brands';
import { PRICING_STATEMENT } from '@/lib/foodhub/pos/clover-pricing';

export const dynamic = 'force-dynamic';

// Settings → Clover app → Billing: each merchant's Food Hub subscription, its extra brands, exactly what would be
// billed (dry run: nothing is written or sent by a GET) and the billing log. ?refresh=1 asks Clover now.
export const GET = withPerm('admin', async (req) => {
  const refresh = new URL(req.url).searchParams.get('refresh') === '1';
  const [preview, log] = await Promise.all([previewExtraBrandBilling({ refresh }), billingLog(50)]);
  return ok({ pricing: PRICING_STATEMENT, preview, log });
});

// { action: 'primary', merchantId, brandName | null } — the brand included in the subscription for that merchant.
// { action: 'run' } — record this month's count and send last month's now (only when metered billing is on).
export const POST = withPerm('admin', async (req, _ctx, actor) => {
  const b = await readJson(req);
  if (b.action === 'primary') {
    const mid = String(b.merchantId || '').trim();
    if (!mid) return fail('merchantId is required.');
    const brand = b.brandName ? String(b.brandName) : null;
    return ok({ primary: await setPrimaryBrand(mid, brand, actor.name || actor.username) });
  }
  if (b.action === 'run') return ok({ result: await runExtraBrandBilling() });
  return fail('Unknown action.');
});
