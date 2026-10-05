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
  if (eventType.includes('menu') || (body.reference && (body.menu?.id || body.menu_id))) {
    const reference = String(body.reference || '');
    background('doordash menu status', async () => {
      const msid = reference.startsWith('takatak-') ? reference.slice('takatak-'.length).replace(/-\d+$/, '') : String(body.store?.merchant_supplied_id || '');
      const menuId = body.menu?.id || body.menu_id;
      const repo = getRepo();
      const store = msid ? await repo.findStore('doordash', msid) : null;
      if (store && menuId) await repo.updateStore(store.id, { meta: { ...store.meta, doordashMenuId: String(menuId), lastMenuStatus: body } });
      // Close the queued "menu push" job only on an explicit success/failure; otherwise it stays queued and the callback is kept.
      const job = reference ? await repo.findJobByReference(reference) : null;
      if (job && job.status === 'queued') {
        const outcome = menuCallbackOutcome(body);
        await repo.updateJob(job.id, { ...(outcome ? { status: outcome === 'success' ? 'done' : 'error' } : {}), result: { ...(job.result ?? {}), callback: body } });
        if (!outcome) await keepUnparsed('doordash', body, 'Menu-status callback without an explicit success/failure indicator — menu push left queued', reference);
      }
    }, { channel: 'doordash', body, reference: reference || null, kind: 'menu_publish' });
    return NextResponse.json({ ok: true });
  }

  // Dasher Status webhooks (dasher assigned, arriving at store, picked up, dropped off).
  const courierStatus = doorDashCourierStatus(eventType);
  if (courierStatus) {
    const id = String(body.order?.id || body.order_id || body.external_order_id || body.id || '');
    background(`doordash dasher ${id}`, () => applyCourierUpdate('doordash', id, { status: courierStatus, ...doorDashCourierDetails(body) }, `doordash:${eventType}`), { channel: 'doordash', body, reference: id || null, kind: 'order' });
    return NextResponse.json({ ok: true });
  }

  if (eventType.includes('cancel')) {
    const id = String(body.order?.id || body.order_id || body.id || '');
    background(`doordash cancel ${id}`, () => applyExternalStatus('doordash', id, 'cancelled', { event: eventType }), { channel: 'doordash', body, reference: id || null, kind: 'order' });
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
