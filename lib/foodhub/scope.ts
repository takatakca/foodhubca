// The console's one scope, like DoorDash Merchant's store picker: every restaurant → one kitchen → one brand.
// Kept in the page address (?kitchen=NDG_MAIN&brand=Po%20Poulet) so a link opens the same view, and remembered on the
// device so a page opened without it gets it back. Pure functions (no React, no Node APIs): used by the browser and
// tested on their own.
//
// The scope only narrows what a screen SHOWS. It never sends anything to a platform, and the live alarms (new-order
// pop-up, cancellation alarm, kitchen screen) are never narrowed to a brand: see `alarmLocations`.

export const KITCHEN_PARAM = 'kitchen';
export const BRAND_PARAM = 'brand';

export interface Scope {
  /** Location code (a kitchen), or null = every kitchen the person can see. */
  kitchen: string | null;
  /** Brand name, or null = every brand. A brand without a kitchen = that brand in all its kitchens. */
  brand: string | null;
}

export const ALL_RESTAURANTS: Scope = Object.freeze({ kitchen: null, brand: null }) as Scope;

/** What the person may pick: their kitchens, and the brands each kitchen sells. */
export interface ScopeCatalog {
  kitchens: string[];
  brands: string[];
  brandsByKitchen: Record<string, string[]>;
}

const clean = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  return s ? s.slice(0, 120) : null;
};

/** Scope from a query string (or URLSearchParams). With a catalog, anything the person cannot pick is dropped. */
export function parseScope(query: string | URLSearchParams, catalog?: ScopeCatalog): Scope {
  const q = typeof query === 'string' ? new URLSearchParams(query.startsWith('?') ? query.slice(1) : query) : query;
  return validScope({ kitchen: clean(q.get(KITCHEN_PARAM)), brand: clean(q.get(BRAND_PARAM)) }, catalog);
}

/** Keeps only a kitchen the person can see and a brand that exists (and is sold in that kitchen, when one is picked). */
export function validScope(scope: Partial<Scope> | null | undefined, catalog?: ScopeCatalog): Scope {
  let kitchen = clean(scope?.kitchen ?? null);
  let brand = clean(scope?.brand ?? null);
  if (!catalog) return { kitchen, brand };
  if (kitchen && !catalog.kitchens.includes(kitchen)) kitchen = null;
  if (brand) {
    const sold = kitchen ? catalog.brandsByKitchen[kitchen] ?? [] : catalog.brands;
    // A brand not sold in the picked kitchen: keep the kitchen, drop the brand (never show an empty brand page).
    if (!sold.includes(brand)) brand = null;
  }
  return { kitchen, brand };
}

export function sameScope(a: Scope, b: Scope): boolean {
  return (a.kitchen ?? null) === (b.kitchen ?? null) && (a.brand ?? null) === (b.brand ?? null);
}

export function isAllRestaurants(s: Scope): boolean {
  return !s.kitchen && !s.brand;
}

/** The query string with the scope written in (other parameters kept, in place). Returns '' or '?…'. */
export function withScopeQuery(query: string, scope: Scope): string {
  const q = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  if (scope.kitchen) q.set(KITCHEN_PARAM, scope.kitchen); else q.delete(KITCHEN_PARAM);
  if (scope.brand) q.set(BRAND_PARAM, scope.brand); else q.delete(BRAND_PARAM);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** An internal link that keeps the scope: `/orders` → `/orders?kitchen=NDG_MAIN`. External links are left alone. */
export function scopeHref(href: string, scope: Scope): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  const hashAt = href.indexOf('#');
  const hash = hashAt >= 0 ? href.slice(hashAt) : '';
  const noHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const qAt = noHash.indexOf('?');
  const path = qAt >= 0 ? noHash.slice(0, qAt) : noHash;
  const query = qAt >= 0 ? noHash.slice(qAt) : '';
  return `${path}${withScopeQuery(query, scope)}${hash}`;
}

/** `locations=` for the API: the picked kitchen, or none (= every kitchen the person may see; the server enforces it). */
export function scopeLocations(scope: Scope): string[] {
  return scope.kitchen ? [scope.kitchen] : [];
}

/** `brands=` for the API. */
export function scopeBrands(scope: Scope): string[] {
  return scope.brand ? [scope.brand] : [];
}

/**
 * Locations the live alarms listen to. A brand never narrows them: an order for another brand of the same kitchen
 * must still ring. A kitchen tablet always listens to its own kitchen.
 */
export function alarmLocations(scope: Scope, deviceKitchen?: string | null): string[] {
  if (deviceKitchen) return [deviceKitchen];
  return scopeLocations(scope);
}

/** Does a row (order, store, matrix line) belong to the scope? */
export function inScope(row: { locationCode?: string | null; brandName?: string | null }, scope: Scope): boolean {
  if (scope.kitchen && row.locationCode !== scope.kitchen) return false;
  if (scope.brand && row.brandName !== scope.brand) return false;
  return true;
}

export function filterByScope<T extends { locationCode?: string | null; brandName?: string | null }>(rows: readonly T[], scope: Scope): T[] {
  return rows.filter((r) => inScope(r, scope));
}

const byName = (a: string, b: string) => a.localeCompare(b, 'fr', { sensitivity: 'base' });

/** Brands sold in each kitchen, from (brand, location) pairs: platform stores, the DoorDash seed, the matrix. */
export function buildScopeCatalog(kitchens: readonly string[], pairs: ReadonlyArray<{ brandName?: string | null; locationCode?: string | null }>, brands: readonly string[]): ScopeCatalog {
  const known = new Set(brands);
  const byKitchen: Record<string, Set<string>> = Object.fromEntries(kitchens.map((k) => [k, new Set<string>()]));
  for (const p of pairs) {
    if (!p.brandName || !p.locationCode || !byKitchen[p.locationCode] || !known.has(p.brandName)) continue;
    byKitchen[p.locationCode].add(p.brandName);
  }
  return {
    kitchens: [...kitchens],
    brands: [...brands].sort(byName),
    brandsByKitchen: Object.fromEntries(Object.entries(byKitchen).map(([k, set]) => [k, [...set].sort(byName)])),
  };
}

/**
 * Which scope the screen uses, and whether the address must be rewritten.
 * - The address wins when it carries a scope (a shared link, the Back button).
 * - Otherwise the scope already on screen is kept (a link that forgot it), else the one remembered on the device.
 * - A kitchen tablet is always on its own kitchen.
 */
export function resolveScope(opts: { url: Scope; current?: Scope | null; remembered?: Scope | null; deviceKitchen?: string | null; catalog?: ScopeCatalog }): { scope: Scope; writeUrl: boolean } {
  const url = validScope(opts.url, opts.catalog);
  const fromUrl = !isAllRestaurants(opts.url);
  let scope = fromUrl ? url : validScope(opts.current ?? opts.remembered ?? ALL_RESTAURANTS, opts.catalog);
  if (opts.deviceKitchen) scope = { kitchen: opts.deviceKitchen, brand: scope.kitchen === opts.deviceKitchen ? scope.brand : null };
  return { scope, writeUrl: !sameScope(scope, opts.url) };
}

/** Remembered scope (localStorage text) → Scope; anything unreadable = every restaurant. */
export function readRemembered(raw: string | null | undefined): Scope | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    // The old screen stored a list of location codes: one code = that kitchen; several = every restaurant.
    if (Array.isArray(v)) return v.length === 1 && typeof v[0] === 'string' ? { kitchen: v[0], brand: null } : ALL_RESTAURANTS;
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return { kitchen: typeof o.kitchen === 'string' ? o.kitchen : null, brand: typeof o.brand === 'string' ? o.brand : null };
    }
  } catch { /* unreadable */ }
  return null;
}

// ---------- a brand's state at a glance (one row of the brand list) ----------

export type CellState = 'online' | 'closed' | 'paused' | 'deactivated' | 'unknown' | 'not_synced' | 'missing';
export type BrandOpenState = 'open' | 'paused' | 'closed' | 'deactivated' | 'not_connected';

/**
 * One word for a brand in a kitchen, from its platform cells: open if any platform takes orders, else paused if one
 * is paused, else closed (hours), else deactivated, else not connected.
 */
export function brandOpenState(cells: ReadonlyArray<{ state: CellState | string }>): BrandOpenState {
  const s = cells.map((c) => c.state);
  if (s.includes('online')) return 'open';
  if (s.includes('paused')) return 'paused';
  if (s.includes('closed') || s.includes('not_synced') || s.includes('unknown')) return 'closed';
  if (s.includes('deactivated')) return 'deactivated';
  return 'not_connected';
}

/** A stable colour index (0–7) for a brand's monogram, so a brand keeps its colour everywhere. */
export function brandHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 8;
}

/** "Bin molle & Bin Dure" → "BB", "OOeuf" → "OO", "Po Poulet" → "PP". */
export function brandInitials(name: string): string {
  const words = name.replace(/[&+]/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? name).slice(0, 2).toUpperCase();
}

/** One line of a brand list: a brand in a kitchen, its platforms and today's numbers. */
export interface BrandRow {
  brandName: string;
  locationCode: string;
  state: BrandOpenState;
  /** Platform → its state (uber_eats, doordash, skip, tgtg). */
  cells: Record<string, CellState>;
  orders: number;
  sales: number;
  open: number;
}

/**
 * The brand list of a scope: every brand × kitchen line of the store grid inside the scope, with today's orders and
 * sales. Kitchens keep the given order, brands are alphabetical inside a kitchen.
 */
export function brandRows(
  matrix: ReadonlyArray<{ brandName: string; locationCode: string; cells: Record<string, { state: CellState | string }> }>,
  stats: ReadonlyArray<{ brandName: string; locationCode: string; orders: number; sales: number; open?: number }>,
  scope: Scope,
  kitchenOrder: readonly string[] = [],
): BrandRow[] {
  const stat = new Map(stats.map((s) => [`${s.brandName}|${s.locationCode}`, s]));
  const rank = (code: string) => { const i = kitchenOrder.indexOf(code); return i < 0 ? kitchenOrder.length : i; };
  return matrix
    .filter((r) => inScope(r, scope))
    .map((r) => {
      const s = stat.get(`${r.brandName}|${r.locationCode}`);
      const cells = Object.fromEntries(Object.entries(r.cells).map(([ch, c]) => [ch, c.state as CellState]));
      return { brandName: r.brandName, locationCode: r.locationCode, state: brandOpenState(Object.values(r.cells)), cells, orders: s?.orders ?? 0, sales: s?.sales ?? 0, open: s?.open ?? 0 };
    })
    .sort((a, b) => rank(a.locationCode) - rank(b.locationCode) || byName(a.brandName, b.brandName));
}
