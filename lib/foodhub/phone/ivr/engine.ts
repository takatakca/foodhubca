// ON2GO phone menu (IVR) — the call, as Twilio drives it:
//
//   incoming → greeting (recorded MP3 or neural voice) + marketing line + "Comment puis-je vous aider ?"
//            + "For English say English or press 2 · Para español diga español o marque 3"
//   → the AI talks with the caller and routes with a tool (agent.ts); keypad digits work at any time, 0 = a person,
//     * = repeat; two misunderstandings (or no AI key, or mode "keypad") → the short keypad menu of the tree
//   → branches: AI flows (online order problem, card charge, billing, merchant, courier, customer service: lookup,
//     link by text, ticket) · place an order (the AI ordering agent, ../voice.ts, same call) · platform order
//     (which platform → order number by voice or keypad → confirm → reference record SAVED → <Dial> that platform's
//     official support line, or text its official help link when it has no phone line) · a person (<Dial>, nobody →
//     voicemail) · voicemail (<Record> + live transcription → ticket + email to the team).
//
// Every route is a Twilio webhook under /api/foodhub/webhooks/ivr/* and checks the Twilio signature (twilioRoute).
// Card numbers: refused by voice and keypad, never stored (words.ts). Each platform hears only about itself: the
// transfer passes the caller's own number, nothing else, and the texted link is that platform's own page.
import { publicBaseUrl } from '../../config';
import { featureOn } from '../../expansion/features';
import { normalizePhone, sendEmail, sendSms } from '../../notify';
import { localTimeLabel } from '../../time';
import { phoneAgentConfigured } from '../agent';
import { getCall, saveCall, say as sayPhone, type PhoneCall } from '../calls';
import { getPhoneSettings, isMultiKitchen, lineForNumber } from '../settings';
import { gatherXml, VOICE_PATH } from '../twilio';
import { callStatus, startCall } from '../voice';
import { ivrAiAvailable, runIvrTurn, textLink } from './agent';
import {
  findNode, getIvrSettings, handoffTarget, levelOf, nodeFor, PLATFORM_IDS, PLATFORM_NAME, platformHelpUrl, platformPhone, voicemailEmailTarget,
  type IvrLang, type IvrNode, type IvrSettings, type PlatformId, type Texts,
} from './config';
import {
  endIvrCall, getIvrCall, listIvrCalls, newIvrCall, note, openTicket, saveIvrCall, savePlatformRef, updatePlatformRef, updateTicket, visit, withOrderId,
  type IvrCall, type IvrReply, type TicketCategory,
} from './records';
import {
  digitNode, hasCardNumber, keywordIntent, LANG_DIGIT, LANG_OPTIONS, languageWord, levelHints, menuSpeech, NO_CARD, normalizeOrderId, redactCards, spellOut, detectPlatform,
} from './words';

export const IVR_PATH = '/api/foodhub/webhooks/ivr';
const TURN_BUDGET_MS = 9_000;
const LANG_CODE: Record<IvrLang, string> = { fr: 'fr-CA', en: 'en-US', es: 'es-US' };

// ---------------------------------------------------------------------------------------------------------------
// Words said by the menu (the AI writes its own sentences)

const T = (fr: string, en: string, es: string): Texts => ({ fr, en, es });
export const SAY = {
  stillHere: T('Je suis là. Dites-moi en quelques mots comment je peux vous aider, ou utilisez le clavier.', 'I’m here. Tell me in a few words how I can help, or use your keypad.', 'Aquí estoy. Dígame en pocas palabras cómo puedo ayudarle, o use el teclado.'),
  notUnderstood: T('Je n’ai pas bien compris. Voici nos options.', 'I didn’t quite get that. Here are our options.', 'No le entendí bien. Estas son nuestras opciones.'),
  badKey: T('Ce choix n’existe pas.', 'That is not an option.', 'Esa opción no existe.'),
  goodbye: T('Merci d’avoir appelé ON2GO. Au revoir !', 'Thank you for calling ON2GO. Goodbye!', 'Gracias por llamar a ON2GO. ¡Adiós!'),
  wait: T('Un instant, je vérifie.', 'One moment, let me check.', 'Un momento, lo verifico.'),
  anythingElse: T('Puis-je vous aider avec autre chose ?', 'Can I help you with anything else?', '¿Puedo ayudarle con algo más?'),
  askPlatform: T('Sur quelle application avez-vous commandé : Uber Eats, DoorDash ou SkipTheDishes ? Vous pouvez aussi faire le 1, le 2 ou le 3.', 'Which app did you order on: Uber Eats, DoorDash or SkipTheDishes? You can also press 1, 2 or 3.', '¿En qué aplicación hizo su pedido: Uber Eats, DoorDash o SkipTheDishes? También puede marcar 1, 2 o 3.'),
  askOrderId: T('Dites ou tapez le numéro de commande %P, puis le carré. Si vous ne l’avez pas, faites seulement le carré.', 'Say or type your %P order number, then press pound. If you don’t have it, just press pound.', 'Diga o marque su número de pedido de %P, y luego numeral. Si no lo tiene, marque solo numeral.'),
  againOrderId: T('Je n’ai pas saisi le numéro. Dites-le lentement, ou tapez-le, puis le carré.', 'I didn’t catch the number. Say it slowly, or type it, then press pound.', 'No entendí el número. Dígalo despacio, o márquelo, y luego numeral.'),
  confirmId: T('J’ai noté : %I. Si c’est exact, dites oui ou faites le 1. Pour recommencer, faites le 2.', 'I have: %I. If that’s right, say yes or press 1. To start again, press 2.', 'Anoté: %I. Si es correcto, diga sí o marque 1. Para empezar de nuevo, marque 2.'),
  transferPlatform: T('Merci, c’est noté. Je vous transfère au service à la clientèle de %P. Gardez votre numéro de commande à portée de main.', 'Thanks, it’s noted. I’m transferring you to %P customer support. Keep your order number handy.', 'Gracias, quedó anotado. Le transfiero al servicio al cliente de %P. Tenga a mano su número de pedido.'),
  platformBusy: T('Le service de %P ne répond pas pour le moment.', '%P support is not answering right now.', 'El servicio de %P no contesta en este momento.'),
  linkSent: T('Je vous ai envoyé le lien officiel par texto.', 'I’ve texted you the official link.', 'Le envié el enlace oficial por mensaje de texto.'),
  noLink: T('Le lien n’a pas pu être envoyé par texto.', 'The link could not be texted.', 'No se pudo enviar el enlace por mensaje.'),
  transferPerson: T('Je vous transfère à un membre de l’équipe. Un instant.', 'I’m transferring you to a team member. One moment.', 'Le transfiero a un miembro del equipo. Un momento.'),
  nobody: T('Personne n’est disponible pour le moment.', 'Nobody is available right now.', 'No hay nadie disponible en este momento.'),
  voicemail: T('Laissez votre nom, votre numéro et votre message après le bip. Appuyez sur le carré quand vous avez terminé.', 'Leave your name, your number and your message after the beep. Press pound when you are done.', 'Deje su nombre, su número y su mensaje después del tono. Marque numeral cuando termine.'),
  noMessage: T('Nous n’avons pas reçu de message. Au revoir.', 'We did not get a message. Goodbye.', 'No recibimos ningún mensaje. Adiós.'),
  messageSaved: T('Merci, votre message est enregistré. Notre équipe vous rappelle dès que possible. Au revoir !', 'Thank you, your message is saved. Our team will call you back as soon as possible. Goodbye!', 'Gracias, su mensaje quedó grabado. Nuestro equipo le devolverá la llamada lo antes posible. ¡Adiós!'),
  orderIntro: T('Parfait, je prends votre commande. Je suis l’assistant virtuel. Que puis-je vous préparer ?', 'Great, I’ll take your order. I’m the virtual assistant. What can I get for you?', 'Perfecto, tomo su pedido. Soy el asistente virtual. ¿Qué le preparamos?'),
  closed: T('Le service ON2GO n’est pas disponible pour le moment.', 'The ON2GO line is not available right now.', 'La línea ON2GO no está disponible en este momento.'),
  langSet: T('Très bien, en français.', 'Okay, in English.', 'Muy bien, en español.'),
} as const;

/** How to reach a platform's support in its app, when it has no public phone line (only that platform is named). */
const APP_HELP: Record<PlatformId, Texts> = {
  ubereats: T('Uber Eats n’offre pas de ligne téléphonique pour les clients. Dans l’application Uber Eats, ouvrez Commandes, choisissez la commande, puis touchez Aide.', 'Uber Eats has no customer phone line. In the Uber Eats app, open Orders, choose the order, then tap Help.', 'Uber Eats no tiene línea telefónica para clientes. En la aplicación de Uber Eats, abra Pedidos, elija el pedido y toque Ayuda.'),
  doordash: T('Dans l’application DoorDash, ouvrez Commandes, choisissez la commande, puis touchez Aide.', 'In the DoorDash app, open Orders, choose the order, then tap Help.', 'En la aplicación de DoorDash, abra Pedidos, elija el pedido y toque Ayuda.'),
  skip: T('SkipTheDishes offre son aide par clavardage. Dans l’application SkipTheDishes, touchez Besoin d’aide pour écrire à leur équipe.', 'SkipTheDishes offers help by chat. In the SkipTheDishes app, tap Need Help to chat with their team.', 'SkipTheDishes ofrece ayuda por chat. En la aplicación de SkipTheDishes, toque Need Help para escribir a su equipo.'),
};

const PLATFORM_SMS: Texts = { fr: '%P — aide officielle pour votre commande%I : %U', en: '%P — official help for your order%I: %U', es: '%P — ayuda oficial para su pedido%I: %U' };

const fill = (s: string, v: Record<string, string>) => s.replace(/%([A-Z])/g, (_, k) => v[k] ?? '');

// ---------------------------------------------------------------------------------------------------------------
// TwiML

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));

function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
}

export function sayX(text: string, s: Pick<IvrSettings, 'voices'>, lang: IvrLang): string {
  return text ? `<Say voice="${xml(s.voices[lang])}" language="${LANG_CODE[lang]}">${xml(text)}</Say>` : '';
}

const playX = (url: string) => `<Play>${xml(url)}</Play>`;

interface Listen { hints?: string; many?: boolean; timeout?: number }

/** Say/play `inner`, then listen for words or keys; the answer comes back to /ivr/turn. */
async function gatherX(inner: string, s: IvrSettings, lang: IvrLang, opts: Listen = {}): Promise<string> {
  const ps = await getPhoneSettings();
  const keys = opts.many ? 'finishOnKey="#"' : 'numDigits="1" finishOnKey=""';
  const hints = opts.hints ? ` hints="${xml(opts.hints.slice(0, 1500))}"` : '';
  return `<Gather input="speech dtmf" ${keys} action="${IVR_PATH}/turn" method="POST" language="${LANG_CODE[lang]}" speechModel="${xml(ps.speechModel)}" speechTimeout="${ps.speechTimeout}" timeout="${opts.timeout ?? s.timeout}" actionOnEmptyResult="true"${hints}>${inner}</Gather>`;
}

const abs = (path: string) => `${publicBaseUrl()}${path}`;

// ---------------------------------------------------------------------------------------------------------------
// Steps

async function listenAi(call: IvrCall, s: IvrSettings, text: string): Promise<Response> {
  const saved = await saveIvrCall(note({ ...call, state: 'ai' }, 'agent', text));
  return twiml(await gatherX(sayX(text, s, saved.lang), s, saved.lang, { hints: levelHints(s.tree) }));
}

/** The keypad menu of one level (main menu = ''). */
async function keypadMenu(call: IvrCall, s: IvrSettings, menuId: string, preface = ''): Promise<Response> {
  const text = [preface, menuSpeech(s.tree, menuId, call.lang)].filter(Boolean).join(' ');
  const saved = await saveIvrCall(note({ ...call, state: 'menu', menu: menuId }, 'agent', text));
  return twiml(await gatherX(sayX(text, s, saved.lang), s, saved.lang, { hints: levelHints(s.tree, menuId || null) }));
}

/** After the language is known: the AI asks how it can help (AI mode), or the keypad main menu. */
async function afterLanguage(call: IvrCall, s: IvrSettings, preface = ''): Promise<Response> {
  if (ivrAiAvailable(s)) return listenAi(call, s, [preface, s.askHelp[call.lang]].filter(Boolean).join(' '));
  return keypadMenu(call, s, '', preface);
}

/**
 * The greeting, in French first: the owner's welcome + the marketing line (or the recorded MP3), then "how can I help"
 * (AI mode) or "1 for French" (keypad mode), then the English and Spanish options in their own voices.
 */
async function greet(call: IvrCall, s: IvrSettings): Promise<Response> {
  const ai = ivrAiAvailable(s);
  const welcome = `${s.greeting.fr} ${s.marketing.fr}`;
  const ask = ai ? s.askHelp.fr : 'Pour le français, faites le 1.';
  const saved = await saveIvrCall(note({ ...call, state: 'greeting' }, 'agent', `${welcome} ${ask} ${LANG_OPTIONS}`));
  const audio = s.audio.greeting.fr;
  const intro = audio ? `${playX(audio)}${sayX(ask, s, 'fr')}` : sayX(`${welcome} ${ask}`, s, 'fr');
  const options = `${sayX('For English, say English or press 2.', s, 'en')}${sayX('Para español, diga español o marque 3.', s, 'es')}`;
  return twiml(await gatherX(`${intro}${options}`, s, saved.lang, { hints: levelHints(s.tree) }));
}

/** Twilio "A call comes in" on the ON2GO line. */
export async function ivrStart(params: URLSearchParams): Promise<Response> {
  const s = await getIvrSettings();
  const sid = params.get('CallSid') || `call-${Date.now()}`;
  const call = newIvrCall(sid, params.get('From') || 'anonymous', params.get('To') || '');
  if (!s.enabled) {
    // Menu off: never lose the call — the AI ordering line of this number, else a person, else voicemail.
    if (await lineForNumber(call.to)) return startCall(params);
    return dialPerson(await saveIvrCall(note(call, 'system', 'Phone menu turned off')), s, SAY.closed.fr);
  }
  return greet(call, s);
}

/** Twilio <Gather> action: words or keys, whatever the step. */
export async function ivrTurn(params: URLSearchParams): Promise<Response> {
  const s = await getIvrSettings();
  let call = await getIvrCall(params.get('CallSid') || '');
  if (!call) return ivrStart(params);
  const rawDigits = (params.get('Digits') || '').trim();
  const rawSpeech = (params.get('SpeechResult') || '').trim();
  // Card numbers: refused, never stored, never shown to the AI.
  if (hasCardNumber(rawSpeech) || hasCardNumber(rawDigits)) {
    call = note({ ...call, tries: call.tries + 1 }, 'system', 'The caller started giving a card number: refused, not kept');
    // Twice on the order-number step: carry on without a number rather than loop.
    if ((call.state === 'order_id' || call.state === 'confirm_id') && call.tries >= 2) return finishPlatform(call, s, '', NO_CARD[call.lang]);
    return repeatStep(call, s, NO_CARD[call.lang]);
  }
  const digits = rawDigits;
  const speech = redactCards(rawSpeech);
  if (speech) call = note(call, 'caller', speech);
  else if (digits) call = note(call, 'caller', `(keypad ${digits})`);
  switch (call.state) {
    case 'greeting': return onGreeting(call, s, digits, speech);
    case 'ai': return onAi(call, s, digits, speech);
    case 'menu': return onMenu(call, s, digits, speech);
    case 'platform': return onPlatform(call, s, digits, speech);
    case 'order_id': return onOrderId(call, s, digits, speech);
    case 'confirm_id': return onConfirm(call, s, digits, speech);
    default: return afterLanguage(call, s);
  }
}

/** Ask the current step again (after a refused card number). */
async function repeatStep(call: IvrCall, s: IvrSettings, preface: string): Promise<Response> {
  switch (call.state) {
    case 'order_id': case 'confirm_id':
      return askOrderId(await saveIvrCall(call), s, preface);
    case 'platform':
      return askPlatform(call, s, preface);
    case 'menu':
      return keypadMenu(call, s, call.menu, preface);
    default:
      return listenAi(call, s, `${preface} ${s.askHelp[call.lang]}`);
  }
}

async function onGreeting(call: IvrCall, s: IvrSettings, digits: string, speech: string): Promise<Response> {
  if (digits && LANG_DIGIT[digits]) return afterLanguage(visit({ ...call, lang: LANG_DIGIT[digits] }, `lang_${LANG_DIGIT[digits]}`, 'keypad'), s, digits === '1' ? '' : SAY.langSet[LANG_DIGIT[digits]]);
  if (digits === '*') return greet(call, s);
  if (digits) return runDigit({ ...call, state: 'menu', menu: '' }, s, digits);
  const lang = speech ? languageWord(speech) : null;
  if (lang) return afterLanguage(visit({ ...call, lang }, `lang_${lang}`, 'speech'), s, SAY.langSet[lang]);
  if (!speech) return silence(call, s);
  return understand({ ...call, state: 'ai' }, s, speech);
}

async function onAi(call: IvrCall, s: IvrSettings, digits: string, speech: string): Promise<Response> {
  if (digits === '*') return listenAi(call, s, s.askHelp[call.lang]);
  if (digits) return runDigit(call, s, digits);
  if (!speech) return silence(call, s);
  const lang = languageWord(speech);
  if (lang && lang !== call.lang) return listenAi(visit({ ...call, lang }, `lang_${lang}`, 'speech'), s, `${SAY.langSet[lang]} ${s.askHelp[lang]}`);
  return understand(call, s, speech);
}

async function onMenu(call: IvrCall, s: IvrSettings, digits: string, speech: string): Promise<Response> {
  if (digits === '*') return keypadMenu(call, s, call.menu);
  if (digits) return runDigit(call, s, digits);
  if (!speech) return silence(call, s);
  const lang = languageWord(speech);
  if (lang) return keypadMenu(visit({ ...call, lang }, `lang_${lang}`, 'speech'), s, call.menu, SAY.langSet[lang]);
  // On a platform submenu a platform name is enough.
  const platform = detectPlatform(speech);
  const level = levelOf(s.tree, call.menu || null);
  const byPlatform = platform ? level.find((n) => n.action.kind === 'platform' && n.action.platform === platform) : null;
  if (byPlatform) return runNode(call, s, byPlatform, 'speech', { platform: platform! });
  const kw = keywordIntent(speech, s.tree);
  if (kw) return runNode(call, s, kw.node, 'speech', { platform: kw.platform });
  const tries = call.tries + 1;
  if (tries >= 3) return dialPerson({ ...call, tries }, s);
  return keypadMenu({ ...call, tries }, s, call.menu, SAY.notUnderstood[call.lang]);
}

/** Silence: ask again, then the keypad menu, then goodbye. */
async function silence(call: IvrCall, s: IvrSettings): Promise<Response> {
  const n = call.silences + 1;
  const c = note({ ...call, silences: n }, 'caller', '(silence)');
  if (n >= 3) return goodbye(c, s, 'hangup');
  if (call.state === 'menu' || !ivrAiAvailable(s)) return keypadMenu(c, s, call.state === 'menu' ? call.menu : '');
  if (n === 1) return listenAi({ ...c, state: 'ai' }, s, SAY.stillHere[call.lang]);
  return keypadMenu(c, s, '');
}

/** Says goodbye and ends the call. `own` = the AI already said its goodbye: say only that. */
async function goodbye(call: IvrCall, s: IvrSettings, outcome: IvrCall['outcome'], preface = '', own = false): Promise<Response> {
  const text = own && preface ? preface : [preface, SAY.goodbye[call.lang]].filter(Boolean).join(' ');
  await saveIvrCall(note({ ...call, state: 'done', outcome: call.outcome ?? outcome }, 'agent', text));
  await endIvrCall(call.id, call.outcome ?? outcome);
  return twiml(`${sayX(text, s, call.lang)}<Hangup/>`);
}

async function runDigit(call: IvrCall, s: IvrSettings, digits: string): Promise<Response> {
  const d = digits.slice(0, 1);
  const level = call.state === 'menu' ? call.menu : '';
  const node = digitNode(s.tree, level || null, d) ?? (level ? null : digitNode(s.tree, null, d));
  if (!node) return keypadMenu({ ...call, tries: call.tries + 1 }, s, level, SAY.badKey[call.lang]);
  return runNode(call, s, node, 'keypad');
}

// ---------------------------------------------------------------------------------------------------------------
// AI

const inflight = (): Map<string, Promise<IvrReply>> => {
  const g = globalThis as unknown as { __fhIvrTurns?: Map<string, Promise<IvrReply>> };
  g.__fhIvrTurns ??= new Map();
  return g.__fhIvrTurns;
};

async function computeTurn(callId: string, text: string, s: IvrSettings): Promise<IvrReply> {
  const call = await getIvrCall(callId);
  if (!call) return { say: '', next: 'hangup' };
  const r = await runIvrTurn(call, text, s);
  await saveIvrCall({ ...r.call, pending: { startedAt: new Date().toISOString(), reply: r.reply } });
  return r.reply;
}

/** Words the AI must understand: AI turn within Twilio's time, or the keyword router when the AI is off. */
async function understand(call: IvrCall, s: IvrSettings, text: string): Promise<Response> {
  if (!ivrAiAvailable(s)) {
    const kw = keywordIntent(text, s.tree);
    if (kw) return runNode(call, s, kw.node, 'speech', { platform: kw.platform });
    return keypadMenu(call, s, '', SAY.notUnderstood[call.lang]);
  }
  const saved = await saveIvrCall({ ...call, state: 'ai' });
  const job = computeTurn(saved.id, text, s).finally(() => { if (inflight().get(saved.id) === job) inflight().delete(saved.id); });
  inflight().set(saved.id, job);
  const reply = await Promise.race([job, new Promise<null>((r) => setTimeout(() => r(null), TURN_BUDGET_MS))]);
  if (!reply) return twiml(`${sayX(SAY.wait[saved.lang], s, saved.lang)}<Redirect method="POST">${IVR_PATH}/wait?n=1</Redirect>`);
  return consume(saved.id, s, reply, text);
}

/** Uses a finished AI reply (cleared from the record so a retry cannot replay it). */
async function consume(callId: string, s: IvrSettings, reply: IvrReply, text = ''): Promise<Response> {
  const call = await getIvrCall(callId);
  if (!call) return twiml('<Hangup/>');
  const c = { ...call, pending: undefined };
  switch (reply.next) {
    case 'listen': {
      const saved = await saveIvrCall({ ...c, state: 'ai', silences: 0 });
      return twiml(await gatherX(sayX(reply.say, s, saved.lang), s, saved.lang, { hints: levelHints(s.tree) }));
    }
    case 'hangup': return goodbye(c, s, c.outcome ?? 'resolved', reply.say, true);
    case 'menu': {
      // The AI failed or did not understand twice: the keyword router on the last words, then the keypad menu.
      const kw = text ? keywordIntent(text, s.tree) : null;
      if (kw) return runNode(c, s, kw.node, 'speech', { platform: kw.platform, noAi: true });
      return keypadMenu({ ...c, misses: 0 }, s, '', SAY.notUnderstood[c.lang]);
    }
    case 'route': {
      const node = findNode(s.tree, reply.route?.node);
      if (!node) return keypadMenu(c, s, '');
      return runNode(c, s, node, 'ai', { platform: reply.route?.platform, orderId: reply.route?.orderId, preface: reply.say });
    }
  }
}

/** Twilio <Redirect> after "one moment": the AI turn is still running here, or another instance saved it. */
export async function ivrWait(params: URLSearchParams, n: number): Promise<Response> {
  const s = await getIvrSettings();
  const call = await getIvrCall(params.get('CallSid') || '');
  if (!call) return twiml('<Hangup/>');
  const job = inflight().get(call.id);
  const reply = job ? await Promise.race([job, new Promise<null>((r) => setTimeout(() => r(null), TURN_BUDGET_MS))]) : (await getIvrCall(call.id))?.pending?.reply ?? null;
  if (reply) return consume(call.id, s, reply);
  if (n < 3 && job) return twiml(`<Pause length="1"/><Redirect method="POST">${IVR_PATH}/wait?n=${n + 1}</Redirect>`);
  return keypadMenu(call, s, '', SAY.notUnderstood[call.lang]);
}

// ---------------------------------------------------------------------------------------------------------------
// Branches

/** noAi: the AI just failed or gave up on this call — do not hand the caller straight back to it. */
interface NodeExtra { platform?: PlatformId; orderId?: string; preface?: string; noAi?: boolean }

export async function runNode(call0: IvrCall, s: IvrSettings, node: IvrNode, via: IvrCall['path'][number]['via'], extra: NodeExtra = {}): Promise<Response> {
  let call = visit({ ...call0, misses: 0, silences: 0, tries: 0 }, node.id, via);
  const preface = [extra.preface, node.prompt?.[call.lang]].filter(Boolean).join(' ');
  switch (node.action.kind) {
    case 'menu': {
      const kids = levelOf(s.tree, node.id);
      const byPlatform = extra.platform ? kids.find((k) => k.action.kind === 'platform' && k.action.platform === extra.platform) : null;
      if (byPlatform) return runNode(call, s, byPlatform, via, extra);
      return keypadMenu(call, s, node.id, extra.preface ?? '');
    }
    case 'ai': {
      if (ivrAiAvailable(s) && !extra.noAi) {
        // Keypad (or keyword) choice of a flow the AI handles: the AI takes it from there.
        return understand({ ...call, state: 'ai' }, s, `(The caller chose "${node.label.en}" (${node.id}) ${via === 'keypad' ? 'on the keypad' : 'by voice'}. Route to ${node.id} and follow that flow.)`);
      }
      // No AI: text the flow's link, then take a message (the voicemail becomes the ticket).
      let said = preface;
      if (node.action.link) {
        const r = await textLink(call, s, node.action.link);
        call = r.call;
        if (r.ok) said = [said, SAY.linkSent[call.lang]].filter(Boolean).join(' ');
      }
      return startVoicemail(call, s, node.id, said);
    }
    case 'order': return handToOrdering(call, s, extra.preface ?? '');
    case 'platform': {
      const platform = node.action.platform ?? extra.platform;
      call = { ...call, platform };
      if (!platform) return askPlatform(call, s, preface);
      if (extra.orderId) return confirmOrderId({ ...call, pendingOrderId: extra.orderId }, s, extra.preface ?? '');
      return askOrderId(call, s, extra.preface ?? '');
    }
    case 'handoff': return dialPerson(call, s, extra.preface ?? '');
    case 'voicemail': return startVoicemail(call, s, node.id, extra.preface ?? '');
  }
}

// ---- platform orders

async function askPlatform(call: IvrCall, s: IvrSettings, preface = ''): Promise<Response> {
  const text = [preface, SAY.askPlatform[call.lang]].filter(Boolean).join(' ');
  const saved = await saveIvrCall(note({ ...call, state: 'platform' }, 'agent', text));
  return twiml(await gatherX(sayX(text, s, saved.lang), s, saved.lang, { hints: 'Uber Eats, Uber, DoorDash, Door Dash, SkipTheDishes, Skip' }));
}

async function onPlatform(call: IvrCall, s: IvrSettings, digits: string, speech: string): Promise<Response> {
  if (digits === '0') return dialPerson(call, s);
  const platform = digits ? PLATFORM_IDS[Number(digits) - 1] : detectPlatform(speech);
  if (!platform) {
    const tries = call.tries + 1;
    if (tries >= 3) return dialPerson({ ...call, tries }, s);
    return askPlatform({ ...call, tries }, s, speech || digits ? SAY.badKey[call.lang] : '');
  }
  const node = nodeFor(s.tree, (a) => a.kind === 'platform' && a.platform === platform);
  return askOrderId(visit({ ...call, platform, tries: 0 }, node?.id ?? `platform_${platform}`, digits ? 'keypad' : 'speech'), s);
}

async function askOrderId(call: IvrCall, s: IvrSettings, preface = ''): Promise<Response> {
  const text = [preface, fill(SAY.askOrderId[call.lang], { P: call.platform ? PLATFORM_NAME[call.platform] : '' })].filter(Boolean).join(' ');
  const saved = await saveIvrCall(note({ ...call, state: 'order_id', pendingOrderId: undefined }, 'agent', text));
  return twiml(await gatherX(sayX(text, s, saved.lang), s, saved.lang, { many: true, timeout: Math.max(8, s.timeout), hints: 'numéro, number, número' }));
}

async function onOrderId(call: IvrCall, s: IvrSettings, digits: string, speech: string): Promise<Response> {
  if (digits === '0') return dialPerson(call, s);
  const typed = digits.replace(/[^0-9]/g, '');
  // Nothing at all (pound alone, or silence): the caller has no number — carry on, the reference is still saved.
  if (!typed && !speech) return finishPlatform(call, s, '');
  const id = normalizeOrderId(typed || speech);
  if (!id) {
    // Words that are not a number: ask once more, then carry on without one.
    if (call.tries >= 1) return finishPlatform(call, s, '');
    return askOrderId({ ...call, tries: call.tries + 1 }, s, SAY.againOrderId[call.lang]);
  }
  return confirmOrderId({ ...call, pendingOrderId: id }, s);
}

async function confirmOrderId(call: IvrCall, s: IvrSettings, preface = ''): Promise<Response> {
  const text = [preface, fill(SAY.confirmId[call.lang], { I: spellOut(call.pendingOrderId ?? '') })].filter(Boolean).join(' ');
  const saved = await saveIvrCall(note({ ...call, state: 'confirm_id' }, 'agent', text));
  return twiml(await gatherX(sayX(text, s, saved.lang), s, saved.lang, { hints: 'oui, non, yes, no, sí, no' }));
}

const YES = /^(oui|ouais|yes|yeah|yep|si|exact|exactement|correct|c'est ca|cest ca|c'est bon|ok|okay|d'accord|claro|correcto|eso es)\b/;
const NO = /\b(non|no|nope|recommencer|again|otra vez|de nuevo|incorrect|pas ca)\b/;

async function onConfirm(call: IvrCall, s: IvrSettings, digits: string, speech: string): Promise<Response> {
  const f = speech.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'").trim();
  if (digits === '1' || (f && YES.test(f))) return finishPlatform(call, s, call.pendingOrderId ?? '');
  if (digits === '0') return dialPerson(call, s);
  if (digits === '2' || (f && NO.test(f))) {
    if (call.tries >= 2) return finishPlatform(call, s, call.pendingOrderId ?? '');
    return askOrderId({ ...call, tries: call.tries + 1 }, s);
  }
  // A new number said instead of yes / no: confirm that one.
  const again = speech ? normalizeOrderId(speech) : null;
  if (again && /\d/.test(again)) return confirmOrderId({ ...call, pendingOrderId: again }, s);
  if (call.silences >= 1 || call.tries >= 2) return finishPlatform(call, s, call.pendingOrderId ?? '');
  return confirmOrderId({ ...call, silences: call.silences + 1 }, s);
}

/**
 * The platform order: the reference record is SAVED FIRST (caller number, platform, order number, time, call link),
 * then the caller is connected to the platform's official support line — or, when the platform has no public phone
 * line, gets its official help link by text and the in-app steps.
 */
export async function finishPlatform(call0: IvrCall, s: IvrSettings, orderId: string, preface = ''): Promise<Response> {
  const platform = call0.platform ?? 'doordash';
  const name = PLATFORM_NAME[platform];
  const phone = platformPhone(s, platform, call0.lang);
  let call = withOrderId({ ...call0, pendingOrderId: undefined }, orderId);
  let refId: string | undefined;
  try {
    const ref = await savePlatformRef({
      callId: call.id, from: call.from, lang: call.lang, platform, orderId, next: phone ? 'transfer' : 'sms_link',
      ...(phone ? { transferredTo: phone } : {}), ...(call.brand ? { brand: call.brand } : {}), ...(call.locationCode ? { locationCode: call.locationCode } : {}),
    });
    refId = ref.id;
    call = note({ ...call, refs: [...call.refs, ref.id] }, 'system', `Platform reference saved: ${name} ${orderId || '(no order number)'}`);
  } catch (e) {
    console.error('[foodhub] ivr platform reference not saved', e instanceof Error ? e.message : e);
    call = note(call, 'system', `Platform reference NOT saved (${e instanceof Error ? e.message.slice(0, 120) : 'error'})`);
  }
  if (phone) {
    const text = [preface, fill(SAY.transferPlatform[call.lang], { P: name })].filter(Boolean).join(' ');
    const saved = await saveIvrCall(note({ ...call, state: 'handoff', outcome: 'platform_transfer' }, 'agent', text));
    // The caller's own number is passed on, so the platform can find the customer's account. Nothing else is said to it.
    const callerId = normalizePhone(call.from) ?? normalizePhone(call.to) ?? call.to;
    const action = `${IVR_PATH}/dial-done?kind=platform${refId ? `&amp;ref=${encodeURIComponent(refId)}` : ''}`;
    return twiml(`${sayX(text, s, saved.lang)}<Dial callerId="${xml(callerId)}" timeout="30" action="${action}" method="POST">${xml(phone)}</Dial>`);
  }
  const sms = await textPlatformHelp(call, s, platform, orderId);
  call = sms.call;
  const text = [preface, APP_HELP[platform][call.lang], sms.ok ? SAY.linkSent[call.lang] : SAY.noLink[call.lang], SAY.anythingElse[call.lang]].filter(Boolean).join(' ');
  return listenAi({ ...call, outcome: 'platform_link' }, s, text);
}

async function textPlatformHelp(call: IvrCall, s: IvrSettings, platform: PlatformId, orderId: string): Promise<{ call: IvrCall; ok: boolean }> {
  if (!normalizePhone(call.from)) return { call, ok: false };
  const body = fill(PLATFORM_SMS[call.lang], { P: PLATFORM_NAME[platform], I: orderId ? ` ${orderId}` : '', U: platformHelpUrl(s, platform, call.lang) });
  const r = await sendSms({ to: call.from, from: call.to, body }, { purpose: `ivr_platform_${platform}` });
  return { call: { ...call, sms: [...call.sms, { at: new Date().toISOString(), kind: `platform_${platform}`, ok: r.ok }] }, ok: r.ok };
}

// ---- the AI ordering agent

async function handToOrdering(call: IvrCall, s: IvrSettings, preface: string): Promise<Response> {
  const ps = await getPhoneSettings();
  const line = ps.lines.find((l) => l.enabled && l.id === s.orderLineId) ?? ps.lines.find((l) => l.enabled && l.number === normalizePhone(call.to)) ?? ps.lines.find((l) => l.enabled);
  if (!line || !(await featureOn('phone')) || !phoneAgentConfigured()) {
    return dialPerson(note(call, 'system', `Ordering agent not available (${!line ? 'no AI phone line on' : !phoneAgentConfigured() ? 'no AI key' : 'AI phone ordering off'}): a person takes the order`), s, preface);
  }
  const now = new Date().toISOString();
  const intro = [preface, SAY.orderIntro[call.lang]].filter(Boolean).join(' ');
  // Same CallSid: from here Twilio talks to the ordering agent (/webhooks/voice/turn); the order shows in Calls (AI).
  const pc: PhoneCall = {
    id: call.id, lineId: line.id, lineName: line.name, locationCode: isMultiKitchen(line) ? '' : line.locationCode, brands: line.brands,
    from: call.from, to: call.to, lang: call.lang, status: 'active', startedAt: now, turns: 0, transcript: [], messages: [], cart: [], customer: {}, updatedAt: now,
  };
  if (!(await getCall(call.id))) await saveCall(sayPhone(pc, 'agent', intro));
  await saveIvrCall(note({ ...call, state: 'order', outcome: 'order_agent' }, 'system', `Handed to the ordering assistant (${line.name})`));
  return twiml(gatherXml(intro, ps, call.lang, `${VOICE_PATH}/turn`, ['English', 'anglais', 'español', ...line.brands].join(', ')));
}

// ---- a person, voicemail

async function dialPerson(call: IvrCall, s: IvrSettings, preface = ''): Promise<Response> {
  const to = handoffTarget(s);
  if (!to) return startVoicemail(call, s, 'person', [preface, SAY.nobody[call.lang]].filter(Boolean).join(' '));
  const text = [preface, SAY.transferPerson[call.lang]].filter(Boolean).join(' ');
  const saved = await saveIvrCall(note({ ...call, state: 'handoff', outcome: 'handoff' }, 'agent', text));
  const callerId = normalizePhone(call.to) ?? call.to;
  return twiml(`${sayX(text, s, saved.lang)}<Dial callerId="${xml(callerId)}" timeout="20" action="${IVR_PATH}/dial-done?kind=person" method="POST">${xml(to)}</Dial>`);
}

/** <Dial> action: the person or the platform answered, or not. */
export async function ivrDialDone(params: URLSearchParams, query: URLSearchParams): Promise<Response> {
  const s = await getIvrSettings();
  const call = await getIvrCall(params.get('CallSid') || '');
  if (!call) return twiml('<Hangup/>');
  const status = params.get('DialCallStatus') || '';
  const answered = status === 'completed' || status === 'answered';
  if (query.get('kind') === 'platform') {
    if (answered) { await endIvrCall(call.id, 'platform_transfer'); return twiml('<Hangup/>'); }
    const platform = call.platform ?? 'doordash';
    const sms = await textPlatformHelp(note(call, 'system', `${PLATFORM_NAME[platform]} support did not answer (${status || 'no answer'})`), s, platform, call.orderIds.at(-1) ?? '');
    const ref = query.get('ref');
    if (ref) await updatePlatformRef(ref, { next: sms.ok ? 'sms_link' : 'none', note: `transfer ${status || 'not answered'}` }).catch(() => null);
    const text = [fill(SAY.platformBusy[call.lang], { P: PLATFORM_NAME[platform] }), APP_HELP[platform][call.lang], sms.ok ? SAY.linkSent[call.lang] : ''].filter(Boolean).join(' ');
    return goodbye({ ...sms.call, outcome: 'platform_link' }, s, 'platform_link', text);
  }
  if (answered) { await endIvrCall(call.id, 'handoff'); return twiml('<Hangup/>'); }
  return startVoicemail({ ...note(call, 'system', `Nobody took the call (${status || 'no answer'})`), outcome: 'handoff_missed' }, s, 'person', SAY.nobody[call.lang]);
}

async function startVoicemail(call: IvrCall, s: IvrSettings, reason: string, preface = ''): Promise<Response> {
  const lang = call.lang;
  const saved = await saveIvrCall(note({ ...call, state: 'voicemail', outcome: call.outcome === 'handoff_missed' ? 'handoff_missed' : 'voicemail', voicemail: { ...(call.voicemail ?? {}), reason } }, 'agent', [preface, SAY.voicemail[lang]].filter(Boolean).join(' ')));
  const transcribe = s.transcribeVoicemail
    ? `<Start><Transcription name="vm-${xml(saved.id)}" languageCode="${LANG_CODE[lang]}" track="inbound_track" transcriptionEngine="google" speechModel="telephony" partialResults="false" statusCallbackUrl="${xml(abs(`${IVR_PATH}/transcript`))}" statusCallbackMethod="POST"/></Start>`
    : '';
  const audio = s.audio.voicemail[lang];
  const prompt = `${sayX(preface, s, lang)}${audio ? playX(audio) : sayX(SAY.voicemail[lang], s, lang)}`;
  const record = `<Record maxLength="180" playBeep="true" timeout="6" finishOnKey="#*" trim="trim-silence" action="${IVR_PATH}/voicemail-done" method="POST" recordingStatusCallback="${xml(abs(`${IVR_PATH}/recording`))}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"/>`;
  return twiml(`${transcribe}${prompt}${record}${sayX(SAY.noMessage[lang], s, lang)}<Hangup/>`);
}

const VOICEMAIL_CATEGORY: Record<string, TicketCategory> = {
  online_problem: 'online_order', card_charge: 'card_charge', billing: 'billing', merchant: 'merchant_lead', courier: 'courier_lead', customer_service: 'customer_service', person: 'callback',
};

function categoryFor(s: IvrSettings, reason: string | undefined): TicketCategory {
  const node = findNode(s.tree, reason);
  if (node?.action.kind === 'ai') return VOICEMAIL_CATEGORY[node.action.flow] ?? 'voicemail';
  return VOICEMAIL_CATEGORY[reason ?? ''] ?? 'voicemail';
}

/** <Record> action: the message is recorded. Stops the live transcription, thanks the caller, opens the ticket. */
export async function ivrVoicemailDone(params: URLSearchParams): Promise<Response> {
  const s = await getIvrSettings();
  const call = await getIvrCall(params.get('CallSid') || '');
  if (!call) return twiml('<Hangup/>');
  const vm = { ...(call.voicemail ?? {}), recordingSid: params.get('RecordingSid') || call.voicemail?.recordingSid, recordingUrl: params.get('RecordingUrl') || call.voicemail?.recordingUrl, durationSec: Number(params.get('RecordingDuration')) || call.voicemail?.durationSec };
  let next: IvrCall = { ...call, voicemail: vm, outcome: call.outcome === 'handoff_missed' ? 'handoff_missed' : 'voicemail' };
  if (!vm.ticketId) {
    const reasonNode = findNode(s.tree, vm.reason);
    const t = await openTicket({
      callId: call.id, from: call.from, lang: call.lang, category: categoryFor(s, vm.reason),
      summary: `Voicemail (${reasonNode ? reasonNode.label.en : vm.reason ?? 'message'}), ${vm.durationSec ?? '?'} s${call.platform ? `, ${PLATFORM_NAME[call.platform]}` : ''}`,
      ...(call.orderIds.length ? { orderRef: call.orderIds.at(-1) } : {}), ...(vm.recordingUrl ? { recordingUrl: vm.recordingUrl } : {}),
    });
    next = { ...next, tickets: [...next.tickets, t.id], voicemail: { ...vm, ticketId: t.id } };
  }
  next = await saveIvrCall(note(next, 'system', `Voicemail recorded (${vm.durationSec ?? '?'} s)`));
  if (!s.transcribeVoicemail) await emailVoicemail(next.id);
  const stop = s.transcribeVoicemail ? `<Stop><Transcription name="vm-${xml(call.id)}"/></Stop>` : '';
  return twiml(`${stop}${sayX(SAY.messageSaved[call.lang], s, call.lang)}<Hangup/>`);
}

/** recordingStatusCallback: the recording file is ready. */
export async function ivrRecording(params: URLSearchParams): Promise<void> {
  const call = await getIvrCall(params.get('CallSid') || '');
  if (!call || params.get('RecordingStatus') !== 'completed') return;
  const url = params.get('RecordingUrl') || '';
  await saveIvrCall({ ...call, voicemail: { ...(call.voicemail ?? {}), recordingSid: params.get('RecordingSid') || call.voicemail?.recordingSid, recordingUrl: url || call.voicemail?.recordingUrl, durationSec: Number(params.get('RecordingDuration')) || call.voicemail?.durationSec } });
}

/** <Transcription> statusCallbackUrl: final sentences of the caller's message, then "stopped". */
export async function ivrTranscript(params: URLSearchParams): Promise<void> {
  const call = await getIvrCall(params.get('CallSid') || '');
  if (!call) return;
  const event = params.get('TranscriptionEvent') || '';
  if (event === 'transcription-content' && params.get('Final') !== 'false') {
    let text = '';
    try { text = String(JSON.parse(params.get('TranscriptionData') || '{}')?.transcript ?? ''); } catch { text = ''; }
    text = redactCards(text).trim();
    if (!text) return;
    const before = call.voicemail?.transcript ?? '';
    await saveIvrCall({ ...call, voicemail: { ...(call.voicemail ?? {}), transcript: `${before}${before ? ' ' : ''}${text}`.slice(0, 4000) } });
    return;
  }
  if (event === 'transcription-stopped' || event === 'transcription-error') {
    await saveIvrCall({ ...call, voicemail: { ...(call.voicemail ?? {}), transcriptDone: true } });
    if (call.voicemail?.recordingUrl || call.voicemail?.ticketId) await emailVoicemail(call.id);
  }
}

/** Emails a voicemail once (recording link in the console + transcript) and copies the transcript into its ticket. */
export async function emailVoicemail(callId: string): Promise<boolean> {
  const call = await getIvrCall(callId);
  const vm = call?.voicemail;
  if (!call || !vm || vm.emailedAt || (!vm.recordingUrl && !vm.ticketId)) return false;
  const s = await getIvrSettings();
  const to = voicemailEmailTarget(s);
  await saveIvrCall({ ...call, voicemail: { ...vm, emailedAt: new Date().toISOString() } });
  if (vm.ticketId) {
    await updateTicket(vm.ticketId, { ...(vm.transcript ? { transcript: vm.transcript } : {}), ...(vm.recordingUrl ? { recordingUrl: vm.recordingUrl } : {}) }).catch(() => null);
  }
  if (!to) return false;
  const reason = findNode(s.tree, vm.reason)?.label.fr ?? vm.reason ?? 'message';
  const link = `${publicBaseUrl()}/direct/ivr?id=${encodeURIComponent(call.id)}`;
  const text = [
    `Message vocal sur la ligne ON2GO / Voicemail on the ON2GO line`,
    ``,
    `De / From: ${call.from}`,
    `Quand / When: ${localTimeLabel(call.startedAt, { date: true })}`,
    `Langue / Language: ${call.lang}`,
    `Sujet / About: ${reason}${call.platform ? ` (${PLATFORM_NAME[call.platform]})` : ''}${call.orderIds.length ? ` — commande ${call.orderIds.join(', ')}` : ''}`,
    `Durée / Length: ${vm.durationSec ?? '?'} s`,
    ``,
    `Transcription: ${vm.transcript || '(aucune / none)'}`,
    ``,
    `Écouter et rappeler / Listen and call back: ${link}`,
  ].join('\n');
  const r = await sendEmail({ to, subject: `ON2GO — message vocal de ${call.from}`, text }, { purpose: 'ivr_voicemail' });
  return r.ok;
}

/** Twilio "Call status changes" for the ON2GO line: closes the menu record and the ordering record (same CallSid). */
export async function ivrStatus(params: URLSearchParams): Promise<void> {
  const id = params.get('CallSid') || '';
  if (!id) return;
  const st = params.get('CallStatus') || '';
  if (!['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(st)) return;
  const duration = Number(params.get('CallDuration')) || undefined;
  const call = await getIvrCall(id);
  if (call) await endIvrCall(id, call.outcome ?? (call.state === 'greeting' ? 'hangup' : undefined), duration);
  await callStatus(params);
  const s = await getIvrSettings();
  if (call?.voicemail && !s.transcribeVoicemail) await emailVoicemail(id);
}

/** Background safety net (expansion tick): close calls that lost their final callback, send voicemails still unsent. */
export async function tickIvr(now = Date.now()): Promise<{ closed: number; emailed: number }> {
  const calls = await listIvrCalls({ since: new Date(now - 2 * 86400_000).toISOString(), limit: 500 });
  let closed = 0;
  let emailed = 0;
  for (const c of calls) {
    if (c.status === 'active' && now - Date.parse(c.updatedAt || c.startedAt) > 30 * 60_000) { await endIvrCall(c.id); closed++; }
    if (c.voicemail && !c.voicemail.emailedAt && (c.voicemail.recordingUrl || c.voicemail.ticketId) && now - Date.parse(c.updatedAt) > 90_000) { if (await emailVoicemail(c.id)) emailed++; }
  }
  return { closed, emailed };
}

