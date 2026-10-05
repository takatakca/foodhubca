import { approvalGate, inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { allowedActions, ORDER_ACTIONS, runOrderAction, type OrderAction } from '@/lib/foodhub/pipeline';
import type { PolicyAction } from '@/lib/foodhub/policy';
import { getRepo } from '@/lib/foodhub/repo';
import { CANCEL_REASON_LABELS, type CancelReason } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Actions that move money or lose a sale need a manager PIN for staff (Settings → Security). */
const GATED: Partial<Record<OrderAction, PolicyAction>> = { deny: 'order.reject', cancel: 'order.cancel', report_missing: 'order.adjust', delay: 'order.delay', print: 'order.reprint' };

export const GET = withPerm<Ctx>('view', async (_req, context, actor) => {
  const { id } = await context.params;
  const repo = getRepo();
  const order = await repo.getOrder(id);
  if (!order || !inScope(actor, order.locationCode)) return fail('Order not found', 404);
  return ok({ order, events: await repo.listEvents(id), actions: allowedActions(order), reasons: CANCEL_REASON_LABELS });
});

// { action, reasonCode?, reason?, missing?, prepMinutes?, delayMinutes? } (+ header x-approval-pin when asked)
export const POST = withPerm<Ctx>('orders:act', async (req, context, actor) => {
  const { id } = await context.params;
  const body = await readJson(req);
  const action = String(body.action || '') as OrderAction;
  if (!ORDER_ACTIONS.includes(action)) return fail(`action must be one of: ${ORDER_ACTIONS.join(', ')}`);
  const existing = await getRepo().getOrder(id);
  if (!existing || !inScope(actor, existing.locationCode)) return fail('Order not found', 404);
  const policy = GATED[action];
  if (policy && (allowedActions(existing).includes(action) || action === 'delay')) {
    const gate = await approvalGate(req, actor, policy, existing.locationCode, `#${existing.displayId || existing.externalOrderId.slice(0, 8)}`);
    if (gate) return gate;
  }
  const reasonCode = body.reasonCode && body.reasonCode in CANCEL_REASON_LABELS ? (body.reasonCode as CancelReason) : undefined;
  const missing = Array.isArray(body.missing) ? body.missing.map((m: any) => ({ line: Number(m.line), quantity: Number(m.quantity) })).filter((m: any) => Number.isInteger(m.line) && m.quantity > 0) : undefined;
  const { order, result } = await runOrderAction(id, action, {
    reason: body.reason ? String(body.reason) : undefined, reasonCode, actor, missing, approvedBy: actor.approvedBy,
    prepMinutes: body.prepMinutes !== undefined ? Number(body.prepMinutes) : undefined, delayMinutes: body.delayMinutes !== undefined ? Number(body.delayMinutes) : undefined,
  });
  if (!order) return fail(result.message, 404);
  return ok({ order, result, actions: allowedActions(order) });
});
