'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/lib/ui/cn';

export type OverflowItem = { key: string; label: ReactNode; icon?: ReactNode; onSelect: () => void; disabled?: boolean; hint?: ReactNode };

/**
 * "Plus d’actions" (premium rule 5): the page keeps one primary action in view, the rarer ones live here. A button
 * with aria-haspopup, a list of menu items (44 px each), arrow keys to move, Escape or a click outside to close, and
 * focus back on the button when it closes.
 */
export function OverflowMenu({ label, items, className, align = 'end', showLabel }: { label: string; items: OverflowItem[]; className?: string; align?: 'start' | 'end'; showLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const enabled = items.filter((i) => !i.disabled);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const close = (refocus = true) => { setOpen(false); if (refocus) button.current?.focus(); };
  const move = (step: number) => {
    const all = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
    if (!all.length) return;
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(at + step + all.length) % all.length]?.focus();
  };

  return (
    <div ref={root} className={cn('relative', className)}>
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={showLabel ? undefined : label} title={showLabel ? undefined : label}
        disabled={!enabled.length} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
        className={buttonClass('outline', 'md', showLabel ? undefined : 'w-10 px-0 touch-target')}>
        <MoreHorizontal className="size-4" aria-hidden />{showLabel && label}
      </button>
      {open && (
        <div ref={list} id={id} role="menu" aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'Tab') close(false);
          }}
          className={cn('motion-safe:animate-fade absolute top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-line bg-surface p-1 shadow-pop', align === 'end' ? 'right-0' : 'left-0')}>
          {items.map((i) => (
            <button key={i.key} type="button" role="menuitem" disabled={i.disabled}
              onClick={() => { close(); i.onSelect(); }}
              className="text-body flex min-h-11 w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left font-semibold text-ink hover:bg-sunken focus-visible:bg-sunken disabled:text-ink-3 [&_svg]:size-4 [&_svg]:shrink-0">
              {i.icon && <span className="text-ink-3" aria-hidden>{i.icon}</span>}
              <span className="min-w-0 flex-1">{i.label}{i.hint && <span className="text-small block font-normal text-ink-3">{i.hint}</span>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
