// French (Québec) first, English alongside. Strings live next to the code that shows them:
//   t('Accepter', 'Accept')
// so a screen can never be half-translated. The choice is a cookie (fh_lang) per browser,
// and each person's profile language is applied when they sign in.
import { withProductName, type ProductInfo } from '../foodhub/product';

export type Lang = 'fr' | 'en';
export const LANG_COOKIE = 'fh_lang';
export const DEFAULT_LANG: Lang = 'fr';
export type T = (fr: string, en: string) => string;

/**
 * The text for this language. With a product name other than the default ("ON2GO Hub", lib/foodhub/product.ts), every
 * "Food Hub" in a screen text follows it — one place instead of a hundred strings.
 */
export function translator(lang: Lang, product?: Pick<ProductInfo, 'name' | 'fullName' | 'isDefault'>): T {
  if (!product || product.isDefault) return (fr, en) => (lang === 'en' ? en : fr);
  return (fr, en) => withProductName(lang === 'en' ? en : fr, product);
}

export function isLang(v: unknown): v is Lang {
  return v === 'fr' || v === 'en';
}

/** fr-CA / en-CA locale for numbers and dates. */
export function locale(lang: Lang) {
  return lang === 'en' ? 'en-CA' : 'fr-CA';
}
