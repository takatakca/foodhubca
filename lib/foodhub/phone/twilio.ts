// Twilio Voice for the phone agent: request signatures and the TwiML answers.
//   - Signature (X-Twilio-Signature): HMAC-SHA1 with TWILIO_AUTH_TOKEN over the full public URL followed by every POST
//     parameter name+value, sorted by name, base64. For voice over HTTPS Twilio signs the URL without the port.
//     Behind a proxy the URL Twilio called is FOODHUB_PUBLIC_URL + path + query (or the x-forwarded host), so every
//     form is tried. Extra candidates never weaken the check: the HMAC still needs the token.
//   - Speech: <Gather input="speech dtmf"> in fr-CA, en-US or es-US (voices.ts: models, hints, voices). A speech model
//     needs a whole-number speechTimeout. The greeting offers "faites le 2 / say English / marque 3".
//   - Twilio waits at most 15 s for each answer: a slow AI turn says "one moment" and continues on a <Redirect>.
import crypto from 'node:crypto';
import { publicBaseUrl, safeEqual } from '../config';
import type { PhoneLang } from './calls';
import type { PhoneSettings } from './settings';
import { ORDER_NOTICE, selfIntro, speakable, type Persona } from './style';
import { DEFAULT_VOICES, FALLBACK_VOICES, sayLanguage, speechPlan, type ListenKind } from './voices';

export const VOICE_PATH = '/api/foodhub/webhooks/voice';

function signatureFor(url: string, params: URLSearchParams, token: string): string {
  const keys = [...new Set([...params.keys()])].sort();
  const data = url + keys.map((k) => params.getAll(k).map((v) => k + v).join('')).join('');
  return crypto.createHmac('sha1', token).update(data, 'utf8').digest('base64');
}

/** "https://host:443/x" ↔ "https://host/x": both forms, built as strings (the URL API drops default ports). */
function portForms(url: string): string[] {
  const out = [url];
  const m = url.match(/^(https?):\/\/([^/:?#]+)(:\d+)?(.*)$/i);
  if (!m) return out;
  const [, scheme, host, port, rest] = m;
  if (port) out.push(`${scheme}://${host}${rest}`);
  else if (scheme.toLowerCase() === 'https') out.push(`${scheme}://${host}:443${rest}`);
  return out;
}

/** Candidate URLs Twilio may have signed: as received, as seen from the public address, the forwarded host, with and without a port. Never throws. */
export function candidateUrls(reqUrl: string, headers?: Headers): string[] {
  const out = new Set<string>();
  let path = '';
  try { const u = new URL(reqUrl); path = `${u.pathname}${u.search}`; out.add(reqUrl); } catch { /* a request URL that does not parse: only the public forms below */ }
  if (!path) { const m = reqUrl.match(/^[a-z]+:\/\/[^/]+(\/.*)$/i); path = m ? m[1] : reqUrl.startsWith('/') ? reqUrl : ''; }
  const base = publicBaseUrl();
  if (/^https?:\/\/[^\s/]+$/i.test(base)) out.add(`${base}${path}`);
  const host = headers?.get('x-forwarded-host')?.split(',')[0]?.trim();
  const proto = headers?.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host) && /^https?$/i.test(proto)) out.add(`${proto}://${host}${path}`);
  for (const u of [...out]) for (const f of portForms(u)) out.add(f);
  return [...out];
}

export function verifyTwilio(headers: Headers, reqUrl: string, params: URLSearchParams): boolean {
  try {
    const token = process.env.TWILIO_AUTH_TOKEN?.trim();
    const got = headers.get('x-twilio-signature');
    if (!token || !got) return false;
    return candidateUrls(reqUrl, headers).some((url) => safeEqual(signatureFor(url, params, token), got));
  } catch {
    return false;
  }
}

/** For tests and the local simulator: the signature Twilio would send. */
export function twilioSignature(url: string, params: URLSearchParams, token: string): string {
  return signatureFor(url, params, token);
}

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
export const attr = (s: string) => xml(s);

export type Voices = Pick<PhoneSettings, 'voiceFr' | 'voiceEn'> & Partial<Pick<PhoneSettings, 'voiceEs'>>;
type Listening = Voices & Pick<PhoneSettings, 'speechModel' | 'speechTimeout'> & Partial<Pick<PhoneSettings, 'speechModelShort'>>;

/** Voice and speech-recognition language of a call (Spanish: es-US; an es-MX voice speaks es-MX). */
export function voiceAttrs(s: Voices, lang: PhoneLang) {
  const voice = (lang === 'es' ? s.voiceEs : lang === 'fr' ? s.voiceFr : s.voiceEn) || DEFAULT_VOICES[lang];
  return { voice, language: sayLanguage(lang, voice) };
}

export function sayXml(text: string, s: Voices, lang: PhoneLang): string {
  if (!text) return '';
  const v = voiceAttrs(s, lang);
  return `<Say voice="${attr(v.voice)}" language="${v.language}">${xml(speakable(text))}</Say>`;
}

/** Say something, then listen for the caller's next sentence (speech, or a key press). */
export function gatherXml(text: string, s: Listening, lang: PhoneLang, action: string, hints?: string, kind: ListenKind = 'conversation'): string {
  return gatherInner(sayXml(text, s, lang), s, lang, action, hints, kind);
}

/** A <Gather> around already-built TwiML (several voices in one greeting). */
export function gatherInner(inner: string, s: Listening, lang: PhoneLang, action: string, hints?: string, kind: ListenKind = 'conversation'): string {
  const plan = speechPlan(lang, kind, s, hints);
  return `<Gather input="speech dtmf" numDigits="1" action="${attr(action)}" method="POST" language="${plan.language}" speechModel="${attr(plan.model)}" speechTimeout="${plan.timeout}" timeout="7" actionOnEmptyResult="true"${plan.hints ? ` hints="${attr(plan.hints)}"` : ''}>${inner}</Gather>`;
}

export function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
}

/**
 * The same TwiML with `before` (e.g. a <Say>) said first: a reply built elsewhere (an AI turn, a menu step) is
 * prefaced without each path knowing about it.
 */
export async function prefixTwiml(res: Response, before: string): Promise<Response> {
  const body = await res.text();
  // A function replacement: a "$" in the spoken text (prices) is never read as a replacement pattern.
  const out = before ? body.replace('<Response>', () => `<Response>${before}`) : body;
  return new Response(out, { status: res.status, headers: res.headers });
}

export function dialXml(number: string, callerId: string, action: string, timeout = 25): string {
  return `<Dial callerId="${attr(callerId)}" timeout="${timeout}" action="${attr(action)}" method="POST">${xml(number)}</Dial>`;
}

/** Form body of a Twilio request as URLSearchParams (Twilio posts application/x-www-form-urlencoded). */
export async function readForm(req: Request): Promise<URLSearchParams> {
  const text = await req.text();
  return new URLSearchParams(text);
}

/**
 * Direct ordering line greeting, one short sentence per part (the French voice never reads English): the restaurant,
 * the automated assistant, the call transcribed to take the order, 0 for a person, then the question.
 */
export const orderDisclosure = (p: Persona | undefined, lang: PhoneLang) => `${selfIntro(p ?? { name: '', gender: 'female' }, lang)}. ${ORDER_NOTICE[lang]}`;
export const GREETING = {
  fr: (name: string, p?: Persona) => `Bonjour, merci d’avoir appelé ${name}. ${orderDisclosure(p, 'fr')} Qu’est-ce que je peux vous préparer ?`,
  en: (name: string, p?: Persona) => `Hello, thank you for calling ${name}. ${orderDisclosure(p, 'en')} What can I get for you?`,
  es: (name: string, p?: Persona) => `Hola, gracias por llamar a ${name}. ${orderDisclosure(p, 'es')} ¿Qué le preparamos?`,
};
/** Language options read after the French greeting, each in its own voice. */
export const LANG_OFFER = { en: 'For English, press 2.', es: 'Para español, marque el 3.' };
export const WAIT = { fr: 'Un petit instant, je vérifie.', en: 'One moment, let me check.', es: 'Un momento, lo verifico.' };
export const NO_AGENT = {
  fr: 'Bonjour. Je vous transfère à un membre de notre équipe. Restez en ligne.',
  en: 'Hello. I’m transferring you to a team member. Please stay on the line.',
  es: 'Hola. Le transfiero a un miembro de nuestro equipo. No cuelgue, por favor.',
};
export const NOBODY = {
  fr: 'Désolé, personne n’est disponible présentement. Nous vous rappellerons dans les plus brefs délais. Merci et bonne journée.',
  en: 'Sorry, nobody is available right now. We will call you back as soon as possible. Thank you.',
  es: 'Lo sentimos, no hay nadie disponible en este momento. Le devolveremos la llamada lo antes posible. Gracias.',
};

/** The answer when something broke: French then English, stable voices (whatever the settings). */
export function errorTwiml(): Response {
  return twiml(`<Say voice="${FALLBACK_VOICES.fr}" language="fr-CA">Désolé, nous éprouvons un problème technique. Veuillez rappeler dans quelques minutes.</Say><Say voice="${FALLBACK_VOICES.en}" language="en-US">Sorry, we are having a technical problem. Please call back in a few minutes.</Say><Hangup/>`);
}

/** Route wrapper: reads Twilio's form, refuses anything not signed with TWILIO_AUTH_TOKEN, never answers with an error page. */
export async function twilioRoute(req: Request, handler: (params: URLSearchParams) => Promise<Response>): Promise<Response> {
  let params: URLSearchParams;
  try {
    params = await readForm(req);
    if (!verifyTwilio(req.headers, req.url, params)) return new Response('Twilio signature check failed', { status: 403 });
  } catch {
    return new Response('Twilio signature check failed', { status: 403 });
  }
  try {
    return await handler(params);
  } catch (e) {
    console.error('[foodhub] voice webhook failed', e instanceof Error ? e.message : e);
    return errorTwiml();
  }
}
