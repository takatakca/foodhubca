// The public menu of a brand's ordering page: what a customer may order right now at the brand's kitchen.
//
//   getBrandMenu (shared menus and per-brand dishes) → menuForLocation (86s at that kitchen)
//   → hidden: unavailable items and options, alcohol, items whose required choice has nothing left
//   → categories outside their own schedule are shown greyed ("dès 7 h") and cannot be ordered
//   → price = the in-store base price (item.price) + option price — the same price as at the counter.
// Never returned: Clover ids (posItemRef / posModifierRef), operator notes, merchant or platform store ids.
//
// Open state: the brand's effective hours at that kitchen (holidays included, after-midnight slots joined) and a
// pause when EVERY platform store of the brand at that kitchen is paused. Stores marked "Do not touch" and the store the
// owner protects (FORBIDDEN_STORE_IDS) never count.
// Cached 60 s in memory (the checkout always rebuilds it fresh).
import { isAlcoholItem } from '../alcohol/rules';
import { isRelayStore } from '../adapters/relay';
import { getCatalog } from '../catalog';
import { effectiveHours, getHours, holidaysFor, localDate, normalizeWeek, openIntervals, weekIsEmpty } from '../hours';
import { isDoNotTouch } from '../menu/lock';
import { getBrandMenu } from '../menu/shared';
import { menuForLocation } from '../ops';
import { FORBIDDEN_STORE_IDS } from '../public-directory';
import { getRepo } from '../repo';
import { foodhubTimeZone } from '../time';
import type { ChannelStore, HoursConfig, MasterMenu, MenuItem, MenuModifier, MenuModifierGroup, WeeklyHours } from '../types';
import { brandForSlug, brandLive, seedBrandOf, seedKitchenOf, type StorefrontBrand } from './settings';

export interface PublicOption { ref: string; name: string; nameFr?: string; price: number }
export interface PublicGroup { ref: string; name: string; nameFr?: string; min: number; max: number; upsell: boolean; options: PublicOption[] }
export interface PublicItem {
  ref: string; name: string; nameFr?: string; description?: string; descriptionFr?: string; imageUrl?: string;
  tags: string[]; allergens: string[]; price: number; groups: PublicGroup[];
}
export interface PublicCategory {
  ref: string; name: string; nameFr?: string;
  /** Served now (its own schedule, when it has one). */
  available: boolean;
  /** Next time it is served (ISO), when not served now. */
  availableFrom?: string;
  items: PublicItem[];
}
export interface PublicState {
  open: boolean;
  /** Every platform store of the brand at this kitchen is paused (or the brand is off): no online orders. */
  paused: boolean;
  hoursKnown: boolean;
  closesAt?: string;
  nextOpenAt?: string;
}
export interface PublicMenu {
  slug: string;
  brand: { name: string; color: string; cuisine: { fr: string[]; en: string[] }; description: { fr: string; en: string } | null };
  location: { name: { fr: string; en: string }; street: string; city: string; region: string; postalCode: string; geo: { lat: number; lng: number } | null };
  state: PublicState;
  pay: { online: boolean; atPickup: boolean };
  note: { fr?: string; en?: string };
  categories: PublicCategory[];
  generatedAt: string;
}

/** What the checkout needs besides the public menu: the full location menu (with the Clover ids) and the settings. */
export interface SellableMenu {
  menu: PublicMenu;
  source: MasterMenu;
  brandName: string;
  locationCode: string;
  cfg: StorefrontBrand;
  live: boolean;
}

const UPSELL_RE = /^(duo|trio|combo)\b/i;
/** Duo / Trio / Combo: an optional meal upgrade, offered once after the item is added, never pre-selected. */
export function isUpsellGroup(g: Pick<MenuModifierGroup, 'name' | 'nameFr' | 'min'>): boolean {
  return g.min === 0 && (UPSELL_RE.test((g.name ?? '').trim()) || UPSELL_RE.test((g.nameFr ?? '').trim()));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function publicOption(m: MenuModifier): PublicOption {
  return { ref: m.ref, name: m.name, ...(m.nameFr ? { nameFr: m.nameFr } : {}), price: round2(Number(m.price) || 0) };
}

/** Groups of an item with only what can be ordered; null when a required choice has too few options left. */
function itemGroups(item: MenuItem, groups: Map<string, MenuModifierGroup>): PublicGroup[] | null {
  const out: PublicGroup[] = [];
  for (const ref of item.modifierGroupRefs ?? []) {
    const g = groups.get(ref);
    if (!g) continue;
    const options = g.modifiers.filter((m) => m.available !== false).map(publicOption);
    const min = Math.max(0, Math.floor(g.min || 0));
    if (options.length < min) return null;
    if (!options.length) continue;
    const max = Math.max(min, Math.floor(g.max || 0) || options.length);
    out.push({ ref: g.ref, name: g.name, ...(g.nameFr ? { nameFr: g.nameFr } : {}), min, max, upsell: isUpsellGroup(g), options });
  }
  return out;
}

function publicItem(item: MenuItem, groups: PublicGroup[]): PublicItem {
  return {
    ref: item.ref, name: item.name, ...(item.nameFr ? { nameFr: item.nameFr } : {}),
    ...(item.description ? { description: item.description } : {}), ...(item.descriptionFr ? { descriptionFr: item.descriptionFr } : {}),
    ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
    tags: (item.tags ?? []).filter((t) => t !== 'alcohol'), allergens: item.allergens ?? [], price: round2(Number(item.price) || 0), groups,
  };
}

/** Open intervals with back-to-back slots joined (16:00–23:59 then 00:00–03:00 = one evening until 3 am). */
function joined(week: WeeklyHours, holidays: HoursConfig['holidays'], from: number, to: number, tz: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [a, b] of openIntervals(week, holidays, from, to, tz)) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 60_000) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}

/** Open now, when it closes, when it opens next (within 8 days). Unknown hours = not open (never "always open"). */
export function openState(cfg: HoursConfig, brandName: string, locationCode: string, now: number, tz = foodhubTimeZone()): Omit<PublicState, 'paused'> {
  const week = effectiveHours(cfg, brandName, locationCode);
  if (!week || weekIsEmpty(week)) return { open: false, hoursKnown: false };
  const holidays = holidaysFor(cfg, locationCode, localDate(now - 2 * 86400_000, tz), 12);
  const iv = joined(week, holidays, now - 2 * 86400_000, now + 8 * 86400_000, tz);
  const cur = iv.find(([a, b]) => a <= now && now < b);
  const next = iv.find(([a]) => a > now)?.[0];
  return {
    open: Boolean(cur), hoursKnown: true,
    ...(cur ? { closesAt: new Date(cur[1] - 60_000).toISOString() } : {}),
    ...(!cur && next ? { nextOpenAt: new Date(next).toISOString() } : {}),
  };
}

/** Is a category served now (its own schedule; none = the store hours)? And from when, if not. */
export function categoryState(hours: WeeklyHours | null | undefined, now: number, tz = foodhubTimeZone()): { available: boolean; availableFrom?: string } {
  if (!hours) return { available: true };
  const week = normalizeWeek(hours);
  if (weekIsEmpty(week)) return { available: true };
  const iv = joined(week, [], now - 86400_000, now + 8 * 86400_000, tz);
  if (iv.some(([a, b]) => a <= now && now < b)) return { available: true };
  const next = iv.find(([a]) => a > now)?.[0];
  return { available: false, ...(next ? { availableFrom: new Date(next).toISOString() } : {}) };
}

/** A DoorDash store the owner protects (by its mapping id or the platform's own store number). */
export function isForbiddenStore(s: Pick<ChannelStore, 'channel' | 'channelStoreId' | 'meta'>): boolean {
  if (s.channel !== 'doordash') return false;
  const ids = [s.channelStoreId, s.meta?.platformStoreId].filter((x) => x !== undefined && x !== null).map((x) => String(x).trim());
  return ids.some((id) => FORBIDDEN_STORE_IDS.has(id));
}

/** Paused when every counted platform store of (brand, kitchen) is paused. No counted store = not paused. */
export function pausedByStores(stores: ChannelStore[], brandName: string, locationCode: string, now: number): boolean {
  const counted = stores.filter((s) => s.brandName === brandName && s.locationCode === locationCode && !isRelayStore(s) && !isDoNotTouch(s) && !isForbiddenStore(s));
  if (!counted.length) return false;
  return counted.every((s) => s.online === false || (s.pausedUntil ? Date.parse(s.pausedUntil) > now : false));
}

/** Builds the menu as the customer sees it (pure: every input passed in). */
export function buildPublicMenu(input: {
  slug: string; brandName: string; cfg: StorefrontBrand; brandActive: boolean; menu: MasterMenu | null; hours: HoursConfig; stores: ChannelStore[];
  location: { name?: string; address?: string; city?: string; postalCode?: string } | null; now: number; payOnlineReady?: boolean;
}): { menu: PublicMenu; source: MasterMenu } {
  const { slug, brandName, cfg, now } = input;
  const loc = cfg.locationCode;
  const empty: MasterMenu = { brandName, categories: [], items: [], modifierGroups: [], updatedAt: '' };
  const source = input.menu ? menuForLocation(input.menu, loc, now) : empty;
  const groups = new Map(source.modifierGroups.map((g) => [g.ref, g]));
  const categories: PublicCategory[] = [...source.categories].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((c) => {
    const items = source.items.filter((i) => i.categoryRef === c.ref && i.available !== false && !isAlcoholItem(i)).flatMap((i) => {
      const g = itemGroups(i, groups);
      return g ? [publicItem(i, g)] : [];
    });
    const st = categoryState(c.hours, now);
    return { ref: c.ref, name: c.name, ...(c.nameFr ? { nameFr: c.nameFr } : {}), ...st, items };
  }).filter((c) => c.items.length > 0);
  const seed = seedBrandOf(brandName);
  const kitchen = seedKitchenOf(loc);
  const state = openState(input.hours, brandName, loc, now);
  const paused = !input.brandActive || !cfg.enabled || pausedByStores(input.stores, brandName, loc, now);
  return {
    source,
    menu: {
      slug,
      brand: { name: seed?.name ?? brandName, color: /^#[0-9a-f]{6}$/i.test(seed?.color ?? '') ? seed!.color : '#1565d8', cuisine: { fr: seed?.cuisine.fr ?? [], en: seed?.cuisine.en ?? [] }, description: seed ? { fr: seed.description.fr, en: seed.description.en } : null },
      location: {
        name: kitchen?.name ?? { fr: input.location?.name ?? loc, en: input.location?.name ?? loc },
        street: kitchen?.address.street ?? input.location?.address ?? '', city: kitchen?.address.city ?? input.location?.city ?? '',
        region: kitchen?.address.region ?? 'QC', postalCode: kitchen?.address.postalCode ?? input.location?.postalCode ?? '', geo: kitchen?.geo ?? null,
      },
      state: { ...state, paused },
      pay: { online: cfg.payOnline && input.payOnlineReady !== false, atPickup: cfg.payAtPickup },
      note: { ...(cfg.noteFr ? { fr: cfg.noteFr } : {}), ...(cfg.noteEn ? { en: cfg.noteEn } : {}) },
      categories,
      generatedAt: new Date(now).toISOString(),
    },
  };
}

/** Loads everything and builds the menu of a slug (no cache). Null when the slug is unknown. */
export async function loadSellableMenu(slug: string, now = Date.now(), opts: { payOnlineReady?: boolean; checkPay?: boolean } = {}): Promise<SellableMenu | null> {
  const hit = await brandForSlug(slug);
  if (!hit) return null;
  const { brandName, cfg, settings } = hit;
  const [catalog, menu, hours, stores] = await Promise.all([getCatalog(), getBrandMenu(brandName), getHours(), getRepo().listStores()]);
  const brandActive = catalog.brands.some((b) => b.name === brandName && b.active);
  const location = catalog.locations.find((l) => l.code === cfg.locationCode) ?? null;
  const live = brandLive(settings, cfg);
  const payOnlineReady = opts.payOnlineReady ?? (opts.checkPay && live && cfg.payOnline ? await payReady(brandName, cfg.locationCode) : undefined);
  const built = buildPublicMenu({ slug, brandName, cfg, brandActive, menu, hours, stores, location, now, payOnlineReady });
  return { ...built, brandName, locationCode: cfg.locationCode, cfg, live };
}

const CACHE_MS = 60_000;
type Cached = { at: number; value: SellableMenu | null };
const cache = (): Map<string, Cached> => {
  const g = globalThis as unknown as { __fhStorefrontMenus?: Map<string, Cached> };
  g.__fhStorefrontMenus ??= new Map();
  return g.__fhStorefrontMenus;
};
export function clearStorefrontCache(): void { cache().clear(); }

/** Online payment ready for a kitchen (Clover Hosted Checkout, no texts needed). */
export async function payReady(brandName: string, locationCode: string): Promise<boolean> {
  const { paylinkReadiness } = await import('../delivery/paylink');
  return (await paylinkReadiness(brandName, locationCode, { needSms: false }).catch(() => ({ ok: false }))).ok;
}

/** The public menu of a slug (cached 60 s). Null when unknown or not live. */
export async function publicMenu(slug: string, now = Date.now()): Promise<PublicMenu | null> {
  const c = cache().get(slug);
  if (c && now - c.at >= 0 && now - c.at < CACHE_MS) return c.value?.live ? c.value.menu : null;
  const value = await loadSellableMenu(slug, now, { checkPay: true });
  cache().set(slug, { at: now, value });
  if (cache().size > 200) cache().delete(cache().keys().next().value as string);
  return value?.live ? value.menu : null;
}
