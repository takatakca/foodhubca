'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/ui/cn';

/** Re-renders every `ms` (shared clock for timers). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function fmtDuration(seconds: number) {
  const s = Math.max(0, Math.floor(Math.abs(seconds)));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h) return `${h}h${String(m % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** "4:12" since a moment; turns amber then red. */
export function Elapsed({ since, warnAt = 600, badAt = 900, className }: { since: string; warnAt?: number; badAt?: number; className?: string }) {
  const now = useNow();
  const s = (now - Date.parse(since)) / 1000;
  return <span className={cn('num font-bold', s >= badAt ? 'text-stop' : s >= warnAt ? 'text-wait-2' : 'text-ink-2', className)}>{fmtDuration(s)}</span>;
}

/** Time left until a moment ("−1:20" once passed). */
export function Countdown({ to, className, warnAt = 120 }: { to: string; className?: string; warnAt?: number }) {
  const now = useNow();
  const s = (Date.parse(to) - now) / 1000;
  return <span className={cn('num font-bold', s <= 0 ? 'text-stop' : s <= warnAt ? 'text-wait-2' : 'text-ink', className)}>{s < 0 ? '−' : ''}{fmtDuration(s)}</span>;
}

/** Circular countdown for the new-order pop-up. */
export function CountdownRing({ from, to, size = 120, children }: { from: string; to: string; size?: number; children?: React.ReactNode }) {
  const now = useNow(250);
  const total = Math.max(1, Date.parse(to) - Date.parse(from));
  const left = Math.max(0, Date.parse(to) - now);
  const frac = left / total;
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const color = frac > 0.5 ? 'var(--color-go)' : frac > 0.2 ? 'var(--color-wait)' : 'var(--color-stop)';
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--color-line)" strokeWidth={7} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={7} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ transition: 'stroke-dashoffset .25s linear, stroke .3s' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
