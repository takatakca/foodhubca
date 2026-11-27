// The order pipeline: every channel's webhook ends here.
//   receive → dedupe → map to store/brand → inject into Clover → print in kitchen → auto-accept → log
// Every step is timestamped on the order (timeline) for the status-transitions report and analytics.
import crypto from 'node:crypto';
import { logActivity, type Actor } from './activity';
import { getAdapter } from './adapters';
import { CHANNEL_LABELS, nowIso } from './config';
import { allCloverMerchants, cloverAutoPrintEnabled, cloverBaseUrl, cloverExpected, cloverInjectionEnabled, cloverToken, defaultCloverMerchant, injectOrder, type InjectResult } from './pos/clover';
import { CLOVER_REPRINT_KITCHEN_CHANGED, cloverKitchenChanged, cloverOrderTypeForOrder, cloverTotalGap, describeMappingWarnings, findCloverOrderByTitle, mapOrderLines, platformFoodCents, printKitchenTicket } from './pos/clover-order';
import { cloverRetryDelaysS, noteLastOrder, scheduleCloverRetry } from './order-retry';
import { settleInClover } from './clover-settle';
import { mevOnOrderChange } from './mev/hooks';
import { closeCancelledCloverOrder } from './pos/clover-books';
import { doorDashMerchantCancelEnabled } from './adapters/doordash';
import { relayActions, relayStatusApplies } from './adapters/relay';
import { reportSkipMissingItems } from './adapters/skip';
import { isViaClover } from './adapters/via-clover';
import { adjustDoorDashOrder, adjustmentFromMissing, doorDashAdjustEnabled } from './doordash/orders';
import { adjustUberOrderPrice, isUberMerchantDelivery, reportUberOutOfItems, setUberRestaurantDeliveryStatus, type UberAdjustReason } from './adapters/uber-api';
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
  /** Already stored, but its processing had stopped before Clover got it: finished by this delivery. */
  resumed?: boolean;
  pos?: { ok: boolean; posOrderId?: string; error?: string; skipped?: boolean };
  accept?: ChannelResult;
}

/** One line for the webhook inbox: what became of an incoming order. */
export function pipelineOutcomeText(out: PipelineOutcome): string {
  if (out.duplicate) return 'duplicate (already received)';
  if (out.order.status === 'cancelled' && out.order.posOrderId) return 'order cancelled (Clover receipt retained)';
  const clover = out.pos?.ok ? ', in Clover' : out.pos?.error ? `, Clover: ${out.pos.error}` : '';
  return `${out.resumed ? 'order resumed (its processing had stopped before Clover)' : 'order received'}${clover}`;
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
function actionsFor(order: { channel: ChannelKey; viaHub?: 'relay' | 'screen' }): Pick<ChannelAdapter, 'acceptOrder' | 'denyOrder' | 'markReady' | 'cancelOrder'> {
  if (order.viaHub === 'screen') return screenActions(order.channel);
  return order.viaHub === 'relay' ? relayActions : getAdapter(order.channel);
}

function isDirectSkipSource(order: Pick<NormalizedOrder, 'channel' | 'viaHub' | 'viaPos'>): boolean {
  return order.channel === 'skip' && !order.viaHub && !order.viaPos;
}

function isDirectSkipOrder(order: Pick<NormalizedOrder, 'channel' | 'viaHub' | 'viaPos'>): boolean {
  return isDirectSkipSource(order) && !isViaClover('skip');
}

function hasDirectSkipReceipt(order: StoredOrder): boolean {
  return isDirectSkipSource(order) && Boolean(order.posOrderId && order.timeline?.posMerchantId);
}

async function logSkipReceiptCancellation(order: StoredOrder): Promise<void> {
  await logActivity({ actor: CHANNEL_LABELS.skip, source: 'platform', kind: 'order', action: 'platform_cancel', status: 'info', channel: 'skip', brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
    summary: `Skip cancelled #${order.displayId || order.externalOrderId.slice(0, 8)} during Clover processing` });
}

async function checkRecordedSkipReceipt(order: StoredOrder): Promise<StoredOrder> {
  const { posOrderId, timeline } = order;
  const merchantId = timeline?.posMerchantId;
  if (!posOrderId || !merchantId) return order;
  const checked = await getRepo().applySkipLifecycle({ kind: 'check_receipt', externalOrderId: order.externalOrderId, orderId: order.id, posOrderId, merchantId });
  if (!checked.order) throw new Error('The stored Skip Clover receipt changed before confirmation.');
  if (checked.transitioned) await logSkipReceiptCancellation(checked.order);
  return checked.order;
}

async function stopCancelledSkipIntake(order: StoredOrder, transitioned?: true): Promise<PipelineOutcome> {
  if (transitioned) {
    const reason = order.timeline?.cancelReason;
    await logActivity({ actor: CHANNEL_LABELS.skip, source: 'platform', kind: 'order', action: 'platform_cancel', status: 'info', channel: 'skip', brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
      summary: `Skip cancelled #${order.displayId || order.externalOrderId.slice(0, 8)} before processing${reason ? ` — ${reason}` : ''}` });
  }
  const settled = order.posOrderId ? (await settleInClover(order)) ?? order : order;
  return { order: settled, duplicate: false, pos: { ok: false, skipped: true, error: 'Cancelled by the platform before processing.' } };
}

async function unmappedCloverHold(order: Pick<StoredOrder, 'channelStoreId' | 'locationCode'>, store: ChannelStore | null): Promise<string | null> {
  if (store) return null;
  const merchantCount = (await allCloverMerchants()).length;
  let reason: string;
  if (merchantCount > 1) {
    reason = 'there are several Clover registers';
  } else if (merchantCount === 1 && cloverInjectionEnabled() && !order.locationCode) {
    const kitchens = new Set((await getRepo().listStores()).map((mapping) => mapping.locationCode).filter(Boolean));
    if (kitchens.size < 2) return null;
    reason = 'its kitchen is unknown among several mapped kitchens';
  } else {
    return null;
  }
  return `Store ${order.channelStoreId || '(no id)'} is not mapped in Food Hub and ${reason} — map it under Stores → Mapping, then use "Send to Clover".`;
}

/**
 * Orders entered by hand from a platform screen: the platform knows nothing of Food Hub for them, so every action stays
 * in Food Hub and Clover. Accept / ready / cancel are done by the staff inside the platform's own screen.
 */
export function screenActions(channel: ChannelKey): Pick<ChannelAdapter, 'acceptOrder' | 'denyOrder' | 'markReady' | 'cancelOrder'> {
  const label = CHANNEL_LABELS[channel];
  const done = (fr: string, en: string): ChannelResult => ({ channel, ok: true, status: 'skipped', message: `${en} · ${fr}` });
  return {
    acceptOrder: async () => done(`Entrée à la main depuis l’écran ${label} : rien n’est envoyé à ${label}.`, `Entered by hand from the ${label} screen: nothing is sent to ${label}.`),
    markReady: async () => done(`Marquée prête dans Food Hub ; faites-le aussi dans l’écran ${label}.`, `Marked ready in Food Hub; do it in the ${label} screen too.`),
    denyOrder: async () => done(`Annulée dans Food Hub ; annulez-la aussi dans l’écran ${label}.`, `Cancelled in Food Hub; cancel it in the ${label} screen too.`),
    cancelOrder: async () => done(`Annulée dans Food Hub ; annulez-la aussi dans l’écran ${label}.`, `Cancelled in Food Hub; cancel it in the ${label} screen too.`),
  };
}

/**
 * opts.holdClover: the source knows the order must not reach any register yet (a Too Good To Go e-mail whose store
 * name is not mapped): it is stored and shown on the Command Center, never sent to Clover, never printed, never
 * accepted automatically — the reason is kept as its POS error until the store is mapped (or a person sends it).
 */
export async function processIncomingOrder(n: NormalizedOrder, opts: { holdClover?: string; retrying?: boolean } = {}): Promise<PipelineOutcome> {
  const repo = getRepo();
  const store = n.channelStoreId ? await repo.findStore(n.channel, n.channelStoreId) : null;
  const brandName = store?.brandName || n.brandName;

  // Link every line and option to the Clover inventory through the brand's master menu (or the menu it shares):
  // by id, then by name, else a free-text line with a visible warning (pos/clover-order.ts). Clover item ids belong to
  // one merchant: a menu imported from another merchant than this store's is sent as free text (Clover would refuse
  // foreign ids). Orders Clover itself received ("via Clover") already carry their Clover ids.
  if (!n.viaPos && cloverExpected()) {
    const menu = brandName ? await getBrandMenu(brandName, undefined, { allDishes: true }) : null;
    const targetMerchant = store?.cloverMerchantId || process.env.CLOVER_MERCHANT_ID;
    const foreign = Boolean(menu?.posMerchantId && targetMerchant && menu.posMerchantId !== targetMerchant);
    const mapped = mapOrderLines(n.lines, menu, { foreign });
    n.lines = mapped.lines;
    n.mappingWarnings = mapped.warnings.length ? mapped.warnings : undefined;
  }

  const directSkip = isDirectSkipSource(n);
  const mappedOrder = { ...n, brandName, locationCode: store?.locationCode };
  // The signed cancellation may be in the durable inbox even while its own worker is stopped.
  const skipIntake = directSkip ? await repo.applySkipLifecycle({ kind: 'intake', order: mappedOrder }) : null;
  if (skipIntake?.outcome === 'conflicting_store') throw new Error('Skip order reference is already recorded for a different store.');
  const { order, isNew } = skipIntake ?? await repo.insertOrderIfNew(mappedOrder);
  if (!order) throw new Error('Skip intake returned no stored order.');
  const cancelledAtIntake = skipIntake?.outcome === 'cancelled';
  if (!isNew && !cancelledAtIntake) {
    // A later delivery can finish an interrupted send for this direct store or for the original non-Skip path.
    const sameStore = !order.channelStoreId?.trim() || !n.channelStoreId?.trim() || order.channelStoreId === n.channelStoreId;
    const sameSource = !directSkip || (isDirectSkipSource(order) && sameStore);
    if (sameSource && neverSentToClover(order)) return resumeUnsentOrder(order);
    if (directSkip && sameSource && opts.retrying && hasDirectSkipReceipt(order)) {
      // A receipt already exists. Never create or print it again when a later confirmation check needs a retry.
      if (order.status === 'cancelled' || order.status === 'failed') {
        return { order: (await settleInClover(order)) ?? order, duplicate: false };
      }
      if (order.status === 'new' && store?.autoAccept && order.locationCode && !cloverKitchenChanged(order, store)) {
        const resumed = await autoAcceptAfterClover(order, order.posOrderId);
        return { ...resumed, duplicate: false, resumed: true, pos: { ok: true, posOrderId: order.posOrderId } };
      }
    }
    // Keep this receipt retryable until an interrupted Skip intake is eligible for recovery.
    if (directSkip && sameSource && opts.retrying && waitingForFirstCloverSend(order)) {
      throw new Error('Skip order is waiting for its previous Clover processing window.');
    }
    await repo.addEvent(order.id, 'duplicate_delivery', { note: 'Webhook delivered again; ignored.' });
    return { order, duplicate: true };
  }
  if (isNew) {
    await noteLastOrder(n.channel, order.createdAt);
    await repo.addEvent(order.id, 'received', { channel: n.channel, marketplace: n.marketplace, total: n.total, lines: n.lines.length });
    if (!store) {
      await repo.addEvent(order.id, 'unmapped_store', { channelStoreId: n.channelStoreId, hint: 'Map this store in Food Hub → Stores so orders route to the right brand, location and Clover merchant.' });
    }
    if (n.mappingWarnings?.length) {
      const said = describeMappingWarnings(n.mappingWarnings);
      await repo.addEvent(order.id, 'mapping_warning', { message: said.map((w) => w.en).join(' '), messageFr: said.map((w) => w.fr).join(' '), warnings: n.mappingWarnings });
    }
  }
  if (cancelledAtIntake) return stopCancelledSkipIntake(order, skipIntake?.transitioned);

  // A cancellation that arrived before the order was stored: do not cook it, do not put it in Clover, do not accept it.
  const pending = await readPending(n.channel, n.externalOrderId);
  const pendingCancellation = pending?.status && /cancel|fail/i.test(pending.status.platformState);
  if (pending && (!directSkip || !pendingCancellation)) await repo.setKv(pendingKey(n.channel, n.externalOrderId), { ...pending, consumedAt: nowIso() }).catch(() => undefined);
  if (!directSkip && pending?.status && pendingCancellation) {
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
  // One register may serve several kitchens. Hold an order whose route cannot be determined until it has a mapping.
  const routingHold = opts.holdClover ? null : await unmappedCloverHold(current, store);
  if (directSkip) {
    // A signed cancellation can reach the inbox during local prep and mapping, before its worker runs.
    const check = await repo.applySkipLifecycle({ kind: 'check_intake', externalOrderId: order.externalOrderId });
    if (!check.order || check.order.id !== order.id) throw new Error('Skip order changed before Clover processing.');
    if (check.order.status === 'cancelled') return stopCancelledSkipIntake(check.order, check.transitioned);
    if (check.outcome !== 'received') return { order: check.order, duplicate: true };
    current = check.order;
  }
  const pos: InjectResult = opts.holdClover
    ? { ok: false, skipped: true, error: opts.holdClover }
    : routingHold
    ? { ok: false, skipped: false, error: routingHold }
    : await sendToClover(current, store);
  if (pos.ok) {
    current = await recordCloverSuccess(current, store, pos);
    if (directSkip && (current.status === 'cancelled' || current.status === 'failed')) {
      return { order: current, duplicate: false, pos: { ok: true, posOrderId: current.posOrderId } };
    }
  } else {
    current = (await repo.updateOrder(order.id, { posError: pos.error })) ?? current;
    await repo.addEvent(order.id, pos.skipped ? 'pos_skipped' : 'pos_failed', { error: pos.error, ...(pos.uncertain ? { uncertain: true } : {}) });
  }

  // 3) Auto-accept — never accept an order the kitchen did not receive, nor one from a store nobody mapped
  // (wrong brand, wrong location or wrong kitchen are all possible): a person decides.
  if (!store) await repo.addEvent(order.id, 'needs_attention', { reason: `Not accepted automatically: store ${n.channelStoreId || '(no id)'} is not mapped in Food Hub. Check the brand and kitchen, then accept or reject.` });
  else if (opts.holdClover) await repo.addEvent(order.id, 'needs_attention', { reason: `Not sent to Clover, not accepted automatically: ${opts.holdClover}` });
  // JET's success means it can stop its tablet backup because the POS has the order.
  const skipNeedsReceipt = store?.autoAccept && isDirectSkipOrder(n) && !opts.holdClover;
  const posBlocksAccept = !pos.ok && (!pos.skipped || skipNeedsReceipt);
  let accept: ChannelResult | undefined;
  // Entered by hand from a platform screen: already accepted on that screen, so it is accepted (and paid in Clover) as
  // soon as Clover has it — never before (posBlocksAccept), and only for a mapped store.
  const acceptNow = Boolean(store) && (store?.autoAccept || n.viaHub === 'screen');
  if (acceptNow && !posBlocksAccept && !opts.holdClover) {
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
        if (!(await cancelledMeanwhile())) current = (await repo.updateOrder(order.id, { status: 'failed', channelError: 'Food Hub could not confirm the Clover order — Skip acknowledged the tablet fallback request.' })) ?? current;
        await logActivity({ actor: 'TAKATAK automation', source: 'automation', kind: 'order', action: 'skip_tablet_fallback', status: 'info', channel: 'skip', brandName, locationCode: store?.locationCode, orderId: order.id,
          summary: `${tag}: Skip acknowledged the tablet fallback request (Food Hub could not confirm the Clover order)` });
      } else {
        // JET did not get sent-to-pos-failed (live switch off, key missing, HTTP error): never claim it did.
        // The order stays "new" with Accept / Send to Skip tablet available so the operator can retry.
        await repo.addEvent(order.id, 'routed_to_skip_tablet_failed', { status: fallback.status, message: fallback.message });
        current = (await repo.updateOrder(order.id, { channelError: `Skip tablet hand-off not sent: ${fallback.message}` })) ?? current;
        await logActivity({ actor: 'TAKATAK automation', source: 'automation', kind: 'order', action: 'skip_tablet_fallback', status: 'failed', channel: 'skip', brandName, locationCode: store?.locationCode, orderId: order.id,
          summary: `${tag}: Clover did not receive it and the Skip tablet hand-off was NOT sent (${fallback.message}) — retry "Send to Skip tablet" or send it to Clover` });
      }
    } else if (!routingHold && (await scheduleCloverRetry(current, pos))) {
      current = (await repo.getOrder(order.id)) ?? current;
      await repo.addEvent(order.id, 'needs_attention', { reason: `Clover injection failed — Food Hub tries again by itself (${cloverRetryDelaysS().map((s) => `${s} s`).join(', then ')}) before waking a manager. Nothing is accepted on the platform until Clover has the order.` });
    } else {
      await repo.addEvent(order.id, 'needs_attention', { reason: 'Clover injection failed — use "Send to Clover" (or "Accept without Clover" after entering it by hand).' });
    }
  }

  // Platform events that arrived before the order (courier assigned, non-cancel status): apply them now.
  if (pending?.status && (!directSkip || !pendingCancellation)) await applyExternalStatus(n.channel, n.externalOrderId, pending.status.platformState, pending.status.detail).catch(() => null);
  for (const c of pending?.courier ?? []) await applyCourierUpdate(n.channel, n.externalOrderId, c.update, c.source).catch(() => null);
  if (pending) current = (await repo.getOrder(order.id)) ?? current;

  return { order: current, duplicate: false, pos: pos.ok ? { ok: true, posOrderId: pos.posOrderId } : { ok: false, error: pos.error, skipped: pos.skipped }, accept };
}

/** A first processing still under way is given this long before a later delivery takes the order over. */
export const RESUME_AFTER_MS = 90_000;

function waitingForFirstCloverSend(order: StoredOrder): boolean {
  if (order.status !== 'new' || order.posOrderId || order.posError || order.viaPos || !cloverExpected()) return false;
  const retry = order.timeline?.posRetry;
  if (!retry) return true;
  // A direct Skip resume can stop between claiming it and starting Clover. Other retry schedules have their own runner.
  return isDirectSkipSource(order) && retry.attempts === 0 && retry.nextAt === null && retry.uncertain === true
    && Boolean(retry.claim && retry.claimedAt) && !retry.lastError && !retry.gaveUpAt && !retry.doneAt;
}

/** A stalled first send whose receipt is old enough to resume. A direct Skip resume lease must also have expired. */
export function neverSentToClover(order: StoredOrder, now = Date.now()): boolean {
  const waitedLongEnough = now - Date.parse(order.createdAt) >= RESUME_AFTER_MS;
  if (!waitedLongEnough || !waitingForFirstCloverSend(order)) return false;
  const claimedAt = order.timeline?.posRetry?.claimedAt;
  return !claimedAt || now - Date.parse(claimedAt) >= RESUME_AFTER_MS;
}

/**
 * Finishes an order whose processing stopped after it was stored: Clover is checked first (the stop may have come
 * after Clover created it — never two tickets), then sent, printed and auto-accepted as on arrival. Claimed on the
 * order first, so two deliveries arriving together resume it once.
 */
async function resumeUnsentOrder(order: StoredOrder): Promise<PipelineOutcome> {
  const repo = getRepo();
  const claim = crypto.randomUUID();
  await repo.patchOrder(order.id, { posRetry: { attempts: 0, nextAt: null, uncertain: true, claim, claimedAt: nowIso() } }, {}, (fresh) => neverSentToClover(fresh));
  let current = await repo.getOrder(order.id);
  if (!current || current.timeline?.posRetry?.claim !== claim || current.status !== 'new' || current.posOrderId) {
    await repo.addEvent(order.id, 'duplicate_delivery', { note: 'Webhook delivered again while the order was being finished; ignored.' });
    return { order: current ?? order, duplicate: true };
  }
  if (!current.timeline?.readyTarget) {
    const prep = await prepFor(current.locationCode);
    const scheduled = scheduledInfo(current, prep.minutes);
    current = await patchTimeline(current, { readyTarget: scheduled?.scheduledFor ?? new Date(Date.now() + prep.minutes * 60_000).toISOString(), ...(scheduled ?? {}) });
  }
  if (isDirectSkipSource(current)) {
    const check = await repo.applySkipLifecycle({ kind: 'check_intake', externalOrderId: order.externalOrderId }).catch(async (error: unknown) => {
      // No Clover request has started. Give back only our claim so the same durable receipt can retry.
      await repo.patchOrder(order.id, { posRetry: undefined }, {}, (fresh) => fresh.status === 'new' && !fresh.posOrderId && fresh.timeline?.posRetry?.claim === claim).catch(() => undefined);
      throw error;
    });
    if (check.order?.status === 'cancelled') return stopCancelledSkipIntake(check.order, check.transitioned);
    if (check.outcome !== 'received' || !check.order || check.order.id !== order.id || check.order.timeline?.posRetry?.claim !== claim) {
      return { order: check.order ?? current, duplicate: true };
    }
    current = check.order;
  }
  await repo.addEvent(order.id, 'resumed', { message: 'Stored earlier, but processing stopped before Clover got it (server restart) — finished now; Clover is checked first so it is never sent twice.' });
  const sent = await resendToClover(current, { by: 'Food Hub (resumed)' });
  current = sent.order;
  let accept: ChannelResult | undefined;
  if (sent.pos.ok) {
    // As on arrival; an order that arrived from a store nobody had mapped keeps waiting for a person.
    if (sent.store?.autoAccept && order.locationCode && current.status === 'new') ({ order: current, accept } = await autoAcceptAfterClover(current, sent.pos.posOrderId));
  } else if (!sent.mappingChanged && !sent.pos.skipped) {
    const retrying = await scheduleCloverRetry(current, sent.pos);
    await repo.addEvent(order.id, 'needs_attention', { reason: retrying
      ? `Clover injection failed — Food Hub tries again by itself (${cloverRetryDelaysS().map((s) => `${s} s`).join(', then ')}) before waking a manager. Nothing is accepted on the platform until Clover has the order.`
      : 'Clover injection failed — use "Send to Clover" (or "Accept without Clover" after entering it by hand).' });
  }
  const tag = `${CHANNEL_LABELS[order.channel]} #${order.displayId || order.externalOrderId.slice(0, 8)}`;
  await logActivity({ actor: 'Food Hub', source: 'automation', kind: 'order', action: 'order_resumed', status: sent.pos.ok ? 'success' : 'failed', channel: order.channel, brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
    summary: `${tag}: processing had stopped before Clover got it — ${sent.pos.ok ? `now in Clover (${sent.pos.posOrderId})${sent.pos.adopted ? ', Clover already had it' : ''}` : `Clover: ${sent.pos.error}`}` });
  return { order: (await repo.getOrder(order.id)) ?? current, duplicate: false, resumed: true, pos: sent.pos.ok ? { ok: true, posOrderId: sent.pos.posOrderId } : { ok: false, error: sent.pos.error, skipped: sent.pos.skipped }, accept };
}

/** Puts an order into Clover (the store's merchant, the right order type); its lines are already linked to the inventory. */
export async function sendToClover(order: StoredOrder, store: ChannelStore | null): Promise<InjectResult> {
  const mid = store?.cloverMerchantId || (await defaultCloverMerchant());
  const token = mid ? await cloverToken(mid).catch(() => null) : null;
  const orderTypeId = await cloverOrderTypeForOrder(mid, order, { token, base: cloverBaseUrl() }).catch(() => null);
  return injectOrder(order, mid, { orderTypeId });
}

/**
 * Clover confirmed the order: keep its id, say how the lines were linked, flag a Clover total that differs from what
 * the platform charged (usually a Clover tax setting — flagged, never changed), then print the kitchen ticket.
 */
export async function recordCloverSuccess(order: StoredOrder, store: ChannelStore | null, pos: Extract<InjectResult, { ok: true }>, extra: Record<string, unknown> = {}): Promise<StoredOrder> {
  const repo = getRepo();
  const evidence = {
    ...extra, posOrderId: pos.posOrderId,
    ...(pos.lineItems !== undefined ? { lineItems: pos.lineItems } : {}),
    ...(pos.freeLines ? { freeLines: pos.freeLines } : {}),
    ...(pos.adopted ? { message: 'Clover already had this order (its earlier answer was lost) — linked to it, nothing sent twice.' } : {}),
  };
  const directSkip = isDirectSkipSource(order);
  let current: StoredOrder;
  if (directSkip) {
    if (!pos.merchantId) throw new Error('The confirmed Skip Clover receipt needs its originating register.');
    const receipt = await repo.applySkipLifecycle({ kind: 'record_receipt', externalOrderId: order.externalOrderId, orderId: order.id, posOrderId: pos.posOrderId, merchantId: pos.merchantId, adopted: Boolean(pos.adopted), evidence });
    if (!receipt.order) throw new Error('The received Skip Clover receipt conflicts with the stored order.');
    current = receipt.order;
    if (receipt.transitioned) await logSkipReceiptCancellation(current);
    if (current.status === 'cancelled' || current.status === 'failed') return (await settleInClover(current)) ?? current;
    if (!receipt.recorded || current.timeline?.printedAt) return current;
  } else {
    current = (await repo.updateOrder(order.id, { posOrderId: pos.posOrderId, posError: undefined })) ?? order;
    if (current.timeline?.posRetry) current = await patchTimeline(current, { posRetry: { ...current.timeline.posRetry, nextAt: null, doneAt: nowIso() } });
    await repo.addEvent(order.id, pos.adopted ? 'pos_adopted' : 'pos_injected', evidence);
  }
  if (pos.totalCents !== undefined) {
    const gap = cloverTotalGap(current, pos.totalCents, pos.lineItems ?? current.lines.length);
    if (gap.flagged) {
      const msg = `Clover total ${(pos.totalCents / 100).toFixed(2)} $ vs ${CHANNEL_LABELS[current.channel]} ${(platformFoodCents(current) / 100).toFixed(2)} $ (${gap.gapCents > 0 ? '+' : ''}${(gap.gapCents / 100).toFixed(2)} $). Clover computes its own tax from each item's tax rates — check Clover → Setup → Taxes (e.g. a stray default "Sales Tax"). Food Hub records the platform amount and changes nothing in Clover.`;
      await repo.addEvent(order.id, 'pos_total_mismatch', { message: msg, cloverTotalCents: pos.totalCents, gapCents: gap.gapCents });
      await logActivity({ actor: 'Food Hub', source: 'automation', kind: 'order', action: 'clover_total_mismatch', status: 'info', channel: current.channel, brandName: current.brandName, locationCode: current.locationCode, orderId: current.id,
        summary: `${CHANNEL_LABELS[current.channel]} #${current.displayId || current.externalOrderId.slice(0, 8)}: ${msg}` });
    }
  }
  return autoPrint(current, directSkip ? pos.merchantId : store?.cloverMerchantId);
}

/**
 * Accept on the platform once Clover has the order, or when Clover is optional for this deployment. Direct Skip
 * requires a receipt. A cancellation that lands meanwhile always wins, and the Clover copy is removed.
 */
export async function autoAcceptAfterClover(order: StoredOrder, posOrderId?: string): Promise<{ order: StoredOrder; accept?: ChannelResult }> {
  const repo = getRepo();
  const recordedSkip = hasDirectSkipReceipt(order);
  let current = recordedSkip ? await checkRecordedSkipReceipt(order) : ((await repo.getOrder(order.id)) ?? order);
  if (current.status === 'cancelled' || (recordedSkip && current.status === 'failed')) {
    const reason = current.status === 'cancelled'
      ? 'Cancelled by the platform while it was being put in Clover — nothing sent to the platform; the Clover copy is removed.'
      : 'Skip moved this order to its tablet before confirmation; its Clover receipt is kept for settlement.';
    await repo.addEvent(order.id, 'accept_skipped', { reason });
    return { order: (await settleInClover(current)) ?? current };
  }
  if (recordedSkip && current.status !== 'new') return { order: current };
  if (isDirectSkipOrder(order) && !posOrderId?.trim() && !current.posOrderId?.trim()) {
    return { order: current, accept: { channel: 'skip', status: 'blocked', ok: false, message: 'Skip requires a Clover order ID for automatic confirmation.' } };
  }
  const accept = await actionsFor(current).acceptOrder(current, recordedSkip ? current.posOrderId : posOrderId);
  if (accept.ok) {
    const latest = recordedSkip ? await checkRecordedSkipReceipt(current) : ((await repo.getOrder(order.id)) ?? current);
    const timeline = { acceptedAt: nowIso(), acceptedBy: 'auto' };
    const fields = { status: 'accepted' as const, channelError: undefined };
    const accepted = latest.status === 'cancelled' ? null : recordedSkip
      ? await repo.patchOrder(latest.id, timeline, fields, (fresh) => fresh.status === 'new' && fresh.posOrderId === latest.posOrderId && fresh.timeline?.posMerchantId === latest.timeline?.posMerchantId)
      : await patchTimeline(latest, timeline, fields);
    if (!accepted) {
      current = (await repo.getOrder(order.id)) ?? latest;
      if (current.status === 'cancelled' || (recordedSkip && current.status === 'failed')) {
        const reason = current.status === 'cancelled'
          ? 'Accepted on the platform, but the platform cancelled the order meanwhile — check the platform; the Clover copy is removed.'
          : 'The platform confirmed the order while tablet handoff was being recorded. Check the provider; the Clover receipt is kept for settlement.';
        await repo.addEvent(order.id, 'needs_attention', { reason });
        current = (await settleInClover(current)) ?? current;
      }
      return { order: current, accept };
    }
    current = accepted;
    await repo.addEvent(order.id, 'accepted', { auto: true, response: summarize(accept) });
    // Accepted = sold: follow the existing fiscal and screen-payment policy.
    if (current.viaHub === 'screen') current = (await settleInClover(current)) ?? current;
    else await mevOnOrderChange(current);
  } else {
    current = recordedSkip ? (await repo.patchOrder(order.id, {}, { channelError: accept.message }, (fresh) => fresh.status === 'new')) ?? (await repo.getOrder(order.id)) ?? current
      : (await repo.updateOrder(order.id, { channelError: accept.message })) ?? current;
    await repo.addEvent(order.id, 'accept_failed', { auto: true, status: accept.status, message: accept.message });
  }
  return { order: current, accept };
}

/** The last Clover answer may have been lost after Clover created the order (time-out, dropped connection, 5xx). */
function maybeInClover(order: StoredOrder): boolean {
  return Boolean(order.timeline?.posRetry?.uncertain) || /network error|timed out|aborted|HTTP 5\d\d|did not include an order id/i.test(order.posError ?? '');
}

type CloverResendOutcome = { order: StoredOrder; pos: InjectResult; store: ChannelStore | null; mappingChanged?: true };

/**
 * Sends an order Clover does not have yet — "Send to Clover" and the automatic retries:
 *  1. re-links its lines and brand (the store may have been mapped since it arrived);
 *  2. when the last answer was lost, looks in Clover first and links the order Clover already has (no second ticket);
 *  3. injects, then reads the order again: a copy someone else put in Clover meanwhile wins (ours is removed), and an
 *     order the platform cancelled meanwhile gets no kitchen ticket (removed from Clover); otherwise records and prints.
 * An order keeps the kitchen saved at arrival when its mapping moves. An unmapped store waits until its Clover
 * register and kitchen can be determined. A database claim limits sends to one at a time per order, across servers.
 * Accepting is the caller's decision.
 */
export async function resendToClover(order: StoredOrder, opts: { manual?: boolean; by?: string; attempt?: number } = {}): Promise<CloverResendOutcome> {
  if (!(await claimCloverSending(order.id))) return { order, pos: { ok: false, skipped: true, error: 'Food Hub is already sending this order to Clover — check again in a few seconds.' }, store: null };
  try {
    const current = (await getRepo().getOrder(order.id)) ?? order;
    return await resendNow(current, opts);
  } finally {
    await releaseCloverSending(order.id);
  }
}

function cloverSending(): Set<string> {
  const g = globalThis as unknown as { __foodhubCloverSending?: Set<string> };
  return (g.__foodhubCloverSending ??= new Set<string>());
}

/** The cross-server claim on "this order is being sent to Clover" (fh_kv): one send per order across every server. */
export const cloverSendingClaimKey = (orderId: string) => `clover_sending:${orderId}`;

/** A send claim older than this belongs to a server that stopped mid-send (a Clover order POST takes seconds):
 * the next sender takes it over — the same stuck-claim window as the metered phone minutes (clover-phone-minutes.ts). */
const CLOVER_SEND_CLAIM_STUCK_MS = 10 * 60_000;

async function claimCloverSending(orderId: string): Promise<boolean> {
  if (cloverSending().has(orderId)) return false;
  const repo = getRepo();
  const key = cloverSendingClaimKey(orderId);
  // The claim store itself failing must not stop sends: fall back to this process's guard alone (as before this fix).
  if (await repo.claimKv(key, { at: nowIso() }).catch(() => true)) { cloverSending().add(orderId); return true; }
  const held = await repo.getKv<{ at?: string }>(key).catch(() => null);
  const at = held?.at ? Date.parse(held.at) : NaN;
  if (Number.isFinite(at) && Date.now() - at > CLOVER_SEND_CLAIM_STUCK_MS) {
    await repo.releaseKv(key).catch(() => undefined);
    if (await repo.claimKv(key, { at: nowIso() }).catch(() => true)) { cloverSending().add(orderId); return true; }
  }
  return false;
}

async function releaseCloverSending(orderId: string): Promise<void> {
  cloverSending().delete(orderId);
  await getRepo().releaseKv(cloverSendingClaimKey(orderId)).catch(() => undefined);
}

/** True while any server is sending that order to Clover (the retry runner leaves it alone). A claim left by a
 * server that stopped mid-send stops counting once it is older than the stuck-claim window. */
export async function isSendingToClover(orderId: string): Promise<boolean> {
  if (cloverSending().has(orderId)) return true;
  const held = await getRepo().getKv<{ at?: string }>(cloverSendingClaimKey(orderId)).catch(() => null);
  if (!held) return false;
  const at = held.at ? Date.parse(held.at) : NaN;
  return !Number.isFinite(at) || Date.now() - at <= CLOVER_SEND_CLAIM_STUCK_MS;
}

async function resendNow(order: StoredOrder, opts: { manual?: boolean; by?: string; attempt?: number }): Promise<CloverResendOutcome> {
  const repo = getRepo();
  const store = await repo.findStore(order.channel, order.channelStoreId);
  const tag = { ...(opts.manual ? { manual: true } : {}), ...(opts.by ? { by: opts.by } : {}), ...(opts.attempt ? { attempt: opts.attempt } : {}) };
  if (cloverKitchenChanged(order, store)) {
    const error = 'This store is now mapped to a different kitchen. Review the order and store mapping before using "Send to Clover".';
    const previous = order.timeline?.posRetry;
    // Keep an uncertain prior attempt so recovery can look for the original Clover order after the mapping is repaired.
    const posRetry = { ...previous, attempts: previous?.attempts ?? 0, nextAt: null, lastError: error, uncertain: maybeInClover(order) };
    const held = await patchTimeline(order, { posRetry }, { posError: error });
    await repo.addEvent(order.id, 'needs_attention', { reason: error, ...tag });
    return { order: held, pos: { ok: false, error }, store, mappingChanged: true };
  }
  let current = order;
  const patch: Partial<StoredOrder> = {};
  if (store && !order.locationCode) Object.assign(patch, { locationCode: store.locationCode, brandName: store.brandName });
  const brandName = store?.brandName || order.brandName;
  if (!order.viaPos && cloverExpected() && order.lines.some((l) => !l.posItemRef)) {
    const menu = brandName ? await getBrandMenu(brandName, undefined, { allDishes: true }) : null;
    const target = store?.cloverMerchantId || process.env.CLOVER_MERCHANT_ID;
    const mapped = mapOrderLines(order.lines, menu, { foreign: Boolean(menu?.posMerchantId && target && menu.posMerchantId !== target) });
    if (mapped.lines.some((l, i) => l.posItemRef !== order.lines[i].posItemRef)) Object.assign(patch, { lines: mapped.lines, mappingWarnings: mapped.warnings.length ? mapped.warnings : undefined });
  }
  if (Object.keys(patch).length) current = (await repo.updateOrder(order.id, patch)) ?? { ...current, ...patch };

  let pos: InjectResult | null = null;
  const routingHold = await unmappedCloverHold(current, store);
  if (routingHold) {
    pos = { ok: false, skipped: false, error: routingHold, uncertain: maybeInClover(current) };
  } else if (maybeInClover(current)) {
    const mid = store?.cloverMerchantId || (await defaultCloverMerchant());
    const token = mid ? await cloverToken(mid).catch(() => null) : null;
    const hit = mid && token ? await findCloverOrderByTitle(mid, token, cloverBaseUrl(), current, Date.parse(current.createdAt) - 5 * 60_000).catch(() => null) : null;
    if (hit && mid) pos = { ok: true, posOrderId: hit.id, merchantId: mid, adopted: true, ...(hit.totalCents !== undefined ? { totalCents: hit.totalCents } : {}) };
  }
  pos ??= await sendToClover(current, store);
  if (pos.ok) {
    // Read again: another server or a person may have put it in Clover meanwhile, or the platform cancelled it.
    const latest = (await repo.getOrder(order.id)) ?? current;
    const sameReceipt = latest.posOrderId === pos.posOrderId
      && (!latest.timeline?.posMerchantId || latest.timeline.posMerchantId === pos.merchantId);
    if (isDirectSkipSource(latest) && (!latest.posOrderId || sameReceipt)) {
      return { order: await recordCloverSuccess(latest, store, pos, tag), pos, store };
    }
    if (latest.posOrderId) {
      if (!sameReceipt && !pos.adopted) {
        // Theirs is kept; this second copy is removed so Clover never has the order twice.
        const r = await closeCancelledCloverOrder({ ...latest, posOrderId: pos.posOrderId }, pos.merchantId ?? store?.cloverMerchantId);
        await repo.addEvent(order.id, 'pos_duplicate', { posOrderId: pos.posOrderId, kept: latest.posOrderId, ...tag,
          message: r.ok ? `Reached Clover just after another send (${latest.posOrderId}) — this extra copy was removed.` : `Reached Clover just after another send (${latest.posOrderId}) — remove the extra copy ${pos.posOrderId} in Clover: ${r.message}` });
        if (!r.ok) {
          await logActivity({ actor: 'Food Hub', source: 'automation', kind: 'order', action: 'clover_duplicate', status: 'failed', channel: latest.channel, brandName: latest.brandName, locationCode: latest.locationCode, orderId: latest.id,
            summary: `${CHANNEL_LABELS[latest.channel]} #${latest.displayId || latest.externalOrderId.slice(0, 8)} is in Clover twice (${latest.posOrderId}, ${pos.posOrderId}) — delete ${pos.posOrderId} in the Clover Orders app: ${r.message}` });
        }
      }
      return { order: latest, pos: { ok: true, posOrderId: latest.posOrderId, merchantId: latest.timeline?.posMerchantId, adopted: true }, store };
    }
    if (latest.status === 'cancelled') {
      // No kitchen ticket for a cancelled order: keep the Clover id for the record, then remove it from Clover.
      const kept = (await repo.updateOrder(order.id, { posOrderId: pos.posOrderId, posError: undefined })) ?? { ...latest, posOrderId: pos.posOrderId };
      await repo.addEvent(order.id, pos.adopted ? 'pos_adopted' : 'pos_injected', { posOrderId: pos.posOrderId, ...tag, note: 'The platform cancelled the order meanwhile — no kitchen ticket; removed from Clover.' });
      return { order: (await settleInClover(kept)) ?? kept, pos, store };
    }
    return { order: await recordCloverSuccess(latest, store, pos, tag), pos, store };
  }
  const priorRetry = current.timeline?.posRetry;
  if (routingHold && pos.uncertain && !priorRetry?.uncertain) {
    // Keep an earlier lost response trace after the routing error replaces the old POS error.
    const posRetry = { ...priorRetry, attempts: priorRetry?.attempts ?? 0, nextAt: priorRetry?.nextAt ?? null, lastError: pos.error, uncertain: true };
    current = await patchTimeline(current, { posRetry }, { posError: pos.error });
  } else {
    current = (await repo.updateOrder(order.id, { posError: pos.error })) ?? current;
  }
  await repo.addEvent(order.id, 'pos_failed', { error: pos.error, ...tag, ...(pos.uncertain ? { uncertain: true } : {}) });
  return { order: current, pos, store };
}

function summarize(r: ChannelResult) {
  return { status: r.status, httpStatus: r.httpStatus, message: r.message };
}

/** 'accept_no_pos' = explicit "Accept without Clover (entered by hand)" override when Clover did not receive the order. */
export type OrderAction = 'accept' | 'accept_no_pos' | 'deny' | 'ready' | 'dispatch' | 'complete' | 'cancel' | 'retry_pos' | 'print' | 'report_missing' | 'adjust_price' | 'ack' | 'delay';
export const ORDER_ACTIONS: OrderAction[] = ['accept', 'accept_no_pos', 'deny', 'ready', 'dispatch', 'complete', 'cancel', 'retry_pos', 'print', 'report_missing', 'adjust_price', 'ack', 'delay'];
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
  // An order entered by hand from a screen is cancelled in Food Hub and Clover only (the staff cancels it on the platform screen).
  const canCancel = order.viaHub === 'screen' || order.channel === 'uber_eats' || (order.channel === 'doordash' && !order.viaHub && doorDashMerchantCancelEnabled());
  if (order.status === 'accepted') a.push('ready', ...(canCancel ? (['cancel'] as const) : []));
  if (order.status === 'ready') a.push('dispatch', 'complete', ...(canCancel ? (['cancel'] as const) : []));
  if (order.status === 'dispatched') a.push('complete');
  // "Send to Clover" only while the order is still ours to make — never for orders on the Skip tablet, cancelled or closed.
  if (!order.posOrderId && ['new', 'accepted', 'ready', 'dispatched'].includes(order.status)) a.push('retry_pos');
  if (order.posOrderId) a.push('print');
  // SkipTheDishes (JET Connect) lets the store report an out-of-stock item after accepting; Skip adjusts the customer's bill.
  // (Not for Skip orders that came through the relay: Skip's API does not know them.)
  if (order.channel === 'skip' && !order.viaHub && ['accepted', 'ready'].includes(order.status)) a.push('report_missing');
  // DoorDash: the order adjustment endpoint (remove / reduce an item after confirming), once DoorDash allowlisted it.
  if (order.channel === 'doordash' && !order.viaHub && doorDashAdjustEnabled() && ['accepted', 'ready'].includes(order.status)) a.push('report_missing');
  // Uber Eats (direct): an item out of stock after accepting goes to the customer (Resolve Fulfillment Issues), and a
  // price change (an add-on the customer asked for, a removed item) is confirmed by the customer (Adjust Order Price).
  if (order.channel === 'uber_eats' && !order.viaHub && order.status === 'accepted') a.push('report_missing', 'adjust_price');
  return a;
}

const ACTION_LABEL: Record<OrderAction, string> = {
  accept: 'Accepted', accept_no_pos: 'Accepted without Clover (entered by hand)', deny: 'Rejected', ready: 'Marked ready', dispatch: 'Handed to courier', complete: 'Completed', cancel: 'Cancelled', retry_pos: 'Sent to Clover', print: 'Printed in kitchen',
  report_missing: 'Reported missing items', adjust_price: 'Price change sent', ack: 'Seen', delay: 'More time',
};

export async function runOrderAction(orderId: string, action: OrderAction, opts: { reason?: string; reasonCode?: CancelReason; actor?: Actor; missing?: Array<{ line: number; quantity: number }>; prepMinutes?: number; delayMinutes?: number; approvedBy?: string; adjust?: { amount: number; reason: UberAdjustReason; customReason?: string } } = {}): Promise<{ order: StoredOrder | null; result: ChannelResult | { ok: boolean; message: string } }> {
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
    const readyAt = new Date(base + minutes * 60_000).toISOString();
    const updated = await patchTimeline(order, { readyTarget: readyAt, delayedMinutes: (order.timeline?.delayedMinutes ?? 0) + minutes });
    // Where the platform takes a new ready time by API (Uber Eats), it is sent too; a refusal never undoes the timer.
    const push = !order.viaPos && !order.viaHub && order.status === 'accepted' ? getAdapter(order.channel).updateReadyTime : undefined;
    const sent = push ? await push(order, readyAt).catch((e) => ({ ok: false, status: 'error' as const, message: e instanceof Error ? e.message : String(e) })) : null;
    const told = sent?.ok ? ` ${CHANNEL_LABELS[order.channel]} has the new ready time.` : '';
    await repo.addEvent(order.id, 'delayed', { minutes, by: actor.name, message: `+${minutes} min on the kitchen timer${sent ? (sent.ok ? ` — sent to ${CHANNEL_LABELS[order.channel]}` : ` — ${CHANNEL_LABELS[order.channel]} not updated: ${sent.message}`) : ' (the platform keeps its own estimate)'}` });
    await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action, status: 'success', channel: order.channel, brandName: order.brandName, locationCode: order.locationCode, orderId: order.id, summary: `+${minutes} min: ${tag}${sent?.ok ? ` (sent to ${CHANNEL_LABELS[order.channel]})` : ''}` });
    return { order: updated, result: { ok: true, message: `+${minutes} min on the kitchen timer.${told || ((order.channel === 'uber_eats' || order.channel === 'doordash') ? ' The courier follows the platform estimate — call support if it is a long delay.' : '')}`.trim() } };
  }

  if (!allowedActions(order).includes(action) && !META_ACTIONS.includes(action)) {
    return { order, result: { ok: false, message: `"${ACTION_LABEL[action]}" is not possible while the order is ${order.status}.` } };
  }

  if (action === 'report_missing') {
    const picks = (opts.missing ?? []).map((m) => ({ line: order.lines[m.line], quantity: Math.max(1, Math.round(m.quantity)) }))
      .filter((m) => m.line && m.quantity <= m.line.quantity);
    if (!picks.length) return { order, result: { ok: false, message: 'Choose the missing item(s) and quantity.' } };
    if (order.channel === 'doordash') {
      // DoorDash: ITEM_REMOVE / ITEM_UPDATE on the order adjustment endpoint (needs the line ids kept from the order).
      const adj = adjustmentFromMissing(order, picks.map((m) => ({ line: order.lines.indexOf(m.line), quantity: m.quantity })));
      if (!adj.items) return { order, result: { ok: false, message: adj.error ?? 'Nothing to adjust.' } };
      const sent = await adjustDoorDashOrder(order, adj.items);
      const at = nowIso();
      const done = sent.ok
        ? await patchTimeline(order, { missingItems: [...(order.timeline?.missingItems ?? []), ...picks.map((m) => ({ name: m.line.name, ref: m.line.externalId, quantity: m.quantity, at }))] })
        : await repo.updateOrder(order.id, { channelError: sent.message });
      const what = picks.map((m) => `${m.quantity}× ${m.line.name}`).join(', ');
      await repo.addEvent(order.id, sent.ok ? 'report_missing' : 'report_missing_failed', { message: `${what}: ${sent.message}`, by: actor.name });
      await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action, status: sent.ok ? 'success' : 'failed', channel: order.channel, brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
        summary: `Order adjusted on DoorDash for ${tag}: ${what}${sent.ok ? '' : ` (failed: ${sent.message})`}` });
      if (sent.ok) await mevOnOrderChange(order);
      return { order: done, result: sent };
    }
    if (order.channel === 'uber_eats') {
      // Uber asks the customer (remove the item or cancel); the answer arrives as orders.fulfillment_issues.resolved.
      const res = await reportUberOutOfItems(order, picks.map((m) => m.line), { note: opts.reason });
      const label = picks.map((m) => m.line.name).join(', ');
      const updated = res.ok
        ? await patchTimeline(order, { missingItems: [...(order.timeline?.missingItems ?? []), ...picks.map((m) => ({ name: m.line.name, ref: m.line.externalId, quantity: m.line.quantity, at: nowIso() }))] })
        : await repo.updateOrder(order.id, { channelError: res.message });
      await repo.addEvent(order.id, res.ok ? 'report_missing' : 'report_missing_failed', { message: `${label}: ${res.message}`, by: actor.name });
      await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action, status: res.ok ? 'success' : 'failed', channel: order.channel, brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
        summary: `Out of stock sent to Uber Eats for ${tag}: ${label}${res.ok ? '' : ` (failed: ${res.message})`}` });
      return { order: updated, result: res };
    }
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
    if (res.ok) await mevOnOrderChange(order);
    return { order: updated, result: res };
  }

  if (action === 'adjust_price') {
    if (!opts.adjust) return { order, result: { ok: false, message: 'Enter the amount and the reason.' } };
    const res = await adjustUberOrderPrice(order, opts.adjust);
    if (!res.ok) await repo.updateOrder(order.id, { channelError: res.message });
    await repo.addEvent(order.id, res.ok ? 'adjust_price' : 'adjust_price_failed', { message: res.message, amount: opts.adjust.amount, reason: opts.adjust.reason, by: actor.name });
    await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action, status: res.ok ? 'success' : 'failed', channel: order.channel, brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
      summary: `Price change ${opts.adjust.amount > 0 ? '+' : ''}${opts.adjust.amount} $ (${opts.adjust.reason}) for ${tag}${res.ok ? '' : ` (failed: ${res.message})`}` });
    if (res.ok) await mevOnOrderChange(order);
    return { order: (await repo.getOrder(order.id)) ?? order, result: res };
  }

  if (action === 'retry_pos' || action === 'print') {
    if (action === 'print') {
      const store = await repo.findStore(order.channel, order.channelStoreId);
      const p = cloverKitchenChanged(order, store)
        ? { ok: false, message: CLOVER_REPRINT_KITCHEN_CHANGED }
        : await printKitchenTicket(order.posOrderId!, store?.cloverMerchantId, order.locationCode);
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
  else if (action === 'complete' && !order.viaHub && getAdapter(order.channel).completeOrder) {
    // Picked up: platforms that want to hear it (Too Good To Go through Deliverect) are told, but a refusal never blocks the kitchen.
    const told = await getAdapter(order.channel).completeOrder!(order).catch((e: unknown) => ({ ok: false, status: 'error' as const, message: e instanceof Error ? e.message : String(e), channel: order.channel }));
    res = { ok: true, message: told.status === 'done' ? `Marked completed in Food Hub. ${told.message}` : told.ok || told.status === 'skipped' ? 'Marked completed in Food Hub.' : `Marked completed in Food Hub (not reported to the platform: ${told.message}).` };
  }
  else res = { ok: true, message: action === 'dispatch' ? 'Handed to the courier.' : 'Marked completed in Food Hub.' };
  // An Uber Eats order our own driver delivers: Uber shows the customer "on the way" / "delivered" (never blocks the kitchen).
  if (!order.viaPos && !order.viaHub && (action === 'dispatch' || action === 'complete') && isUberMerchantDelivery(order)) {
    const told = await setUberRestaurantDeliveryStatus(order.externalOrderId, action === 'dispatch' ? 'started' : 'delivered').catch((e) => ({ ok: false, message: String(e) }));
    res = { ok: true, message: `${res.message} ${told.ok ? 'Uber Eats shows it to the customer.' : `Uber Eats not updated (${told.message}).`}` };
  }

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
export async function applyExternalStatus(channel: ChannelKey, externalOrderId: string, platformState: string, detail: Record<string, unknown> = {}, { relayState }: { relayState?: string } = {}) {
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
  const guard = relayState === undefined ? undefined
    : (current: StoredOrder) => relayStatusApplies(current, relayState, { needsClover: acceptNeedsClover(current) });
  async function ignoreIneligibleRelayStatus(current: StoredOrder): Promise<boolean> {
    if (!guard || guard(current)) return false;
    await repo.addEvent(current.id, 'platform_status_ignored', { state: relayState, reason: detail.reason, source: 'relay', note: `Not applied: the order is already ${current.status}.` });
    return true;
  }
  if (guard && await ignoreIneligibleRelayStatus(order)) return order;
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
    const logCancellation = (current: StoredOrder) => logActivity({ actor: CHANNEL_LABELS[channel], source: 'platform', kind: 'order', action: 'platform_cancel', status: 'info', channel, brandName: current.brandName, locationCode: current.locationCode, orderId: current.id,
      summary: `${CHANNEL_LABELS[channel]} cancelled #${current.displayId || current.externalOrderId.slice(0, 8)}${t.cancelReason ? ` — ${t.cancelReason}` : ''}` });
    if (status === 'cancelled') {
      const why = String(detail.reason ?? detail.event ?? '').toLowerCase();
      Object.assign(t, { cancelledAt: now, cancelledBy: why.includes('customer') || why.includes('eater') ? 'customer' : 'platform', cancelStage: order.timeline?.acceptedAt ? 'after_accept' : 'before_accept', cancelReason: String(detail.reason ?? detail.event ?? 'Cancelled on the platform') });
      if (!guard) await logCancellation(order);
    }
    if (status === 'completed') t.completedAt = now;
    if (status === 'dispatched') t.dispatchedAt = now;
    if (status === 'ready') t.readyAt = now;
    if (status === 'accepted') t.acceptedAt = order.timeline?.acceptedAt ?? now;
    const updated = guard ? await repo.patchOrder(order.id, t, { status }, guard) : await patchTimeline(order, t, { status });
    if (!updated) {
      const current = await repo.getOrder(order.id);
      if (current && await ignoreIneligibleRelayStatus(current)) return current;
      // No write won and the relay change still looks eligible. Preserve the notice through deferred-work failure handling.
      throw new Error('The order changed while applying the relay status.');
    }
    if (guard && status === 'cancelled') await logCancellation(updated);
    order = (await settleInClover(updated)) ?? updated;
  }
  await repo.addEvent(order.id, 'platform_status', { state: platformState, ...detail, at: nowIso() });
  return order; // the order as stored after the update
}
