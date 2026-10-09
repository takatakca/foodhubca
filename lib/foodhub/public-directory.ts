// Public restaurant directory: the read-only feed behind GET /api/public/directory, used by ON2GO.ca (the Montréal
// food directory), QMAPS and partners.
//
// Public facts only: brand names and descriptions, the two kitchen addresses, opening hours, open now / open late,
// 10–12 highlight dishes per brand with their counter price and photo, and the order links (Clover online ordering
// first, then the delivery apps' public store pages). Never: orders, customers, money, merchant ids, tokens, staff
// notes, store meta or device data. Trending is a brand rank only, never a count.
//
// The base data is data/public/directory-seed.json (generated from the brand config and the Clover menu export).
// When the Food Hub database answers, its values win: hours (Settings → Hours, holidays included), dish name,
// price, photo and availability (master menu items matched by their Clover item id).
// Rule (owner's order): Po Poulet NDG (DoorDash store 27982486) is never linked. The seed test refuses it.
import seedJson from '../../data/public/directory-seed.json';
import { publicUrlCheck } from './public-url';
import { effectiveHours, holidaysFor, isOpenAt, localDate, normalizeWeek, DAYS } from './hours';
import { getRepo } from './repo';
import type { HoursConfig, MasterMenu, MenuItem, StoredOrder, WeeklyHours } from './types';

export type Lang = 'fr' | 'en';
export type Text = Record<Lang, string>;
export type OrderPlatform = 'clover' | 'ubereats' | 'doordash' | 'skip';

export interface SeedOrderLink { platform: 'ubereats' | 'doordash' | 'skip'; storeId?: string; slug?: string; url?: string; live: boolean }
export interface SeedBrand {
  id: string;
  name: string;
  alternateNames: string[];
  categories: string[];
  cuisine: Record<Lang, string[]>;
  description: Text;
  about: Record<Lang, string[]>;
  website: { url: string; live: boolean; planned: boolean };
  color: string;
  icon: string;
  featured: boolean;
  foodhubBrandNames: string[];
  kitchens: Array<{ kitchen: string; orderLinks: SeedOrderLink[] }>;
  dishes: string[];
}
export interface SeedKitchen {
  id: string;
  name: Text;
  area: string;
  address: { street: string; city: string; region: string; postalCode: string; country: string };
  geo: { lat: number; lng: number } | null;
  foodhubLocationCodes: string[];
  defaultHours: WeeklyHours;
  hoursSource: string;
}
export interface SeedDish { name: Text; price: number; category: string; deal: boolean; photo: boolean }
export interface DirectorySeed {
  version: number;
  updatedAt: string;
  timezone: string;
  kitchens: SeedKitchen[];
  brands: SeedBrand[];
  dishes: Record<string, SeedDish>;
}

export const DIRECTORY_SEED = seedJson as unknown as DirectorySeed;

/** Never linked anywhere (owner's order): Po Poulet NDG on DoorDash. */
export const FORBIDDEN_STORE_IDS = new Set(['27982486']);

export const CATEGORIES: Array<{ id: string; name: Text; emoji: string }> = [
  { id: 'pizza', name: { fr: 'Pizza', en: 'Pizza' }, emoji: '🍕' },
  { id: 'poulet', name: { fr: 'Poulet', en: 'Chicken' }, emoji: '🍗' },
  { id: 'burgers', name: { fr: 'Burgers et casse-croûte', en: 'Burgers and snack bar' }, emoji: '🍔' },
  { id: 'poutine', name: { fr: 'Poutine', en: 'Poutine' }, emoji: '🍟' },
  { id: 'libanais', name: { fr: 'Libanais', en: 'Lebanese' }, emoji: '🥙' },
  { id: 'grec', name: { fr: 'Grec', en: 'Greek' }, emoji: '🍢' },
  { id: 'mexicain', name: { fr: 'Mexicain', en: 'Mexican' }, emoji: '🌮' },
  { id: 'latino', name: { fr: 'Latino', en: 'Latin American' }, emoji: '🫓' },
  { id: 'grillades', name: { fr: 'Grillades', en: 'Grill' }, emoji: '🔥' },
  { id: 'sante', name: { fr: 'Santé', en: 'Healthy' }, emoji: '🥗' },
  { id: 'desserts', name: { fr: 'Desserts et gâteaux', en: 'Desserts and cakes' }, emoji: '🍰' },
  { id: 'creme-glacee', name: { fr: 'Crèmerie', en: 'Ice cream' }, emoji: '🍦' },
  { id: 'crepes', name: { fr: 'Crêpes et gaufres', en: 'Crêpes and waffles' }, emoji: '🥞' },
];

export interface PublicOrderLink { platform: OrderPlatform; label: string; url: Text; live: boolean }
export interface PublicLocation { kitchen: string; hours: WeeklyHours; openNow: boolean; openLate: boolean; order: PublicOrderLink[] }
export interface PublicDish { id: string; name: Text; price: number; currency: 'CAD'; photo: string | null; deal: boolean; available: boolean }
export interface PublicBrand {
  id: string;
  name: string;
  alternateNames: string[];
  categories: string[];
  cuisine: Record<Lang, string[]>;
  description: Text;
  about: Record<Lang, string[]>;
  website: { url: string; live: boolean };
  color: string;
  icon: string;
  featured: boolean;
  locations: PublicLocation[];
  dishes: PublicDish[];
}
export interface PublicKitchen {
  id: string;
  name: Text;
  area: string;
  address: SeedKitchen['address'];
  geo: SeedKitchen['geo'];
  phone: string | null;
  hours: WeeklyHours;
  openNow: boolean;
  openLate: boolean;
  brands: string[];
}
export interface PublicDirectory {
  version: 1;
  generatedAt: string;
  /** live = hours / dishes read from the Food Hub database; seed = the checked-in seed only. */
  source: 'live' | 'seed';
  timezone: string;
  /** Main order button first: Clover online ordering, then the delivery apps. */
  orderPriority: OrderPlatform[];
  categories: Array<{ id: string; name: Text; emoji: string; brands: string[] }>;
  kitchens: PublicKitchen[];
  brands: PublicBrand[];
  /** Brand ids ranked by Food Hub orders over the last 7 days (rank only; brands with too few orders are left out). */
  trending: string[];
}

export interface BuildOptions {
  now?: number;
  /** Food Hub hours (Settings → Hours). Missing location = the seed's hours. */
  hours?: HoursConfig | null;
  /** Food Hub master-menu items, by Clover item id (posItemRef). */
  menuItems?: Map<string, MenuItem> | null;
  /** Absolute base for "/media/…" photo paths (Food Hub public URL). */
  mediaBase?: string | null;
  /** Clover online ordering page of the merchant, and the kitchens it serves. */
  clover?: { url: string; kitchens: string[] } | null;
  phone?: string | null;
  trending?: string[];
  source?: 'live' | 'seed';
}

export const PLATFORM_LABEL: Record<OrderPlatform, string> = { clover: 'Clover', ubereats: 'Uber Eats', doordash: 'DoorDash', skip: 'SkipTheDishes' };
export const ORDER_PRIORITY: OrderPlatform[] = ['clover', 'ubereats', 'doordash', 'skip'];

/** Uber Eats store pages carry the store uuid as 16 bytes in base64url (no padding). */
export function uuidToBase64Url(uuid: string): string {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`bad uuid ${uuid}`);
  return Buffer.from(hex, 'hex').toString('base64url');
}

/** The store's public page on its delivery app, in the visitor's language. */
export function storeUrl(link: SeedOrderLink, lang: Lang): string {
  if (link.platform === 'doordash') return `https://www.doordash.com/${lang === 'fr' ? 'fr-CA' : 'en-CA'}/store/${link.storeId}/`;
  if (link.platform === 'ubereats') return `https://www.ubereats.com/${lang === 'fr' ? 'ca-fr' : 'ca'}/store/${link.slug}/${uuidToBase64Url(String(link.storeId))}`;
  return String(link.url);
}

/** Only real https pages of the platforms (a typo in the seed must not send visitors elsewhere). */
const PLATFORM_HOSTS: Record<OrderPlatform, RegExp> = {
  clover: /^https:\/\/(www\.)?clover\.com\/online-ordering\/[a-z0-9-]+\/?$/i,
  ubereats: /^https:\/\/www\.ubereats\.com\//,
  doordash: /^https:\/\/www\.doordash\.com\//,
  skip: /^https:\/\/www\.skipthedishes\.com\//,
};
export function isPlatformUrl(platform: OrderPlatform, url: string): boolean {
  return PLATFORM_HOSTS[platform].test(url);
}

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/**
 * "Open late" = open at 23:30 or later on at least 4 nights a week (a slot that runs past 23:30, or one that starts
 * after midnight and continues a late-evening slot). Montréal visitors read it as "still open after the usual 11 PM close".
 */
export function isOpenLate(week: WeeklyHours): boolean {
  let nights = 0;
  DAYS.forEach((day, i) => {
    const next = DAYS[(i + 1) % 7];
    const evening = (week[day] ?? []).some((s) => toMin(s.close) >= toMin('23:30') && toMin(s.open) <= toMin('23:30'));
    const afterMidnight = (week[day] ?? []).some((s) => toMin(s.close) >= 1439) && (week[next] ?? []).some((s) => s.open === '00:00' && toMin(s.close) > 0);
    if (evening || afterMidnight) nights += 1;
  });
  return nights >= 4;
}

function hoursFor(kitchen: SeedKitchen, brand: SeedBrand | null, cfg: HoursConfig | null | undefined): WeeklyHours {
  if (cfg) {
    for (const code of kitchen.foodhubLocationCodes) {
      for (const name of brand?.foodhubBrandNames ?? []) {
        const w = effectiveHours(cfg, name, code);
        if (w) return w;
      }
      const w = cfg.locations[code];
      if (w) return normalizeWeek(w);
    }
  }
  return normalizeWeek(kitchen.defaultHours);
}

function openNow(kitchen: SeedKitchen, week: WeeklyHours, cfg: HoursConfig | null | undefined, now: number, tz: string): boolean {
  const today = localDate(now, tz);
  const holidays = cfg ? kitchen.foodhubLocationCodes.flatMap((code) => holidaysFor(cfg, code, today, 1)) : [];
  return isOpenAt(week, holidays, now, tz);
}

function absolutePhoto(url: string | undefined, mediaBase: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https:\/\//i.test(url)) return url;
  if (url.startsWith('/media/') && mediaBase) return `${mediaBase.replace(/\/+$/, '')}${url}`;
  return null;
}

/** Pure: seed + optional live values → the public feed. Used by the route and by the snapshot export (same function). */
export function buildPublicDirectory(seed: DirectorySeed = DIRECTORY_SEED, opts: BuildOptions = {}): PublicDirectory {
  const now = opts.now ?? Date.now();
  const tz = seed.timezone || 'America/Toronto';
  const kitchensById = new Map(seed.kitchens.map((k) => [k.id, k]));
  const clover = opts.clover && isPlatformUrl('clover', opts.clover.url) ? opts.clover : null;

  const brands: PublicBrand[] = seed.brands.map((b) => {
    const locations: PublicLocation[] = b.kitchens.flatMap((k) => {
      const kitchen = kitchensById.get(k.kitchen);
      if (!kitchen) return [];
      const hours = hoursFor(kitchen, b, opts.hours);
      const order: PublicOrderLink[] = [];
      if (clover && clover.kitchens.includes(kitchen.id)) order.push({ platform: 'clover', label: PLATFORM_LABEL.clover, url: { fr: clover.url, en: clover.url }, live: true });
      for (const link of k.orderLinks) {
        if (link.storeId && FORBIDDEN_STORE_IDS.has(link.storeId)) continue;
        const url = { fr: storeUrl(link, 'fr'), en: storeUrl(link, 'en') };
        if (!isPlatformUrl(link.platform, url.fr) || !isPlatformUrl(link.platform, url.en)) continue;
        order.push({ platform: link.platform, label: PLATFORM_LABEL[link.platform], url, live: link.live });
      }
      order.sort((x, y) => Number(y.live) - Number(x.live) || ORDER_PRIORITY.indexOf(x.platform) - ORDER_PRIORITY.indexOf(y.platform));
      return [{ kitchen: kitchen.id, hours, openNow: openNow(kitchen, hours, opts.hours, now, tz), openLate: isOpenLate(hours), order }];
    });
    const dishes: PublicDish[] = b.dishes.flatMap((id) => {
      const d = seed.dishes[id];
      if (!d) return [];
      const live = opts.menuItems?.get(id);
      return [{
        id,
        name: { fr: live?.nameFr || d.name.fr, en: d.name.en || live?.name || d.name.fr },
        price: typeof live?.price === 'number' && live.price > 0 ? live.price : d.price,
        currency: 'CAD' as const,
        photo: absolutePhoto(live?.imageUrl, opts.mediaBase),
        deal: d.deal,
        available: live ? live.available !== false : true,
      }];
    });
    return {
      id: b.id, name: b.name, alternateNames: b.alternateNames, categories: b.categories, cuisine: b.cuisine,
      description: b.description, about: b.about, website: { url: b.website.url, live: b.website.live },
      color: b.color, icon: b.icon, featured: b.featured, locations, dishes,
    };
  });

  const kitchens: PublicKitchen[] = seed.kitchens.map((k) => {
    const hours = hoursFor(k, null, opts.hours);
    return {
      id: k.id, name: k.name, area: k.area, address: k.address, geo: k.geo, phone: opts.phone ?? null,
      hours, openNow: openNow(k, hours, opts.hours, now, tz), openLate: isOpenLate(hours),
      brands: brands.filter((b) => b.locations.some((l) => l.kitchen === k.id)).map((b) => b.id),
    };
  });

  const known = new Set(brands.map((b) => b.id));
  return {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    source: opts.source ?? 'seed',
    timezone: tz,
    orderPriority: ORDER_PRIORITY,
    categories: CATEGORIES.map((c) => ({ ...c, brands: brands.filter((b) => b.categories.includes(c.id)).map((b) => b.id) })).filter((c) => c.brands.length > 0),
    kitchens,
    brands,
    trending: (opts.trending ?? []).filter((id) => known.has(id)).slice(0, 8),
  };
}

// ---------- live values (server only) ----------

/** Brand ids ranked by order count over the last 7 days; a brand needs at least `min` orders to appear. */
export function rankTrending(orders: Array<Pick<StoredOrder, 'brandName' | 'status'>>, seed: DirectorySeed = DIRECTORY_SEED, min = 3): string[] {
  const byName = new Map<string, string>();
  for (const b of seed.brands) for (const n of b.foodhubBrandNames) byName.set(n.toLowerCase(), b.id);
  const counts = new Map<string, number>();
  for (const o of orders) {
    if (o.status === 'cancelled' || o.status === 'failed') continue;
    const id = o.brandName ? byName.get(o.brandName.toLowerCase()) : undefined;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}

/** Clover items by Clover id, from every stored master menu (a brand that shares a menu has the same items). */
export function itemsByCloverId(menus: MasterMenu[]): Map<string, MenuItem> {
  const out = new Map<string, MenuItem>();
  for (const m of menus) for (const it of m.items ?? []) if (it.posItemRef && !out.has(it.posItemRef)) out.set(it.posItemRef, it);
  return out;
}

export function cloverFromEnv(env: Record<string, string | undefined> = process.env): BuildOptions['clover'] {
  const url = (env.FOODHUB_PUBLIC_CLOVER_ORDER_URL || '').trim();
  if (!url || !isPlatformUrl('clover', url)) return null;
  const kitchens = (env.FOODHUB_PUBLIC_CLOVER_KITCHENS || 'ndg').split(',').map((s) => s.trim()).filter(Boolean);
  return { url, kitchens };
}

const TTL_MS = 5 * 60_000;
let cache: { at: number; value: PublicDirectory } | null = null;
let pending: Promise<PublicDirectory> | null = null;

async function loadLive(now: number): Promise<PublicDirectory> {
  const repo = getRepo();
  const env = process.env;
  const base = { now, clover: cloverFromEnv(env), phone: (env.FOODHUB_PUBLIC_PHONE || '').trim() || null };
  const mediaBase = publicUrlCheck().url || null;
  // Each part is optional: a database hiccup gives the seed values, never an error page.
  const [hours, menus, orders] = await Promise.all([
    repo.getKv<HoursConfig>('hours').catch(() => null),
    repo.listMenus().catch(() => null),
    repo.listOrders({ since: new Date(now - 7 * 86400_000).toISOString(), limit: 5000 }).catch(() => null),
  ]);
  const live = Boolean(hours || (menus && menus.length));
  return buildPublicDirectory(DIRECTORY_SEED, {
    ...base,
    hours: hours ? { locations: hours.locations ?? {}, brands: hours.brands ?? {}, holidays: hours.holidays ?? [] } : null,
    menuItems: menus ? itemsByCloverId(menus) : null,
    mediaBase,
    trending: orders ? rankTrending(orders) : [],
    source: live ? 'live' : 'seed',
  });
}

/** Cached 5 minutes; concurrent requests share one load. */
export async function getPublicDirectory(now = Date.now()): Promise<PublicDirectory> {
  if (cache && now - cache.at < TTL_MS) return cache.value;
  if (!pending) {
    pending = loadLive(now)
      .then((value) => { cache = { at: now, value }; return value; })
      .finally(() => { pending = null; });
  }
  return pending;
}

export function resetPublicDirectoryCache() { cache = null; pending = null; }

// ---------- CORS ----------

const DEFAULT_ORIGINS = ['https://on2go.ca', 'https://www.on2go.ca', 'https://preview.on2go.ca', 'https://qmaps.ca', 'https://www.qmaps.ca'];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/** The Origin to echo back, or null (no CORS header). Extra origins: FOODHUB_PUBLIC_CORS_ORIGINS="https://a.ca,https://b.ca". */
export function allowedOrigin(origin: string | null, extra = process.env.FOODHUB_PUBLIC_CORS_ORIGINS): string | null {
  if (!origin) return null;
  const list = [...DEFAULT_ORIGINS, ...(extra || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)];
  if (list.includes(origin) || LOCAL.test(origin)) return origin;
  return null;
}
