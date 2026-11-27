import { logActivity } from '../activity';
import { parseSkipCancelNotice, parseSkipFailedOrder } from '../adapters/skip';
import { settleTerminalSkipOrder } from '../pipeline';
import { getRepo } from '../repo';

export async function handleSkipCancelWebhook(body: unknown) {
  const notice = parseSkipCancelNotice(body);
  if (!notice) throw new Error('Skip cancellation has no order id.');
  const result = await getRepo().applySkipLifecycle({ kind: 'cancel', ...notice });
  if (result.outcome === 'cancelled' && result.order) {
    const order = result.order;
    if (result.transitioned) {
      const reason = order.timeline?.cancelReason;
      await logActivity({ actor: 'SkipTheDishes', source: 'platform', kind: 'order', action: 'platform_cancel', status: 'info', channel: 'skip', brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
        summary: `Skip cancelled #${order.displayId || order.externalOrderId.slice(0, 8)}${reason ? ` — ${reason}` : ''}` });
    }
    await settleTerminalSkipOrder(order);
    return { result: 'Skip cancellation recorded.', orderId: order.id };
  }
  return { result: result.outcome === 'parked' ? 'Skip cancellation kept for the matching order.' : 'Skip order left unchanged.', orderId: result.order?.id };
}

export async function handleSkipBackupWebhook(body: unknown) {
  const parsed = parseSkipFailedOrder(body);
  if (!parsed) throw new Error('Skip backup notice has no readable order.');
  const { failure, ...order } = parsed;
  const repo = getRepo();
  const store = order.channelStoreId ? await repo.findStore('skip', order.channelStoreId) : null;
  const message = `Skip sent this order to the tablet: ${failure}. Make it from the Skip tablet${failure.includes('unknown item') ? ' and fix the item id in Menu Manager' : ''}.`;
  const raw = body as Record<string, unknown>;
  const applied = await repo.applySkipLifecycle({
    kind: 'backup', order: { ...order, brandName: store?.brandName, locationCode: store?.locationCode }, mappedStore: Boolean(store), message,
    detail: { validationError: raw.validationError, unknownReference: raw.unknownReference, menuId: raw.menuId },
  });
  if (applied.outcome === 'conflicting_store') throw new Error('Skip backup notice does not match the stored order’s store.');
  if (applied.outcome === 'cancelled' && applied.order && !applied.isNew) await settleTerminalSkipOrder(applied.order);
  if (applied.outcome !== 'backed_up' || !applied.order) return { result: 'Skip backup notice kept without changing kitchen instructions.', orderId: applied.order?.id };

  await settleTerminalSkipOrder(applied.order);
  if (applied.isNew) {
    await logActivity({ actor: 'SkipTheDishes', source: 'platform', kind: 'order', action: 'skip_backup_flow', status: 'failed', channel: 'skip', brandName: applied.order.brandName, locationCode: applied.order.locationCode, orderId: applied.order.id,
      summary: `Skip #${order.displayId || order.externalOrderId.slice(0, 8)} failed validation and went to the Skip tablet — ${failure}` });
  }
  return { result: 'Skip tablet backup recorded.', orderId: applied.order.id };
}
