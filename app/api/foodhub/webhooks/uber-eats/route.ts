import { NextResponse, type NextRequest } from 'next/server';
import { uberEatsAdapter } from '@/lib/foodhub/adapters/uber-eats';
import { applyExternalStatus } from '@/lib/foodhub/pipeline';
import { logActivity } from '@/lib/foodhub/activity';
import { nowIso } from '@/lib/foodhub/config';
import { applyCourierUpdate, readPending } from '@/lib/foodhub/courier';
import { handleUberReportWebhook } from '@/lib/foodhub/recon/automation';
import { publishMenu } from '@/lib/foodhub/ops';
import { getRepo } from '@/lib/foodhub/repo';
import type { PlatformStatus } from '@/lib/foodhub/types';
import { background, intakeUnavailable, keepUnparsed, parseJson, queueUberOrder, uberDeliveryStatus, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
// The deferred pipeline (Uber fetch + Clover + accept) runs in after(): give it the same budget as the cron routes.
export const maxDuration = 60;

// Uber Eats Primary Webhook URL. Uber signs every request with X-Uber-Signature
// (HMAC-SHA256 of the raw body, keyed with the app client secret) and expects a fast 200.
// Orders must be accepted/denied within 11.5 minutes — Food Hub does it automatically.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!uberEatsAdapter.verifyWebhook(req.headers, raw)) return unauthorized('uber_eats');
  const body = parseJson(raw);
  if (body === undefined) return NextResponse.json({ ok: false }, { status: 400 });

  const event = String(body.event_type || '');
  const orderId = String(body.meta?.resource_id || '');

  const ctx = (kind: 'order' | 'settings' | 'store_status' | 'menu_publish', reference: string | null = orderId || null) => ({ channel: 'uber_eats' as const, body, reference, kind });

  if (event === 'orders.notification' || event === 'orders.scheduled.notification') {
    // Uber does not resend the notification: it is saved in the order inbox before the 200 (fetch + pipeline run
    // after it, and again after a server restart). Not saved → 503 so Uber retries.
    if (!(await queueUberOrder(orderId, String(body.resource_href || orderId), body.meta?.user_id, body))) return intakeUnavailable();
  } else if (event === 'orders.cancel' || event === 'orders.failure') {
    background(`uber cancel ${orderId}`, () => applyExternalStatus('uber_eats', orderId, 'cancelled', { event }), ctx('order'));
  } else if (event === 'delivery.state_changed') {
    // Courier state from the webhook itself (body.meta.status); anything we cannot map with confidence is kept, not guessed.
    const rawState = body.meta?.status ?? body.delivery?.status ?? body.delivery?.current_status ?? body.status;
    const status = uberDeliveryStatus(rawState);
    background(`uber courier ${orderId}`, async () => {
      if (!status || !orderId) return keepUnparsed('uber_eats', body, `Uber delivery state not recognized (${String(rawState ?? 'missing')})`, orderId || null);
      const saved = await applyCourierUpdate('uber_eats', orderId, { status }, 'uber_eats:delivery.state_changed');
      if (!saved && !(await readPending('uber_eats', orderId))) await keepUnparsed('uber_eats', body, 'Uber courier update for an order Food Hub does not have', orderId);
    }, ctx('order'));
  } else if (event.startsWith('eats.report') || event.includes('report')) {
    // Reporting API: the requested payment report is ready → download, import, reconcile.
    if (/fail|error/i.test(event)) {
      background('uber report failed', () => logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'settings', action: 'uber_report_failed', status: 'failed', channel: 'uber_eats', summary: `Uber could not build the requested report (${event})` }));
    } else background('uber report', () => handleUberReportWebhook(body), ctx('settings', String(body.workflow_id || '') || null));
  } else if (event === 'store.provisioned' || event === 'store.deprovisioned') {
    background(`uber ${event}`, async () => {
      const repo = getRepo();
      const storeId = String(body.meta?.resource_id || body.store_id || body.meta?.store_id || '');
      const store = storeId ? await repo.findStore('uber_eats', storeId) : null;
      const off = event === 'store.deprovisioned';
      if (store) await repo.updateStore(store.id, { meta: { ...store.meta, provisioned: !off, awaitingProvision: false, provisionChangedAt: nowIso() } });
      await logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'store_status', action: off ? 'platform_deprovisioned' : 'platform_provisioned', status: off ? 'failed' : 'success', channel: 'uber_eats',
        brandName: store?.brandName, locationCode: store?.locationCode, storeId: store?.id,
        summary: off ? `Uber Eats disconnected store ${store ? `${store.brandName} · ${store.locationCode}` : storeId} from Food Hub — orders will no longer arrive here. Reconnect it under Stores.` : `Uber Eats connected store ${store ? `${store.brandName} · ${store.locationCode}` : storeId} to Food Hub` });
    }, ctx('store_status'));
  } else if (event === 'store.status.changed') {
    background('uber store status', async () => {
      const repo = getRepo();
      const store = await repo.findStore('uber_eats', String(body.meta?.resource_id || body.store_id || ''));
      if (!store) return;
      const online = String(body.meta?.status || '').toUpperCase() === 'ONLINE';
      const platformStatus: PlatformStatus = { state: online ? 'online' : 'paused', detail: online ? undefined : String(body.meta?.status || 'Changed on Uber Eats'), until: null, checkedAt: nowIso(), source: 'webhook' };
      await repo.updateStore(store.id, { online, lastStatusSource: 'uber_eats:webhook', meta: { ...store.meta, platformStatus } });
      if (store.online !== online) {
        await logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'store_status', action: online ? 'platform_online' : 'platform_paused', status: online ? 'success' : 'info',
          channel: 'uber_eats', brandName: store.brandName, locationCode: store.locationCode, storeId: store.id, summary: `${store.brandName} · ${store.locationCode} on Uber Eats is now ${online ? 'online' : 'paused'}` });
      }
    }, ctx('store_status'));
  } else if (event === 'store.menu_refresh_request') {
    // Uber asks for the menu again (store re-activated, menu reset…): Food Hub is the menu's source, so publish it now.
    background('uber menu refresh', async () => {
      const store = await getRepo().findStore('uber_eats', String(body.store_id || body.meta?.resource_id || ''));
      if (!store) return keepUnparsed('uber_eats', body, 'Uber menu refresh request for a store that is not mapped', String(body.store_id || '') || null);
      await publishMenu(store.brandName, { storeIds: [store.id], channels: ['uber_eats'], actor: { username: 'uber', name: 'Uber Eats (menu refresh)', source: 'platform' } });
    }, ctx('menu_publish'));
  } else if (/^orders\.release$|^orders\.fulfillment_issues/.test(event)) {
    // Routine Uber events with nothing to do here (release of a scheduled order, menu refresh request): noted, not an alert.
    background(`uber ${event}`, () => logActivity({ actor: 'Uber Eats', source: 'platform', kind: 'order', action: 'uber_event', status: 'info', channel: 'uber_eats', orderId: null, summary: `Uber Eats event ${event} noted${orderId ? ` for order ${orderId}` : ''} — no action needed` }));
  } else {
    // Unknown event types are kept under Channels → Unparsed payloads, never dropped.
    background(`uber ${event || 'unknown'} event`, () => keepUnparsed('uber_eats', body, `Unhandled Uber event ${event || '(no event_type)'}`, orderId || null));
  }
  return new NextResponse(null, { status: 200 });
}
