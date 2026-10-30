// Screens gateway, pure part (no I/O, tested in tests/screens-relay-gateway.test.ts): one https address for every
// screen of the relay host. https://ecrans.on2go.ca/s01/ → the s01 container's web view, path kept (each screen answers
// under its own /sNN/, see SUBFOLDER in generate-lib.mjs). It adds one thing the screens need to show INSIDE Food Hub:
// the frame-ancestors header naming Food Hub (and drops any X-Frame-Options that would forbid it), and asks for the
// relay host's own view password once for all screens. Never a platform password: those are typed inside each screen.

/** "/s01/…" → "s01"; anything else → null. Screen names: letters, digits and dashes, as generate-lib.mjs makes them. */
export function screenOf(pathname, screens) {
  const m = /^\/([a-z0-9][a-z0-9-]{0,62})(\/|$)/.exec(String(pathname ?? ''));
  return m && screens.includes(m[1]) ? m[1] : null;
}

/** "/s01" (no slash) is sent to "/s01/" so the screen's relative links work. */
export const needsSlash = (pathname, screen) => pathname === `/${screen}`;

/** https origins Food Hub runs on (comma-separated FOODHUB_ORIGIN), cleaned; nothing else may frame the screens. */
export function frameAncestors(raw) {
  const list = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password ? u.origin : null; } catch { return null; }
  }).filter(Boolean);
  return list.length ? `frame-ancestors ${[...new Set(list)].join(' ')}` : "frame-ancestors 'none'";
}

/**
 * The screen's response headers, made embeddable by Food Hub only: X-Frame-Options removed, any frame-ancestors of the
 * screen's own Content-Security-Policy replaced by ours. Header names are lower-case (Node's res.headers).
 */
export function rewriteHeaders(headers, policy) {
  const out = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    const key = k.toLowerCase();
    if (key === 'x-frame-options') continue;
    if (key === 'content-security-policy') {
      const kept = String(Array.isArray(v) ? v.join(';') : v).split(';').map((d) => d.trim()).filter((d) => d && !/^frame-ancestors\b/i.test(d));
      if (kept.length) out[key] = kept.join('; ');
      continue;
    }
    out[key] = v;
  }
  out['content-security-policy'] = out['content-security-policy'] ? `${out['content-security-policy']}; ${policy}` : policy;
  out['x-content-type-options'] = 'nosniff';
  out['referrer-policy'] = 'no-referrer';
  return out;
}

/** "Basic …" header matches the relay host's view user and password (constant-time on equal lengths). */
export function basicOk(header, user, password, timingSafeEqual) {
  if (!password) return true; // no view password configured: the screens' own sign-in (KasmVNC) still asks
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(String(header ?? ''));
  if (!m) return false;
  const given = Buffer.from(Buffer.from(m[1], 'base64').toString('utf8'));
  const want = Buffer.from(`${user ?? ''}:${password}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** "s01" → "s01:3000" (the screen's container on the compose network); GATEWAY_UPSTREAM can point all screens elsewhere (tests). */
export function upstreamOf(screen, template) {
  const t = String(template || '{screen}:3000');
  const [host, port] = t.replace('{screen}', screen).split(':');
  return { host, port: Number(port) || 3000 };
}
