'use client';

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

/**
 * « Détails techniques »: setting names, commands and addresses for the technician, folded under the plain sentence
 * the owner reads (premium A3). Long names wrap anywhere, so a phone never scrolls sideways.
 */
export function TechDetails({ children, className, label }: { children: ReactNode; className?: string; label?: ReactNode }) {
  const { t } = useI18n();
  return (
    <details className={cn('group mt-2 min-w-0', className)}>
      <summary className="text-small inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-sm font-semibold text-ink-3 select-none hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
        {label ?? t('Détails techniques', 'Technical details')}
      </summary>
      <div className="text-small mt-1 rounded-md bg-sunken px-3 py-2 font-mono break-all text-ink-2">{children}</div>
    </details>
  );
}
