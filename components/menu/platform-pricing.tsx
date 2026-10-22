'use client';

import { useId, useState } from 'react';
import { ChevronDown, Tags } from 'lucide-react';
import { PlatformMark } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { useI18n } from '@/lib/i18n/client';
import type { MasterMenu } from '@/lib/foodhub/types';
import { UBER_TAX_CLASSES, type UberTaxClass } from '@/lib/foodhub/menu/uber-tax';
import { cn } from '@/lib/ui/cn';

type Channel = 'uber_eats' | 'doordash' | 'skip';
const CHANNELS: Array<[Channel, string]> = [['uber_eats', 'Uber Eats'], ['doordash', 'DoorDash'], ['skip', 'Skip']];

/** "+20 %", "−5 %" or "—" (no markup) in the console's number format. */
export function pctText(v: number | undefined, loc: string) {
  if (v === undefined || v === 0) return '—';
  const n = new Intl.NumberFormat(loc, { maximumFractionDigits: 1 }).format(Math.abs(v));
  return `${v > 0 ? '+' : '−'}${n}${loc.startsWith('fr') ? ' ' : ''}%`;
}

/** The one-line summary on the closed card: "Uber Eats +20 % · DoorDash — · Skip +10 %". */
export function pricingSummary(markup: Partial<Record<string, number>> | undefined, loc: string) {
  return CHANNELS.map(([k, l]) => `${l} ${pctText(markup?.[k], loc)}`).join(' · ');
}

/**
 * "Prix par plateforme" (A2 Menus): the per-platform markups, the Uber tax category and the DoorDash pickup price,
 * folded into one card with labelled rows instead of four bare number fields in the toolbar. Closed, it reads as one
 * line; open, one row per platform.
 */
export function PlatformPricing({ menu, onChange, disabled }: { menu: MasterMenu; onChange: (fn: (m: MasterMenu) => MasterMenu) => void; disabled?: boolean }) {
  const { t, lang, loc } = useI18n();
  const [open, setOpen] = useState(false);
  const panel = useId();
  const setMarkup = (k: Channel, raw: string) => onChange((m) => {
    const next = { ...(m.channelMarkupPct || {}) } as Record<string, number>;
    if (raw === '' || Number(raw) === 0) delete next[k]; else next[k] = Number(raw);
    return { ...m, channelMarkupPct: next };
  });
  const row = 'grid grid-cols-1 items-center gap-3 px-5 py-3 sm:grid-cols-[180px_1fr]';
  const pct = (label: string, value: number | undefined | '', on: (raw: string) => void, placeholder = '0') => (
    <label className="text-small flex items-center gap-2 font-semibold text-ink-2">
      <span className="min-w-28">{label}</span>
      <span className="flex items-center gap-1.5">
        <Input type="number" inputMode="decimal" step="1" min="-50" max="200" placeholder={placeholder} className="num w-24 text-right" disabled={disabled} value={value ?? ''} onChange={(e) => on(e.target.value)} />
        <span className="text-ink-3" aria-hidden>%</span>
      </span>
    </label>
  );
  return (
    <Card className="mb-4">
      <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)}
        className="flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-5 py-3 text-left hover:bg-raised">
        <Tags className="size-5 shrink-0 text-ink-3" aria-hidden />
        <span className="text-heading text-ink">{t('Prix par plateforme', 'Price per platform')}</span>
        <span className="text-small num min-w-0 flex-1 text-ink-3">{pricingSummary(menu.channelMarkupPct, loc)}</span>
        <ChevronDown className={cn('size-5 shrink-0 text-ink-3 transition-transform duration-(--duration-fast)', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div id={panel} className="border-t border-line">
          <p className="text-small px-5 pt-3 text-ink-3">{t('Ajouté à chaque prix (articles et options) sur la plateforme. Le prix de base reste le prix en magasin (Clover). Un prix fixé par article a priorité.', 'Added to every price (items and options) on that platform. The base price stays the in-store (Clover) price. A per-item price always wins.')}</p>
          <div className="divide-y divide-line">
            {CHANNELS.map(([k, l]) => (
              <div key={k} className={row}>
                <span className="text-body flex items-center gap-2 font-semibold text-ink"><PlatformMark channel={k} size="sm" />{l}</span>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  {pct(t('Majoration', 'Markup'), menu.channelMarkupPct?.[k], (raw) => setMarkup(k, raw))}
                  {k === 'uber_eats' && (
                    <label className="text-small flex items-center gap-2 font-semibold text-ink-2" title={t('Vide = rien envoyé : la configuration de taxes du magasin Uber s’applique.', 'Empty = nothing sent: the Uber store tax setup applies.')}>
                      <span className="min-w-28">{t('Catégorie de taxe', 'Tax category')}</span>
                      <Select className="w-56" disabled={disabled} value={menu.uberTaxClass ?? ''} onChange={(e) => onChange((m) => ({ ...m, uberTaxClass: e.target.value || undefined }))}>
                        <option value="">{t('Celle du magasin Uber', 'The Uber store’s')}</option>
                        {(Object.keys(UBER_TAX_CLASSES) as UberTaxClass[]).map((c) => <option key={c} value={c}>{lang === 'fr' ? UBER_TAX_CLASSES[c].fr : UBER_TAX_CLASSES[c].en}</option>)}
                      </Select>
                    </label>
                  )}
                  {/* DoorDash dual pricing: base_price = pickup price. Empty = same as delivery; 0 = in-store price. */}
                  {k === 'doordash' && pct(t('Pour emporter', 'Pickup'), menu.pickupMarkupPct?.doordash ?? '', (raw) => onChange((m) => {
                    const next = { ...(m.pickupMarkupPct || {}) };
                    if (raw === '') delete next.doordash; else next.doordash = Number(raw);
                    return { ...m, pickupMarkupPct: next };
                  }), '—')}
                </div>
              </div>
            ))}
          </div>
          <p className="text-small px-5 pb-4 text-ink-3">{t('DoorDash pour emporter : vide = même prix que la livraison, 0 = prix en magasin.', 'DoorDash pickup: empty = same price as delivery, 0 = in-store price.')}</p>
        </div>
      )}
    </Card>
  );
}
