import { getSkipModificationState, modifySkipOrder, validateSkipModification, type SkipModification } from '@/lib/foodhub/adapters/skip-api';
import { logActivity } from '@/lib/foodhub/activity';
import { approvalGate, inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Out of stock, substitutions and weighed items on a Skip order (JET Connect "modification"):
//   { orderId, mode: "validate", modifications }   JET checks its rules first, nothing changes
//   { orderId, mode: "send",     modifications }   the change (an order can be modified once; needs the manager PIN)
//   { orderId, mode: "status" }                    where the change stands at Skip
// modifications = [{ removedItems: [{ plu, missingQuantity }], addedItems?: [{ plu, quantity }], adjustedItems?: [{ plu, netQuantity }] }]
export const POST = withPerm('orders:act', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const repo = getRepo();
  const order = b.orderId ? await repo.getOrder(String(b.orderId)) : null;
  if (!order || order.channel !== 'skip' || !inScope(actor, order.locationCode)) return fail('Skip order not found', 404);
  if (order.viaHub) return fail('This order did not come from the Skip API: change it on the Skip tablet.', 409);
  const mode = String(b.mode ?? 'validate');
  const mods = (Array.isArray(b.modifications) ? b.modifications : []) as SkipModification[];
  const tag = `#${order.displayId || order.externalOrderId.slice(0, 8)}`;

  if (mode === 'status') {
    const res = await getSkipModificationState(order);
    return res.ok ? ok({ result: res, state: res.state ?? null }) : fail(res.message, res.status === 'blocked' ? 409 : 400, { result: res });
  }
  if (mode === 'validate') {
    const res = await validateSkipModification(order, mods);
    return res.ok ? ok({ result: res }) : fail(res.message, res.status === 'blocked' ? 409 : 400, { result: res });
  }
  if (mode !== 'send') return fail('mode must be validate, send or status');
  const gate = await approvalGate(req, actor, 'order.adjust', order.locationCode, tag);
  if (gate) return gate;
  const res = await modifySkipOrder(order, mods);
  await repo.addEvent(order.id, res.ok ? 'skip_modification_sent' : 'skip_modification_failed', { message: res.message, by: actor.name, modifications: mods });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'skip_modification', status: res.ok ? 'queued' : 'failed', channel: 'skip', brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
    summary: `Change sent to SkipTheDishes for ${tag}: ${res.message}` });
  return res.ok ? ok({ result: res }) : fail(res.message, res.status === 'blocked' ? 409 : 400, { result: res });
});
