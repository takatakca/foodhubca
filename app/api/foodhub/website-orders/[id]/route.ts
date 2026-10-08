import { inScope, withPerm } from '@/lib/foodhub/auth';
import { getDirectOrder } from '@/lib/foodhub/delivery/store';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { DO_IT_IN_CLOVER, runWebsiteOrderAction, type WebsiteOrderAction } from '@/lib/foodhub/pos/clover-website-orders';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const LOCAL: WebsiteOrderAction[] = ['ack', 'ready', 'complete'];

export const GET = withPerm<Ctx>('view', async (_req, ctx, actor) => {
  const order = await getDirectOrder((await ctx.params).id);
  if (!order || order.source !== 'clover_online' || !inScope(actor, order.locationCode)) return fail('Order not found.', 404);
  return ok({ order, actions: order.status === 'completed' || order.status === 'cancelled' ? [] : order.status === 'ready' ? ['complete'] : ['ready', 'complete'] });
});

// { action: "ack" | "ready" | "complete" } — the kitchen screen's own steps (nothing is sent to Clover).
// Anything that changes the order or the money (cancel, refund, reject, reprint, send to Clover…) is refused with
// "do it in Clover": Clover took the payment, printed the ticket and keeps the order.
export const POST = withPerm<Ctx>('orders:act', async (req, ctx, actor) => {
  const id = (await ctx.params).id;
  const order = await getDirectOrder(id);
  if (!order || order.source !== 'clover_online' || !inScope(actor, order.locationCode)) return fail('Order not found.', 404);
  const action = String((await readJson(req)).action ?? '');
  if (!LOCAL.includes(action as WebsiteOrderAction)) return fail(DO_IT_IN_CLOVER, 409);
  return ok({ order: await runWebsiteOrderAction(id, action as WebsiteOrderAction, actor) });
});
