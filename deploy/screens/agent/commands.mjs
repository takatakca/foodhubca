// Commands Food Hub hands a relay agent in its heartbeat answer (contract v2.1, docs/ORDER_SCREENS_RESCUE.md):
//   reload — reload the page (Android: bring the order app back to the front);
//   open   — go to `url`, a platform's merchant page (its sign-in page while signed out). Sent when the owner sets up a
//            screen, switches its channel or taps "Sign-in page". Only the platforms' own https sites are accepted (the
//            same list as Food Hub's allowedScreenUrl); anything else is refused and never opened.
// Pure, shared by agent.mjs (web) and android.mjs (Android), tested in tests/screens-relay-commands.test.ts.

export const ALLOWED_HOSTS = Object.freeze(['doordash.com', 'ubereats.com', 'uber.com', 'skipthedishes.com']);

/** The platforms' Android order apps (same names as generate-lib.mjs PLATFORMS), by site. */
export const ORDER_APPS = Object.freeze({
  'doordash.com': 'com.dd.ddmerchant',
  'ubereats.com': 'com.uber.restaurants',
  'uber.com': 'com.uber.restaurants',
  'skipthedishes.com': 'ca.skipthedishes.dashboard',
});

function siteOf(raw) {
  try {
    const u = new URL(String(raw ?? ''));
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return ALLOWED_HOSTS.find((h) => u.hostname === h || u.hostname.endsWith(`.${h}`)) ?? null;
  } catch { return null; }
}

/** True when `url` is https on one of the platforms' own sites, with no user name or password. */
export const allowedUrl = (url) => siteOf(url) !== null;

/** The Android order app to launch for a platform address, or null. */
export const packageForUrl = (url) => { const s = siteOf(url); return s ? ORDER_APPS[s] : null; };

const MERCHANT_HOSTS = new Set(['order.doordash.com', 'merchants.ubereats.com', 'restaurants.skipthedishes.com']);
const LOGIN_HOSTS = ['auth.uber.com', 'identity.doordash.com'];
const LOGIN_PATH = /\/(login|signin|sign-in|log-in|auth)(\/|$)/i;

function webAddress(raw) {
  try {
    const url = new URL(raw);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}

/** Match the configured origin or a known merchant/sign-in redirect for the same provider. */
export function matchScreenPage(startUrl, pageUrl) {
  const start = webAddress(startUrl);
  const page = webAddress(pageUrl);
  if (!start || !page) return null;
  const login = LOGIN_PATH.test(page.pathname) || LOGIN_HOSTS.some((host) => page.hostname === host || page.hostname.endsWith(`.${host}`));
  const state = login ? 'login' : 'ok';
  if (start.origin === page.origin) return { state, priority: start.pathname === page.pathname ? 3 : 2 };
  const provider = packageForUrl(start);
  if (provider && provider === packageForUrl(page) && (login || MERCHANT_HOSTS.has(page.hostname))) return { state, priority: 1 };
  return null;
}

/**
 * The commands meant for this screen, in order: { kind: 'reload' } | { kind: 'open', url } |
 * { kind: 'refused', reason } (an open to anything but a platform site, or a kind this agent does not know).
 */
export function commandsFor(body, screenId) {
  const list = Array.isArray(body?.commands) ? body.commands : [];
  return list.filter((c) => c && c.id === screenId).map((c) => {
    if (c.kind === 'reload') return { kind: 'reload' };
    if (c.kind === 'open') return allowedUrl(c.url) ? { kind: 'open', url: String(c.url) } : { kind: 'refused', reason: `open refused (not a platform address): ${String(c.url ?? '').slice(0, 80)}` };
    return { kind: 'refused', reason: `unknown command: ${String(c.kind ?? '').slice(0, 20)}` };
  });
}
