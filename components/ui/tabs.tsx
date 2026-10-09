'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/ui/cn';
import { useScopeHref } from '@/components/live/pulse';

export function Tabs<K extends string>({ tabs, value, onChange, className }: { tabs: Array<{ key: K; label: ReactNode; count?: number | null }>; value: K; onChange: (k: K) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('no-scrollbar flex gap-1 overflow-x-auto border-b border-line', className)}>
      {tabs.map((t) => (
        <button key={t.key} role="tab" type="button" aria-selected={value === t.key} onClick={() => onChange(t.key)}
          className={cn('relative -mb-px flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-semibold whitespace-nowrap transition-colors',
            value === t.key ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink')}>
          {t.label}
          {t.count !== undefined && t.count !== null && <span className={cn('num rounded-full px-1.5 text-[11px]', value === t.key ? 'bg-ink text-canvas' : 'bg-sunken text-ink-3')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function LinkTabs({ tabs, className }: { tabs: Array<{ href: string; label: ReactNode; exact?: boolean }>; className?: string }) {
  const path = usePathname();
  const href = useScopeHref();
  return (
    <nav className={cn('no-scrollbar mb-5 flex gap-1 overflow-x-auto border-b border-line', className)}>
      {tabs.map((t) => {
        const on = t.exact ? path === t.href : path === t.href || path.startsWith(`${t.href}/`);
        return (
          <Link key={t.href} href={href(t.href)} aria-current={on ? 'page' : undefined}
            className={cn('-mb-px flex h-10 items-center border-b-2 px-3 text-sm font-semibold whitespace-nowrap transition-colors', on ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink')}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Segmented<K extends string>({ options, value, onChange, className, size = 'md' }: { options: Array<{ key: K; label: ReactNode }>; value: K; onChange: (k: K) => void; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div className={cn('inline-flex rounded-md bg-sunken p-0.5', className)} role="group">
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)}
          className={cn('rounded-[9px] font-semibold transition-all', size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]', value === o.key ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
