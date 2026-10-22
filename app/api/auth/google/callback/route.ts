import { NextResponse, type NextRequest } from 'next/server';
import { sessionCookieFor } from '@/lib/foodhub/auth';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { finishGoogleSignIn, GOOGLE_STATE_COOKIE, stateCookie } from '@/lib/foodhub/identity/google';
import { clientIp, readCookie } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';

// Google sends the browser back here with ?code&state. Public route (proxy.ts): the state cookie, the PKCE verifier
// and the id_token checks are the credential. Signs in only a team member whose verified email is already known.
export async function GET(req: NextRequest) {
  const base = process.env.FOODHUB_PUBLIC_URL ? publicBaseUrl() : req.nextUrl.origin;
  const q = req.nextUrl.searchParams;
  const r = await finishGoogleSignIn({
    code: q.get('code') || '', state: q.get('state') || '', googleError: q.get('error'),
    cookie: readCookie(req.headers.get('cookie'), GOOGLE_STATE_COOKIE), ip: clientIp(req.headers),
  });
  const res = r.ok
    ? NextResponse.redirect(`${base}${r.next}`)
    : NextResponse.redirect(`${base}/login?google=${r.reason}${r.next && r.next !== '/' ? `&next=${encodeURIComponent(r.next)}` : ''}`); // only the reason travels: the page says it in the person's language
  res.headers.append('Set-Cookie', stateCookie('', 0)); // one shot: the state never serves twice
  if (r.ok) res.headers.append('Set-Cookie', await sessionCookieFor(r.user, 'google'));
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
