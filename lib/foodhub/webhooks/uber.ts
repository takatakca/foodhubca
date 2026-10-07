// Uber Eats webhook events, processed from the webhook inbox (inbox.ts) — the route only checks the signature, saves
// the raw event and answers 200. The same code runs for a live delivery, an automatic retry and an owner's Replay, and
// throws when the event could not be processed, so the inbox keeps it and tries again.
import { logActivity } from '../activity';
import { fetchUberOrder, parseUberOrder } from '../adapters/uber-eats';
import { nowIso } from '../config';
import { applyCourierUpdate, readPending, uberCourierState } from '../courier';
import { publishMenu } from '../ops';
import { applyExternalStatus, processIncomingOrder } from '../pipeline';
import { handleUberReportWebhook } from '../recon/automation';
import { getRepo } from '../repo';
import type { PlatformStatus } from '../types';
import { keepUnparsed } from '../webhook-utils';

/** What the inbox should remember about the outcome (shown on Settings → Platforms → Webhook inbox). */
export type HandlerOutcome = { result: string; orderId?: string | null };

export function uberEventKind(body: any): string {
  return String(body?.event_type || '');
}

export async function handleUberWebhook(body: any): Promise<HandlerOutcome> {
  const event = uberEventKind(body);
  const orderId = String(body?.meta?.resource_id || '');

  if (event === 'orders.notification' || event === 'orders.scheduled.notification') {
    const href = body.resource_href || orderId;
    if (!href) { await keepUnparsed('uber_eats', body, 'Uber order notification without an order id'); return { result: 'kept: no order id' }; }
    // One quick retry here; the inbox retries again at 30 s and 2 min (Uber does not resend the notification).
    const details = await fetchUberOrder(href).catch(() => fetchUberOrder(href));
    const order = parseUberOrder(details, body.meta?.user_id);
    if (!order) { await keepUnparsed('uber_eats', details, 'Uber order details could not be parsed', orderId || null); return { result: 'kept: order details unreadable' }; }
    const out = await processIncomingOrder(order);
    return { result: out.duplicate ? 'duplicate (already received)' : `order received${out.pos?.ok ? ', in Clover' : out.pos?.error ? `, Clover: ${out.pos.error}` : ''}`, orderId: out.order.id };
  }
  if (event === 'orders.cancel' || event === 'orders.failure') {
    const o = await applyExternalStatus('uber_eats', orderId, 'cancelled', { event });
    return { result: o ? 'cancellation applied' : 'cancellation kept until the order arrives', orderId: o?.id ?? null };
  }
  if (event === 'delivery.state_changed') {
    // Courier state from the webhook itself (body.meta.status); anything we cannot map with confidence is kept, not guessed.
    const rawState = body.meta?.status ?? body.delivery?.status ?? body.delivery?.current_status ?? body.status;
    const status = uberCourierState(rawState);
    if (!status || !orderId) { await keepUnparsed('uber_eats', body, `Uber delivery state not recognized (${String(rawState ?? 'missing')})`, orderId || null); return { result: 'kept: courier state not recognized' }; }
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
    const storeId = String(body.meta?.resource_id || body.store_id || body.meta?.store_id || '');
    const store = storeId ? await repo.findStore('uber_eats', storeId) : null;
    const off = event === 'store.deprovisioned';
    if (store) await repo.updateStore(store.id, { meta: { ...store.meta, provisioned: !off, awaitingProvision: false, provisionChangedAt: nowIso() } });
    await logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'store_status', action: off ? 'platform_deprovisioned' : 'platform_provisioned', status: off ? 'failed' : 'success', channel: 'uber_eats',
      brandName: store?.brandName, locationCode: store?.locationCode, storeId: store?.id,
      summary: off ? `Uber Eats disconnected store ${store ? `${store.brandName} · ${store.locationCode}` : storeId} from Food Hub — orders will no longer arrive here. Reconnect it under Stores.` : `Uber Eats connected store ${store ? `${store.brandName} · ${store.locationCode}` : storeId} to Food Hub` });
    return { result: off ? 'store disconnected' : 'store connected' };
  }
  if (event === 'store.status.changed') {
    const repo = getRepo();
    const store = await repo.findStore('uber_eats', String(body.meta?.resource_id || body.store_id || ''));
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
    // Uber asks for the menu again (store re-activated, menu reset…): Food Hub is the menu's source, so publish it now —
    // except to a store whose menu is locked (publishMenu reports it, sends nothing).
    const store = await getRepo().findStore('uber_eats', String(body.store_id || body.meta?.resource_id || ''));
    if (!store) { await keepUnparsed('uber_eats', body, 'Uber menu refresh request for a store that is not mapped', String(body.store_id || '') || null); return { result: 'kept: store not mapped' }; }
    const rows = await publishMenu(store.brandName, { storeIds: [store.id], channels: ['uber_eats'], actor: { username: 'uber', name: 'Uber Eats (menu refresh)', source: 'platform' } });
    return { result: rows[0]?.result.message ?? 'menu refresh handled' };
  }
  if (/^orders\.release$|^orders\.fulfillment_issues/.test(event)) {
    // Routine Uber events with nothing to do here: noted, not an alert.
    await logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'order', action: 'uber_event', status: 'info', channel: 'uber_eats', orderId: null, summary: `Uber Eats event ${event} noted${orderId ? ` for order ${orderId}` : ''} — no action needed` });
    return { result: 'noted' };
  }
  // Unknown event types are kept under Channels → Unparsed payloads, never dropped.
  await keepUnparsed('uber_eats', body, `Unhandled Uber event ${event || '(no event_type)'}`, orderId || null);
  return { result: 'kept: unknown event' };
}
