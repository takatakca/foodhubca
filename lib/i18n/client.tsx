'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { productInfo, type ProductInfo } from '../foodhub/product';
import { LANG_COOKIE, locale, translator, type Lang, type T } from './index';

type Ctx = { lang: Lang; t: T; setLang: (l: Lang) => void; loc: string; product: ProductInfo };
const DEFAULT_PRODUCT = productInfo(null);
const I18n = createContext<Ctx>({ lang: 'fr', t: translator('fr'), setLang: () => undefined, loc: 'fr-CA', product: DEFAULT_PRODUCT });

/** `product` comes from the server (FOODHUB_PRODUCT_NAME, read at request time in the root layout). */
export function I18nProvider({ lang: initial, product = DEFAULT_PRODUCT, children }: { lang: Lang; product?: ProductInfo; children: ReactNode }) {
  const [lang, set] = useState<Lang>(initial);
  const setLang = useCallback((l: Lang) => {
    set(l);
    document.cookie = `${LANG_COOKIE}=${l}; Path=/; Max-Age=${365 * 86400}; SameSite=Lax`;
    document.documentElement.lang = l === 'fr' ? 'fr-CA' : 'en-CA';
  }, []);
  const value = useMemo(() => ({ lang, t: translator(lang, product), setLang, loc: locale(lang), product }), [lang, setLang, product]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

/**
 * Keeps the original names inside (the Clover App Market welcome page must match the Clover listing, "TAKATAK Food Hub",
 * whatever the console is called).
 */
export function KeepProductNames({ children }: { children: ReactNode }) {
  const ctx = useContext(I18n);
  const value = useMemo(() => ({ ...ctx, t: translator(ctx.lang), product: DEFAULT_PRODUCT }), [ctx]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

/** The product's name on screen ("Food Hub" by default, "ON2GO Hub" once the owner flips FOODHUB_PRODUCT_NAME). */
export function useProduct(): ProductInfo {
  return useContext(I18n).product;
}

export function useI18n() {
  return useContext(I18n);
}

export function useT(): T {
  return useContext(I18n).t;
}
