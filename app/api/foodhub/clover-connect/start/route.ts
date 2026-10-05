import { NextResponse } from 'next/server';
import { getActor } from '@/lib/foodhub/auth';
import { can } from '@/lib/foodhub/session';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { cloverAppConfigured, startCloverConnect } from '@/lib/foodhub/pos/clover-oauth';

export const dynamic = 'force-dynamic';

// "Connect a Clover merchant" button → Clover sign-in / approve the TAKATAK Food Hub app → back to the callback.
export async function GET(req: Request) {
  const back = `${publicBaseUrl()}/settings/channels`;
  const actor = await getActor(req);
  if (!actor || !can(actor.role, 'stores:map')) return NextResponse.redirect(`${back}?clover_error=${encodeURIComponent('Only the owner or a manager can connect Clover merchants.')}`);
  if (!cloverAppConfigured()) return NextResponse.redirect(`${back}?clover_error=${encodeURIComponent('Add the Clover app keys first: CLOVER_CLIENT_ID and CLOVER_CLIENT_SECRET (npm run setup).')}`);
  return NextResponse.redirect(await startCloverConnect(actor.name || actor.username));
}
