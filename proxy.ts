import { NextResponse, type NextRequest } from 'next/server';
import { basicOwner, DEVICE_COOKIE, readCookie, sessionSecret, verifyDevice, verifySession } from './lib/foodhub/session';

// Sign-in gate for the whole console and its APIs.
//  - Platform webhooks stay public (each verifies its own signature / token); cron uses CRON_SECRET;
//    the Uber OAuth callback uses its single-use state; the Clover app callback needs the app secret to be of any use.
//  - Sign-in endpoints are public (they check codes, links and PINs themselves). The kitchen tablet
//    heartbeat is public too: its signed device cookie is the credential.
//  - Everyone else needs a signed session cookie, or "Authorization: Basic" for scripts.
//  - A kitchen tablet without a session goes to its PIN screen; any other browser to /login.
const PUBLIC_PREFIXES = [
  '/api/foodhub/webhooks/', '/api/foodhub/cron/', '/api/foodhub/uber-connect/callback', '/api/foodhub/clover-connect/callback',
  '/api/foodhub/auth/', '/api/foodhub/devices/heartbeat',
  '/login', '/kitchen/lock', '/manifest.webmanifest', '/sw.js', '/icons/', '/legal/', '/welcome/', '/media/',
];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (!sessionSecret()) {
    return new NextResponse('Locked: set SESSION_SECRET (npm run setup) — sign-in cannot work without it.', { status: 503 });
  }

  const auth = req.headers.get('authorization');
  if (basicOwner(auth)) return NextResponse.next();
  // A team member's own Basic credentials are verified by the API route itself.
  if (auth?.startsWith('Basic ') && pathname.startsWith('/api/')) return NextResponse.next();
  if (await verifySession(readCookie(req.headers.get('cookie')))) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'Please sign in.' }, { status: 401 });
  }
  const to = req.nextUrl.clone();
  const isTablet = Boolean(await verifyDevice(readCookie(req.headers.get('cookie'), DEVICE_COOKIE)));
  to.pathname = isTablet ? '/kitchen/lock' : '/login';
  to.search = pathname === '/' && !search ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(to);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
