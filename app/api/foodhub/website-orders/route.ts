import { scopeFilter, withPerm } from '@/lib/foodhub/auth';
import { ok } from '@/lib/foodhub/http';
import { listOpenWebsiteOrders } from '@/lib/foodhub/pos/clover-website-orders';

export const dynamic = 'force-dynamic';

// Kitchen screen: website orders that Clover Online Ordering took and printed (Clover is the source of truth; Food Hub
// only shows them). ?locations=A,B narrows it; people limited to some locations only ever see theirs.
// Not behind the "own delivery" switch: these orders are Clover's, not ours to deliver.
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const wanted = (new URL(req.url).searchParams.get('locations') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const orders = await listOpenWebsiteOrders({ locationCodes: scopeFilter(actor, wanted) });
  return ok({ orders });
});
