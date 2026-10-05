import { NextResponse, type NextRequest } from 'next/server';
import { basicOwner, clientIp, ownerSessionVersion, readCookie, verifySession } from './lib/foodhub/session';

// Sign-in gate for the whole dashboard and its APIs.
//  - Platform webhooks stay public (each one verifies its own signature/token).
//  - Cron endpoints use CRON_SECRET instead; the Uber OAuth callback uses its single-use state.
//  - Signed-in users carry a signed session cookie (Food Hub → Users); scripts may use
//    "Authorization: Basic" (owner password, or — on /api/foodhub/* only — a user's own password,
//    re-verified by each Food Hub route via getActor/withPerm).
//  - When live connectors are ON, a DASHBOARD_PASSWORD is mandatory: a live dashboard can
//    accept orders and pause stores, so it must never be open to the internet.
const PUBLIC_PREFIXES = ['/api/foodhub/webhooks/', '/api/foodhub/cron/', '/api/foodhub/uber-connect/callback', '/api/foodhub/auth/login', '/login', '/manifest.webmanifest', '/sw.js', '/icons/'];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // The live lock depends on the password alone: SESSION_SECRET by itself gives nobody a way to sign in as owner.
  if (process.env.LIVE_CONNECTORS_GLOBAL_ENABLED === 'true' && !process.env.DASHBOARD_PASSWORD) {
    return new NextResponse('Locked: set DASHBOARD_PASSWORD before enabling live connectors.', { status: 503 });
  }
  if (!process.env.DASHBOARD_PASSWORD && !process.env.SESSION_SECRET) return NextResponse.next(); // open local/dev mode

  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Basic ')) {
    // Food Hub routes verify Basic credentials themselves (owner or team member, throttled and logged).
    // Everything else (pages, /api/backend/*) only passes with the owner password or a session cookie.
    if (pathname.startsWith('/api/foodhub/')) return NextResponse.next();
    if (basicOwner(auth, clientIp(req.headers))) return NextResponse.next();
  }
  const session = await verifySession(readCookie(req.headers.get('cookie')));
  // Cookies carry a session version; an owner cookie issued under a previous DASHBOARD_PASSWORD is refused here
  // (cheap, no database). Team-member versions are checked by getActor()/requirePage().
  if (session?.v && (!session.b || session.v === ownerSessionVersion())) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'Please sign in.' }, { status: 401 });
  }
  const login = req.nextUrl.clone();
  login.pathname = '/login';
  login.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
