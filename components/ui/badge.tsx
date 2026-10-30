import type { ReactNode } from 'react';
import { cn } from '@/lib/ui/cn';

export type Tone = 'neutral' | 'go' | 'wait' | 'stop' | 'info' | 'violet' | 'brand' | 'dark';
const TONE: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-2',
  go: 'bg-go-soft text-go-2',
  wait: 'bg-wait-soft text-wait-2',
  stop: 'bg-stop-soft text-stop-2',
  info: 'bg-info-soft text-info-2',
  violet: 'bg-violet-soft text-violet',
  brand: 'bg-brand-soft text-brand-2',
  dark: 'bg-ink text-canvas',
};

/** A status pill: 13 px semibold on a soft fill, 22 px tall. `size="sm"` is the 11 px variant for dense rows. */
export function Badge({ tone = 'neutral', children, className, icon, title, size = 'md' }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode; title?: string; size?: 'sm' | 'md' }) {
  return <span title={title} className={cn('inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap [&>svg]:size-3.5', size === 'sm' ? 'text-micro h-5 px-1.5' : 'text-small h-[22px] px-2', TONE[tone], className)}>{icon}{children}</span>;
}

const DOT: Record<Tone, string> = { neutral: 'bg-ink-4', go: 'bg-go', wait: 'bg-wait', stop: 'bg-stop', info: 'bg-info', violet: 'bg-violet', brand: 'bg-brand', dark: 'bg-ink' };
export function StatusDot({ tone = 'neutral', pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2.5 shrink-0', className)} aria-hidden>
      {pulse && <span className={cn('absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping', DOT[tone])} />}
      <span className={cn('relative inline-flex size-2.5 rounded-full', DOT[tone])} />
    </span>
  );
}

// Platform tags: a coloured square with initials (never the platforms' logos).
export const PLATFORM: Record<string, { label: string; short: string; color: string; text: string }> = {
  uber_eats: { label: 'Uber Eats', short: 'UE', color: 'bg-uber', text: 'text-uber' },
  doordash: { label: 'DoorDash', short: 'DD', color: 'bg-doordash', text: 'text-doordash' },
  skip: { label: 'SkipTheDishes', short: 'SK', color: 'bg-skip', text: 'text-skip' },
  tgtg: { label: 'Too Good To Go', short: 'TG', color: 'bg-tgtg', text: 'text-tgtg' },
  clover: { label: 'Clover', short: 'CL', color: 'bg-clover', text: 'text-clover' },
  other: { label: 'Other', short: '•', color: 'bg-ink-3', text: 'text-ink-3' },
};
export function platformOf(key?: string | null) { return PLATFORM[key ?? 'other'] ?? PLATFORM.other; }

/** The platform chip: 20 / 24 / 32 / 44 / 64 px, letters never under 11 px (premium rule 1). */
export function PlatformMark({ channel, size = 'md', className }: { channel: string; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const p = platformOf(channel);
  const dim = { xs: 'size-5 text-micro rounded-[5px]', sm: 'size-6 text-micro rounded-[6px]', md: 'size-8 text-small rounded-sm', lg: 'size-11 text-body rounded-md', xl: 'size-16 text-title rounded-lg' }[size];
  return <span className={cn('inline-flex shrink-0 items-center justify-center font-extrabold tracking-tight text-white', p.color, dim, className)} title={p.label} aria-label={p.label}>{p.short}</span>;
}

export function PlatformTag({ channel, className }: { channel: string; className?: string }) {
  const p = platformOf(channel);
  return <span className={cn('text-small inline-flex items-center gap-1.5 font-semibold text-ink', className)}><PlatformMark channel={channel} size="xs" />{p.label}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="text-micro inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line-2 bg-raised px-1 font-semibold text-ink-3">{children}</kbd>;
}
