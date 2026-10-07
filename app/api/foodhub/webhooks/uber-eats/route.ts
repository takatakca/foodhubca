import { NextResponse, type NextRequest } from 'next/server';
import { uberEatsAdapter } from '@/lib/foodhub/adapters/uber-eats';
import { parseJson, retryLater, saveThenProcess, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
// The deferred work (Uber fetch + Clover + accept) runs in after(): give it the same budget as the cron routes.
export const maxDuration = 60;

// Uber Eats Primary Webhook URL. Uber signs every request with X-Uber-Signature
// (HMAC-SHA256 of the raw body, keyed with the webhook signing key or the app client secret) and expects a fast 200.
// Orders must be accepted/denied within 11.5 minutes — Food Hub does it automatically once Clover has the order.
//
// Every event is SAVED in the webhook inbox before the 200 (lib/foodhub/inbox.ts) and processed right after the answer
// (lib/foodhub/webhooks/uber.ts): a server that stops in between, an order fetch Uber refuses, or a database hiccup
// loses nothing — the recovery runner processes it again (30 s, 2 min), and the owner can Replay it.
// If the inbox cannot be written, Uber gets a 503 and sends the event again.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!uberEatsAdapter.verifyWebhook(req.headers, raw)) return unauthorized('uber_eats');
  const body = parseJson(raw);
  if (body === undefined) return NextResponse.json({ ok: false }, { status: 400 });
  const reference = String(body.meta?.resource_id || body.store_id || body.workflow_id || '') || null;
  if (!(await saveThenProcess({ channel: 'uber_eats', kind: 'uber', body, reference }))) return retryLater('uber_eats');
  return new NextResponse(null, { status: 200 });
}
