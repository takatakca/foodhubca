import { NextResponse, type NextRequest } from 'next/server';
import { verifyWelcome } from '@/lib/foodhub/session';
import { sendCloverTestOrder } from '@/lib/foodhub/pos/clover-test-order';

export const dynamic = 'force-dynamic';

// "Send a test order to my Clover" on /welcome/clover. Public route (see proxy.ts): the merchant opening the app from
// Clover is not signed in to Food Hub, so the signed welcome ticket from the Clover callback is the credential —
// it only lets that merchant send a few test orders to its OWN approved register. JSON only (no cross-site forms).
export async function POST(req: NextRequest) {
  if (!String(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ ok: false, error: 'JSON body required.' }, { status: 415 });
  }
  const body = (await req.json().catch(() => ({}))) as { t?: string };
  const ticket = await verifyWelcome(typeof body.t === 'string' ? body.t : null);
  if (!ticket?.m) return NextResponse.json({ ok: false, reason: 'ticket', error: 'Open the app again from Clover.' }, { status: 401 });
  const r = await sendCloverTestOrder(ticket.m);
  const status = r.ok ? 200 : r.reason === 'not_approved' ? 403 : r.reason === 'limited' ? 429 : 502;
  return NextResponse.json(r, { status });
}
