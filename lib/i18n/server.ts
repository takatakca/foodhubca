import { cookies, headers } from 'next/headers';
import { PUBLIC_LANG_HEADER } from '../foodhub/public-site';
import { DEFAULT_LANG, isLang, LANG_COOKIE, translator, type Lang } from './index';

export async function getLang(): Promise<Lang> {
  // The public ON2GO Hub pages fix their language by path (/hub = French, /en/hub = English): proxy.ts sets this
  // header for them, whatever the visitor's language cookie. It only ever picks a language.
  const fixed = (await headers()).get(PUBLIC_LANG_HEADER);
  if (isLang(fixed)) return fixed;
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(v) ? v : DEFAULT_LANG;
}

export async function getT() {
  return translator(await getLang());
}
