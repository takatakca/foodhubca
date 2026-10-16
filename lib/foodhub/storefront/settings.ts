// "Commander direct" (ON2GO storefront) settings: a commission-free, pickup-only ordering page per brand at
// /commander/<slug>. Everything is OFF until the owner turns it on (master switch, then each brand).
//
// Stored in fh_kv 'storefront_settings_v1':
//   { enabled, brands: { <Food Hub brand name>: { enabled, slug, locationCode, payOnline, payAtPickup, noteFr?, noteEn? } } }
// The host can force the master switch with FOODHUB_FEATURE_STOREFRONT=on|off (the environment wins, same convention as
// the expansion features).
// Defaults per brand: slug = the public directory id of the brand (DIRECTORY_SEED), else a slug of its name; kitchen =
// the first active Food Hub location of that brand's first directory kitchen.
import { z } from 'zod';
import { logActivity, type Actor } from '../activity';
import { getCatalog, type Catalog } from '../catalog';
import { DIRECTORY_SEED } from '../public-directory';
import { getRepo } from '../repo';

const KEY = 'storefront_settings_v1';
export const SLUG_RE = /^[a-z0-9-]{2,40}$/;

export interface StorefrontBrand {
  enabled: boolean;
  slug: string;
  locationCode: string;
  /** Online payment by the Clover Hosted Checkout link (only when the kitchen is ready for it). */
  payOnline: boolean;
  /** Pay at the counter on pickup. */
  payAtPickup: boolean;
  noteFr?: string;
  noteEn?: string;
}

export interface StorefrontSettings {
  /** The stored master switch (the environment may override it: see storefrontSwitch). */
  enabled: boolean;
  brands: Record<string, StorefrontBrand>;
  updatedAt?: string;
  updatedBy?: string;
}

type Stored = Partial<Omit<StorefrontSettings, 'brands'>> & { brands?: Record<string, Partial<StorefrontBrand>> };

export function slugify(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'resto';
}

/** The public directory brand of a Food Hub brand (its id, colour, kitchens…), when there is one. */
export function seedBrandOf(brandName: string) {
  const n = brandName.trim().toLowerCase();
  return DIRECTORY_SEED.brands.find((b) => b.foodhubBrandNames.some((x) => x.trim().toLowerCase() === n)) ?? null;
}

/** The directory kitchen of a Food Hub location code. */
export function seedKitchenOf(locationCode: string) {
  return DIRECTORY_SEED.kitchens.find((k) => k.foodhubLocationCodes.includes(locationCode)) ?? null;
}

export function defaultLocationFor(brandName: string, catalog: Catalog): string {
  const active = catalog.locations.filter((l) => l.active).map((l) => l.code);
  const seed = seedBrandOf(brandName);
  for (const k of seed?.kitchens ?? []) {
    const kitchen = DIRECTORY_SEED.kitchens.find((x) => x.id === k.kitchen);
    const code = kitchen?.foodhubLocationCodes.find((c) => active.includes(c));
    if (code) return code;
  }
  return active[0] ?? '';
}

export function envSwitch(): boolean | null {
  const v = String(process.env.FOODHUB_FEATURE_STOREFRONT ?? '').trim().toLowerCase();
  if (['on', 'true', '1', 'yes'].includes(v)) return true;
  if (['off', 'false', '0', 'no'].includes(v)) return false;
  return null;
}

/** The master switch as it applies: the environment wins over the stored value. */
export function storefrontSwitch(s: Pick<StorefrontSettings, 'enabled'>): { on: boolean; source: 'env' | 'switch' } {
  const env = envSwitch();
  return env !== null ? { on: env, source: 'env' } : { on: Boolean(s.enabled), source: 'switch' };
}

const clean = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** Every active catalog brand, with defaults for what was never saved. Slugs are unique (a taken default gets a suffix). */
export function resolveSettings(stored: Stored | null, catalog: Catalog): StorefrontSettings {
  const brands: Record<string, StorefrontBrand> = {};
  const taken = new Set<string>();
  const saved = stored?.brands ?? {};
  // Saved slugs first: they are what the owner shared.
  for (const b of catalog.brands) { const s = saved[b.name]?.slug; if (s && SLUG_RE.test(s)) taken.add(s); }
  for (const b of catalog.brands.filter((x) => x.active)) {
    const s = saved[b.name] ?? {};
    let slug = s.slug && SLUG_RE.test(s.slug) ? s.slug : '';
    if (!slug) {
      const base = seedBrandOf(b.name)?.id ?? slugify(b.name);
      const candidates = [base, slugify(b.name), ...Array.from({ length: 20 }, (_, i) => `${base.slice(0, 37)}-${i + 2}`)];
      slug = candidates.find((c) => SLUG_RE.test(c) && !taken.has(c)) ?? `${base.slice(0, 30)}-${b.name.length}`;
      taken.add(slug);
    }
    const loc = s.locationCode && catalog.locations.some((l) => l.code === s.locationCode) ? s.locationCode : defaultLocationFor(b.name, catalog);
    brands[b.name] = {
      enabled: s.enabled === true, slug, locationCode: loc,
      payOnline: s.payOnline !== false, payAtPickup: s.payAtPickup !== false,
      ...(clean(s.noteFr, 280) ? { noteFr: clean(s.noteFr, 280) } : {}),
      ...(clean(s.noteEn, 280) ? { noteEn: clean(s.noteEn, 280) } : {}),
    };
  }
  return { enabled: stored?.enabled === true, brands, ...(stored?.updatedAt ? { updatedAt: stored.updatedAt } : {}), ...(stored?.updatedBy ? { updatedBy: stored.updatedBy } : {}) };
}

export async function getStorefrontSettings(): Promise<StorefrontSettings> {
  const stored = await getRepo().getKv<Stored>(KEY).catch(() => null);
  return resolveSettings(stored, await getCatalog());
}

/** The brand behind a public slug (only brands of the catalog; enabled or not — the caller decides). */
export async function brandForSlug(slug: string): Promise<{ brandName: string; cfg: StorefrontBrand; settings: StorefrontSettings } | null> {
  if (!SLUG_RE.test(slug)) return null;
  const settings = await getStorefrontSettings();
  const hit = Object.entries(settings.brands).find(([, c]) => c.slug === slug);
  return hit ? { brandName: hit[0], cfg: hit[1], settings } : null;
}

/** Is the page of this brand live (master switch on and brand on)? */
export function brandLive(settings: StorefrontSettings, cfg: StorefrontBrand | undefined): boolean {
  return storefrontSwitch(settings).on && Boolean(cfg?.enabled);
}

const brandSchema = z.object({
  enabled: z.boolean(),
  slug: z.string().trim().toLowerCase().regex(SLUG_RE, 'slug: 2–40 lowercase letters, digits or -'),
  locationCode: z.string().trim().min(1).max(40),
  payOnline: z.boolean(),
  payAtPickup: z.boolean(),
  noteFr: z.string().trim().max(280).optional(),
  noteEn: z.string().trim().max(280).optional(),
});
export const settingsSchema = z.object({ enabled: z.boolean(), brands: z.record(z.string().min(1).max(80), brandSchema) });

export type StorefrontInput = z.input<typeof settingsSchema>;

/** Saves the owner's settings (validated: slugs unique, kitchens known, one way to pay at least for a live brand). */
export async function saveStorefrontSettings(input: unknown, actor: Actor): Promise<StorefrontSettings> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 4).join('; '));
  const catalog = await getCatalog();
  const known = new Set(catalog.brands.map((b) => b.name));
  const slugs = new Map<string, string>();
  for (const [name, b] of Object.entries(parsed.data.brands)) {
    if (!known.has(name)) throw new Error(`Unknown brand: ${name}`);
    if (!catalog.locations.some((l) => l.code === b.locationCode)) throw new Error(`${name}: unknown kitchen ${b.locationCode}`);
    if (slugs.has(b.slug)) throw new Error(`The address /commander/${b.slug} is used by ${slugs.get(b.slug)} and ${name}.`);
    if (b.enabled && !b.payOnline && !b.payAtPickup) throw new Error(`${name}: choose at least one way to pay.`);
    slugs.set(b.slug, name);
  }
  const before = await getStorefrontSettings();
  const stored: Stored = { enabled: parsed.data.enabled, brands: { ...Object.fromEntries(Object.entries(before.brands)), ...parsed.data.brands }, updatedAt: new Date().toISOString(), updatedBy: actor.name };
  // A default slug of a brand not in this save may clash with a slug just saved: resolveSettings re-picks it.
  const next = resolveSettings(stored, catalog);
  const all = Object.values(next.brands).map((b) => b.slug);
  if (new Set(all).size !== all.length) throw new Error('Two brands would share the same address: change one slug.');
  await getRepo().setKv(KEY, { ...stored, brands: next.brands });
  const live = Object.entries(next.brands).filter(([, b]) => b.enabled).map(([n]) => n);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'storefront_settings', status: 'success',
    summary: `Commander direct (online ordering page) saved: master switch ${next.enabled ? 'ON' : 'OFF'}${envSwitch() !== null ? ' (server setting wins)' : ''}; brands on: ${live.length ? live.join(', ') : 'none'}` });
  return next;
}
