'use client';

// One celebration per moment and per device (docs/MASTER_PLAN.md Phase 3 P2): Go-live reaches 100 %, the first menu
// publish, Clover connected, the Clover wizard all set. The confetti is the Clover welcome wizard's: the globals.css
// `confetti` keyframe (transform and opacity only, one shot, never looping). Under reduced motion nothing moves (motion-safe + the globals.css rule):
// the pieces stay invisible and the message simply shows. Which moments already happened here: lib/ui/celebrate.ts.
import { useEffect, useState, type ReactNode } from 'react';
import { PartyPopper, X } from 'lucide-react';
import { claimCelebration } from '@/lib/ui/celebrate';
import { cn } from '@/lib/ui/cn';

const CONFETTI_COLORS = ['bg-brand', 'bg-go', 'bg-info', 'bg-wait', 'bg-violet', 'bg-clover'];

/** A one-shot burst over its parent, which needs `relative overflow-hidden`. */
export function Confetti() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {Array.from({ length: 28 }, (_, i) => (
        <span key={i} className={cn('absolute top-0 h-2.5 w-1.5 rounded-[2px] opacity-0 motion-safe:animate-confetti', CONFETTI_COLORS[i % CONFETTI_COLORS.length])}
          style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 7) * 70}ms`, ['--r' as string]: `${(i * 53) % 360}deg`, ['--x' as string]: `${((i * 29) % 60) - 30}px` }} />
      ))}
    </div>
  );
}

/**
 * The dark banner with the confetti: a title and one sentence, read out once (role="status"); a close button if asked.
 * `confetti={false}` keeps the message and drops the burst (and the icon's pop): a later visit to a moment already
 * celebrated on this device.
 */
export function CelebrationBanner({ title, body, onClose, closeLabel, className, confetti = true }: { title: ReactNode; body: ReactNode; onClose?: () => void; closeLabel?: string; className?: string; confetti?: boolean }) {
  return (
    <section className={cn('relative overflow-hidden rounded-2xl bg-rail p-6 text-white shadow-pop', className)} role="status">
      {confetti && <Confetti />}
      <div className="relative flex items-center gap-4">
        <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-full bg-brand', confetti && 'motion-safe:animate-pop')}><PartyPopper className="size-6" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="text-xl font-extrabold">{title}</div>
          <div className="text-[14px] text-white/70">{body}</div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label={closeLabel} className="flex size-11 shrink-0 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white">
            <X className="size-5" aria-hidden />
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * True from the first time `when` is true for `key` on this device, and only while `when` stays true: once the moment
 * is over (a Re-check finds a step left to do) it turns false and does not come back, on this page or a later visit
 * (remembered in localStorage, wrapped: lib/ui/celebrate.ts). Read after mount, so the server HTML never celebrates.
 */
export function useCelebrateOnce(key: string, when: boolean): boolean {
  const [fire, setFire] = useState(false);
  useEffect(() => {
    if (!when) setFire(false);
    else if (claimCelebration(key)) setFire(true);
  }, [key, when]);
  return fire && when;
}
