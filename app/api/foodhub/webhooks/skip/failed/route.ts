import { NextResponse, type NextRequest } from 'next/server';
import { parseSkipFailedOrder, skipAdapter } from '@/lib/foodhub/adapters/skip';
import { background, keepUnparsed, parseJson, retryLater, saveThenProcess, unauthorized } from '@/lib/foodhub/webhook-utils';
import { readTextOr413 } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// JET Connect sends this after routing an order directly to its own tablet.
export async function POST(req: NextRequest) {
  const read = await readTextOr413(req);
  if ('response' in read) return read.response;
  if (!skipAdapter.verifyWebhook(req.headers, read.text)) return unauthorized('skip');
  const body = parseJson(read.text);
  let order: ReturnType<typeof parseSkipFailedOrder> = null;
  try {
    order = parseSkipFailedOrder(body);
  } catch {
    // Keep an unreadable backup as a backup so it cannot be replayed as ordinary intake.
  }
  if (!order) {
    background('keep unparsed skip failed order', () => keepUnparsed('skip', body, 'Skip failed-order notice without readable order details', null, 'skip_backup'));
    return NextResponse.json({ ok: false, error: 'Unreadable backup order' }, { status: 400 });
  }
  if (!(await saveThenProcess({ channel: 'skip', kind: 'skip_backup', body, reference: order.externalOrderId }))) return retryLater('skip');
  // JET expects 200 with the same payload after recording the notice.
  return NextResponse.json(body, { status: 200 });
}
