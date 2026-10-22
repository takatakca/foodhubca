'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Viewer } from '@/lib/foodhub/viewer';
import type { StorePoint } from '@/lib/foodhub/scope';
import { canUseFullView, viewCookie, type ViewMode } from '@/lib/ui/view-mode';

export type CatalogLite = {
  locations: Array<{ code: string; name: string; address?: string }>; brands: string[]; brandsByKitchen?: Record<string, string[]>;
  /** Platforms with at least one store the person can see (Uber Eats, DoorDash, Skip, TGTG order). */
  channels?: string[];
  /** One point per platform store (brand × location × platform), for counts only. */
  stores?: StorePoint[];
};
type Ctx = {
  viewer: Viewer; can: (perm: string) => boolean; allLocations: boolean; locations: CatalogLite['locations']; brands: string[];
  /** Brands each kitchen sells (scope picker, brand lists). */
  brandsByKitchen: Record<string, string[]>;
  /** Platforms the person has stores on, and the stores themselves (counts). */
  channels: string[]; stores: StorePoint[];
  locName: (code?: string | null) => string; features: string[];
  /** Full view (today's console with every tool) instead of the simple view. Only owners and managers can turn it on. */
  full: boolean;
  /** May this person switch to the full view (stores:map, not a kitchen tablet)? */
  canFull: boolean;
  /** Switch the view: writes the fh_view cookie and redraws the page from the server (no flash). */
  setFull: (on: boolean) => void;
};

const ViewerCtx = createContext<Ctx | null>(null);
const EMPTY: never[] = [];

/** `features`: expansion features the owner turned on (delivery, retail, alcohol, phone). `mode`: read from the cookie on the server. */
export function ViewerProvider({ viewer, catalog, features = [], mode = 'simple', children }: { viewer: Viewer; catalog: CatalogLite; features?: string[]; mode?: ViewMode; children: ReactNode }) {
  const router = useRouter();
  const can = useCallback((perm: string) => viewer.permissions.includes(perm as never), [viewer]);
  const locName = useCallback((code?: string | null) => (code ? catalog.locations.find((l) => l.code === code)?.name ?? code : '—'), [catalog]);
  const canFull = canUseFullView(viewer);
  const setFull = useCallback((on: boolean) => {
    document.cookie = viewCookie(on ? 'full' : 'simple', window.location.protocol === 'https:');
    router.refresh();
  }, [router]);
  const value = useMemo(() => ({
    viewer, can, allLocations: viewer.locations.length === 0, locations: catalog.locations, brands: catalog.brands, brandsByKitchen: catalog.brandsByKitchen ?? {},
    channels: catalog.channels ?? EMPTY, stores: catalog.stores ?? EMPTY, locName, features, full: canFull && mode === 'full', canFull, setFull,
  }), [viewer, can, catalog, locName, features, canFull, mode, setFull]);
  return <ViewerCtx.Provider value={value}>{children}</ViewerCtx.Provider>;
}

export function useViewer(): Ctx {
  const c = useContext(ViewerCtx);
  if (!c) throw new Error('useViewer outside ViewerProvider');
  return c;
}

/** Short location label: "NDG MAIN — 6280 Somerled" → "NDG MAIN". */
export function shortLoc(name: string) {
  return name.split(' — ')[0];
}
