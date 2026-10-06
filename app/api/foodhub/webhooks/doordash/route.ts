import { NextResponse, type NextRequest } from 'next/server';
import { doorDashAdapter, parseDoorDashOrder } from '@/lib/foodhub/adapters/doordash';
import { applyCourierUpdate, doorDashCourierDetails, doorDashCourierStatus } from '@/lib/foodhub/courier';
import { menuCallbackOutcome } from '@/lib/foodhub/ops';
import { applyExternalStatus } from '@/lib/foodhub/pipeline';
import { getRepo } from '@/lib/foodhub/repo';
import { background, keepUnparsed, parseJson, queueOrder, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// DoorDash webhook subscriptions (Developer Portal): Order Create, Order Cancel, Menu Status, Dasher Status.
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
  const menuReference = String(body.event?.reference || body.reference || '');
  if (eventType.includes('menu') || (menuReference && (body.menu?.id || body.menu_id))) {
    background('doordash menu status', async () => {
      const msid = menuReference.startsWith('takatak-') ? menuReference.slice('takatak-'.length).replace(/-\d+$/, '') : String(body.store?.merchant_supplied_id || '');
      const menuId = body.menu?.id || body.menu_id;
      const repo = getRepo();
      const store = msid ? await repo.findStore('doordash', msid) : null;
      if (store && menuId) await repo.updateStore(store.id, { meta: { ...store.meta, doordashMenuId: String(menuId), lastMenuStatus: body } });
      // Close the queued "menu push" job only on an explicit success/failure; otherwise it stays queued and the callback is kept.
      const job = menuReference ? await repo.findJobByReference(menuReference) : null;
      if (job && job.status === 'queued') {
        const outcome = menuCallbackOutcome(body);
        await repo.updateJob(job.id, { ...(outcome ? { status: outcome === 'success' ? 'done' : 'error' } : {}), result: { ...(job.result ?? {}), callback: body } });
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

  if (eventType.includes('cancel') || body.cancel_reason || body.cancellation_reason) {
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
  queueOrder(order);
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
