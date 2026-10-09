// The console's scope (every restaurant → a kitchen → a brand): kept in the address, filters every screen, never
// narrows the live alarms to a brand, and never touches the Po Poulet NDG DoorDash lock.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  alarmLocations, ALL_RESTAURANTS, brandHue, brandInitials, brandOpenState, brandRows, buildScopeCatalog, filterByScope, inScope,
  parseScope, readRemembered, resolveScope, sameScope, scopeBrands, scopeHref, scopeLocations, validScope, withScopeQuery,
} from '../lib/foodhub/scope';
import { averagePrepMinutes, buildCommandCenter } from '../lib/foodhub/command';
import { BUILT_IN_MENU_LOCKS, isMenuLocked, menuLockOf } from '../lib/foodhub/menu/lock';
import type { StoredOrder } from '../lib/foodhub/types';

const catalog = buildScopeCatalog(
  ['NDG_MAIN', 'SAINT_LEONARD', 'HOCHELAGA'],
  [
    { brandName: 'Po Poulet', locationCode: 'NDG_MAIN' },
    { brandName: 'Pi Pita', locationCode: 'NDG_MAIN' },
    { brandName: 'Po Poulet', locationCode: 'SAINT_LEONARD' },
    { brandName: 'Nutrition Shake', locationCode: 'SAINT_LEONARD' },
    { brandName: 'Pi Pita', locationCode: 'NDG_MAIN' }, // twice: listed once
    { brandName: 'Not A Brand', locationCode: 'NDG_MAIN' }, // not in the catalog: ignored
    { brandName: 'Po Poulet', locationCode: 'VERDUN' }, // a kitchen the person cannot see: ignored
  ],
  ['Po Poulet', 'Pi Pita', 'Nutrition Shake', 'OOeuf'],
);

describe('scope ↔ address', () => {
  it('reads ?kitchen= and ?brand= (with or without "?", trimmed)', () => {
    expect(parseScope('?kitchen=NDG_MAIN&brand=Po%20Poulet')).toEqual({ kitchen: 'NDG_MAIN', brand: 'Po Poulet' });
    expect(parseScope('kitchen=NDG_MAIN')).toEqual({ kitchen: 'NDG_MAIN', brand: null });
    expect(parseScope(new URLSearchParams('brand=+Pi+Pita+'))).toEqual({ kitchen: null, brand: 'Pi Pita' });
    expect(parseScope('')).toEqual(ALL_RESTAURANTS);
    expect(parseScope('?range=7d&kitchen=')).toEqual(ALL_RESTAURANTS);
  });

  it('writes the scope back, keeping the other parameters, and round-trips', () => {
    const s = { kitchen: 'NDG_MAIN', brand: 'Po Poulet' };
    const q = withScopeQuery('?range=7d&open=abc', s);
    expect(q).toBe('?range=7d&open=abc&kitchen=NDG_MAIN&brand=Po+Poulet');
    expect(parseScope(q)).toEqual(s);
    expect(withScopeQuery(q, ALL_RESTAURANTS)).toBe('?range=7d&open=abc');
    expect(withScopeQuery('', ALL_RESTAURANTS)).toBe('');
    expect(withScopeQuery('?kitchen=HOCHELAGA&brand=X', { kitchen: 'NDG_MAIN', brand: null })).toBe('?kitchen=NDG_MAIN');
  });

  it('links inside the console keep the scope; outside links and hashes are left alone', () => {
    const s = { kitchen: 'NDG_MAIN', brand: null };
    expect(scopeHref('/orders', s)).toBe('/orders?kitchen=NDG_MAIN');
    expect(scopeHref('/orders?open=42#top', s)).toBe('/orders?open=42&kitchen=NDG_MAIN#top');
    expect(scopeHref('/stores?kitchen=OLD', ALL_RESTAURANTS)).toBe('/stores');
    expect(scopeHref('https://example.com/x', s)).toBe('https://example.com/x');
    expect(scopeHref('//evil.example/x', s)).toBe('//evil.example/x');
  });

  it('drops a kitchen the person cannot see and a brand not sold in the picked kitchen', () => {
    expect(parseScope('?kitchen=VERDUN', catalog)).toEqual(ALL_RESTAURANTS);
    expect(parseScope('?kitchen=SAINT_LEONARD&brand=Pi%20Pita', catalog)).toEqual({ kitchen: 'SAINT_LEONARD', brand: null });
    expect(parseScope('?brand=Nope', catalog)).toEqual(ALL_RESTAURANTS);
    expect(parseScope('?brand=OOeuf', catalog)).toEqual({ kitchen: null, brand: 'OOeuf' }); // a brand everywhere
    expect(validScope({ kitchen: 'NDG_MAIN', brand: 'Pi Pita' }, catalog)).toEqual({ kitchen: 'NDG_MAIN', brand: 'Pi Pita' });
  });

  it('lists each kitchen’s brands once, alphabetically, only known brands and visible kitchens', () => {
    expect(catalog.brandsByKitchen).toEqual({ NDG_MAIN: ['Pi Pita', 'Po Poulet'], SAINT_LEONARD: ['Nutrition Shake', 'Po Poulet'], HOCHELAGA: [] });
    expect(catalog.kitchens).not.toContain('VERDUN');
  });
});

describe('which scope a screen uses', () => {
  const ndg = { kitchen: 'NDG_MAIN', brand: null };
  it('a link carrying a scope wins (shared link, Back button)', () => {
    expect(resolveScope({ url: { kitchen: 'SAINT_LEONARD', brand: 'Po Poulet' }, current: ndg, catalog })).toEqual({ scope: { kitchen: 'SAINT_LEONARD', brand: 'Po Poulet' }, writeUrl: false });
  });
  it('a page opened without a scope keeps the one on screen and writes it into the address', () => {
    expect(resolveScope({ url: ALL_RESTAURANTS, current: ndg, catalog })).toEqual({ scope: ndg, writeUrl: true });
  });
  it('the first screen gets the scope remembered on the device', () => {
    expect(resolveScope({ url: ALL_RESTAURANTS, remembered: { kitchen: 'NDG_MAIN', brand: 'Po Poulet' }, catalog }).scope).toEqual({ kitchen: 'NDG_MAIN', brand: 'Po Poulet' });
    expect(resolveScope({ url: ALL_RESTAURANTS, catalog })).toEqual({ scope: ALL_RESTAURANTS, writeUrl: false });
  });
  it('a bad address is cleaned', () => {
    expect(resolveScope({ url: { kitchen: 'VERDUN', brand: null }, catalog })).toEqual({ scope: ALL_RESTAURANTS, writeUrl: true });
  });
  it('a kitchen tablet never leaves its kitchen', () => {
    expect(resolveScope({ url: { kitchen: 'SAINT_LEONARD', brand: null }, deviceKitchen: 'NDG_MAIN', catalog }).scope).toEqual(ndg);
    expect(resolveScope({ url: { kitchen: 'NDG_MAIN', brand: 'Pi Pita' }, deviceKitchen: 'NDG_MAIN', catalog }).scope).toEqual({ kitchen: 'NDG_MAIN', brand: 'Pi Pita' });
  });
  it('the old saved list of locations still works (one = that kitchen, several = every restaurant)', () => {
    expect(readRemembered('["NDG_MAIN"]')).toEqual(ndg);
    expect(readRemembered('["NDG_MAIN","HOCHELAGA"]')).toEqual(ALL_RESTAURANTS);
    expect(readRemembered('{"kitchen":"NDG_MAIN","brand":"Po Poulet"}')).toEqual({ kitchen: 'NDG_MAIN', brand: 'Po Poulet' });
    expect(readRemembered('not json')).toBeNull();
    expect(readRemembered(null)).toBeNull();
  });
  it('compares scopes', () => {
    expect(sameScope({ kitchen: 'A', brand: null }, { kitchen: 'A', brand: null })).toBe(true);
    expect(sameScope({ kitchen: 'A', brand: 'X' }, { kitchen: 'A', brand: null })).toBe(false);
  });
});

describe('filters by kitchen and brand', () => {
  const rows = [
    { id: 1, locationCode: 'NDG_MAIN', brandName: 'Po Poulet' },
    { id: 2, locationCode: 'NDG_MAIN', brandName: 'Pi Pita' },
    { id: 3, locationCode: 'SAINT_LEONARD', brandName: 'Po Poulet' },
    { id: 4, locationCode: null, brandName: null },
  ];
  it('every restaurant = everything; a kitchen = its rows; a brand = that brand in every kitchen; both = one line', () => {
    expect(filterByScope(rows, ALL_RESTAURANTS).map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(filterByScope(rows, { kitchen: 'NDG_MAIN', brand: null }).map((r) => r.id)).toEqual([1, 2]);
    expect(filterByScope(rows, { kitchen: null, brand: 'Po Poulet' }).map((r) => r.id)).toEqual([1, 3]);
    expect(filterByScope(rows, { kitchen: 'NDG_MAIN', brand: 'Po Poulet' }).map((r) => r.id)).toEqual([1]);
    expect(inScope({ locationCode: null }, { kitchen: 'NDG_MAIN', brand: null })).toBe(false);
  });
  it('API parameters: locations= the kitchen, brands= the brand', () => {
    expect(scopeLocations({ kitchen: 'NDG_MAIN', brand: 'Po Poulet' })).toEqual(['NDG_MAIN']);
    expect(scopeBrands({ kitchen: 'NDG_MAIN', brand: 'Po Poulet' })).toEqual(['Po Poulet']);
    expect(scopeLocations(ALL_RESTAURANTS)).toEqual([]);
    expect(scopeBrands(ALL_RESTAURANTS)).toEqual([]);
  });
  it('the live alarms follow the kitchen, never a brand (a Pi Pita order still rings while looking at Po Poulet)', () => {
    expect(alarmLocations({ kitchen: 'NDG_MAIN', brand: 'Po Poulet' })).toEqual(['NDG_MAIN']);
    expect(alarmLocations({ kitchen: null, brand: 'Po Poulet' })).toEqual([]);
    expect(alarmLocations({ kitchen: 'SAINT_LEONARD', brand: null }, 'NDG_MAIN')).toEqual(['NDG_MAIN']);
  });
});

describe('brand list', () => {
  const cell = (state: string) => ({ state });
  const matrix = [
    { brandName: 'Po Poulet', locationCode: 'NDG_MAIN', cells: { uber_eats: cell('online'), doordash: cell('deactivated'), skip: cell('paused'), tgtg: cell('missing') } },
    { brandName: 'Pi Pita', locationCode: 'NDG_MAIN', cells: { uber_eats: cell('paused'), doordash: cell('missing'), skip: cell('missing'), tgtg: cell('missing') } },
    { brandName: 'Po Poulet', locationCode: 'SAINT_LEONARD', cells: { uber_eats: cell('closed'), doordash: cell('missing'), skip: cell('missing'), tgtg: cell('missing') } },
  ];
  it('one word per brand: open if any platform takes orders, then paused, closed, deactivated, not connected', () => {
    expect(brandOpenState([cell('online'), cell('deactivated')] as never)).toBe('open');
    expect(brandOpenState([cell('paused'), cell('missing')] as never)).toBe('paused');
    expect(brandOpenState([cell('closed')] as never)).toBe('closed');
    expect(brandOpenState([cell('deactivated'), cell('missing')] as never)).toBe('deactivated');
    expect(brandOpenState([cell('missing')] as never)).toBe('not_connected');
  });
  it('rows of the scope with today’s numbers, kitchens in order, brands alphabetical', () => {
    const stats = [{ brandName: 'Po Poulet', locationCode: 'NDG_MAIN', orders: 3, sales: 61.5, open: 1 }];
    const all = brandRows(matrix, stats, ALL_RESTAURANTS, ['SAINT_LEONARD', 'NDG_MAIN']);
    // Kitchens in the given order; inside a kitchen, open brands first.
    expect(all.map((r) => `${r.locationCode}:${r.brandName}:${r.state}`)).toEqual(['SAINT_LEONARD:Po Poulet:closed', 'NDG_MAIN:Po Poulet:open', 'NDG_MAIN:Pi Pita:paused']);
    const ndg = brandRows(matrix, stats, { kitchen: 'NDG_MAIN', brand: null });
    expect(ndg.find((r) => r.brandName === 'Po Poulet')).toMatchObject({ orders: 3, sales: 61.5, open: 1, cells: { uber_eats: 'online', doordash: 'deactivated' } });
    expect(ndg.find((r) => r.brandName === 'Pi Pita')).toMatchObject({ orders: 0, sales: 0 });
    expect(brandRows(matrix, stats, { kitchen: 'NDG_MAIN', brand: 'Po Poulet' })).toHaveLength(1);
  });
  it('a brand keeps its mark everywhere', () => {
    expect(brandInitials('Po Poulet')).toBe('Po');
    expect(brandInitials('Pi Pita')).toBe('Pi');
    expect(brandInitials('PPP Pizzeria')).toBe('PPP');
    expect(brandInitials('Poulet Poulet')).toBe('PP');
    expect(brandInitials('Cafe Bolon')).toBe('CB');
    expect(brandInitials('Crèmerie Bin Molle Bin Dure')).toBe('CD');
    expect(brandInitials('Mythos 2 Go')).toBe('MG');
    expect(brandInitials('OOeuf')).toBe('OO');
    expect(brandHue('Po Poulet')).toBe(brandHue('Po Poulet'));
    expect(brandHue('Po Poulet')).toBeGreaterThanOrEqual(0);
    expect(brandHue('Po Poulet')).toBeLessThan(10);
  });
});

describe('the dashboard for a scope', () => {
  const mem = () => (globalThis as unknown as { __foodhubMem?: { orders: Map<string, StoredOrder> } }).__foodhubMem;
  const now = Date.now();
  const order = (id: string, brandName: string, locationCode: string, total: number, timeline: StoredOrder['timeline'] = {}): StoredOrder => ({
    id, channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: id, displayId: id, channelStoreId: 's', fulfillment: 'delivery',
    placedAt: new Date(now).toISOString(), currency: 'CAD', subtotal: total, tax: 0, total, deliveryFee: 0, tip: 0, discount: 0, lines: [], raw: {},
    status: 'completed', timeline, createdAt: new Date(now - 60_000).toISOString(), updatedAt: new Date(now).toISOString(), brandName, locationCode,
  } as StoredOrder);

  beforeEach(async () => {
    process.env.FOODHUB_FORCE_MEMORY = 'true';
    const { getRepo } = await import('../lib/foodhub/repo');
    await getRepo().listOrders({ limit: 1 }); // make sure the memory store exists
    const m = mem();
    if (!m) throw new Error('memory repo missing');
    for (const k of [...m.orders.keys()]) if (k.startsWith('scope-')) m.orders.delete(k);
    const at = (min: number) => new Date(now - min * 60_000).toISOString();
    m.orders.set('scope-1', order('scope-1', 'Po Poulet', 'NDG_MAIN', 20, { acceptedAt: at(30), readyAt: at(18) }));
    m.orders.set('scope-2', order('scope-2', 'Pi Pita', 'NDG_MAIN', 10, { acceptedAt: at(30), readyAt: at(22) }));
    m.orders.set('scope-3', order('scope-3', 'Po Poulet', 'SAINT_LEONARD', 5));
  });

  it('a brand scope counts only that brand’s orders, and leaves Clover in-store sales out', async () => {
    const cc = await buildCommandCenter({ now, locationCodes: ['NDG_MAIN'], brandNames: ['Po Poulet'] });
    const mine = (list: Array<{ brandName: string }>) => list.filter((b) => b.brandName === 'Po Poulet' || b.brandName === 'Pi Pita');
    expect(cc.brandScoped).toBe(true);
    expect(mine(cc.byBrand).map((b) => b.brandName)).toEqual(['Po Poulet']);
    expect(cc.byBrandLocation.filter((b) => b.brandName === 'Pi Pita')).toEqual([]);
    expect(cc.byBrandLocation.find((b) => b.brandName === 'Po Poulet' && b.locationCode === 'NDG_MAIN')).toMatchObject({ orders: 1, sales: 20 });
    expect(cc.kpis.inStore).toBe(0);
    expect(cc.matrix.every((r) => r.brandName === 'Po Poulet' && r.locationCode === 'NDG_MAIN')).toBe(true);
  });

  it('a kitchen scope keeps every brand of the kitchen and no other kitchen', async () => {
    const cc = await buildCommandCenter({ now, locationCodes: ['NDG_MAIN'] });
    expect(cc.brandScoped).toBe(false);
    const ours = cc.byBrandLocation.filter((b) => ['Po Poulet', 'Pi Pita'].includes(b.brandName));
    expect(ours.every((b) => b.locationCode === 'NDG_MAIN')).toBe(true);
    expect(ours.map((b) => b.brandName).sort()).toEqual(['Pi Pita', 'Po Poulet']);
  });

  it('average prep time = accepted → ready, in minutes', () => {
    const at = (min: number) => new Date(now - min * 60_000).toISOString();
    expect(averagePrepMinutes([order('a', 'X', 'Y', 1, { acceptedAt: at(30), readyAt: at(18) }), order('b', 'X', 'Y', 1, { acceptedAt: at(30), readyAt: at(22) })])).toBe(10);
    expect(averagePrepMinutes([order('c', 'X', 'Y', 1)])).toBeNull();
  });
});

describe('Po Poulet NDG lock is untouched by the scope', () => {
  it('DoorDash 27982486 stays locked whatever the console shows', () => {
    expect(BUILT_IN_MENU_LOCKS.some((l) => l.channel === 'doordash' && l.id === '27982486')).toBe(true);
    const store = { channel: 'doordash' as const, channelStoreId: 'dd-popoulet-ndg', meta: { platformStoreId: '27982486' } };
    for (const s of [ALL_RESTAURANTS, { kitchen: 'NDG_MAIN', brand: 'Po Poulet' }, { kitchen: 'NDG_MAIN', brand: null }]) {
      // Picking a scope only changes what is shown: the lock is read from the store alone.
      expect(alarmLocations(s)).toEqual(scopeLocations(s));
      expect(isMenuLocked(store)).toBe(true);
      expect(menuLockOf(store).source).toBe('built_in');
    }
  });
});
