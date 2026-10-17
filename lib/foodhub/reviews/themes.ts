// Reviews hub: what customers talk about, with plain keyword buckets (French and English), and which language a review
// is written in. Deterministic and pure: no AI, no I/O, the same review always gets the same themes.

export const THEME_KEYS = ['cold', 'late', 'missing', 'wrong', 'portion', 'taste', 'packaging', 'price', 'friendly', 'fast'] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];
export type ReviewLang = 'fr' | 'en';

/** Lower case, accents removed, apostrophes unified: "Tiède, pas chaud !" → "tiede, pas chaud !". */
export function foldText(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`]/g, "'").toLowerCase();
}

/**
 * Words and phrases per theme, already folded (no accents, lower case). A word matches on its own (not inside a longer
 * word); a phrase matches as written. Negative themes come first: the reply templates pick the first one found.
 */
export const THEMES: Record<ThemeKey, { fr: string; en: string; negative: boolean; words: string[] }> = {
  cold: { fr: 'Froid', en: 'Cold', negative: true, words: ['froid', 'froide', 'froids', 'froides', 'tiede', 'tiedes', 'pas chaud', 'pas chaude', 'cold', 'lukewarm', 'not hot', 'not warm'] },
  late: { fr: 'Retard', en: 'Late', negative: true, words: ['retard', 'en retard', 'trop long', 'trop longtemps', 'longtemps', 'lent', 'lente', 'attendu', 'attendre', 'attente', 'late', 'delay', 'delayed', 'slow', 'waited', 'took forever', 'took too long', 'too long'] },
  missing: { fr: 'Manquant', en: 'Missing', negative: true, words: ['manquant', 'manquante', 'manquants', 'manquait', 'manquaient', 'manque', 'oublie', 'oubliee', 'oublies', 'pas recu', 'jamais recu', 'missing', 'forgot', 'forgotten', 'not included', 'never received', "didn't get", 'didnt get', "didn't receive", 'didnt receive'] },
  wrong: { fr: 'Erreur', en: 'Wrong order', negative: true, words: ['erreur', 'mauvaise commande', 'mauvais plat', 'pas la bonne', 'pas le bon', "pas ce que j'ai", 'wrong', 'incorrect', 'mistake', 'mix up', 'mixed up', 'not what i ordered'] },
  portion: { fr: 'Portion', en: 'Portion', negative: false, words: ['portion', 'portions', 'quantite', 'pas assez', 'trop petit', 'trop petite', 'minuscule', 'copieux', 'copieuse', 'genereux', 'genereuse', 'small portion', 'tiny', 'not enough', 'quantity', 'generous', 'huge', 'size'] },
  taste: { fr: 'Goût', en: 'Taste', negative: false, words: ['gout', 'gouts', 'delicieux', 'delicieuse', 'savoureux', 'savoureuse', 'fade', 'sans saveur', 'trop sale', 'tres bon', 'tres bonne', 'excellent', 'excellente', 'taste', 'tasty', 'tasteless', 'delicious', 'bland', 'flavor', 'flavour', 'flavorful', 'yummy', 'salty', 'greasy', 'gras', 'grasse'] },
  packaging: { fr: 'Emballage', en: 'Packaging', negative: true, words: ['emballage', 'emballages', 'boite', 'renverse', 'renversee', 'coule', 'ecrase', 'ecrasee', 'sac', 'packaging', 'package', 'container', 'spilled', 'spill', 'leaked', 'leaking', 'leak', 'crushed', 'soggy'] },
  price: { fr: 'Prix', en: 'Price', negative: false, words: ['prix', 'cher', 'chere', 'trop cher', 'dispendieux', 'couteux', 'rapport qualite', 'price', 'prices', 'expensive', 'overpriced', 'pricey', 'value', 'worth'] },
  friendly: { fr: 'Accueil', en: 'Friendly', negative: false, words: ['accueil', 'accueillant', 'accueillante', 'gentil', 'gentille', 'aimable', 'sympathique', 'sympa', 'poli', 'polie', 'impoli', 'impolie', 'personnel', 'friendly', 'rude', 'kind', 'staff', 'polite', 'welcoming', 'service'] },
  fast: { fr: 'Rapide', en: 'Fast', negative: false, words: ['rapide', 'rapides', 'rapidement', 'vite', 'a temps', 'a l\'heure', 'fast', 'quick', 'quickly', 'on time', 'speedy', 'prompt'] },
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MATCHERS: Array<[ThemeKey, RegExp]> = THEME_KEYS.map((k) => [k, new RegExp(`(^|[^a-z0-9])(${THEMES[k].words.map(escape).join('|')})(?=$|[^a-z0-9])`, 'g')]);

/**
 * Themes whose meaning flips when negated ("pas froid", "not late", "aucun retard", "pas rapide"). The topic themes
 * (portion, taste, price, friendly) stay: "pas bon" is still about the taste.
 */
const NEGATABLE = new Set<ThemeKey>(['cold', 'late', 'missing', 'wrong', 'packaging', 'fast']);
const NEGATORS = new Set(['pas', 'jamais', 'aucun', 'aucune', 'sans', 'rien', 'not', 'never', 'no', 'nothing', 'without', 'cannot']);
/** "wasnt", "didnt": the apostrophe is often left out. */
const NT_NO_APOSTROPHE = /^(isn|wasn|weren|aren|didn|doesn|don|wouldn|couldn|haven|hasn)t$/;
/** A clause ends at punctuation or at a joining word: "pas cher, mais froid" → "froid" is not negated. */
const CLAUSE_END = /[,.;:!?()\n]|(^|[^a-z'])(mais|but|et|and|ou|or|however|cependant|sauf|except)(?![a-z'])/g;

/** True when one of the 3 words before `start` (same clause) negates it. */
function negatedAt(t: string, start: number): boolean {
  const before = t.slice(0, start);
  let cut = 0;
  for (const m of before.matchAll(CLAUSE_END)) cut = m.index + m[0].length;
  const words = before.slice(cut).split(/[^a-z']+/).filter(Boolean).slice(-3);
  return words.some((w) => NEGATORS.has(w) || w.endsWith("n't") || NT_NO_APOSTROPHE.test(w));
}

/** The themes a review talks about, in THEME_KEYS order. A negated mention ("pas froid du tout") does not count. */
export function detectThemes(text: string): ThemeKey[] {
  const t = foldText(text);
  if (!t.trim()) return [];
  return MATCHERS.filter(([k, re]) => [...t.matchAll(re)].some((m) => !NEGATABLE.has(k) || !negatedAt(t, m.index + m[1].length))).map(([k]) => k);
}

const FR_WORDS = new Set(['le', 'la', 'les', 'et', 'est', 'tres', 'pas', 'une', 'des', 'du', 'je', 'j', 'c', 'commande', 'merci', 'bon', 'bonne', 'avec', 'pour', 'mais', 'tout', 'etait', 'sont', 'nous', 'vous', 'mon', 'ma', 'mes', 'au', 'aux', 'trop', 'bien', 'plat', 'livraison', 'encore', 'jamais', 'toujours', 'que', 'qui', 'il', 'elle', 'ca', 'cest']);
const EN_WORDS = new Set(['the', 'and', 'is', 'was', 'very', 'not', 'my', 'i', 'it', 'order', 'thanks', 'thank', 'good', 'great', 'with', 'for', 'but', 'all', 'were', 'are', 'we', 'you', 'to', 'of', 'this', 'that', 'too', 'food', 'delivery', 'never', 'always', 'again', 'what', 'they', 'had', 'did', 'didn', 'love', 'best']);

/** "fr" or "en" from common words (Québec French wins a tie); null when there is no text. */
export function detectLang(text: string): ReviewLang | null {
  const raw = String(text ?? '');
  const words = foldText(raw).split(/[^a-z]+/).filter(Boolean);
  if (!words.length) return null;
  let fr = 0; let en = 0;
  for (const w of words) { if (FR_WORDS.has(w)) fr++; if (EN_WORDS.has(w)) en++; }
  if (/[àâçéèêëîïôûùœ]/i.test(raw)) fr += 1;
  if (!fr && !en) return null;
  return en > fr ? 'en' : 'fr';
}

export function themeLabel(key: ThemeKey, lang: ReviewLang = 'fr'): string {
  return THEMES[key]?.[lang] ?? key;
}

export function isThemeKey(v: string): v is ThemeKey {
  return (THEME_KEYS as readonly string[]).includes(v);
}
