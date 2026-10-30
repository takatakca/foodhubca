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
