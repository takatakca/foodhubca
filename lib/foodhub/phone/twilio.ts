// Twilio Voice for the phone agent: request signatures and the TwiML answers.
//   - Signature (X-Twilio-Signature): HMAC-SHA1 with TWILIO_AUTH_TOKEN over the full public URL followed by every POST
//     parameter name+value, sorted by name, base64. For voice over HTTPS Twilio signs the URL without the port.
//     Behind a proxy the URL Twilio called is FOODHUB_PUBLIC_URL + path + query, so both forms are tried.
//   - Speech: <Gather input="speech dtmf"> in fr-CA or en-US (Twilio has no en-CA speech model). A speech model needs a
//     whole-number speechTimeout. Twilio cannot detect the language itself: the greeting offers "press 2 / say English".
//   - Twilio waits at most 15 s for each answer: a slow AI turn says "one moment" and continues on a <Redirect>.
import crypto from 'node:crypto';
import { publicBaseUrl, safeEqual } from '../config';
import type { PhoneLang } from './calls';
import type { PhoneSettings } from './settings';

export const VOICE_PATH = '/api/foodhub/webhooks/voice';

function signatureFor(url: string, params: URLSearchParams, token: string): string {
  const keys = [...new Set([...params.keys()])].sort();
  const data = url + keys.map((k) => params.getAll(k).map((v) => k + v).join('')).join('');
  return crypto.createHmac('sha1', token).update(data, 'utf8').digest('base64');
}

/** Candidate URLs Twilio may have signed: as received, as seen from the public address, with and without a port. */
function candidateUrls(reqUrl: string): string[] {
  const u = new URL(reqUrl);
  const path = `${u.pathname}${u.search}`;
  const out = new Set<string>([reqUrl, `${publicBaseUrl()}${path}`]);
  for (const s of [...out]) { const x = new URL(s); x.port = ''; out.add(x.toString()); }
  return [...out];
}

export function verifyTwilio(headers: Headers, reqUrl: string, params: URLSearchParams): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const got = headers.get('x-twilio-signature');
  if (!token || !got) return false;
  return candidateUrls(reqUrl).some((url) => safeEqual(signatureFor(url, params, token), got));
}

/** For tests and the local simulator: the signature Twilio would send. */
export function twilioSignature(url: string, params: URLSearchParams, token: string): string {
  return signatureFor(url, params, token);
}

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
export const attr = (s: string) => xml(s);

type Voices = Pick<PhoneSettings, 'voiceFr' | 'voiceEn'> & Partial<Pick<PhoneSettings, 'voiceEs'>>;

/** Voice and speech-recognition language of a call (Spanish: es-US). */
export function voiceAttrs(s: Voices, lang: PhoneLang) {
  if (lang === 'es') return { voice: s.voiceEs || 'Polly.Lupe-Neural', language: 'es-US' };
  return lang === 'fr' ? { voice: s.voiceFr, language: 'fr-CA' } : { voice: s.voiceEn, language: 'en-US' };
}

export function sayXml(text: string, s: Voices, lang: PhoneLang): string {
  const v = voiceAttrs(s, lang);
  return `<Say voice="${attr(v.voice)}" language="${v.language}">${xml(text)}</Say>`;
}

/** Say something, then listen for the caller's next sentence (speech, or a key press). */
export function gatherXml(text: string, s: Voices & Pick<PhoneSettings, 'speechModel' | 'speechTimeout'>, lang: PhoneLang, action: string, hints?: string): string {
  const v = voiceAttrs(s, lang);
  return `<Gather input="speech dtmf" numDigits="1" action="${attr(action)}" method="POST" language="${v.language}" speechModel="${attr(s.speechModel)}" speechTimeout="${s.speechTimeout}" timeout="7" actionOnEmptyResult="true"${hints ? ` hints="${attr(hints.slice(0, 2000))}"` : ''}>${sayXml(text, s, lang)}</Gather>`;
}

export function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
}

export function dialXml(number: string, callerId: string, action: string, timeout = 25): string {
  return `<Dial callerId="${attr(callerId)}" timeout="${timeout}" action="${attr(action)}" method="POST">${xml(number)}</Dial>`;
}

/** Form body of a Twilio request as URLSearchParams (Twilio posts application/x-www-form-urlencoded). */
export async function readForm(req: Request): Promise<URLSearchParams> {
  const text = await req.text();
  return new URLSearchParams(text);
}

export const GREETING = {
  fr: (name: string) => `Bonjour, merci d’avoir appelé ${name}. Je suis l’assistant virtuel et je prends votre commande. For English, press 2 or say English. Que puis-je vous préparer ?`,
  en: (name: string) => `Hello, thank you for calling ${name}. I'm the virtual assistant and I'll take your order. What can I get for you?`,
  es: (name: string) => `Hola, gracias por llamar a ${name}. Soy el asistente virtual y tomo su pedido. ¿Qué le preparamos?`,
};
export const WAIT = { fr: 'Un instant, je vérifie.', en: 'One moment, let me check.', es: 'Un momento, lo verifico.' };
export const NO_AGENT = {
  fr: 'Bonjour. Je vous transfère à un membre de l’équipe.',
  en: 'Hello. I am transferring you to a team member.',
  es: 'Hola. Le transfiero a un miembro del equipo.',
};
export const NOBODY = {
  fr: 'Désolé, personne n’est disponible pour le moment. Nous vous rappelons dès que possible. Au revoir.',
  en: 'Sorry, nobody is available right now. We will call you back as soon as possible. Goodbye.',
  es: 'Lo sentimos, no hay nadie disponible en este momento. Le devolveremos la llamada lo antes posible. Adiós.',
};

/** Route wrapper: reads Twilio's form, refuses anything not signed with TWILIO_AUTH_TOKEN, never answers with an error page. */
export async function twilioRoute(req: Request, handler: (params: URLSearchParams) => Promise<Response>): Promise<Response> {
  const params = await readForm(req);
  if (!verifyTwilio(req.headers, req.url, params)) return new Response('Twilio signature check failed', { status: 403 });
  try {
    return await handler(params);
  } catch (e) {
    console.error('[foodhub] voice webhook failed', e instanceof Error ? e.message : e);
    return twiml('<Say voice="Polly.Gabrielle-Neural" language="fr-CA">Désolé, un problème technique. Veuillez rappeler dans un instant.</Say><Hangup/>');
  }
}
