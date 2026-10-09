import { scopeFilter, withPerm } from '@/lib/foodhub/auth';
import { listKitchenOwnOrders } from '@/lib/foodhub/delivery/kitchen';
import { ok } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

// Kitchen screen: our own orders to cook (AI phone, phone, website, typed in). ?locations=A,B narrows it; people
// limited to some locations only ever see theirs. Actions go through POST /api/foodhub/delivery/{id}
// (seen, ready, picked_up). Not behind a feature switch: an order that exists must reach the kitchen.
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const wanted = (new URL(req.url).searchParams.get('locations') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const orders = await listKitchenOwnOrders({ locationCodes: scopeFilter(actor, wanted) });
  return ok({ orders });
});
