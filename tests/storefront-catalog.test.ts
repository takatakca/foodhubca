// ON2GO storefront (task 44 package storefront): the public menu of an ordering page — 86s, alcohol, category hours,
// open / closed / paused (after-midnight slots), protected and "Do not touch" stores ignored, no private fields.
import { beforeEach, describe, expect, it } from 'vitest';
import { saveHours } from '../lib/foodhub/hours';
import { FORBIDDEN_STORE_IDS } from '../lib/foodhub/public-directory';
import { getRepo } from '../lib/foodhub/repo';
import { buildPublicMenu, clearStorefrontCache, isForbiddenStore, openState, pausedByStores, publicMenu } from '../lib/foodhub/storefront/catalog';
import { opensLabel } from '../lib/foodhub/storefront/i18n';
import { brandForSlug, getStorefrontSettings, resolveSettings, saveStorefrontSettings, slugify, type StorefrontBrand } from '../lib/foodhub/storefront/settings';
import { seedCatalog } from '../lib/foodhub/catalog';
import type { ChannelStore, HoursConfig } from '../lib/foodhub/types';
import { BRAND, LOC, SLUG, at, everyDay, fixtureMenu } from './helpers/storefront-fixture';

const owner = { username: 'owner', name: 'Owner', source: 'dashboard' as const };
const CFG: StorefrontBrand = { enabled: true, slug: SLUG, locationCode: LOC, payOnline: false, payAtPickup: true, pickupMaxTotal: 150 };
const HOURS: HoursConfig = { locations: { [LOC]: everyDay('11:00', '23:00') }, brands: {}, holidays: [] };

function store(over: Partial<ChannelStore>): ChannelStore {
  return { id: `s-${Math.random().toString(36).slice(2, 8)}`, channel: 'uber_eats', channelStoreId: 'ue-test-1', brandName: BRAND, locationCode: LOC, autoAccept: true, online: true, meta: {}, ...over };
}

function build(over: Partial<Parameters<typeof buildPublicMenu>[0]> = {}) {
  return buildPublicMenu({ slug: SLUG, brandName: BRAND, cfg: CFG, brandActive: true, menu: fixtureMenu(), hours: HOURS, stores: [], location: null, now: at(13), ...over });
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  delete process.env.FOODHUB_FEATURE_STOREFRONT;
  clearStorefrontCache();
});

describe('public menu: what a customer may order', () => {
  it('hides 86’d and unavailable items, unavailable options, alcohol, and items whose required choice has nothing left', () => {
    const { menu } = build();
    const refs = menu.categories.flatMap((c) => c.items.map((i) => i.ref));
    expect(refs).toContain('i-pita');
    expect(refs).not.toContain('i-plate'); // 86'd at this kitchen
    expect(refs).not.toContain('i-out'); // available: false
    expect(refs).not.toContain('i-beer'); // alcohol is never offered online
    expect(refs).not.toContain('i-sauce-only'); // required group with no option left
    const pita = menu.categories[0].items.find((i) => i.ref === 'i-pita')!;
    expect(pita.groups.find((g) => g.ref === 'g-extra')!.options.map((o) => o.ref)).toEqual(['m-cheese', 'm-garlic']); // hot sauce off
    // The same item 86'd at ANOTHER kitchen stays on this page.
    const other = build({ menu: { ...fixtureMenu(), unavailableByLocation: { SAINT_LEONARD: ['i-plate'] } } }).menu;
    expect(other.categories.flatMap((c) => c.items.map((i) => i.ref))).toContain('i-plate');
  });

  it('hides an item with no price (0 or missing), unless a required choice where every option costs something sets it', () => {
    const base = fixtureMenu();
    const menu = {
      ...base,
      items: [...base.items,
        { ref: 'i-free', name: 'No price yet', price: 0, categoryRef: 'c-main', available: true, modifierGroupRefs: [] },
        { ref: 'i-nan', name: 'Missing price', price: undefined as unknown as number, categoryRef: 'c-main', available: true, modifierGroupRefs: ['g-extra'] },
        { ref: 'i-by-size', name: 'Priced by size', price: 0, categoryRef: 'c-main', available: true, modifierGroupRefs: ['g-paid-size'] },
        { ref: 'i-free-size', name: 'Free size only', price: 0, categoryRef: 'c-main', available: true, modifierGroupRefs: ['g-size'] }],
      modifierGroups: [...base.modifierGroups, { ref: 'g-paid-size', name: 'Size', min: 1, max: 1, modifiers: [
        { ref: 'p-sm', name: 'Small', price: 6, available: true }, { ref: 'p-lg', name: 'Large', price: 9, available: true }] }],
    };
    const refs = build({ menu }).menu.categories.flatMap((c) => c.items.map((i) => i.ref));
    expect(refs).not.toContain('i-free');
    expect(refs).not.toContain('i-nan');
    expect(refs).not.toContain('i-free-size'); // its required size has a $0 option: still free
    expect(refs).toContain('i-by-size');
  });

  it('prices are the in-store base price; Duo / Trio / Combo groups are flagged as optional upsells', () => {
    const pita = build().menu.categories[0].items.find((i) => i.ref === 'i-pita')!;
    expect(pita.price).toBe(12.5);
    expect(pita.groups.map((g) => [g.ref, g.upsell])).toEqual([['g-size', false], ['g-extra', false], ['g-duo', true], ['g-trio', true]]);
    expect(pita.groups.find((g) => g.ref === 'g-duo')!.min).toBe(0);
  });

  it('never returns Clover ids, operator notes or merchant ids', () => {
    const text = JSON.stringify(build().menu);
    for (const secret of ['CLV-ITEM-PITA', 'CLV-MOD', 'posItemRef', 'posModifierRef', 'operator only note', 'MID-FIXTURE', 'posMerchantId', 'unavailableByLocation', LOC]) expect(text).not.toContain(secret);
  });

  it('a category outside its own schedule is shown greyed with the next start; inside it, it can be ordered', () => {
    const afternoon = build().menu.categories.find((c) => c.ref === 'c-bfast')!;
    expect(afternoon.available).toBe(false);
    expect(afternoon.availableFrom).toBe(new Date(at(7, 0, 15)).toISOString());
    const morning = build({ now: at(8) }).menu.categories.find((c) => c.ref === 'c-bfast')!;
    expect(morning.available).toBe(true);
  });
});

describe('open, closed, paused', () => {
  it('open with the closing time; closed with the next opening ("Ouvre aujourd’hui à 16 h")', () => {
    const late: HoursConfig = { locations: { [LOC]: everyDay('16:00', '03:00') }, brands: {}, holidays: [] };
    const afternoon = openState(late, BRAND, LOC, at(14));
    expect(afternoon.open).toBe(false);
    expect(afternoon.nextOpenAt).toBe(new Date(at(16)).toISOString());
    expect(opensLabel(Date.parse(afternoon.nextOpenAt!), at(14), 'fr')).toBe('Ouvre aujourd’hui à 16 h');
    expect(opensLabel(Date.parse(afternoon.nextOpenAt!), at(14), 'en')).toBe('Opens today at 4 PM');
    // After midnight, the evening slot runs on to 3 am (stored as 16:00–23:59 + 00:00–03:00).
    const night = openState(late, BRAND, LOC, at(1, 30, 15));
    expect(night.open).toBe(true);
    expect(night.closesAt).toBe(new Date(at(3, 0, 15)).toISOString());
    const evening = openState(late, BRAND, LOC, at(22));
    expect(evening.closesAt).toBe(new Date(at(3, 0, 15)).toISOString());
    // Whole-day hours: open, with no made-up closing time.
    const allDay = openState({ locations: { [LOC]: everyDay('00:00', '23:59') }, brands: {}, holidays: [] }, BRAND, LOC, at(13));
    expect(allDay).toEqual({ open: true, hoursKnown: true });
  });

  it('closed on a holiday; "Ouvre mardi à 9 h" a few days ahead; unknown hours are never "open"', () => {
    const cfg: HoursConfig = { locations: { [LOC]: { ...everyDay('09:00', '17:00'), wednesday: [], thursday: [], friday: [], saturday: [], sunday: [], monday: [] } }, brands: {}, holidays: [] };
    const s = openState(cfg, BRAND, LOC, at(13));
    expect(s.open).toBe(false);
    expect(opensLabel(Date.parse(s.nextOpenAt!), at(13), 'fr')).toBe('Ouvre mardi à 9 h');
    const holiday = openState({ ...HOURS, holidays: [{ id: 'h1', date: '2026-10-14', name: 'Fermé', locationCodes: [], closed: true }] }, BRAND, LOC, at(13));
    expect(holiday.open).toBe(false);
    expect(openState({ locations: {}, brands: {}, holidays: [] }, BRAND, LOC, at(13))).toEqual({ open: false, hoursKnown: false });
  });

  it('paused only when EVERY counted platform store is paused; protected, "Do not touch" and relay stores never count', () => {
    const forbiddenId = [...FORBIDDEN_STORE_IDS][0];
    const now = at(13);
    const pausedUber = store({ online: false });
    const pausedUntil = store({ channel: 'skip', channelStoreId: 'sk-1', online: true, pausedUntil: new Date(now + 600_000).toISOString() });
    expect(pausedByStores([pausedUber, pausedUntil], BRAND, LOC, now)).toBe(true);
    // The protected DoorDash store, a "Do not touch" store and a relay store are online — still paused.
    const forbidden = store({ channel: 'doordash', channelStoreId: 'dd-mapping', online: true, meta: { platformStoreId: forbiddenId } });
    const forbiddenById = store({ channel: 'doordash', channelStoreId: forbiddenId, online: true });
    const dnt = store({ channel: 'doordash', channelStoreId: 'dd-other', online: true, meta: { doNotTouch: true } });
    const relay = store({ channelStoreId: 'relay:abc', online: true });
    expect(isForbiddenStore(forbidden)).toBe(true);
    expect(isForbiddenStore(forbiddenById)).toBe(true);
    expect(pausedByStores([pausedUber, pausedUntil, forbidden, forbiddenById, dnt, relay], BRAND, LOC, now)).toBe(true);
    // A pause that ended, one store online, or no counted store at all: not paused.
    expect(pausedByStores([store({ online: true, pausedUntil: new Date(now - 60_000).toISOString() })], BRAND, LOC, now)).toBe(false);
    expect(pausedByStores([pausedUber, store({ channel: 'skip', online: true })], BRAND, LOC, now)).toBe(false);
    expect(pausedByStores([forbidden, dnt], BRAND, LOC, now)).toBe(false);
    // Another brand or kitchen never counts.
    expect(pausedByStores([store({ online: false, brandName: 'Po Poulet' })], BRAND, LOC, now)).toBe(false);
    expect(build({ stores: [pausedUber] }).menu.state.paused).toBe(true);
    expect(build({ brandActive: false }).menu.state.paused).toBe(true);
  });
});

describe('settings and the live page', () => {
  it('defaults: directory id as slug (unique), the brand’s first directory kitchen, everything off', () => {
    const s = resolveSettings(null, seedCatalog());
    expect(s.enabled).toBe(false);
    expect(s.brands['Pi Pita']).toMatchObject({ enabled: false, slug: 'pi-pita', locationCode: 'NDG_MAIN', payOnline: true, payAtPickup: true });
    expect(s.brands['Po Poulet'].locationCode).toBe('SAINT_LEONARD');
    const slugs = Object.values(s.brands).map((b) => b.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs.every((x) => /^[a-z0-9-]{2,40}$/.test(x))).toBe(true);
    expect(slugify('Crèmerie Bin Molle & Bin Dure')).toBe('cremerie-bin-molle-bin-dure');
  });

  it('404 until the master switch AND the brand are on; FOODHUB_FEATURE_STOREFRONT wins over the stored switch', async () => {
    await getRepo().saveMenu(fixtureMenu());
    await saveHours(HOURS);
    expect(await publicMenu(SLUG, at(13))).toBeNull();
    const base = await getStorefrontSettings();
    await saveStorefrontSettings({ enabled: true, brands: { [BRAND]: { ...base.brands[BRAND], enabled: false } } }, owner);
    clearStorefrontCache();
    expect(await publicMenu(SLUG, at(13))).toBeNull();
    await saveStorefrontSettings({ enabled: true, brands: { [BRAND]: { ...base.brands[BRAND], enabled: true } } }, owner);
    clearStorefrontCache();
    const live = await publicMenu(SLUG, at(13));
    expect(live?.state.open).toBe(true);
    expect(live?.brand.name).toBe('Pi Pita');
    process.env.FOODHUB_FEATURE_STOREFRONT = 'off';
    clearStorefrontCache();
    expect(await publicMenu(SLUG, at(13))).toBeNull();
    const logs = await getRepo().listActivity({ limit: 20 } as any).catch(() => []);
    expect(JSON.stringify(logs)).toContain('Commander direct');
  });

  it('refuses a slug used twice, a bad slug and an unknown kitchen', async () => {
    const base = await getStorefrontSettings();
    await expect(saveStorefrontSettings({ enabled: false, brands: { [BRAND]: { ...base.brands[BRAND], slug: 'po-poulet' } } }, owner)).rejects.toThrow(/same address|used by/);
    await expect(saveStorefrontSettings({ enabled: false, brands: { [BRAND]: { ...base.brands[BRAND], slug: 'Bad Slug!' } } }, owner)).rejects.toThrow(/slug/);
    await expect(saveStorefrontSettings({ enabled: false, brands: { [BRAND]: { ...base.brands[BRAND], locationCode: 'NOWHERE' } } }, owner)).rejects.toThrow(/unknown kitchen/);
    await saveStorefrontSettings({ enabled: false, brands: { [BRAND]: { ...base.brands[BRAND], slug: 'pita-ndg' } } }, owner);
    expect((await brandForSlug('pita-ndg'))?.brandName).toBe(BRAND);
    expect(await brandForSlug('pi-pita')).toBeNull();
  });
});
