import { NextResponse, type NextRequest } from 'next/server';
import { parseRelayOrder, parseRelayStatus, relayStatusApplies, verifyRelayWebhook } from '@/lib/foodhub/adapters/relay';
import { acceptNeedsClover, applyExternalStatus } from '@/lib/foodhub/pipeline';
import { getRepo } from '@/lib/foodhub/repo';
import { background, intakeUnavailable, keepUnparsed, parseJson, queueOrder } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Food Hub Order Relay: partners that push orders (a Too Good To Go feed, a delivery partner…) post here.
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
    let parsed: ReturnType<typeof parseRelayOrder>;
    try { parsed = parseRelayOrder(body); } catch (error) {
      parsed = { ignored: `Relay order could not be read: ${error instanceof Error ? error.message : String(error)}` };
    }
    if ('ignored' in parsed) {
      // Never lost: kept under Channels → Unparsed payloads (and flagged in the Command Center); 200 so it is not retried forever.
      const ref = body?.order?.details?.id;
      const reason = parsed.ignored;
      background('keep ignored relay order', () => keepUnparsed(parsed.channel ?? 'tgtg', body, `Relay: ${reason}`, ref !== undefined && ref !== null ? String(ref) : null));
      return NextResponse.json({ ok: true, ignored: reason, stored: 'unparsed' });
    }
    // Saved before the 2xx (a server restart loses nothing); not saved → 503 and the sender retries.
    if (!(await queueOrder(parsed.order))) return intakeUnavailable();
    return NextResponse.json({ ok: true, order_ref_id: parsed.order.externalOrderId });
  }

  const status = parseRelayStatus(body);
  if (status) {
    background(`relay status ${status.externalOrderId}`, async () => {
      const order = await getRepo().findOrder(status.channel, status.externalOrderId);
      if (!order) return keepUnparsed(status.channel, body, 'Relay status for an order Food Hub does not have (yet)', status.externalOrderId);
      // Forward-only: a late or repeated delivery never moves an order back or reopens a closed one.
      if (!relayStatusApplies(order, status.state, { needsClover: acceptNeedsClover(order) })) {
        await getRepo().addEvent(order.id, 'platform_status_ignored', { state: status.state, reason: status.message, source: 'relay', note: `Not applied: the order is already ${order.status}.` });
        return;
      }
      return applyExternalStatus(status.channel, status.externalOrderId, status.state, { reason: status.message, source: 'relay' });
    }, { channel: status.channel, body, reference: status.externalOrderId, kind: 'order' });
    return NextResponse.json({ ok: true });
  }

  background('keep unparsed relay', () => keepUnparsed('tgtg', body, 'Relay payload shape not recognized'));
  return NextResponse.json({ ok: true, stored: 'unparsed' });
}
