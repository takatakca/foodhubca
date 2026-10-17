import { NextResponse, type NextRequest } from 'next/server';
import { handleCloverWebhook } from '@/lib/foodhub/clover-sync';
import { handleCloverAppEvents } from '@/lib/foodhub/pos/clover-oauth';
import { cloverWebhookGate } from '@/lib/foodhub/pos/clover-webhook-gate';
import { handleCloverOrderEvents } from '@/lib/foodhub/pos/clover-website-orders';
import { background, parseJson } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Clover app webhooks of the "TAKATAK Food Hub" app (Clover developer dashboard → your app → Webhooks):
//  1. Clover first POSTs { verificationCode } — Food Hub shows it on Channels; paste it back in Clover.
//     Public by design (Clover re-verifies when the URL changes): stored/logged only when the code changed, at most once a minute.
//  2. Every event carries the header X-Clover-Auth = the auth code Clover shows → CLOVER_WEBHOOK_AUTH.
//  3. Subscribe to "Inventory" events: an item changed in Clover → availability/price sync to every platform.
//  4. Subscribe to "App" events: a merchant uninstalls the app → its tokens are removed (A:<appId> DELETE).
//  5. Subscribe to "Orders" events: a website order taken by Clover Online Ordering shows on the kitchen screen at once,
//     and a refund or deletion in Clover follows (O:<orderId>). See docs/CLOVER_WEBSITE_ORDERS.md.
// The AI phone app has its own webhook (./phone/route.ts, App events only): see docs/CLOVER_MULTI_APP.md.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const body = parseJson(raw);
  if (body === undefined) return NextResponse.json({ ok: false }, { status: 400 });
  const gate = await cloverWebhookGate('foodhub', body, req.headers.get('x-clover-auth'));
  if (gate.done) return NextResponse.json(gate.json, { status: gate.status });
  background('clover app events', () => handleCloverAppEvents(body));
  background('clover inventory webhook', () => handleCloverWebhook(body));
  background('clover order events', () => handleCloverOrderEvents(body));
  return NextResponse.json({ ok: true });
}
