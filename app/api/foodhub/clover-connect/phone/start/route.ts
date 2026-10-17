import { NextResponse } from 'next/server';
import { getActor } from '@/lib/foodhub/auth';
import { can } from '@/lib/foodhub/session';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { cloverPhoneAppEnabled } from '@/lib/foodhub/pos/clover-apps';
import { cloverAppConfigured, startCloverConnect } from '@/lib/foodhub/pos/clover-oauth';

export const dynamic = 'force-dynamic';

// "Connect a merchant to the AI phone app" → Clover sign-in / approve that app → back to ../callback.
// Same rules as Food Hub's start route, with the phone app's own keys (CLOVER_PHONE_APP_ID / CLOVER_PHONE_APP_SECRET).
// 404 until CLOVER_PHONE_APP_ID is set.
export async function GET(req: Request) {
  if (!cloverPhoneAppEnabled()) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  const back = `${publicBaseUrl()}/settings/clover-app`;
  const actor = await getActor(req);
  if (!actor || !can(actor.role, 'stores:map')) return NextResponse.redirect(`${back}?clover_error=${encodeURIComponent('Only the owner or a manager can connect Clover merchants.')}`);
  if (!cloverAppConfigured('phone')) return NextResponse.redirect(`${back}?clover_error=${encodeURIComponent('Add the phone app keys first: CLOVER_PHONE_APP_ID and CLOVER_PHONE_APP_SECRET.')}`);
  return NextResponse.redirect(await startCloverConnect(actor.name || actor.username, 'phone'));
}
