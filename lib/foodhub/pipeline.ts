// The order pipeline: every channel's webhook ends here.
//   receive → dedupe → map to store/brand → inject into Clover → print in kitchen → auto-accept → log
// Every step is timestamped on the order (timeline) for the status-transitions report and analytics.
import { logActivity, type Actor } from './activity';
import { getAdapter } from './adapters';
import { CHANNEL_LABELS, nowIso } from './config';
import { allCloverMerchants, cloverAutoPrintEnabled, cloverBaseUrl, cloverExpected, cloverToken, defaultCloverMerchant, injectOrder, type InjectResult } from './pos/clover';
import { cloverOrderTypeForOrder, cloverTotalGap, describeMappingWarnings, findCloverOrderByTitle, mapOrderLines, platformFoodCents, printKitchenTicket } from './pos/clover-order';
import { cloverRetryDelaysS, noteLastOrder, scheduleCloverRetry } from './order-retry';
import { settleInClover } from './clover-settle';
import { doorDashMerchantCancelEnabled } from './adapters/doordash';
import { relayActions } from './adapters/relay';
import { reportSkipMissingItems } from './adapters/skip';
import { applyCourierUpdate, pendingKey, readPending } from './courier';
import { getBrandMenu } from './menu/shared';
import { prepFor } from './prep';
import { isWaitingScheduled, scheduledInfo } from './scheduling';
import { getRepo } from './repo';
import { localTimeLabel } from './time';
import { CANCEL_REASON_LABELS, type CancelReason, type ChannelAdapter, type ChannelKey, type ChannelResult, type ChannelStore, type NormalizedOrder, type OrderStatus, type OrderTimeline, type StoredOrder } from './types';

export interface PipelineOutcome {
  order: StoredOrder;
  duplicate: boolean;
  pos?: { ok: boolean; posOrderId?: string; error?: string; skipped?: boolean };
  accept?: ChannelResult;
}

async function patchTimeline(order: StoredOrder, patch: OrderTimeline, extra: Partial<StoredOrder> = {}): Promise<StoredOrder> {
  // Merged against the order as stored now (concurrency-safe), never against our possibly stale copy.
  return (await getRepo().patchOrder(order.id, patch, extra)) ?? { ...order, ...extra, timeline: { ...(order.timeline ?? {}), ...patch } };
}

async function autoPrint(order: StoredOrder, merchantId?: string | null): Promise<StoredOrder> {
  if (!order.posOrderId || !cloverAutoPrintEnabled()) return order;
  // Scheduled orders print at their fire time (see scheduling.ts), not when they arrive.
  if (isWaitingScheduled(order)) return order;
  const p = await printKitchenTicket(order.posOrderId, merchantId, order.locationCode);
  await getRepo().addEvent(order.id, p.ok ? 'printed' : 'print_failed', { message: p.message, printEventId: p.printEventId });
  // printError is what the board/alerts key on ("Ticket not printed" + Reprint); a successful print clears it.
  return patchTimeline(order, p.ok ? { printedAt: nowIso(), printError: undefined } : { printError: p.message });
}

/** Where an order's platform actions go: the platform's own API, or the relay callback for orders that came through it. */
function actionsFor(order: { channel: ChannelKey; viaHub?: 'relay' }): Pick<ChannelAdapter, 'acceptOrder' | 'denyOrder' | 'markReady' | 'cancelOrder'> {
  return order.viaHub === 'relay' ? relayActions : getAdapter(order.channel);
}

export async function processIncomingOrder(n: NormalizedOrder): Promise<PipelineOutcome> {
  const repo = getRepo();
  const store = n.channelStoreId ? await repo.findStore(n.channel, n.channelStoreId) : null;
  const brandName = store?.brandName || n.brandName;

  // Link every line and option to the Clover inventory through the brand's master menu (or the menu it shares):
  // by id, then by name, else a free-text line with a visible warning (pos/clover-order.ts). Clover item ids belong to
  // one merchant: a menu imported from another merchant than this store's is sent as free text (Clover would refuse
  // foreign ids). Orders Clover itself received ("via Clover") already carry their Clover ids.
  if (!n.viaPos && cloverExpected()) {
    const menu = brandName ? await getBrandMenu(brandName) : null;
    const targetMerchant = store?.cloverMerchantId || process.env.CLOVER_MERCHANT_ID;
    const foreign = Boolean(menu?.posMerchantId && targetMerchant && menu.posMerchantId !== targetMerchant);
    const mapped = mapOrderLines(n.lines, menu, { foreign });
    n.lines = mapped.lines;
    n.mappingWarnings = mapped.warnings.length ? mapped.warnings : undefined;
  }

  const { order, isNew } = await repo.insertOrderIfNew({ ...n, brandName, locationCode: store?.locationCode });
  if (!isNew) {
    await repo.addEvent(order.id, 'duplicate_delivery', { note: 'Webhook delivered again; ignored.' });
    return { order, duplicate: true };
  }
  await noteLastOrder(n.channel, order.createdAt);

  await repo.addEvent(order.id, 'received', { channel: n.channel, marketplace: n.marketplace, total: n.total, lines: n.lines.length });
  if (!store) {
    await repo.addEvent(order.id, 'unmapped_store', { channelStoreId: n.channelStoreId, hint: 'Map this store in Food Hub → Stores so orders route to the right brand, location and Clover merchant.' });
  }
  if (n.mappingWarnings?.length) {
    const said = describeMappingWarnings(n.mappingWarnings);
    await repo.addEvent(order.id, 'mapping_warning', { message: said.map((w) => w.en).join(' '), messageFr: said.map((w) => w.fr).join(' '), warnings: n.mappingWarnings });
  }

  // A cancellation that arrived before the order was stored: do not cook it, do not put it in Clover, do not accept it.
  const pending = await readPending(n.channel, n.externalOrderId);
  if (pending) await repo.setKv(pendingKey(n.channel, n.externalOrderId), { ...pending, consumedAt: nowIso() }).catch(() => undefined);
  if (pending?.status && /cancel|fail/i.test(pending.status.platformState)) {
    const why = String(pending.status.detail.reason ?? pending.status.detail.event ?? 'Cancelled on the platform');
    const cancelled = await patchTimeline(order, { cancelledAt: nowIso(), cancelledBy: /customer|eater/i.test(why) ? 'customer' : 'platform', cancelStage: 'before_accept', cancelReason: why }, { status: 'cancelled' });
    await repo.addEvent(order.id, 'platform_status', { state: pending.status.platformState, ...pending.status.detail, at: pending.status.at, note: 'Arrived before the order itself; applied on arrival — nothing sent to Clover or the platform.' });
    await logActivity({ actor: CHANNEL_LABELS[n.channel], source: 'platform', kind: 'order', action: 'platform_cancel', status: 'info', channel: n.channel, brandName, locationCode: store?.locationCode, orderId: order.id,
      summary: `${CHANNEL_LABELS[n.channel]} cancelled #${order.displayId || order.externalOrderId.slice(0, 8)} before it was processed — ${why}` });
    return { order: cancelled, duplicate: false, pos: { ok: false, skipped: true, error: 'Cancelled by the platform before processing.' } };
  }

  // 0) Prep time (normal / busy), scheduled orders, courier details sent with the order
  const prep = await prepFor(store?.locationCode);
  const scheduled = scheduledInfo(n, prep.minutes);
  let current: StoredOrder = await patchTimeline(order, {
    readyTarget: scheduled?.scheduledFor ?? new Date(Date.now() + prep.minutes * 60_000).toISOString(),
    ...(scheduled ?? {}),
    ...(n.courier?.status ? { courier: { ...n.courier, status: n.courier.status, updatedAt: nowIso(), source: n.channel } } : {}),
  });
  if (scheduled) await repo.addEvent(order.id, 'scheduled', { message: `Scheduled for ${localTimeLabel(scheduled.scheduledFor, { date: true })} — kitchen ticket at ${localTimeLabel(scheduled.fireAt)}` });

  // A platform cancel can land between the insert and this point: never cook, inject or accept a cancelled order.
  const cancelledMeanwhile = async () => (await repo.getOrder(order.id))?.status === 'cancelled';
  if (await cancelledMeanwhile()) return { order: (await repo.getOrder(order.id)) ?? current, duplicate: false, pos: { ok: false, skipped: true, error: 'Cancelled by the platform before processing.' } };

  // 1) POS injection (+ order type, payment record, kitchen ticket).
  // An order from a store nobody mapped is never dropped into a guessed register when several Clover merchants
  // exist: it waits on the Command Center until the store is mapped (then "Send to Clover").
  const severalRegisters = !store && (await allCloverMerchants()).length > 1;
  const pos: InjectResult = severalRegisters
    ? { ok: false, skipped: false, error: `Store ${n.channelStoreId || '(no id)'} is not mapped in Food Hub and there are several Clover registers — map it under Stores → Mapping, then use "Send to Clover".` }
    : await sendToClover(current, store);
  if (pos.ok) {
    current = await recordCloverSuccess(current, store, pos);
  } else {
    current = (await repo.updateOrder(order.id, { posError: pos.error })) ?? current;
    await repo.addEvent(order.id, pos.skipped ? 'pos_skipped' : 'pos_failed', { error: pos.error, ...(pos.uncertain ? { uncertain: true } : {}) });
  }

  // 3) Auto-accept — never accept an order the kitchen did not receive, nor one from a store nobody mapped
  // (wrong brand, wrong location or wrong kitchen are all possible): a person decides.
  if (!store) await repo.addEvent(order.id, 'needs_attention', { reason: `Not accepted automatically: store ${n.channelStoreId || '(no id)'} is not mapped in Food Hub. Check the brand and kitchen, then accept or reject.` });
  const posBlocksAccept = !pos.ok && !pos.skipped;
  let accept: ChannelResult | undefined;
  if (store?.autoAccept && !posBlocksAccept) {
    const r = await autoAcceptAfterClover(current, pos.ok ? pos.posOrderId : undefined);
    current = r.order;
    accept = r.accept;
  } else if (posBlocksAccept) {
    if (n.channel === 'skip' && !n.viaHub) {
      // Skip/JET Connect: tell JET right away so the order falls back to the Skip tablet
      // instead of waiting out the 5-minute timeout. 'failed' = handed back to the platform (still a sale).
      const fallback = await getAdapter('skip').denyOrder(current, 'Clover did not receive the order');
      const tag = `Skip #${order.displayId || order.externalOrderId.slice(0, 8)}`;
      if (fallback.ok) {
        await repo.addEvent(order.id, 'routed_to_skip_tablet', { status: fallback.status, message: fallback.message });
        if (!(await cancelledMeanwhile())) current = (await repo.updateOrder(order.id, { status: 'failed', channelError: 'Clover failed — order sent to the Skip tablet (backup flow).' })) ?? current;
        await logActivity({ actor: 'TAKATAK automation', source: 'automation', kind: 'order', action: 'skip_tablet_fallback', status: 'info', channel: 'skip', brandName, locationCode: store?.locationCode, orderId: order.id,
          summary: `${tag} sent to the Skip tablet (Clover did not receive it)` });
      } else {
        // JET did not get sent-to-pos-failed (live switch off, key missing, HTTP error): never claim it did.
        // The order stays "new" with Accept / Send to Skip tablet available so the operator can retry.
        await repo.addEvent(order.id, 'routed_to_skip_tablet_failed', { status: fallback.status, message: fallback.message });
        current = (await repo.updateOrder(order.id, { channelError: `Skip tablet hand-off not sent: ${fallback.message}` })) ?? current;
        await logActivity({ actor: 'TAKATAK automation', source: 'automation', kind: 'order', action: 'skip_tablet_fallback', status: 'failed', channel: 'skip', brandName, locationCode: store?.locationCode, orderId: order.id,
          summary: `${tag}: Clover did not receive it and the Skip tablet hand-off was NOT sent (${fallback.message}) — retry "Send to Skip tablet" or send it to Clover` });
      }
    } else if (!severalRegisters && (await scheduleCloverRetry(current, pos))) {
      current = (await repo.getOrder(order.id)) ?? current;
      await repo.addEvent(order.id, 'needs_attention', { reason: `Clover injection failed — Food Hub tries again by itself (${cloverRetryDelaysS().map((s) => `${s} s`).join(', then ')}) before waking a manager. Nothing is accepted on the platform until Clover has the order.` });
    } else {
      await repo.addEvent(order.id, 'needs_attention', { reason: 'Clover injection failed — use "Send to Clover" (or "Accept without Clover" after entering it by hand).' });
    }
  }

  // Platform events that arrived before the order (courier assigned, non-cancel status): apply them now.
  if (pending?.status) await applyExternalStatus(n.channel, n.externalOrderId, pending.status.platformState, pending.status.detail).catch(() => null);
  for (const c of pending?.courier ?? []) await applyCourierUpdate(n.channel, n.externalOrderId, c.update, c.source).catch(() => null);
  if (pending) current = (await repo.getOrder(order.id)) ?? current;

  return { order: current, duplicate: false, pos: pos.ok ? { ok: true, posOrderId: pos.posOrderId } : { ok: false, error: pos.error, skipped: pos.skipped }, accept };
}

/** Puts an order into Clover (the store's merchant, the right order type); its lines are already linked to the inventory. */
export async function sendToClover(order: StoredOrder, store: ChannelStore | null): Promise<InjectResult> {
  const mid = store?.cloverMerchantId || (await defaultCloverMerchant());
  const token = mid ? await cloverToken(mid).catch(() => null) : null;
  const orderTypeId = await cloverOrderTypeForOrder(mid, order, { token, base: cloverBaseUrl() }).catch(() => null);
  return injectOrder(order, store?.cloverMerchantId, { orderTypeId });
}

/**
 * Clover confirmed the order: keep its id, say how the lines were linked, flag a Clover total that differs from what
 * the platform charged (usually a Clover tax setting — flagged, never changed), then print the kitchen ticket.
 */
export async function recordCloverSuccess(order: StoredOrder, store: ChannelStore | null, pos: Extract<InjectResult, { ok: true }>, extra: Record<string, unknown> = {}): Promise<StoredOrder> {
  const repo = getRepo();
  let current = (await repo.updateOrder(order.id, { posOrderId: pos.posOrderId, posError: undefined })) ?? order;
  if (current.timeline?.posRetry) current = await patchTimeline(current, { posRetry: { ...current.timeline.posRetry, nextAt: null, doneAt: nowIso() } });
  await repo.addEvent(order.id, pos.adopted ? 'pos_adopted' : 'pos_injected', {
    posOrderId: pos.posOrderId, ...extra,
    ...(pos.lineItems !== undefined ? { lineItems: pos.lineItems } : {}),
    ...(pos.freeLines ? { freeLines: pos.freeLines } : {}),
    ...(pos.adopted ? { message: 'Clover already had this order (its earlier answer was lost) — linked to it, nothing sent twice.' } : {}),
  });
  if (pos.totalCents !== undefined) {
    const gap = cloverTotalGap(current, pos.totalCents, pos.lineItems ?? current.lines.length);
    if (gap.flagged) {
      const msg = `Clover total ${(pos.totalCents / 100).toFixed(2)} $ vs ${CHANNEL_LABELS[current.channel]} ${(platformFoodCents(current) / 100).toFixed(2)} $ (${gap.gapCents > 0 ? '+' : ''}${(gap.gapCents / 100).toFixed(2)} $). Clover computes its own tax from each item's tax rates — check Clover → Setup → Taxes (e.g. a stray default "Sales Tax"). Food Hub records the platform amount and changes nothing in Clover.`;
      await repo.addEvent(order.id, 'pos_total_mismatch', { message: msg, cloverTotalCents: pos.totalCents, gapCents: gap.gapCents });
      await logActivity({ actor: 'Food Hub', source: 'automation', kind: 'order', action: 'clover_total_mismatch', status: 'info', channel: current.channel, brandName: current.brandName, locationCode: current.locationCode, orderId: current.id,
        summary: `${CHANNEL_LABELS[current.channel]} #${current.displayId || current.externalOrderId.slice(0, 8)}: ${msg}` });
    }
  }
  return autoPrint(current, store?.cloverMerchantId);
}

/**
 * Accept on the platform once Clover has the order (or Clover is not part of this deployment). A cancellation that
 * lands meanwhile always wins: nothing is accepted over it, and the Clover copy is removed.
 */
export async function autoAcceptAfterClover(order: StoredOrder, posOrderId?: string): Promise<{ order: StoredOrder; accept?: ChannelResult }> {
  const repo = getRepo();
  const cancelledMeanwhile = async () => (await repo.getOrder(order.id))?.status === 'cancelled';
  let current = order;
  if (await cancelledMeanwhile()) {
    await repo.addEvent(order.id, 'accept_skipped', { reason: 'Cancelled by the platform while it was being put in Clover — nothing sent to the platform; the Clover copy is removed.' });
    return { order: (await settleInClover((await repo.getOrder(order.id)) ?? current)) ?? current };
  }
  const accept = await actionsFor(current).acceptOrder(current, posOrderId);
  if (accept.ok && (await cancelledMeanwhile())) {
    // Cancelled during the accept call itself: keep the cancellation, never write 'accepted' over it.
    await repo.addEvent(order.id, 'needs_attention', { reason: 'Accepted on the platform, but the platform cancelled the order meanwhile — check the platform; the Clover copy is removed.' });
    current = (await settleInClover((await repo.getOrder(order.id)) ?? current)) ?? current;
  } else if (accept.ok) {
    current = await patchTimeline(current, { acceptedAt: nowIso(), acceptedBy: 'auto' }, { status: 'accepted', channelError: undefined });
    await repo.addEvent(order.id, 'accepted', { auto: true, response: summarize(accept) });
  } else {
    current = (await repo.updateOrder(order.id, { channelError: accept.message })) ?? current;
    await repo.addEvent(order.id, 'accept_failed', { auto: true, status: accept.status, message: accept.message });
  }
  return { order: current, accept };
}

/** The last Clover answer may have been lost after Clover created the order (time-out, dropped connection, 5xx). */
function maybeInClover(order: StoredOrder): boolean {
  return Boolean(order.timeline?.posRetry?.uncertain) || /network error|timed out|aborted|HTTP 5\d\d|did not include an order id/i.test(order.posError ?? '');
}

/**
 * Sends an order Clover does not have yet — "Send to Clover" and the automatic retries:
 *  1. re-links its lines and brand (the store may have been mapped since it arrived);
 *  2. when the last answer was lost, looks in Clover first and links the order Clover already has (no second ticket);
 *  3. injects, records and prints. Accepting on the platform is the caller's decision.
 */
export async function resendToClover(order: StoredOrder, opts: { manual?: boolean; by?: string; attempt?: number } = {}): Promise<{ order: StoredOrder; pos: InjectResult; store: ChannelStore | null }> {
  const repo = getRepo();
  const store = await repo.findStore(order.channel, order.channelStoreId);
  let current = order;
  const patch: Partial<StoredOrder> = {};
  if (store && !order.locationCode) Object.assign(patch, { locationCode: store.locationCode, brandName: store.brandName });
  const brandName = store?.brandName || order.brandName;
  if (!order.viaPos && cloverExpected() && order.lines.some((l) => !l.posItemRef)) {
    const menu = brandName ? await getBrandMenu(brandName) : null;
    const target = store?.cloverMerchantId || process.env.CLOVER_MERCHANT_ID;
    const mapped = mapOrderLines(order.lines, menu, { foreign: Boolean(menu?.posMerchantId && target && menu.posMerchantId !== target) });
    if (mapped.lines.some((l, i) => l.posItemRef !== order.lines[i].posItemRef)) Object.assign(patch, { lines: mapped.lines, mappingWarnings: mapped.warnings.length ? mapped.warnings : undefined });
  }
  if (Object.keys(patch).length) current = (await repo.updateOrder(order.id, patch)) ?? { ...current, ...patch };
  const tag = { ...(opts.manual ? { manual: true } : {}), ...(opts.by ? { by: opts.by } : {}), ...(opts.attempt ? { attempt: opts.attempt } : {}) };

  let pos: InjectResult | null = null;
  if (maybeInClover(current)) {
    const mid = store?.cloverMerchantId || (await defaultCloverMerchant());
    const token = mid ? await cloverToken(mid).catch(() => null) : null;
    const hit = mid && token ? await findCloverOrderByTitle(mid, token, cloverBaseUrl(), current, Date.parse(current.createdAt) - 5 * 60_000).catch(() => null) : null;
    if (hit) pos = { ok: true, posOrderId: hit.id, adopted: true, ...(hit.totalCents !== undefined ? { totalCents: hit.totalCents } : {}) };
  }
  pos ??= await sendToClover(current, store);
  if (pos.ok) return { order: await recordCloverSuccess(current, store, pos, tag), pos, store };
  current = (await repo.updateOrder(order.id, { posError: pos.error })) ?? current;
  await repo.addEvent(order.id, 'pos_failed', { error: pos.error, ...tag, ...(pos.uncertain ? { uncertain: true } : {}) });
  return { order: current, pos, store };
}

function summarize(r: ChannelResult) {
  return { status: r.status, httpStatus: r.httpStatus, message: r.message };
}

/** 'accept_no_pos' = explicit "Accept without Clover (entered by hand)" override when Clover did not receive the order. */
export type OrderAction = 'accept' | 'accept_no_pos' | 'deny' | 'ready' | 'dispatch' | 'complete' | 'cancel' | 'retry_pos' | 'print' | 'report_missing' | 'ack' | 'delay';
export const ORDER_ACTIONS: OrderAction[] = ['accept', 'accept_no_pos', 'deny', 'ready', 'dispatch', 'complete', 'cancel', 'retry_pos', 'print', 'report_missing', 'ack', 'delay'];
/** Not buttons of their own: "seen" on the new-order pop-up, and "+5 min" on an order in the kitchen. */
const META_ACTIONS: OrderAction[] = ['ack', 'delay'];

const NEXT_STATUS: Partial<Record<OrderAction, OrderStatus>> = { accept: 'accepted', accept_no_pos: 'accepted', deny: 'cancelled', ready: 'ready', dispatch: 'dispatched', complete: 'completed', cancel: 'cancelled' };

/** Locked rule: never accept an order Clover did not receive — unless Clover is not part of this deployment. */
export function acceptNeedsClover(order: Pick<StoredOrder, 'posOrderId' | 'posError'>): boolean {
  // Clover is expected for this deployment, or it was expected for this very order (its injection failed).
  return !order.posOrderId && (cloverExpected() || Boolean(order.posError));
}

/** Which actions make sense for an order right now (the UI shows only these buttons). */
export function allowedActions(order: StoredOrder): OrderAction[] {
  const a: OrderAction[] = [];
  // Received through Clover's own platform integration: Food Hub only follows it. The kitchen can still move it
  // on its own screen (Ready / Completed) and reprint it; nothing is sent to the platform.
  if (order.viaPos) {
    if (order.status === 'accepted') a.push('ready');
    if (order.status === 'ready' || order.status === 'accepted') a.push('complete');
    if (order.posOrderId) a.push('print');
    return a;
  }
  if (order.status === 'new') a.push(acceptNeedsClover(order) ? 'accept_no_pos' : 'accept', 'deny');
  // Uber Eats lets a store cancel an accepted order by API; DoorDash too once it allowlisted the integration. Skip (and
  // DoorDash otherwise) cancellations are done in their merchant portal / tablet and arrive back here through webhooks.
  // DoorDash only when DoorDash allowlisted merchant cancellations for this integration (DOORDASH_MERCHANT_CANCEL=true).
  const canCancel = order.channel === 'uber_eats' || (order.channel === 'doordash' && !order.viaHub && doorDashMerchantCancelEnabled());
  if (order.status === 'accepted') a.push('ready', ...(canCancel ? (['cancel'] as const) : []));
  if (order.status === 'ready') a.push('dispatch', 'complete', ...(canCancel ? (['cancel'] as const) : []));
  if (order.status === 'dispatched') a.push('complete');
  // "Send to Clover" only while the order is still ours to make — never for orders on the Skip tablet, cancelled or closed.
  if (!order.posOrderId && ['new', 'accepted', 'ready', 'dispatched'].includes(order.status)) a.push('retry_pos');
  if (order.posOrderId) a.push('print');
  // SkipTheDishes (JET Connect) lets the store report an out-of-stock item after accepting; Skip adjusts the customer's bill.
  // (Not for Skip orders that came through the relay: Skip's API does not know them.)
  if (order.channel === 'skip' && !order.viaHub && ['accepted', 'ready'].includes(order.status)) a.push('report_missing');
  return a;
}

const ACTION_LABEL: Record<OrderAction, string> = {
  accept: 'Accepted', accept_no_pos: 'Accepted without Clover (entered by hand)', deny: 'Rejected', ready: 'Marked ready', dispatch: 'Handed to courier', complete: 'Completed', cancel: 'Cancelled', retry_pos: 'Sent to Clover', print: 'Printed in kitchen',
  report_missing: 'Reported missing items', ack: 'Seen', delay: 'More time',
};

export async function runOrderAction(orderId: string, action: OrderAction, opts: { reason?: string; reasonCode?: CancelReason; actor?: Actor; missing?: Array<{ line: number; quantity: number }>; prepMinutes?: number; delayMinutes?: number; approvedBy?: string } = {}): Promise<{ order: StoredOrder | null; result: ChannelResult | { ok: boolean; message: string } }> {
  const repo = getRepo();
  const order = await repo.getOrder(orderId);
  if (!order) return { order: null, result: { ok: false, message: 'Order not found.' } };
  const actor = opts.actor ?? { username: 'owner', name: 'Owner', source: 'dashboard' as const };
  const tag = `${CHANNEL_LABELS[order.channel]} #${order.displayId || order.externalOrderId.slice(0, 8)}`;
  const log = (status: 'success' | 'failed' | 'info', message: string) => logActivity({
    actor: actor.name, source: actor.source, kind: 'order', action, status, channel: order.channel, brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
    summary: `${ACTION_LABEL[action]}: ${tag}${opts.reasonCode ? ` — ${CANCEL_REASON_LABELS[opts.reasonCode]}` : opts.reason ? ` — ${opts.reason}` : ''}${opts.approvedBy ? ` (approved by ${opts.approvedBy})` : ''}${status === 'failed' ? ` (failed: ${message})` : ''}`,
  });

  if (action === 'accept' && order.status === 'new' && acceptNeedsClover(order)) {
    // Nothing is sent to the platform: the kitchen has no Clover order yet.
    return { order, result: { ok: false, message: 'Clover did not receive this order — use "Send to Clover" first. If you entered it in Clover by hand, use "Accept without Clover (entered by hand)".' } };
  }
  if (action === 'ack' && order.status === 'cancelled') {
    if (order.timeline?.cancelSeenAt) return { order, result: { ok: true, message: 'Already seen.' } };
    const updated = await patchTimeline(order, { cancelSeenAt: nowIso(), cancelSeenBy: actor.name });
    await repo.addEvent(order.id, 'cancel_seen', { by: actor.name });
    await log('info', 'cancellation seen in the kitchen');
    return { order: updated, result: { ok: true, message: 'Seen.' } };
  }
  if (action === 'ack') {
    if (order.timeline?.seenAt) return { order, result: { ok: true, message: 'Already seen.' } };
    const updated = await patchTimeline(order, { seenAt: nowIso(), seenBy: actor.name });
    await repo.addEvent(order.id, 'seen', { by: actor.name });
    return { order: updated, result: { ok: true, message: 'Seen.' } };
  }

  if (action === 'delay') {
    const minutes = Math.round(Number(opts.delayMinutes) || 0);
    if (!['accepted', 'ready'].includes(order.status) || minutes < 1 || minutes > 60) return { order, result: { ok: false, message: 'Add 1–60 minutes to an order in the kitchen.' } };
    const base = Math.max(Date.now(), Date.parse(order.timeline?.readyTarget ?? '') || Date.now());
    const updated = await patchTimeline(order, { readyTarget: new Date(base + minutes * 60_000).toISOString(), delayedMinutes: (order.timeline?.delayedMinutes ?? 0) + minutes });
    await repo.addEvent(order.id, 'delayed', { minutes, by: actor.name, message: `+${minutes} min on the kitchen timer (the platform keeps its own estimate)` });
    await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action, status: 'success', channel: order.channel, brandName: order.brandName, locationCode: order.locationCode, orderId: order.id, summary: `+${minutes} min: ${tag}` });
    return { order: updated, result: { ok: true, message: `+${minutes} min on the kitchen timer. ${order.channel === 'uber_eats' || order.channel === 'doordash' ? 'The courier follows the platform estimate — call support if it is a long delay.' : ''}`.trim() } };
  }

  if (!allowedActions(order).includes(action) && !META_ACTIONS.includes(action)) {
    return { order, result: { ok: false, message: `"${ACTION_LABEL[action]}" is not possible while the order is ${order.status}.` } };
  }

  if (action === 'report_missing') {
    const picks = (opts.missing ?? []).map((m) => ({ line: order.lines[m.line], quantity: Math.max(1, Math.round(m.quantity)) }))
      .filter((m) => m.line && m.quantity <= m.line.quantity);
    if (!picks.length) return { order, result: { ok: false, message: 'Choose the missing item(s) and quantity.' } };
    const noPlu = picks.find((m) => !m.line.externalId);
    if (noPlu) return { order, result: { ok: false, message: `"${noPlu.line.name}" has no Skip item reference (PLU), so it cannot be reported by API — use the Skip tablet.` } };
    const res = await reportSkipMissingItems(order, picks.map((m) => ({ plu: m.line.externalId!, missingQuantity: m.quantity })));
    const now = nowIso();
    const updated = res.ok
      ? await patchTimeline(order, { missingItems: [...(order.timeline?.missingItems ?? []), ...picks.map((m) => ({ name: m.line.name, ref: m.line.externalId, quantity: m.quantity, at: now }))] })
      : await repo.updateOrder(order.id, { channelError: res.message });
    const label = picks.map((m) => `${m.quantity}× ${m.line.name}`).join(', ');
    await repo.addEvent(order.id, res.ok ? 'report_missing' : 'report_missing_failed', { message: `${label}: ${res.message}`, by: actor.name });
    await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action, status: res.ok ? 'success' : 'failed', channel: order.channel, brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
      summary: `Missing items reported to SkipTheDishes for ${tag}: ${label}${res.ok ? '' : ` (failed: ${res.message})`}` });
    return { order: updated, result: res };
  }

  if (action === 'retry_pos' || action === 'print') {
    const store = await repo.findStore(order.channel, order.channelStoreId);
    if (action === 'print') {
      const p = await printKitchenTicket(order.posOrderId!, store?.cloverMerchantId, order.locationCode);
      await repo.addEvent(order.id, p.ok ? 'printed' : 'print_failed', { message: p.message, manual: true, by: actor.name });
      const updated = await patchTimeline(order, p.ok ? { printedAt: nowIso(), printError: undefined } : { printError: p.message });
      await log(p.ok ? 'success' : 'failed', p.message);
      return { order: updated, result: { ok: p.ok, message: p.message } };
    }
    const sent = await resendToClover(order, { manual: true, by: actor.name });
    const pos = sent.pos;
    let updated: StoredOrder | null = sent.order;
    if (pos.ok) updated = await settleInClover(updated);
    await log(pos.ok ? 'success' : 'failed', pos.ok ? '' : pos.error);
    return { order: updated, result: { ok: pos.ok, message: pos.ok ? (pos.adopted ? `Already in Clover (${pos.posOrderId}) — linked, nothing sent twice.` : `Created in Clover (${pos.posOrderId}).`) : pos.error } };
  }

  const reasonText = opts.reasonCode ? `${CANCEL_REASON_LABELS[opts.reasonCode]}${opts.reason?.trim() ? ` — ${opts.reason.trim()}` : ''}` : opts.reason || 'Rejected by restaurant';
  const adapter = actionsFor(order);
  let res: ChannelResult | { ok: boolean; message: string };
  let working = order;
  if ((action === 'accept' || action === 'accept_no_pos') && opts.prepMinutes && opts.prepMinutes >= 5 && opts.prepMinutes <= 120) {
    // The cook's estimate from the pop-up becomes the ready-by target (DoorDash receives it as prep_time).
    working = await patchTimeline(order, { readyTarget: new Date(Date.now() + Math.round(opts.prepMinutes) * 60_000).toISOString() });
  }
  if (order.viaPos) res = { ok: true, message: action === 'ready' ? 'Marked ready in Food Hub only — this order is handled by Clover’s own platform integration.' : 'Marked completed in Food Hub.' };
  else if (action === 'accept' || action === 'accept_no_pos') res = await adapter.acceptOrder(working, order.posOrderId);
  else if (action === 'deny') res = await adapter.denyOrder(order, reasonText);
  else if (action === 'cancel') res = await adapter.cancelOrder(order, opts.reasonCode ?? 'other', opts.reason);
  else if (action === 'ready') res = await adapter.markReady(order, order.posOrderId);
  else res = { ok: true, message: action === 'dispatch' ? 'Handed to the courier.' : 'Marked completed in Food Hub.' };

  // On Skip, "reject" hands the order to the Skip tablet (JET backup flow) — it is not cancelled for the customer.
  const nextStatus: OrderStatus = action === 'deny' && order.channel === 'skip' && !order.viaHub ? 'failed' : NEXT_STATUS[action]!;
  const now = nowIso();
  const t: OrderTimeline = {};
  if (res.ok) {
    if (action === 'accept' || action === 'accept_no_pos') Object.assign(t, { acceptedAt: now, acceptedBy: actor.username, seenAt: order.timeline?.seenAt ?? now, seenBy: order.timeline?.seenBy ?? actor.name });
    if (action === 'deny') Object.assign(t, { seenAt: order.timeline?.seenAt ?? now, seenBy: order.timeline?.seenBy ?? actor.name });
    if (opts.approvedBy) t.approvedBy = opts.approvedBy;
    if (action === 'ready') t.readyAt = now;
    if (action === 'dispatch') Object.assign(t, { dispatchedAt: now, readyAt: order.timeline?.readyAt ?? now });
    if (action === 'complete') t.completedAt = now;
    if ((action === 'deny' && nextStatus === 'cancelled') || action === 'cancel') {
      Object.assign(t, { cancelledAt: now, cancelledBy: opts.reasonCode === 'customer_request' ? 'customer' : 'store', cancelStage: order.timeline?.acceptedAt ? 'after_accept' : 'before_accept', cancelReason: reasonText });
    }
  }
  let updated = res.ok
    ? await patchTimeline(working, t, { status: nextStatus, channelError: nextStatus === 'failed' ? 'Sent to the Skip tablet (backup flow).' : undefined })
    : await repo.updateOrder(order.id, { channelError: res.message });
  const eventType = action === 'accept_no_pos' ? 'accept_without_pos' : action;
  await repo.addEvent(order.id, res.ok ? eventType : `${eventType}_failed`, { message: res.message, reason: reasonText, by: actor.name, ...(action === 'accept_no_pos' ? { note: 'Operator confirmed the order was entered in Clover by hand.' } : {}), ...(opts.approvedBy ? { approvedBy: opts.approvedBy } : {}) });
  // Clover follows: paid when it leaves the kitchen, removed from the register when cancelled (or handed to the Skip tablet).
  if (res.ok) updated = await settleInClover(updated);
  await log(res.ok ? 'success' : 'failed', res.message);
  return { order: updated, result: res };
}

/** Status changes pushed by a platform (customer cancellation, courier picked up, completed…). */
export async function applyExternalStatus(channel: ChannelKey, externalOrderId: string, platformState: string, detail: Record<string, unknown> = {}) {
  const repo = getRepo();
  let order = await repo.findOrder(channel, externalOrderId);
  if (!order) {
    // Not stored yet (webhooks race the order fetch): keep it for processIncomingOrder instead of dropping it.
    const prev = (await readPending(channel, externalOrderId)) ?? {};
    await repo.setKv(pendingKey(channel, externalOrderId), { ...prev, status: { platformState, detail, at: nowIso() } }).catch(() => undefined);
    // The order may have been inserted while we wrote the note: then apply it now and mark the note consumed.
    order = await repo.findOrder(channel, externalOrderId);
    if (!order) return null;
    await repo.setKv(pendingKey(channel, externalOrderId), { ...prev, status: { platformState, detail, at: nowIso() }, consumedAt: nowIso() }).catch(() => undefined);
  }
  const s = platformState.toLowerCase();
  const status: OrderStatus | null =
    s.includes('cancel') || s.includes('fail') ? 'cancelled'
      : s.includes('complete') || s.includes('deliver') ? 'completed'
        : s.includes('pick') || s.includes('dispatch') ? 'dispatched'
          : s.includes('ready') ? 'ready'
            : s.includes('ack') || s.includes('accept') ? 'accepted'
              : null;
  if (status && status !== order.status) {
    const now = nowIso();
    const t: OrderTimeline = {};
    if (status === 'cancelled') {
      const why = String(detail.reason ?? detail.event ?? '').toLowerCase();
      Object.assign(t, { cancelledAt: now, cancelledBy: why.includes('customer') || why.includes('eater') ? 'customer' : 'platform', cancelStage: order.timeline?.acceptedAt ? 'after_accept' : 'before_accept', cancelReason: String(detail.reason ?? detail.event ?? 'Cancelled on the platform') });
      await logActivity({ actor: CHANNEL_LABELS[channel], source: 'platform', kind: 'order', action: 'platform_cancel', status: 'info', channel, brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
        summary: `${CHANNEL_LABELS[channel]} cancelled #${order.displayId || order.externalOrderId.slice(0, 8)}${t.cancelReason ? ` — ${t.cancelReason}` : ''}` });
    }
    if (status === 'completed') t.completedAt = now;
    if (status === 'dispatched') t.dispatchedAt = now;
    if (status === 'ready') t.readyAt = now;
    if (status === 'accepted') t.acceptedAt = order.timeline?.acceptedAt ?? now;
    const updated = await patchTimeline(order, t, { status });
    order = (await settleInClover(updated)) ?? updated;
  }
  await repo.addEvent(order.id, 'platform_status', { state: platformState, ...detail, at: nowIso() });
  return order; // the order as stored after the update
}
