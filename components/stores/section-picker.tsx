'use client';

import { ChevronDown } from 'lucide-react';
import { Segmented } from '@/components/ui/tabs';
import { cn } from '@/lib/ui/cn';

/**
 * The view inside a page that already sits under the Restaurants tabs (A4 #3: never a third tab strip). From 640 px a
 * pill group; on a phone one native select, so five long labels never clip or scroll sideways.
 */
export function SectionPicker<K extends string>({ options, value, onChange, label, className }: { options: Array<{ key: K; label: string }>; value: K; onChange: (k: K) => void; label: string; className?: string }) {
  return (
    <div className={className}>
      <Segmented className="hidden sm:inline-flex" label={label} value={value} onChange={onChange} options={options} />
      <div className={cn('relative sm:hidden')}>
        <select value={value} onChange={(e) => onChange(e.target.value as K)} aria-label={label}
          className="text-body h-11 w-full appearance-none rounded-md border border-line-2 bg-surface pr-10 pl-4 font-semibold text-ink">
          {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      </div>
    </div>
  );
}
