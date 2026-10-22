import Link from 'next/link';
import type { HTMLAttributes, ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/ui/cn';

/**
 * The one card (premium rule 3): 12 px radius, hairline, soft shadow. `padding` follows the spacing scale: `md` is
 * the standard 20 px, `lg` 24 px for a hero or a form, `sm` 16 px for a dense list, `none` when the card holds a table.
 * `tone="hero"` is the single inverted (navy) card a screen may show.
 */
export function Card({ className, children, padding = 'none', tone, ...rest }: HTMLAttributes<HTMLDivElement> & { padding?: 'none' | 'sm' | 'md' | 'lg'; tone?: 'hero' }) {
  const pad = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-6' }[padding];
  return (
    <div className={cn('rounded-md border border-line bg-surface shadow-card', tone === 'hero' && 'border-rail-2 bg-rail text-white shadow-pop [&_.text-ink]:text-white [&_.text-ink-3]:text-white/70', pad, className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, right, className, icon }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-3', className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-ink-3 [&>svg]:size-5" aria-hidden>{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-heading text-ink">{title}</h2>
          {subtitle && <div className="text-small mt-0.5 text-ink-3">{subtitle}</div>}
        </div>
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

/**
 * One page header (A4 #2). Eyebrow only when it names a section different from the title; the right slot always
 * holds the page action (one primary at most); `back` draws "← Section" above the title; `tabs` sit under the header
 * with the section gap, so a page never places its action between the subtitle and its tabs.
 */
export function PageHeader({ title, subtitle, right, eyebrow, back, tabs, className }: {
  title: ReactNode; subtitle?: ReactNode; right?: ReactNode; eyebrow?: ReactNode; back?: { href: string; label: ReactNode }; tabs?: ReactNode; className?: string;
}) {
  return (
    <header className={cn('mb-6', className)}>
      {back && (
        <Link href={back.href} className="text-small -ml-1 mb-2 inline-flex min-h-8 items-center gap-1 rounded-sm px-1 font-semibold text-ink-3 hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />{back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <div className="eyebrow mb-1 text-brand">{eyebrow}</div>}
          <h1 className="text-display text-ink">{title}</h1>
          {subtitle && <p className="text-body mt-1 max-w-3xl text-ink-3">{subtitle}</p>}
        </div>
        {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
      </div>
      {tabs && <div className="mt-4">{tabs}</div>}
    </header>
  );
}

/**
 * A number card. Same padding as every card (20 px), label 13, value 28 (hero 34). `tone` colours the value only; the
 * border never changes (a coloured outline reads as "selected"). `loading` keeps the card's shape instead of flashing 0.
 */
export function Stat({ label, value, note, tone, hero, icon, className, loading }: {
  label: ReactNode; value: ReactNode; note?: ReactNode; tone?: 'go' | 'stop' | 'wait' | 'brand'; hero?: boolean; icon?: ReactNode; className?: string; loading?: boolean;
}) {
  const color = tone === 'go' ? 'text-go-2' : tone === 'stop' ? 'text-stop-2' : tone === 'wait' ? 'text-wait-2' : tone === 'brand' ? 'text-brand' : 'text-ink';
  return (
    <div className={cn('rounded-md border border-line bg-surface p-5 shadow-card', className)} aria-busy={loading || undefined}>
      <div className="text-small flex items-center gap-1.5 font-semibold text-ink-3 [&>svg]:size-4">{icon}{label}</div>
      {loading
        ? <Skeleton className={cn('mt-2', hero ? 'h-10 w-32' : 'h-8 w-24')} />
        : <div className={cn('num mt-1 tracking-tight', hero ? 'text-[34px] leading-none font-extrabold' : 'text-display', color)}>{value}</div>}
      {note && <div className="text-small mt-1 text-ink-3">{note}</div>}
    </div>
  );
}

/**
 * Every empty view (premium rule 8): an icon, a title, one sentence, and one next action (a button or a link).
 * `secondary` is an optional quieter second link. Pass `compact` inside a small card.
 */
export function EmptyState({ icon, title, body, action, secondary, className, compact }: {
  icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode; secondary?: ReactNode; className?: string; compact?: boolean;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'px-6 py-14', className)}>
      {icon && <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-sunken text-ink-3 [&>svg]:size-6" aria-hidden>{icon}</div>}
      <div className="text-heading text-ink">{title}</div>
      {body && <div className="text-body mt-1 max-w-md text-ink-3">{body}</div>}
      {(action || secondary) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondary}
        </div>
      )}
    </div>
  );
}

/** Loading shapes (premium rule 9): the same silhouette as the content that is coming, so nothing jumps. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('motion-safe:animate-pulse rounded-md bg-sunken', className)} aria-hidden />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />)}
    </div>
  );
}

/** A grid of stat cards, same size as `Stat`. */
export function SkeletonStats({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-4 lg:grid-cols-4', className)} role="status" aria-label="Chargement… / Loading…">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-md border border-line bg-surface p-5 shadow-card" aria-hidden>
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="mt-3 h-8 w-20" />
        </div>
      ))}
    </div>
  );
}

/** A table being loaded: a header line and `rows` 44 px rows. */
export function SkeletonTable({ rows = 5, cols = 4, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-md border border-line bg-surface shadow-card', className)} role="status" aria-label="Chargement… / Loading…">
      <div className="flex h-11 items-center gap-6 border-b border-line bg-raised px-4" aria-hidden>
        {Array.from({ length: cols }, (_, i) => <Skeleton key={i} className="h-3 flex-1 bg-line" />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-11 items-center gap-6 border-b border-line px-4 last:border-0" aria-hidden>
          {Array.from({ length: cols }, (_, c) => <Skeleton key={c} className={cn('h-3.5 flex-1', c === 0 && 'max-w-40')} />)}
        </div>
      ))}
    </div>
  );
}

/** A list of cards being loaded (orders, stores, brands). */
export function SkeletonList({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Chargement… / Loading…">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-md border border-line bg-surface p-5 shadow-card" aria-hidden>
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-1/3" /><Skeleton className="h-3 w-1/2" /></div>
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  );
}

const BANNER = {
  info: { cls: 'border-info/25 bg-info-soft text-info-2', Icon: Info },
  warn: { cls: 'border-wait/30 bg-wait-soft text-wait-2', Icon: AlertTriangle },
  stop: { cls: 'border-stop/25 bg-stop-soft text-stop-2', Icon: XCircle },
  go: { cls: 'border-go/25 bg-go-soft text-go-2', Icon: CheckCircle2 },
};
export function Banner({ tone = 'info', children, action, className }: { tone?: keyof typeof BANNER; children: ReactNode; action?: ReactNode; className?: string }) {
  const b = BANNER[tone];
  return (
    <div role={tone === 'stop' ? 'alert' : 'status'} className={cn('text-body flex items-start gap-2.5 rounded-md border px-4 py-3 motion-safe:animate-fade', b.cls, className)}>
      <b.Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-ink-2 [&_strong]:text-ink">{children}</div>
      {action}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px bg-line', className)} />;
}
