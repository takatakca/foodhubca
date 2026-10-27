import { NextResponse, type NextRequest } from 'next/server';
import { handleCloverRegisterEvents } from '@/lib/foodhub/mev/clover-register';
import { cloverMevAppEnabled } from '@/lib/foodhub/pos/clover-apps';
import { handleCloverAppEvents } from '@/lib/foodhub/pos/clover-oauth';
import { cloverWebhookGate } from '@/lib/foodhub/pos/clover-webhook-gate';
import { background, parseJson } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Webhook of the TAKATAK MEV Clover app, separate from Food Hub's (../route.ts) and the phone app's:
//  - 404 until CLOVER_MEV_APP_ID is set: without its env, this server behaves exactly as before.
//  - { verificationCode } is stored under this app's own key; Settings → Clover app shows it to paste back.
//  - Every event needs X-Clover-Auth = CLOVER_MEV_WEBHOOK_AUTH (another app's code is refused here).
//  - Subscribe to "App" events (install, uninstall) and "Orders" events (the register sales it invoices: paid → invoice,
//    refunded / deleted → credit note). A merchant with Food Hub too gets the same orders on both webhooks: one record
//    per Clover order, so the second read changes nothing.
//  - Uninstall removes only this app's tokens; Food Hub and the phone app are not touched.
export async function POST(req: NextRequest) {
  if (!cloverMevAppEnabled()) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  const raw = await req.text();
  const body = parseJson(raw);
  if (body === undefined) return NextResponse.json({ ok: false }, { status: 400 });
  const gate = await cloverWebhookGate('mev', body, req.headers.get('x-clover-auth'));
  if (gate.done) return NextResponse.json(gate.json, { status: gate.status });
  background('clover mev app events', () => handleCloverAppEvents(body, 'mev'));
  background('clover register sales (MEV app)', () => handleCloverRegisterEvents(body));
  return NextResponse.json({ ok: true });
}
