import { NextResponse, type NextRequest } from 'next/server';
import { logActivity } from '@/lib/foodhub/activity';
import { parseSkipFailedOrder, skipAdapter } from '@/lib/foodhub/adapters/skip';
import { nowIso } from '@/lib/foodhub/config';
import { pendingKey, type PendingPlatformEvents } from '@/lib/foodhub/courier';
import { mevOnOrderChange } from '@/lib/foodhub/mev/hooks';
import { getRepo } from '@/lib/foodhub/repo';
import type { StoredOrder } from '@/lib/foodhub/types';
import { background, keepUnparsed, parseJson, unauthorized } from '@/lib/foodhub/webhook-utils';
import { readTextOr413 } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function canRecordBackup(order: StoredOrder): boolean {
  return !order.viaHub && !order.viaPos && ['new', 'accepted', 'ready'].includes(order.status);
}

function canApplyPendingCancellation(order: StoredOrder): boolean {
  return canRecordBackup(order) || (!order.viaHub && !order.viaPos && order.status === 'failed');
}

function hasPendingCancellation(pending: PendingPlatformEvents | null): pending is PendingPlatformEvents & { status: NonNullable<PendingPlatformEvents['status']> } {
  return Boolean(pending && !pending.consumedAt && pending.status && /cancel|fail/i.test(pending.status.platformState));
}

// JET Connect "Failed Order For Backup Flow": the order failed JET's validation (e.g. an unknown item
// reference) and went straight to the Skip tablet. Food Hub records it so it is never invisible:
// it shows on the Command Center as "on the Skip tablet" and counts in sales and reconciliation.
export async function POST(req: NextRequest) {
  const read = await readTextOr413(req);
  if ('response' in read) return read.response;
  const raw = read.text;
  if (!skipAdapter.verifyWebhook(req.headers, raw)) return unauthorized('skip');
  const body = parseJson(raw);
  const parsed = parseSkipFailedOrder(body);
  if (!parsed) {
    background('keep unparsed skip failed order', () => keepUnparsed('skip', body, 'Skip failed-order notice without order details'));
    return NextResponse.json({ ok: false, error: 'order.orderId missing' }, { status: 400 });
  }
  background(`skip failed order ${parsed.externalOrderId}`, async () => {
    const repo = getRepo();
    const { failure, ...n } = parsed;
    const key = pendingKey('skip', n.externalOrderId);
    // If the cancellation ledger is unavailable, keep the notice without opening a new kitchen order.
    const beforeInsert = await repo.getKv<PendingPlatformEvents>(key);
    const store = n.channelStoreId ? await repo.findStore('skip', n.channelStoreId) : null;
    const { order, isNew } = await repo.insertOrderIfNew({ ...n, brandName: store?.brandName, locationCode: store?.locationCode });
    if (store && order.channelStoreId && store.channelStoreId !== order.channelStoreId) {
      await keepUnparsed('skip', body, 'Skip backup notice names a different mapped store than the stored order.', n.externalOrderId);
      return;
    }
    // A cancellation can be parked between the first read and the insert.
    const pending = hasPendingCancellation(beforeInsert) ? beforeInsert : await repo.getKv<PendingPlatformEvents>(key);
    const backupEvidence = { validationError: body.validationError, unknownReference: body.unknownReference, menuId: body.menuId };
    if (hasPendingCancellation(pending)) {
      const { platformState, detail, at } = pending.status;
      const now = nowIso();
      const reason = String(detail.reason ?? detail.event ?? 'Cancelled on the platform');
      const cancelled = await repo.patchOrder(order.id, {
        cancelledAt: now, cancelledBy: /customer|eater/i.test(reason) ? 'customer' : 'platform',
        cancelStage: order.timeline?.acceptedAt ? 'after_accept' : 'before_accept', cancelReason: reason,
      }, { status: 'cancelled', channelError: undefined }, canApplyPendingCancellation);
      const current = cancelled ?? await repo.getOrder(order.id);
      if (!current || (!cancelled && canApplyPendingCancellation(current))) throw new Error('The order changed while applying the earlier Skip cancellation.');
      if (cancelled) await repo.addEvent(order.id, 'platform_status', { state: platformState, ...detail, at });
      await repo.setKv(key, { ...pending, consumedAt: now });
      await repo.addEvent(order.id, 'skip_backup_ignored', { ...backupEvidence, status: current.status });
      return;
    }
    const message = `Skip sent this order to the tablet: ${failure}. Make it from the Skip tablet${failure.includes('unknown item') ? ' and fix the item id in Menu Manager' : ''}.`;
    const backupOrder = await repo.patchOrder(order.id, {}, { status: 'failed', channelError: message }, canRecordBackup);
    if (!backupOrder) {
      const current = await repo.getOrder(order.id);
      if (!current || canRecordBackup(current)) throw new Error('The order changed while applying the Skip backup notice.');
      await repo.addEvent(order.id, 'skip_backup_ignored', { ...backupEvidence, status: current.status });
      return;
    }
    await repo.addEvent(order.id, 'routed_to_skip_tablet', { message, ...backupEvidence });
    // Made and sold from the Skip tablet: still a sale for the invoice (Takatak MEV; nothing when MEV is off).
    await mevOnOrderChange(backupOrder);
    if (isNew) {
      await logActivity({ actor: 'SkipTheDishes', source: 'platform', kind: 'order', action: 'skip_backup_flow', status: 'failed', channel: 'skip', brandName: store?.brandName, locationCode: store?.locationCode, orderId: order.id,
        summary: `Skip #${n.displayId || n.externalOrderId.slice(0, 8)} failed validation and went to the Skip tablet — ${failure}` });
    }
  }, { channel: 'skip', body, reference: parsed.externalOrderId, kind: 'order' });
  // JET expects 200 and the same payload back as the acknowledgement.
  return NextResponse.json(body, { status: 200 });
}
