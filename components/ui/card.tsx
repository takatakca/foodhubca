import type { HTMLAttributes, ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/ui/cn';

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-line bg-surface shadow-card', className)} {...rest}>{children}</div>;
}

export function CardHeader({ title, subtitle, right, className, icon }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3', className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-ink-3">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-ink">{title}</h2>
          {subtitle && <div className="mt-0.5 text-[13px] text-ink-3">{subtitle}</div>}
        </div>
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, right, eyebrow }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-bold tracking-[0.12em] text-brand uppercase">{eyebrow}</div>}
        <h1 className="text-[26px] leading-tight font-extrabold text-ink sm:text-[30px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-3">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function Stat({ label, value, note, tone, hero, icon, className }: { label: ReactNode; value: ReactNode; note?: ReactNode; tone?: 'go' | 'stop' | 'wait' | 'brand'; hero?: boolean; icon?: ReactNode; className?: string }) {
  const color = tone === 'go' ? 'text-go' : tone === 'stop' ? 'text-stop' : tone === 'wait' ? 'text-wait-2' : tone === 'brand' ? 'text-brand' : 'text-ink';
  return (
    <div className={cn('rounded-lg border border-line bg-surface p-4 shadow-card', className)}>
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink-3">{icon}{label}</div>
      <div className={cn('num mt-1 font-extrabold tracking-tight', hero ? 'text-4xl' : 'text-[26px]', color)}>{value}</div>
      {note && <div className="mt-1 text-xs text-ink-3">{note}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-sunken text-ink-3">{icon}</div>}
      <div className="text-[15px] font-bold text-ink">{title}</div>
      {body && <div className="mt-1 max-w-md text-sm text-ink-3">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-sunken', className)} />;
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
    <div role={tone === 'stop' ? 'alert' : 'status'} className={cn('flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-sm', b.cls, className)}>
      <b.Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-ink-2 [&_strong]:text-ink">{children}</div>
      {action}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px bg-line', className)} />;
}
