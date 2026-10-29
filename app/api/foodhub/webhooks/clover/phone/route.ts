import { NextResponse, type NextRequest } from 'next/server';
import { cloverPhoneAppEnabled } from '@/lib/foodhub/pos/clover-apps';
import { handleCloverAppEvents } from '@/lib/foodhub/pos/clover-oauth';
import { cloverWebhookGate } from '@/lib/foodhub/pos/clover-webhook-gate';
import { background, parseJson } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Webhook of the AI phone Clover app (default name "TAKATAK Phone AI"), separate from Food Hub's (../route.ts):
//  - 404 until CLOVER_PHONE_APP_ID is set: without the phone app's env, this server behaves exactly as before.
//  - { verificationCode } is stored under the phone app's own key; Settings → Clover app shows it to paste back.
//  - Every event needs X-Clover-Auth = CLOVER_PHONE_WEBHOOK_AUTH (Food Hub's code is refused here).
//  - Subscribe to "App" events ONLY (install, uninstall, subscription change). Inventory and Orders stay on Food Hub's
//    webhook, so a merchant with both apps never has its menu or orders handled twice.
//  - Uninstall removes only the phone app's tokens; Food Hub is not touched.
export async function POST(req: NextRequest) {
  if (!cloverPhoneAppEnabled()) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  const raw = await req.text();
  const body = parseJson(raw);
  if (body === undefined) return NextResponse.json({ ok: false }, { status: 400 });
  const gate = await cloverWebhookGate('phone', body, req.headers.get('x-clover-auth'));
  if (gate.done) return NextResponse.json(gate.json, { status: gate.status });
  background('clover phone app events', () => handleCloverAppEvents(body, 'phone'));
  return NextResponse.json({ ok: true });
}
