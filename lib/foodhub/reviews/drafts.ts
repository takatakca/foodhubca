// Reviews hub: reply drafts. Claude (the existing askClaude of watch/ai.ts) proposes a reply in the review's language,
// for the restaurant team of the brand: a real brick-and-mortar restaurant in Montréal. Every draft goes through
// guardDraft; a draft that breaks a rule is thrown away and a built-in template is used instead. Without
// ANTHROPIC_API_KEY the templates are used directly.
//
// Food Hub NEVER posts a reply on any platform. A person copies the draft into that platform's portal (store by store)
// and marks the review as replied here.
import type { Actor } from '../activity';
import { nowIso } from '../config';
import { askClaude } from '../watch/ai';
import { getReview, saveReply, type Review, type ReviewPlatform } from './model';
import { foldText, THEMES, type ReviewLang, type ThemeKey } from './themes';

export const MAX_DRAFT_CHARS = 600;
export const MAX_BATCH = 25;

/** Each platform's names (folded). A reply on one platform never names another one. Food Hub and Clover may be named. */
const PLATFORM_NAMES: Record<Exclude<ReviewPlatform, 'other'>, string[]> = {
  doordash: ['doordash', 'door dash'],
  uber_eats: ['uber eats', 'ubereats', 'uber'],
  skip: ['skipthedishes', 'skip the dishes', 'skip'],
  tgtg: ['too good to go', 'toogoodtogo', 'tgtg'],
  google: ['google'],
};

/** Money promises (the AI never approves money): refunds, credits, discounts, compensation, free food. Folded. */
const MONEY = ['rembours', 'credit', 'rabais', 'reduction', 'escompte', 'coupon', 'code promo', 'promo', 'compens', 'dedommag', 'gratuit', 'carte cadeau', 'carte-cadeau',
  'refund', 'reimburs', 'discount', 'voucher', 'gift card', 'free meal', 'free order', 'for free', 'on the house', '% off', 'money back'];
/** Words the brand never uses: the restaurants are real, and nothing is ever said to be open around the clock. Folded. */
const BANNED = ['virtuel', 'virtuelle', 'virtual', 'ghost', 'fantome', 'dark kitchen', 'cuisine fantome'];
const ROUND_THE_CLOCK = /24\s*(h\b|heures|hours|hrs?\b)|24\s*\/\s*7|24-7/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/;
const NAMED_COURIER = /\b(livreur|livreuse|dasher|courier|driver|chauffeur|coursier)\s+[A-Z][a-zà-ÿ]+/;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (w: string) => new RegExp(`(^|[^a-z0-9])${escape(w)}`); // start of a word: "rembours" catches remboursement, rembourser…

export interface GuardResult { ok: boolean; reasons: string[]; text: string }

/**
 * Checks a reply draft (accent- and case-insensitive). Rejects: another platform's name, refund / credit / discount
 * promises, "virtual / ghost", "24 h / 24/7", e-mail or phone numbers, a named courier, more than 600 characters.
 * Emojis are removed rather than rejected.
 */
export function guardDraft(text: string, platform: ReviewPlatform): GuardResult {
  const cleaned = String(text ?? '').replace(EMOJI, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const f = foldText(cleaned);
  const reasons: string[] = [];
  if (!cleaned) reasons.push('empty');
  for (const [p, names] of Object.entries(PLATFORM_NAMES)) {
    if (p === platform) continue;
    const hit = names.find((n) => word(n).test(f));
    if (hit) reasons.push(`names another platform (${hit})`);
  }
  const money = MONEY.find((w) => (w.startsWith('%') ? f.includes(w) : word(w).test(f)));
  if (money) reasons.push(`money promise (${money})`);
  const banned = BANNED.find((w) => word(w).test(f));
  if (banned) reasons.push(`forbidden word (${banned})`);
  if (ROUND_THE_CLOCK.test(f)) reasons.push('round-the-clock wording (24 h / 24/7)');
  if (EMAIL.test(cleaned) || PHONE.test(cleaned)) reasons.push('personal data (e-mail or phone)');
  if (NAMED_COURIER.test(cleaned)) reasons.push('names a courier');
  if (cleaned.length > MAX_DRAFT_CHARS) reasons.push(`longer than ${MAX_DRAFT_CHARS} characters`);
  return { ok: reasons.length === 0, reasons, text: cleaned };
}

// ---------------------------------------------------------------- templates

const NEG_ORDER: ThemeKey[] = ['missing', 'wrong', 'cold', 'late', 'packaging', 'portion', 'taste', 'price'];

const ISSUE: Partial<Record<ThemeKey, { fr: string; en: string }>> = {
  missing: { fr: 'qu’il manquait quelque chose dans votre commande', en: 'that something was missing from your order' },
  wrong: { fr: 'que votre commande ne correspondait pas à ce que vous aviez choisi', en: 'that your order was not what you chose' },
  cold: { fr: 'que votre repas soit arrivé froid', en: 'that your meal arrived cold' },
  late: { fr: 'que votre commande ait pris autant de temps', en: 'that your order took so long' },
  packaging: { fr: 'que l’emballage n’ait pas tenu le coup', en: 'that the packaging did not hold up' },
  portion: { fr: 'que la portion ne vous ait pas satisfait', en: 'that the portion did not meet your expectations' },
  taste: { fr: 'que le goût n’ait pas été à la hauteur', en: 'that the taste was not up to standard' },
  price: { fr: 'que le rapport qualité-prix vous ait déçu', en: 'that the value disappointed you' },
};

/** A built-in reply chosen by stars and the main theme, in French (default) or English. Always passes guardDraft. */
export function templateReply(review: Pick<Review, 'stars' | 'themes' | 'lang'>, brandName: string | null, lang: ReviewLang | null = review.lang): string {
  const en = lang === 'en';
  const brand = (brandName || '').trim();
  const team = brand ? (en ? `The ${brand} team` : `L’équipe ${brand}`) : (en ? 'The restaurant team' : 'L’équipe du restaurant');
  const stars = review.stars;
  const issue = NEG_ORDER.find((k) => review.themes?.includes(k) && THEMES[k].negative) ?? (stars !== null && stars <= 3 ? NEG_ORDER.find((k) => review.themes?.includes(k)) : undefined);
  if (stars !== null && stars >= 4 && !(issue && THEMES[issue].negative)) {
    return en
      ? `Hello, thank you so much for your kind words! The whole kitchen is happy to read that you enjoyed your order. We look forward to cooking for you again soon. ${team}`
      : `Bonjour, merci beaucoup pour votre beau commentaire! Toute l’équipe en cuisine est contente de savoir que vous avez apprécié votre commande. Au plaisir de cuisiner pour vous à nouveau. ${team}`;
  }
  const what = issue ? ISSUE[issue] : undefined;
  if (stars === 3 && !what) {
    return en
      ? `Hello, thank you for taking the time to share your feedback. We always want to do better, and your comment has been passed on to the kitchen team. Feel welcome to contact the restaurant directly to tell us more. ${team}`
      : `Bonjour, merci d’avoir pris le temps de nous écrire. Nous voulons toujours faire mieux et votre commentaire a été transmis à l’équipe en cuisine. N’hésitez pas à contacter directement le restaurant pour nous en dire plus. ${team}`;
  }
  return en
    ? `Hello, thank you for letting us know${what ? `, and we are sorry ${what.en}` : ', and we are sorry your experience was not what it should be'}. This is not the standard we hold ourselves to, and we have shared your comment with the kitchen team. Please contact the restaurant directly so we can look into it with you. ${team}`
    : `Bonjour, merci de nous l’avoir signalé${what ? ` et nous sommes désolés ${what.fr}` : ' et nous sommes désolés que votre expérience n’ait pas été à la hauteur'}. Ce n’est pas ce que nous voulons offrir, et votre commentaire a été transmis à l’équipe en cuisine. Contactez directement le restaurant pour que nous puissions regarder la situation avec vous. ${team}`;
}

// ---------------------------------------------------------------- AI

export function draftSystemPrompt(brandName: string | null): string {
  const brand = (brandName || '').trim() || 'the restaurant';
  return [
    `You write replies to customer reviews for the restaurant team of ${brand}, a real brick-and-mortar restaurant in Montréal.`,
    'Reply in the language of the review (Québec French by default). Thank the customer, address the specific point they raised, and invite them to contact the restaurant directly.',
    `At most ${MAX_DRAFT_CHARS} characters, no emojis, plain text only, sign as the restaurant team.`,
    'NEVER: name any delivery app or platform; promise or mention a refund, credit, discount, coupon, free food or any compensation (you cannot approve money);',
    'use the words virtual, virtuel, ghost, fantôme, 24h or 24/7; include any personal data (names, e-mails, phone numbers); blame or name a courier.',
    'Output only the reply text.',
  ].join('\n');
}

export interface DraftResult { text: string; source: 'ai' | 'template'; rejected?: string[] }

/** A reply draft: Claude when configured and the draft passes the guard, else a template. Never posted anywhere. */
export async function draftReply(review: Review, opts: { brandName?: string | null } = {}): Promise<DraftResult> {
  const brand = opts.brandName ?? review.brandName;
  const template = () => templateReply(review, brand);
  if (!process.env.ANTHROPIC_API_KEY) return { text: template(), source: 'template' };
  const lang = review.lang === 'en' ? 'English' : 'Québec French';
  const user = [
    `Review language: ${lang}.`,
    `Stars: ${review.stars ?? 'none'} / 5.`,
    review.themes.length ? `Topics: ${review.themes.map((k) => THEMES[k].en).join(', ')}.` : '',
    `Review text: """${review.text.slice(0, 1500)}"""`,
  ].filter(Boolean).join('\n');
  const out = await askClaude(draftSystemPrompt(brand), user, 400);
  if (!out) return { text: template(), source: 'template' };
  const g = guardDraft(out, review.platform);
  if (!g.ok) return { text: template(), source: 'template', rejected: g.reasons };
  return { text: g.text, source: 'ai' };
}

/** Proposes a reply and saves it as the review's draft (the replied mark, if any, is kept). */
export async function draftAndSave(id: string, actor: Actor): Promise<{ review: Review; draft: DraftResult } | null> {
  const r = await getReview(id);
  if (!r) return null;
  const draft = await draftReply(r);
  const review = await saveReply(id, { ...(r.reply ?? {}), draft: draft.text, draftAt: nowIso(), draftBy: actor.name, draftSource: draft.source });
  return review ? { review, draft } : null;
}

/** Marks a review as answered (the person posted the reply in the platform's portal). */
export async function markReplied(id: string, actor: Actor): Promise<Review | null> {
  const r = await getReview(id);
  if (!r) return null;
  return saveReply(id, { ...(r.reply ?? {}), repliedAt: nowIso(), repliedBy: actor.name });
}

/** Removes the draft and the replied mark. */
export async function clearReply(id: string): Promise<Review | null> {
  return saveReply(id, undefined);
}

/** "Proposer pour les avis sans réponse": up to 25 reviews, one after the other. */
export async function draftBatch(reviews: Review[], actor: Actor): Promise<{ drafted: number; ai: number; templates: number; ids: string[] }> {
  let ai = 0; let templates = 0;
  const ids: string[] = [];
  for (const r of reviews.slice(0, MAX_BATCH)) {
    const out = await draftAndSave(r.id, actor);
    if (!out) continue;
    ids.push(r.id);
    if (out.draft.source === 'ai') ai++; else templates++;
  }
  return { drafted: ids.length, ai, templates, ids };
}
