// Clover follows each delivery order to the end (what UrbanPiper's POS integration does):
//   order arrives      → created in Clover (open, platform order type, kitchen ticket)
//   leaves the kitchen → recorded as PAID with the platform tender ("Uber Eats", "DoorDash"…) — picked up,
//                        completed, delivered, or auto-completed (an order entered by hand from a platform screen:
//                        as soon as it is accepted)
//   cancelled before   → removed from the Clover register (or renamed "CANCELLED" if Clover refuses)
// Payments cannot be deleted or refunded through Clover's REST API, so they are only recorded once the
// order can no longer be cancelled by the restaurant — that keeps Clover's sales equal to the real sales.
import { randomUUID } from 'node:crypto';
import { logActivity } from './activity';
import { mevOnOrderChange } from './mev/hooks';
import { CHANNEL_LABELS, nowIso } from './config';
import { closeCancelledCloverOrder, recordCloverPayment } from './pos/clover-books';
import { getRepo, hasUnresolvedLegacySkipCloverReceipt, LEGACY_SKIP_CLOVER_REVIEW } from './repo';
import { isTgtgEmailOrder } from './tgtg-email/ids';
import type { OrderTimeline, StoredOrder } from './types';

async function patch(order: StoredOrder, t: OrderTimeline): Promise<StoredOrder> {
  return (await getRepo().patchOrder(order.id, t)) ?? { ...order, timeline: { ...(order.timeline ?? {}), ...t } };
}

const CLOVER_CLOSE_CLAIM_MS = 5 * 60_000;

function isTerminal(order: StoredOrder): boolean {
  return order.status === 'cancelled' || order.status === 'failed';
}

function canCloseSkipReceipt(fresh: StoredOrder, receipt: StoredOrder): boolean {
  return fresh.channel === 'skip' && !fresh.viaHub && !fresh.viaPos && isTerminal(fresh) && !fresh.timeline?.posClosedAt
    && fresh.posOrderId === receipt.posOrderId && fresh.timeline?.posMerchantId === receipt.timeline?.posMerchantId;
}

async function claimSkipReceiptClose(order: StoredOrder) {
  const repo = getRepo();
  const claim = { id: randomUUID(), at: nowIso() };
  for (let retry = 0; retry < 2; retry += 1) {
    let sameRevisionTime = false;
    const claimed = await repo.patchOrder(order.id, { posCloseClaim: claim }, {}, (fresh) => {
      if (!canCloseSkipReceipt(fresh, order)) return false;
      const previous = fresh.timeline?.posCloseClaim;
      const now = Date.now();
      if (previous && !(now - Date.parse(previous.at) >= CLOVER_CLOSE_CLAIM_MS)) return false;
      // The conditional SQL write compares updated_at. Avoid writing its existing millisecond back unchanged.
      if (repo.mode === 'supabase' && Date.parse(fresh.updatedAt) === now) {
        sameRevisionTime = true;
        return false;
      }
      return true;
    });
    if (claimed || !sameRevisionTime) return { claimed, claim };
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
  return { claimed: null, claim };
}

export async function holdUnresolvedLegacySkipCloverReceipt(order: StoredOrder): Promise<StoredOrder> {
  if (order.posError?.startsWith(LEGACY_SKIP_CLOVER_REVIEW) && order.timeline?.posRetry?.nextAt == null) return order;
  const held = await getRepo().applySkipLifecycle({ kind: 'hold_legacy_clover', externalOrderId: order.externalOrderId, orderId: order.id });
  return held.order ?? order;
}

/**
 * Every status change of a platform order goes through here, so this is also where the Revenu Québec invoice (Takatak
 * MEV) follows the order: sale once accepted, credit note when cancelled after it (mev/hooks.ts). Off = no cost.
 */
export async function settleInClover(order: StoredOrder | null): Promise<StoredOrder | null> {
  const current = order && hasUnresolvedLegacySkipCloverReceipt(order)
    ? await holdUnresolvedLegacySkipCloverReceipt(order) : order;
  const settled = current && hasUnresolvedLegacySkipCloverReceipt(current) ? current : await settleCloverOnly(current);
  await mevOnOrderChange(settled ?? current);
  return settled;
}

async function settleCloverOnly(order: StoredOrder | null): Promise<StoredOrder | null> {
  if (!order?.posOrderId) return order;
  // Orders that came through Clover's own platform integration are already paid / closed by that integration.
  if (order.viaPos) return order;
  const repo = getRepo();
  const tag = `${CHANNEL_LABELS[order.channel]} #${order.displayId || order.externalOrderId.slice(0, 8)}`;
  try {
    // Entered by hand from a platform screen: the platform already charged the customer and the order was accepted on its
    // screen, so it is paid as soon as it is accepted (the owner's "send it to Clover as paid already").
    const leftKitchen = order.status === 'dispatched' || order.status === 'completed';
    const paidOnAccept = order.viaHub === 'screen' && (order.status === 'accepted' || order.status === 'ready');
    if ((leftKitchen || paidOnAccept) && !order.timeline?.posPaymentId) {
      const store = await repo.findStore(order.channel, order.channelStoreId);
      const r = await recordCloverPayment(order, store?.cloverMerchantId);
      if (r.ok) {
        await repo.addEvent(order.id, 'pos_paid', { message: `Recorded as paid in Clover (${r.amount.toFixed(2)} $, ${CHANNEL_LABELS[order.channel]} tender)`, paymentId: r.paymentId });
        return patch(order, { posPaymentId: r.paymentId, posPaymentError: undefined });
      }
      if ('skipped' in r && r.skipped) return order;
      await repo.addEvent(order.id, 'pos_payment_failed', { error: r.error });
      return patch(order, { posPaymentError: r.error });
    }
    // 'failed' = handed to the Skip tablet: the kitchen makes it from the tablet, so the Clover copy must go too.
    if (isTerminal(order) && !order.timeline?.posClosedAt) {
      const guarded = order.channel === 'skip' && !order.viaHub && Boolean(order.timeline?.posMerchantId);
      const reservation = guarded ? await claimSkipReceiptClose(order) : null;
      if (reservation && !reservation.claimed) return (await repo.getOrder(order.id)) ?? order;
      const closing = reservation?.claimed ?? order;
      const finishClaim = (t: OrderTimeline) => repo.patchOrder(order.id, { ...t, posCloseClaim: undefined }, {}, (fresh) =>
        canCloseSkipReceipt(fresh, order) && fresh.timeline?.posCloseClaim?.id === reservation?.claim.id);
      if (closing.timeline?.posPaymentId) {
        const closed = reservation ? await finishClaim({ posClosedAt: nowIso() }) : null;
        if (reservation && !closed) return (await repo.getOrder(order.id)) ?? order;
        await repo.addEvent(order.id, 'pos_paid_then_cancelled', { message: 'Cancelled after it was recorded as paid in Clover — refund it in the Clover app if the platform did not pay you.' });
        await logActivity({ actor: 'Food Hub', source: 'automation', kind: 'order', action: 'clover_paid_cancelled', status: 'failed', channel: order.channel, brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
          summary: `${tag} was cancelled after it was recorded as paid in Clover — check the payout; refund it in Clover if the platform did not pay you.` });
        return closed ?? patch(order, { posClosedAt: nowIso() });
      }
      const merchantId = closing.timeline?.posMerchantId || (await repo.findStore(order.channel, order.channelStoreId))?.cloverMerchantId;
      const r = await closeCancelledCloverOrder(closing, merchantId, { flagOnly: isTgtgEmailOrder(closing) });
      const finished = reservation ? await finishClaim(r.ok ? { posClosedAt: nowIso() } : {}) : null;
      if (reservation && !finished) return (await repo.getOrder(order.id)) ?? order;
      if (r.skipped) return finished ?? order;
      await repo.addEvent(order.id, r.ok ? 'pos_cancelled' : 'pos_cancel_failed', { message: closing.status === 'failed' ? `${r.message} (order handed to the Skip tablet)` : r.message });
      if (!r.ok) {
        await logActivity({ actor: 'Food Hub', source: 'automation', kind: 'order', action: 'clover_cancel_failed', status: 'failed', channel: order.channel, brandName: order.brandName, locationCode: order.locationCode, orderId: order.id, summary: `${tag} ${order.status === 'failed' ? 'moved to the Skip tablet' : 'cancelled'}, but Clover still has the order: ${r.message}` });
      }
      return finished ?? (r.ok ? patch(order, { posClosedAt: nowIso() }) : order);
    }
  } catch (error) {
    await repo.addEvent(order.id, 'pos_settle_failed', { error: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
  }
  return order;
}
