import { NextResponse, type NextRequest } from 'next/server';
import { mevMerchantSetup } from '@/lib/foodhub/mev/clover-merchants';
import { cloverMevAppEnabled } from '@/lib/foodhub/pos/clover-apps';
import { connectedCloverMerchantIds } from '@/lib/foodhub/pos/clover-oauth';
import { verifyWelcome } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';

// "Check my set-up" on the TAKATAK MEV welcome page (/welcome/clover). Public route (see proxy.ts): the merchant who
// opened the app from Clover is not signed in to Food Hub, so the signed welcome ticket of the TAKATAK MEV app is the
// credential. It only shows that merchant its own location code and whether Takatak MEV says it is ready, and turns
// it on when it is (lib/foodhub/mev/clover-merchants.ts). JSON only (no cross-site forms).
export async function POST(req: NextRequest) {
  if (!String(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ ok: false, error: 'JSON body required.' }, { status: 415 });
  }
  const body = (await req.json().catch(() => ({}))) as { t?: string };
  const ticket = await verifyWelcome(typeof body.t === 'string' ? body.t : null);
  // TAKATAK MEV tickets only: a Food Hub or AI phone ticket never reads an MEV set-up.
  if (!ticket?.m || ticket.a !== 'mev') return NextResponse.json({ ok: false, reason: 'ticket', error: 'Open the app again from Clover.' }, { status: 401 });
  const approved = cloverMevAppEnabled() && (await connectedCloverMerchantIds('mev').catch(() => [] as string[])).includes(ticket.m);
  if (!approved) return NextResponse.json({ ok: false, reason: 'not_approved', error: 'This Clover merchant is not approved for TAKATAK MEV yet.' }, { status: 403 });
  const setup = await mevMerchantSetup(ticket.m, null, { check: true });
  return NextResponse.json({ ok: true, setup });
}
