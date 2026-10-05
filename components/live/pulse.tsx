'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/ui/api';
import type { Pulse } from '@/lib/foodhub/pulse';
import { useViewer } from '@/components/shell/viewer';

type Ctx = {
  pulse: Pulse | null;
  refresh: () => void;
  /** Location filter for this screen ([] = every location the person can see). */
  scope: string[];
  setScope: (s: string[]) => void;
  online: boolean;
};
const PulseCtx = createContext<Ctx | null>(null);
const SCOPE_KEY = 'takatak.scope.v1';
export const REFRESH_EVENT = 'takatak:refresh';

/** Ask every live view on this screen to reload now (after an action). */
export function refreshEverything() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REFRESH_EVENT));
}

export function PulseProvider({ children, fixedScope }: { children: ReactNode; fixedScope?: string[] }) {
  const { viewer } = useViewer();
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [online, setOnline] = useState(true);
  const [scope, setScopeState] = useState<string[]>(fixedScope ?? []);
  const inflight = useRef(false);
  const lastSync = useRef(0);

  useEffect(() => {
    if (fixedScope) return;
    try { const s = JSON.parse(localStorage.getItem(SCOPE_KEY) || '[]'); if (Array.isArray(s)) setScopeState(s.filter((c) => !viewer.locations.length || viewer.locations.includes(c))); } catch { /* private mode */ }
  }, [fixedScope, viewer.locations]);

  const setScope = useCallback((s: string[]) => {
    setScopeState(s);
    try { localStorage.setItem(SCOPE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  }, []);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const q = scope.length ? `?locations=${scope.join(',')}` : '';
      const p = await api<Pulse & { ok: boolean }>(`/api/foodhub/pulse${q}`);
      setPulse(p);
      setOnline(true);
      // Keep platform statuses fresh while a screen is open (server rate-limits to one sync per minute).
      if (Date.now() - lastSync.current > 120_000) {
        lastSync.current = Date.now();
        api('/api/foodhub/sync', { method: 'POST', json: { trigger: 'auto' } }).catch(() => undefined);
      }
    } catch {
      setOnline(false);
    } finally {
      inflight.current = false;
    }
  }, [scope]);

  useEffect(() => {
    load();
    let t: ReturnType<typeof setTimeout>;
    const tick = () => { t = setTimeout(async () => { await load(); tick(); }, document.visibilityState === 'visible' ? 4000 : 15000); };
    tick();
    const now = () => load();
    window.addEventListener(REFRESH_EVENT, now);
    window.addEventListener('online', now);
    document.addEventListener('visibilitychange', now);
    return () => { clearTimeout(t); window.removeEventListener(REFRESH_EVENT, now); window.removeEventListener('online', now); document.removeEventListener('visibilitychange', now); };
  }, [load]);

  const value = useMemo(() => ({ pulse, refresh: load, scope, setScope, online }), [pulse, load, scope, setScope, online]);
  return <PulseCtx.Provider value={value}>{children}</PulseCtx.Provider>;
}

export function usePulse(): Ctx {
  const c = useContext(PulseCtx);
  if (!c) throw new Error('usePulse outside PulseProvider');
  return c;
}

/** Re-run `fn` whenever an action anywhere on this screen asks for a refresh. */
export function useRefreshOn(fn: () => void) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  useEffect(() => {
    const h = () => ref.current();
    window.addEventListener(REFRESH_EVENT, h);
    return () => window.removeEventListener(REFRESH_EVENT, h);
  }, []);
}
