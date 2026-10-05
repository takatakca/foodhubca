'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/ui/cn';

type Kind = 'success' | 'error' | 'info' | 'warn';
type Toast = { id: number; kind: Kind; title: string; body?: string };
type Ctx = { push: (kind: Kind, title: string, body?: string) => void; success: (t: string, b?: string) => void; error: (t: string, b?: string) => void; info: (t: string, b?: string) => void; warn: (t: string, b?: string) => void };

const ToastCtx = createContext<Ctx | null>(null);
let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const remove = useCallback((id: number) => setList((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback((kind: Kind, title: string, body?: string) => {
    const id = seq++;
    setList((l) => [...l.slice(-3), { id, kind, title, body }]);
    setTimeout(() => remove(id), kind === 'error' ? 8000 : 4500);
  }, [remove]);
  const value = useMemo<Ctx>(() => ({ push, success: (t, b) => push('success', t, b), error: (t, b) => push('error', t, b), info: (t, b) => push('info', t, b), warn: (t, b) => push('warn', t, b) }), [push]);
  const icon = { success: <CheckCircle2 className="size-5 text-go" />, error: <XCircle className="size-5 text-stop" />, info: <Info className="size-5 text-info" />, warn: <AlertTriangle className="size-5 text-wait" /> };
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[120] flex flex-col items-center gap-2 px-4 sm:bottom-5 sm:items-end sm:pr-5" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={cn('pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-pop animate-rise')}>
            {icon[t.kind]}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-ink">{t.title}</div>
              {t.body && <div className="mt-0.5 text-[13px] whitespace-pre-line text-ink-3">{t.body}</div>}
            </div>
            <button type="button" onClick={() => remove(t.id)} className="text-ink-4 hover:text-ink" aria-label="OK"><X className="size-4" /></button>
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
