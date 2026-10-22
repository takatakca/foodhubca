import { NextResponse, type NextRequest } from 'next/server';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { beginGoogleSignIn, googleSignInEnabled } from '@/lib/foodhub/identity/google';
import { safeNext } from '@/lib/foodhub/identity/otp';

export const dynamic = 'force-dynamic';

// "Continue with Google" → Google's account chooser. Public route (proxy.ts); state + PKCE + nonce go in an httpOnly cookie.
export async function GET(req: NextRequest) {
  const base = process.env.FOODHUB_PUBLIC_URL ? publicBaseUrl() : req.nextUrl.origin;
  const next = safeNext(req.nextUrl.searchParams.get('next'));
  if (!googleSignInEnabled()) return NextResponse.redirect(`${base}/login?google=off&next=${encodeURIComponent(next)}`);
  const { url, cookie } = beginGoogleSignIn({ next, lang: req.nextUrl.searchParams.get('lang') });
  const res = NextResponse.redirect(url);
  res.headers.append('Set-Cookie', cookie);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
