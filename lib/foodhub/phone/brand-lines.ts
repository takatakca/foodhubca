// Brand phone lines: one Twilio number per restaurant brand, every number rings ONE main number.
//   incoming   → <Dial> the main number; the person who answers first hears "Appel pour <marque>" (whisper), then is connected
//   dial-done  → connected: hang up; not answered: bilingual greeting + voicemail (<Record>)
//   voicemail  → the recording is emailed (existing notify email: Resend or SMTP) with a signed listen link
//   sms        → a text sent to a brand number (e.g. a Google verification code) is emailed to the owner
//   recording  → the listen link: streams the recording from Twilio so nobody needs a Twilio login
// No phone numbers in git: the map comes from FOODHUB_BRAND_PHONES (JSON), the destination from FOODHUB_MAIN_PHONE.
// This is separate from the AI order-taking agent (voice.ts, lines in Settings → Expansion → Phone): a number is pointed
// at one or the other in Twilio. Later, FOODHUB_MAIN_PHONE can be the AI receptionist's number.
import crypto from 'node:crypto';
import { publicBaseUrl, safeEqual } from '../config';
import { normalizeEmail, normalizePhone, maskPhone, postToChat, sendEmail } from '../notify';
import { DEFAULT_PHONE } from './settings';
import { attr, sayXml, twiml } from './twilio';

export const BRAND_VOICE_PATH = '/api/foodhub/voice';

export interface BrandLine {
  /** The Twilio number customers (and Google) call, E.164. */
  number: string;
  /** Brand shown in emails and spoken to the staff who answer. */
  brand: string;
  /** Optional: the kitchen when a brand has one number per kitchen ("Jean-Talon"). */
  kitchen?: string;
  /** Optional: how the voice must pronounce the brand when the spelling reads badly ("Oh œuf"). */
  say?: string;
}

/** Locked by the owner: no Po Poulet NDG line, ever. Po Poulet is only accepted for another kitchen, named. */
const PO_POULET = /\bpo[\s-]*poulet\b/i;
const PO_POULET_OTHER_KITCHEN = /jean|talon|l[eé]onard|hochelaga/i;

const text = (v: unknown, max: number): string => String(v ?? '').replace(/[<>\p{Cc}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** FOODHUB_BRAND_PHONES: `{"+15145550101":"OOeuf","+15145550102":{"brand":"Pi Pita","kitchen":"NDG","say":"Pi Pita"}}` or a list of {number, brand, ...}. */
export function parseBrandPhones(raw: string | undefined): { lines: BrandLine[]; problems: string[] } {
  const problems: string[] = [];
  if (!raw || !raw.trim()) return { lines: [], problems };
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return { lines: [], problems: ['FOODHUB_BRAND_PHONES is not valid JSON.'] }; }
  const entries: Array<Record<string, unknown>> = Array.isArray(data)
    ? (data as Array<Record<string, unknown>>)
    : data && typeof data === 'object'
      ? Object.entries(data as Record<string, unknown>).map(([number, v]) => (typeof v === 'string' ? { number, brand: v } : { ...(v as object), number }))
      : [];
  const lines: BrandLine[] = [];
  for (const e of entries) {
    const number = normalizePhone(typeof e?.number === 'string' ? e.number : null);
    const brand = text(e?.brand, 80);
    const kitchen = text(e?.kitchen, 40);
    const say = text(e?.say, 80);
    if (!number || !brand) { problems.push(`Ignored a line without a valid number and brand (${maskPhone(String(e?.number ?? '?'))}).`); continue; }
    if (PO_POULET.test(brand) && !PO_POULET_OTHER_KITCHEN.test(kitchen)) { problems.push(`Ignored ${maskPhone(number)}: no phone line for Po Poulet NDG.`); continue; }
    if (lines.some((l) => l.number === number)) { problems.push(`Ignored ${maskPhone(number)}: listed twice.`); continue; }
    lines.push({ number, brand, ...(kitchen ? { kitchen } : {}), ...(say ? { say } : {}) });
  }
  return { lines, problems };
}

export function brandLines(): BrandLine[] {
  return parseBrandPhones(process.env.FOODHUB_BRAND_PHONES).lines;
}

export function brandLineFor(to: string | null | undefined): BrandLine | null {
  const n = normalizePhone(to);
  return n ? brandLines().find((l) => l.number === n) ?? null : null;
}

/** Where every brand line rings (the owner's main number; later the AI receptionist). */
export function mainPhone(): string | null {
  return normalizePhone(process.env.FOODHUB_MAIN_PHONE);
}

/** Who receives voicemails and forwarded texts: FOODHUB_VOICEMAIL_EMAIL (comma-separated, up to 3), else the owner email. */
export function voicemailRecipients(): string[] {
  const raw = process.env.FOODHUB_VOICEMAIL_EMAIL || process.env.FOODHUB_OWNER_EMAIL || '';
  return [...new Set(raw.split(/[,;\s]+/).map((e) => normalizeEmail(e)).filter((e): e is string => Boolean(e)))].slice(0, 3);
}

/** Seconds the main number rings before the voicemail takes over (stay under the mobile carrier's own voicemail, ~25 s). */
export function ringSeconds(): number {
  const n = Math.round(Number(process.env.FOODHUB_VOICE_RING_SECONDS));
  return Number.isFinite(n) && n >= 8 && n <= 40 ? n : 20;
}

const spoken = (l: BrandLine | null): string => (l ? l.say || l.brand : 'notre restaurant');
const url = (step: string, to: string | null): string => `${publicBaseUrl()}${BRAND_VOICE_PATH}/${step}${to ? `?n=${encodeURIComponent(to)}` : ''}`;
const calledNumber = (params: URLSearchParams, query: URLSearchParams): string | null => normalizePhone(query.get('n')) ?? normalizePhone(params.get('To'));

/** Voicemail greeting (French, then English) and the recording; the email goes out from the <Record> action. */
function voicemailXml(line: BrandLine | null, to: string | null): string {
  const who = spoken(line);
  return `${sayXml(`Bonjour, vous avez joint ${who}. Personne ne peut vous répondre pour le moment. Laissez votre message après le bip, puis raccrochez.`, DEFAULT_PHONE, 'fr')}`
    + `${sayXml(`Hello, you have reached ${who}. Nobody can answer right now. Please leave a message after the beep, then hang up.`, DEFAULT_PHONE, 'en')}`
    + `<Record maxLength="120" timeout="6" playBeep="true" trim="trim-silence" method="POST" action="${attr(url('voicemail', to))}"/>`;
}

/** Twilio "A call comes in" on a brand number. Never hangs up on a caller: no main number or unknown number still reaches a person or a voicemail. */
export async function incomingCall(params: URLSearchParams): Promise<Response> {
  const to = normalizePhone(params.get('To'));
  const line = brandLineFor(to);
  const main = mainPhone();
  if (!main) return twiml(voicemailXml(line, to));
  const from = params.get('From') || '';
  // The staff phone shows the real caller (to call back); a hidden caller shows the brand number instead.
  const callerId = /^\+1\d{10}$/.test(from) ? from : to;
  return twiml(`<Dial timeout="${ringSeconds()}" answerOnBridge="true"${callerId ? ` callerId="${attr(callerId)}"` : ''} method="POST" action="${attr(url('dial-done', to))}">`
    + `<Number url="${attr(url('whisper', to))}" method="POST">${attr(main)}</Number></Dial>`);
}

/** What the person who answers hears before being connected: "Appel pour <marque>". */
export async function whisperCall(params: URLSearchParams, query: URLSearchParams): Promise<Response> {
  const to = calledNumber(params, query);
  const line = brandLineFor(to);
  const msg = line
    ? `Appel pour ${spoken(line)}${line.kitchen ? `, cuisine ${line.kitchen}` : ''}.`
    : `Appel sur une ligne non configurée${to ? `, se terminant par ${to.slice(-4).split('').join(' ')}` : ''}.`;
  return twiml(sayXml(msg, DEFAULT_PHONE, 'fr'));
}

/** <Dial> action: someone talked to the caller → done; nobody answered (or declined) → voicemail. */
export async function dialDone(params: URLSearchParams, query: URLSearchParams): Promise<Response> {
  const status = params.get('DialCallStatus') || '';
  if (status === 'completed' && params.get('DialBridged') !== 'false') return twiml('<Hangup/>');
  const to = calledNumber(params, query);
  return twiml(voicemailXml(brandLineFor(to), to));
}

// ---- Voicemail → email, with a listen link that needs no Twilio login -------------------------------------------------

const RECORDING_SID = /^RE[0-9a-f]{32}$/i;
const LINK_DAYS = 30;

function recordingToken(sid: string, exp: number, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`recording:${sid}:${exp}`).digest('base64url');
}

/** Listen link for one recording, valid 30 days, signed with TWILIO_AUTH_TOKEN. Null when the recording id is not a Twilio one. */
export function recordingLink(sid: string, now = Date.now()): string | null {
  const secret = process.env.TWILIO_AUTH_TOKEN;
  if (!secret || !RECORDING_SID.test(sid)) return null;
  const exp = Math.floor(now / 1000) + LINK_DAYS * 86_400;
  return `${publicBaseUrl()}${BRAND_VOICE_PATH}/recording?sid=${sid}&exp=${exp}&t=${recordingToken(sid, exp, secret)}`;
}

function stamp(): string {
  return new Date().toLocaleString('fr-CA', { timeZone: process.env.FOODHUB_TIMEZONE || 'America/Toronto', dateStyle: 'long', timeStyle: 'short' });
}
const callerLabel = (from: string): string => {
  const n = normalizePhone(from);
  if (!n) return 'numéro masqué';
  return /^\+1\d{10}$/.test(n) ? `${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5, 8)}-${n.slice(8)}` : n;
};
const lineLabel = (l: BrandLine | null, to: string | null): string => (l ? `${l.brand}${l.kitchen ? ` (${l.kitchen})` : ''}` : `ligne non configurée${to ? ` ${maskPhone(to)}` : ''}`);

/** Email text to every recipient; falls back to the team chat when email is not set up. Nothing here throws. */
async function mailToOwner(subject: string, body: string, purpose: string, secret: boolean, chatTitle: string): Promise<void> {
  const to = voicemailRecipients();
  let sent = false;
  for (const r of to) sent = (await sendEmail({ to: r, subject, text: body }, { purpose, secret })).ok || sent;
  if (!sent) {
    console.error(`[foodhub] ${purpose}: not emailed (${to.length ? 'email sending failed' : 'set FOODHUB_VOICEMAIL_EMAIL or FOODHUB_OWNER_EMAIL'}); the recording stays in the Twilio console`);
    await postToChat({ title: chatTitle, text: 'Le courriel n’a pas pu partir : ouvrez Twilio (Monitor → Logs → Calls / Recordings) pour l’écouter.', severity: 'warning' }, { purpose });
  }
}

/** <Record> action: the caller left a message (or hung up). Email it, then thank the caller. */
export async function voicemailDone(params: URLSearchParams, query: URLSearchParams): Promise<Response> {
  const goodbye = twiml(`${sayXml('Merci, votre message a été enregistré. Au revoir.', DEFAULT_PHONE, 'fr')}${sayXml('Thank you, your message was recorded. Goodbye.', DEFAULT_PHONE, 'en')}<Hangup/>`);
  const seconds = Math.round(Number(params.get('RecordingDuration')) || 0);
  const sid = params.get('RecordingSid') || '';
  if (!sid || seconds < 1) return goodbye; // hung up before speaking
  const to = calledNumber(params, query);
  const line = brandLineFor(to);
  const link = recordingLink(sid);
  const from = callerLabel(params.get('From') || '');
  const body = [
    `Message vocal pour ${lineLabel(line, to)}.`,
    `De : ${from}`,
    `Reçu : ${stamp()} (${seconds} s)`,
    '',
    link ? `Écouter (lien valide ${LINK_DAYS} jours) : ${link}` : `Écouter : Twilio → Monitor → Logs → Recordings (${sid}).`,
    '',
    'Rappelez le numéro ci-dessus si le client attend une réponse.',
  ].join('\n');
  await mailToOwner(`Message vocal : ${lineLabel(line, to)} (${from}, ${seconds} s)`, body, 'brand_voicemail', false, `📞 Message vocal : ${lineLabel(line, to)}`);
  return goodbye;
}

/** Twilio "A message comes in" on a brand number (Google's verification code by text arrives here). Emailed, never stored in Food Hub. */
export async function smsReceived(params: URLSearchParams, query: URLSearchParams): Promise<Response> {
  const to = calledNumber(params, query);
  const line = brandLineFor(to);
  const from = callerLabel(params.get('From') || '');
  const body = `Texto reçu sur ${lineLabel(line, to)}.\nDe : ${from}\nReçu : ${stamp()}\n\n${String(params.get('Body') || '').slice(0, 1500)}`;
  await mailToOwner(`Texto reçu : ${lineLabel(line, to)} (${from})`, body, 'brand_sms', true, `💬 Texto reçu : ${lineLabel(line, to)}`);
  return twiml('');
}

/** GET listen link: checks the signature and expiry, then streams the recording from Twilio (the Twilio login stays on the server). */
export async function recordingResponse(query: URLSearchParams, now = Date.now()): Promise<Response> {
  const secret = process.env.TWILIO_AUTH_TOKEN;
  const account = process.env.TWILIO_ACCOUNT_SID;
  const sid = query.get('sid') || '';
  const exp = Number(query.get('exp'));
  if (!secret || !account || !RECORDING_SID.test(sid) || !Number.isFinite(exp)) return new Response('Lien invalide.', { status: 404 });
  if (!safeEqual(recordingToken(sid, exp, secret), query.get('t'))) return new Response('Lien invalide.', { status: 404 });
  if (exp * 1000 < now) return new Response('Lien expiré : écoutez le message dans Twilio (Monitor → Logs → Recordings).', { status: 410 });
  const base = (process.env.TWILIO_BASE_URL || 'https://api.twilio.com').replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/2010-04-01/Accounts/${encodeURIComponent(account)}/Recordings/${sid}.mp3`, {
      headers: { Authorization: `Basic ${Buffer.from(`${account}:${secret}`).toString('base64')}` },
    });
    if (!res.ok) return new Response('Enregistrement pas encore prêt ou supprimé. Réessayez dans une minute.', { status: res.status === 404 ? 404 : 502 });
    return new Response(await res.arrayBuffer(), { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="message-${sid}.mp3"` } });
  } catch {
    return new Response('Twilio ne répond pas. Réessayez dans une minute.', { status: 502 });
  }
}
