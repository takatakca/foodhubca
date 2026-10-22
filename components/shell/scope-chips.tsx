'use client';

// Filter chips that edit the console's scope (one source of truth with the header picker): Succursale, Marque,
// Plateforme, then the page's own chips (`extra`). An active chip is dark with × to clear it; each list shows counts.
// From `sm` up a chip opens a dropdown; on a phone, a bottom sheet.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { BrandMark } from '@/components/ui/brand-mark';
import { PlatformMark } from '@/components/ui/badge';
import { Modal } from '@/components/ui/overlay';
import { usePulse } from '@/components/live/pulse';
import { shortLoc, useViewer } from './viewer';
import { storesText } from './scope-switcher';
import { useWide } from './use-wide';
import { channelCounts, channelName, countStores } from '@/lib/foodhub/scope';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

export type ChipOption = { key: string; label: string; note?: string; icon?: ReactNode; disabled?: boolean };

/** One chip with its list: "Marque : Toutes ▾", dark with × when something is picked. */
export function FilterChip({ label, value, options, onPick, onClear, allLabel }: {
  label: string; value: string | null; options: ChipOption[]; onPick: (key: string) => void; onClear: () => void; allLabel?: string;
}) {
  const { t } = useI18n();
  const wide = useWide();
  const [open, setOpen] = useState(false);
  const [right, setRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !wide) return;
    const c = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', c);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', c); document.removeEventListener('keydown', k); };
  }, [open, wide]);
  const toggle = () => {
    // Near the right edge of the screen, the list opens to the left so it stays inside the screen.
    const r = ref.current?.getBoundingClientRect();
    setRight(Boolean(r && r.left + 256 > window.innerWidth - 16));
    setOpen(!open);
  };
  const current = options.find((o) => o.key === value);
  const choose = (k: string) => { onPick(k); setOpen(false); };
  const list = (
    <div className="space-y-0.5">
      {/* Disclosure pattern: plain buttons in a labelled group, the picked one aria-pressed (not a listbox). */}
      <button type="button" onClick={() => { onClear(); setOpen(false); }} aria-pressed={!value} className={cn('flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold hover:bg-sunken', !value && 'bg-brand-soft')}>
        <span className="flex-1">{allLabel ?? t('Toutes', 'All')}</span>{!value && <Check aria-hidden className="size-4 text-brand" />}
      </button>
      {options.map((o) => (
        <button key={o.key} type="button" disabled={o.disabled} onClick={() => choose(o.key)} aria-pressed={value === o.key}
          className={cn('flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-40', value === o.key && 'bg-brand-soft')}>
          {o.icon}<span className="min-w-0 flex-1 truncate font-semibold">{o.label}</span>
          {o.note && <span className="shrink-0 text-xs text-ink-3">{o.note}</span>}
          {value === o.key && <Check aria-hidden className="size-4 shrink-0 text-brand" />}
        </button>
      ))}
    </div>
  );
  return (
    <div className="relative" ref={ref}>
      <span className={cn('flex h-11 items-center rounded-full border text-[13px] font-semibold sm:h-9', value ? 'border-ink bg-ink text-canvas' : 'border-line-2 bg-surface text-ink-2 hover:border-ink-4')}>
        <button type="button" onClick={toggle} aria-expanded={open} className="flex h-full items-center gap-1.5 pr-2 pl-3.5">
          <span className="whitespace-nowrap">{t(`${label} :`, `${label}:`)}</span><span className="max-w-36 truncate">{current?.label ?? value ?? allLabel ?? t('Toutes', 'All')}</span>
          {!value && <ChevronDown aria-hidden className="size-3.5 opacity-70" />}
        </button>
        {/* 44 px wide on a phone: it sits right next to the chip's own button. */}
        {value && <button type="button" onClick={onClear} aria-label={t(`Effacer : ${label}`, `Clear: ${label}`)} className="flex h-full min-w-11 items-center justify-center rounded-r-full pr-1.5 opacity-80 hover:opacity-100 sm:min-w-0 sm:justify-start sm:pr-3 sm:pl-1"><X className="size-4 sm:size-3.5" /></button>}
      </span>
      {open && (wide ? (
        <div className={cn('absolute top-11 z-40 max-h-80 w-[min(16rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-line bg-surface p-1.5 shadow-pop animate-rise', right ? 'right-0' : 'left-0')} role="group" aria-label={label}>{list}</div>
      ) : (
        <Modal title={label} onClose={() => setOpen(false)} className="max-h-[85dvh]"><div role="group" aria-label={label}>{list}</div></Modal>
      ))}
    </div>
  );
}

/**
 * Succursale · Marque · Plateforme chips (they change the header's scope), then `extra` (the page's own chips).
 * `extraActive` + `onClearExtra`: the page's chips count for "Tout effacer".
 */
export function ScopeChips({ extra, extraActive, onClearExtra, className }: { extra?: ReactNode; extraActive?: boolean; onClearExtra?: () => void; className?: string }) {
  const { t } = useI18n();
  const { viewer, locations, brands, brandsByKitchen, channels, stores } = useViewer();
  const { site, setSite } = usePulse();
  const tablet = Boolean(viewer.device);
  const counted = stores.length > 0;
  const brandList = site.kitchen ? brandsByKitchen[site.kitchen] ?? [] : brands;
  const anything = Boolean(site.kitchen && !tablet) || Boolean(site.brand) || Boolean(site.channel) || Boolean(extraActive);
  // With a platform picked, a location or a brand that has no store on it cannot be picked (it would drop the platform
  // without a word), like the platform options with 0 stores.
  const noneOnPlatform = (n: number) => Boolean(site.channel && counted && n === 0);
  return (
    <div className={cn('mb-4 flex flex-wrap items-center gap-2', className)}>
      {!tablet && locations.length > 1 && (
        <FilterChip label={t('Succursale', 'Location')} allLabel={t('Toutes', 'All')} value={site.kitchen} onClear={() => setSite({ kitchen: null })} onPick={(k) => setSite({ kitchen: k })}
          options={locations.map((l) => { const n = countStores({ stores }, { kitchen: l.code, brand: null, channel: site.channel }); return { key: l.code, label: shortLoc(l.name), note: counted ? storesText(t, n) : undefined, disabled: noneOnPlatform(n) }; })} />
      )}
      {brandList.length > 0 && (
        <FilterChip label={t('Marque', 'Brand')} allLabel={t('Toutes', 'All')} value={site.brand} onClear={() => setSite({ brand: null })} onPick={(b) => setSite({ brand: b })}
          options={brandList.map((b) => { const n = countStores({ stores }, { kitchen: site.kitchen, brand: b, channel: site.channel }); return { key: b, label: b, icon: <BrandMark name={b} size="xs" />, note: counted ? storesText(t, n) : undefined, disabled: noneOnPlatform(n) }; })} />
      )}
      {!tablet && channels.length > 1 && (
        <FilterChip label={t('Plateforme', 'Platform')} allLabel={t('Toutes', 'All')} value={site.channel ?? null} onClear={() => setSite({ channel: undefined })} onPick={(c) => setSite({ channel: c })}
          options={channelCounts({ stores, channels }, site).map((c) => ({ key: c.channel, label: channelName(c.channel), icon: <PlatformMark channel={c.channel} size="xs" />, note: storesText(t, c.count), disabled: c.count === 0 }))} />
      )}
      {extra}
      {anything && (
        <button type="button" onClick={() => { setSite(tablet ? { brand: null } : { kitchen: null, brand: null, channel: undefined }); onClearExtra?.(); }}
          className="flex h-11 items-center rounded-full px-3 text-[13px] font-semibold text-brand hover:bg-brand-soft sm:h-9">{t('Tout effacer', 'Clear all')}</button>
      )}
    </div>
  );
}
