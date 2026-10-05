'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/ui/cn';

const FIELD = 'w-full rounded-md border border-line-2 bg-surface px-3 text-sm text-ink placeholder:text-ink-4 transition-colors hover:border-ink-4 focus:border-ink focus:outline-none focus:ring-4 focus:ring-ink/5 disabled:bg-sunken disabled:text-ink-3';

export function Field({ label, hint, error, children, className }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      {label && <span className="text-[13px] font-semibold text-ink-2">{label}</span>}
      {children}
      {error ? <span className="text-xs font-medium text-stop">{error}</span> : hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { inputSize?: 'sm' | 'md' | 'lg' }>(function Input({ className, inputSize = 'md', ...rest }, ref) {
  return <input ref={ref} className={cn(FIELD, inputSize === 'sm' ? 'h-8 text-[13px]' : inputSize === 'lg' ? 'h-12 text-base' : 'h-10', className)} {...rest} />;
});

export function Select({ className, children, selectSize = 'md', ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { selectSize?: 'sm' | 'md' }) {
  return (
    <select className={cn(FIELD, 'appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8', selectSize === 'sm' ? 'h-8 text-[13px]' : 'h-10', className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2385827a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD, 'min-h-20 py-2', className)} {...rest} />;
}

export function Switch({ checked, onChange, label, disabled, size = 'md', description }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; size?: 'sm' | 'md'; description?: ReactNode }) {
  const track = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11';
  const knob = size === 'sm' ? 'size-4 data-[on=true]:translate-x-4' : 'size-5 data-[on=true]:translate-x-5';
  return (
    <label className={cn('inline-flex items-start gap-3', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors', track, checked ? 'bg-go' : 'bg-line-2')}>
        <span data-on={checked} className={cn('inline-block rounded-full bg-white shadow transition-transform', knob)} />
      </button>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-semibold text-ink">{label}</span>}
          {description && <span className="block text-xs text-ink-3">{description}</span>}
        </span>
      )}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex items-center gap-2 text-sm text-ink', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <input type="checkbox" className="size-4 rounded accent-[var(--color-ink)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Pill choices (single or multiple). */
export function Chips<V extends string | number>({ options, value, onChange, size = 'md', className }: { options: Array<{ value: V; label: ReactNode }>; value: V | V[]; onChange: (v: V) => void; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sel = (v: V) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={sel(o.value)} onClick={() => onChange(o.value)}
          className={cn('rounded-full border font-semibold transition-colors', size === 'sm' ? 'h-7 px-2.5 text-xs' : size === 'lg' ? 'h-12 px-5 text-base' : 'h-9 px-3.5 text-[13px]',
            sel(o.value) ? 'border-ink bg-ink text-canvas' : 'border-line-2 bg-surface text-ink-2 hover:border-ink-4 hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
