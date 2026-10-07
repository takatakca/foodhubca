import { NextResponse, type NextRequest } from 'next/server';
import { doorDashAdapter } from '@/lib/foodhub/adapters/doordash';
import { classifyDoorDash } from '@/lib/foodhub/webhooks/doordash';
import { background, keepUnparsed, parseJson, retryLater, saveThenProcess, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// DoorDash webhook subscriptions (Developer Portal): Order Create, Menu Status, Dasher Status — and ask DoorDash to point the
// Order Cancellation webhook here too. Menu Request (menu pull) is GET /api/foodhub/webhooks/doordash/<location id>.
// Point all of them at this URL with Authorization header = DOORDASH_WEBHOOK_SECRET.
//
// Order Create is answered 202 (asynchronous confirmation): DoorDash treats a 200 as "order confirmed", which must
// only happen after Clover has the order — the pipeline confirms with PATCH /api/v1/orders/{id} once it does
// (DoorDash fails an order that is not confirmed within 3–8 minutes).
// Every payload is SAVED in the webhook inbox before the answer, then processed (lib/foodhub/webhooks/doordash.ts);
// shapes Food Hub does not know are kept under Channels → Unparsed payloads (200, so DoorDash does not retry —
// 202 when it may be an order). Only invalid JSON gets 400; a database that cannot be written gets 503 (resend).
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!doorDashAdapter.verifyWebhook(req.headers, raw)) return unauthorized('doordash');
  const body = parseJson(raw);
  if (body === undefined) {
    background('keep unparsed doordash', () => keepUnparsed('doordash', { raw: raw.slice(0, 20_000) }, 'Invalid JSON'));
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const c = classifyDoorDash(body);
  if (!(await saveThenProcess({ channel: 'doordash', kind: 'doordash', body, reference: c.reference }))) return retryLater('doordash');
  return NextResponse.json({ ok: true, ...(c.kind === 'unparsed' ? { stored: 'unparsed' } : {}) }, { status: c.httpStatus });
}
