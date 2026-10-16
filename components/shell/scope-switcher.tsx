'use client';

// The header's restaurant picker, like DoorDash Merchant's store picker: every restaurant → a location → one brand, and
// one platform on top (Uber Eats, DoorDash, Skip, Too Good To Go) with its number of stores. One tap on a location shows
// that location; the arrow opens its brands; one tap on a brand shows that brand alone. A platform chip keeps the
// location and the brand. On a phone the picker opens as a bottom sheet.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, MapPin, RotateCcw, Search, Store } from 'lucide-react';
import { BrandMark } from '@/components/ui/brand-mark';
import { PlatformMark } from '@/components/ui/badge';
import { Modal } from '@/components/ui/overlay';
import { usePulse } from '@/components/live/pulse';
import { shortLoc, useViewer } from './viewer';
import { useWide } from './use-wide';
import { channelCounts, channelName, countStores, isAllRestaurants, isEverything, sameScope, type Scope } from '@/lib/foodhub/scope';
import { useI18n } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n';
import { cn } from '@/lib/ui/cn';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const storesText = (t: T, n: number) => t(`${n} magasin${n > 1 ? 's' : ''}`, `${n} store${n > 1 ? 's' : ''}`);
export const brandsText = (t: T, n: number) => t(`${n} marque${n > 1 ? 's' : ''}`, `${n} brand${n > 1 ? 's' : ''}`);
export const locationsText = (t: T, n: number) => t(`${n} succursale${n > 1 ? 's' : ''}`, `${n} location${n > 1 ? 's' : ''}`);

function Row({ on, onClick, children, indent, disabled }: { on: boolean; onClick: () => void; children: ReactNode; indent?: boolean; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-current={on ? 'true' : undefined}
      className={cn('flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-sunken disabled:opacity-50', on && 'bg-brand-soft hover:bg-brand-soft', indent && 'pl-11')}>
      {children}
      {on && <Check className="ml-auto size-4 shrink-0 text-brand" />}
    </button>
  );
}

const Heading = ({ children }: { children: ReactNode }) => <div className="px-3 pt-3 pb-1 text-[11px] font-bold tracking-[0.12em] text-ink-3 uppercase">{children}</div>;

/**
 * The scope in words. `title`: "Tous les restaurants", a location or a brand. `sub`: the rest ("3 succursales · 45
 * magasins", "12 marques · 36 magasins", "Succursale 1 · DoorDash"). `words`: both on one line, for page headers.
 */
export function useScopeLabel(): { title: string; sub: string; words: string } {
  const { t } = useI18n();
  const { site } = usePulse();
  const { locations, brands, brandsByKitchen, locName, allLocations, stores } = useViewer();
  const ch = site.channel ? channelName(site.channel) : null;
  const counted = stores.length > 0;
  const n = countStores({ stores }, site);
  let title: string;
  let sub: string;
  if (site.brand) {
    title = site.brand;
    sub = [site.kitchen ? shortLoc(locName(site.kitchen)) : t('Toutes les succursales', 'Every location'), ch].filter(Boolean).join(' · ');
  } else if (site.kitchen) {
    title = shortLoc(locName(site.kitchen));
    sub = [ch, brandsText(t, (brandsByKitchen[site.kitchen] ?? []).length), counted ? storesText(t, n) : null].filter(Boolean).join(' · ');
  } else {
    title = allLocations ? t('Tous les restaurants', 'All restaurants') : t('Mes restaurants', 'My restaurants');
    sub = [ch, locationsText(t, locations.length), counted ? storesText(t, n) : brandsText(t, brands.length)].filter(Boolean).join(' · ');
  }
  return { title, sub, words: sub ? `${title} · ${sub}` : title };
}

export function ScopeSwitcher() {
  const { viewer } = useViewer();
  const { site } = usePulse();
  const label = useScopeLabel();
  const wide = useWide();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const locked = Boolean(viewer.device);
  const { t } = useI18n();

  useEffect(() => {
    if (!open || !wide) return;
    const click = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key); };
  }, [open, wide]);

  const button = (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand sm:flex">
        {site.channel && !site.brand ? <PlatformMark channel={site.channel} size="md" className="size-9" /> : site.brand ? <BrandMark name={site.brand} size="sm" className="size-9" /> : <Store className="size-[18px]" />}
      </span>
      <span className="min-w-0 text-left leading-tight">
        <span className="block max-w-[52vw] truncate text-[14px] font-extrabold text-ink sm:max-w-[16rem]">{label.title}</span>
        <span className="block max-w-[52vw] truncate text-[12px] font-medium text-ink-3 sm:max-w-[16rem]">{label.sub}</span>
      </span>
    </span>
  );

  if (locked) return <div className="flex h-12 min-w-0 items-center rounded-lg px-1.5">{button}</div>;

  return (
    <div className="relative min-w-0" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog"
        className={cn('flex h-12 min-w-0 items-center gap-2 rounded-lg border border-transparent px-1.5 pr-2 hover:border-line hover:bg-surface', open && 'border-line bg-surface')}>
        {button}<ChevronDown className={cn('size-4 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (wide ? (
        <div role="dialog" aria-modal="true" aria-label={t('Choisir un restaurant', 'Choose a restaurant')}
          className="absolute top-14 left-0 z-50 flex max-h-[min(72vh,600px)] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop animate-rise">
          <ScopePanel onDone={() => setOpen(false)} />
        </div>
      ) : (
        <Modal title={t('Choisir un restaurant', 'Choose a restaurant')} onClose={() => setOpen(false)} className="max-h-[85dvh]">
          <div className="-mx-5 -my-4 flex flex-col"><ScopePanel onDone={() => setOpen(false)} /></div>
        </Modal>
      ))}
    </div>
  );
}

function ScopePanel({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { locations, brandsByKitchen, brands, channels, stores } = useViewer();
  const { site, setSite } = usePulse();
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(() => site.kitchen ?? null);
  const input = useRef<HTMLInputElement>(null);
  const wide = useWide();
  useEffect(() => { if (wide) input.current?.focus({ preventScroll: true }); }, [wide]);
  const counted = stores.length > 0;
  const count = (s: Scope) => countStores({ stores }, s);
  const ch = site.channel;
  // Pick a location / a brand: keeps the platform, closes the picker.
  const pick = (patch: Pick<Scope, 'kitchen' | 'brand'>) => { setSite(patch); onDone(); };
  const single = locations.length === 1 ? locations[0] : null;

  const results = useMemo(() => {
    const s = fold(q.trim());
    if (!s) return null;
    const kitchens = locations.filter((l) => fold(`${l.name} ${l.address ?? ''}`).includes(s));
    const pairs = locations.flatMap((l) => (brandsByKitchen[l.code] ?? []).filter((b) => fold(b).includes(s)).map((b) => ({ kitchen: l.code, brand: b })));
    const everywhere = brands.filter((b) => fold(b).includes(s) && locations.length > 1);
    const platforms = channels.filter((c) => fold(`${channelName(c)} ${c}`).includes(s));
    return { kitchens, pairs, everywhere, platforms };
  }, [q, locations, brandsByKitchen, brands, channels]);

  const chips = channelCounts({ stores, channels }, site);
  const total = chips.reduce((a, c) => a + c.count, 0);
  const brandRow = (kitchen: string | null, b: string, indent?: boolean) => {
    const n = count({ kitchen, brand: b, channel: ch });
    return (
      <Row key={`${kitchen}|${b}`} indent={indent} on={sameScope(site, { kitchen, brand: b, ...(ch ? { channel: ch } : {}) })} onClick={() => pick({ kitchen, brand: b })}>
        <BrandMark name={b} size="xs" /><span className="min-w-0 flex-1 truncate font-semibold">{b}</span>
        {counted && <span className="shrink-0 text-xs text-ink-3">{storesText(t, n)}</span>}
      </Row>
    );
  };

  return (
    <>
      <div className="border-b border-line p-2">
        <label className="flex h-11 items-center gap-2 rounded-lg bg-sunken px-3 text-sm">
          <Search className="size-4 text-ink-3" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Chercher une succursale, une marque ou une plateforme', 'Search a location, a brand or a platform')} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3" />
        </label>
      </div>
      {!results && channels.length >= 2 && (
        <div className="border-b border-line px-2 py-2.5">
          <div className="mb-1.5 px-1 text-[11px] font-bold tracking-[0.12em] text-ink-3 uppercase">{t('Plateforme', 'Platform')}</div>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label={t('Plateforme', 'Platform')}>
            <PlatformChip on={!ch} onClick={() => setSite({ channel: undefined })}>{t('Toutes', 'All')}{counted && <span className="num opacity-70">({total})</span>}</PlatformChip>
            {chips.map((c) => (
              <PlatformChip key={c.channel} on={ch === c.channel} disabled={c.count === 0} onClick={() => setSite({ channel: c.channel })}>
                <PlatformMark channel={c.channel} size="xs" />{channelName(c.channel)}<span className="num opacity-70">({c.count})</span>
              </PlatformChip>
            ))}
          </div>
        </div>
      )}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5">
        {!results && <>
          <Row on={isAllRestaurants(site)} onClick={() => pick({ kitchen: null, brand: null })}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-rail text-electric"><Store className="size-4" /></span>
            <span className="min-w-0 flex-1"><span className="block font-bold">{t('Tous les restaurants', 'All restaurants')}</span>{counted && <span className="block text-xs text-ink-3">{storesText(t, count({ kitchen: null, brand: null, channel: ch }))}</span>}</span>
          </Row>
          {single ? <>
            <Heading>{t('Marques', 'Brands')} · {shortLoc(single.name)}</Heading>
            {(brandsByKitchen[single.code] ?? []).map((b) => brandRow(single.code, b))}
          </> : <>
            <Heading>{t('Succursales', 'Locations')}</Heading>
            {locations.map((l) => {
              const list = brandsByKitchen[l.code] ?? [];
              const isOpen = expanded === l.code;
              return (
                <div key={l.code}>
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <Row on={sameScope(site, { kitchen: l.code, brand: null, ...(ch ? { channel: ch } : {}) })} onClick={() => pick({ kitchen: l.code, brand: null })}>
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken text-ink-2"><MapPin className="size-4" /></span>
                        <span className="min-w-0"><span className="block truncate font-bold">{shortLoc(l.name)}</span><span className="block truncate text-xs text-ink-3">{[brandsText(t, list.length), counted ? storesText(t, count({ kitchen: l.code, brand: null, channel: ch })) : l.address].filter(Boolean).join(' · ')}</span></span>
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
                  {isOpen && list.map((b) => brandRow(l.code, b, true))}
                </div>
              );
            })}
          </>}
        </>}
        {results && <>
          {results.platforms.length > 0 && <Heading>{t('Plateformes', 'Platforms')}</Heading>}
          {results.platforms.map((c) => (
            <Row key={`ch|${c}`} on={ch === c} onClick={() => { setSite({ channel: c }); onDone(); }}>
              <PlatformMark channel={c} size="xs" /><span className="font-semibold">{channelName(c)}</span>
            </Row>
          ))}
          {results.kitchens.length > 0 && <Heading>{t('Succursales', 'Locations')}</Heading>}
          {results.kitchens.map((l) => (
            <Row key={l.code} on={sameScope(site, { kitchen: l.code, brand: null, ...(ch ? { channel: ch } : {}) })} onClick={() => pick({ kitchen: l.code, brand: null })}>
              <MapPin className="size-4 text-ink-3" /><span className="font-bold">{shortLoc(l.name)}</span><span className="truncate text-xs text-ink-3">{l.address}</span>
            </Row>
          ))}
          {(results.pairs.length > 0 || results.everywhere.length > 0) && <Heading>{t('Marques', 'Brands')}</Heading>}
          {results.pairs.map((p) => (
            <Row key={`${p.kitchen}|${p.brand}`} on={sameScope(site, { ...p, ...(ch ? { channel: ch } : {}) })} onClick={() => pick(p)}>
              <BrandMark name={p.brand} size="xs" /><span className="truncate font-semibold">{p.brand}</span><span className="truncate text-xs text-ink-3">{shortLoc(locations.find((l) => l.code === p.kitchen)?.name ?? p.kitchen)}</span>
            </Row>
          ))}
          {results.everywhere.map((b) => (
            <Row key={`*|${b}`} on={sameScope(site, { kitchen: null, brand: b, ...(ch ? { channel: ch } : {}) })} onClick={() => pick({ kitchen: null, brand: b })}>
              <BrandMark name={b} size="xs" /><span className="truncate font-semibold">{b}</span><span className="truncate text-xs text-ink-3">{t('toutes les succursales', 'every location')}</span>
            </Row>
          ))}
          {!results.kitchens.length && !results.pairs.length && !results.everywhere.length && !results.platforms.length && <div className="px-3 py-6 text-center text-sm text-ink-3">{t('Aucune succursale, marque ni plateforme à ce nom.', 'No location, brand or platform by that name.')}</div>}
        </>}
      </div>
      {!isEverything(site) && (
        <div className="border-t border-line p-1.5">
          <button type="button" onClick={() => { setSite({ kitchen: null, brand: null, channel: undefined }); onDone(); }} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-brand hover:bg-brand-soft">
            <RotateCcw className="size-4" />{t('Tout réinitialiser', 'Reset everything')}
          </button>
        </div>
      )}
    </>
  );
}

function PlatformChip({ on, disabled, onClick, children }: { on: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on}
      className={cn('flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40', on ? 'border-ink bg-ink text-canvas' : 'border-line-2 bg-surface text-ink-2 hover:border-ink-4')}>
      {children}
    </button>
  );
}
