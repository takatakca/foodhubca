// ON2GO sign-in through TAKATAK (contract C3, takatak-v1 docs/ON2GO_MASTER_API.md): a person signed in on TAKATAK
// opens on2go.ca with a one-time launch code (90 s). on2go.ca is a static site, so it hands the code to Food Hub;
// Food Hub exchanges it server to server with its own service token, keys the customer on the VERIFIED phone that
// TAKATAK returns (the same record the texted-code sign-in uses), and hands back the usual signed customer token
// for the "on2go" brand website. The launch code is the only credential the browser holds: one use, 90 seconds.
import { logActivity } from '../activity';
import { normalizePhone } from '../notify';
import { saveCustomer, upsertVerifiedCustomer } from './store';
import { signCustomerToken } from './token';
import { ON2GO_TENANT, toPublicCustomer, type CustomerLang, type MasterCustomer, type PublicCustomer } from './types';

export const TAKATAK_EXCHANGE_PATH = '/api/experiences/on2go/exchange';
export const TAKATAK_TIMEOUT_MS = 8_000;
/** Launch codes per IP: 10 tries in 10 minutes (a code is single-use; a stream of them is someone guessing). */
export const BRIDGE_IP_LIMIT = { max: 10, windowMs: 10 * 60_000 };

export interface TakatakBridgeConfig { baseUrl: string; serviceToken: string }

/** TAKATAK_API_URL (https; localhost only outside production) + TAKATAK_ON2GO_SERVICE_TOKEN (≥ 32 characters). */
export function takatakBridgeConfig(env: NodeJS.ProcessEnv = process.env): { ok: true; config: TakatakBridgeConfig } | { ok: false; reason: string } {
  const raw = String(env.TAKATAK_API_URL ?? '').trim().replace(/\/+$/, '');
  const token = String(env.TAKATAK_ON2GO_SERVICE_TOKEN ?? '').trim();
  let url: URL | null = null;
  try { url = raw ? new URL(raw) : null; } catch { url = null; }
  const local = url?.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(url.hostname) && env.NODE_ENV !== 'production';
  if (!url || (url.protocol !== 'https:' && !local)) return { ok: false, reason: 'Set TAKATAK_API_URL (https) to enable sign-in with TAKATAK.' };
  if (token.length < 32) return { ok: false, reason: 'Set TAKATAK_ON2GO_SERVICE_TOKEN (32+ characters, the same value as in takatak-v1).' };
  return { ok: true, config: { baseUrl: url.origin + url.pathname.replace(/\/+$/, ''), serviceToken: token } };
}

export const isLaunchCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(v.trim());

export interface TakatakSession {
  identityId: string;
  displayName: string | null;
  /** E.164, present only when TAKATAK verified it. */
  phone: string | null;
  email: string | null;
  locale: string | null;
  expiresAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** The `session` object of takatak-v1's exchange answer, checked field by field; null when it is not one. */
export function parseTakatakSession(body: unknown): TakatakSession | null {
  const s = (body as { ok?: unknown; session?: Record<string, unknown> } | null)?.session;
  if (!s || (body as { ok?: unknown }).ok !== true || s.active !== true || s.product !== 'on2go') return null;
  const identityId = str(s.identityId, 64);
  const expiresAt = str(s.expiresAt, 40);
  if (!identityId || !UUID.test(identityId) || !expiresAt || Number.isNaN(Date.parse(expiresAt))) return null;
  const phone = s.phone ? normalizePhone(String(s.phone)) : null;
  return { identityId, displayName: str(s.displayName, 120), phone, email: str(s.email, 254), locale: str(s.locale, 16), expiresAt };
}

export type ExchangeResult = { ok: true; session: TakatakSession } | { ok: false; status: number; error: string };

/** One POST to takatak-v1 with the service token. A refused code is 401; TAKATAK unreachable or misconfigured is 503. */
export async function exchangeLaunchCode(code: string, deps: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv } = {}): Promise<ExchangeResult> {
  const cfg = takatakBridgeConfig(deps.env);
  if (!cfg.ok) return { ok: false, status: 503, error: cfg.reason };
  const f = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${cfg.config.baseUrl}${TAKATAK_EXCHANGE_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.config.serviceToken}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ code: code.trim() }),
      signal: AbortSignal.timeout(TAKATAK_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 503, error: 'TAKATAK could not be reached. Try again in a moment.' };
  }
  if (res.status === 403 || res.status === 400 || res.status === 404) return { ok: false, status: 401, error: 'This sign-in link expired or was already used. Open ON2GO again from TAKATAK.' };
  if (!res.ok) return { ok: false, status: 503, error: 'TAKATAK could not open the session. Try again in a moment.' };
  const session = parseTakatakSession(await res.json().catch(() => null));
  return session ? { ok: true, session } : { ok: false, status: 503, error: 'TAKATAK answered something Food Hub does not understand.' };
}

/** In-memory per-IP window (one container; the code itself is the real guard). */
const hits = new Map<string, number[]>();
export function resetBridgeLimits(): void { hits.clear(); }
export function allowBridgeAttempt(ip: string, now = Date.now()): { ok: true } | { ok: false; retryAfterS: number } {
  const key = ip || 'unknown';
  const recent = (hits.get(key) ?? []).filter((t) => now - t < BRIDGE_IP_LIMIT.windowMs);
  if (recent.length >= BRIDGE_IP_LIMIT.max) return { ok: false, retryAfterS: Math.max(1, Math.ceil((BRIDGE_IP_LIMIT.windowMs - (now - recent[0])) / 1000)) };
  recent.push(now);
  hits.set(key, recent);
  return { ok: true };
}

const langOf = (locale: string | null, fallback: CustomerLang): CustomerLang => (/^en/i.test(locale ?? '') ? 'en' : /^fr/i.test(locale ?? '') ? 'fr' : fallback);

export type BridgeResult =
  | { ok: true; token: string; expiresAt: string; customer: PublicCustomer; created: boolean }
  | { ok: false; status: number; error: string; retryAfterS?: number };

/** Code → TAKATAK session → the customer on its verified phone (created the first time) → a token for "on2go". */
export async function signInWithTakatak(body: Record<string, unknown> | null | undefined, ip: string, deps: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv; now?: number } = {}): Promise<BridgeResult> {
  const code = body?.code;
  if (!isLaunchCode(code)) return { ok: false, status: 400, error: 'A TAKATAK launch code is required.' };
  const gate = allowBridgeAttempt(ip, deps.now);
  if (!gate.ok) return { ok: false, status: 429, error: 'Too many sign-in attempts. Wait a few minutes.', retryAfterS: gate.retryAfterS };

  const ex = await exchangeLaunchCode(code, deps);
  if (!ex.ok) return ex;
  const s = ex.session;
  // A customer is a verified cell number (task 72): a TAKATAK account with only an e-mail cannot order yet.
  if (!s.phone) return { ok: false, status: 409, error: 'Add and verify a cell number on your TAKATAK account, then open ON2GO again.' };

  const { customer, created } = await upsertVerifiedCustomer({ phone: s.phone, tenant: ON2GO_TENANT, lang: langOf(s.locale, 'fr'), via: 'takatak' });
  let rec: MasterCustomer = customer;
  const patch: Partial<MasterCustomer> = {};
  if (rec.takatakIdentityId !== s.identityId) patch.takatakIdentityId = s.identityId;
  if (!rec.name && s.displayName) patch.name = s.displayName;
  if (!rec.email && s.email) patch.email = s.email;
  if (Object.keys(patch).length) rec = await saveCustomer({ ...rec, ...patch });
  if (patch.takatakIdentityId && customer.takatakIdentityId && customer.takatakIdentityId !== s.identityId) {
    await logActivity({ actor: ON2GO_TENANT, source: 'api', kind: 'customer', action: 'customer_takatak_relinked', status: 'info', summary: `Customer ${rec.id} now linked to another TAKATAK identity (same verified phone)` });
  }
  const { token, expiresAt } = await signCustomerToken(rec, ON2GO_TENANT);
  return { ok: true, token, expiresAt, customer: toPublicCustomer(rec), created };
}

/** For the health page: is the bridge configured (never the values). */
export function bridgeReadiness(env: NodeJS.ProcessEnv = process.env): { ok: boolean; reason?: string } {
  const c = takatakBridgeConfig(env);
  return c.ok ? { ok: true } : { ok: false, reason: c.reason };
}

