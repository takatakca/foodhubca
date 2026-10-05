import { NextResponse, type NextRequest } from 'next/server';
import { parseUrbanPiperOrder, parseUrbanPiperStatus, verifyUrbanPiperWebhook } from '@/lib/foodhub/adapters/urbanpiper';
import { applyExternalStatus } from '@/lib/foodhub/pipeline';
import { background, keepUnparsed, parseJson, queueOrder } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';

// UrbanPiper (Atlas → Webhooks) → Food Hub. Two events use this one address:
//   "Order Placed"        → the order enters the normal pipeline (Clover ticket, kitchen screen, alerts)
//   "Order Status Change" → cancellations / completion made on the platform or in UrbanPiper
// Protected by ?token=<URBANPIPER_WEBHOOK_SECRET> (or the same value in an Authorization / X-Api-Key header).
// UrbanPiper retries anything that is not 2xx, so we answer quickly and work after the response.
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  if (!verifyUrbanPiperWebhook(req.headers, url)) return NextResponse.json({ ok: false, error: 'Webhook token check failed for UrbanPiper.' }, { status: 401 });
  const body = parseJson(await req.text());
  if (body === undefined) return NextResponse.json({ ok: false }, { status: 400 });

  if (body?.order?.details) {
    const parsed = parseUrbanPiperOrder(body);
    if ('ignored' in parsed) return NextResponse.json({ ok: true, ignored: parsed.ignored });
    queueOrder(parsed.order);
    return NextResponse.json({ ok: true, order_ref_id: parsed.order.externalOrderId });
  }

  const status = parseUrbanPiperStatus(body);
  if (status) {
    background(`urbanpiper status ${status.externalOrderId}`, () => applyExternalStatus(status.channel, status.externalOrderId, status.state, { reason: status.message, source: 'urbanpiper' }));
    return NextResponse.json({ ok: true });
  }

  background('keep unparsed urbanpiper', () => keepUnparsed('skip', body, 'UrbanPiper payload shape not recognized'));
  return NextResponse.json({ ok: true, stored: 'unparsed' });
}
