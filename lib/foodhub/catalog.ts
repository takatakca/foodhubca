// Brands and locations (Atlas "Brands" + "Locations"). Seeded from your real data
// (data/actual), plus anything added in Food Hub → Business setup. Stored in fh_kv.
import { normalizePhone } from './notify';
import { parseProvince } from './taxes';
import rawBrands from '../../data/actual/brands.json';
import rawLocations from '../../data/actual/locations.json';
import { getRepo } from './repo';
import { parseAccent, parseLogo } from './brand-kit';

export interface LocationDef {
  code: string;
  name: string;
  address: string;
  city?: string;
  /** Province or territory (postal code, e.g. QC): sets the sales taxes quoted and the delivery address. Read from the postal code when empty. */
  province?: string;
  postalCode?: string;
  /** The kitchen's own phone (landline): the Watchtower calls it first when a tablet is off or an order waits — like Uber does. */
  phone?: string | null;
  active: boolean;
  seed?: boolean;
}

export interface BrandDef {
  name: string;
  active: boolean;
  seed?: boolean;
  /** Brand kit (docs/BRAND_KIT.md): the brand's accent colour, `#rrggbb` (lib/foodhub/brand-kit.ts parseAccent). */
  accent?: string;
  /** The brand's real logo: an https address or a media library photo (`/media/<name>`). Never an AI-generated image. */
  logo?: string;
}

/** A brand being saved. `accent` / `logo`: left out = keep what is saved; '' or null = remove it. */
export type BrandInput = { name: string; active: boolean; accent?: string | null; logo?: string | null };

export interface Catalog {
  locations: LocationDef[];
  brands: BrandDef[];
}

const KEY = 'catalog';
/** Too Good To Go is a sales channel, not one of your brands. */
const NOT_BRANDS = new Set(['Too Good To Go']);

export function seedCatalog(): Catalog {
  return {
    locations: (rawLocations as Array<{ code: string; name: string; address_line_1: string; city?: string; postal_code?: string }>).map((l) => ({
      code: l.code, name: l.name, address: l.address_line_1, city: l.city, postalCode: l.postal_code, active: true, seed: true,
    })),
    brands: (rawBrands as string[]).filter((b) => !NOT_BRANDS.has(b)).map((name) => ({ name, active: true, seed: true })),
  };
}

/** The catalog (seed + saved). `strict`: a failed database read throws instead of falling back to the seed (billing). */
export async function getCatalog(opts: { strict?: boolean } = {}): Promise<Catalog> {
  const seed = seedCatalog();
  const read = getRepo().getKv<Partial<Catalog>>(KEY);
  const stored = (await (opts.strict ? read : read.catch(() => null))) ?? {};
  const locations = new Map(seed.locations.map((l) => [l.code, l]));
  for (const l of stored.locations ?? []) locations.set(l.code, { ...locations.get(l.code), ...l });
  const brands = new Map(seed.brands.map((b) => [b.name, b]));
  for (const b of stored.brands ?? []) brands.set(b.name, { ...brands.get(b.name), ...b });
  return {
    locations: [...locations.values()],
    brands: [...brands.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  };
}

export async function activeLocations(): Promise<LocationDef[]> {
  return (await getCatalog()).locations.filter((l) => l.active);
}

export async function saveLocation(def: LocationDef): Promise<Catalog> {
  if (!/^[A-Z0-9_]{2,30}$/.test(def.code)) throw new Error('Location code: 2–30 capital letters, digits or _ (e.g. LAVAL).');
  if (!def.name?.trim()) throw new Error('Location name is required.');
  const stored = (await getRepo().getKv<Partial<Catalog>>(KEY)) ?? {};
  const list = (stored.locations ?? []).filter((l) => l.code !== def.code);
  list.push({ code: def.code, name: def.name.trim(), address: (def.address || '').trim(), city: def.city?.trim(), province: parseProvince(def.province) ?? undefined, postalCode: def.postalCode?.trim(), phone: def.phone ? normalizePhone(def.phone) : null, active: def.active !== false });
  await getRepo().setKv(KEY, { ...stored, locations: list });
  return getCatalog();
}

export async function saveBrand(def: BrandInput): Promise<Catalog> {
  const name = def.name?.trim();
  if (!name) throw new Error('Brand name is required.');
  // Brand lists travel as comma-separated query strings (?brands=a,b) — a comma would split the brand in two.
  if (name.includes(',')) throw new Error('Brand name cannot contain a comma (,).');
  if (NOT_BRANDS.has(name)) throw new Error(`${name} is a sales channel, not a brand.`);
  // Brand kit: checked before anything is written (a refused colour or logo saves nothing).
  const accent = def.accent === undefined ? undefined : parseAccent(def.accent);
  if (accent && !accent.ok) throw new Error(accent.error);
  const logo = def.logo === undefined ? undefined : parseLogo(def.logo);
  if (logo && !logo.ok) throw new Error(logo.error);
  const stored = (await getRepo().getKv<Partial<Catalog>>(KEY)) ?? {};
  const prev = (stored.brands ?? []).find((b) => b.name === name);
  const list = (stored.brands ?? []).filter((b) => b.name !== name);
  // Turning a brand off or on (no accent / logo sent) keeps its colour and logo.
  const prevAccent = parseAccent(prev?.accent);
  const prevLogo = parseLogo(prev?.logo);
  const keptAccent = accent ? accent.value : prevAccent.ok ? prevAccent.value : null;
  const keptLogo = logo ? logo.value : prevLogo.ok ? prevLogo.value : null;
  list.push({ name, active: def.active !== false, ...(keptAccent ? { accent: keptAccent } : {}), ...(keptLogo ? { logo: keptLogo } : {}) });
  await getRepo().setKv(KEY, { ...stored, brands: list });
  return getCatalog();
}

export function locationLabel(catalog: Catalog, code?: string | null): string {
  if (!code) return 'unmapped store';
  return catalog.locations.find((l) => l.code === code)?.name ?? code;
}
