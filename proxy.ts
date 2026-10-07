import { NextResponse, type NextRequest } from 'next/server';
import { basicOwner, clientIp, DEVICE_COOKIE, ownerSessionVersion, readCookie, sessionSecretSource, verifyDevice, verifySession } from './lib/foodhub/session';

// Sign-in gate for the whole console and its APIs.
//  - Platform webhooks stay public (each verifies its own signature / token); cron uses CRON_SECRET;
//    the Uber OAuth callback uses its single-use state; the Clover app callback needs the app secret to be of any use.
//  - Sign-in endpoints are public (they check codes, links and PINs themselves, throttled per client). The kitchen
//    tablet heartbeat is public too: its signed device cookie is the credential.
//  - Everyone else needs a signed session cookie, or "Authorization: Basic" for scripts (owner password, or — on
//    /api/foodhub/* only — a team member's own password, re-verified by each route via getActor/withPerm).
//  - When live connectors are ON, a DASHBOARD_PASSWORD is mandatory: a live console can accept orders and pause
//    stores, so it must never be open to the internet.
//  - A kitchen tablet without a session goes to its PIN screen; any other browser to /login.
const PUBLIC_PREFIXES = [
  '/api/foodhub/webhooks/', '/api/foodhub/cron/', '/api/foodhub/uber-connect/callback', '/api/foodhub/clover-connect/callback',
  '/api/foodhub/clover-connect/test-order', // welcome-ticket credential (signed, one merchant, its own register)
  '/api/foodhub/auth/', '/api/foodhub/devices/heartbeat',
  '/login', '/kitchen/lock', '/manifest.webmanifest', '/sw.js', '/icons/', '/legal/', '/welcome/', '/media/',
];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // The live lock depends on the password alone: SESSION_SECRET by itself gives nobody a way to sign in as owner.
  if (process.env.LIVE_CONNECTORS_GLOBAL_ENABLED === 'true' && !process.env.DASHBOARD_PASSWORD) {
    return new NextResponse('Locked: set DASHBOARD_PASSWORD before enabling live connectors.', { status: 503 });
  }
  if (!sessionSecretSource()) {
    return new NextResponse('Locked: set SESSION_SECRET (npm run setup) — sign-in cannot work without it.', { status: 503 });
  }
  if (!process.env.DASHBOARD_PASSWORD && !process.env.SESSION_SECRET) return NextResponse.next(); // open local/dev mode

  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Basic ')) {
    // Food Hub routes verify Basic credentials themselves (owner or team member, throttled and logged).
    // Pages only pass with the owner password (throttled here) or a session cookie.
    if (pathname.startsWith('/api/foodhub/')) return NextResponse.next();
    if (basicOwner(auth, clientIp(req.headers))) return NextResponse.next();
  }
  const session = await verifySession(readCookie(req.headers.get('cookie')));
  // Cookies carry a session version; an owner cookie issued under a previous DASHBOARD_PASSWORD is refused here
  // (cheap, no database). Team-member versions and revoked tablets are checked by getActor()/getViewer().
  if (session?.v && (!session.b || session.v === ownerSessionVersion())) return NextResponse.next();

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
