'use client';

// The header's restaurant picker, like DoorDash Merchant's store picker: every restaurant → a kitchen → one brand.
// One tap on a kitchen shows that kitchen; the arrow opens its brands; one tap on a brand shows that brand alone.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, MapPin, Search, Store } from 'lucide-react';
import { BrandMark } from '@/components/ui/brand-mark';
import { usePulse } from '@/components/live/pulse';
import { shortLoc, useViewer } from './viewer';
import { ALL_RESTAURANTS, isAllRestaurants, sameScope, type Scope } from '@/lib/foodhub/scope';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function Row({ on, onClick, children, indent }: { on: boolean; onClick: () => void; children: ReactNode; indent?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-current={on ? 'true' : undefined}
      className={cn('flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-sunken', on && 'bg-brand-soft hover:bg-brand-soft', indent && 'pl-11')}>
      {children}
      {on && <Check className="ml-auto size-4 shrink-0 text-brand" />}
    </button>
  );
}

/** "Po Poulet · NDG MAIN", "NDG MAIN", "Tous les restaurants": the scope in words. */
export function useScopeLabel(): { title: string; sub: string } {
  const { t } = useI18n();
  const { site } = usePulse();
  const { locations, brands, locName, allLocations } = useViewer();
  if (site.brand) return { title: site.brand, sub: site.kitchen ? shortLoc(locName(site.kitchen)) : t('Toutes les cuisines', 'Every kitchen') };
  if (site.kitchen) return { title: shortLoc(locName(site.kitchen)), sub: locations.find((l) => l.code === site.kitchen)?.address ?? '' };
  return {
    title: allLocations ? t('Tous les restaurants', 'All restaurants') : t('Mes restaurants', 'My restaurants'),
    sub: t(`${locations.length} cuisine${locations.length > 1 ? 's' : ''} · ${brands.length} marques`, `${locations.length} kitchen${locations.length > 1 ? 's' : ''} · ${brands.length} brands`),
  };
}

export function ScopeSwitcher() {
  const { t } = useI18n();
  const { viewer, locations, brandsByKitchen, brands } = useViewer();
  const { site, setSite } = usePulse();
  const label = useScopeLabel();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const locked = Boolean(viewer.device);

  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key); };
  }, [open]);

  const toggle = () => {
    if (!open) { setQ(''); setExpanded(site.kitchen ?? (locations.length === 1 ? locations[0].code : null)); }
    setOpen(!open);
  };
  useEffect(() => { if (open) input.current?.focus({ preventScroll: true }); }, [open]);
  const pick = (s: Scope) => { setSite(s); setOpen(false); };

  const results = useMemo(() => {
    const s = fold(q.trim());
    if (!s) return null;
    const kitchens = locations.filter((l) => fold(`${l.name} ${l.address ?? ''}`).includes(s));
    const pairs = locations.flatMap((l) => (brandsByKitchen[l.code] ?? []).filter((b) => fold(b).includes(s)).map((b) => ({ kitchen: l.code, brand: b })));
    const everywhere = brands.filter((b) => fold(b).includes(s) && locations.length > 1);
    return { kitchens, pairs, everywhere };
  }, [q, locations, brandsByKitchen, brands]);

  const button = (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand sm:flex">{site.brand ? <BrandMark name={site.brand} size="sm" className="size-9" /> : <Store className="size-[18px]" />}</span>
      <span className="min-w-0 text-left leading-tight">
        <span className="block max-w-[34vw] truncate text-[14px] font-extrabold text-ink sm:max-w-[16rem]">{label.title}</span>
        <span className="block max-w-[34vw] truncate text-[12px] font-medium text-ink-3 sm:max-w-[16rem]">{label.sub}</span>
      </span>
    </span>
  );

  if (locked) return <div className="flex h-12 items-center rounded-lg px-1.5">{button}</div>;

  return (
    <div className="relative min-w-0" ref={ref}>
      <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="dialog"
        className={cn('flex h-12 min-w-0 items-center gap-2 rounded-lg border border-transparent px-1.5 pr-2 hover:border-line hover:bg-surface', open && 'border-line bg-surface')}>
        {button}<ChevronDown className={cn('size-4 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={t('Choisir un restaurant', 'Choose a restaurant')}
          className="absolute top-14 left-0 z-50 flex max-h-[min(70vh,560px)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop animate-rise">
          <div className="border-b border-line p-2">
            <label className="flex h-10 items-center gap-2 rounded-lg bg-sunken px-3 text-sm">
              <Search className="size-4 text-ink-3" />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Chercher une cuisine ou une marque', 'Search a kitchen or a brand')} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3" />
            </label>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto p-1.5">
            {!results && <>
              <Row on={isAllRestaurants(site)} onClick={() => pick(ALL_RESTAURANTS)}>
                <span className="flex size-8 items-center justify-center rounded-md bg-rail text-electric"><Store className="size-4" /></span>
                <span className="font-bold">{t('Tous les restaurants', 'All restaurants')}</span>
              </Row>
              <div className="px-3 pt-3 pb-1 text-[11px] font-bold tracking-[0.12em] text-ink-3 uppercase">{t('Cuisines', 'Kitchens')}</div>
              {locations.map((l) => {
                const list = brandsByKitchen[l.code] ?? [];
                const isOpen = expanded === l.code;
                return (
                  <div key={l.code}>
                    <div className="flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <Row on={sameScope(site, { kitchen: l.code, brand: null })} onClick={() => pick({ kitchen: l.code, brand: null })}>
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken text-ink-2"><MapPin className="size-4" /></span>
                          <span className="min-w-0"><span className="block truncate font-bold">{shortLoc(l.name)}</span><span className="block truncate text-xs text-ink-3">{l.address}{list.length ? ` · ${list.length} ${t('marques', 'brands')}` : ''}</span></span>
                        </Row>
                      </div>
                      {list.length > 0 && (
                        <button type="button" onClick={() => setExpanded(isOpen ? null : l.code)} aria-expanded={isOpen}
                          aria-label={isOpen ? t('Cacher les marques', 'Hide brands') : t('Voir les marques', 'Show brands')}
                          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink">
                          <ChevronRight className={cn('size-4 transition-transform', isOpen && 'rotate-90')} />
                        </button>
                      )}
                    </div>
                    {isOpen && list.map((b) => (
                      <Row key={b} indent on={sameScope(site, { kitchen: l.code, brand: b })} onClick={() => pick({ kitchen: l.code, brand: b })}>
                        <BrandMark name={b} size="xs" /><span className="truncate font-semibold">{b}</span>
                      </Row>
                    ))}
                  </div>
                );
              })}
            </>}
            {results && <>
              {results.kitchens.map((l) => (
                <Row key={l.code} on={sameScope(site, { kitchen: l.code, brand: null })} onClick={() => pick({ kitchen: l.code, brand: null })}>
                  <MapPin className="size-4 text-ink-3" /><span className="font-bold">{shortLoc(l.name)}</span><span className="truncate text-xs text-ink-3">{l.address}</span>
                </Row>
              ))}
              {results.pairs.map((p) => (
                <Row key={`${p.kitchen}|${p.brand}`} on={sameScope(site, p)} onClick={() => pick(p)}>
                  <BrandMark name={p.brand} size="xs" /><span className="truncate font-semibold">{p.brand}</span><span className="truncate text-xs text-ink-3">{shortLoc(locations.find((l) => l.code === p.kitchen)?.name ?? p.kitchen)}</span>
                </Row>
              ))}
              {results.everywhere.map((b) => (
                <Row key={`*|${b}`} on={sameScope(site, { kitchen: null, brand: b })} onClick={() => pick({ kitchen: null, brand: b })}>
                  <BrandMark name={b} size="xs" /><span className="truncate font-semibold">{b}</span><span className="truncate text-xs text-ink-3">{t('toutes les cuisines', 'every kitchen')}</span>
                </Row>
              ))}
              {!results.kitchens.length && !results.pairs.length && !results.everywhere.length && <div className="px-3 py-6 text-center text-sm text-ink-3">{t('Aucune cuisine ni marque à ce nom.', 'No kitchen or brand by that name.')}</div>}
            </>}
          </div>
        </div>
      )}
    </div>
  );
}
