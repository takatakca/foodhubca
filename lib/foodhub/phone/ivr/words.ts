// ON2GO phone menu — the deterministic part of listening: language words, keypad menu sentences, the keyword router
// (used when the AI is off, fails, or after two misunderstandings), spoken order numbers, and the card-number guard.
import { findNode, levelOf, nodeFor, PLATFORM_NAME, type IvrLang, type IvrNode, type PlatformId, type Texts } from './tree';

/** Lowercase, no accents, no punctuation except spaces and apostrophes. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The caller asks for a language ("English", "español", "français"), in a short sentence. */
export function languageWord(speech: string): IvrLang | null {
  const f = fold(speech);
  if (!f || f.split(' ').length > 6) return null;
  if (/\b(english|anglais|ingles|inglish|in english)\b/.test(f)) return 'en';
  if (/\b(espanol|espagnol|spanish|castellano|en espanol)\b/.test(f)) return 'es';
  if (/\b(francais|french|frances|en francais)\b/.test(f)) return 'fr';
  return null;
}

/** Keypad digits on the greeting: 1 français, 2 English, 3 español. */
export const LANG_DIGIT: Record<string, IvrLang> = { '1': 'fr', '2': 'en', '3': 'es' };

export const LANG_OPTIONS = 'For English, say English or press 2. Para español, diga español o marque 3.';

const PRESS: Record<IvrLang, (label: string, d: string) => string> = {
  fr: (l, d) => `Pour ${l}, faites le ${d}.`,
  en: (l, d) => `For ${l}, press ${d}.`,
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
  if (/\buber\b|\bubereats\b|\bouber\b/.test(f)) return 'ubereats';
  if (/\bdoor ?dash\b|\bdoordash\b|\bdor dash\b/.test(f)) return 'doordash';
  if (/\bskip\b|\bskipthedishes\b|\bskip the dishes\b/.test(f)) return 'skip';
  return null;
}

type Rule = { test: RegExp; node: (tree: IvrNode[]) => IvrNode | null };
const byFlow = (flow: string) => (tree: IvrNode[]) => nodeFor(tree, (a) => a.kind === 'ai' && a.flow === flow);
const byKind = (kind: string) => (tree: IvrNode[]) => nodeFor(tree, (a) => a.kind === kind);

/** Ordered: the first rule that matches wins (sign-ups and platforms before the generic "my order"). */
const RULES: Rule[] = [
  { test: /\b(devenir|etre|travailler comme|become|be a|work as|ser|trabajar como)\b.*\b(livreur|livreuse|courier|driver|dasher|repartidor|conductor)\b|\b(livreur|livreuse|repartidor)\b/, node: byFlow('courier') },
  { test: /\b(marchand|commercant|restaurant partenaire|mon restaurant|inscrire (mon|notre) restaurant|merchant|my restaurant|list (my|our) restaurant|partner restaurant|restaurante asociado|mi restaurante|comerciante|socio)\b/, node: byFlow('merchant') },
  { test: /\b(frais|carte de credit|carte de debit|sur ma carte|preleve|transaction|charge on my|charged|my card|credit card|bank statement|cargo|cobro|me cobraron|tarjeta)\b/, node: byFlow('card_charge') },
  { test: /\b(facture|facturation|recu|billing|invoice|receipt|factura|facturacion|recibo)\b/, node: byFlow('billing') },
  { test: /\b(commander|passer une commande|faire une commande|je veux manger|place an order|order food|want to order|like to order|make an order|to order|pedir|hacer un pedido|quiero pedir|ordenar)\b/, node: byKind('order') },
  { test: /\b(probleme|pas recu|jamais recu|en retard|manque|mauvaise commande|ma commande|problem|issue|missing|late|wrong order|never arrived|my order|problema|no llego|falta|mi pedido|pedido equivocado)\b/, node: byFlow('online_problem') },
  { test: /\b(parler a quelqu'un|parler a quelqu un|une personne|un humain|un agent|representant|operateur|someone|a person|human|representative|operator|real person|persona|alguien|humano|representante)\b/, node: byKind('handoff') },
  { test: /\b(laisser un message|boite vocale|message|voicemail|leave a message|mensaje|buzon)\b/, node: byKind('voicemail') },
  { test: /\b(service a la clientele|service client|question|renseignement|information|customer service|help|servicio al cliente|ayuda|informacion|pregunta)\b/, node: byFlow('customer_service') },
];

export interface KeywordRoute { node: IvrNode; platform?: PlatformId }

/** The branch a caller's words point to, without the AI. Null when nothing matches. */
export function keywordIntent(speech: string, tree: IvrNode[]): KeywordRoute | null {
  const f = fold(speech);
  if (!f) return null;
  const platform = detectPlatform(f);
  const sign = RULES.slice(0, 2).find((r) => r.test.test(f));
  if (sign) { const node = sign.node(tree); if (node) return { node }; }
  if (platform) {
    const node = nodeFor(tree, (a) => a.kind === 'platform' && a.platform === platform) ?? nodeFor(tree, (a) => a.kind === 'platform');
    if (node) return { node, platform };
  }
  for (const r of RULES.slice(2)) if (r.test.test(f)) { const node = r.node(tree); if (node) return { node }; }
  // Hints typed by the owner on custom options.
  for (const n of tree.flatMap((x) => [x, ...(x.children ?? [])])) {
    if (!n.enabled) continue;
    const words = n.hints.split(',').map((h) => fold(h)).filter((h) => h.length >= 4);
    if (words.some((w) => f.includes(w))) return { node: n };
  }
  return null;
}

/** A keypad digit on a menu level: its option, 0 = the person option (any level). */
export function digitNode(tree: IvrNode[], menuId: string | null | undefined, digit: string): IvrNode | null {
  if (digit === '0') return levelOf(tree, null).find((n) => n.digit === '0') ?? nodeFor(tree, (a) => a.kind === 'handoff');
  return levelOf(tree, menuId).find((n) => n.digit === digit) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Order numbers and card numbers

const FILLER = new Set(['numero', 'number', 'commande', 'order', 'pedido', 'id', "c'est", 'cest', 'is', 'es', 'le', 'la', 'the', 'my', 'mon', 'ma', 'mi', 'de', 'del', 'du', 'su', 'hash', 'diese', 'carre', 'pound', 'it', "it's", 'its', 'el', 'num', 'no', 'ok', 'okay', 'euh', 'um', 'uh', 'alors', 'so', 'dash', 'tiret', 'guion']);

/** A spoken or typed order number → "AB12C9". Letters and digits only, filler words dropped. Null when nothing usable. */
export function normalizeOrderId(input: string): string | null {
  const words = fold(input).replace(/#/g, ' ').split(' ').filter((w) => w && !FILLER.has(w));
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
  fr: 'Pour votre sécurité, ne donnez jamais un numéro de carte au téléphone. Nous n’en avons jamais besoin.',
  en: 'For your security, never give a card number over the phone. We never need it.',
  es: 'Por su seguridad, nunca dé un número de tarjeta por teléfono. Nunca lo necesitamos.',
};

export const platformName = (p: PlatformId) => PLATFORM_NAME[p];
