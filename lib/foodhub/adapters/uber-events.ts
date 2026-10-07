// Uber Eats webhook events → Food Hub. Run from the webhook inbox (lib/foodhub/inbox.ts, kind "uber"): right after the
// route answers 200, by the inbox's automatic retries / sweep, and by an owner's Replay — and by the missed-order check.
// Every handler is idempotent and throws when the work failed, so the inbox keeps the event and tries again.
import { logActivity } from '../activity';
import { nowIso } from '../config';
import { applyCourierUpdate, readPending } from '../courier';
import { publishMenu } from '../ops';
import { applyExternalStatus, processIncomingOrder } from '../pipeline';
import { handleUberReportWebhook } from '../recon/automation';
import { getRepo } from '../repo';
import type { PlatformStatus } from '../types';
import type { UberPosState } from './uber-eats';
import { keepUnparsed, uberDeliveryStatus } from '../webhook-utils';
import { enableUberIntegration, fetchUberOrder, fetchUberPosData, listUberCreatedOrders, parseUberOrder, uberApiBase, uberEatsAdapter } from './uber-eats';

/** Routine Uber events with nothing to do in Food Hub: noted in the activity log, never an alert. */
const NOTED = /^orders\.release$|^orders?\.fulfillment_issues|^orders\.scheduled\.reminder/;

/** The order / store id an event is about (Uber puts it in meta.resource_id; older payloads use store_id). */
export function uberEventResource(body: any): string {
  return String(body?.meta?.resource_id || body?.meta?.order_id || body?.store_id || body?.meta?.store_id || '');
}

/** Order states (GET /v2/eats/order current_state) after which the order must not be cooked or put in Clover. */
const ENDED = /^(CANCELED|CANCELLED|DENIED)$/i;

/** What the webhook inbox remembers about the outcome (Settings → Platforms → Webhook inbox). */
export type HandlerOutcome = { result: string; orderId?: string | null };

/** Kept under Channels → Unparsed payloads (never dropped), and said so on the inbox entry. */
async function kept(body: unknown, reason: string, reference: string | null = null): Promise<HandlerOutcome> {
  await keepUnparsed('uber_eats', body, reason, reference);
  return { result: `kept: ${reason}` };
}

/** Processes one Uber webhook body. Throws when the work failed (the inbox then retries it). */
export async function handleUberEvent(body: any): Promise<HandlerOutcome> {
  const event = String(body?.event_type || '');
  // Order events carry the order id in meta.resource_id; delivery.state_changed in meta.order_id.
  const orderId = String(body?.meta?.resource_id || body?.meta?.order_id || '');

  if (event === 'orders.notification' || event === 'orders.scheduled.notification') {
    const href = body.resource_href || orderId;
    if (!href) return kept(body, 'Uber order notification without resource_href or order id');
    // One immediate retry; after that the inbox replays the notification (Uber does not resend it).
    const details = await fetchUberOrder(href).catch(() => fetchUberOrder(href));
    const order = parseUberOrder(details, body.meta?.user_id);
    if (!order) return kept(details, 'Uber order details could not be parsed', orderId || null);
    // Already cancelled / denied on Uber by the time Food Hub read it (a late replay): recorded as cancelled — never sent
    // to Clover, never accepted (the pipeline applies a cancel that arrived first).
    if (ENDED.test(String(details?.current_state ?? ''))) await applyExternalStatus('uber_eats', order.externalOrderId, 'cancelled', { event: `current_state ${details.current_state}`, reason: `Already ${String(details.current_state).toLowerCase()} on Uber when Food Hub read it` });
    const out = await processIncomingOrder(order);
    return { result: out.duplicate ? 'duplicate (already received)' : `order received${out.pos?.ok ? ', in Clover' : out.pos?.error ? `, Clover: ${out.pos.error}` : ''}`, orderId: out.order.id };
  }
  if (event === 'orders.cancel' || event === 'orders.failure') {
    if (!orderId) return kept(body, `Uber ${event} without an order id`);
    const o = await applyExternalStatus('uber_eats', orderId, 'cancelled', { event, ...(body.meta?.reason ? { reason: String(body.meta.reason) } : {}) });
    return { result: o ? 'cancellation applied' : 'cancellation kept until the order arrives', orderId: o?.id ?? null };
  }
  if (event === 'orders.customer_order_edit') {
    // The customer changed the order (Uber, 2026-07). Food Hub never edits a Clover ticket on its own: the new cart is
    // read, kept on the order and flagged so the kitchen checks it.
    const repo = getRepo();
    const stored = orderId ? await repo.findOrder('uber_eats', orderId) : null;
    if (!stored) return kept(body, 'Uber customer order edit for an order Food Hub does not have', orderId || null);
    const details = await fetchUberOrder(body.resource_href || orderId);
    const edited = parseUberOrder(details, stored.channelStoreId);
    await repo.addEvent(stored.id, 'customer_order_edit', { lines: (edited?.lines ?? []).map((l) => `${l.quantity}× ${l.name}`), total: edited?.total ?? null, note: 'The customer changed this order on Uber Eats. The Clover ticket was NOT changed — check the items with the platform.' });
    await repo.updateOrder(stored.id, { channelError: 'The customer changed this order on Uber Eats — check the new items (the Clover ticket was not changed).' });
    await logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'order', action: 'customer_order_edit', status: 'failed', channel: 'uber_eats', brandName: stored.brandName, locationCode: stored.locationCode, orderId: stored.id,
      summary: `The customer changed Uber Eats order #${stored.displayId || orderId.slice(0, 8)} — check the new items; the Clover ticket was not changed` });
    return { result: 'customer edit flagged for the kitchen', orderId: stored.id };
  }
  if (event === 'delivery.state_changed') {
    // Courier state from the webhook itself (body.meta.status); anything we cannot map with confidence is kept, not guessed.
    const rawState = body.meta?.status ?? body.delivery?.status ?? body.delivery?.current_status ?? body.status;
    if (String(rawState ?? '').toUpperCase() === 'FAILED' && orderId) {
      const stored = await getRepo().findOrder('uber_eats', orderId);
      if (!stored) return kept(body, 'Uber delivery FAILED for an order Food Hub does not have', orderId);
      await getRepo().addEvent(stored.id, 'courier_failed', { message: 'Uber reports the delivery failed.' });
      await logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'order', action: 'courier_failed', status: 'failed', channel: 'uber_eats', brandName: stored.brandName, locationCode: stored.locationCode, orderId: stored.id,
        summary: `Uber reports the delivery of #${stored.displayId || orderId.slice(0, 8)} failed — check Uber Eats Manager` });
      return { result: 'courier failed (flagged)', orderId: stored.id };
    }
    const status = uberDeliveryStatus(rawState);
    if (!status || !orderId) return kept(body, `Uber delivery state not recognized (${String(rawState ?? 'missing')})`, orderId || null);
    const saved = await applyCourierUpdate('uber_eats', orderId, { status }, 'uber_eats:delivery.state_changed');
    if (!saved && !(await readPending('uber_eats', orderId))) await keepUnparsed('uber_eats', body, 'Uber courier update for an order Food Hub does not have', orderId);
    return { result: `courier ${status}` };
  }
  if (event.startsWith('eats.report') || event.includes('report')) {
    // Reporting API: the requested payment report is ready → download, import, reconcile.
    if (/fail|error/i.test(event)) {
      await logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'settings', action: 'uber_report_failed', status: 'failed', channel: 'uber_eats', summary: `Uber could not build the requested report (${event})` });
      return { result: 'report failed on Uber' };
    }
    await handleUberReportWebhook(body);
    return { result: 'report imported' };
  }
  if (event === 'store.provisioned' || event === 'store.deprovisioned') {
    const repo = getRepo();
    const storeId = uberEventResource(body);
    const store = storeId ? await repo.findStore('uber_eats', storeId) : null;
    const off = event === 'store.deprovisioned';
    // Provisioned "might promote this app to become the store's order manager": read back who takes the orders now
    // (read-only). perform_refresh_menu = Uber wants a menu; it is flagged for the owner, not pushed blindly.
    let pos = !off && storeId ? await fetchUberPosData(storeId).catch(() => null) : null;
    // Activated from Food Hub but the order webhooks are still off (the PATCH right after activation came too early):
    // finish the activation the owner asked for. A write on Uber, so only with the live switch.
    if (store?.meta?.provisionedAt && pos?.ok && pos.state?.integrationEnabled === false && uberEatsAdapter.readiness().canSend) {
      const on = await enableUberIntegration(storeId);
      if (on.ok) pos = await fetchUberPosData(storeId).catch(() => pos);
    }
    if (store) {
      const { uberPos: _old, ...rest } = store.meta as Record<string, unknown>;
      await repo.updateStore(store.id, { meta: { ...rest, provisioned: !off, awaitingProvision: false, provisionChangedAt: nowIso(), ...(pos?.ok && pos.state ? { uberPos: pos.state } : {}), ...(body.perform_refresh_menu === true ? { menuRefreshRequested: nowIso() } : {}) } });
    }
    const who = pos?.state?.orderManager === 'other' ? ' — but another integration (UrbanPiper) still receives its orders' : pos?.state?.orderManager === 'pending' ? ' — Uber is moving its orders to Food Hub (pending)' : '';
    await logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'store_status', action: off ? 'platform_deprovisioned' : 'platform_provisioned', status: off ? 'failed' : who ? 'info' : 'success', channel: 'uber_eats',
      brandName: store?.brandName, locationCode: store?.locationCode, storeId: store?.id,
      summary: off ? `Uber Eats disconnected store ${store ? `${store.brandName} · ${store.locationCode}` : storeId} from Food Hub — orders will no longer arrive here. Reconnect it under Stores.`
        : `Uber Eats connected store ${store ? `${store.brandName} · ${store.locationCode}` : storeId} to Food Hub${who}${body.perform_refresh_menu === true ? '. Uber asks for the menu: Menus → All Uber stores' : ''}` });
    return { result: off ? 'store disconnected' : 'store connected' };
  }
  if (event === 'store.status.changed') {
    const repo = getRepo();
    const store = await repo.findStore('uber_eats', uberEventResource(body));
    if (!store) return { result: 'store not mapped — ignored' };
    const online = String(body.meta?.status || '').toUpperCase() === 'ONLINE';
    const platformStatus: PlatformStatus = { state: online ? 'online' : 'paused', detail: online ? undefined : String(body.meta?.status || 'Changed on Uber Eats'), until: null, checkedAt: nowIso(), source: 'webhook' };
    await repo.updateStore(store.id, { online, lastStatusSource: 'uber_eats:webhook', meta: { ...store.meta, platformStatus } });
    if (store.online !== online) {
      await logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'store_status', action: online ? 'platform_online' : 'platform_paused', status: online ? 'success' : 'info',
        channel: 'uber_eats', brandName: store.brandName, locationCode: store.locationCode, storeId: store.id, summary: `${store.brandName} · ${store.locationCode} on Uber Eats is now ${online ? 'online' : 'paused'}` });
    }
    return { result: `store ${online ? 'online' : 'paused'}` };
  }
  if (event === 'store.menu_refresh_request') {
    // Uber asks for the menu again (store re-activated, menu reset…): Food Hub is the menu's source, so publish it now
    // (a store marked "Do not touch", or whose menu is locked, is left alone by publishMenu — it reports it, sends nothing).
    const id = uberEventResource(body);
    const store = await getRepo().findStore('uber_eats', id);
    if (!store) return kept(body, 'Uber menu refresh request for a store that is not mapped', id || null);
    const rows = await publishMenu(store.brandName, { storeIds: [store.id], channels: ['uber_eats'], actor: { username: 'uber', name: 'Uber Eats (menu refresh)', source: 'platform' } });
    return { result: rows[0]?.result.message ?? 'menu refresh handled' };
  }
  if (NOTED.test(event)) {
    await logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'order', action: 'uber_event', status: 'info', channel: 'uber_eats', orderId: null, summary: `Uber Eats event ${event} noted${orderId ? ` for order ${orderId}` : ''} — no action needed` });
    return { result: 'noted' };
  }
  // Unknown event types are kept under Channels → Unparsed payloads, never dropped.
  await keepUnparsed('uber_eats', body, `Unhandled Uber event ${event || '(no event_type)'}`, orderId || null);
  return { result: 'kept: unknown event' };
}

/**
 * Runs one saved Uber webhook through the shared webhook inbox (lib/foodhub/inbox.ts) and records the outcome there.
 * A failure is retried by the inbox itself (30 s, 2 min — inside Uber's 11.5-minute accept window); after the last
 * automatic try it waits for Replay and raises the usual "webhook failed" alert. True when it was processed.
 */
export async function runUberWebhook(id: string): Promise<boolean> {
  const { runInboxEntry } = await import('../inbox');
  return (await runInboxEntry(id))?.status === 'done';
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
