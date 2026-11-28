import { NextResponse, type NextRequest } from 'next/server';
import { parseSkipCancelNotice, skipAdapter } from '@/lib/foodhub/adapters/skip';
import { parseJson, retryLater, saveThenProcess, unauthorized } from '@/lib/foodhub/webhook-utils';
import { readTextOr413 } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// JET expects 200 with the same cancellation payload. It retries a non-2xx.
export async function POST(req: NextRequest) {
  const read = await readTextOr413(req);
  if ('response' in read) return read.response;
  if (!skipAdapter.verifyWebhook(req.headers, read.text)) return unauthorized('skip');
  const body = parseJson(read.text);
  const notice = parseSkipCancelNotice(body);
  if (!notice) return NextResponse.json({ error: 'orderID missing' }, { status: 400 });
  if (!(await saveThenProcess({ channel: 'skip', kind: 'skip_cancel', body, reference: notice.externalOrderId }))) return retryLater('skip');
  return NextResponse.json(body, { status: 200 });
}
