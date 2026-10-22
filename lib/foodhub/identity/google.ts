// "Continue with Google": OpenID Connect sign-in, server side only.
//   - /api/auth/google/start sends the browser to Google with state + PKCE + nonce, kept in a short httpOnly cookie.
//   - /api/auth/google/callback exchanges the code, verifies the id_token against Google's JWKS (signature, iss, aud,
//     exp, nonce, email_verified) and signs the person in ONLY when that verified email already belongs to an active
//     team member. Nobody is ever created from a Google account: a manager invites people first (Settings → Team).
//   - Same session cookie, roles and activity log as the code / link sign-in (auth.ts sessionCookieFor).
import crypto from 'node:crypto';
import { logActivity } from '../activity';
import { publicBaseUrl } from '../config';
import { maskContact, normalizeEmail } from '../notify';
import { getRepo } from '../repo';
import { clearFailures, isLocked, recordFailure, throttleKey } from '../session';
import type { FoodHubUser } from '../types';
import { findUserByContact, safeNext } from './otp';

export const GOOGLE_STATE_COOKIE = 'takatak_google';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
/** The round trip to Google and back must finish within this time. */
const STATE_TTL_S = 10 * 60;
const JWKS_TTL_MS = 60 * 60_000;
const CLOCK_SKEW_S = 60;

const b64url = (b: Buffer) => b.toString('base64url');
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest();

/** The button and the routes exist only once the owner created the OAuth client (docs/GOOGLE_SIGNIN.md). */
export function googleSignInEnabled(): boolean {
  return Boolean((process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim());
}

export function googleRedirectUri(): string {
  return `${publicBaseUrl()}/api/auth/google/callback`;
}

/** What the start route keeps in the httpOnly cookie: never a secret of Google's, only our own one-shot values. */
export interface GoogleState {
  state: string;
  verifier: string;
  nonce: string;
  next: string;
  lang: 'fr' | 'en';
  exp: number;
}

export function encodeState(s: GoogleState): string {
  return b64url(Buffer.from(JSON.stringify(s)));
}

export function decodeState(raw: string | null | undefined): GoogleState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<GoogleState>;
    if (typeof s.state !== 'string' || typeof s.verifier !== 'string' || typeof s.nonce !== 'string' || typeof s.exp !== 'number') return null;
    if (s.exp * 1000 < Date.now()) return null;
    return { state: s.state, verifier: s.verifier, nonce: s.nonce, next: safeNext(s.next), lang: s.lang === 'en' ? 'en' : 'fr', exp: s.exp };
  } catch {
    return null;
  }
}

/** Cookie flags for the state: httpOnly, Lax (Google comes back with a top-level GET), Secure on https, narrow path. */
export function stateCookie(value: string, maxAgeS = STATE_TTL_S): string {
  const secure = publicBaseUrl().startsWith('https://');
  return `${GOOGLE_STATE_COOKIE}=${encodeURIComponent(value)}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, maxAgeS)}${secure ? '; Secure' : ''}`;
}

/** Step 1: the Google authorization URL and the cookie that must come back with it. */
export function beginGoogleSignIn(opts: { next?: unknown; lang?: unknown } = {}): { url: string; cookie: string } {
  const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  if (!clientId) throw new Error('Google sign-in is not set up (GOOGLE_OAUTH_CLIENT_ID).');
  const s: GoogleState = {
    state: b64url(crypto.randomBytes(24)),
    verifier: b64url(crypto.randomBytes(48)), // 64 chars: within RFC 7636's 43–128
    nonce: b64url(crypto.randomBytes(24)),
    next: safeNext(opts.next),
    lang: opts.lang === 'en' ? 'en' : 'fr',
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_S,
  };
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', googleRedirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', s.state);
  u.searchParams.set('nonce', s.nonce);
  u.searchParams.set('code_challenge', b64url(sha256(s.verifier)));
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('access_type', 'online');
  u.searchParams.set('prompt', 'select_account');
  u.searchParams.set('hl', s.lang);
  return { url: u.toString(), cookie: stateCookie(encodeState(s)) };
}

// ---------- id_token verification against Google's JWKS (cached) ----------

interface Jwk { kty: string; kid?: string; alg?: string; use?: string; n?: string; e?: string }
let jwksCache: { keys: Jwk[]; at: number } | null = null;

/** Tests reset the cache between cases; production keeps keys for an hour and refetches once on an unknown kid. */
export function resetGoogleJwksCache(): void { jwksCache = null; }

async function fetchJwks(): Promise<Jwk[]> {
  const r = await fetch(GOOGLE_JWKS_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Google JWKS ${r.status}`);
  const body = (await r.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys.filter((k) => k && k.kty === 'RSA' && k.n && k.e) : [];
  if (!keys.length) throw new Error('Google JWKS: no RSA keys');
  jwksCache = { keys, at: Date.now() };
  return keys;
}

async function googleKey(kid: string | undefined): Promise<Jwk | null> {
  const cached = jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS ? jwksCache.keys : null;
  let keys = cached ?? (await fetchJwks());
  let k = keys.find((x) => !kid || x.kid === kid) ?? null;
  if (!k && cached && kid) { keys = await fetchJwks(); k = keys.find((x) => x.kid === kid) ?? null; } // key rotation
  return k;
}

export interface GoogleIdClaims { iss: string; aud: string | string[]; sub: string; exp: number; iat?: number; nonce?: string; email?: string; email_verified?: boolean | string; name?: string; hd?: string }

export type IdTokenResult = { ok: true; claims: GoogleIdClaims } | { ok: false; error: string };

/** Verifies signature (RS256 against the JWKS), iss, aud, exp and nonce. Nothing is trusted before this passes. */
export async function verifyGoogleIdToken(idToken: string, expected: { clientId: string; nonce: string }): Promise<IdTokenResult> {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) return { ok: false, error: 'id_token malformed' };
  let header: { alg?: string; kid?: string };
  let claims: GoogleIdClaims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: 'id_token malformed' };
  }
  if (header.alg !== 'RS256') return { ok: false, error: `id_token alg ${header.alg ?? '?'} refused` };
  let jwk: Jwk | null;
  try { jwk = await googleKey(header.kid); } catch (e) { return { ok: false, error: `Google keys unreachable (${e instanceof Error ? e.message : String(e)})` }; }
  if (!jwk) return { ok: false, error: 'id_token signed with an unknown key' };
  let valid = false;
  try {
    const key = crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
    valid = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: 'id_token signature invalid' };
  const now = Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.has(String(claims.iss))) return { ok: false, error: 'id_token issuer is not Google' };
  const aud = Array.isArray(claims.aud) ? claims.aud : [String(claims.aud)];
  if (!aud.includes(expected.clientId)) return { ok: false, error: 'id_token audience mismatch' };
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) return { ok: false, error: 'id_token expired' };
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > now) return { ok: false, error: 'id_token issued in the future' };
  if (!claims.nonce || !safeStringEqual(String(claims.nonce), expected.nonce)) return { ok: false, error: 'id_token nonce mismatch' };
  if (!claims.sub) return { ok: false, error: 'id_token has no subject' };
  return { ok: true, claims };
}

// ---------- Step 2: the callback ----------

export type GoogleFinish =
  | { ok: true; user: FoodHubUser; next: string; lang: 'fr' | 'en' }
  /** `not_on_team`: Google verified the email, but nobody with it is on the team. Shown as a friendly page, never a 500. */
  | { ok: false; reason: 'not_on_team' | 'unverified' | 'state' | 'google' | 'locked' | 'disabled'; error: string; next?: string; lang?: 'fr' | 'en' };

const BAD_STATE = 'La connexion Google a expiré ou ne vient pas d’ici. Réessayez. / The Google sign-in expired or did not start here. Try again.';

async function refused(summary: string): Promise<void> {
  await logActivity({ actor: 'google', source: 'dashboard', kind: 'login', action: 'sign_in_google', status: 'failed', summary });
}

/** Exchanges the code with Google, checks the id_token, and finds the team member behind the verified email. */
export async function finishGoogleSignIn(input: { code: string; state: string; cookie: string | null | undefined; ip: string; googleError?: string | null }): Promise<GoogleFinish> {
  const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return { ok: false, reason: 'disabled', error: 'Google sign-in is not set up (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET).' };
  const saved = decodeState(input.cookie);
  const lang = saved?.lang ?? 'fr';
  const next = saved?.next ?? '/';
  // Same throttle family as the other sign-ins: per client address, so a flood of bad callbacks locks that address only.
  const key = throttleKey(input.ip, 'google');
  if (isLocked(key)) return { ok: false, reason: 'locked', error: 'Trop d’essais. Attendez une minute. / Too many tries — wait a minute.', lang, next };
  if (input.googleError) return { ok: false, reason: 'google', error: `Google : ${input.googleError.replace(/[^\w .:-]/g, '').slice(0, 80)}`, lang, next };
  if (!saved || !input.state || !input.code || !safeStringEqual(saved.state, input.state)) {
    recordFailure(key);
    await refused('Google callback with a missing or mismatched state');
    return { ok: false, reason: 'state', error: BAD_STATE, lang, next };
  }

  // Code → tokens. The client secret and the PKCE verifier only ever travel from this server to Google.
  let idToken = '';
  try {
    const body = new URLSearchParams({ code: input.code, client_id: clientId, client_secret: clientSecret, redirect_uri: googleRedirectUri(), grant_type: 'authorization_code', code_verifier: saved.verifier });
    const r = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
    const tok = (await r.json().catch(() => ({}))) as { id_token?: string; error?: string };
    if (!r.ok || !tok.id_token) {
      recordFailure(key);
      await refused(`Google refused the code exchange (${tok.error || r.status})`);
      return { ok: false, reason: 'google', error: 'Google n’a pas confirmé la connexion. Réessayez. / Google did not confirm the sign-in. Try again.', lang, next };
    }
    idToken = tok.id_token;
  } catch (e) {
    return { ok: false, reason: 'google', error: `Google injoignable. / Google unreachable. (${e instanceof Error ? e.message : String(e)})`, lang, next };
  }

  const v = await verifyGoogleIdToken(idToken, { clientId, nonce: saved.nonce });
  if (!v.ok) {
    recordFailure(key);
    await refused(`Google id_token refused: ${v.error}`);
    return { ok: false, reason: 'state', error: BAD_STATE, lang, next };
  }
  const verified = v.claims.email_verified === true || v.claims.email_verified === 'true';
  const email = normalizeEmail(v.claims.email);
  if (!verified || !email) {
    recordFailure(key);
    await refused('Google account without a verified email refused');
    return { ok: false, reason: 'unverified', error: 'Ce compte Google n’a pas de courriel vérifié. / This Google account has no verified email.', lang, next };
  }
  const user = await findUserByContact(email);
  if (!user) {
    recordFailure(key); // probing which emails are on the team costs tries, like a wrong code does
    await refused(`Google account not on the team (${maskContact(email)})`);
    return { ok: false, reason: 'not_on_team', error: 'Ce compte Google n’est pas encore dans une équipe Food Hub. / This Google account is not on a Food Hub team yet.', lang, next };
  }
  clearFailures(key);
  await getRepo().saveUser({ ...user, lastLoginAt: new Date().toISOString() }).catch((e) => console.error('[foodhub] lastLoginAt not saved', e instanceof Error ? e.message : e));
  await logActivity({ actor: user.name, source: 'dashboard', kind: 'login', action: 'sign_in_google', status: 'success', summary: `${user.name} signed in with Google (${maskContact(email)})` });
  return { ok: true, user, next, lang: user.prefs?.lang === 'en' ? 'en' : lang };
}

function safeStringEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
