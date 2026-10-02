import { NextResponse } from 'next/server';
import { getActor } from '@/lib/foodhub/auth';
import { can } from '@/lib/foodhub/session';
import { missingEnv, publicBaseUrl } from '@/lib/foodhub/config';
import { startUberConnect } from '@/lib/foodhub/adapters/uber-provision';

export const dynamic = 'force-dynamic';

// "Connect Uber Eats stores" button → Uber login (owner signs in with the Uber Eats Manager account).
export async function GET(req: Request) {
  const actor = await getActor(req);
  if (!actor || !can(actor.role, 'stores:map')) return NextResponse.redirect(`${publicBaseUrl()}/foodhub/stores?uber_error=${encodeURIComponent('Only the owner or a manager can connect Uber stores.')}`);
  const missing = missingEnv(['UBER_CLIENT_ID', 'UBER_CLIENT_SECRET']);
  if (missing.length) return NextResponse.redirect(`${publicBaseUrl()}/foodhub/stores?uber_error=${encodeURIComponent(`Add ${missing.join(', ')} first (npm run setup).`)}`);
  return NextResponse.redirect(await startUberConnect());
}
