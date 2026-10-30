// A progress ring: the share done as a green arc, a short label in the middle (« 2/3 », « 64 % »). Used by the Clover
// welcome wizard and Settings → Go-live. Static on purpose: no stroke transition (Phase 3 guardrail — animate only
// transform and opacity), so a new value simply shows.
import { cn } from '@/lib/ui/cn';

const SIZE = { sm: { box: 'size-14', text: 'text-[13px]' }, lg: { box: 'size-24', text: 'text-xl' } } as const;
const R = 20;
const C = 2 * Math.PI * R;

/** `value` is the share done, 0 to 1 (clamped). `ariaLabel` says it in words: the ring itself is one image. */
export function ProgressRing({ value, label, ariaLabel, size = 'sm', className }: { value: number; label: string; ariaLabel: string; size?: keyof typeof SIZE; className?: string }) {
  const share = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return (
    <div className={cn('relative shrink-0', SIZE[size].box, className)} role="img" aria-label={ariaLabel}>
      <svg viewBox="0 0 48 48" className={cn('-rotate-90', SIZE[size].box)} aria-hidden>
        <circle cx="24" cy="24" r={R} fill="none" strokeWidth="5" className="stroke-sunken" />
        {share > 0 && <circle cx="24" cy="24" r={R} fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-go" strokeDasharray={C} strokeDashoffset={C * (1 - share)} />}
      </svg>
      <span className={cn('num absolute inset-0 flex items-center justify-center font-extrabold', SIZE[size].text)} aria-hidden>{label}</span>
    </div>
  );
}
