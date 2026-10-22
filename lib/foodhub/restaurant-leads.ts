// Restaurant leads: the "Join / get listed" form on ON2GO.ca (static site, separate repo) posts here.
//
//   POST /api/public/restaurant-leads  (app/api/public/restaurant-leads/route.ts) — no sign-in, CORS for on2go.ca only
//   GET/POST /api/foodhub/restaurant-leads (owner only) — the list in Settings → Restaurant leads
//
// A lead is a real restaurant (brick-and-mortar) asking to be listed on ON2GO or to use Food Hub. It is stored as a
// document in the "restaurant_leads" collection (fh_docs, same table pattern as the outbox and payout lines: no new
// migration), newest first, with a status the owner moves by hand (new → contacted → won / lost) and private notes.
// Spam: a hidden "company" field (honeypot) silently drops the submission, every IP gets a small quota, and every text
// field has a hard length limit. The notification email goes to FOODHUB_SUPPORT_EMAIL and the lead receives a short
// FR / EN auto-reply; both are skipped (never an error) when no email provider is set.
import crypto from 'node:crypto';
import { normalizeEmail, normalizePhone, sendEmail } from './notify';
import { getRepo, type Doc } from './repo';

export const LEADS = 'restaurant_leads';
export const LEAD_PLATFORMS = ['uber', 'doordash', 'skip', 'tgtg', 'direct', 'phone'] as const;
export type LeadPlatform = (typeof LEAD_PLATFORMS)[number];
export const LEAD_STATUSES = ['new', 'contacted', 'won', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadLang = 'fr' | 'en';

/** What the public form sends (after validation). */
export interface LeadInput {
  restaurant: string;
  contact: string;
  email: string;
  phone: string;
  city: string;
  address?: string;
  website?: string;
  platforms: LeadPlatform[];
  brands?: number;
  message?: string;
  lang: LeadLang;
  source: string;
}

/** What is stored and shown in the console. */
export interface RestaurantLead extends LeadInput {
  id: string;
  at: string;
  status: LeadStatus;
  notes: string;
  updatedAt: string;
  /** Who last changed the status or notes (console username). */
  updatedBy?: string;
}

// ---------------------------------------------------------------------------
// CORS: the form lives on on2go.ca only (no localhost, no partners: this endpoint writes).
// ---------------------------------------------------------------------------
export const LEAD_ORIGINS = ['https://on2go.ca', 'https://www.on2go.ca'];

export function leadOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  const o = origin.trim().replace(/\/+$/, '').toLowerCase();
  return LEAD_ORIGINS.includes(o) ? o : null;
}

export function leadCorsHeaders(origin: string | null | undefined): Record<string, string> {
  const o = leadOrigin(origin);
  return o
    ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
    : { Vary: 'Origin' };
}

// ---------------------------------------------------------------------------
// Per-IP quota (per process): 5 submissions per 10 minutes, then 429 until the window passes.
// The sign-in throttle (session.ts) counts failures only; a lead form needs a plain count, so this is its own map.
// ---------------------------------------------------------------------------
export const LEAD_RATE_MAX = 5;
export const LEAD_RATE_WINDOW_MS = 10 * 60_000;
const MAX_BUCKETS = 2000;
const hits = new Map<string, number[]>();

/** Counts one submission for `ip`; false when the quota is spent. */
export function allowLead(ip: string, now = Date.now()): boolean {
  const since = now - LEAD_RATE_WINDOW_MS;
  const list = (hits.get(ip) ?? []).filter((t) => t > since);
  if (list.length >= LEAD_RATE_MAX) { hits.set(ip, list); return false; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > MAX_BUCKETS) {
    for (const [k, v] of hits) if (!v.some((t) => t > since)) hits.delete(k);
    for (const k of hits.keys()) { if (hits.size <= MAX_BUCKETS) break; hits.delete(k); }
  }
  return true;
}
/** Test hook. */
export function resetLeadRateLimit(): void { hits.clear(); }

// ---------------------------------------------------------------------------
// Validation. Errors are keyed by field, in English (the static site shows its own FR/EN texts per key).
// ---------------------------------------------------------------------------
export const LEAD_LIMITS = { restaurant: 120, contact: 80, email: 254, phone: 30, city: 80, address: 200, website: 200, message: 2000, source: 40 } as const;
export const LEAD_MAX_BODY_BYTES = 16_000;

export type LeadParse = { kind: 'ok'; lead: LeadInput } | { kind: 'honeypot' } | { kind: 'invalid'; errors: Record<string, string> };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max + 1) : '');

export function parseLead(body: unknown): LeadParse {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  // Honeypot: real visitors never see the "company" field; anything in it is a bot.
  if (b.company !== undefined && b.company !== null && String(b.company).trim() !== '') return { kind: 'honeypot' };

  const errors: Record<string, string> = {};
  const required = (key: 'restaurant' | 'contact' | 'city', min = 2) => {
    const v = str(b[key], LEAD_LIMITS[key]);
    if (v.length < min) errors[key] = 'required';
    else if (v.length > LEAD_LIMITS[key]) errors[key] = 'too_long';
    return v;
  };
  const optional = (key: 'address' | 'website' | 'message') => {
    const v = str(b[key], LEAD_LIMITS[key]);
    if (v.length > LEAD_LIMITS[key]) errors[key] = 'too_long';
    return v || undefined;
  };

  const restaurant = required('restaurant');
  const contact = required('contact');
  const city = required('city');
  const address = optional('address');
  const message = optional('message');
  let website = optional('website');
  if (website) {
    const w = /^[a-z][a-z0-9+.-]*:\/\//i.test(website) ? website : `https://${website}`;
    try {
      const u = new URL(w);
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) errors.website = 'invalid';
      else website = u.toString().replace(/\/$/, '');
    } catch { errors.website = 'invalid'; }
  }

  const rawEmail = str(b.email, LEAD_LIMITS.email);
  const email = normalizeEmail(rawEmail);
  if (!rawEmail) errors.email = 'required';
  else if (!email || rawEmail.length > LEAD_LIMITS.email) errors.email = 'invalid';

  const rawPhone = str(b.phone, LEAD_LIMITS.phone);
  const phone = normalizePhone(rawPhone);
  if (!rawPhone) errors.phone = 'required';
  else if (!phone || rawPhone.length > LEAD_LIMITS.phone) errors.phone = 'invalid';

  const platforms = Array.isArray(b.platforms) ? [...new Set(b.platforms.filter((p): p is LeadPlatform => typeof p === 'string' && (LEAD_PLATFORMS as readonly string[]).includes(p)))] : [];
  if (!Array.isArray(b.platforms) || (b.platforms.length && !platforms.length)) errors.platforms = 'invalid';

  let brands: number | undefined;
  if (b.brands !== undefined && b.brands !== null && b.brands !== '') {
    const n = Number(b.brands);
    if (!Number.isInteger(n) || n < 1 || n > 50) errors.brands = 'invalid';
    else brands = n;
  }

  const lang: LeadLang = b.lang === 'en' ? 'en' : 'fr';
  if (b.lang !== undefined && b.lang !== 'fr' && b.lang !== 'en') errors.lang = 'invalid';
  const source = str(b.source, LEAD_LIMITS.source) || 'on2go.ca';
  if (source.length > LEAD_LIMITS.source) errors.source = 'too_long';

  if (Object.keys(errors).length) return { kind: 'invalid', errors };
  return { kind: 'ok', lead: { restaurant, contact, email: email!, phone: phone!, city, address, website, platforms, brands, message, lang, source } };
}

// ---------------------------------------------------------------------------
// Storage (fh_docs collection "restaurant_leads"; `at` = received, `key` = status for cheap filters).
// ---------------------------------------------------------------------------
function toDoc(lead: RestaurantLead): Doc<RestaurantLead> {
  return { id: lead.id, at: lead.at, key: lead.status, data: lead };
}

export async function saveLead(input: LeadInput, now = new Date().toISOString()): Promise<RestaurantLead> {
  const lead: RestaurantLead = { ...input, id: crypto.randomUUID(), at: now, status: 'new', notes: '', updatedAt: now };
  await getRepo().putDocs<RestaurantLead>(LEADS, [toDoc(lead)]);
  return lead;
}

export async function listLeads(limit = 500): Promise<RestaurantLead[]> {
  const docs = await getRepo().listDocs<RestaurantLead>(LEADS, { limit });
  return docs.map((d) => d.data).sort((a, b) => b.at.localeCompare(a.at));
}

export async function getLead(id: string): Promise<RestaurantLead | null> {
  return (await getRepo().getDoc<RestaurantLead>(LEADS, id))?.data ?? null;
}

export async function updateLead(id: string, patch: { status?: LeadStatus; notes?: string }, by?: string): Promise<RestaurantLead | null> {
  const cur = await getLead(id);
  if (!cur) return null;
  const next: RestaurantLead = {
    ...cur,
    status: patch.status ?? cur.status,
    notes: patch.notes === undefined ? cur.notes : patch.notes.slice(0, 4000),
    updatedAt: new Date().toISOString(),
    updatedBy: by ?? cur.updatedBy,
  };
  await getRepo().putDocs<RestaurantLead>(LEADS, [toDoc(next)]);
  return next;
}

// ---------------------------------------------------------------------------
// Emails: one to the support inbox, one auto-reply to the lead. Skipped (not failed) without a provider.
// ---------------------------------------------------------------------------
export const PLATFORM_LABELS: Record<LeadPlatform, { fr: string; en: string }> = {
  uber: { fr: 'Uber Eats', en: 'Uber Eats' },
  doordash: { fr: 'DoorDash', en: 'DoorDash' },
  skip: { fr: 'SkipTheDishes', en: 'SkipTheDishes' },
  tgtg: { fr: 'Too Good To Go', en: 'Too Good To Go' },
  direct: { fr: 'Commande en ligne directe', en: 'Direct online ordering' },
  phone: { fr: 'Commandes par téléphone', en: 'Phone orders' },
};

export function supportEmail(): string | null {
  return normalizeEmail(process.env.FOODHUB_SUPPORT_EMAIL) ?? null;
}

export function leadNotificationText(lead: RestaurantLead): { subject: string; text: string } {
  const platforms = lead.platforms.length ? lead.platforms.map((p) => PLATFORM_LABELS[p].fr).join(', ') : '—';
  const lines = [
    `Nouvelle demande de restaurant (${lead.source}) — ${lead.restaurant}`,
    '',
    `Restaurant : ${lead.restaurant}`,
    `Contact : ${lead.contact}`,
    `Courriel : ${lead.email}`,
    `Téléphone : ${lead.phone}`,
    `Ville : ${lead.city}`,
    lead.address ? `Adresse : ${lead.address}` : null,
    lead.website ? `Site web : ${lead.website}` : null,
    `Plateformes : ${platforms}`,
    lead.brands ? `Marques : ${lead.brands}` : null,
    `Langue : ${lead.lang === 'fr' ? 'français' : 'English'}`,
    lead.message ? `\nMessage :\n${lead.message}` : null,
    '',
    `Reçue le ${lead.at} — à suivre dans Food Hub → Réglages → Demandes de restaurants.`,
  ].filter((l): l is string => l !== null);
  return { subject: `[ON2GO] Demande de restaurant — ${lead.restaurant} (${lead.city})`, text: lines.join('\n') };
}

export function leadAutoReplyText(lead: RestaurantLead): { subject: string; text: string } {
  if (lead.lang === 'en') {
    return {
      subject: `ON2GO — we received your request for ${lead.restaurant}`,
      text: [
        `Hello ${lead.contact},`,
        '',
        `Thank you for your interest in ON2GO. We received your request to list ${lead.restaurant} (${lead.city}).`,
        'A member of our team will get back to you within two business days to go over the next steps.',
        '',
        'If anything changes in the meantime, simply reply to this email.',
        '',
        'ON2GO — Montréal',
      ].join('\n'),
    };
  }
  return {
    subject: `ON2GO — nous avons bien reçu votre demande pour ${lead.restaurant}`,
    text: [
      `Bonjour ${lead.contact},`,
      '',
      `Merci de votre intérêt pour ON2GO. Nous avons bien reçu votre demande pour inscrire ${lead.restaurant} (${lead.city}).`,
      'Un membre de notre équipe vous recontactera d’ici deux jours ouvrables pour voir les prochaines étapes avec vous.',
      '',
      'Si quelque chose change d’ici là, répondez simplement à ce courriel.',
      '',
      'ON2GO — Montréal',
    ].join('\n'),
  };
}

export interface LeadMailResult { support: { ok: boolean; skipped?: boolean; message: string } | null; reply: { ok: boolean; skipped?: boolean; message: string } }

/** Sends both emails; never throws, never slows the public answer when email is not configured. */
export async function notifyLead(lead: RestaurantLead): Promise<LeadMailResult> {
  const to = supportEmail();
  const notification = leadNotificationText(lead);
  const reply = leadAutoReplyText(lead);
  const send = async (toAddress: string, m: { subject: string; text: string }, purpose: string): Promise<{ ok: boolean; skipped?: boolean; message: string }> => {
    try {
      const r = await sendEmail({ to: toAddress, ...m }, { purpose, by: 'on2go.ca' });
      return { ok: r.ok, skipped: r.skipped, message: r.message };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  };
  const support = to ? await send(to, notification, 'restaurant-lead') : null;
  const auto = await send(lead.email, reply, 'restaurant-lead-reply');
  return { support, reply: auto };
}
