import { after, NextResponse, type NextRequest } from 'next/server';
import { uberEatsAdapter } from '@/lib/foodhub/adapters/uber-eats';
import { runUberWebhook } from '@/lib/foodhub/adapters/uber-events';
import { saveUberWebhook } from '@/lib/foodhub/adapters/uber-inbox';
import { parseJson, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
// The deferred pipeline (Uber fetch + Clover + accept) runs in after(): give it the same budget as the cron routes.
export const maxDuration = 60;

// Uber Eats Primary Webhook URL. Uber signs every request with X-Uber-Signature (HMAC-SHA256 of the raw body, keyed
// with the dashboard Signing Key) and expects a fast 200. Orders must be accepted/denied within 11.5 minutes.
// Every signed webhook is saved BEFORE the 200 (lib/foodhub/adapters/uber-inbox.ts): if the processing after the
// answer fails or the server stops, the sync replays it — Uber itself never resends a webhook it got a 200 for.
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
    console.error('[foodhub] uber webhook could not be saved:', error);
    return NextResponse.json({ ok: false, error: 'Could not store the webhook; retry.' }, { status: 503 });
  }
  // Same event delivered again (done, or still being processed): nothing more to do.
  if (!saved.duplicate) after(() => runUberWebhook(saved.id, body).then(() => undefined, (e) => console.error('[foodhub] uber webhook processing crashed:', e)));
  return new NextResponse(null, { status: 200 });
}
