import { NextResponse, type NextRequest } from 'next/server';
import { sessionCookieFor } from '@/lib/foodhub/auth';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { verifyLink } from '@/lib/foodhub/identity/otp';

export const dynamic = 'force-dynamic';

// One-tap link from the sign-in email / SMS. Works once, within 10 minutes.
export async function GET(req: NextRequest) {
  const base = process.env.FOODHUB_PUBLIC_URL ? publicBaseUrl() : req.nextUrl.origin;
  const r = await verifyLink(req.nextUrl.searchParams.get('c') || '', req.nextUrl.searchParams.get('t') || '');
  if (!r.ok) return NextResponse.redirect(`${base}/login?error=${encodeURIComponent(r.error)}`);
  const res = NextResponse.redirect(`${base}${r.next}`);
  res.headers.append('Set-Cookie', await sessionCookieFor(r.user, 'link'));
  return res;
}
