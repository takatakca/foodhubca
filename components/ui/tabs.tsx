'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/ui/cn';
import { nextTabIndex } from '@/lib/ui/tab-keyboard';
import { useScopeHref } from '@/components/live/pulse';

/**
 * A horizontal strip that may overflow (A4 #4): it fades the side that hides more, and brings the active item into
 * view when it changes. Returns the ref for the scrolling element and the fade state to put on it.
 */
function useStrip(activeKey: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<'none' | 'start' | 'end' | 'both'>('none');
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft > 4;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setFade(start && end ? 'both' : start ? 'start' : end ? 'end' : 'none');
  }, []);
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [measure]);
  useEffect(() => {
    const active = ref.current?.querySelector<HTMLElement>('[aria-selected="true"],[aria-current="page"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    measure();
  }, [activeKey, measure]);
  return { ref, fade, onScroll: measure };
}

const TAB = 'relative -mb-px flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-body font-semibold whitespace-nowrap transition-colors duration-(--duration-fast)';
const TAB_ON = 'border-ink text-ink';
const TAB_OFF = 'border-transparent text-ink-3 hover:text-ink';

export function Tabs<K extends string>({ tabs, value, onChange, className, label }: { tabs: Array<{ key: K; label: ReactNode; count?: number | null }>; value: K; onChange: (k: K) => void; className?: string; label?: string }) {
  const strip = useStrip(value);
  return (
    <div ref={strip.ref} onScroll={strip.onScroll} data-fade={strip.fade} role="tablist" aria-label={label} className={cn('no-scrollbar fade-x flex gap-1 overflow-x-auto border-b border-line', className)}>
      {tabs.map((t, i) => (
        <button key={t.key} role="tab" type="button" aria-selected={value === t.key} tabIndex={value === t.key ? 0 : -1}
          onKeyDown={(event) => {
            const next = nextTabIndex(i, tabs.length, event.key);
            if (next === null) return;
            event.preventDefault();
            onChange(tabs[next].key);
            const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
            buttons?.[next]?.focus();
          }} onClick={() => onChange(t.key)}
          className={cn(TAB, value === t.key ? TAB_ON : TAB_OFF)}>
          {t.label}
          {t.count !== undefined && t.count !== null && <span className={cn('num text-micro rounded-full px-1.5 py-px font-bold', value === t.key ? 'bg-ink text-canvas' : 'bg-sunken text-ink-3')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Page sections as links. More than five on a phone become a native select (one row, nothing clipped); the strip keeps
 * the fade and scrolls the current section into view on wider screens.
 */
export function LinkTabs({ tabs, className, label, selectBelow = 5 }: { tabs: Array<{ href: string; label: ReactNode; exact?: boolean }>; className?: string; label?: string; selectBelow?: number }) {
  const path = usePathname();
  const router = useRouter();
  const href = useScopeHref();
  const isOn = (t: { href: string; exact?: boolean }) => (t.exact ? path === t.href : path === t.href || path.startsWith(`${t.href}/`));
  const current = tabs.find(isOn)?.href ?? '';
  const strip = useStrip(current);
  const asSelect = tabs.length > selectBelow;
  return (
    <nav className={cn('mb-6', className)} aria-label={label}>
      {asSelect && (
        <div className="relative md:hidden">
          <select value={current} onChange={(e) => router.push(href(e.target.value))} aria-label={label}
            className="text-body h-11 w-full appearance-none rounded-md border border-line-2 bg-surface pr-10 pl-4 font-semibold text-ink">
            {tabs.map((t) => <option key={t.href} value={t.href}>{typeof t.label === 'string' ? t.label : t.href}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        </div>
      )}
      <div ref={strip.ref} onScroll={strip.onScroll} data-fade={strip.fade} className={cn('no-scrollbar fade-x flex gap-1 overflow-x-auto border-b border-line', asSelect ? 'hidden md:flex' : 'flex')}>
        {tabs.map((t) => {
          const on = isOn(t);
          return (
            <Link key={t.href} href={href(t.href)} aria-current={on ? 'page' : undefined} className={cn(TAB, on ? TAB_ON : TAB_OFF)}>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** A filter with two to five options (view, period, status): a pill group, never a third level of navigation. */
export function Segmented<K extends string>({ options, value, onChange, className, size = 'md', label }: { options: Array<{ key: K; label: ReactNode }>; value: K; onChange: (k: K) => void; className?: string; size?: 'sm' | 'md'; label?: string }) {
  return (
    <div className={cn('inline-flex max-w-full rounded-md bg-sunken p-0.5', className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)}
          className={cn('text-small touch-target rounded-[9px] font-semibold whitespace-nowrap transition-colors duration-(--duration-fast)', size === 'sm' ? 'h-8 px-2.5' : 'h-9 px-3', value === o.key ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
