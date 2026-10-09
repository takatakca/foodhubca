import { NextResponse, type NextRequest } from 'next/server';
import { skipAdapter } from '@/lib/foodhub/adapters/skip';
import { handleSkipModificationCallback } from '@/lib/foodhub/skip-ops';
import { background, keepUnparsed, parseJson, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// JET Connect result of an order modification (out of stock / substitution / weight):
//   { orderId, type: "success" }  or  { orderId, type: "failure", errors: [{ errorCode, … }] }
// A failure raises an alert on the order: the customer was not given the change.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!skipAdapter.verifyWebhook(req.headers, raw)) return unauthorized('skip');
  const body = parseJson(raw);
  if (body === undefined) return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  const reference = String(body?.orderId ?? body?.orderID ?? '') || null;
  background('skip modification callback', async () => {
    const r = await handleSkipModificationCallback(body);
    if (r.keep) await keepUnparsed('skip', body, r.keep, reference);
  }, { channel: 'skip', body, reference, kind: 'order' });
  return NextResponse.json(body, { status: 200 });
}
