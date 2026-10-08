// DoorDash webhook payloads (Order, Order Cancellation, Menu Status, Dasher Status), processed from the webhook inbox
// (inbox.ts). The route only checks the Authorization header, classifies the payload (which also decides the HTTP
// answer DoorDash gets), saves it and answers; the handlers below run for a live delivery, an automatic retry and an
// owner's Replay alike, and throw when the payload could not be processed so the inbox keeps it.
//
// Order Create is answered 202 (asynchronous confirmation): DoorDash treats a 200 as "order confirmed", which must
// only happen after Clover has the order — the pipeline confirms with PATCH /api/v1/orders/{id} once it does.
import { parseDoorDashOrder } from '../adapters/doordash';
import { applyCourierUpdate, doorDashCourierDetails, doorDashCourierStatus } from '../courier';
import { menuCallbackOutcome } from '../ops';
import { applyExternalStatus, pipelineOutcomeText, processIncomingOrder } from '../pipeline';
import { getRepo } from '../repo';
import type { CourierStatus, NormalizedOrder } from '../types';
import { keepUnparsed } from '../webhook-utils';
import type { HandlerOutcome } from './uber';

export type DoorDashKind = 'menu_status' | 'dasher' | 'cancel' | 'order' | 'unparsed';
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
 * Which DoorDash webhook this is. DoorDash's documented id field on cancel and Dasher events is external_order_id
 * (= the DoorDash order id the order arrived with); client_order_id is the merchant_supplied_id we sent when confirming.
 */
export function classifyDoorDash(body: any): DoorDashClassified {
  const eventType = String(body?.event?.type || body?.event_type || body?.type || '').toLowerCase();
  const doordashId = String(body?.external_order_id || body?.order?.external_order_id || body?.order?.id || body?.order_id || body?.id || '');
  const clientOrderId = String(body?.client_order_id || body?.order?.client_order_id || '');
  const reference = doordashId || clientOrderId || null;
  // Menu Status webhook: { event: { type: MenuCreate|MenuUpdate, status, reference, details }, menu: { id }, store? }.
  const menuReference = String(body?.event?.reference || body?.reference || '');
  if (eventType.includes('menu') || (menuReference && (body?.menu?.id || body?.menu_id))) return { kind: 'menu_status', httpStatus: 200, reference: menuReference || null, eventType };
  // Dasher Status: the state is in dasher_status; older test payloads carried it in the event type.
  const courierStatus = doorDashCourierStatus(String(body?.dasher_status || '')) ?? doorDashCourierStatus(eventType);
  if (courierStatus) return { kind: 'dasher', httpStatus: 200, reference, courierStatus, eventType };
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

export async function handleDoorDashWebhook(body: any): Promise<HandlerOutcome> {
  const c = classifyDoorDash(body);
  const doordashId = String(body?.external_order_id || body?.order?.external_order_id || body?.order?.id || body?.order_id || body?.id || '');
  const clientOrderId = String(body?.client_order_id || body?.order?.client_order_id || '');

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
  await keepUnparsed('doordash', body, looksLikeOrder ? 'DoorDash order Food Hub could not read — not confirmed; DoorDash will fail it unless it is confirmed on the tablet' : 'Unrecognized DoorDash payload', c.reference);
  return { result: 'kept: unreadable payload' };
}
