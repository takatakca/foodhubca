// WhatsApp inbound (Twilio): one public number for every brand.
//   - Signed: X-Twilio-Signature with FOODHUB_WHATSAPP_AUTH_TOKEN (the token of the account that owns the number), else TWILIO_AUTH_TOKEN.
//   - Abuse: only North-American senders, a rate limit per sender, a replayed MessageSid is answered once.
//   - Opt-out: STOP / ARRÊT blocks the sender (START / REPRENDRE lifts it); a blocked sender gets no reply.
//   - Brand routing: the first message gets a numbered menu of the brands (FOODHUB_BRAND_PHONES); the choice is
//     remembered per customer under a hash of the number (no phone number, no name stored).
// Replies are TwiML <Message>: they answer the customer's own message, inside the 24 h window, so no template is needed.
import crypto from 'node:crypto';
import { getRepo } from '../repo';
import { normalizePhone, maskPhone } from '../notify';
import { brandLines } from './brand-lines';
import { readForm, twiml, verifyTwilio, attr } from './twilio';

export const WHATSAPP_PATH = '/api/foodhub/webhooks/whatsapp';
export const WA_COL = 'wa_customers';
export const WA_RATE = { max: 8, windowMs: 60_000 };
export const WA_HOURLY = { max: 60, windowMs: 3600_000 };
const SEEN_KEEP_MS = 24 * 3600_000;

type Mem = { hits: Map<string, number[]>; seen: Map<string, number> };
const mem = (): Mem => {
  const g = globalThis as unknown as { __fhWaMem?: Mem };
  g.__fhWaMem ??= { hits: new Map(), seen: new Map() };
  return g.__fhWaMem;
};
export function resetWhatsAppState(): void { mem().hits.clear(); mem().seen.clear(); }

type Customer = { brand?: string; optedOut?: boolean };
const idFor = (phone: string) => crypto.createHash('sha256').update(`whatsapp|${phone}`).digest('hex').slice(0, 32);

/** Distinct brand names, in the order of FOODHUB_BRAND_PHONES. */
export function waBrands(): string[] {
  return [...new Set(brandLines().map((l) => l.brand))].slice(0, 20);
}

/** The sender of a WhatsApp message: "whatsapp:+15145550123" → E.164, only United States / Canada (+1) numbers. */
export function waSender(from: string | null): string | null {
  const m = /^whatsapp:(\+1\d{10})$/.exec((from ?? '').trim());
  return m ? normalizePhone(m[1]) : null;
}

function within(list: number[] | undefined, now: number, windowMs: number) { return (list ?? []).filter((t) => t > now - windowMs); }

/** Takes one slot of the per-sender limits (per minute and per hour). False when the sender is over a limit. */
export function allowSender(phone: string, now = Date.now()): boolean {
  const m = mem();
  const list = within(m.hits.get(phone), now, WA_HOURLY.windowMs);
  const minute = within(list, now, WA_RATE.windowMs);
  if (minute.length >= WA_RATE.max || list.length >= WA_HOURLY.max) { m.hits.set(phone, list); return false; }
  m.hits.set(phone, [...list, now]);
  if (m.hits.size > 5000) m.hits.delete(m.hits.keys().next().value as string);
  return true;
}

/** True the first time a MessageSid is seen (Twilio retries a webhook it thinks failed). */
export function firstSeen(sid: string, now = Date.now()): boolean {
  const m = mem();
  if (m.seen.has(sid)) return false;
  m.seen.set(sid, now);
  if (m.seen.size > 5000) for (const [k, t] of m.seen) if (t < now - SEEN_KEEP_MS || m.seen.size > 4000) m.seen.delete(k);
  return true;
}

const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|arr[êe]t|arreter|arrêter)\s*[.!]?\s*$/i;
const START = /^\s*(start|unstop|reprendre|oui|yes)\s*[.!]?\s*$/i;
const CHANGE = /^\s*(menu|marque|brand|changer|change|0)\s*$/i;

function menuText(brands: string[]): string {
  return `Bonjour ! Pour quelle marque voulez-vous nous écrire ?\nHello! Which brand are you writing to?\n${brands.map((b, i) => `${i + 1}. ${b}`).join('\n')}\n\nRépondez par le numéro / Reply with the number.`;
}

function pickBrand(body: string, brands: string[]): string | null {
  const t = body.trim();
  const n = /^\d{1,2}$/.test(t) ? Number(t) : 0;
  if (n >= 1 && n <= brands.length) return brands[n - 1];
  const lower = t.toLowerCase();
  return lower.length >= 3 ? brands.find((b) => b.toLowerCase() === lower) ?? null : null;
}

const message = (text: string) => twiml(`<Message>${attr(text.slice(0, 1500))}</Message>`);
const silent = () => twiml('');

/** One inbound WhatsApp message → the TwiML answer. Never throws on bad input. */
export async function handleWhatsApp(params: URLSearchParams): Promise<Response> {
  const phone = waSender(params.get('From'));
  if (!phone) return silent(); // anonymous, malformed or outside the United States / Canada: no reply, no cost
  const sid = params.get('MessageSid') || params.get('SmsMessageSid') || '';
  if (sid && !firstSeen(sid)) return silent();
  if (!allowSender(phone)) return silent();
  const body = (params.get('Body') ?? '').replace(/\p{Cc}/gu, ' ').slice(0, 1000);
  const repo = getRepo();
  const id = idFor(phone);
  const cur = (await repo.getDoc<Customer>(WA_COL, id).catch(() => null))?.data ?? {};
  const save = (c: Customer) => repo.putDocs<Customer>(WA_COL, [{ id, at: new Date().toISOString(), data: c }]).catch((e) => console.error('[foodhub] whatsapp save failed', maskPhone(phone), e instanceof Error ? e.message : e));

  if (STOP.test(body)) {
    await save({ ...cur, optedOut: true });
    return message('Vous ne recevrez plus de messages. Répondez START pour reprendre.\nYou will no longer receive messages. Reply START to resume.');
  }
  if (cur.optedOut) {
    if (!START.test(body)) return silent();
    cur.optedOut = false;
    await save(cur);
  }
  const brands = waBrands();
  if (!brands.length) return message('Merci de votre message. Une personne vous répondra bientôt.\nThanks for your message. A team member will reply soon.');
  if (CHANGE.test(body) || !cur.brand || !brands.includes(cur.brand)) {
    const choice = CHANGE.test(body) ? null : pickBrand(body, brands);
    if (!choice) { await save({ ...cur, brand: undefined }); return message(menuText(brands)); }
    await save({ ...cur, brand: choice });
    return message(`${choice} : merci ! Écrivez votre commande ou votre question, nous vous répondons ici. (« menu » pour changer de marque)\nThanks! Write your order or question here. (“menu” to change brand)`);
  }
  return message(`${cur.brand} : message reçu, une personne vous répond bientôt. (« menu » pour changer de marque)\nMessage received, a team member will reply soon.`);
}

/** Route wrapper: signature first (403 otherwise), then the handler; any failure answers an empty TwiML. */
export async function whatsappRoute(req: Request): Promise<Response> {
  let params: URLSearchParams;
  try {
    params = await readForm(req);
    const token = process.env.FOODHUB_WHATSAPP_AUTH_TOKEN?.trim() || process.env.TWILIO_AUTH_TOKEN?.trim();
    if (!verifyTwilio(req.headers, req.url, params, token)) return new Response('Twilio signature check failed', { status: 403 });
  } catch {
    return new Response('Twilio signature check failed', { status: 403 });
  }
  try {
    return await handleWhatsApp(params);
  } catch (e) {
    console.error('[foodhub] whatsapp webhook failed', e instanceof Error ? e.message : e);
    return silent();
  }
}
