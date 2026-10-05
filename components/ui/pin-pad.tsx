'use client';

import { useCallback, useEffect, useState } from 'react';
import { Delete } from 'lucide-react';
import { cn } from '@/lib/ui/cn';

/** Big touch keypad for 4–6 digit PINs. Calls onDone when `length` digits are typed (or on ✓). */
export function PinPad({ onDone, length = 4, maxLength = 6, busy, error, dark }: { onDone: (pin: string) => void; length?: number; maxLength?: number; busy?: boolean; error?: string | null; dark?: boolean }) {
  const [pin, setPin] = useState('');
  useEffect(() => { if (error) setPin(''); }, [error]);
  const press = useCallback((d: string) => {
    if (busy) return;
    setPin((p) => {
      const next = (p + d).slice(0, maxLength);
      if (next.length === maxLength) setTimeout(() => onDone(next), 60);
      return next;
    });
  }, [busy, maxLength, onDone]);
  const back = useCallback(() => setPin((p) => p.slice(0, -1)), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Enter' && pin.length >= length) onDone(pin);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [press, back, pin, length, onDone]);
  const key = cn('flex h-16 items-center justify-center rounded-xl text-2xl font-bold transition-colors active:scale-[0.97]', dark ? 'bg-raised text-ink hover:bg-line' : 'bg-sunken text-ink hover:bg-line');
  return (
    <div className="mx-auto w-full max-w-[300px]">
      <div className={cn('mb-5 flex h-6 items-center justify-center gap-3', error && 'animate-[shake_.3s]')}>
        {Array.from({ length: Math.max(length, pin.length) }, (_, i) => (
          <span key={i} className={cn('size-3.5 rounded-full transition-colors', i < pin.length ? (error ? 'bg-stop' : 'bg-ink') : 'bg-line-2')} />
        ))}
      </div>
      {error && <div className="-mt-2 mb-3 text-center text-sm font-semibold text-stop">{error}</div>}
      <div className="grid grid-cols-3 gap-2.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" className={key} onClick={() => press(d)} disabled={busy}>{d}</button>)}
        <button type="button" className={cn(key, 'text-base')} onClick={back} aria-label="Effacer / Delete"><Delete className="size-6" /></button>
        <button type="button" className={key} onClick={() => press('0')} disabled={busy}>0</button>
        <button type="button" className={cn(key, pin.length >= length ? 'bg-go text-white hover:bg-go-2' : 'opacity-40')} disabled={busy || pin.length < length} onClick={() => onDone(pin)} aria-label="OK">✓</button>
      </div>
    </div>
  );
}
