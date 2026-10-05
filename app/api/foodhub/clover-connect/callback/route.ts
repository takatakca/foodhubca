import { NextResponse, type NextRequest } from 'next/server';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { finishCloverConnect } from '@/lib/foodhub/pos/clover-oauth';

export const dynamic = 'force-dynamic';

// Clover sends the merchant's browser here (Site URL + Alternate Launch Path of the Clover app), either
// after "Connect a Clover merchant" in Food Hub or when the merchant installs / opens the app from Clover.
// Public route (see proxy.ts): the code is useless without the app secret, which never leaves the server.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  // Started from Food Hub (has our state) → back to Settings. Opened from Clover (no state) → public welcome page,
  // because the merchant opening the app from Clover is usually not signed in to Food Hub.
  const fromFoodHub = Boolean(q.get('state'));
  const back = `${publicBaseUrl()}/settings/channels`;
  const welcome = (p: Record<string, string>) => `${publicBaseUrl()}/welcome/clover?${new URLSearchParams(p)}`;
  if (q.get('error')) {
    const msg = `Clover: ${q.get('error_description') || q.get('error')}`;
    return NextResponse.redirect(fromFoodHub ? `${back}?clover_error=${encodeURIComponent(msg)}` : welcome({ status: 'error', msg }));
  }
  const r = await finishCloverConnect({ code: q.get('code'), merchantId: q.get('merchant_id'), clientId: q.get('client_id'), state: q.get('state') });
  if (fromFoodHub) return NextResponse.redirect(r.ok ? `${back}?clover_connected=${encodeURIComponent(r.merchantId)}` : `${back}?clover_error=${encodeURIComponent(r.error)}`);
  return NextResponse.redirect(r.ok
    ? welcome({ status: r.pending ? 'pending' : 'connected', mid: r.merchantId, ...(r.name ? { name: r.name } : {}) })
    : welcome({ status: 'error', msg: r.error }));
}
