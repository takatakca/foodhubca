import { inScope, scopeFilter, withPerm } from '@/lib/foodhub/auth';
import { listDirectOrders } from '@/lib/foodhub/delivery/store';
import { boardDeliveries } from '@/lib/foodhub/delivery/board';
import { featureOn } from '@/lib/foodhub/expansion/features';
import { ok } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

// The kitchen strip: own delivery orders still in the kitchen or on the road, with their courier.
export const GET = withPerm('view', async (req, _ctx, actor) => {
  if (!(await featureOn('delivery'))) return ok({ on: false, items: [] });
  const loc = new URL(req.url).searchParams.get('location');
  const locationCodes = scopeFilter(actor, loc ? [loc] : undefined);
  const orders = (await listDirectOrders({ since: new Date(Date.now() - 86400_000).toISOString(), limit: 500, locationCodes }))
    .filter((o) => o.fulfillment === 'delivery' && ['new', 'in_kitchen', 'ready', 'out_for_delivery'].includes(o.status) && inScope(actor, o.locationCode) && (!loc || o.locationCode === loc));
  const deliveries = await boardDeliveries(orders);
  const items = orders.map((o) => ({
    id: o.id, number: o.number, brandName: o.brandName, locationCode: o.locationCode, status: o.status, readyAt: o.readyAt ?? null, attention: o.attention ?? null, containsAlcohol: o.containsAlcohol,
    delivery: deliveries.get(o.id) ?? null,
  }));
  return ok({ on: true, items });
});
