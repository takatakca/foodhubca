'use client';

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/ui/cn';
import { dialogStack, tabWrapTarget } from '@/lib/ui/overlay-focus';

// A single keyboard/scroll owner prevents nested portaled dialogs from both closing.
let previousBodyOverflow: string | null = null;
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

function useDialogInteraction<TPanel extends HTMLElement>(onClose: () => void, dismissable = true) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<TPanel>(null);
  const latest = useRef({ onClose, dismissable });
  useEffect(() => { latest.current = { onClose, dismissable }; });

  useEffect(() => {
    const backdrop = backdropRef.current;
    const panel = panelRef.current;
    if (!backdrop || !panel) return;
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const token = Symbol('foodhub-dialog');
    const depth = dialogStack.push(token);
    if (depth === 1) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    // Dynamic stacking lets a drawer opened from a modal appear above it, not behind.
    backdrop.style.zIndex = String(80 + depth * 10);

    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((el) => !el.closest('[aria-hidden="true"]') && el.getClientRects().length > 0);
    const preferred = panel.querySelector<HTMLElement>('[autofocus]');
    const initial = preferred && preferred.getClientRects().length > 0 ? preferred : focusable()[0];
    (initial ?? panel).focus({ preventScroll: true });

    const keydown = (event: KeyboardEvent) => {
      if (!dialogStack.isTop(token)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (latest.current.dismissable) latest.current.onClose();
      } else if (event.key === 'Tab') {
        const targets = focusable();
        if (!targets.length) {
          event.preventDefault();
          panel.focus({ preventScroll: true });
          return;
        }
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const wrap = tabWrapTarget(targets, active, event.shiftKey);
        if (wrap) {
          event.preventDefault();
          wrap.focus({ preventScroll: true });
        }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      const wasTop = dialogStack.isTop(token);
      if (dialogStack.remove(token) === 0) {
        document.body.style.overflow = previousBodyOverflow ?? '';
        previousBodyOverflow = null;
      }
      // If an underlying dialog disappears first, don't steal focus from a dialog above it.
      if (wasTop && priorFocus?.isConnected) priorFocus.focus({ preventScroll: true });
    };
  }, []);
  return { backdropRef, panelRef };
}

/**
 * Esc for a light sheet that is not a Modal or Drawer (the phone's "Plus" sheet). It stays quiet while a Modal or
 * Drawer is open, so one Esc never closes two layers.
 */
export function useEscape(onClose: () => void, active = true) {
  const ref = useRef(onClose);
  useEffect(() => { ref.current = onClose; });
  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && dialogStack.size === 0) ref.current(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [active]);
}

/**
 * A light sheet takes the focus when it opens (unless something inside already has it) and gives it back to what had
 * it before when it closes. Modal and Drawer do this themselves.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    return () => { if (before && before !== document.body && before.isConnected) before.focus({ preventScroll: true }); };
  }, [active, ref]);
}

function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

export function Modal({ title, subtitle, onClose, children, footer, size = 'md', dismissable = true, className }: {
  title?: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; dismissable?: boolean; className?: string;
}) {
  const { backdropRef, panelRef } = useDialogInteraction<HTMLDivElement>(onClose, dismissable);
  const titleId = useId();
  const subtitleId = useId();
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <Portal>
      <div ref={backdropRef} className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/45 p-0 backdrop-blur-[2px] motion-safe:animate-fade sm:items-center sm:p-6" onMouseDown={(e) => { if (dismissable && e.target === e.currentTarget) onClose(); }}>
        {/* Dialogs are the one place with the large radius (premium rule 3): sheets on a phone, 20 px cards on a desktop. */}
        <div ref={panelRef} role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby={title ? titleId : undefined} aria-describedby={subtitle ? subtitleId : undefined} aria-label={!title ? 'Dialogue / Dialog' : undefined}
          className={cn('flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface shadow-pop motion-safe:animate-rise sm:rounded-xl', width, className)}>
          {(title || dismissable) && (
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                {title && <h2 id={titleId} className="text-title text-ink">{title}</h2>}
                {subtitle && <div id={subtitleId} className="text-small mt-0.5 text-ink-3">{subtitle}</div>}
              </div>
              {/* 44 px to tap (the only visible close on a phone's bottom sheet); the negative margins keep the header height. */}
              {dismissable && <button type="button" onClick={onClose} aria-label="Fermer / Close" className="-my-1.5 -mr-2.5 flex size-11 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink"><X className="size-5" aria-hidden /></button>}
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
  const { backdropRef, panelRef } = useDialogInteraction<HTMLElement>(onClose);
  const titleId = useId();
  const subtitleId = useId();
  const w = { md: 'sm:max-w-md', lg: 'sm:max-w-xl', xl: 'sm:max-w-3xl' }[width];
  return (
    <Portal>
      <div ref={backdropRef} className="fixed inset-0 z-[70] flex justify-end bg-ink/35 motion-safe:animate-fade" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <aside ref={panelRef} role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby={title ? titleId : undefined} aria-describedby={subtitle ? subtitleId : undefined} aria-label={!title ? 'Dialogue / Dialog' : undefined} className={cn('flex h-full w-full flex-col bg-canvas shadow-pop motion-safe:animate-slide-in', w)}>
          <div className="flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4">
            <div className="min-w-0 flex-1">
              {title && <h2 id={titleId} className="text-title text-ink">{title}</h2>}
              {subtitle && <div id={subtitleId} className="text-small mt-0.5 text-ink-3">{subtitle}</div>}
            </div>
            {headerRight}
            <button type="button" onClick={onClose} aria-label="Fermer / Close" className="-my-1.5 -mr-2.5 flex size-11 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink"><X className="size-5" aria-hidden /></button>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto">{children}</div>
          {footer && <div className="safe-bottom border-t border-line bg-surface px-5 py-3">{footer}</div>}
        </aside>
      </div>
    </Portal>
  );
}
