import { NextResponse, type NextRequest } from 'next/server';
import { doorDashAdapter, parseDoorDashOrder } from '@/lib/foodhub/adapters/doordash';
import { applyCourierUpdate, doorDashCourierDetails, doorDashCourierStatus } from '@/lib/foodhub/courier';
import { menuCallbackOutcome } from '@/lib/foodhub/ops';
import { applyExternalStatus } from '@/lib/foodhub/pipeline';
import { getRepo } from '@/lib/foodhub/repo';
import { background, keepUnparsed, parseJson, queueOrder, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// DoorDash webhook subscriptions (Developer Portal): Order Create, Menu Status, Dasher Status — and ask DoorDash to point the
// Order Cancellation webhook here too. Menu Request (menu pull) is GET /api/foodhub/webhooks/doordash/menu/<location id>.
// Point all of them at this URL with Authorization header = DOORDASH_WEBHOOK_SECRET.
// Unknown shapes are kept under Channels → Unparsed payloads (200, so DoorDash does not retry); only invalid JSON gets 400.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!doorDashAdapter.verifyWebhook(req.headers, raw)) return unauthorized('doordash');
  const body = parseJson(raw);
  if (body === undefined) {
    background('keep unparsed doordash', () => keepUnparsed('doordash', { raw: raw.slice(0, 20_000) }, 'Invalid JSON'));
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const eventType = String(body.event?.type || body.event_type || body.type || '').toLowerCase();

  // Menu Status webhook → remember the DoorDash menu id so later pushes PATCH instead of POST.
  // Documented shape: { event: { type: MenuCreate|MenuUpdate, status: SUCCESS|FAILURE, reference, details }, menu: { id }, store? }.
  const menuReference = String(body.event?.reference ?? body.reference ?? '');
  if (eventType.includes('menu') || (menuReference && (body.menu?.id || body.menu_id))) {
    const reference = menuReference;
    background('doordash menu status', async () => {
      const repo = getRepo();
      const job = reference ? await repo.findJobByReference(reference) : null;
      // Store: from our own reference (takatak-<msid>-<ts>), the payload, or the job that pushed the menu.
      const msid = reference.startsWith('takatak-') ? reference.slice('takatak-'.length).replace(/-\d+$/, '')
        : String(body.store?.merchant_supplied_id || job?.request?.channelStoreId || '');
      const menuId = body.menu?.id || body.menu_id;
      const store = msid ? await repo.findStore('doordash', msid) : null;
      // DoorDash can return the menu id even on FAILURE: keep it so the next push updates that menu.
      if (store && menuId) await repo.updateStore(store.id, { meta: { ...store.meta, doordashMenuId: String(menuId), lastMenuStatus: body } });
      if (!job) {
        await keepUnparsed('doordash', body, reference ? 'DoorDash menu status for a menu push Food Hub does not know' : 'DoorDash menu status without a reference', reference || null);
        return;
      }
      // Close the queued "menu push" job only on an explicit success/failure; otherwise it stays queued and the callback is kept.
      if (job.status === 'queued') {
        const outcome = menuCallbackOutcome(body);
        const details = String(body.event?.details ?? body.details ?? '').trim();
        const message = outcome === 'failed' ? `DoorDash refused the menu${details ? `: ${details.slice(0, 300)}` : ''}` : outcome === 'success' ? 'Menu published on DoorDash' : undefined;
        await repo.updateJob(job.id, { ...(outcome ? { status: outcome === 'success' ? 'done' : 'error' } : {}), result: { ...(job.result ?? {}), ...(message ? { message } : {}), callback: body } });
        if (!outcome) await keepUnparsed('doordash', body, 'Menu-status callback without an explicit success/failure indicator — menu push left queued', reference);
      }
    }, { channel: 'doordash', body, reference: reference || null, kind: 'menu_publish' });
    return NextResponse.json({ ok: true });
  }

  // Dasher Status webhooks: { event: { type: 'dasher_status_update' }, dasher_status: dasher_confirmed | arriving_at_store |
  // arrived_at_store | dasher_out_for_delivery | dropoff, external_order_id, … } (older shapes carry it in event.type).
  const courierStatus = doorDashCourierStatus(String(body.dasher_status ?? body.event?.dasher_status ?? '')) ?? doorDashCourierStatus(eventType);
  if (courierStatus) {
    const id = String(body.external_order_id || body.order?.id || body.order_id || body.id || '');
    background(`doordash dasher ${id}`, () => applyCourierUpdate('doordash', id, { status: courierStatus, ...doorDashCourierDetails(body) }, `doordash:${eventType}`), { channel: 'doordash', body, reference: id || null, kind: 'order' });
    return NextResponse.json({ ok: true });
  }

  // Order Cancellation webhook (DoorDash configures it on request): { external_order_id, client_order_id, store, is_asap } —
  // no event object. Consumer / Dasher / support cancellations must stop the kitchen and the Clover order.
  const isCancelPayload = !body.event && !body.order && body.external_order_id && !Array.isArray(body.categories) && !body.dasher_status;
  if (eventType.includes('cancel') || isCancelPayload) {
    const id = String(body.external_order_id || body.order?.id || body.order_id || body.id || '');
    background(`doordash cancel ${id}`, () => applyExternalStatus('doordash', id, 'cancelled', { event: eventType || 'order_cancelled', ...(body.client_order_id ? { clientOrderId: String(body.client_order_id) } : {}), ...(body.cancel_reason || body.reason ? { reason: String(body.cancel_reason ?? body.reason) } : {}) }), { channel: 'doordash', body, reference: id || null, kind: 'order' });
    return NextResponse.json({ ok: true });
  }

  const order = parseDoorDashOrder(body);
  if (!order) {
    background('keep unparsed doordash', () => keepUnparsed('doordash', body, 'Unrecognized DoorDash payload'));
    return NextResponse.json({ ok: true, stored: 'unparsed' });
  }
  queueOrder(order);
  return NextResponse.json({ ok: true });
}
