'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

/* One field style: 12 px radius, hairline, ink border and a soft ring on focus (the global focus-visible ring is for
   the keyboard; a field shows its own ring on any focus). Heights 32 / 40 / 48, text 13 / 15 / 15. */
const FIELD = 'text-body w-full rounded-md border border-line-2 bg-surface px-3 text-ink placeholder:text-ink-4 transition-colors duration-(--duration-fast) hover:border-ink-4 focus:border-ink focus:outline-none focus:ring-4 focus:ring-ink/5 disabled:bg-sunken disabled:text-ink-3 aria-[invalid=true]:border-stop aria-[invalid=true]:focus:ring-stop/10';
const CHEVRON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235c6677' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

export function Field({ label, hint, error, children, className, required }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      {label && <span className="text-small font-semibold text-ink-2">{label}{required && <span className="ml-0.5 text-stop" aria-hidden>*</span>}</span>}
      {children}
      {error ? <span className="text-small font-medium text-stop" role="alert">{error}</span> : hint ? <span className="text-small text-ink-3">{hint}</span> : null}
    </label>
  );
}

/** Date and time inputs follow the console's language (fr-CA: 24 h, day first) wherever the browser honours `lang`. */
function usePickerLang(type?: string) {
  const { loc } = useI18n();
  return type === 'date' || type === 'time' || type === 'datetime-local' || type === 'month' || type === 'week' ? loc : undefined;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { inputSize?: 'sm' | 'md' | 'lg'; invalid?: boolean }>(function Input({ className, inputSize = 'md', invalid, type, ...rest }, ref) {
  const lang = usePickerLang(type);
  return <input ref={ref} type={type} lang={lang} aria-invalid={invalid || undefined} className={cn(FIELD, inputSize === 'sm' ? 'text-small h-8' : inputSize === 'lg' ? 'h-12' : 'h-10', className)} {...rest} />;
});

export function Select({ className, children, selectSize = 'md', invalid, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { selectSize?: 'sm' | 'md' | 'lg'; invalid?: boolean }) {
  return (
    <select aria-invalid={invalid || undefined} className={cn(FIELD, 'appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9', selectSize === 'sm' ? 'text-small h-8' : selectSize === 'lg' ? 'h-12' : 'h-10', className)}
      style={{ backgroundImage: CHEVRON }} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, invalid, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea aria-invalid={invalid || undefined} className={cn(FIELD, 'min-h-20 py-2.5', className)} {...rest} />;
}

export function Switch({ checked, onChange, label, disabled, size = 'md', description }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; size?: 'sm' | 'md'; description?: ReactNode }) {
  const track = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11';
  const knob = size === 'sm' ? 'size-4 data-[on=true]:translate-x-4' : 'size-5 data-[on=true]:translate-x-5';
  return (
    <label className={cn('inline-flex items-start gap-3', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors duration-(--duration-fast)', track, checked ? 'bg-go' : 'bg-line-2')}>
        <span data-on={checked} className={cn('inline-block rounded-full bg-white shadow transition-transform duration-(--duration-fast)', knob)} />
      </button>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="text-body block font-semibold text-ink">{label}</span>}
          {description && <span className="text-small block text-ink-3">{description}</span>}
        </span>
      )}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('text-body inline-flex min-h-6 items-center gap-2 text-ink', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <input type="checkbox" className="size-[18px] rounded accent-(--color-ink)" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Pill choices (single or multiple). */
export function Chips<V extends string | number>({ options, value, onChange, size = 'md', className, disabled }: { options: Array<{ value: V; label: ReactNode }>; value: V | V[]; onChange: (v: V) => void; size?: 'sm' | 'md' | 'lg'; className?: string; disabled?: boolean }) {
  const sel = (v: V) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={sel(o.value)} disabled={disabled} onClick={() => onChange(o.value)}
          className={cn('rounded-full border font-semibold transition-colors duration-(--duration-fast)', size === 'sm' ? 'text-small h-8 px-3' : size === 'lg' ? 'text-body h-12 px-5' : 'text-small touch-target h-9 px-3.5',
            sel(o.value) ? 'border-ink bg-ink text-canvas' : 'border-line-2 bg-surface text-ink-2 hover:border-ink-4 hover:text-ink', disabled && 'cursor-not-allowed opacity-60')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
