'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/ui/cn';

function useEscape(onClose: () => void, active = true) {
  const ref = useRef(onClose);
  useEffect(() => { ref.current = onClose; });
  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') ref.current(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [active]);
}

function useLockScroll(active = true) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [active]);
}

function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

export function Modal({ title, subtitle, onClose, children, footer, size = 'md', dismissable = true, className }: {
  title?: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; dismissable?: boolean; className?: string;
}) {
  useEscape(() => dismissable && onClose());
  useLockScroll();
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <Portal>
      <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/45 p-0 backdrop-blur-[2px] animate-fade sm:items-center sm:p-6" onMouseDown={(e) => { if (dismissable && e.target === e.currentTarget) onClose(); }}>
        <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
          className={cn('flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface shadow-pop animate-rise sm:rounded-2xl', width, className)}>
          {(title || dismissable) && (
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                {title && <h2 className="text-lg font-extrabold text-ink">{title}</h2>}
                {subtitle && <div className="mt-0.5 text-[13px] text-ink-3">{subtitle}</div>}
              </div>
              {dismissable && <button type="button" onClick={onClose} aria-label="Fermer / Close" className="-mr-1 rounded-md p-1.5 text-ink-3 hover:bg-sunken hover:text-ink"><X className="size-5" /></button>}
            </div>
          )}
          <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="safe-bottom flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

export function Drawer({ title, subtitle, onClose, children, footer, width = 'md', headerRight }: {
  title?: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: 'md' | 'lg' | 'xl'; headerRight?: ReactNode;
}) {
  useEscape(onClose);
  useLockScroll();
  const w = { md: 'sm:max-w-md', lg: 'sm:max-w-xl', xl: 'sm:max-w-3xl' }[width];
  return (
    <Portal>
      <div className="fixed inset-0 z-[70] flex justify-end bg-ink/35 animate-fade" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <aside role="dialog" aria-modal="true" className={cn('flex h-full w-full flex-col bg-canvas shadow-pop animate-slide-in', w)}>
          <div className="flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4">
            <div className="min-w-0 flex-1">
              {title && <div className="text-lg font-extrabold text-ink">{title}</div>}
              {subtitle && <div className="mt-0.5 text-[13px] text-ink-3">{subtitle}</div>}
            </div>
            {headerRight}
            <button type="button" onClick={onClose} aria-label="Fermer / Close" className="-mr-1 rounded-md p-1.5 text-ink-3 hover:bg-sunken hover:text-ink"><X className="size-5" /></button>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto">{children}</div>
          {footer && <div className="safe-bottom border-t border-line bg-surface px-5 py-3">{footer}</div>}
        </aside>
      </div>
    </Portal>
  );
}
