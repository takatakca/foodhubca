'use client';

// Price shown BEFORE a merchant adds a brand or connects a platform store of an extra brand ("+15 $/mois pour cette
// plateforme"). Only merchants that installed TAKATAK Food Hub from the Clover App Market (not exempt) see it; for the
// first brand, or our own restaurants, nothing is shown and nothing is asked. Clover bills; nothing is charged here.
//   <ExtraBrandPriceNotice brandName=… channel=… merchantId=… />  inline line under a form
//   const check = useExtraBrandPriceConfirm(); if (!(await check({ brandName, channel, merchantId }))) return;
import { useCallback, useEffect, useState } from 'react';
import { Receipt } from 'lucide-react';
import { useConfirm } from '@/components/ui/confirm';
import { api } from '@/lib/ui/api';
import { cn } from '@/lib/ui/cn';
import { useI18n } from '@/lib/i18n/client';
import { formatCad, PRICING_STATEMENT } from '@/lib/foodhub/pos/clover-pricing';

export type PriceQuery = { brandName: string; channel?: string | null; merchantId?: string | null; storeId?: string | null };
export type Quote = {
  applies: boolean; reason: string; addedUnits: number; addedCad: number; unitsAfter: number; monthlyAfterCad: number;
  firstBrand: string | null; text: { fr: string; en: string } | null;
};

export function quoteUrl(q: PriceQuery): string {
  const p = new URLSearchParams({ brand: q.brandName.trim() });
  if (q.channel) p.set('channel', q.channel);
  if (q.merchantId?.trim()) p.set('merchant', q.merchantId.trim());
  if (q.storeId) p.set('store', q.storeId);
  return `/api/foodhub/clover-billing/quote?${p.toString()}`;
}

/** The quote, or null when it cannot be read (the form then works as before). */
export async function fetchQuote(q: PriceQuery): Promise<Quote | null> {
  if (!q.brandName.trim()) return null;
  try { return (await api<{ quote: Quote }>(quoteUrl(q))).quote; } catch { return null; }
}

/** One quote for several stores connected together (all added to the mappings at once on the server). */
export async function fetchStoresQuote(list: PriceQuery[]): Promise<Quote | null> {
  const stores = list.filter((q) => q.brandName.trim()).map((q) => ({ brandName: q.brandName.trim(), channel: q.channel ?? null, merchantId: q.merchantId?.trim() || null, storeId: q.storeId ?? null }));
  if (!stores.length) return null;
  try { return (await api<{ quote: Quote }>('/api/foodhub/clover-billing/quote', { method: 'POST', json: { stores } })).quote; } catch { return null; }
}

/** Inline price line, shown only when the brand or store is billed as an extra brand. */
export function ExtraBrandPriceNotice({ className, ...q }: PriceQuery & { className?: string }) {
  const { t, lang } = useI18n();
  const [quote, setQuote] = useState<Quote | null>(null);
  const { brandName, channel, merchantId, storeId } = q;
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => { void fetchQuote({ brandName, channel, merchantId, storeId }).then((r) => { if (live) setQuote(r); }); }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [brandName, channel, merchantId, storeId]);
  if (!quote?.applies || !quote.text) return null;
  return (
    <p className={cn('flex items-start gap-2 rounded-md bg-wait-soft px-3 py-2 text-[13px] text-ink', className)} role="status" data-testid="extra-brand-price">
      <Receipt className="mt-0.5 size-4 shrink-0 text-wait-2" aria-hidden />
      <span>
        <strong>{t(quote.text.fr, quote.text.en)}</strong>
        {quote.unitsAfter > 0 && <> · {t(`total des marques supplémentaires : ${formatCad(quote.monthlyAfterCad, 'fr')}/mois`, `extra brands total: ${formatCad(quote.monthlyAfterCad, 'en')}/month`)}</>}
        <span className="block text-ink-3">{lang === 'fr' ? PRICING_STATEMENT.fr : PRICING_STATEMENT.en}</span>
      </span>
    </p>
  );
}

/**
 * Ask before saving when the change adds a charge; resolves true at once when nothing is billed (or the price cannot
 * be read: Clover bills from the monthly count anyway). Several stores at once (Uber activation): one quote with all
 * of them added together, so a second new brand on a merchant with no brand yet is shown as extra, worded by brand
 * and platform ("+30 $/mois : 2 marques sur Uber Eats").
 */
export function useExtraBrandPriceConfirm() {
  const { t } = useI18n();
  const confirm = useConfirm();
  return useCallback(async (query: PriceQuery | PriceQuery[]): Promise<boolean> => {
    const list = (Array.isArray(query) ? query : [query]).filter((q) => q.brandName.trim());
    if (!list.length) return true;
    const quote = list.length === 1 && !list[0].channel ? await fetchQuote(list[0]) : await fetchStoresQuote(list);
    if (!quote?.applies || !quote.text) return true;
    const text = quote.text;
    const first = quote.firstBrand;
    return confirm({
      title: t('Marque supplémentaire facturée par Clover', 'Extra brand billed by Clover'),
      body: (
        <div className="space-y-2">
          <p><strong>{t(text.fr, text.en)}</strong></p>
          {first && <p>{t(`Votre première marque (${first}) est incluse dans le forfait.`, `Your first brand (${first}) is included in the plan.`)}</p>}
          <p className="text-[13px] text-ink-3">{t(PRICING_STATEMENT.fr, PRICING_STATEMENT.en)}</p>
        </div>
      ),
      confirmLabel: t('Confirmer', 'Confirm'),
    });
  }, [confirm, t]);
}
