import { inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { orderMoney } from '@/lib/foodhub/order-tools/order-money';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/foodhub/order-tools/<orderId>/money — expected vs paid for ONE order, from the reconciliation engine
// (cached 60 s). Read-only: nothing is submitted or approved here; disputes are filed by the owner in the portals.
export const GET = withPerm<Ctx>('analytics:view', async (_req, context, actor) => {
  const { id } = await context.params;
  const order = await getRepo().getOrder(id);
  if (!order) return fail('Order not found', 404);
  if (!inScope(actor, order.locationCode)) return fail('Not one of your locations.', 403);
  return ok({ money: await orderMoney(order) });
});
