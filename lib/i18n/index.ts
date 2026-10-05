// French (Québec) first, English alongside. Strings live next to the code that shows them:
//   t('Accepter', 'Accept')
// so a screen can never be half-translated. The choice is a cookie (fh_lang) per browser,
// and each person's profile language is applied when they sign in.
export type Lang = 'fr' | 'en';
export const LANG_COOKIE = 'fh_lang';
export const DEFAULT_LANG: Lang = 'fr';
export type T = (fr: string, en: string) => string;

export function translator(lang: Lang): T {
  return (fr, en) => (lang === 'en' ? en : fr);
}

export function isLang(v: unknown): v is Lang {
  return v === 'fr' || v === 'en';
}

/** fr-CA / en-CA locale for numbers and dates. */
export function locale(lang: Lang) {
  return lang === 'en' ? 'en-CA' : 'fr-CA';
}
