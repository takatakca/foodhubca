import { NextResponse, type NextRequest } from 'next/server';
import { doorDashAdapter, parseDoorDashOrder } from '@/lib/foodhub/adapters/doordash';
import { applyCourierUpdate, doorDashCourierDetails, doorDashCourierStatus } from '@/lib/foodhub/courier';
import { menuCallbackOutcome } from '@/lib/foodhub/ops';
import { applyExternalStatus } from '@/lib/foodhub/pipeline';
import { getRepo } from '@/lib/foodhub/repo';
import { background, intakeUnavailable, keepUnparsed, parseJson, queueOrder, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// DoorDash webhook subscriptions (Developer Portal): Order Create, Menu Status, Dasher Status — and ask DoorDash to point the
// Order Cancellation webhook here too. Menu Request (menu pull) is GET /api/foodhub/webhooks/doordash/<location id>.
// Point all of them at this URL with Authorization header = DOORDASH_WEBHOOK_SECRET.
//
// Order Create is answered 202 (asynchronous confirmation): DoorDash treats a 200 as "order confirmed", which must
// only happen after Clover has the order — the pipeline confirms with PATCH /api/v1/orders/{id} once it does
// (DoorDash fails an order that is not confirmed within 3–8 minutes).
// Other unknown shapes are kept under Channels → Unparsed payloads (200, so DoorDash does not retry); only invalid
// JSON gets 400.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!doorDashAdapter.verifyWebhook(req.headers, raw)) return unauthorized('doordash');
  const body = parseJson(raw);
  if (body === undefined) {
    background('keep unparsed doordash', () => keepUnparsed('doordash', { raw: raw.slice(0, 20_000) }, 'Invalid JSON'));
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const eventType = String(body.event?.type || body.event_type || body.type || '').toLowerCase();
  // DoorDash's documented id field on cancel and Dasher events is external_order_id (= the DoorDash order id
  // the order arrived with); client_order_id is the merchant_supplied_id we sent when confirming.
  const doordashId = String(body.external_order_id || body.order?.external_order_id || body.order?.id || body.order_id || body.id || '');
  const clientOrderId = String(body.client_order_id || body.order?.client_order_id || '');

  // Menu Status webhook → remember the DoorDash menu id so later pushes PATCH instead of POST.
  // Documented shape: { event: { type: MenuCreate|MenuUpdate, status: SUCCESS|FAILURE, reference, details }, menu: { id }, store? }.
  const menuReference = String(body.event?.reference || body.reference || '');
  if (eventType.includes('menu') || (menuReference && (body.menu?.id || body.menu_id))) {
    background('doordash menu status', async () => {
      const repo = getRepo();
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
        return;
      }
      // Close the queued "menu push" job only on an explicit success/failure; otherwise it stays queued and the callback is kept.
      if (job.status === 'queued') {
        const outcome = menuCallbackOutcome(body);
        const details = String(body.event?.details ?? body.details ?? '').trim();
        const message = outcome === 'failed' ? `DoorDash refused the menu${details ? `: ${details.slice(0, 300)}` : ''}` : outcome === 'success' ? 'Menu published on DoorDash' : undefined;
        await repo.updateJob(job.id, { ...(outcome ? { status: outcome === 'success' ? 'done' : 'error' } : {}), result: { ...(job.result ?? {}), ...(message ? { message } : {}), callback: body } });
        if (!outcome) await keepUnparsed('doordash', body, 'Menu-status callback without an explicit success/failure indicator — menu push left queued', menuReference);
      }
    }, { channel: 'doordash', body, reference: menuReference || null, kind: 'menu_publish' });
    return NextResponse.json({ ok: true });
  }

  // Dasher Status webhooks: the state is in dasher_status (dasher_confirmed, arriving_at_store, arrived_at_store,
  // dasher_out_for_delivery, dropoff); older test payloads carried it in the event type.
  const courierStatus = doorDashCourierStatus(String(body.dasher_status || '')) ?? doorDashCourierStatus(eventType);
  if (courierStatus) {
    background(`doordash dasher ${doordashId}`, async () => {
      const id = doordashId || (await idFromClientOrderId(clientOrderId));
      await applyCourierUpdate('doordash', id, { status: courierStatus, ...doorDashCourierDetails(body) }, `doordash:${body.dasher_status || eventType}`);
    }, { channel: 'doordash', body, reference: doordashId || clientOrderId || null, kind: 'order' });
    return NextResponse.json({ ok: true });
  }

  // Order Cancellation webhook (DoorDash configures it on request) is documented as { external_order_id, client_order_id,
  // store, is_asap }: no event object and no reason. Consumer / Dasher / support cancellations must stop the kitchen.
  const isCancelPayload = !body.event && !body.order && Boolean(body.external_order_id) && !Array.isArray(body.categories) && !body.dasher_status;
  if (eventType.includes('cancel') || body.cancel_reason || body.cancellation_reason || isCancelPayload) {
    background(`doordash cancel ${doordashId || clientOrderId}`, async () => {
      const id = doordashId || (await idFromClientOrderId(clientOrderId));
      if (!id) return keepUnparsed('doordash', body, 'DoorDash cancellation without an order id Food Hub knows — check the order on the DoorDash tablet', clientOrderId || null);
      await applyExternalStatus('doordash', id, 'cancelled', { event: eventType || 'order_cancel', reason: body.cancel_reason || body.cancellation_reason });
    }, { channel: 'doordash', body, reference: doordashId || clientOrderId || null, kind: 'order' });
    return NextResponse.json({ ok: true });
  }

  const order = parseDoorDashOrder(body);
  if (!order) {
    // Never answer 200 to something that may be a new order: DoorDash would count it as confirmed.
    const looksLikeOrder = Boolean(body.order) || /order/.test(eventType);
    background('keep unparsed doordash', () => keepUnparsed('doordash', body, looksLikeOrder ? 'DoorDash order Food Hub could not read — not confirmed; DoorDash will fail it unless it is confirmed on the tablet' : 'Unrecognized DoorDash payload'));
    return NextResponse.json({ ok: true, stored: 'unparsed' }, { status: looksLikeOrder ? 202 : 200 });
  }
  // Saved in the order inbox before the 202 (a server restart loses nothing); not saved → 503, never a 2xx.
  if (!(await queueOrder(order))) return intakeUnavailable();
  return NextResponse.json({ ok: true }, { status: 202 });
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
