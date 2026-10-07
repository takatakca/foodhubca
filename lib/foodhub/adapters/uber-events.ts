// Uber Eats webhook events → Food Hub. Used by the webhook route (right after the 200) and by the sync's replay of
// webhooks still pending in the inbox (lib/foodhub/adapters/uber-inbox.ts). Every handler is idempotent.
import { logActivity } from '../activity';
import { nowIso } from '../config';
import { applyCourierUpdate, readPending } from '../courier';
import { publishMenu } from '../ops';
import { applyExternalStatus, processIncomingOrder } from '../pipeline';
import { handleUberReportWebhook } from '../recon/automation';
import { getRepo } from '../repo';
import type { PlatformStatus } from '../types';
import type { UberPosState } from './uber-eats';
import { keepUnparsed, recordBackgroundFailure, uberDeliveryStatus } from '../webhook-utils';
import { fetchUberOrder, fetchUberPosData, listUberCreatedOrders, parseUberOrder, uberApiBase, uberEatsAdapter } from './uber-eats';
import { markUberWebhook } from './uber-inbox';

/** Routine Uber events with nothing to do in Food Hub: noted in the activity log, never an alert. */
const NOTED = /^orders\.release$|^orders?\.fulfillment_issues|^orders\.scheduled\.reminder/;

/** The order / store id an event is about (Uber puts it in meta.resource_id; older payloads use store_id). */
export function uberEventResource(body: any): string {
  return String(body?.meta?.resource_id || body?.meta?.order_id || body?.store_id || body?.meta?.store_id || '');
}

/** Order states (GET /v2/eats/order current_state) after which the order must not be cooked or put in Clover. */
const ENDED = /^(CANCELED|CANCELLED|DENIED)$/i;

/** Processes one Uber webhook body. Throws when the work failed (the inbox then retries it). */
export async function handleUberEvent(body: any): Promise<void> {
  const event = String(body?.event_type || '');
  // Order events carry the order id in meta.resource_id; delivery.state_changed in meta.order_id.
  const orderId = String(body?.meta?.resource_id || body?.meta?.order_id || '');

  if (event === 'orders.notification' || event === 'orders.scheduled.notification') {
    const href = body.resource_href || orderId;
    if (!href) return keepUnparsed('uber_eats', body, 'Uber order notification without resource_href or order id');
    // One immediate retry; after that the inbox replays the notification (Uber does not resend it).
    const details = await fetchUberOrder(href).catch(() => fetchUberOrder(href));
    const order = parseUberOrder(details, body.meta?.user_id);
    if (!order) return keepUnparsed('uber_eats', details, 'Uber order details could not be parsed', orderId || null);
    // Already cancelled / denied on Uber by the time Food Hub read it (a late replay): recorded as cancelled — never sent
    // to Clover, never accepted (the pipeline applies a cancel that arrived first).
    if (ENDED.test(String(details?.current_state ?? ''))) await applyExternalStatus('uber_eats', order.externalOrderId, 'cancelled', { event: `current_state ${details.current_state}`, reason: `Already ${String(details.current_state).toLowerCase()} on Uber when Food Hub read it` });
    await processIncomingOrder(order);
    return;
  }
  if (event === 'orders.cancel' || event === 'orders.failure') {
    if (!orderId) return keepUnparsed('uber_eats', body, `Uber ${event} without an order id`);
    await applyExternalStatus('uber_eats', orderId, 'cancelled', { event, ...(body.meta?.reason ? { reason: String(body.meta.reason) } : {}) });
    return;
  }
  if (event === 'orders.customer_order_edit') {
    // The customer changed the order (Uber, 2026-07). Food Hub never edits a Clover ticket on its own: the new cart is
    // read, kept on the order and flagged so the kitchen checks it.
    const repo = getRepo();
    const stored = orderId ? await repo.findOrder('uber_eats', orderId) : null;
    if (!stored) return keepUnparsed('uber_eats', body, 'Uber customer order edit for an order Food Hub does not have', orderId || null);
    const details = await fetchUberOrder(body.resource_href || orderId);
    const edited = parseUberOrder(details, stored.channelStoreId);
    await repo.addEvent(stored.id, 'customer_order_edit', { lines: (edited?.lines ?? []).map((l) => `${l.quantity}× ${l.name}`), total: edited?.total ?? null, note: 'The customer changed this order on Uber Eats. The Clover ticket was NOT changed — check the items with the platform.' });
    await repo.updateOrder(stored.id, { channelError: 'The customer changed this order on Uber Eats — check the new items (the Clover ticket was not changed).' });
    await logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'order', action: 'customer_order_edit', status: 'failed', channel: 'uber_eats', brandName: stored.brandName, locationCode: stored.locationCode, orderId: stored.id,
      summary: `The customer changed Uber Eats order #${stored.displayId || orderId.slice(0, 8)} — check the new items; the Clover ticket was not changed` });
    return;
  }
  if (event === 'delivery.state_changed') {
    // Courier state from the webhook itself (body.meta.status); anything we cannot map with confidence is kept, not guessed.
    const rawState = body.meta?.status ?? body.delivery?.status ?? body.delivery?.current_status ?? body.status;
    if (String(rawState ?? '').toUpperCase() === 'FAILED' && orderId) {
      const stored = await getRepo().findOrder('uber_eats', orderId);
      if (!stored) return keepUnparsed('uber_eats', body, 'Uber delivery FAILED for an order Food Hub does not have', orderId);
      await getRepo().addEvent(stored.id, 'courier_failed', { message: 'Uber reports the delivery failed.' });
      await logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'order', action: 'courier_failed', status: 'failed', channel: 'uber_eats', brandName: stored.brandName, locationCode: stored.locationCode, orderId: stored.id,
        summary: `Uber reports the delivery of #${stored.displayId || orderId.slice(0, 8)} failed — check Uber Eats Manager` });
      return;
    }
    const status = uberDeliveryStatus(rawState);
    if (!status || !orderId) return keepUnparsed('uber_eats', body, `Uber delivery state not recognized (${String(rawState ?? 'missing')})`, orderId || null);
    const saved = await applyCourierUpdate('uber_eats', orderId, { status }, 'uber_eats:delivery.state_changed');
    if (!saved && !(await readPending('uber_eats', orderId))) await keepUnparsed('uber_eats', body, 'Uber courier update for an order Food Hub does not have', orderId);
    return;
  }
  if (event.startsWith('eats.report') || event.includes('report')) {
    // Reporting API: the requested payment report is ready → download, import, reconcile.
    if (/fail|error/i.test(event)) {
      await logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'settings', action: 'uber_report_failed', status: 'failed', channel: 'uber_eats', summary: `Uber could not build the requested report (${event})` });
    } else await handleUberReportWebhook(body);
    return;
  }
  if (event === 'store.provisioned' || event === 'store.deprovisioned') {
    const repo = getRepo();
    const storeId = uberEventResource(body);
    const store = storeId ? await repo.findStore('uber_eats', storeId) : null;
    const off = event === 'store.deprovisioned';
    // Provisioned "might promote this app to become the store's order manager": read back who takes the orders now
    // (read-only). perform_refresh_menu = Uber wants a menu; it is flagged for the owner, not pushed blindly.
    const pos = !off && storeId ? await fetchUberPosData(storeId).catch(() => null) : null;
    if (store) {
      const { uberPos: _old, ...rest } = store.meta as Record<string, unknown>;
      await repo.updateStore(store.id, { meta: { ...rest, provisioned: !off, awaitingProvision: false, provisionChangedAt: nowIso(), ...(pos?.ok && pos.state ? { uberPos: pos.state } : {}), ...(body.perform_refresh_menu === true ? { menuRefreshRequested: nowIso() } : {}) } });
    }
    const who = pos?.state?.orderManager === 'other' ? ' — but another integration (UrbanPiper) still receives its orders' : pos?.state?.orderManager === 'pending' ? ' — Uber is moving its orders to Food Hub (pending)' : '';
    await logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'store_status', action: off ? 'platform_deprovisioned' : 'platform_provisioned', status: off ? 'failed' : who ? 'info' : 'success', channel: 'uber_eats',
      brandName: store?.brandName, locationCode: store?.locationCode, storeId: store?.id,
      summary: off ? `Uber Eats disconnected store ${store ? `${store.brandName} · ${store.locationCode}` : storeId} from Food Hub — orders will no longer arrive here. Reconnect it under Stores.`
        : `Uber Eats connected store ${store ? `${store.brandName} · ${store.locationCode}` : storeId} to Food Hub${who}${body.perform_refresh_menu === true ? '. Uber asks for the menu: Menus → All Uber stores' : ''}` });
    return;
  }
  if (event === 'store.status.changed') {
    const repo = getRepo();
    const store = await repo.findStore('uber_eats', uberEventResource(body));
    if (!store) return;
    const online = String(body.meta?.status || '').toUpperCase() === 'ONLINE';
    const platformStatus: PlatformStatus = { state: online ? 'online' : 'paused', detail: online ? undefined : String(body.meta?.status || 'Changed on Uber Eats'), until: null, checkedAt: nowIso(), source: 'webhook' };
    await repo.updateStore(store.id, { online, lastStatusSource: 'uber_eats:webhook', meta: { ...store.meta, platformStatus } });
    if (store.online !== online) {
      await logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'store_status', action: online ? 'platform_online' : 'platform_paused', status: online ? 'success' : 'info',
        channel: 'uber_eats', brandName: store.brandName, locationCode: store.locationCode, storeId: store.id, summary: `${store.brandName} · ${store.locationCode} on Uber Eats is now ${online ? 'online' : 'paused'}` });
    }
    return;
  }
  if (event === 'store.menu_refresh_request') {
    // Uber asks for the menu again (store re-activated, menu reset…): Food Hub is the menu's source, so publish it now
    // (a store marked "Do not touch" is left alone by publishMenu).
    const id = uberEventResource(body);
    const store = await getRepo().findStore('uber_eats', id);
    if (!store) return keepUnparsed('uber_eats', body, 'Uber menu refresh request for a store that is not mapped', id || null);
    await publishMenu(store.brandName, { storeIds: [store.id], channels: ['uber_eats'], actor: { username: 'uber', name: 'Uber Eats (menu refresh)', source: 'platform' } });
    return;
  }
  if (NOTED.test(event)) {
    await logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'order', action: 'uber_event', status: 'info', channel: 'uber_eats', orderId: null, summary: `Uber Eats event ${event} noted${orderId ? ` for order ${orderId}` : ''} — no action needed` });
    return;
  }
  // Unknown event types are kept under Channels → Unparsed payloads, never dropped.
  await keepUnparsed('uber_eats', body, `Unhandled Uber event ${event || '(no event_type)'}`, orderId || null);
}

const KIND: Record<string, 'order' | 'settings' | 'store_status' | 'menu_publish'> = { 'store.provisioned': 'store_status', 'store.deprovisioned': 'store_status', 'store.status.changed': 'store_status', 'store.menu_refresh_request': 'menu_publish' };

/**
 * Runs one inbox entry and records the outcome. A failure with attempts left is retried by the sync (logged as info);
 * the last failure keeps the payload under Channels → Unparsed payloads and raises the usual alert.
 */
export async function runUberWebhook(id: string, body: any): Promise<boolean> {
  const event = String(body?.event_type || '') || 'unknown';
  const ref = uberEventResource(body) || null;
  try {
    await handleUberEvent(body);
    await markUberWebhook(id, { ok: true });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const entry = await markUberWebhook(id, { ok: false, error: message }).catch(() => null);
    if (!entry || entry.status === 'failed') {
      await recordBackgroundFailure(`Uber ${event}${ref ? ` ${ref}` : ''}`, error, { channel: 'uber_eats', body, reference: ref, kind: KIND[event] ?? (event.includes('report') ? 'settings' : 'order') });
    } else {
      await logActivity({ actor: 'Uber Eats', source: 'platform', kind: KIND[event] ?? 'order', action: 'uber_webhook_retry', status: 'info', channel: 'uber_eats',
        summary: `Uber ${event}${ref ? ` ${ref}` : ''} could not be processed yet (${message.slice(0, 160)}) — kept; Food Hub retries in about 2 minutes (attempt ${entry.attempts}).` });
    }
    return false;
  }
}

/**
 * Missed-order check (every sync): orders still waiting for an accept on Uber (created-orders) that never reached Food
 * Hub by webhook are fetched and run through the normal pipeline (Clover first, accept only after). Only for stores
 * where Uber confirmed Food Hub is the order manager (meta.uberPos.orderManager = 'foodhub') and only while Uber Eats
 * is live — an order UrbanPiper still handles is never put in Clover a second time. The webhook gets a 60-second head
 * start, and orders past Uber's 11.5-minute window are left alone (Uber cancels them).
 */
export async function recoverMissedUberOrders(now = Date.now()): Promise<{ recovered: number; error?: string }> {
  if (!uberEatsAdapter.readiness().canSend) return { recovered: 0 };
  const repo = getRepo();
  const stores = (await repo.listStores('uber_eats')).filter((s) => (s.meta?.uberPos as UberPosState | undefined)?.orderManager === 'foodhub');
  let recovered = 0;
  let error: string | undefined;
  for (const s of stores) {
    let waiting: Array<{ id: string; placedAt: string | null }>;
    try { waiting = await listUberCreatedOrders(s.channelStoreId); } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      if (/token refused/i.test(error)) break; // scope not granted: the same for every store
      continue;
    }
    for (const o of waiting) {
      const age = o.placedAt ? now - Date.parse(o.placedAt) : null;
      if (age !== null && (age < 60_000 || age > 11.5 * 60_000)) continue;
      if (await repo.findOrder('uber_eats', o.id)) continue;
      await handleUberEvent({ event_type: 'orders.notification', meta: { resource_id: o.id, user_id: s.channelStoreId, status: 'pos' }, resource_href: `${uberApiBase()}/v2/eats/order/${encodeURIComponent(o.id)}` });
      recovered++;
      await logActivity({ actor: 'TAKATAK automation', source: 'automation', kind: 'order', action: 'uber_order_recovered', status: 'info', channel: 'uber_eats', brandName: s.brandName, locationCode: s.locationCode,
        summary: `Uber Eats order ${o.id.slice(0, 8)} for ${s.brandName} · ${s.locationCode} never arrived by webhook — found on Uber and processed` });
    }
  }
  return { recovered, ...(error ? { error } : {}) };
}
