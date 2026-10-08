import { approvalGate, inScope, withPerm } from '@/lib/foodhub/auth';
import { normalizePostal } from '@/lib/foodhub/delivery/address';
import { activeDelivery, cancelCourier, dispatchOrder, dispatchProblems, refreshDelivery } from '@/lib/foodhub/delivery/dispatch';
import { runDirectAction, updateDirectOrder, type DirectAction } from '@/lib/foodhub/delivery/orders';
import { deliveriesForOrder, getDirectOrder } from '@/lib/foodhub/delivery/store';
import type { FleetKey } from '@/lib/foodhub/delivery/types';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { normalizePhone } from '@/lib/foodhub/notify';
import { cloverOnlineBlockedReason } from '@/lib/foodhub/pos/clover-website-orders';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

async function detail(id: string) {
  const order = await getDirectOrder(id);
  if (!order) return null;
  const deliveries = (await deliveriesForOrder(id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const delivery = order.fulfillment === 'delivery';
  return {
    order, deliveries, running: await activeDelivery(order),
    problems: delivery ? await dispatchProblems(order) : [], problemsFr: delivery ? await dispatchProblems(order, undefined, undefined, 'fr') : [],
  };
}

export const GET = withPerm<Ctx>('view', async (_req, ctx, actor) => {
  const d = await detail((await ctx.params).id);
  if (!d || !inScope(actor, d.order.locationCode)) return fail('Order not found.', 404);
  return ok(d);
});

const DIRECT: DirectAction[] = ['ready', 'picked_up', 'complete', 'cancel', 'mark_paid', 'retry_clover', 'clear_attention'];

export const POST = withPerm<Ctx>('orders:act', async (req, ctx, actor) => {
  const id = (await ctx.params).id;
  const order = await getDirectOrder(id);
  if (!order || !inScope(actor, order.locationCode)) return fail('Order not found.', 404);
  const b = await readJson(req);
  const action = String(b.action ?? '');
  // A website order Clover Online Ordering took: Clover is the source of truth (refunds, cancels… are done in Clover).
  const blocked = cloverOnlineBlockedReason(order, action);
  if (blocked) return fail(blocked, 409);
  let message = 'Done.';
  if (action === 'dispatch') {
    const gate = await approvalGate(req, actor, 'delivery.dispatch', order.locationCode, `courier for ${order.number}`);
    if (gate) return gate;
    const fleet = b.fleet === 'uber_direct' || b.fleet === 'doordash_drive' ? (b.fleet as FleetKey) : undefined;
    const r = await dispatchOrder(id, actor, { fleet });
    if (!r.ok) return fail(r.message, 409, { problems: r.problems ?? [], problemsFr: r.problems ? await dispatchProblems(r.order, undefined, undefined, 'fr') : [], quotes: r.quotes ?? [] });
    message = r.message;
  } else if (action === 'cancel_courier') {
    const gate = await approvalGate(req, actor, 'delivery.cancel', order.locationCode, `courier of ${order.number}`);
    if (gate) return gate;
    const r = await cancelCourier(id, actor, String(b.reason ?? '').slice(0, 200));
    if (!r.ok) return fail(r.message, 409);
    message = r.message;
  } else if (action === 'refresh') {
    if (order.deliveryId) await refreshDelivery(order.deliveryId);
  } else if (action === 'update') {
    const a = b.dropoff;
    await updateDirectOrder(id, {
      ...(a ? { dropoff: { street: String(a.street ?? '').trim(), unit: a.unit ? String(a.unit).trim() : undefined, city: String(a.city ?? '').trim(), province: 'QC', postalCode: normalizePostal(a.postalCode) ?? String(a.postalCode ?? ''), country: 'CA', instructions: a.instructions ? String(a.instructions).slice(0, 200) : undefined } } : {}),
      ...(b.customer ? { customer: { name: b.customer.name ? String(b.customer.name).slice(0, 80) : undefined, phone: normalizePhone(b.customer.phone) ?? undefined } } : {}),
    }, actor);
  } else if (DIRECT.includes(action as DirectAction)) {
    if (action === 'cancel') {
      const gate = await approvalGate(req, actor, 'order.cancel', order.locationCode, `own order ${order.number}`);
      if (gate) return gate;
      // A booked courier is cancelled first: never leave a courier driving to a cancelled order.
      if (await activeDelivery(order)) {
        const r = await cancelCourier(id, actor, `Order cancelled${b.reason ? ` — ${b.reason}` : ''}`);
        if (!r.ok) return fail(`The courier could not be cancelled (${r.message}) — the order stays open.`, 409);
      }
    }
    await runDirectAction(id, action as DirectAction, actor, { reason: b.reason ? String(b.reason).slice(0, 200) : undefined });
  } else return fail('Unknown action.');
  return ok({ ...(await detail(id)), message });
});
