import { NextResponse, type NextRequest } from 'next/server';
import { basicOwner, readCookie, verifySession } from './lib/foodhub/session';

// Sign-in gate for the whole dashboard and its APIs.
//  - Platform webhooks stay public (each one verifies its own signature/token).
//  - Cron endpoints use CRON_SECRET instead; the Uber OAuth callback uses its single-use state.
//  - Signed-in users carry a signed session cookie (Food Hub → Users); scripts may use
//    "Authorization: Basic" (owner password, or a user's own password — checked by each API).
//  - When live connectors are ON, a DASHBOARD_PASSWORD is mandatory: a live dashboard can
//    accept orders and pause stores, so it must never be open to the internet.
const PUBLIC_PREFIXES = ['/api/foodhub/webhooks/', '/api/backend/webhooks/', '/api/foodhub/cron/', '/api/foodhub/uber-connect/callback', '/api/foodhub/auth/login', '/login', '/manifest.webmanifest', '/sw.js', '/icons/'];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (!process.env.DASHBOARD_PASSWORD && !process.env.SESSION_SECRET) {
    if (process.env.LIVE_CONNECTORS_GLOBAL_ENABLED === 'true') {
      return new NextResponse('Locked: set DASHBOARD_PASSWORD before enabling live connectors.', { status: 503 });
    }
    return NextResponse.next();
  }

  const auth = req.headers.get('authorization');
  if (basicOwner(auth)) return NextResponse.next();
  // A team member's own Basic credentials are verified by the API route itself.
  if (auth?.startsWith('Basic ') && pathname.startsWith('/api/')) return NextResponse.next();
  if (await verifySession(readCookie(req.headers.get('cookie')))) return NextResponse.next();

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
