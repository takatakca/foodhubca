import { NextResponse, type NextRequest } from 'next/server';
import { basicOwner, clientIp, DEVICE_COOKIE, ownerSessionVersion, readCookie, sessionSecretSource, verifyDevice, verifySession } from './lib/foodhub/session';
import { framePolicyFor } from './lib/foodhub/frame-policy';
import { HUB_HOME, isIndexablePath, isPublicSitePath, PUBLIC_LANG_HEADER, PUBLIC_PAGE_CACHE, publicHomeEnabled, publicSiteLang } from './lib/foodhub/public-site';

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
  '/api/foodhub/voice/', // brand phone lines: Twilio-signed webhooks + the signed voicemail listen link (brand-lines.ts)
  '/api/foodhub/clover-connect/test-order', // welcome-ticket credential (signed, one merchant, its own register)
  '/api/foodhub/clover-connect/phone/callback', // AI phone Clover app's OAuth callback (same rule as Food Hub's; 404 until its App ID is set)
  '/api/foodhub/auth/', '/api/foodhub/devices/heartbeat',
  '/api/foodhub/screens/heartbeat', // screen relay agent: Bearer FOODHUB_SCREENS_AGENT_TOKEN is the credential (lib/foodhub/screens.ts)
  '/api/suite/', // TAKATAK Suite apps: each call is signed with that app's own secret (lib/foodhub/suite/auth.ts)
  '/api/auth/google/', // "Continue with Google": the state + PKCE cookie and Google's verified id_token are the credential (lib/foodhub/identity/google.ts)
  // No blanket /api/public/ exemption: only explicitly reviewed read-only routes are public (PUBLIC_PATHS below).
  '/p/', // payment links texted to customers: the secret token is the credential (app/p/[token]/route.ts, delivery/paylink.ts)
  '/login', '/kitchen/lock', '/manifest.webmanifest', '/sw.js', '/icons/', '/legal/', '/welcome/', '/media/',
  '/commander/', '/api/storefront/', // ON2GO storefront: public menu + checkout; prices recomputed server side, rate-limited (lib/foodhub/storefront/*)
];
/** Matched exactly, never as a prefix ("/api/healthz" or "/api/health/x" still need a sign-in). */
const PUBLIC_PATHS = new Set([
  '/api/health', // uptime monitors: status only without CRON_SECRET or a session (app/api/health/route.ts)
  '/api/release', // deployment proof: public commit SHA only, exact path, no settings or secrets
  '/api/public/restaurant-leads', // the on2go.ca sign-up form: JSON only, honeypot, 5 sends / 10 min per IP, 16 KB body, CORS for on2go.ca only (app/api/public/restaurant-leads/route.ts)
  '/api/public/directory', // ON2GO/QMAPS read-only directory (public facts only, lib/foodhub/public-directory.ts); other /api/public/* stay protected
  '/legal', // the legal pages' index: redirects to /legal/support (app/legal/page.tsx); /legal/* is in PUBLIC_PREFIXES
  '/courier', '/api/courier', // our couriers' page: the personal signed link (Bearer) is the credential (lib/foodhub/delivery/courier-app.ts)
]);

// The public ON2GO.ca hub site (/hub, /en/hub, robots.txt, sitemap.xml, llms.txt, /og/, favicon) is open to everyone and
// indexable, like the legal pages; every other response says "noindex" (lib/foodhub/public-site.ts).
export async function proxy(req: NextRequest) {
  const res = await gate(req);
  if (!isIndexablePath(req.nextUrl.pathname)) res.headers.set('X-Robots-Tag', 'noindex');
  // Anti-clickjacking: the console and its sign-in pages only inside Food Hub itself or Clover (lib/foodhub/frame-policy.ts).
  const frame = framePolicyFor(req.nextUrl.pathname);
  if (frame && !res.headers.has('Content-Security-Policy')) res.headers.set('Content-Security-Policy', frame);
  return res;
}

async function gate(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublicSitePath(pathname)) {
    const lang = publicSiteLang(pathname);
    if (!lang) return NextResponse.next();
    const headers = new Headers(req.headers);
    headers.set(PUBLIC_LANG_HEADER, lang); // the page's language comes from its path, never from the cookie
    const res = NextResponse.next({ request: { headers } });
    res.headers.set('Cache-Control', PUBLIC_PAGE_CACHE); // same HTML for everyone: no cookie, no session is read
    return res;
  }
  if (PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

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
  // An anonymous visitor on the bare address sees the public ON2GO.ca hub page (with its "Sign in" button); tablets keep
  // their PIN screen, and FOODHUB_PUBLIC_HOME=off restores /login. The query string (?fbclid=, utm_…) goes along: a
  // shared link to the root must land on /hub, not on /login?next=… . The redirect stays temporary (307): a permanent
  // one would be cached by browsers and send a signed-in owner's "/" (the console) to /hub. Public links always point
  // at /hub, its own canonical.
  if (pathname === '/' && !isTablet && publicHomeEnabled()) {
    to.pathname = HUB_HOME;
    return NextResponse.redirect(to);
  }
  to.pathname = isTablet ? '/kitchen/lock' : '/login';
  to.search = pathname === '/' && !search ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(to);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
