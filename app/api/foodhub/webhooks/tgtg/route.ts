import { NextResponse } from 'next/server';
import { parseGenericOrder, tgtgAdapter } from '@/lib/foodhub/adapters/partner';
import { getRepo } from '@/lib/foodhub/repo';
import { applyBagCountEvent, applyTgtgEvent, parseTgtgEvent } from '@/lib/foodhub/tgtg-feed';
import { background, keepUnparsed, parseJson, queueOrder, retryLater, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Too Good To Go notifications from a feed (a partner, an automation forwarding the Store app / e-mail alerts). Token protected.
// One notification or a list of them. Each is read by meaning (lib/foodhub/tgtg-feed.ts):
//   reserved   → an order for the kitchen (the normal pipeline)         cancelled → the order is cancelled
//   collected  → pickup confirmed, the order is completed                no_show   → completed and flagged (the bag is paid)
//   bag_count  → a day summary: bags offered / sold / collected → the bag log
// Unknown shapes are kept under Channels → Unparsed payloads, never lost.
export async function POST(req: Request) {
  const raw = await req.text();
  if (!tgtgAdapter.verifyWebhook(req.headers, raw)) return unauthorized('tgtg');
  const body = parseJson(raw);
  if (body === undefined) return NextResponse.json({ ok: false }, { status: 400 });
  const list: unknown[] = Array.isArray(body) ? body : [body];
  const outcome: Array<{ kind: string; stored?: string; applied?: boolean }> = [];
  for (const item of list.slice(0, 200)) {
    const ev = parseTgtgEvent(item);
    const order = parseGenericOrder('tgtg', 'tgtg', item);
    if (ev.kind === 'bag_count') {
      background('tgtg bag count', () => applyBagCountEvent(ev), { channel: 'tgtg', body: item, kind: 'order' });
      outcome.push({ kind: 'bag_count' });
      continue;
    }
    const closing = ev.kind === 'cancelled' || ev.kind === 'collected' || ev.kind === 'no_show';
    // A full order snapshot of a new order is an order first; a status for a known order (or without order details) is a status.
    const known = ev.orderId ? await getRepo().findOrder('tgtg', ev.orderId) : null;
    if (closing && (ev.kind === 'cancelled' || known || !order)) {
      background(`tgtg ${ev.kind} ${ev.orderId ?? ''}`, async () => {
        const r = await applyTgtgEvent(ev);
        if (!r.applied && !ev.orderId) await keepUnparsed('tgtg', item, `Too Good To Go ${ev.kind} without an order id`);
      }, { channel: 'tgtg', body: item, reference: ev.orderId ?? null, kind: 'order' });
      outcome.push({ kind: ev.kind, applied: true });
      continue;
    }
    if (!order) {
      background('keep unparsed tgtg', () => keepUnparsed('tgtg', item, 'Payload shape not recognized yet'));
      outcome.push({ kind: 'unknown', stored: 'unparsed' });
      continue;
    }
    if (!(await queueOrder(order))) return retryLater('tgtg');
    outcome.push({ kind: ev.kind === 'unknown' ? 'reserved' : ev.kind });
  }
  if (outcome.length === 1 && outcome[0].stored) return NextResponse.json({ ok: true, stored: outcome[0].stored });
  return NextResponse.json({ ok: true, events: outcome });
}
