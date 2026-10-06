import { NextResponse, type NextRequest } from 'next/server';
import { parseRelayOrder, parseRelayStatus, verifyRelayWebhook } from '@/lib/foodhub/adapters/relay';
import { applyExternalStatus } from '@/lib/foodhub/pipeline';
import { background, keepUnparsed, parseJson, queueOrder } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Food Hub Order Relay: partners that push orders (a Too Good To Go feed, an ordering website…) post here.
//   order payload ({ order: { details, items, store } }) → the order enters the normal pipeline (Clover ticket, kitchen)
//   status payload ({ order_id, new_state, … })          → cancellations / completion made on the partner side
// Protected by ?token=<FOODHUB_RELAY_SECRET> (or the same value in an Authorization / X-Api-Key header).
// Senders retry anything that is not 2xx, so we answer quickly and work after the response.
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  if (!verifyRelayWebhook(req.headers, url)) return NextResponse.json({ ok: false, error: 'Webhook token check failed for the Food Hub relay.' }, { status: 401 });
  const body = parseJson(await req.text());
  if (body === undefined) return NextResponse.json({ ok: false }, { status: 400 });

  if (body?.order?.details) {
    const parsed = parseRelayOrder(body);
    if ('ignored' in parsed) return NextResponse.json({ ok: true, ignored: parsed.ignored });
    queueOrder(parsed.order);
    return NextResponse.json({ ok: true, order_ref_id: parsed.order.externalOrderId });
  }

  const status = parseRelayStatus(body);
  if (status) {
    background(`relay status ${status.externalOrderId}`, () => applyExternalStatus(status.channel, status.externalOrderId, status.state, { reason: status.message, source: 'relay' }), { channel: status.channel, body, reference: status.externalOrderId, kind: 'order' });
    return NextResponse.json({ ok: true });
  }

  background('keep unparsed relay', () => keepUnparsed('tgtg', body, 'Relay payload shape not recognized'));
  return NextResponse.json({ ok: true, stored: 'unparsed' });
}
