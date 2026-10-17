import { inScope, withPerm } from '@/lib/foodhub/auth';
import { getHours } from '@/lib/foodhub/hours';
import { fail, ok } from '@/lib/foodhub/http';
import { getBrandMenu } from '@/lib/foodhub/menu/shared';
import { closesAtMs, resolveLineRefs } from '@/lib/foodhub/order-tools/line-refs';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/foodhub/order-tools/<orderId>/line-refs — the menu item / option refs behind each line of a platform order,
// so the kitchen can 86 them from the order ("Rupture"), plus when this brand closes here (closesAt, ISO — the drawer can
// stay open for hours, so the screen counts the minutes at send time; closesInMin is kept for older screens). Read-only:
// the 86 itself goes through the existing POST /api/foodhub/availability (manager PIN when the rule asks for it).
export const GET = withPerm<Ctx>('view', async (_req, context, actor) => {
  const { id } = await context.params;
  const order = await getRepo().getOrder(id);
  // Same answer for an unknown order and an order of another kitchen: ids of other kitchens cannot be probed.
  if (!order || !inScope(actor, order.locationCode)) return fail('Order not found', 404);
  // The whole shared menu: an order line is matched whatever dishes the brand shows today.
  const menu = order.brandName ? await getBrandMenu(order.brandName, undefined, { allDishes: true }) : null;
  const now = Date.now();
  const closeMs = order.brandName && order.locationCode ? closesAtMs(await getHours(), order.brandName, order.locationCode, now) : null;
  return ok({
    brand: order.brandName ?? null, locationCode: order.locationCode ?? null, hasMenu: Boolean(menu),
    closesAt: closeMs === null ? null : new Date(closeMs).toISOString(),
    closesInMin: closeMs === null ? null : Math.max(1, Math.ceil((closeMs - now) / 60_000)),
    lines: resolveLineRefs(order, menu),
  });
});
