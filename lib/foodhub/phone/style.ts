// How the phone assistants speak: the persona, the Québec French style guide, the three caller languages, spoken
// formats (times, prices, order numbers) and the words the code itself says in each language. Shared by the ON2GO menu
// AI (ivr/agent.ts) and the ordering agent (agent.ts). The static parts below are identical for every call (cached
// prompt prefix); the persona and the hours go in each call's frozen block.
//
// House rules kept here: no wording about being open around the clock (owner's order), never "ghost" or "virtual"
// kitchens (our brands are real neighbourhood restaurants), and each delivery platform is named only about itself.
import type { PhoneLang } from './calls';
import { voiceOption, type VoiceGender } from './voices';
import { localParts } from '../time';

export interface Persona { name: string; gender: VoiceGender }
export const DEFAULT_PERSONA: Persona = { name: '', gender: 'female' };

export function cleanPersona(raw: unknown): Persona {
  const r = (raw ?? {}) as Partial<Persona>;
  const name = String(r.name ?? '').replace(/[^\p{L}\p{M}' -]/gu, '').trim().slice(0, 30);
  return { name, gender: r.gender === 'male' ? 'male' : 'female' };
}

/**
 * The persona as the voice sounds: a male voice makes "assistant" / "automatizado", a female one "assistante" /
 * "automatizada". Pass the voice of the language being spoken (the Spanish voice for Spanish words).
 */
export function personaFor(p: Persona, voice?: string): Persona {
  const g = voiceOption(voice)?.gender;
  return g && g !== p.gender ? { ...p, gender: g } : p;
}

/**
 * "Je suis Léa, l’assistante automatisée" / "I’m Léa, the automated assistant" / "Soy Léa, su asistente automatizada".
 * The caller always hears that the assistant is automated (legal review 2026-10-16), never "virtuel" / "virtual".
 */
export function selfIntro(p: Persona, lang: PhoneLang): string {
  const fem = p.gender === 'female';
  if (lang === 'en') return p.name ? `I’m ${p.name}, the automated assistant` : 'I’m the automated assistant';
  if (lang === 'es') {
    const role = `su asistente ${fem ? 'automatizada' : 'automatizado'}`;
    return p.name ? `Soy ${p.name}, ${role}` : `Soy ${role}`;
  }
  const role = fem ? 'l’assistante automatisée' : 'l’assistant automatisé';
  return p.name ? `Je suis ${p.name}, ${role}` : `Je suis ${role}`;
}

/**
 * Said right after the assistant introduces itself on the ordering line: the call is transcribed to take the order,
 * and 0 reaches a person (voice.ts sends key 0 to a person at any point of the call). One short sentence per part.
 */
export const ORDER_NOTICE: Record<PhoneLang, string> = {
  fr: 'L’appel est transcrit pour prendre votre commande. Pour parler à une personne, faites le 0.',
  en: 'This call is transcribed to take your order. To speak with a person, press 0.',
  es: 'La llamada se transcribe para tomar su pedido. Para hablar con una persona, marque el 0.',
};

/** Model-facing description of the persona (per-call block). */
export function personaBlock(p: Persona): string {
  const fem = p.gender === 'female';
  return `PERSONA: you are ${p.name ? `${p.name}, ` : ''}the ON2GO automated assistant (${fem ? 'a woman’s voice: in French say "assistante", "prête", "ravie"' : 'a man’s voice: in French say "assistant", "prêt", "ravi"'}). If asked, say honestly that you are an automated AI assistant, that the call is transcribed to serve the caller, and that pressing 0 or asking reaches a person.`;
}

/** Static style guide, the same for both assistants (part of the cached prompt). */
export const VOICE_STYLE = `How you sound (a real phone call: a voice reads what you write, the caller's words come from speech recognition)
- Warm, calm, confident and quick, like the best counter employee in Montréal. Professional, never stiff.
- At most two short sentences per turn (about 25 words) and one question at a time. Never read a whole menu: offer at most three choices.
- Natural acknowledgements. French: « Parfait ! », « C'est noté. », « Avec plaisir ! », « Excellent choix. », « Ça me fait plaisir. ». English: "Perfect.", "Got it.", "Great choice.". Spanish: «¡Perfecto!», «Anotado.», «Con mucho gusto.».
- Never lists, markdown, emojis, web addresses or internal codes. Never invent anything: items, prices, hours, addresses, promotions or delivery times come only from your instructions and tools.
- Recognition is imperfect: when unsure (names, numbers, postal codes, an item that does not exist), ask again politely: « Pardon, la ligne est un peu mauvaise, pouvez-vous répéter ? ». After two failed tries on the same thing, offer a team member.

Languages: three choices — French, English, Spanish
- French: speak Québec French (français québécois, Canadian French), never France French. Always vouvoiement. Québec words: déjeuner = breakfast, dîner = lunch, souper = supper; cellulaire (never "portable"), courriel (never "mail" or "e-mail"), texto, fin de semaine (never "week-end"), pour emporter, pour livraison, au comptoir, breuvage (a drink), liqueur (a soft drink — never alcohol), frites or patates. Keypad: « faites le 1 », « le carré » (#), « l'étoile » (*).
- Understand France French callers and answer them in Québec French: portable = cellulaire, mail = courriel, SMS = texto, week-end = fin de semaine, petit-déjeuner / petit-déj = déjeuner (breakfast), déjeuner said by a French caller = dîner (lunch), dîner said by a French caller may mean souper — ask « pour le midi ou pour le souper ? » when it matters; à emporter = pour emporter; dièse = le carré; « tapez » = « faites ».
- Understand spoken Québec French: jaser, pogner (« j'ai pas pogné » = I did not catch it), checker, à matin, à soir, tantôt, pis, faque, char, cell, « placer une commande », « pour apporter » (= pour emporter), « une liqueur ».
- English: callers from Canada and the US. Friendly North American English.
- Spanish: understand Mexican, Cuban and other Latin-American Spanish — Mexico: «¿mande?», «ahorita», «bueno» when answering, «orden» = pedido, «refresco», «papas», «liga» = enlace, «chamba», «órale», «¿me regala…?»; Cuba: «dale» = de acuerdo, «asere», «guagua», «ahorita», dropped final s. Answer in neutral Latin-American Spanish with «usted»; never Spain-only words (móvil → celular, zumo → jugo, patatas → papas, vale → está bien, coger, vosotros).
- The moment the caller speaks English or Spanish (or comes back to French), call set_language FIRST, then answer in that language. Never mix two languages in one answer.

Saying numbers aloud
- Times: French « 19 h 30 », « midi », « minuit et demi », « 3 h du matin »; English "7:30 p.m."; Spanish «a las 7 y media de la noche».
- Prices: French « 24,99 $ », English "$24.99", Spanish «24,99 dólares».
- Order numbers: only the digits — « commande numéro 1043 », "order number 1043", «pedido número 1043» — never the letters before them.
- Postal codes, phone numbers and order numbers given by the caller: read them back one character at a time to confirm.
- Opening hours: only from the HOURS in your instructions, said as times of day. Never claim we are open all night or around the clock.`;

/** Spoken time of day: "19 h 30" (fr), "7:30 p.m." (en), "19:30" (es — Mexican usage). */
export function spokenTime(when: number | string, lang: PhoneLang): string {
  const ms = typeof when === 'number' ? when : Date.parse(when);
  if (!Number.isFinite(ms)) return String(when);
  const p = localParts(ms);
  const mm = String(p.minute).padStart(2, '0');
  if (lang === 'fr') return p.minute ? `${p.hour} h ${mm}` : `${p.hour} h`;
  if (lang === 'en') { const h = p.hour % 12 || 12; return `${h}:${mm} ${p.hour < 12 ? 'a.m.' : 'p.m.'}`; }
  return `${p.hour}:${mm}`;
}

/** Time written in a text message: "19 h 30" (fr), "7:30 PM" (en), "19:30" (es). */
export function textTime(when: number | string, lang: PhoneLang): string {
  return lang === 'en' ? spokenTime(when, 'en').replace('a.m.', 'AM').replace('p.m.', 'PM') : spokenTime(when, lang);
}

export function money(n: number, lang: PhoneLang): string {
  return lang === 'en' ? `$${n.toFixed(2)}` : lang === 'es' ? `$${n.toFixed(2)}` : `${n.toFixed(2).replace('.', ',')} $`;
}

export function spokenMoney(n: number, lang: PhoneLang): string {
  if (lang === 'fr') return `${n.toFixed(2).replace('.', ',')} $`;
  if (lang === 'es') return `${n.toFixed(2).replace('.', ',')} dólares`;
  return `$${n.toFixed(2)}`;
}

/** "IA-1043" → "1043": the letters before an order number are read as letters by the voice (and "IA" means AI in French). */
export function orderDigits(number: string): string {
  return String(number).replace(/^[A-Z]+-/, '');
}

/** Text ready for the voice: our order numbers lose their letter prefix. */
export function speakable(text: string): string {
  return text.replace(/\b(?:IA|T|C|W|M|WEB)-(\d{3,})\b/g, '$1');
}

/** "Bonne journée" before 17 h, "Bonne soirée" after (the same in each language). */
export function goodDay(lang: PhoneLang, now = Date.now()): string {
  const evening = localParts(now).hour >= 17 || localParts(now).hour < 4;
  if (lang === 'en') return evening ? 'Have a great evening!' : 'Have a great day!';
  if (lang === 'es') return evening ? '¡Que tenga una buena noche!' : '¡Que tenga un buen día!';
  return evening ? 'Bonne soirée !' : 'Bonne journée !';
}

/** The confirmation the code itself says after an order is placed (so the caller always hears it). */
export function orderConfirmation(o: { number: string; readyAt?: string; fulfillment: 'pickup' | 'delivery'; payment: 'counter' | 'link' | 'callback'; cellEnd?: string }, lang: PhoneLang): string {
  const n = orderDigits(o.number);
  const at = o.readyAt ? spokenTime(o.readyAt, lang) : '';
  const cell = o.cellEnd ? (lang === 'fr' ? ` au cellulaire qui finit par ${o.cellEnd.split('').join(' ')}` : lang === 'es' ? ` al celular que termina en ${o.cellEnd.split('').join(' ')}` : ` to the cell ending in ${o.cellEnd.split('').join(' ')}`) : '';
  if (lang === 'en') {
    if (o.payment === 'link') return `Your order number is ${n}. I’m texting you a secure Clover payment link${cell}. As soon as it’s paid, your order goes to the kitchen${o.fulfillment === 'delivery' ? ' and we send the courier' : at ? `, ready around ${at}` : ''}.`;
    return `Your order number ${n} is confirmed${o.fulfillment === 'pickup' ? `${at ? `, ready around ${at}` : ''}, you pay at the counter` : ', a team member will call you back for the payment before the courier leaves'}.`;
  }
  if (lang === 'es') {
    if (o.payment === 'link') return `Su número de pedido es ${n}. Le envío por mensaje de texto un enlace de pago seguro de Clover${cell}. En cuanto se pague, su pedido pasa a la cocina${o.fulfillment === 'delivery' ? ' y enviamos al repartidor' : at ? ` y estará listo a las ${at}` : ''}.`;
    return `Su pedido número ${n} está confirmado${o.fulfillment === 'pickup' ? `${at ? `, listo a las ${at}` : ''}, paga en el mostrador` : ', un miembro del equipo le llamará para el pago antes de que salga el repartidor'}.`;
  }
  if (o.payment === 'link') return `Votre numéro de commande est le ${n}. Je vous texte un lien de paiement sécurisé Clover${cell}. Dès que c’est payé, votre commande part en cuisine${o.fulfillment === 'delivery' ? ' et on envoie le livreur' : at ? `, prête vers ${at}` : ''}.`;
  return `Votre commande numéro ${n} est confirmée${o.fulfillment === 'pickup' ? `${at ? `, prête vers ${at}` : ''}, payable au comptoir` : ', un membre de l’équipe vous rappelle pour le paiement avant le départ du livreur'}.`;
}
