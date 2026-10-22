'use client';

// Filters that fold away on a phone (premium pass A1, orders history): six stacked controls used to fill the whole screen
// before the first order. Under 768 px one "Filtres" button (with the number of filters on) opens them in place, under
// the button, so their own drop-down lists are never cut by a sheet; from 768 px they are always shown.
import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

export function CollapsibleFilters({ active = 0, lead, children, defaultOpen = false }: { active?: number; lead?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const panel = useId();
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 md:hidden">
        {lead && <div className="min-w-0 flex-1">{lead}</div>}
        <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}
          className={cn('text-small inline-flex h-11 shrink-0 items-center gap-2 rounded-md border px-3 font-semibold', active ? 'border-ink bg-ink text-canvas' : 'border-line-2 bg-surface text-ink-2', !lead && 'w-full justify-center')}>
          <SlidersHorizontal className="size-4" aria-hidden />
          {t('Filtres', 'Filters')}
          {active > 0 && <span className="num text-micro inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-canvas px-1.5 font-bold text-ink"><span aria-hidden>{active}</span><span className="sr-only">{t(`, ${active} actif${active > 1 ? 's' : ''}`, `, ${active} on`)}</span></span>}
          <ChevronDown className={cn('size-4 motion-safe:transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      </div>
      <div id={panel} data-open={open || undefined} className={cn(open ? 'block' : 'hidden', 'md:block')}>{children}</div>
    </div>
  );
}
