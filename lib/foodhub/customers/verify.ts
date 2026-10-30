// Phone verification by text for the brand websites (contract § A.1–A.2), two providers behind one interface:
//   (a) Twilio Verify when TWILIO_VERIFY_SERVICE_SID is set: Twilio makes, texts and checks the code
//       (POST /v2/Services/{sid}/Verifications, then /VerificationCheck), Basic auth with the existing SID + token;
//   (b) otherwise Food Hub's own 6-digit code texted with sendSms, kept as an HMAC-SHA256 (session secret) in fh_docs,
//       10 minutes, 5 tries, then void.
// Either way the code is never logged, never returned by an API and never stored in clear (the outbox keeps no preview).
// Limits: 3 starts per phone per 10 minutes (fh_docs, survives a restart), 60 starts per brand website per minute (this
// process), and the console's own per-address throttle on wrong codes (session.ts: 5 → one minute, doubling).
import crypto from 'node:crypto';
import { normalizePhone, sendSms, smsConfigured } from '../notify';
import { getRepo } from '../repo';
import { clearFailures, isLocked, recordFailure, sessionKey, throttleKey } from '../session';
import { withKeyLock } from '../storefront/rate-limit';
import { upsertVerifiedCustomer } from './store';
import { signCustomerToken } from './token';
import { customerLang, customerTenant, tenantDisplayName, toPublicCustomer, type CustomerLang, type PublicCustomer } from './types';

export const VERIFY_TTL_S = 600;
export const VERIFY_MAX_ATTEMPTS = 5;
export const PHONE_START_LIMIT = { max: 3, windowMs: 10 * 60_000 };
export const TENANT_START_LIMIT = { max: 60, windowMs: 60_000 };
export const VERIFY_COL = 'customer_verifications';
export const VERIFY_RL_COL = 'customer_verify_rl';
export const TWILIO_VERIFY_URL = 'https://verify.twilio.com';

export type VerifyProviderKind = 'twilio_verify' | 'foodhub_sms';

/** Twilio Verify when its service is set; else Food Hub's own texted code. */
export function verifyProviderKind(env: NodeJS.ProcessEnv = process.env): VerifyProviderKind {
  return String(env.TWILIO_VERIFY_SERVICE_SID ?? '').trim() ? 'twilio_verify' : 'foodhub_sms';
}

/** What a start needs to be able to text at all (for the console readiness line). */
export function verifyReadiness(env: NodeJS.ProcessEnv = process.env): { ok: boolean; provider: VerifyProviderKind; reason?: string } {
  const provider = verifyProviderKind(env);
  if (provider === 'twilio_verify') {
    return env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN ? { ok: true, provider } : { ok: false, provider, reason: 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing for Twilio Verify.' };
  }
  return smsConfigured() ? { ok: true, provider } : { ok: false, provider, reason: 'SMS is not set up (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID).' };
}

// ---------- texts ----------

export function verifySmsText(code: string, tenant: string, lang: CustomerLang): string {
  const brand = tenantDisplayName(tenant);
  return lang === 'en' ? `Your ${brand} code: ${code} (valid 10 min). Do not share it.` : `Votre code ${brand} : ${code} (valide 10 min). Ne le partagez pas.`;
}

// ---------- storage ----------

interface Challenge {
  id: string;
  tenant: string;
  lang: CustomerLang;
  provider: VerifyProviderKind;
  /** Own provider only: HMAC-SHA256(session secret, "<id>|<code>"), base64url. Never the code. */
  codeHash?: string;
  startedAt: string;
  expiresAt: string;
  attempts: number;
  void: boolean;
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
const challengeId = (tenant: string, phone: string) => sha(`verify|${tenant}|${phone}`);
const rlId = (phone: string) => sha(`verify-rl|${phone}`);
const enc = new TextEncoder();

async function codeHash(id: string, code: string): Promise<string> {
  const k = await sessionKey();
  if (!k) throw new Error('Set SESSION_SECRET (npm run setup) to enable phone verification.');
  return Buffer.from(await crypto.subtle.sign('HMAC', k, enc.encode(`${id}|${code}`))).toString('base64url');
}

async function putChallenge(ch: Challenge): Promise<void> {
  await getRepo().putDocs<Challenge>(VERIFY_COL, [{ id: ch.id, key: ch.tenant, at: ch.startedAt, data: ch }]);
}
async function getChallenge(id: string): Promise<Challenge | null> {
  return (await getRepo().getDoc<Challenge>(VERIFY_COL, id))?.data ?? null;
}
async function dropChallenge(id: string): Promise<void> {
  await getRepo().deleteDocs(VERIFY_COL, [id]).catch(() => undefined);
}

// ---------- rate limits ----------

type Mem = { tenant: Map<string, number[]> };
const mem = (): Mem => {
  const g = globalThis as unknown as { __fhCustomerVerify?: Mem };
  g.__fhCustomerVerify ??= { tenant: new Map() };
  return g.__fhCustomerVerify;
};
/** Test hook: forgets the in-memory per-website counters. */
export function resetCustomerVerifyLimits(): void { mem().tenant.clear(); }

const recent = (list: unknown, now: number, windowMs: number): number[] => (Array.isArray(list) ? list : []).filter((t): t is number => typeof t === 'number' && t > now - windowMs && t <= now + 60_000);
const retryAfterS = (oldest: number, windowMs: number, now: number) => Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));

function tenantSlot(tenant: string, now: number, take: boolean): { ok: true } | { ok: false; retryAfterS: number } {
  const map = mem().tenant;
  const list = recent(map.get(tenant), now, TENANT_START_LIMIT.windowMs);
  if (list.length >= TENANT_START_LIMIT.max) { map.set(tenant, list); return { ok: false, retryAfterS: retryAfterS(list[0], TENANT_START_LIMIT.windowMs, now) }; }
  map.set(tenant, take ? [...list, now] : list);
  return { ok: true };
}

async function phoneSlot(phone: string, now: number): Promise<{ ok: true } | { ok: false; retryAfterS: number }> {
  const id = rlId(phone);
  return withKeyLock(`cust_verify_rl:${id}`, async () => {
    const repo = getRepo();
    const doc = await repo.getDoc<{ hits: number[] }>(VERIFY_RL_COL, id).catch(() => null);
    const hits = recent(doc?.data.hits, now, PHONE_START_LIMIT.windowMs);
    if (hits.length >= PHONE_START_LIMIT.max) return { ok: false as const, retryAfterS: retryAfterS(hits[0], PHONE_START_LIMIT.windowMs, now) };
    await repo.putDocs(VERIFY_RL_COL, [{ id, at: new Date(now).toISOString(), data: { hits: [...hits, now] } }]);
    return { ok: true as const };
  });
}

// ---------- input ----------

export type VerifyInput = { tenant: string; phone: string; lang: CustomerLang };
export type InputError = { ok: false; status: number; error: string };

const TOO_MANY = 'Trop de demandes. Réessayez plus tard. / Too many requests — try again later.';

export function parseVerifyInput(body: Record<string, unknown> | null | undefined): { ok: true; input: VerifyInput } | InputError {
  const tenant = customerTenant(body?.tenant);
  if (!tenant) return { ok: false, status: 403, error: 'Unknown brand website (tenant).' };
  const phone = normalizePhone(typeof body?.phone === 'string' || typeof body?.phone === 'number' ? String(body.phone) : null);
  if (!phone || !/^\+1\d{10}$/.test(phone)) return { ok: false, status: 422, error: 'Entrez un numéro de cellulaire valide (10 chiffres). / Enter a valid cell number (10 digits).' };
  return { ok: true, input: { tenant, phone, lang: customerLang(body?.lang) } };
}

// ---------- providers ----------

export interface VerifyDeps { fetch?: typeof fetch; now?: number }

function twilioAuthHeader(): string {
  return `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`;
}
function twilioVerifyUrl(path: string): string {
  const base = String(process.env.TWILIO_VERIFY_BASE_URL || TWILIO_VERIFY_URL).replace(/\/+$/, '');
  return `${base}/v2/Services/${encodeURIComponent(String(process.env.TWILIO_VERIFY_SERVICE_SID).trim())}/${path}`;
}

type TwilioAnswer = { ok: true; status: number; body: Record<string, any> } | { ok: false; error: string };

async function twilioPost(path: string, form: Record<string, string>, deps: VerifyDeps): Promise<TwilioAnswer> {
  const f = deps.fetch ?? globalThis.fetch;
  try {
    const res = await f(twilioVerifyUrl(path), {
      method: 'POST', headers: { Authorization: twilioAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    return { ok: true, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Twilio's own message, shortened and without anything that looks like a secret. */
const twilioWhy = (b: Record<string, any> | undefined) => String(b?.message ?? '').replace(/\s+/g, ' ').slice(0, 120);

// ---------- start ----------

export type StartResult = { ok: true; expiresInS: number; channel: 'sms'; provider: VerifyProviderKind } | { ok: false; status: number; error: string; retryAfterS?: number };

export async function startVerification(body: Record<string, unknown> | null | undefined, deps: VerifyDeps = {}): Promise<StartResult> {
  const parsed = parseVerifyInput(body);
  if (!parsed.ok) return parsed;
  const { tenant, phone, lang } = parsed.input;
  const now = deps.now ?? Date.now();
  const ready = verifyReadiness();
  if (!ready.ok) return { ok: false, status: 503, error: `Impossible d'envoyer le code. / Could not send the code. (${ready.reason})` };
  const peek = tenantSlot(tenant, now, false);
  if (!peek.ok) return { ok: false, status: 429, error: TOO_MANY, retryAfterS: peek.retryAfterS };
  const byPhone = await phoneSlot(phone, now);
  if (!byPhone.ok) return { ok: false, status: 429, error: 'Trop de codes demandés pour ce numéro. Attendez quelques minutes. / Too many codes for this number — wait a few minutes.', retryAfterS: byPhone.retryAfterS };
  const byTenant = tenantSlot(tenant, now, true);
  if (!byTenant.ok) return { ok: false, status: 429, error: TOO_MANY, retryAfterS: byTenant.retryAfterS };

  const id = challengeId(tenant, phone);
  const startedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + VERIFY_TTL_S * 1000).toISOString();
  if (ready.provider === 'twilio_verify') {
    const r = await twilioPost('Verifications', { To: phone, Channel: 'sms', Locale: lang }, deps);
    if (!r.ok) return { ok: false, status: 503, error: `Twilio Verify injoignable. / Twilio Verify unreachable. (${r.error})` };
    if (r.status === 429) return { ok: false, status: 429, error: TOO_MANY, retryAfterS: VERIFY_TTL_S };
    if (r.status === 400 && Number(r.body?.code) === 60200) return { ok: false, status: 422, error: 'Numéro refusé par Twilio Verify. / Number refused by Twilio Verify.' };
    if (r.status < 200 || r.status >= 300) return { ok: false, status: 503, error: `Twilio Verify HTTP ${r.status}${twilioWhy(r.body) ? `: ${twilioWhy(r.body)}` : ''}` };
    await putChallenge({ id, tenant, lang, provider: 'twilio_verify', startedAt, expiresAt, attempts: 0, void: false });
    return { ok: true, expiresInS: VERIFY_TTL_S, channel: 'sms', provider: 'twilio_verify' };
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await putChallenge({ id, tenant, lang, provider: 'foodhub_sms', codeHash: await codeHash(id, code), startedAt, expiresAt, attempts: 0, void: false });
  const sent = await sendSms({ to: phone, body: verifySmsText(code, tenant, lang) }, { purpose: 'customer_verify', secret: true });
  if (!sent.ok) {
    await dropChallenge(id);
    return { ok: false, status: 503, error: `Impossible d'envoyer le code. / Could not send the code. (${sent.message})` };
  }
  return { ok: true, expiresInS: VERIFY_TTL_S, channel: 'sms', provider: 'foodhub_sms' };
}

// ---------- check ----------

export type CheckResult = { ok: true; tenant: string; phone: string; lang: CustomerLang } | { ok: false; status: number; error: string; attemptsLeft?: number };

const WRONG = 'Code incorrect. / Wrong code.';
const AGAIN = 'Ce code a expiré ou n’est plus valide. Demandez-en un nouveau. / This code expired or is no longer valid — ask for a new one.';

/** Checks the code only (no account, no token). `ip` feeds the per-address throttle on wrong codes. */
export async function checkVerification(body: Record<string, unknown> | null | undefined, ip: string, deps: VerifyDeps = {}): Promise<CheckResult> {
  const parsed = parseVerifyInput(body);
  if (!parsed.ok) return parsed;
  const { tenant, phone } = parsed.input;
  const code = String(body?.code ?? '').replace(/\s+/g, '');
  if (!/^\d{4,10}$/.test(code)) return { ok: false, status: 400, error: 'Entrez le code à 6 chiffres reçu par texto. / Enter the 6-digit code from the text.' };
  const key = throttleKey(ip, `cust:${phone}`);
  if (isLocked(key)) return { ok: false, status: 429, error: 'Trop d’essais. Attendez une minute. / Too many tries — wait a minute.', attemptsLeft: 0 };
  const now = deps.now ?? Date.now();
  const id = challengeId(tenant, phone);
  const ch = await getChallenge(id);
  if (!ch || ch.void || Date.parse(ch.expiresAt) < now) return { ok: false, status: 410, error: AGAIN, attemptsLeft: 0 };
  const wrong = async (): Promise<CheckResult> => {
    const attempts = ch.attempts + 1;
    const dead = attempts >= VERIFY_MAX_ATTEMPTS;
    await putChallenge({ ...ch, attempts, void: dead });
    recordFailure(key);
    return dead ? { ok: false, status: 410, error: AGAIN, attemptsLeft: 0 } : { ok: false, status: 401, error: WRONG, attemptsLeft: VERIFY_MAX_ATTEMPTS - attempts };
  };
  if (ch.provider === 'twilio_verify') {
    const r = await twilioPost('VerificationCheck', { To: phone, Code: code }, deps);
    if (!r.ok) return { ok: false, status: 503, error: `Twilio Verify injoignable. / Twilio Verify unreachable. (${r.error})` };
    if (r.status === 404) { await putChallenge({ ...ch, void: true }); return { ok: false, status: 410, error: AGAIN, attemptsLeft: 0 }; }
    if (r.status === 429) { await putChallenge({ ...ch, void: true }); recordFailure(key); return { ok: false, status: 410, error: AGAIN, attemptsLeft: 0 }; }
    if (r.status < 200 || r.status >= 300) return { ok: false, status: 503, error: `Twilio Verify HTTP ${r.status}${twilioWhy(r.body) ? `: ${twilioWhy(r.body)}` : ''}` };
    if (r.body?.status !== 'approved') return wrong();
  } else {
    if (code.length !== 6 || !ch.codeHash) return wrong();
    const given = Buffer.from(await codeHash(id, code));
    const kept = Buffer.from(ch.codeHash);
    if (given.length !== kept.length || !crypto.timingSafeEqual(given, kept)) return wrong();
  }
  await dropChallenge(id);
  clearFailures(key);
  return { ok: true, tenant, phone, lang: ch.lang };
}

export type CompleteResult = { ok: true; token: string; expiresAt: string; customer: PublicCustomer; created: boolean } | { ok: false; status: number; error: string; attemptsLeft?: number };

/** Contract § A.2: right code → the customer (created the first time) and a signed token for that brand website. */
export async function completeVerification(body: Record<string, unknown> | null | undefined, ip: string, deps: VerifyDeps = {}): Promise<CompleteResult> {
  const r = await checkVerification(body, ip, deps);
  if (!r.ok) return r;
  const { customer, created } = await upsertVerifiedCustomer({ phone: r.phone, tenant: r.tenant, lang: r.lang });
  const { token, expiresAt } = await signCustomerToken(customer, r.tenant);
  return { ok: true, token, expiresAt, customer: toPublicCustomer(customer), created };
}
