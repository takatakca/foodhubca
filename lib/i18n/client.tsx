'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { LANG_COOKIE, locale, translator, type Lang, type T } from './index';

type Ctx = { lang: Lang; t: T; setLang: (l: Lang) => void; loc: string };
const I18n = createContext<Ctx>({ lang: 'fr', t: translator('fr'), setLang: () => undefined, loc: 'fr-CA' });

export function I18nProvider({ lang: initial, children }: { lang: Lang; children: ReactNode }) {
  const [lang, set] = useState<Lang>(initial);
  const setLang = useCallback((l: Lang) => {
    set(l);
    document.cookie = `${LANG_COOKIE}=${l}; Path=/; Max-Age=${365 * 86400}; SameSite=Lax`;
    document.documentElement.lang = l === 'fr' ? 'fr-CA' : 'en-CA';
  }, []);
  const value = useMemo(() => ({ lang, t: translator(lang), setLang, loc: locale(lang) }), [lang, setLang]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export function useI18n() {
  return useContext(I18n);
}

export function useT(): T {
  return useContext(I18n).t;
}
