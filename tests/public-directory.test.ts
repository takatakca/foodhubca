// Public directory feed (GET /api/public/directory) for ON2GO.ca / QMAPS: public facts only, Po Poulet NDG never linked,
// Clover first, hours from Food Hub when set, CORS allow-list, and the snapshot export used by ON2GO until the feed is deployed.
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allowedOrigin, buildPublicDirectory, cloverFromEnv, DIRECTORY_SEED, FORBIDDEN_STORE_IDS, isOpenLate, itemsByCloverId,
  rankTrending, resetPublicDirectoryCache, storeUrl, uuidToBase64Url,
} from '../lib/foodhub/public-directory';
import { allDayWeek, normalizeWeek } from '../lib/foodhub/hours';
import type { HoursConfig, MasterMenu, WeeklyHours } from '../lib/foodhub/types';

const week = (open: string, close: string): WeeklyHours =>
  normalizeWeek(Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, [{ open, close }]])) as unknown as WeeklyHours);
// Thursday 2026-10-08 22:00 in Montréal (EDT, UTC-4) = 02:00 UTC on Friday.
const THU_10PM = Date.parse('2026-10-09T02:00:00Z');
const THU_NOON = Date.parse('2026-10-08T16:00:00Z');

afterEach(() => {
  delete process.env.FOODHUB_PUBLIC_CLOVER_ORDER_URL;
  delete process.env.FOODHUB_PUBLIC_CLOVER_KITCHENS;
  resetPublicDirectoryCache();
});

describe('seed', () => {
  it('17 real brands in the two kitchens, 10–12 highlight dishes each, every dish known', () => {
    expect(DIRECTORY_SEED.brands).toHaveLength(17);
    expect(DIRECTORY_SEED.kitchens.map((k) => k.id)).toEqual(['ndg', 'saint-leonard']);
    for (const b of DIRECTORY_SEED.brands) {
      expect(b.dishes.length, b.id).toBeGreaterThanOrEqual(10);
      expect(b.dishes.length, b.id).toBeLessThanOrEqual(12);
      for (const d of b.dishes) expect(DIRECTORY_SEED.dishes[d], `${b.id} ${d}`).toBeTruthy();
      expect(b.description.fr.length).toBeGreaterThan(40);
      expect(b.description.en.length).toBeGreaterThan(40);
    }
    expect(new Set(DIRECTORY_SEED.brands.map((b) => b.id)).size).toBe(17);
  });

  it('never links Po Poulet NDG, never says ghost / virtual kitchen', () => {
    const raw = fs.readFileSync(path.resolve(__dirname, '../data/public/directory-seed.json'), 'utf8');
    for (const id of FORBIDDEN_STORE_IDS) expect(raw).not.toContain(id);
    expect(raw).not.toMatch(/ghost|virtual kitchen|cuisine fant[oô]me|cuisine virtuelle|delivery-only/i);
    const popoulet = DIRECTORY_SEED.brands.find((b) => b.id === 'po-poulet')!;
    expect(popoulet.kitchens.map((k) => k.kitchen)).toEqual(['saint-leonard']);
  });

  it('holds no private data (no email, no phone number, no merchant id, no token)', () => {
    const raw = fs.readFileSync(path.resolve(__dirname, '../data/public/directory-seed.json'), 'utf8');
    expect(raw).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(raw).not.toMatch(/\b\d{3}[ .-]\d{3}[ .-]\d{4}\b/);
    expect(raw).not.toMatch(/YJ4W50YPJQSQ1|RNVTBYMCKXEJ1|token|secret|password/i);
  });
});

describe('buildPublicDirectory', () => {
  it('kitchen hours, open now and open late (NDG 16:30–03:15 is late, Saint-Léonard 9–23 is not)', () => {
    const at10pm = buildPublicDirectory(DIRECTORY_SEED, { now: THU_10PM });
    const ndg = at10pm.kitchens.find((k) => k.id === 'ndg')!;
    const stl = at10pm.kitchens.find((k) => k.id === 'saint-leonard')!;
    expect(ndg.openLate).toBe(true);
    expect(stl.openLate).toBe(false);
    expect(ndg.openNow).toBe(true);
    expect(stl.openNow).toBe(true);
    const atNoon = buildPublicDirectory(DIRECTORY_SEED, { now: THU_NOON });
    expect(atNoon.kitchens.find((k) => k.id === 'ndg')!.openNow).toBe(false);
    expect(atNoon.kitchens.find((k) => k.id === 'saint-leonard')!.openNow).toBe(true);
    expect(ndg.address).toEqual({ street: '6280 Av Somerled', city: 'Montréal', region: 'QC', postalCode: 'H3X 2B6', country: 'CA' });
    expect(stl.address.street).toBe('5839 Rue Jean-Talon E');
    expect(stl.address.postalCode).toBe('H1S 1M4');
    expect(ndg.brands.length + stl.brands.length).toBeGreaterThan(20);
  });

  it('isOpenLate needs 4 late nights', () => {
    expect(isOpenLate(week('16:30', '03:15'))).toBe(true);
    expect(isOpenLate(week('09:00', '23:00'))).toBe(false);
    expect(isOpenLate(allDayWeek())).toBe(true);
    const twoNights = normalizeWeek({ friday: [{ open: '18:00', close: '02:00' }], saturday: [{ open: '18:00', close: '02:00' }] } as unknown as WeeklyHours);
    expect(isOpenLate(twoNights)).toBe(false);
  });

  it('Food Hub hours win over the seed (brand override, then location), holidays close the kitchen', () => {
    const hours: HoursConfig = { locations: { SAINT_LEONARD: week('11:00', '02:00') }, brands: { 'Pi Pita': week('12:00', '13:00') }, holidays: [] };
    const d = buildPublicDirectory(DIRECTORY_SEED, { now: THU_10PM, hours });
    expect(d.kitchens.find((k) => k.id === 'saint-leonard')!.openLate).toBe(true);
    const pipita = d.brands.find((b) => b.id === 'pi-pita')!;
    expect(pipita.locations.every((l) => !l.openNow)).toBe(true);
    const closed: HoursConfig = { locations: {}, brands: {}, holidays: [{ id: 'h', date: '2026-10-08', name: 'Fermé', locationCodes: ['SAINT_LEONARD'], closed: true }] };
    expect(buildPublicDirectory(DIRECTORY_SEED, { now: THU_10PM, hours: closed }).kitchens.find((k) => k.id === 'saint-leonard')!.openNow).toBe(false);
  });

  it('order links: real platform pages, live first, Clover first when configured (NDG by default)', () => {
    const d = buildPublicDirectory(DIRECTORY_SEED, { now: THU_10PM, clover: cloverFromEnv({ FOODHUB_PUBLIC_CLOVER_ORDER_URL: 'https://www.clover.com/online-ordering/on2go-test' }) });
    const ooeuf = d.brands.find((b) => b.id === 'ooeuf')!;
    const ndg = ooeuf.locations.find((l) => l.kitchen === 'ndg')!;
    expect(ndg.order[0]).toMatchObject({ platform: 'clover', live: true, url: { fr: 'https://www.clover.com/online-ordering/on2go-test' } });
    expect(ndg.order[1].platform).toBe('ubereats');
    expect(ndg.order[1].url.fr).toMatch(/^https:\/\/www\.ubereats\.com\/ca-fr\/store\/[^/]+\/[A-Za-z0-9_-]{22}$/);
    expect(ndg.order[1].url.en).toMatch(/^https:\/\/www\.ubereats\.com\/ca\/store\//);
    expect(ooeuf.locations.find((l) => l.kitchen === 'saint-leonard')!.order.some((o) => o.platform === 'clover')).toBe(false);
    for (const b of d.brands) for (const l of b.locations) {
      for (const o of l.order) {
        expect(o.url.fr).toMatch(/^https:\/\/(www\.)?(ubereats|doordash|clover|skipthedishes)\.com\//);
        for (const id of FORBIDDEN_STORE_IDS) expect(o.url.fr + o.url.en).not.toContain(id);
      }
      const live = l.order.map((o) => o.live);
      expect(live).toEqual([...live].sort((x, y) => Number(y) - Number(x)));
    }
    expect(cloverFromEnv({ FOODHUB_PUBLIC_CLOVER_ORDER_URL: 'https://evil.example/online-ordering/x' })).toBeNull();
  });

  it('Uber uuid → base64url and DoorDash store pages', () => {
    expect(uuidToBase64Url('627d09f0-8fb4-57f2-8ec1-6a71984ad267')).toBe('Yn0J8I-0V_KOwWpxmErSZw');
    expect(storeUrl({ platform: 'doordash', storeId: '34525477', live: true }, 'fr')).toBe('https://www.doordash.com/fr-CA/store/34525477/');
  });

  it('dishes: live Food Hub name / price / photo when the item is in the master menu (matched by Clover id)', () => {
    const menu = { brandName: 'PPP Pizzeria', categories: [], modifierGroups: [], updatedAt: '', items: [
      { ref: 'x', name: 'All dressed pizza', nameFr: 'Pizza toute garnie', price: 12.5, imageUrl: '/media/abc.webp', categoryRef: 'c', available: false, posItemRef: 'FYJ5QXV8R7VT2', modifierGroupRefs: [] },
    ] } as MasterMenu;
    const d = buildPublicDirectory(DIRECTORY_SEED, { menuItems: itemsByCloverId([menu]), mediaBase: 'https://foodhub.on2go.ca/' });
    const dish = d.brands.find((b) => b.id === 'ppp-pizzeria')!.dishes.find((x) => x.id === 'FYJ5QXV8R7VT2')!;
    expect(dish).toMatchObject({ price: 12.5, photo: 'https://foodhub.on2go.ca/media/abc.webp', available: false, currency: 'CAD' });
    expect(dish.name.fr).toBe('Pizza toute garnie');
    const seedOnly = buildPublicDirectory(DIRECTORY_SEED).brands.find((b) => b.id === 'ppp-pizzeria')!.dishes[0];
    expect(seedOnly.photo).toBeNull();
    expect(seedOnly.price).toBeGreaterThan(0);
  });

  it('output carries no private field', () => {
    const json = JSON.stringify(buildPublicDirectory(DIRECTORY_SEED, { trending: ['ooeuf', 'nope'] }));
    expect(json).not.toMatch(/foodhubLocationCodes|foodhubBrandNames|posItemRef|merchant|customer|subtotal|token/i);
    expect(JSON.parse(json).trending).toEqual(['ooeuf']);
  });
});

describe('trending', () => {
  it('ranks brands by order count (rank only), skips cancelled orders and brands under the minimum', () => {
    const o = (brandName: string, status = 'completed') => ({ brandName, status }) as never;
    const ranked = rankTrending([o('OOeuf'), o('OOeuf'), o('OOeuf'), o('Pi Pita'), o('Pi Pita'), o('Pi Pita'), o('Pi Pita'), o('Taco Mexican'), o('PPP Pizzeria', 'cancelled')]);
    expect(ranked).toEqual(['pi-pita', 'ooeuf']);
  });
});

describe('CORS and the route', () => {
  it('allows on2go.ca, qmaps.ca and localhost only', () => {
    expect(allowedOrigin('https://on2go.ca', '')).toBe('https://on2go.ca');
    expect(allowedOrigin('https://www.qmaps.ca', '')).toBe('https://www.qmaps.ca');
    expect(allowedOrigin('http://localhost:3000', '')).toBe('http://localhost:3000');
    expect(allowedOrigin('https://evil.example', '')).toBeNull();
    expect(allowedOrigin('https://on2go.ca.evil.example', '')).toBeNull();
    expect(allowedOrigin('https://partner.example', 'https://partner.example/')).toBe('https://partner.example');
  });

  it('GET answers without sign-in, with cache and CORS headers; OPTIONS answers 204', async () => {
    const { proxy } = await import('../proxy');
    process.env.SESSION_SECRET = 's'.repeat(64);
    process.env.DASHBOARD_PASSWORD = 'p'.repeat(16);
    expect((await proxy(new NextRequest('http://hub.local/api/public/directory'))).headers.get('x-middleware-next')).toBe('1');
    const { GET, OPTIONS } = await import('../app/api/public/directory/route');
    const res = await GET(new Request('http://hub.local/api/public/directory', { headers: { origin: 'https://on2go.ca' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://on2go.ca');
    expect(res.headers.get('cache-control')).toMatch(/max-age=300/);
    const body = await res.json();
    expect(body.version).toBe(1);
    expect(body.brands).toHaveLength(17);
    const other = await GET(new Request('http://hub.local/api/public/directory', { headers: { origin: 'https://evil.example' } }));
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    expect((await OPTIONS(new Request('http://hub.local/api/public/directory', { method: 'OPTIONS', headers: { origin: 'https://qmaps.ca' } }))).status).toBe(204);
  });
});

// Snapshot for ON2GO.ca until the feed is deployed (same function as the route, seed values only):
//   PUBLIC_DIRECTORY_SNAPSHOT=../on2goca/data/directory.json npx vitest run tests/public-directory.test.ts
describe.runIf(Boolean(process.env.PUBLIC_DIRECTORY_SNAPSHOT))('snapshot export', () => {
  it('writes the feed', () => {
    const out = path.resolve(process.cwd(), process.env.PUBLIC_DIRECTORY_SNAPSHOT!);
    const feed = buildPublicDirectory(DIRECTORY_SEED, { clover: cloverFromEnv(), phone: process.env.FOODHUB_PUBLIC_PHONE || null });
    fs.writeFileSync(out, JSON.stringify(feed, null, 2) + '\n');
    expect(fs.existsSync(out)).toBe(true);
  });
});
