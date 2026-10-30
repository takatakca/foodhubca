import { NextResponse } from 'next/server';
import { getActor } from '@/lib/foodhub/auth';
import { can } from '@/lib/foodhub/session';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { cloverMevAppEnabled } from '@/lib/foodhub/pos/clover-apps';
import { cloverAppConfigured, startCloverConnect } from '@/lib/foodhub/pos/clover-oauth';

export const dynamic = 'force-dynamic';

// "Connect a merchant to TAKATAK MEV" → Clover sign-in / approve that app → back to ../callback.
// Same rules as Food Hub's start route, with TAKATAK MEV's own keys (CLOVER_MEV_APP_ID / CLOVER_MEV_APP_SECRET).
// 404 until CLOVER_MEV_APP_ID is set.
export async function GET(req: Request) {
  if (!cloverMevAppEnabled()) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  const back = `${publicBaseUrl()}/settings/clover-app`;
  const actor = await getActor(req);
  if (!actor || !can(actor.role, 'stores:map')) return NextResponse.redirect(`${back}?clover_error=${encodeURIComponent('Only the owner or a manager can connect Clover merchants.')}`);
  if (!cloverAppConfigured('mev')) return NextResponse.redirect(`${back}?clover_error=${encodeURIComponent('Add the TAKATAK MEV app keys first: CLOVER_MEV_APP_ID and CLOVER_MEV_APP_SECRET.')}`);
  return NextResponse.redirect(await startCloverConnect(actor.name || actor.username, 'mev'));
}
