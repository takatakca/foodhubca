// Passwordless sign-in: type your email or cell number → get a 6-digit code (and a one-tap link).
// Codes and links expire after 10 minutes, work once, and allow 5 tries. Only hashes are stored.
import crypto from 'node:crypto';
import { logActivity } from '../activity';
import { publicBaseUrl } from '../config';
import { emailConfigured, maskContact, normalizeEmail, normalizePhone, sendEmail, sendSms, smsConfigured } from '../notify';
import { getRepo } from '../repo';
import type { FoodHubUser, Role } from '../types';

export const CHALLENGES = 'auth_challenges';
const TTL_MS = 10 * 60_000;

interface Challenge {
  id: string;
  username: string;
  channel: 'email' | 'sms';
  to: string;
  codeHash: string;
  linkHash: string;
  expiresAt: string;
  attempts: number;
  used: boolean;
  next: string;
  createdAt: string;
  /** hashed contact (rate limit key) */
  ck: string;
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const contactKey = (c: string) => sha(`contact|${c}`).slice(0, 32);

/** Insecure helper for local development and automated tests only: show the code on screen when it could not be sent. */
export function showCodesOnScreen(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.FOODHUB_INSECURE_SHOW_CODES === 'true';
}

export function parseContact(raw: string): { kind: 'email' | 'phone'; value: string } | null {
  const email = normalizeEmail(raw);
  if (email) return { kind: 'email', value: email };
  const phone = normalizePhone(raw);
  return phone ? { kind: 'phone', value: phone } : null;
}

export async function findUserByContact(raw: string): Promise<FoodHubUser | null> {
  const c = parseContact(raw);
  if (!c) return null;
  const users = await getRepo().listUsers();
  return users.find((u) => u.active && (c.kind === 'email' ? normalizeEmail(u.email) === c.value : normalizePhone(u.phone) === c.value)) ?? null;
}

/** Only allow redirects to a path on this site. */
export function safeNext(next: unknown): string {
  const s = typeof next === 'string' ? next : '';
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/api/') && !s.startsWith('/login') ? s.slice(0, 300) : '/';
}

export type StartResult =
  | { ok: true; challengeId: string; channel: 'email' | 'sms'; sentTo: string; devCode?: string; devLink?: string; delivered: boolean }
  | { ok: false; status: number; error: string };

export async function startChallenge(raw: string, opts: { next?: string; origin?: string; lang?: 'fr' | 'en' } = {}): Promise<StartResult> {
  const c = parseContact(raw);
  if (!c) return { ok: false, status: 400, error: 'Entrez un courriel ou un numéro de cellulaire valide. / Enter a valid email or cell number.' };
  const repo = getRepo();
  const key = contactKey(c.value);
  const recent = await repo.listDocs<Challenge>(CHALLENGES, { keys: [key], since: new Date(Date.now() - 15 * 60_000).toISOString(), limit: 20 });
  if (recent.length >= 5) return { ok: false, status: 429, error: 'Trop de demandes. Attendez 15 minutes. / Too many requests — wait 15 minutes.' };

  const id = crypto.randomUUID();
  const user = await findUserByContact(c.value);
  // Unknown contact: answer exactly like a known one (no way to probe who has access).
  if (!user) {
    await repo.putDocs(CHALLENGES, [{ id, key, at: new Date().toISOString(), data: { id, unknown: true } }]);
    return { ok: true, challengeId: id, channel: c.kind === 'email' ? 'email' : 'sms', sentTo: maskContact(c.value), delivered: true };
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const token = crypto.randomBytes(24).toString('base64url');
  const next = safeNext(opts.next);
  const ch: Challenge = {
    id, username: user.username, channel: c.kind === 'email' ? 'email' : 'sms', to: maskContact(c.value), codeHash: sha(`${id}|${code}`), linkHash: sha(`${id}|${token}`),
    expiresAt: new Date(Date.now() + TTL_MS).toISOString(), attempts: 0, used: false, next, createdAt: new Date().toISOString(), ck: key,
  };
  await repo.putDocs(CHALLENGES, [{ id, key, at: ch.createdAt, data: ch }]);

  const base = process.env.FOODHUB_PUBLIC_URL ? publicBaseUrl() : (opts.origin || publicBaseUrl());
  const link = `${base}/api/foodhub/auth/link?c=${id}&t=${token}`;
  const fr = (opts.lang ?? user.prefs?.lang ?? 'fr') === 'fr';
  let delivered = false;
  if (ch.channel === 'email') {
    const first = user.name.split(' ')[0];
    const r = await sendEmail({
      to: c.value,
      subject: fr ? `Votre code TAKATAK : ${code}` : `Your TAKATAK code: ${code}`,
      text: fr
        ? `Bonjour ${first},\n\nVotre code de connexion : ${code}\n\nOu connectez-vous en un clic : ${link}\n\nLe code expire dans 10 minutes. Vous n'avez rien demandé ? Ignorez ce courriel.\n\n— TAKATAK Food Hub`
        : `Hi ${first},\n\nYour sign-in code: ${code}\n\nOr sign in with one tap: ${link}\n\nThe code expires in 10 minutes. Didn't ask for it? Ignore this email.\n\n— TAKATAK Food Hub`,
      html: emailHtml(first, code, link, fr),
    }, { purpose: 'sign_in', secret: true });
    delivered = r.ok;
  } else {
    const host = (() => { try { return new URL(base).host; } catch { return ''; } })();
    const r = await sendSms({ to: c.value, body: `${fr ? 'TAKATAK : votre code est' : 'TAKATAK: your code is'} ${code} (10 min).\n${link}${host ? `\n\n@${host} #${code}` : ''}` }, { purpose: 'sign_in', secret: true });
    delivered = r.ok;
  }
  if (!delivered && !showCodesOnScreen()) {
    const how = ch.channel === 'email' ? (emailConfigured() ? 'the email could not be sent' : 'email is not set up yet') : (smsConfigured() ? 'the SMS could not be sent' : 'SMS is not set up yet');
    return { ok: false, status: 503, error: `Impossible d'envoyer le code (${how}). Utilisez la connexion de secours du propriétaire. / Could not send the code — ${how}. Use the owner recovery sign-in.` };
  }
  return { ok: true, challengeId: id, channel: ch.channel, sentTo: ch.to, delivered, ...(!delivered ? { devCode: code, devLink: link } : {}) };
}

type VerifyResult = { ok: true; user: FoodHubUser; next: string } | { ok: false; status: number; error: string };

async function finish(ch: Challenge, how: 'otp' | 'link'): Promise<VerifyResult> {
  const repo = getRepo();
  await repo.putDocs(CHALLENGES, [{ id: ch.id, key: ch.ck, at: ch.createdAt, data: { ...ch, used: true } }]);
  const user = await repo.getUser(ch.username);
  if (!user?.active) return { ok: false, status: 403, error: 'Accès désactivé. / Access removed.' };
  await repo.saveUser({ ...user, lastLoginAt: new Date().toISOString() });
  await logActivity({ actor: user.name, source: 'dashboard', kind: 'login', action: how === 'link' ? 'sign_in_link' : 'sign_in_code', status: 'success', summary: `${user.name} signed in with a ${how === 'link' ? 'one-tap link' : 'code'} (${ch.to})` });
  return { ok: true, user, next: ch.next };
}

export async function verifyCode(challengeId: string, code: string): Promise<VerifyResult> {
  const repo = getRepo();
  const doc = await repo.getDoc<Challenge & { unknown?: boolean }>(CHALLENGES, String(challengeId));
  const bad = { ok: false as const, status: 401, error: 'Code incorrect ou expiré. / Wrong or expired code.' };
  if (!doc || doc.data.unknown || !/^\d{6}$/.test(String(code).trim())) return bad;
  const ch = doc.data;
  if (ch.used || Date.parse(ch.expiresAt) < Date.now()) return { ok: false, status: 410, error: 'Ce code a expiré. Demandez-en un nouveau. / This code expired — ask for a new one.' };
  if (ch.attempts >= 5) return { ok: false, status: 429, error: 'Trop d’essais. Demandez un nouveau code. / Too many tries — ask for a new code.' };
  const given = sha(`${ch.id}|${String(code).trim()}`);
  if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(ch.codeHash))) {
    await repo.putDocs(CHALLENGES, [{ id: ch.id, key: ch.ck, at: ch.createdAt, data: { ...ch, attempts: ch.attempts + 1 } }]);
    await logActivity({ actor: ch.username, source: 'dashboard', kind: 'login', action: 'sign_in_code', status: 'failed', summary: `Wrong sign-in code for ${ch.to}` });
    return bad;
  }
  return finish(ch, 'otp');
}

export async function verifyLink(challengeId: string, token: string): Promise<VerifyResult> {
  const doc = await getRepo().getDoc<Challenge & { unknown?: boolean }>(CHALLENGES, String(challengeId));
  if (!doc || doc.data.unknown || !token) return { ok: false, status: 401, error: 'Lien invalide. / Invalid link.' };
  const ch = doc.data;
  if (ch.used || Date.parse(ch.expiresAt) < Date.now()) return { ok: false, status: 410, error: 'Ce lien a expiré ou a déjà servi. / This link expired or was already used.' };
  const given = sha(`${ch.id}|${token}`);
  if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(ch.linkHash))) return { ok: false, status: 401, error: 'Lien invalide. / Invalid link.' };
  return finish(ch, 'link');
}

// ---------- First run: create the owner account ----------

export async function firstRunNeeded(): Promise<boolean> {
  return (await getRepo().listUsers()).length === 0;
}

/**
 * Creating the first owner is allowed when no account exists yet AND one of:
 *   - development mode, or
 *   - the email / phone matches FOODHUB_OWNER_EMAIL / FOODHUB_OWNER_PHONE, or
 *   - the setup key equals DASHBOARD_PASSWORD.
 */
export async function createFirstOwner(input: { name: string; email?: string; phone?: string; setupKey?: string }): Promise<{ ok: true; user: FoodHubUser } | { ok: false; status: number; error: string }> {
  if (!(await firstRunNeeded())) return { ok: false, status: 409, error: 'Le propriétaire existe déjà. / The owner account already exists.' };
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  if (!email && !phone) return { ok: false, status: 400, error: 'Courriel ou cellulaire requis. / Email or cell number required.' };
  const name = String(input.name || '').trim().slice(0, 60);
  if (!name) return { ok: false, status: 400, error: 'Nom requis. / Name required.' };
  const allowed = process.env.NODE_ENV !== 'production'
    || (email && normalizeEmail(process.env.FOODHUB_OWNER_EMAIL) === email)
    || (phone && normalizePhone(process.env.FOODHUB_OWNER_PHONE) === phone)
    || (process.env.DASHBOARD_PASSWORD && input.setupKey === process.env.DASHBOARD_PASSWORD);
  if (!allowed) return { ok: false, status: 403, error: 'Clé de configuration requise (DASHBOARD_PASSWORD) ou FOODHUB_OWNER_EMAIL. / Setup key required.' };
  const base = (email ? email.split('@')[0] : `owner${phone!.slice(-4)}`).replace(/[^a-z0-9._-]/g, '').slice(0, 30) || 'owner1';
  const username = base === 'owner' ? 'owner1' : base;
  const user = await getRepo().saveUser({ username, name, role: 'owner' as Role, locations: [], email, phone, active: true, prefs: { lang: 'fr', alertSms: true, alertCall: true, onDuty: true } });
  await logActivity({ actor: name, source: 'dashboard', kind: 'users', action: 'create_owner', status: 'success', summary: `Owner account created for ${name}` });
  return { ok: true, user };
}

function emailHtml(first: string, code: string, link: string, fr: boolean) {
  const esc = (s: string) => s.replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]!));
  return `<!doctype html><html><body style="margin:0;background:#f4f4f2;font-family:Helvetica,Arial,sans-serif;color:#141414">
<div style="max-width:440px;margin:32px auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #e6e5df">
<div style="font-weight:800;letter-spacing:.08em;font-size:13px;color:#ff5b14">TAKATAK</div>
<p style="font-size:16px;margin:20px 0 8px">${fr ? 'Bonjour' : 'Hi'} ${esc(first)},</p>
<p style="font-size:15px;color:#55534d;margin:0 0 20px">${fr ? 'Votre code de connexion :' : 'Your sign-in code:'}</p>
<div style="font-size:36px;font-weight:800;letter-spacing:.3em;text-align:center;background:#f7f6f2;border-radius:12px;padding:18px 0">${code}</div>
<p style="text-align:center;margin:24px 0"><a href="${esc(link)}" style="display:inline-block;background:#141414;color:#fff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:12px">${fr ? 'Me connecter en un clic' : 'Sign in with one tap'}</a></p>
<p style="font-size:13px;color:#8a877f;margin:0">${fr ? "Expire dans 10 minutes. Vous n'avez rien demandé ? Ignorez ce courriel." : "Expires in 10 minutes. Didn't ask for it? Ignore this email."}</p>
</div></body></html>`;
}
