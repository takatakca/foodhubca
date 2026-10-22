'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { api } from '@/lib/ui/api';
import type { Pulse } from '@/lib/foodhub/pulse';
import { alarmLocations, ALL_RESTAURANTS, BRAND_PARAM, CHANNEL_PARAM, KITCHEN_PARAM, readRemembered, resolveScope, sameScope, scopeBrands, scopeChannels, scopeHref, scopeLocations, validScope, withScopeQuery, type Scope } from '@/lib/foodhub/scope';
import { useViewer } from '@/components/shell/viewer';

type Ctx = {
  pulse: Pulse | null;
  refresh: () => void;
  /** The console's scope: every restaurant → one location → one brand, and one platform. In the address (?kitchen=…&brand=…&channel=…). */
  site: Scope;
  /**
   * Change the scope (the header picker, a brand row, a filter chip): merged into the current scope, then checked,
   * written to the address and remembered on this device. `{ kitchen, brand }` keeps the platform;
   * `{ channel: undefined }` clears it.
   */
  setSite: (patch: Partial<Scope>) => void;
  /** Kitchen filter for this screen ([] = every kitchen the person can see). */
  scope: string[];
  /** Brand filter for this screen ([] = every brand). Never applied to the live alarms or the kitchen screen. */
  brands: string[];
  /** Platform filter for this screen ([] = every platform). Never applied to the live alarms or the kitchen screen. */
  channels: string[];
  online: boolean;
};
const PulseCtx = createContext<Ctx | null>(null);
const SCOPE_KEY = 'takatak.scope.v2';
/** The previous screen kept a list of location codes here: read once, so nobody loses their kitchen. */
const OLD_SCOPE_KEY = 'takatak.scope.v1';
export const REFRESH_EVENT = 'takatak:refresh';

/** Ask every live view on this screen to reload now (after an action). */
export function refreshEverything() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REFRESH_EVENT));
}

function remember(s: Scope) {
  try { localStorage.setItem(SCOPE_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

/** `fixedScope`: a kitchen tablet's own kitchen (it never leaves it, and never keeps a platform filter). */
export function PulseProvider({ children, fixedScope }: { children: ReactNode; fixedScope?: string[] }) {
  const { locations, brands: allBrands, brandsByKitchen, channels: allChannels, stores } = useViewer();
  const params = useSearchParams();
  const pathname = usePathname();
  const deviceKitchen = fixedScope?.[0] ?? null;
  const catalog = useMemo(() => ({ kitchens: locations.map((l) => l.code), brands: allBrands, brandsByKitchen, channels: allChannels, stores }), [locations, allBrands, brandsByKitchen, allChannels, stores]);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [online, setOnline] = useState(true);
  const [site, setSiteState] = useState<Scope>(() => (deviceKitchen ? { kitchen: deviceKitchen, brand: null } : ALL_RESTAURANTS));
  const siteRef = useRef(site);
  const started = useRef(false);
  const inflight = useRef(false);
  const lastSync = useRef(0);

  const apply = useCallback((s: Scope) => { if (!sameScope(s, siteRef.current)) { siteRef.current = s; setSiteState(s); } }, []);

  // Address ↔ scope. A link carrying a scope wins; a page opened without one gets the scope back in its address.
  const urlKitchen = params?.get(KITCHEN_PARAM) ?? '';
  const urlBrand = params?.get(BRAND_PARAM) ?? '';
  const urlChannel = params?.get(CHANNEL_PARAM) ?? '';
  useEffect(() => {
    const first = !started.current;
    started.current = true;
    let remembered: Scope | null = null;
    if (first) { try { remembered = readRemembered(localStorage.getItem(SCOPE_KEY)) ?? readRemembered(localStorage.getItem(OLD_SCOPE_KEY)); } catch { /* private mode */ } }
    const url: Scope = urlChannel ? { kitchen: urlKitchen || null, brand: urlBrand || null, channel: urlChannel } : { kitchen: urlKitchen || null, brand: urlBrand || null };
    const { scope, writeUrl } = resolveScope({ url, current: first ? null : siteRef.current, remembered, deviceKitchen, catalog });
    apply(scope);
    remember(scope);
    if (writeUrl) window.history.replaceState(null, '', `${window.location.pathname}${withScopeQuery(window.location.search, scope)}${window.location.hash}`);
  }, [urlKitchen, urlBrand, urlChannel, pathname, deviceKitchen, catalog, apply]);

  const setSite = useCallback((patch: Partial<Scope>) => {
    const cur = siteRef.current;
    const next: Scope = { kitchen: cur.kitchen, brand: cur.brand, ...(cur.channel ? { channel: cur.channel } : {}), ...patch };
    // A kitchen tablet stays on its kitchen, with every platform.
    const s = validScope(deviceKitchen ? { kitchen: deviceKitchen, brand: next.kitchen === deviceKitchen ? next.brand : null } : next, catalog);
    apply(s);
    remember(s);
    window.history.pushState(null, '', `${window.location.pathname}${withScopeQuery(window.location.search, s)}${window.location.hash}`);
  }, [apply, catalog, deviceKitchen]);

  const scope = useMemo(() => scopeLocations(site), [site]);
  const brands = useMemo(() => scopeBrands(site), [site]);
  const channels = useMemo(() => scopeChannels(site), [site]);
  // The live pulse (new-order pop-up, cancellation alarm, badges, bell) follows the kitchen only, never a brand or a platform.
  const listen = useMemo(() => alarmLocations(site, deviceKitchen), [site, deviceKitchen]);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const q = listen.length ? `?locations=${listen.join(',')}` : '';
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
  }, [listen]);

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

  const value = useMemo(() => ({ pulse, refresh: load, site, setSite, scope, brands, channels, online }), [pulse, load, site, setSite, scope, brands, channels, online]);
  return <PulseCtx.Provider value={value}>{children}</PulseCtx.Provider>;
}

export function usePulse(): Ctx {
  const c = useContext(PulseCtx);
  if (!c) throw new Error('usePulse outside PulseProvider');
  return c;
}

/** The console's scope when inside the console (null elsewhere, e.g. a page without the console shell). */
export function useConsoleScope(): Pick<Ctx, 'site' | 'scope' | 'brands' | 'channels'> | null {
  const c = useContext(PulseCtx);
  return c ? { site: c.site, scope: c.scope, brands: c.brands, channels: c.channels } : null;
}

/** Internal links that keep the console's scope (?kitchen=…&brand=…&channel=…). Outside the console they stay as they are. */
export function useScopeHref(): (href: string) => string {
  const site = useContext(PulseCtx)?.site;
  return useCallback((href: string) => (site ? scopeHref(href, site) : href), [site]);
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
