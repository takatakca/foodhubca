import { NextResponse, type NextRequest } from 'next/server';
import { parseSkipOrder, skipAdapter } from '@/lib/foodhub/adapters/skip';
import { background, keepUnparsed, parseJson, queueOrder, retryLater, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// JET Connect "Receive Order" for SkipTheDishes. Signed with X-JET-Connect-Hash.
// We answer 202 (async) immediately; Food Hub then creates the order in Clover and calls
// sent-to-pos-success (or sent-to-pos-failed → Skip tablet) well inside JET's 5-minute window.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!skipAdapter.verifyWebhook(req.headers, raw)) return unauthorized('skip');
  const body = parseJson(raw);
  if (body === undefined) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  let order: ReturnType<typeof parseSkipOrder> = null;
  try {
    order = parseSkipOrder(body);
  } catch (e) {
    // A payload shape we cannot read must never be lost to a 500: keep it, and let JET fail the injection
    // (non-2xx) so the order goes to the Skip tablet straight away instead of waiting for the 5-minute timeout.
    background('keep unparsed skip order', () => keepUnparsed('skip', body, `JET Connect order could not be read: ${e instanceof Error ? e.message : String(e)}`));
    return NextResponse.json({ errorMessage: 'Unreadable order payload', error: 'Unreadable order payload' }, { status: 400 });
  }
  if (!order) {
    background('keep unparsed skip order', () => keepUnparsed('skip', body, 'JET Connect order missing id/items'));
    return NextResponse.json({ errorMessage: 'Unrecognized order payload', error: 'Unrecognized order payload' }, { status: 400 });
  }
  if (!(await queueOrder(order))) return retryLater('skip');
  // JET: a 202 carries { OrderId }; sent-to-pos-success / -failed then settles the order within 5 minutes.
  return NextResponse.json({ OrderId: order.externalOrderId }, { status: 202 });
}
