'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, RotateCcw, X, XCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

type Kind = 'success' | 'error' | 'info' | 'warn' | 'undo';
type Action = { label: string; onClick: () => void };
type Toast = { id: number; kind: Kind; title: string; body?: string; action?: Action; ms: number; startedAt: number };
export type ToastOptions = { action?: Action; durationMs?: number };
type Ctx = {
  push: (kind: Kind, title: string, body?: string, opts?: ToastOptions) => number;
  success: (t: string, b?: string, opts?: ToastOptions) => number;
  error: (t: string, b?: string, opts?: ToastOptions) => number;
  info: (t: string, b?: string, opts?: ToastOptions) => number;
  warn: (t: string, b?: string, opts?: ToastOptions) => number;
  /**
   * "Removed — Undo" with a countdown. `onUndo` runs if the person taps Undo within `ms` (default 6 s);
   * `onCommit` runs when the window closes without an undo (for removals that are only sent afterwards).
   */
  undo: (title: string, onUndo: () => void, opts?: { body?: string; ms?: number; onCommit?: () => void }) => number;
  dismiss: (id: number) => void;
};

const ToastCtx = createContext<Ctx | null>(null);
let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [list, setList] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const commits = useRef(new Map<number, () => void>());

  const remove = useCallback((id: number, committed = true) => {
    const tm = timers.current.get(id);
    if (tm) clearTimeout(tm);
    timers.current.delete(id);
    const commit = commits.current.get(id);
    commits.current.delete(id);
    if (committed && commit) commit();
    setList((l) => l.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((kind: Kind, title: string, body?: string, opts: ToastOptions = {}) => {
    const id = seq++;
    const ms = opts.durationMs ?? (kind === 'error' ? 8000 : kind === 'undo' ? 6000 : opts.action ? 7000 : 4500);
    setList((l) => [...l.slice(-3), { id, kind, title, body, action: opts.action, ms, startedAt: Date.now() }]);
    timers.current.set(id, setTimeout(() => remove(id), ms));
    return id;
  }, [remove]);

  const undo = useCallback<Ctx['undo']>((title, onUndo, opts = {}) => {
    let id = 0;
    id = push('undo', title, opts.body, {
      durationMs: opts.ms ?? 6000,
      action: { label: t('Annuler', 'Undo'), onClick: () => { remove(id, false); onUndo(); } },
    });
    if (opts.onCommit) commits.current.set(id, opts.onCommit);
    return id;
  }, [push, remove, t]);

  // Commit pending removals if the screen goes away (navigation, tab close): the window is over.
  useEffect(() => {
    const flush = () => { for (const [id, fn] of commits.current) { commits.current.delete(id); fn(); } };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, []);

  const value = useMemo<Ctx>(() => ({
    push, undo, dismiss: (id) => remove(id),
    success: (a, b, o) => push('success', a, b, o), error: (a, b, o) => push('error', a, b, o), info: (a, b, o) => push('info', a, b, o), warn: (a, b, o) => push('warn', a, b, o),
  }), [push, undo, remove]);
  const icon: Record<Kind, ReactNode> = {
    success: <CheckCircle2 className="size-5 text-go" />, error: <XCircle className="size-5 text-stop" />, info: <Info className="size-5 text-info" />,
    warn: <AlertTriangle className="size-5 text-wait" />, undo: <RotateCcw className="size-5 text-ink-3" />,
  };
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-40 z-[120] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-5 lg:bottom-24" aria-live="polite">
        {list.map((x) => (
          <div key={x.id} className={cn('pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-lg border border-line bg-surface shadow-pop animate-rise', x.kind === 'undo' && 'bg-ink text-canvas border-ink')}>
            <div className="flex items-start gap-3 px-4 py-3">
              {icon[x.kind]}
              <div className="min-w-0 flex-1">
                <div className={cn('text-sm font-bold', x.kind === 'undo' ? 'text-canvas' : 'text-ink')}>{x.title}</div>
                {x.body && <div className={cn('mt-0.5 text-[0.8125rem] whitespace-pre-line', x.kind === 'undo' ? 'text-canvas/70' : 'text-ink-3')}>{x.body}</div>}
              </div>
              {x.action && (
                <button type="button" onClick={x.action.onClick}
                  className={cn('-my-1 min-h-10 shrink-0 rounded-md px-3 text-sm font-extrabold', x.kind === 'undo' ? 'bg-canvas text-ink hover:bg-canvas/90' : 'bg-sunken text-ink hover:bg-line')}>
                  {x.action.label}
                </button>
              )}
              <button type="button" onClick={() => remove(x.id)} className={cn('-mr-1 flex size-8 shrink-0 items-center justify-center rounded-md', x.kind === 'undo' ? 'text-canvas/60 hover:text-canvas' : 'text-ink-4 hover:text-ink')} aria-label="OK"><X className="size-4" /></button>
            </div>
            {x.kind === 'undo' && <div className="absolute bottom-0 left-0 h-1 bg-brand" style={{ animation: `toast-countdown ${x.ms}ms linear forwards` }} />}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): Ctx {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('useToast outside ToastProvider');
  return c;
}
