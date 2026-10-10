// DoorDash webhook payloads, processed from the webhook inbox (inbox.ts). The route only checks the Authorization header,
// classifies the payload (which also decides the HTTP answer DoorDash gets), saves it and answers; the handlers below run
// for a live delivery, an automatic retry and an owner's Replay alike, and throw when the payload could not be processed
// so the inbox keeps it.
//
// Every DoorDash webhook type is handled here:
//   Order Create            → 202 now, confirmed by PATCH /api/v1/orders/{id} once Clover has the order
//   Menu Status             → closes the queued menu push, remembers the menu id
//   Dasher Status           → courier status on the order (payload nests everything under `delivery`)
//   Order Canceled          → the order is cancelled in Food Hub (the kitchen is told to stop)
//   Order Release (AOR)     → "a Dasher is near: start preparing now"
//   Order Adjustment        → DoorDash applied an item change: the stored order follows
//   Store Temporarily Deactivated → the store row shows the pause / deactivation and why
//   Onboarding status       → the store row shows where its DoorDash activation stands
//   Report Ready            → the requested report is fetched (doordash/reports.ts)
//   Order Cart Validation   → answered synchronously by the route (doordash/ocv.ts), never stored
//
// Order Create is answered 202 (asynchronous confirmation): DoorDash treats a 200 as "order confirmed", which must
// only happen after Clover has the order — the pipeline confirms with PATCH /api/v1/orders/{id} once it does.
import { logActivity } from '../activity';
import { parseDoorDashOrder } from '../adapters/doordash';
import { nowIso } from '../config';
import { applyCourierUpdate, doorDashCourierDetails, doorDashCourierStatus } from '../courier';
import { isProtectedDoorDashId } from '../doordash/guard';
import { menuCallbackOutcome } from '../ops';
import { applyExternalStatus, pipelineOutcomeText, processIncomingOrder } from '../pipeline';
import { getRepo } from '../repo';
import type { CourierStatus, NormalizedOrder, OrderLine, PlatformStatus, StoredOrder } from '../types';
import { keepUnparsed } from '../webhook-utils';
import type { HandlerOutcome } from './uber';

export type DoorDashKind = 'menu_status' | 'dasher' | 'cancel' | 'order' | 'release' | 'store_deactivated' | 'adjustment' | 'onboarding' | 'report_ready' | 'cart_validation' | 'unparsed';
export interface DoorDashClassified {
  kind: DoorDashKind;
  /** What DoorDash gets back: 202 for an order (confirmed later), 200 otherwise. */
  httpStatus: 200 | 202;
  reference: string | null;
  order?: NormalizedOrder;
  courierStatus?: CourierStatus;
  eventType: string;
}

/**
 * The Dasher Status webhook nests everything under `delivery` ({ event, created_at, delivery: { external_order_id,
 * client_order_id, location_id, dasher_status, dasher: {…} } }); older test payloads were flat. Both read the same way.
 */
export function flattenDelivery(body: any): any {
  const d = body?.delivery;
  return d && typeof d === 'object' && !Array.isArray(d) ? { ...body, ...d } : body;
}

/** Order Cart Validation request: { cart_id, store, fulfillment, subtotal, tax, categories, experience } and no order wrapper. */
export function isCartValidation(body: any): boolean {
  return Boolean(body?.cart_id) && !body?.order && Array.isArray(body?.categories) && !body?.event;
}

/**
 * Which DoorDash webhook this is. DoorDash's documented id field on cancel and Dasher events is external_order_id
 * (= the DoorDash order id the order arrived with); client_order_id is the merchant_supplied_id we sent when confirming.
 */
export function classifyDoorDash(raw: any): DoorDashClassified {
  const body = flattenDelivery(raw);
  const eventType = String(body?.event?.type || body?.event_type || body?.type || '').toLowerCase();
  const doordashId = String(body?.external_order_id || body?.order?.external_order_id || body?.order?.id || body?.order_id || body?.id || '');
  const clientOrderId = String(body?.client_order_id || body?.order?.client_order_id || '');
  const reference = doordashId || clientOrderId || null;
  // Order Cart Validation: asked before checkout, answered in the same HTTP exchange.
  if (isCartValidation(body)) return { kind: 'cart_validation', httpStatus: 200, reference: String(body.cart_id), eventType: 'order_cart_validation' };
  // Onboarding status (store activation): { onboarding_id, location_id, doordash_store_uuid, status, exclusion_code, details, menus[] }.
  if (body?.onboarding_id && body?.status) return { kind: 'onboarding', httpStatus: 200, reference: String(body.onboarding_id), eventType: 'onboarding_status' };
  // Report Ready (Reporting API): { report_id, status: SUCCEEDED | FAILED }.
  if (body?.report_id && !body?.order) return { kind: 'report_ready', httpStatus: 200, reference: String(body.report_id), eventType: 'report_ready' };
  // Order Adjustment: { event: { type: OrderAdjustment }, order: {…}, order_adjustment_metadata: {…} }.
  if (eventType.includes('orderadjustment') || eventType.includes('order_adjustment') || body?.order_adjustment_metadata) return { kind: 'adjustment', httpStatus: 200, reference: String(body?.order?.id || doordashId) || null, eventType };
  // Store Temporarily Deactivated: { store: { doordash_store_id, merchant_supplied_id }, event: { type }, reason, notes, start_time, end_time }.
  if (eventType.includes('deactivat') || eventType.includes('store_availability')) return { kind: 'store_deactivated', httpStatus: 200, reference: String(body?.store?.merchant_supplied_id || '') || null, eventType };
  // Menu Status webhook: { event: { type: MenuCreate|MenuUpdate, status, reference, details }, menu: { id }, store? }.
  const menuReference = String(body?.event?.reference || body?.reference || '');
  if (eventType.includes('menu') || (menuReference && (body?.menu?.id || body?.menu_id))) return { kind: 'menu_status', httpStatus: 200, reference: menuReference || null, eventType };
  // Dasher Status: the state is in dasher_status; older test payloads carried it in the event type.
  const courierStatus = doorDashCourierStatus(String(body?.dasher_status || '')) ?? doorDashCourierStatus(eventType);
  if (courierStatus) return { kind: 'dasher', httpStatus: 200, reference, courierStatus, eventType };
  // Order Release (Auto Order Release): { dasher: {…}, distance_from_store, store, external_order_id, client_order_id } — no event wrapper.
  if (eventType.includes('release') || (body?.distance_from_store !== undefined && body?.external_order_id && !body?.order)) return { kind: 'release', httpStatus: 200, reference, eventType: eventType || 'order_release' };
  // Order Cancellation webhook (configured by DoorDash on request): { external_order_id, client_order_id, store, is_asap }.
  const isCancelPayload = !body?.event && !body?.order && Boolean(body?.external_order_id) && !Array.isArray(body?.categories) && !body?.dasher_status;
  if (eventType.includes('cancel') || body?.cancel_reason || body?.cancellation_reason || isCancelPayload) return { kind: 'cancel', httpStatus: 200, reference, eventType };
  const order = parseDoorDashOrder(body);
  if (order) return { kind: 'order', httpStatus: 202, reference: order.externalOrderId, order, eventType };
  // Never answer 200 to something that may be a new order: DoorDash would count it as confirmed.
  const looksLikeOrder = Boolean(body?.order) || /order/.test(eventType);
  return { kind: 'unparsed', httpStatus: looksLikeOrder ? 202 : 200, reference, eventType };
}

/** client_order_id is what we sent as merchant_supplied_id on confirm: the Clover order id, else the Food Hub id. */
async function idFromClientOrderId(clientOrderId: string): Promise<string> {
  if (!clientOrderId) return '';
  const repo = getRepo();
  const direct = await repo.getOrder(clientOrderId).catch(() => null);
  if (direct?.channel === 'doordash') return direct.externalOrderId;
  const recent = await repo.listOrders({ since: new Date(Date.now() - 3 * 86400_000).toISOString(), limit: 2000 }).catch(() => []);
  return recent.find((o) => o.channel === 'doordash' && o.posOrderId === clientOrderId)?.externalOrderId ?? '';
}

const shortId = (o: Pick<StoredOrder, 'displayId' | 'externalOrderId'>) => o.displayId || o.externalOrderId.slice(0, 8);

// ---------------------------------------------------------------------------------------------- Order Adjustment

/**
 * The stored lines after DoorDash applied an adjustment: lines keep their position and Clover mapping, quantities and
 * totals follow DoorDash's updated order; a removed line (gone from DoorDash's order) is dropped; a substitute DoorDash
 * added is appended. Lines are matched on DoorDash's line_item_id.
 */
export function adjustedLines(stored: OrderLine[], updated: OrderLine[]): OrderLine[] {
  const byId = new Map(updated.filter((l) => l.lineItemId).map((l) => [l.lineItemId!, l]));
  const kept = stored.flatMap((l): OrderLine[] => {
    if (!l.lineItemId) return [l];
    const now = byId.get(l.lineItemId);
    if (!now) return [];
    const modifiers = l.modifiers.flatMap((m) => {
      if (!m.lineOptionId) return [m];
      const nm = now.modifiers.find((x) => x.lineOptionId === m.lineOptionId);
      return nm ? [{ ...m, quantity: nm.quantity }] : [];
    });
    return [{ ...l, quantity: now.quantity, total: Math.round(now.unitPrice * now.quantity * 100) / 100, modifiers }];
  });
  const known = new Set(stored.map((l) => l.lineItemId).filter(Boolean));
  const added = updated.filter((l) => l.lineItemId && !known.has(l.lineItemId));
  return [...kept, ...added];
}

function describeAdjustment(meta: any, updated: NormalizedOrder): string {
  const items: any[] = Array.isArray(meta?.adjusted_order_items) ? meta.adjusted_order_items : [];
  const parts = items.map((i) => (i.adjustment_type === 'ITEM_REMOVE' ? 'item removed'
    : i.adjustment_type === 'ITEM_SUBSTITUTE' ? `replaced by ${i.substituted_item?.name ?? 'another item'}`
      : `quantity now ${i.quantity ?? '?'}`));
  return `${parts.join(', ') || 'order adjusted'} — new subtotal ${updated.subtotal.toFixed(2)}, tax ${updated.tax.toFixed(2)}`;
}

async function handleAdjustment(body: any): Promise<HandlerOutcome> {
  const updated = parseDoorDashOrder(body.order ?? body);
  const id = updated?.externalOrderId ?? '';
  const order = id ? await getRepo().findOrder('doordash', id) : null;
  if (!updated || !order) {
    await keepUnparsed('doordash', body, 'DoorDash order adjustment for an order Food Hub does not know', id || null);
    return { result: 'kept: unknown order' };
  }
  const meta = body.order_adjustment_metadata ?? {};
  const summary = describeAdjustment(meta, updated);
  const lines = adjustedLines(order.lines, updated.lines);
  const repo = getRepo();
  await repo.updateOrder(order.id, { lines, subtotal: updated.subtotal, tax: updated.tax, total: updated.total });
  await repo.patchOrder(order.id, { adjustments: [...(order.timeline?.adjustments ?? []), { at: nowIso(), source: String(meta.adjustment_source ?? 'DOORDASH'), summary }] });
  await repo.addEvent(order.id, 'platform_adjustment', { message: `DoorDash adjusted the order: ${summary}. The Clover ticket is not changed automatically — correct it by hand if the kitchen already printed it.`, source: meta.adjustment_source ?? null, at: meta.adjustment_timestamp ?? null });
  await logActivity({ actor: 'DoorDash', source: 'platform', kind: 'order', action: 'platform_adjustment', status: 'info', channel: 'doordash', brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
    summary: `DoorDash adjusted #${shortId(order)}: ${summary}` });
  return { result: 'order adjusted', orderId: order.id };
}

// ---------------------------------------------------------------------------------------------- Order Release (AOR)

async function handleRelease(body: any, doordashId: string, clientOrderId: string): Promise<HandlerOutcome> {
  const id = doordashId || (await idFromClientOrderId(clientOrderId));
  const order = id ? await getRepo().findOrder('doordash', id) : null;
  if (!order) { await keepUnparsed('doordash', body, 'DoorDash order release for an order Food Hub does not know', clientOrderId || id || null); return { result: 'kept: unknown order' }; }
  const metres = Number(body?.distance_from_store);
  const d = body?.dasher ?? {};
  const vehicle = [d.vehicle?.color, d.vehicle?.make, d.vehicle?.model].filter(Boolean).join(' ');
  await getRepo().patchOrder(order.id, { releasedAt: nowIso() });
  await getRepo().addEvent(order.id, 'released', { message: `DoorDash released the order: the Dasher is near${Number.isFinite(metres) ? ` (${Math.round(metres)} m)` : ''} — start preparing now.${vehicle ? ` Vehicle: ${vehicle}.` : ''}`, distance: Number.isFinite(metres) ? metres : null });
  await applyCourierUpdate('doordash', order.externalOrderId, { status: 'arriving', ...(d.first_name ? { name: String(d.first_name) } : {}), ...(d.phone_number ? { phone: String(d.phone_number) } : {}), ...(vehicle ? { vehicle } : {}) }, 'doordash:order_release');
  await logActivity({ actor: 'DoorDash', source: 'platform', kind: 'order', action: 'order_release', status: 'info', channel: 'doordash', brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
    summary: `DoorDash released #${shortId(order)} — the Dasher is near, start preparing${vehicle ? ` (${vehicle})` : ''}` });
  return { result: 'order released', orderId: order.id };
}

// ---------------------------------------------------------------------------------------------- Store Temporarily Deactivated

async function handleStoreDeactivated(body: any): Promise<HandlerOutcome> {
  const msid = String(body?.store?.merchant_supplied_id ?? '');
  const repo = getRepo();
  const store = msid ? await repo.findStore('doordash', msid) : null;
  const reason = String(body?.event?.reason ?? body?.reason ?? 'Deactivated on DoorDash');
  const notes = String(body?.event?.notes ?? body?.notes ?? '');
  const endTime = body?.event?.end_time ?? body?.end_time ?? null;
  // A store the owner protects is never written to, not even from DoorDash's own notice.
  if (msid && isProtectedDoorDashId(msid)) return { result: 'ignored: protected store' };
  if (!store) { await keepUnparsed('doordash', body, 'DoorDash store deactivation for a store Food Hub does not know', msid || null); return { result: 'kept: unknown store' }; }
  const ours = /takatak|food hub/i.test(notes);
  const status: PlatformStatus = { state: endTime ? 'paused' : 'deactivated', detail: [reason, notes].filter(Boolean).join(' — '), until: endTime ? String(endTime) : null, checkedAt: nowIso(), source: 'webhook' };
  await repo.updateStore(store.id, { online: false, pausedUntil: endTime ? String(endTime) : null, lastStatusSource: 'doordash', meta: { ...store.meta, platformStatus: status } });
  await logActivity({ actor: 'DoorDash', source: 'platform', kind: 'store_status', action: 'store_deactivated', status: ours ? 'info' : 'failed', channel: 'doordash', brandName: store.brandName, locationCode: store.locationCode, storeId: store.id,
    summary: `DoorDash paused ${store.brandName} · ${store.locationCode}: ${status.detail}${endTime ? ` (until ${endTime})` : ''}`, detail: { reasonId: body?.event?.reason_id ?? body?.reason_id ?? null, start: body?.event?.start_time ?? body?.start_time ?? null, end: endTime } });
  return { result: `store ${status.state}` };
}

// ---------------------------------------------------------------------------------------------- Onboarding status

export const ONBOARDING_BLOCKED = ['MENU_BLOCK', 'ACTIVATION_BLOCK', 'ABANDONED'];

async function handleOnboarding(body: any): Promise<HandlerOutcome> {
  const location = String(body?.location_id ?? '');
  const repo = getRepo();
  const store = location ? await repo.findStore('doordash', location) : null;
  const status = String(body.status);
  const entry = { onboardingId: String(body.onboarding_id), status, exclusionCode: body.exclusion_code ? String(body.exclusion_code) : null, details: body.details ? String(body.details) : null, doordashStoreUuid: body.doordash_store_uuid ? String(body.doordash_store_uuid) : null,
    menus: (Array.isArray(body.menus) ? body.menus : []).map((m: any) => ({ id: m?.menu_uuid ?? null, preview: m?.menu_preview_link ?? null, error: m?.menu_error ?? null })), at: nowIso() };
  if (!store) { await keepUnparsed('doordash', body, 'DoorDash onboarding status for a store Food Hub does not know', location || null); return { result: 'kept: unknown store' }; }
  if (isProtectedDoorDashId(location)) return { result: 'ignored: protected store' };
  await repo.updateStore(store.id, { meta: { ...store.meta, doordashOnboarding: entry } });
  const blocked = ONBOARDING_BLOCKED.includes(status);
  await logActivity({ actor: 'DoorDash', source: 'platform', kind: 'settings', action: 'doordash_onboarding', status: blocked ? 'failed' : 'info', channel: 'doordash', brandName: store.brandName, locationCode: store.locationCode, storeId: store.id,
    summary: `DoorDash activation of ${store.brandName} · ${store.locationCode}: ${status}${entry.exclusionCode ? ` (${entry.exclusionCode})` : ''}${entry.details ? ` — ${entry.details}` : ''}`, detail: entry });
  return { result: `onboarding ${status}` };
}

// ---------------------------------------------------------------------------------------------- the dispatcher

export async function handleDoorDashWebhook(raw: any): Promise<HandlerOutcome> {
  const body = flattenDelivery(raw);
  const c = classifyDoorDash(raw);
  const doordashId = String(body?.external_order_id || body?.order?.external_order_id || body?.order?.id || body?.order_id || body?.id || '');
  const clientOrderId = String(body?.client_order_id || body?.order?.client_order_id || '');

  if (c.kind === 'cart_validation') {
    // Never reaches the inbox in production (the route answers it); a replayed copy has nothing to process.
    return { result: 'cart validation is answered live, nothing stored' };
  }
  if (c.kind === 'report_ready') {
    const { onDoorDashReportReady } = await import('../doordash/reports');
    return { result: await onDoorDashReportReady(body) };
  }
  if (c.kind === 'onboarding') return handleOnboarding(body);
  if (c.kind === 'adjustment') return handleAdjustment(body);
  if (c.kind === 'store_deactivated') return handleStoreDeactivated(body);
  if (c.kind === 'release') return handleRelease(body, doordashId, clientOrderId);

  if (c.kind === 'menu_status') {
    const repo = getRepo();
    const menuReference = c.reference ?? '';
    const job = menuReference ? await repo.findJobByReference(menuReference) : null;
    // Store: from our own reference (takatak-<msid>-<ts>), the payload, or the job that pushed the menu.
    const msid = menuReference.startsWith('takatak-') ? menuReference.slice('takatak-'.length).replace(/-\d+$/, '')
      : String(body.store?.merchant_supplied_id || job?.request?.channelStoreId || '');
    const menuId = body.menu?.id || body.menu_id;
    const store = msid ? await repo.findStore('doordash', msid) : null;
    // DoorDash can return the menu id even on FAILURE: keep it so the next push updates that menu.
    if (store && menuId) await repo.updateStore(store.id, { meta: { ...store.meta, doordashMenuId: String(menuId), lastMenuStatus: body } });
    if (!job) {
      await keepUnparsed('doordash', body, menuReference ? 'DoorDash menu status for a menu push Food Hub does not know' : 'DoorDash menu status without a reference', menuReference || null);
      return { result: 'kept: unknown menu push' };
    }
    // Close the queued "menu push" job only on an explicit success/failure; otherwise it stays queued and the callback is kept.
    if (job.status === 'queued') {
      const outcome = menuCallbackOutcome(body);
      const details = String(body.event?.details ?? body.details ?? '').trim();
      const message = outcome === 'failed' ? `DoorDash refused the menu${details ? `: ${details.slice(0, 300)}` : ''}` : outcome === 'success' ? 'Menu published on DoorDash' : undefined;
      await repo.updateJob(job.id, { ...(outcome ? { status: outcome === 'success' ? 'done' : 'error' } : {}), result: { ...(job.result ?? {}), ...(message ? { message } : {}), callback: body } });
      if (!outcome) await keepUnparsed('doordash', body, 'Menu-status callback without an explicit success/failure indicator — menu push left queued', menuReference);
      return { result: message ?? 'menu status kept (no explicit result)' };
    }
    return { result: 'menu status noted' };
  }
  if (c.kind === 'dasher') {
    const id = doordashId || (await idFromClientOrderId(clientOrderId));
    await applyCourierUpdate('doordash', id, { status: c.courierStatus!, ...doorDashCourierDetails(body) }, `doordash:${body.dasher_status || c.eventType}`);
    return { result: `dasher ${c.courierStatus}` };
  }
  if (c.kind === 'cancel') {
    const id = doordashId || (await idFromClientOrderId(clientOrderId));
    if (!id) { await keepUnparsed('doordash', body, 'DoorDash cancellation without an order id Food Hub knows — check the order on the DoorDash tablet', clientOrderId || null); return { result: 'kept: unknown order' }; }
    const o = await applyExternalStatus('doordash', id, 'cancelled', { event: c.eventType || 'order_cancel', reason: body.cancel_reason || body.cancellation_reason });
    return { result: o ? 'cancellation applied' : 'cancellation kept until the order arrives', orderId: o?.id ?? null };
  }
  if (c.kind === 'order') {
    const out = await processIncomingOrder(c.order!);
    return { result: pipelineOutcomeText(out), orderId: out.order.id };
  }
  const looksLikeOrder = c.httpStatus === 202;
  await keepUnparsed('doordash', raw, looksLikeOrder ? 'DoorDash order Food Hub could not read — not confirmed; DoorDash will fail it unless it is confirmed on the tablet' : 'Unrecognized DoorDash payload', c.reference);
  return { result: 'kept: unreadable payload' };
}
