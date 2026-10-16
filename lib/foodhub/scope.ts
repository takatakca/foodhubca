// The console's one scope, like DoorDash Merchant's store picker: every restaurant → one location (succursale) → one
// brand, and on a third axis one platform (Uber Eats, DoorDash, Skip, Too Good To Go).
// Kept in the page address (?kitchen=LOC_1&brand=Marque%20A&channel=doordash) so a link opens the same view, and
// remembered on the device so a page opened without it gets it back. Pure functions (no React, no Node APIs): used by the
// browser and tested on their own.
//
// The scope only narrows what a screen SHOWS. It never sends anything to a platform, and the live alarms (new-order
// pop-up, cancellation alarm, kitchen screen) are never narrowed to a brand or a platform: see `alarmLocations`.

export const KITCHEN_PARAM = 'kitchen';
export const BRAND_PARAM = 'brand';
/** The platform axis. Same word as the APIs and the stored rows (`channel`). */
export const CHANNEL_PARAM = 'channel';

/** The platforms, in the order every screen lists them. */
export const CHANNEL_ORDER = ['uber_eats', 'doordash', 'skip', 'tgtg'] as const;
const CHANNEL_NAMES: Record<string, string> = { uber_eats: 'Uber Eats', doordash: 'DoorDash', skip: 'Skip', tgtg: 'Too Good To Go' };
/** A platform's short name on screen ("Skip" for SkipTheDishes). Platform names are never translated. */
export function channelName(channel: string): string {
  return CHANNEL_NAMES[channel] ?? channel;
}

export interface Scope {
  /** Location code (a kitchen), or null = every kitchen the person can see. */
  kitchen: string | null;
  /** Brand name, or null = every brand. A brand without a kitchen = that brand in all its kitchens. */
  brand: string | null;
  /** Platform (uber_eats, doordash, skip, tgtg). Absent = every platform. Only written when set. */
  channel?: string;
}

export const ALL_RESTAURANTS: Scope = Object.freeze({ kitchen: null, brand: null }) as Scope;

/** One platform store, for counts only (no store or merchant id): a brand × a location × a platform. */
export interface StorePoint {
  brandName: string;
  locationCode: string;
  channel: string;
}

/** What the person may pick: their kitchens, the brands each kitchen sells, and the platforms they have stores on. */
export interface ScopeCatalog {
  kitchens: string[];
  brands: string[];
  brandsByKitchen: Record<string, string[]>;
  /** Platforms with at least one store the person can see. Absent = platforms are not checked against a list. */
  channels?: string[];
  /** Every store the person can see (counts). Absent = a platform is never dropped for having no store. */
  stores?: StorePoint[];
}

const clean = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  return s ? s.slice(0, 120) : null;
};

/** A scope literal that carries `channel` only when one is set (a scope without a platform keeps its two keys). */
function make(kitchen: string | null, brand: string | null, channel?: string | null): Scope {
  return channel ? { kitchen, brand, channel } : { kitchen, brand };
}

/** Scope from a query string (or URLSearchParams). With a catalog, anything the person cannot pick is dropped. */
export function parseScope(query: string | URLSearchParams, catalog?: ScopeCatalog): Scope {
  const q = typeof query === 'string' ? new URLSearchParams(query.startsWith('?') ? query.slice(1) : query) : query;
  return validScope({ kitchen: clean(q.get(KITCHEN_PARAM)), brand: clean(q.get(BRAND_PARAM)), channel: clean(q.get(CHANNEL_PARAM)) ?? undefined }, catalog);
}

/**
 * Keeps only a kitchen the person can see, a brand that exists (and is sold in that kitchen, when one is picked), and a
 * known platform the person has stores on — with at least one store for the picked kitchen and brand, so a page is never
 * empty because of the platform.
 */
export function validScope(scope: Partial<Scope> | null | undefined, catalog?: ScopeCatalog): Scope {
  let kitchen = clean(scope?.kitchen ?? null);
  let brand = clean(scope?.brand ?? null);
  let channel = clean(scope?.channel ?? null);
  if (channel && !(CHANNEL_ORDER as readonly string[]).includes(channel)) channel = null;
  if (!catalog) return make(kitchen, brand, channel);
  if (kitchen && !catalog.kitchens.includes(kitchen)) kitchen = null;
  if (brand) {
    const sold = kitchen ? catalog.brandsByKitchen[kitchen] ?? [] : catalog.brands;
    // A brand not sold in the picked kitchen: keep the kitchen, drop the brand (never show an empty brand page).
    if (!sold.includes(brand)) brand = null;
  }
  if (channel && catalog.channels && !catalog.channels.includes(channel)) channel = null;
  if (channel && catalog.stores && countStores(catalog, { kitchen, brand, channel }) === 0) channel = null;
  return make(kitchen, brand, channel);
}

export function sameScope(a: Scope, b: Scope): boolean {
  return (a.kitchen ?? null) === (b.kitchen ?? null) && (a.brand ?? null) === (b.brand ?? null) && (a.channel ?? null) === (b.channel ?? null);
}

/** No location and no brand (a platform may still be picked): "Tous les restaurants". */
export function isAllRestaurants(s: Scope): boolean {
  return !s.kitchen && !s.brand;
}

/** Nothing picked at all: no location, no brand, no platform. */
export function isEverything(s: Scope): boolean {
  return !s.kitchen && !s.brand && !s.channel;
}

/** The query string with the scope written in (other parameters kept, in place). Returns '' or '?…'. */
export function withScopeQuery(query: string, scope: Scope): string {
  const q = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  if (scope.kitchen) q.set(KITCHEN_PARAM, scope.kitchen); else q.delete(KITCHEN_PARAM);
  if (scope.brand) q.set(BRAND_PARAM, scope.brand); else q.delete(BRAND_PARAM);
  if (scope.channel) q.set(CHANNEL_PARAM, scope.channel); else q.delete(CHANNEL_PARAM);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** An internal link that keeps the scope: `/orders` → `/orders?kitchen=LOC_1`. External links are left alone. */
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

/** `channels=` for the API. */
export function scopeChannels(scope: Scope): string[] {
  return scope.channel ? [scope.channel] : [];
}

/**
 * Locations the live alarms listen to. A brand or a platform never narrows them: an order for another brand (or on
 * another platform) of the same kitchen must still ring. A kitchen tablet always listens to its own kitchen.
 */
export function alarmLocations(scope: Scope, deviceKitchen?: string | null): string[] {
  if (deviceKitchen) return [deviceKitchen];
  return scopeLocations(scope);
}

type ScopedRow = { locationCode?: string | null; brandName?: string | null; channel?: string | null };

/**
 * Does a row (order, store, matrix line) belong to the scope? A row without a platform (a matrix line covers every
 * platform) passes the platform filter.
 */
export function inScope(row: ScopedRow, scope: Scope): boolean {
  if (scope.kitchen && row.locationCode !== scope.kitchen) return false;
  if (scope.brand && row.brandName !== scope.brand) return false;
  if (scope.channel && typeof row.channel === 'string' && row.channel !== scope.channel) return false;
  return true;
}

/**
 * Same, but a row that names no location, no brand or no platform passes that filter: for alerts, so a problem that
 * covers a whole location ("tablet offline") is never hidden by a brand or platform filter.
 */
export function inScopeLoose(row: ScopedRow, scope: Scope): boolean {
  if (scope.kitchen && row.locationCode && row.locationCode !== scope.kitchen) return false;
  if (scope.brand && row.brandName && row.brandName !== scope.brand) return false;
  if (scope.channel && row.channel && row.channel !== scope.channel) return false;
  return true;
}

export function filterByScope<T extends ScopedRow>(rows: readonly T[], scope: Scope): T[] {
  return rows.filter((r) => inScope(r, scope));
}

/** How many platform stores the scope covers ("45 magasins"). */
export function countStores(catalog: Pick<ScopeCatalog, 'stores'>, scope: Scope): number {
  return (catalog.stores ?? []).filter((p) => inScope(p, scope)).length;
}

const channelRank = (ch: string) => { const i = (CHANNEL_ORDER as readonly string[]).indexOf(ch); return i < 0 ? CHANNEL_ORDER.length : i; };

/**
 * Stores per platform for a location and a brand (the platform chips: "DoorDash (15)"), in the usual platform order.
 * Lists the catalog's platforms (or every platform with a store), with 0 when none matches the location and brand.
 */
export function channelCounts(catalog: Pick<ScopeCatalog, 'stores' | 'channels'>, scope: Pick<Scope, 'kitchen' | 'brand'>): Array<{ channel: string; count: number }> {
  const stores = catalog.stores ?? [];
  const list = catalog.channels ?? CHANNEL_ORDER.filter((ch) => stores.some((p) => p.channel === ch));
  return [...list].sort((a, b) => channelRank(a) - channelRank(b)).map((channel) => ({ channel, count: countStores({ stores }, { kitchen: scope.kitchen, brand: scope.brand, channel }) }));
}

/** The platforms that have stores, in the usual order (for the catalog). */
export function channelsOf(stores: readonly StorePoint[]): string[] {
  return [...new Set(stores.map((s) => s.channel))].sort((a, b) => channelRank(a) - channelRank(b));
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
 * - The address wins when it carries a scope (a shared link, the Back button), even a platform alone.
 * - Otherwise the scope already on screen is kept (a link that forgot it), else the one remembered on the device.
 * - A kitchen tablet is always on its own kitchen, with every platform.
 */
export function resolveScope(opts: { url: Scope; current?: Scope | null; remembered?: Scope | null; deviceKitchen?: string | null; catalog?: ScopeCatalog }): { scope: Scope; writeUrl: boolean } {
  const url = validScope(opts.url, opts.catalog);
  const fromUrl = !isEverything(opts.url);
  let scope = fromUrl ? url : validScope(opts.current ?? opts.remembered ?? ALL_RESTAURANTS, opts.catalog);
  // A kitchen tablet never keeps a platform filter: its kitchen sees every order, whatever the platform.
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
      // Saved before the platform axis: no channel = every platform.
      return make(typeof o.kitchen === 'string' ? o.kitchen : null, typeof o.brand === 'string' ? o.brand : null, typeof o.channel === 'string' ? o.channel : null);
    }
  } catch { /* unreadable */ }
  return null;
}

// ---------- a brand's state at a glance (one row of the brand list) ----------

export type CellState = 'online' | 'closed' | 'paused' | 'deactivated' | 'unknown' | 'not_synced' | 'missing';
export type BrandOpenState = 'open' | 'paused' | 'closed' | 'deactivated' | 'not_connected';
const OPEN_RANK: Record<BrandOpenState, number> = { open: 0, paused: 1, closed: 2, deactivated: 3, not_connected: 4 };

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

export const BRAND_HUES = 10;
/** A stable colour index (0–9) for a brand's monogram, so a brand keeps its colour everywhere. */
export function brandHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % BRAND_HUES;
}

/**
 * A brand's monogram, told apart from its neighbours: a short first word stays as written ("Po Poulet" → "Po",
 * "Pi Pita" → "Pi", "PPP Pizzeria" → "PPP"); otherwise first and last initials ("Cafe Bolon" → "CB",
 * "Crèmerie Bin Molle Bin Dure" → "CD"); one word → its first two letters ("OOeuf" → "OO").
 */
export function brandInitials(name: string): string {
  const words = name.replace(/[&+]/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (!words.length) return name.slice(0, 2).toUpperCase();
  if (words.length >= 2 && words[0].length <= 3) return words[0];
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return words[0].slice(0, 2).toUpperCase();
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
 * sales. Kitchens keep the given order; inside a kitchen the brands taking orders come first, then paused, closed,
 * deactivated and not connected, alphabetical within each. With a platform picked: only the lines that have a store on
 * that platform, their state is that platform's state, and `cells` holds that one platform.
 */
export function brandRows(
  matrix: ReadonlyArray<{ brandName: string; locationCode: string; cells: Record<string, { state: CellState | string }> }>,
  stats: ReadonlyArray<{ brandName: string; locationCode: string; orders: number; sales: number; open?: number }>,
  scope: Scope,
  kitchenOrder: readonly string[] = [],
): BrandRow[] {
  const stat = new Map(stats.map((s) => [`${s.brandName}|${s.locationCode}`, s]));
  const rank = (code: string) => { const i = kitchenOrder.indexOf(code); return i < 0 ? kitchenOrder.length : i; };
  const ch = scope.channel;
  return matrix
    .filter((r) => inScope(r, scope) && (!ch || (r.cells[ch] !== undefined && r.cells[ch].state !== 'missing')))
    .map((r) => {
      const s = stat.get(`${r.brandName}|${r.locationCode}`);
      const entries: Array<[string, { state: CellState | string }]> = ch ? [[ch, r.cells[ch]]] : Object.entries(r.cells);
      const cells = Object.fromEntries(entries.map(([k, c]) => [k, c.state as CellState]));
      return { brandName: r.brandName, locationCode: r.locationCode, state: brandOpenState(entries.map(([, c]) => c)), cells, orders: s?.orders ?? 0, sales: s?.sales ?? 0, open: s?.open ?? 0 };
    })
    .sort((a, b) => rank(a.locationCode) - rank(b.locationCode) || OPEN_RANK[a.state] - OPEN_RANK[b.state] || byName(a.brandName, b.brandName));
}
