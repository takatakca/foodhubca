import { NextResponse, type NextRequest } from 'next/server';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { cloverMevAppEnabled } from '@/lib/foodhub/pos/clover-apps';
import { cloverAppConfigured, cloverWelcomeQuery, finishCloverConnect, isLaunchState, startCloverLaunch } from '@/lib/foodhub/pos/clover-oauth';

export const dynamic = 'force-dynamic';

// OAuth callback + Alternate Launch Path of the TAKATAK MEV Clover app. Same flow as Food Hub's callback
// (../../callback/route.ts) with TAKATAK MEV's own App ID, secret, launch signature and token store: the
// "wrong app" check compares against CLOVER_MEV_APP_ID, and a Food Hub state or launch is refused here.
// Public route (see proxy.ts): the code is useless without the app secret, which never leaves the server.
// 404 until CLOVER_MEV_APP_ID is set.
export async function GET(req: NextRequest) {
  if (!cloverMevAppEnabled()) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  const q = req.nextUrl.searchParams;
  const state = q.get('state');
  const fromFoodHub = Boolean(state) && !isLaunchState(state);
  const back = `${publicBaseUrl()}/settings/clover-app`;
  const welcome = (p: Record<string, string>) => `${publicBaseUrl()}/welcome/clover?${new URLSearchParams(p)}`;
  if (q.get('error')) {
    const msg = `Clover: ${q.get('error_description') || q.get('error')}`;
    return NextResponse.redirect(fromFoodHub ? `${back}?clover_error=${encodeURIComponent(msg)}` : welcome({ status: 'error', err: 'clover_denied', app: 'mev' }));
  }
  // Launch from the Clover dashboard / App Market without a code: Clover expects us to ask for one (once).
  if (!q.get('code') && !state && cloverAppConfigured('mev')) return NextResponse.redirect(await startCloverLaunch(Date.now(), 'mev'));
  const r = await finishCloverConnect({ code: q.get('code'), merchantId: q.get('merchant_id'), clientId: q.get('client_id'), state, app: 'mev' });
  if (fromFoodHub) return NextResponse.redirect(r.ok ? `${back}?clover_connected=${encodeURIComponent(r.merchantId)}` : `${back}?clover_error=${encodeURIComponent(r.error)}`);
  return NextResponse.redirect(welcome(await cloverWelcomeQuery(r)));
}
