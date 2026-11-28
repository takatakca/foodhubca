import { NextResponse, type NextRequest } from 'next/server';
import { parseSkipOrder, skipAdapter } from '@/lib/foodhub/adapters/skip';
import { handleSkipFinalOrder } from '@/lib/foodhub/skip-ops';
import { background, keepUnparsed, parseJson, SKIP_FINAL_PICKED_NOTICE, unauthorized } from '@/lib/foodhub/webhook-utils';
import { readTextOr413 } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// JET Connect "Final Picked Order": for brands that may amend an order (items out of stock), JET sends a copy of the
// order in its final state once it was delivered. Switched on by the Skip brand manager. Food Hub keeps the real total.
export async function POST(req: NextRequest) {
  const read = await readTextOr413(req);
  if ('response' in read) return read.response;
  const raw = read.text;
  if (!skipAdapter.verifyWebhook(req.headers, raw)) return unauthorized('skip');
  const body = parseJson(raw);
  if (body === undefined) return NextResponse.json({ errorMessage: 'Invalid JSON' }, { status: 400 });
  let order: ReturnType<typeof parseSkipOrder> = null;
  try { order = parseSkipOrder(body); } catch { order = null; }
  if (!order) {
    background('keep unparsed skip final order', () => keepUnparsed('skip', body, 'JET Connect final picked order missing id/items', null, SKIP_FINAL_PICKED_NOTICE));
    return NextResponse.json({ errorMessage: 'Unrecognized final order payload' }, { status: 400 });
  }
  const final = order;
  background(`skip final order ${final.externalOrderId}`, async () => {
    const r = await handleSkipFinalOrder(final);
    if (r.keep) await keepUnparsed('skip', body, r.keep, final.externalOrderId, SKIP_FINAL_PICKED_NOTICE);
  }, { channel: 'skip', body, reference: final.externalOrderId, kind: 'order', notice: SKIP_FINAL_PICKED_NOTICE });
  return NextResponse.json({ OrderId: final.externalOrderId }, { status: 200 });
}
