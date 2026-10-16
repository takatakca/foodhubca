// ON2GO phone menu — the deterministic part of listening: language words, keypad menu sentences, the keyword router
// (used when the AI is off, fails, or after two misunderstandings), yes / no, spoken order numbers, and the card-number
// guard. The words cover the three caller languages as people really say them: Québec and France French, Canadian and
// US English, Mexican, Cuban and other Latin-American Spanish.
import { findNode, levelOf, nodeFor, PLATFORM_NAME, type IvrLang, type IvrNode, type PlatformId, type Texts } from './tree';

/** Lowercase, no accents, no punctuation except spaces and apostrophes. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const LANG_WORDS: Array<[IvrLang, RegExp]> = [
  ['en', /\b(in english|speak english|english please|habla ingles|hablo ingles|english|anglais|anglaise|ingles|inglish)\b/],
  ['es', /\b(en espanol|hablo espanol|habla espanol|spanish please|espanol|espagnol|spanish|castellano)\b/],
  ['fr', /\b(parlez vous francais|en francais|french please|francais|french|frances)\b/],
];
const POLITE = /\b(please|s'il vous plait|s'il te plait|svp|por favor|thanks|thank you|merci|gracias|ok|okay)\b/g;

/**
 * The caller asks for a language ("English", "español", "français") — in a short sentence, or at the start of a longer
 * one ("English, I want to order a chicken"). `rest` = what they said after it (to handle right away).
 */
export function languageRequest(speech: string): { lang: IvrLang; rest: string } | null {
  const f = fold(speech);
  if (!f) return null;
  const words = f.split(' ');
  for (const [lang, re] of LANG_WORDS) {
    const m = f.match(re);
    if (!m || m.index === undefined) continue;
    const before = f.slice(0, m.index).trim().split(' ').filter(Boolean).length;
    if (words.length > 6 && before > 2) continue;
    const rest = f.slice(m.index + m[0].length).replace(POLITE, ' ').replace(/^\s*(i|je|yo)?\s*$/, '').replace(/\s+/g, ' ').trim();
    return { lang, rest: rest.split(' ').filter(Boolean).length >= 2 ? rest : '' };
  }
  return null;
}

/** The caller asks for a language, in a short sentence (or at the start of one). */
export function languageWord(speech: string): IvrLang | null {
  return languageRequest(speech)?.lang ?? null;
}

const STOP: Record<IvrLang, Set<string>> = {
  fr: new Set(['je', "j'ai", "j'aimerais", 'veux', 'voudrais', 'commande', 'commander', 'oui', 'ouais', 'bonjour', 'allo', 'merci', 'avec', 'est', "c'est", 'une', 'des', 'les', 'mon', 'ma', 'mes', 'vous', 'svp', 'quelqu', "quelqu'un", 'pas', 'livraison', 'emporter', 'probleme', 'parler', 'aider', 'pis', 'faque']),
  en: new Set(['i', "i'm", "i'd", 'want', 'would', 'like', 'order', 'yes', 'yeah', 'hello', 'hi', 'thanks', 'please', 'the', 'my', 'with', 'is', 'can', 'you', 'need', 'have', 'delivery', 'pickup', 'speak', 'someone', 'what', 'where', "it's", 'get']),
  es: new Set(['quiero', 'quisiera', 'pedido', 'orden', 'gracias', 'por', 'favor', 'hola', 'bueno', 'con', 'el', 'mi', 'para', 'tengo', 'necesito', 'usted', 'llevar', 'como', 'que', 'hablar', 'alguien', 'pedir', 'una', 'del', 'esta', 'oye', 'mande', 'dale', 'ahorita']),
};

/** Which of the three languages a sentence is in, from its common words. Null when it is not clear. */
export function guessLanguage(speech: string): IvrLang | null {
  const words = fold(speech).split(' ').filter(Boolean);
  const score = (l: IvrLang) => words.filter((w) => STOP[l].has(w)).length;
  const ranked = (['fr', 'en', 'es'] as IvrLang[]).map((l) => [l, score(l)] as const).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  return best[1] >= 2 && best[1] >= second[1] + 2 ? best[0] : null;
}

/** Keypad digits on the greeting: 1 français, 2 English, 3 español. */
export const LANG_DIGIT: Record<string, IvrLang> = { '1': 'fr', '2': 'en', '3': 'es' };

export const LANG_OPTIONS = 'For English, press 2. Para español, marque el 3.';

/** English labels that start with a verb read "To leave a message, press 7"; nouns read "For billing, press 3". */
const EN_VERB = /^(place|become|talk|speak|leave|order|make|get|hear|reach|check|track|report|ask|sign|apply|pay|request|contact|register|join|cancel|find|book|change)\b/i;

const PRESS: Record<IvrLang, (label: string, d: string) => string> = {
  fr: (l, d) => `Pour ${l}, faites le ${d}.`,
  en: (l, d) => `${EN_VERB.test(l) ? 'To' : 'For'} ${l}, press ${d}.`,
  es: (l, d) => `Para ${l}, marque el ${d}.`,
};
const REPEAT: Texts = { fr: 'Pour réentendre ce menu, faites l’étoile.', en: 'To hear this menu again, press star.', es: 'Para escuchar este menú otra vez, marque asterisco.' };

/** The keypad menu of one level, read aloud: every option with its key, then "0 = person" and "star = repeat". */
export function menuSpeech(tree: IvrNode[], menuId: string | null | undefined, lang: IvrLang): string {
  const options = levelOf(tree, menuId);
  const intro = menuId ? findNode(tree, menuId)?.prompt?.[lang] ?? '' : '';
  const lines = options.filter((n) => n.digit !== '0').sort((a, b) => a.digit.localeCompare(b.digit)).map((n) => PRESS[lang](n.label[lang], n.digit));
  const person = levelOf(tree, null).find((n) => n.digit === '0' && n.action.kind === 'handoff');
  if (person) lines.push(PRESS[lang](person.label[lang], '0'));
  return [intro, ...lines, REPEAT[lang]].filter(Boolean).join(' ');
}

/** Speech hints for a level: option hints plus the platform names (Twilio gives these words a boost). */
export function levelHints(tree: IvrNode[], menuId?: string | null): string {
  const words = levelOf(tree, menuId ?? null).flatMap((n) => [n.hints, ...(n.children ?? []).map((c) => c.hints)]).join(', ');
  return [words, 'Uber Eats, DoorDash, SkipTheDishes, English, español, français'].filter(Boolean).join(', ').slice(0, 1500);
}

// ---------------------------------------------------------------------------------------------------------------
// Keyword router

export function detectPlatform(speech: string): PlatformId | null {
  const f = fold(speech);
  if (/\buber\b|\bubereats\b|\bouber\b|\boubeur\b|\bhubert eats?\b|\buber eat\b/.test(f)) return 'ubereats';
  if (/\bdoor ?dash\b|\bdoordash\b|\bdor ?dash\b|\bdore dash\b/.test(f)) return 'doordash';
  if (/\bskip\b|\bskipthedishes\b|\bskip the dish(es)?\b|\bskip de dishes\b/.test(f)) return 'skip';
  return null;
}

type Rule = { test: RegExp; node: (tree: IvrNode[]) => IvrNode | null };
const byFlow = (flow: string) => (tree: IvrNode[]) => nodeFor(tree, (a) => a.kind === 'ai' && a.flow === flow);
const byKind = (kind: string) => (tree: IvrNode[]) => nodeFor(tree, (a) => a.kind === kind);

/** Sign-ups: checked before platform names ("devenir livreur DoorDash" is a courier lead, not a DoorDash order). */
const SIGN_UPS: Rule[] = [
  { test: /\b(devenir|etre|travailler comme|become|be a|work as|ser|trabajar como)\b.*\b(livreur|livreuse|chauffeur|courier|driver|dasher|repartidor|mensajero|chofer|conductor)\b|\b(livreur|livreuse|repartidor|mensajero|faire de la livraison|livrer pour vous|deliver for you|delivery driver|postuler|une job|emploi|hiring|job opening|chamba|empleo|trabajar con ustedes)\b/, node: byFlow('courier') },
  { test: /\b(marchand|commercant|restaurant partenaire|mon restaurant|mon resto|mon commerce|mon depanneur|mon epicerie|partenariat|inscrire (mon|notre) (restaurant|commerce)|merchant|my restaurant|my store|my shop|my business|partner with you|list (my|our) restaurant|partner restaurant|restaurante asociado|mi restaurante|mi negocio|mi tienda|mi bodega|mi local|asociarme|registrar mi|comerciante|socio)\b/, node: byFlow('merchant') },
];

/** Ordered: the first rule that matches wins. */
const RULES: Rule[] = [
  // Never received: before billing ("reçu" is also a receipt).
  { test: /\b((pas|jamais|rien|toujours pas) (encore )?recu|pas (encore )?arrive|jamais arrive|toujours pas arrive|no ha llegado|nunca llego|no llego|never (came|arrived|showed)|hasn'?t (arrived|come)|didn'?t (arrive|come|get)|still waiting|where is my (order|food))\b/, node: byFlow('online_problem') },
  { test: /\b(carte de credit|carte de debit|sur ma carte|frais sur ma carte|preleve|debite|transaction|releve bancaire|charge deux fois|ils m'ont charge|m'ont charge|double charge|visa|mastercard|interac|charge on (my|your)|charged|my card|credit card|bank statement|unknown charge|cargo|cobro|me cobraron|me descontaron|cargo desconocido|estado de cuenta|tarjeta)\b/, node: byFlow('card_charge') },
  { test: /\b(facture|facturation|(un|mon|le|du|ma|des) recus?|etat de compte|depot|billing|invoice|receipt|payout|factura|facturacion|recibo|comprobante)\b/, node: byFlow('billing') },
  // A problem said clearly wins over ordering words ("ma commande pour emporter est en retard").
  { test: /\b(probleme|souci|en retard|retard|il manque|manquant|(est|arrivee?|etait) froide?|erreur|pas la bonne|mauvaise? (commande|item|article)|ou est ma commande|rembours\w*|annuler|plainte|problem|issue|missing|(is|was|arrived|running|so|very) (late|cold)|wrong (order|item)|refund|cancel|complaint|problema|se tardo|tardando|demorado|demora|no llega|me falta|falta|llego frio|esta frio|equivocado|reembolso|cancelar|queja)\b/, node: byFlow('online_problem') },
  { test: /\b(commander|passer (une |ma )?commande|placer (une|ma) commande|faire une commande|prendre (ma|une) commande|je veux manger|pour emporter|pour apporter|me faire livrer|place an order|order food|want to order|like to order|wanna order|make an order|to order|takeout|take out|carry out|can i get|pedir|hacer (un|una) (pedido|orden)|quiero pedir|quisiera pedir|ordenar|una orden|para llevar|a domicilio)\b/, node: byKind('order') },
  { test: /\b(ma commande|my order|mi pedido|mi orden)\b/, node: byFlow('online_problem') },
  { test: /\b(parler a quelqu'un|parler a quelqu un|jaser avec quelqu'un|une personne|une vraie personne|un etre humain|un humain|un agent|une agente|un prepose|une preposee|prepose|preposee|le gerant|la gerante|un conseiller|une conseillere|representant|telephoniste|operateur|someone|a person|human|representative|operator|real person|live agent|manager|supervisor|persona|alguien|humano|representante|un agente|el gerente|el encargado|el dueno)\b/, node: byKind('handoff') },
  { test: /\b(laisser un message|boite vocale|voicemail|leave a message|dejar un mensaje|dejar un recado|buzon)\b/, node: byKind('voicemail') },
  // Hours, address, delivery area: customer service (the AI answers from the configured hours).
  { test: /\b(heures? d'ouverture|horaires?|ouverts?|fermez|fermer|a quelle heure|fin de semaine|a soir|a matin|adresse|livrez vous|open|close[sd]?|hours|what time|address|do you deliver|horario|abren|cierran|abiertos?|direccion|a que hora)\b/, node: byFlow('customer_service') },
  { test: /\b(service a la clientele|service client|question|renseignement|information|customer service|help|servicio al cliente|ayuda|informacion|pregunta)\b/, node: byFlow('customer_service') },
];

export interface KeywordRoute { node: IvrNode; platform?: PlatformId }

/** The branch a caller's words point to, without the AI. Null when nothing matches. */
export function keywordIntent(speech: string, tree: IvrNode[]): KeywordRoute | null {
  const f = fold(speech);
  if (!f) return null;
  const platform = detectPlatform(f);
  const sign = SIGN_UPS.find((r) => r.test.test(f));
  if (sign) { const node = sign.node(tree); if (node) return { node }; }
  if (platform) {
    const node = nodeFor(tree, (a) => a.kind === 'platform' && a.platform === platform) ?? nodeFor(tree, (a) => a.kind === 'platform');
    if (node) return { node, platform };
  }
  for (const r of RULES) if (r.test.test(f)) { const node = r.node(tree); if (node) return { node }; }
  // Hints typed by the owner on custom options.
  for (const n of tree.flatMap((x) => [x, ...(x.children ?? [])])) {
    if (!n.enabled) continue;
    const words = n.hints.split(',').map((h) => fold(h)).filter((h) => h.length >= 4);
    if (words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(f))) return { node: n };
  }
  return null;
}

/** A keypad digit on a menu level: its option, 0 = the person option (any level). */
export function digitNode(tree: IvrNode[], menuId: string | null | undefined, digit: string): IvrNode | null {
  if (digit === '0') return levelOf(tree, null).find((n) => n.digit === '0') ?? nodeFor(tree, (a) => a.kind === 'handoff');
  return levelOf(tree, menuId).find((n) => n.digit === digit) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Yes / no / "that's all"

const FILLERS = "(?:(?:euh|heu|ben|bah|bon|well|um|uh|oh|so|pues|este|eh|ah|oui oui)\\s+)*";

/** Yes, with the fillers people put first ("Euh oui", "Ben oui", "Ouin", "Dale", "Órale"). Input: folded text. */
export const YES = new RegExp(`^${FILLERS}(oui|ouais|ouin|yes|yeah|yep|yup|sure|si|exact|exactement|correct|c'est ca|cest ca|c'est bon|c'est beau|c'est correct|en plein|parfait|ok|okay|d'accord|that's right|thats right|claro|correcto|eso es|andale|orale|dale|esta bien|perfecto|asi es)\\b`);
export const NO = /\b(non|no|nope|nah|pantoute|recommencer|again|otra vez|de nuevo|incorrect|incorrecto|pas ca|esta mal)\b/;

/** The caller is done ("non merci", "c'est tout", "no gracias", "that's all"). Input: folded text. */
export const NO_MORE = new RegExp(`^${FILLERS}(non|no|nope|nah|non merci|no gracias|no thanks|no thank you|c'est tout|cest tout|c'est beau|ca va aller|ca va|je suis correct|rien d'autre|pas besoin|that's all|thats all|that's it|i'm good|im good|all good|eso es todo|es todo|nada mas|nada mas gracias)\\b`);

// ---------------------------------------------------------------------------------------------------------------
// Order numbers and card numbers

const FILLER = new Set(['numero', 'number', 'commande', 'order', 'pedido', 'orden', 'id', "c'est", 'cest', 'is', 'es', 'le', 'la', 'the', 'my', 'mon', 'ma', 'mi', 'de', 'del', 'du', 'su', 'hash', 'diese', 'carre', 'pound', 'it', "it's", 'its', 'el', 'num', 'no', 'ok', 'okay', 'euh', 'heu', 'um', 'uh', 'alors', 'so', 'dash', 'tiret', 'guion', 'faque', 'genre', 'pis', 'pues', 'este', 'o', 'sea', 'like', 'ben', 'bon', 'mmm']);
const NUMBER_WORDS: Record<string, string> = {
  zero: '0', oh: '0', cero: '0', un: '1', une: '1', one: '1', uno: '1', deux: '2', two: '2', dos: '2', trois: '3', three: '3', tres: '3', quatre: '4', four: '4', cuatro: '4',
  cinq: '5', five: '5', cinco: '5', six: '6', seis: '6', sept: '7', seven: '7', siete: '7', huit: '8', eight: '8', ocho: '8', neuf: '9', nine: '9', nueve: '9',
};

/** A spoken or typed order number → "AB12C9". Letters and digits only, filler words dropped, "deux" / "two" / "dos" → 2. Null when nothing usable. */
export function normalizeOrderId(input: string): string | null {
  const words = fold(input).replace(/#/g, ' ').split(' ').filter((w) => w && !FILLER.has(w)).map((w) => NUMBER_WORDS[w] ?? w);
  const id = words.join('').replace(/[^a-z0-9]/g, '').toUpperCase();
  return id.length >= 3 && id.length <= 40 ? id : null;
}

/** "AB12" → "A, B, 1, 2" so the voice reads it one character at a time. */
export function spellOut(id: string): string {
  return id.split('').join(', ');
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

const CARD_RUN = /\d(?:[ -]?\d){12,18}/g;

/** True when the text holds what looks like a payment card number (13–19 digits passing the Luhn check). */
export function hasCardNumber(text: string): boolean {
  for (const m of String(text).match(CARD_RUN) ?? []) {
    const d = m.replace(/\D/g, '');
    if (d.length >= 13 && d.length <= 19 && luhn(d)) return true;
  }
  return false;
}

/** The text with every card-like number removed: card numbers never reach a transcript, a ticket or the AI. */
export function redactCards(text: string): string {
  return String(text).replace(CARD_RUN, (m) => {
    const d = m.replace(/\D/g, '');
    return d.length >= 13 && d.length <= 19 && luhn(d) ? '[card number removed]' : m;
  });
}

export const NO_CARD: Texts = {
  fr: 'Pour votre sécurité, ne donnez jamais un numéro de carte au téléphone. Nous n’en avons jamais besoin. Pour payer une commande, je peux vous texter un lien de paiement sécurisé.',
  en: 'For your security, never give a card number over the phone. We never need it. To pay for an order, I can text you a secure payment link.',
  es: 'Por su seguridad, nunca dé un número de tarjeta por teléfono. Nunca lo necesitamos. Para pagar un pedido, puedo enviarle un enlace de pago seguro por mensaje de texto.',
};

export const platformName = (p: PlatformId) => PLATFORM_NAME[p];
