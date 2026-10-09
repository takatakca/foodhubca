'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { Viewer } from '@/lib/foodhub/viewer';

export type CatalogLite = { locations: Array<{ code: string; name: string; address?: string }>; brands: string[]; brandsByKitchen?: Record<string, string[]> };
type Ctx = {
  viewer: Viewer; can: (perm: string) => boolean; allLocations: boolean; locations: CatalogLite['locations']; brands: string[];
  /** Brands each kitchen sells (scope picker, brand lists). */
  brandsByKitchen: Record<string, string[]>;
  locName: (code?: string | null) => string; features: string[];
};

const ViewerCtx = createContext<Ctx | null>(null);

/** `features`: expansion features the owner turned on (delivery, retail, alcohol, phone). */
export function ViewerProvider({ viewer, catalog, features = [], children }: { viewer: Viewer; catalog: CatalogLite; features?: string[]; children: ReactNode }) {
  const can = useCallback((perm: string) => viewer.permissions.includes(perm as never), [viewer]);
  const locName = useCallback((code?: string | null) => (code ? catalog.locations.find((l) => l.code === code)?.name ?? code : '—'), [catalog]);
  const value = useMemo(() => ({ viewer, can, allLocations: viewer.locations.length === 0, locations: catalog.locations, brands: catalog.brands, brandsByKitchen: catalog.brandsByKitchen ?? {}, locName, features }), [viewer, can, catalog, locName, features]);
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
