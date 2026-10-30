'use client';

// One celebration per moment and per device (docs/MASTER_PLAN.md Phase 3 P2): Go-live reaches 100 %, the first menu
// publish, Clover connected. The confetti is the Clover welcome wizard's: the globals.css `confetti` keyframe (transform
// and opacity only, one shot, never looping). Under reduced motion nothing moves (motion-safe + the globals.css rule):
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

/** The dark banner with the confetti: a title and one sentence, read out once (role="status"); a close button if asked. */
export function CelebrationBanner({ title, body, onClose, closeLabel, className }: { title: ReactNode; body: ReactNode; onClose?: () => void; closeLabel?: string; className?: string }) {
  return (
    <section className={cn('relative overflow-hidden rounded-2xl bg-rail p-6 text-white shadow-pop', className)} role="status">
      <Confetti />
      <div className="relative flex items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand motion-safe:animate-pop"><PartyPopper className="size-6" aria-hidden /></span>
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
 * True from the first time `when` is true for `key` on this device, and never again on a later visit (remembered in
 * localStorage, wrapped: lib/ui/celebrate.ts). Read after mount, so the server HTML never shows a celebration.
 */
export function useCelebrateOnce(key: string, when: boolean): boolean {
  const [fire, setFire] = useState(false);
  useEffect(() => { if (when && claimCelebration(key)) setFire(true); }, [key, when]);
  return fire;
}
