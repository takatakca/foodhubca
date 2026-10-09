'use client';

// TakTak — the TAKATAK help robot. Inline SVG (nothing to host), CSS moods: blinks, glows, waves, and spins in a
// circle when called. Respects "reduce motion" (display settings and the system setting).
import { useEffect, useState } from 'react';
import { cn } from '@/lib/ui/cn';

export type TakTakMood = 'happy' | 'think' | 'alert' | 'party';

export function TakTak({ size = 48, mood = 'happy', spinKey, wave = false, className, title = 'TakTak' }: {
  size?: number; mood?: TakTakMood; /** Change this value to make TakTak spin once. */ spinKey?: unknown; wave?: boolean; className?: string; title?: string;
}) {
  const [spinning, setSpinning] = useState(false);
  useEffect(() => {
    if (spinKey === undefined) return;
    setSpinning(true);
    const t = setTimeout(() => setSpinning(false), 950);
    return () => clearTimeout(t);
  }, [spinKey]);
  const face = mood === 'alert' ? '#e23b3e' : mood === 'think' ? '#2f6fed' : '#0e9f5a';
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={title} className={cn('shrink-0 overflow-visible', spinning && 'taktak-spin', className)}>
      <title>{title}</title>
      {/* antenna */}
      <line x1="32" y1="6" x2="32" y2="14" stroke="#151514" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="32" cy="6" r="3.6" fill="#1f8bff" className="taktak-antenna" />
      {/* head */}
      <rect x="10" y="13" width="44" height="32" rx="12" fill="#1f8bff" />
      <rect x="15" y="18" width="34" height="21" rx="8" fill="#151514" />
      {/* eyes + mouth on the face screen */}
      {mood === 'think' ? (
        <>
          <rect x="21" y="25" width="7" height="3" rx="1.5" fill={face} className="taktak-eye" />
          <rect x="36" y="25" width="7" height="3" rx="1.5" fill={face} className="taktak-eye" />
          <circle cx="32" cy="33.5" r="1.8" fill={face} />
        </>
      ) : mood === 'alert' ? (
        <>
          <circle cx="24.5" cy="26" r="3.6" fill={face} className="taktak-eye" />
          <circle cx="39.5" cy="26" r="3.6" fill={face} className="taktak-eye" />
          <rect x="27" y="32" width="10" height="3" rx="1.5" fill={face} />
        </>
      ) : (
        <>
          <circle cx="24.5" cy="26.5" r="3.2" fill={face} className="taktak-eye" />
          <circle cx="39.5" cy="26.5" r="3.2" fill={face} className="taktak-eye" />
          <path d={mood === 'party' ? 'M24 31.5 Q32 39 40 31.5 Z' : 'M25 32 Q32 37 39 32'} stroke={face} strokeWidth="2.6" strokeLinecap="round" fill={mood === 'party' ? face : 'none'} />
        </>
      )}
      {/* ears */}
      <rect x="6" y="24" width="5" height="10" rx="2.5" fill="#1565d8" />
      <rect x="53" y="24" width="5" height="10" rx="2.5" fill="#1565d8" />
      {/* body */}
      <rect x="20" y="46" width="24" height="13" rx="6" fill="#151514" />
      <circle cx="32" cy="52.5" r="3" fill="#1f8bff" />
      {/* arms: the right one waves */}
      <path d="M20 50 Q13 50 12 56" stroke="#151514" strokeWidth="3.4" strokeLinecap="round" fill="none" />
      <path d="M44 50 Q51 48 53 41" stroke="#151514" strokeWidth="3.4" strokeLinecap="round" fill="none" className={wave ? 'taktak-wave' : undefined} />
    </svg>
  );
}
