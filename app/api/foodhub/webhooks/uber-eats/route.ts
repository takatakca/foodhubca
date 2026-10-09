import { after, NextResponse, type NextRequest } from 'next/server';
import { uberEatsAdapter } from '@/lib/foodhub/adapters/uber-eats';
import { runUberWebhook } from '@/lib/foodhub/adapters/uber-events';
import { saveUberWebhook } from '@/lib/foodhub/adapters/uber-inbox';
import { parseJson, retryLater, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
// The deferred work (Uber fetch + Clover + accept) runs in after(): give it the same budget as the cron routes.
export const maxDuration = 60;

// Uber Eats Primary Webhook URL. Uber signs every request with X-Uber-Signature (HMAC-SHA256 of the raw body, keyed
// with the dashboard Signing Key or the app client secret) and expects a fast 200. Orders must be accepted/denied within
// 11.5 minutes — Food Hub does it automatically once Clover has the order.
//
// Every signed webhook is SAVED in the webhook inbox before the 200 (lib/foodhub/inbox.ts, keyed by Uber's event_id —
// lib/foodhub/adapters/uber-inbox.ts) and processed right after the answer (lib/foodhub/adapters/uber-events.ts): a
// server that stops in between, an order fetch Uber refuses, or a database hiccup loses nothing — the inbox processes
// it again (30 s, 2 min), and the owner can Replay it. The same event delivered again is not processed twice.
// If the inbox cannot be written, Uber gets a 503 and sends the event again.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!uberEatsAdapter.verifyWebhook(req.headers, raw)) return unauthorized('uber_eats');
  const body = parseJson(raw);
  if (body === undefined || body === null || typeof body !== 'object') return NextResponse.json({ ok: false }, { status: 400 });

  let saved: { id: string; duplicate: boolean };
  try {
    saved = await saveUberWebhook(body, raw);
  } catch (error) {
    // Not kept = not answered 200: Uber retries the delivery instead of Food Hub silently dropping it.
    console.error('[foodhub] could not save the uber_eats webhook before answering:', error);
    return retryLater('uber_eats');
  }
  // Same event delivered again (done, or still being processed): nothing more to do.
  if (!saved.duplicate) after(() => runUberWebhook(saved.id).then(() => undefined, (e) => console.error('[foodhub] uber webhook processing crashed:', e)));
  return new NextResponse(null, { status: 200 });
}
