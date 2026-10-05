import { cookies } from 'next/headers';
import { DEFAULT_LANG, isLang, LANG_COOKIE, translator, type Lang } from './index';

export async function getLang(): Promise<Lang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(v) ? v : DEFAULT_LANG;
}

export async function getT() {
  return translator(await getLang());
}
