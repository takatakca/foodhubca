// Menu safety + per-brand menus:
//  C1 Clover → platforms: the webhook respects FOODHUB_CLOVER_INVENTORY_SYNC, locked / "Do not touch" stores are left out
//     before the fan-out, and only stores mapped to the Clover merchant by name are reached.
//  C2 DoorDash menu pull + item polling and the Deliverect product push respect "Do not touch" and the menu lock.
//  C3 a Clover import leaves the staff menu and in-store promotions out.
//  C4 a brand that follows another brand's menu can show only its own dishes (option groups come along).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCloverItemMock = vi.fn();
vi.mock('../lib/foodhub/pos/clover-books', async (orig) => ({ ...(await orig<typeof import('../lib/foodhub/pos/clover-books')>()), getCloverItem: (...a: unknown[]) => getCloverItemMock(...a) }));

import { doorDashAdapter } from '../lib/foodhub/adapters/doordash';
import { deliverect } from '../lib/foodhub/adapters/deliverect-api';
import { uberEatsAdapter } from '../lib/foodhub/adapters/uber-eats';
import { applyCloverItem, cloverInventorySyncEnabled, handleCloverWebhook, locationsForMerchant } from '../lib/foodhub/clover-sync';
import { DELIVERECT_LOCATIONS, pushDeliverectProducts } from '../lib/foodhub/deliverect-ops';
import { buildMenuFromClover, categoryKey, DEFAULT_EXCLUDED_CATEGORIES } from '../lib/foodhub/menu/clover-import';
import { cleanBrandDishes, dishScope, filterMenuToDishes, getBrandMenu, saveBrandDishes, saveMenuSharing } from '../lib/foodhub/menu/shared';
import { publishMenu, setItemAvailability } from '../lib/foodhub/ops';
import { getRepo } from '../lib/foodhub/repo';
import type { ChannelStore, MasterMenu } from '../lib/foodhub/types';

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
const call = (method: string, path: string, body?: unknown) => new Request(`http://hub.local${path}`, {
  method, headers: { authorization: basic('owner', 'Owner-pass-123'), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});
const ctx = {} as never;
const ok = (channel: 'doordash' | 'uber_eats') => ({ channel, ok: true, status: 'done' as const, message: 'OK' });

/** The source menu: two dishes with the Duo/Trio/Combo upsell group, a dessert with its own group, a staff-free menu. */
const sourceMenu = (over: Partial<MasterMenu> = {}): MasterMenu => ({
  brandName: 'Cuisine Test',
  categories: [{ ref: 'c-plats', name: 'Plats', sortOrder: 0 }, { ref: 'c-desserts', name: 'Desserts', sortOrder: 1 }, { ref: 'c-pizza', name: 'Pizza', sortOrder: 2 }],
  items: [
    { ref: 'clv-poulet', posItemRef: 'clv-poulet', name: 'Poulet frit', price: 12, categoryRef: 'c-plats', available: true, modifierGroupRefs: ['g-upsell'] },
    { ref: 'clv-pita', posItemRef: 'clv-pita', name: 'Pita poulet', price: 11, categoryRef: 'c-plats', available: true, modifierGroupRefs: ['g-upsell', 'g-sauce'] },
    { ref: 'clv-gateau', posItemRef: 'clv-gateau', name: 'Gâteau', price: 5, categoryRef: 'c-desserts', available: true, modifierGroupRefs: ['g-taille'] },
    { ref: 'clv-pizza', posItemRef: 'clv-pizza', name: 'Pizza', price: 15, categoryRef: 'c-pizza', available: true, modifierGroupRefs: [] },
  ],
  modifierGroups: [
    { ref: 'g-upsell', name: 'Duo / Trio / Combo', min: 0, max: 1, modifiers: [{ ref: 'm-duo', name: 'Duo', price: 2.5, available: true }, { ref: 'm-trio', name: 'Trio', price: 5.42, available: true }, { ref: 'm-combo', name: 'Combo', price: 7.58, available: true }] },
    { ref: 'g-sauce', name: 'Sauce', min: 0, max: 1, modifiers: [{ ref: 'm-ail', name: 'Ail', price: 0, available: true }] },
    { ref: 'g-taille', name: 'Taille', min: 1, max: 1, modifiers: [{ ref: 'm-grand', name: 'Grand', price: 1, available: true }] },
  ],
  updatedAt: new Date().toISOString(),
  ...over,
});

async function store(brandName: string, channel: ChannelStore['channel'], id: string, locationCode: string, extra: { cloverMerchantId?: string; meta?: Record<string, unknown> } = {}) {
  return getRepo().upsertStore({ channel, channelStoreId: id, brandName, locationCode, autoAccept: true, online: true, cloverMerchantId: extra.cloverMerchantId ?? null, meta: extra.meta ?? {} } as never);
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
  process.env.CLOVER_MERCHANT_ID = 'M1';
  delete process.env.FOODHUB_CLOVER_INVENTORY_SYNC;
  delete process.env.FOODHUB_MENU_LOCKED_STORES;
  (globalThis as any).__foodhubMem = undefined;
  vi.restoreAllMocks();
  getCloverItemMock.mockReset();
});

describe('C1 — Clover inventory sync safety', () => {
  it('FOODHUB_CLOVER_INVENTORY_SYNC=off stops the webhook path: nothing read from Clover, nothing 86’d', async () => {
    await getRepo().saveMenu(sourceMenu());
    await store('Cuisine Test', 'uber_eats', 'ue-1', 'NDG', { cloverMerchantId: 'M1' });
    const ue = vi.spyOn(uberEatsAdapter, 'setItemAvailability').mockResolvedValue(ok('uber_eats'));
    getCloverItemMock.mockResolvedValue({ id: 'clv-poulet', available: false });
    const body = { merchants: { M1: [{ objectId: 'I:clv-poulet', type: 'UPDATE' }] } };

    process.env.FOODHUB_CLOVER_INVENTORY_SYNC = ' OFF ';
    expect(cloverInventorySyncEnabled()).toBe(false);
    expect(await handleCloverWebhook(body)).toMatchObject({ items: 0, disabled: true, outcome: { turnedOff: 0 } });
    expect(getCloverItemMock).not.toHaveBeenCalled();
    expect(ue).not.toHaveBeenCalled();
    expect((await getRepo().getMenu('Cuisine Test'))!.unavailableByLocation?.NDG ?? []).toEqual([]);

    // Switched back on: the same event 86s the dish.
    delete process.env.FOODHUB_CLOVER_INVENTORY_SYNC;
    expect((await handleCloverWebhook(body)).outcome.turnedOff).toBe(1);
    expect(ue).toHaveBeenCalledTimes(1);
  });

  it('locked and "Do not touch" stores are left out before the fan-out (no call, no Food Hub 86 state there)', async () => {
    await getRepo().saveMenu(sourceMenu());
    const ndg = await store('Cuisine Test', 'uber_eats', 'ue-ndg', 'NDG', { cloverMerchantId: 'M1' });
    const dntSameLoc = await store('Cuisine Test', 'doordash', 'dd-ndg', 'NDG', { cloverMerchantId: 'M1', meta: { doNotTouch: true } });
    await store('Cuisine Test', 'doordash', 'dd-laval', 'LAVAL', { cloverMerchantId: 'M1', meta: { doNotTouch: true } });
    await store('Cuisine Test', 'doordash', 'dd-stl', 'STL', { cloverMerchantId: 'M1', meta: { menuLocked: true } });
    const ue = vi.spyOn(uberEatsAdapter, 'setItemAvailability').mockResolvedValue(ok('uber_eats'));
    const dd = vi.spyOn(doorDashAdapter, 'setItemAvailability').mockResolvedValue(ok('doordash'));

    const out = await applyCloverItem('M1', { id: 'clv-poulet', available: false });
    expect(out).toMatchObject({ matched: 1, turnedOff: 1 });
    expect(ue.mock.calls.map((c) => c[0].id)).toEqual([ndg.id]);
    expect(dd).not.toHaveBeenCalled();
    const saved = (await getRepo().getMenu('Cuisine Test'))!;
    expect(saved.unavailableByLocation).toEqual({ NDG: ['clv-poulet'] });
    expect(Object.keys((await getRepo().getKv<Record<string, boolean>>('clover_86'))!)).toEqual(['Cuisine Test|NDG|clv-poulet']);
    // Nothing was even recorded for the "Do not touch" store at the same location.
    expect((await getRepo().listJobs(50)).some((j) => j.request.storeId === dntSameLoc.id)).toBe(false);

    // Back in stock from Clover: same stores only.
    ue.mockClear();
    expect((await applyCloverItem('M1', { id: 'clv-poulet', available: true })).turnedOn).toBe(1);
    expect(ue.mock.calls.map((c) => [c[0].id, c[2]])).toEqual([[ndg.id, true]]);
    expect(dd).not.toHaveBeenCalled();
  });

  it('a store follows its own Clover merchant or the default one; another merchant’s store and relay stores are never 86’d', async () => {
    await getRepo().saveMenu(sourceMenu());
    const def = await store('Cuisine Test', 'uber_eats', 'ue-default', 'NDG');
    await store('Cuisine Test', 'uber_eats', 'ue-other', 'LAVAL', { cloverMerchantId: 'M2' });
    await store('Cuisine Test', 'skip', 'relay:9', 'STL', { cloverMerchantId: 'M1' });
    const ue = vi.spyOn(uberEatsAdapter, 'setItemAvailability').mockResolvedValue(ok('uber_eats'));
    expect(await locationsForMerchant('M1')).toEqual(['NDG', 'STL']);
    expect(await applyCloverItem('M1', { id: 'clv-poulet', available: false })).toMatchObject({ matched: 1, turnedOff: 1 });
    expect(ue.mock.calls.map((c) => c[0].id)).toEqual([def.id]);
    expect((await getRepo().getMenu('Cuisine Test'))!.unavailableByLocation).toEqual({ NDG: ['clv-poulet'] });
  });

  it('a location where one store uses another Clover merchant is not 86’d: item polling there stays clean', async () => {
    await getRepo().saveMenu(sourceMenu());
    vi.spyOn(doorDashAdapter, 'verifyWebhook').mockReturnValue(true);
    await store('Cuisine Test', 'uber_eats', 'ue-ndg', 'NDG', { cloverMerchantId: 'M1' });
    await store('Cuisine Test', 'doordash', 'dd-ndg', 'NDG', { cloverMerchantId: 'M2' });
    // Same brand at another location: both follow M1 (one by name, one through the default merchant).
    await store('Cuisine Test', 'uber_eats', 'ue-laval', 'LAVAL', { cloverMerchantId: 'M1' });
    await store('Cuisine Test', 'doordash', 'dd-laval', 'LAVAL');
    const ue = vi.spyOn(uberEatsAdapter, 'setItemAvailability').mockResolvedValue(ok('uber_eats'));
    const dd = vi.spyOn(doorDashAdapter, 'setItemAvailability').mockResolvedValue(ok('doordash'));

    expect(await applyCloverItem('M1', { id: 'clv-poulet', available: false })).toMatchObject({ turnedOff: 1 });
    expect(ue.mock.calls.map((c) => c[0].channelStoreId)).toEqual(['ue-laval']);
    expect(dd.mock.calls.map((c) => c[0].channelStoreId)).toEqual(['dd-laval']);
    expect((await getRepo().getMenu('Cuisine Test'))!.unavailableByLocation).toEqual({ LAVAL: ['clv-poulet'] });
    expect((await getRepo().listActivity({ limit: 20 })).some((a) => a.action === 'clover_86_skipped' && a.locationCode === 'NDG')).toBe(true);
    const { GET } = await import('../app/api/foodhub/webhooks/doordash/item-polling/[locationId]/route');
    const poll = async (id: string) => (await GET(new Request(`http://hub.local/x/${id}`) as never, { params: Promise.resolve({ locationId: id }) })).json();
    expect(await poll('dd-ndg')).toEqual([]);
    expect(await poll('dd-laval')).toEqual([{ merchant_supplied_id: 'clv-poulet', is_active: false, type: 'item' }]);
  });

  it('safe on deploy: an 86 Clover made earlier comes back on, even where no store follows that merchant any more', async () => {
    // Before: Clover (default merchant) 86'd the dish at NDG and LAVAL.
    await getRepo().saveMenu(sourceMenu({ unavailableByLocation: { NDG: ['clv-poulet'], LAVAL: ['clv-poulet'], STL: ['clv-poulet'] } }));
    await getRepo().setKv('clover_86', { 'Cuisine Test|NDG|clv-poulet': true, 'Cuisine Test|LAVAL|clv-poulet': true });
    const ndg = await store('Cuisine Test', 'uber_eats', 'ue-ndg', 'NDG');
    // Since then this LAVAL store was set to another merchant, and the only other one there is "Do not touch".
    const laval = await store('Cuisine Test', 'uber_eats', 'ue-laval', 'LAVAL', { cloverMerchantId: 'M2' });
    await store('Cuisine Test', 'doordash', 'dd-laval', 'LAVAL', { meta: { doNotTouch: true } });
    const ue = vi.spyOn(uberEatsAdapter, 'setItemAvailability').mockResolvedValue(ok('uber_eats'));
    const dd = vi.spyOn(doorDashAdapter, 'setItemAvailability').mockResolvedValue(ok('doordash'));

    expect(await applyCloverItem('M1', { id: 'clv-poulet', available: true })).toMatchObject({ turnedOn: 2 });
    expect(ue.mock.calls.map((c) => [c[0].id, c[2]]).sort()).toEqual([[ndg.id, true], [laval.id, true]].sort());
    expect(dd).not.toHaveBeenCalled();
    // STL was 86'd by staff (no Clover mark): it stays off.
    expect((await getRepo().getMenu('Cuisine Test'))!.unavailableByLocation).toEqual({ NDG: [], LAVAL: [], STL: ['clv-poulet'] });
    expect(await getRepo().getKv('clover_86')).toEqual({});
  });

  it('the protected Po Poulet NDG DoorDash store (27982486) gets nothing from Clover, even with no flag on it', async () => {
    await getRepo().saveMenu({ ...sourceMenu(), brandName: 'Po Poulet' });
    const protectedStore = await store('Po Poulet', 'doordash', '27982486', 'NDG');
    const stl = await store('Po Poulet', 'uber_eats', 'ue-stleonard', 'SAINT_LEONARD');
    const ue = vi.spyOn(uberEatsAdapter, 'setItemAvailability').mockResolvedValue(ok('uber_eats'));
    const dd = vi.spyOn(doorDashAdapter, 'setItemAvailability').mockResolvedValue(ok('doordash'));
    for (const available of [false, true]) await applyCloverItem('M1', { id: 'clv-poulet', available });
    expect(ue.mock.calls.map((c) => [c[0].id, c[2]])).toEqual([[stl.id, false], [stl.id, true]]);
    expect(dd).not.toHaveBeenCalled();
    expect((await getRepo().listJobs(50)).some((j) => j.request.storeId === protectedStore.id || j.request.channelStoreId === '27982486')).toBe(false);
    expect(Object.keys((await getRepo().getMenu('Po Poulet'))!.unavailableByLocation ?? {})).toEqual(['SAINT_LEONARD']);
  });

  it('a shared menu: the Clover 86 reaches every brand’s mapped stores, but only brands whose dishes include it', async () => {
    await getRepo().saveMenu(sourceMenu());
    await saveMenuSharing({ 'Pi Pita': 'Cuisine Test', 'Pizza Inntime': 'Cuisine Test' });
    await saveBrandDishes({ 'Pi Pita': ['clv-pita'], 'Pizza Inntime': ['clv-pizza'] });
    await store('Cuisine Test', 'uber_eats', 'ue-poulet', 'NDG', { cloverMerchantId: 'M1' });
    await store('Pi Pita', 'uber_eats', 'ue-pita', 'NDG', { cloverMerchantId: 'M1' });
    await store('Pizza Inntime', 'uber_eats', 'ue-pizza', 'NDG', { cloverMerchantId: 'M1' });
    const ue = vi.spyOn(uberEatsAdapter, 'setItemAvailability').mockResolvedValue(ok('uber_eats'));
    await applyCloverItem('M1', { id: 'clv-pita', available: false });
    expect(ue.mock.calls.map((c) => c[0].channelStoreId).sort()).toEqual(['ue-pita', 'ue-poulet']);
  });
});

describe('C2 — DoorDash menu pull / item polling and Deliverect respect "Do not touch" and the lock', () => {
  beforeEach(() => { vi.spyOn(doorDashAdapter, 'verifyWebhook').mockReturnValue(true); });

  it('DoorDash menu pull: "Do not touch" answers 409 and logs it; a normal store gets its menu', async () => {
    await getRepo().saveMenu(sourceMenu());
    await store('Cuisine Test', 'doordash', 'dd-dnt', 'NDG', { meta: { doNotTouch: true } });
    await store('Cuisine Test', 'doordash', 'dd-ok', 'LAVAL');
    const { GET } = await import('../app/api/foodhub/webhooks/doordash/[locationId]/route');
    const req = (id: string) => new Request(`http://hub.local/api/foodhub/webhooks/doordash/${id}`) as never;
    const refused = await GET(req('dd-dnt'), { params: Promise.resolve({ locationId: 'dd-dnt' }) });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/Do not touch/);
    expect((await getRepo().listActivity({ limit: 20 })).some((a) => a.action === 'menu_pull_refused' && /Do not touch/.test(a.summary))).toBe(true);
    const served = await GET(req('dd-ok'), { params: Promise.resolve({ locationId: 'dd-ok' }) });
    expect(served.status).toBe(200);
    expect((await served.json()).menus).toHaveLength(1);
  });

  it('DoorDash item polling: "Do not touch" and locked stores answer 409 (an answer could 86 their items)', async () => {
    await getRepo().saveMenu(sourceMenu({ unavailableByLocation: { NDG: ['clv-pita'] } }));
    await store('Cuisine Test', 'doordash', 'dd-dnt', 'NDG', { meta: { doNotTouch: true } });
    await store('Cuisine Test', 'doordash', 'dd-locked', 'NDG', { meta: { menuLocked: true } });
    await store('Cuisine Test', 'doordash', 'dd-ok', 'NDG');
    const { GET } = await import('../app/api/foodhub/webhooks/doordash/item-polling/[locationId]/route');
    const poll = (id: string) => GET(new Request(`http://hub.local/x/${id}`) as never, { params: Promise.resolve({ locationId: id }) });
    expect((await poll('dd-dnt')).status).toBe(409);
    expect((await poll('dd-locked')).status).toBe(409);
    const okRes = await poll('dd-ok');
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual([{ merchant_supplied_id: 'clv-pita', is_active: false, type: 'item' }]);
  });

  it('Deliverect product push: refused for a locked or "Do not touch" store, sent otherwise', async () => {
    const repo = getRepo();
    await repo.saveMenu(sourceMenu());
    const rec = (loc: string, ext: string) => ({ id: loc, key: ext, at: new Date().toISOString(), data: { accountId: 'acc', locationId: loc, externalLocationId: ext, name: ext, registeredAt: new Date().toISOString() } });
    await repo.putDocs(DELIVERECT_LOCATIONS, [rec('loc-dnt', 'NDG'), rec('loc-lock', 'LAVAL'), rec('loc-ok', 'STL')]);
    await store('Cuisine Test', 'tgtg', 'dlv:NDG', 'NDG', { meta: { doNotTouch: true } });
    await store('Cuisine Test', 'tgtg', 'dlv:LAVAL', 'LAVAL');
    await store('Cuisine Test', 'tgtg', 'dlv:STL', 'STL');
    process.env.FOODHUB_MENU_LOCKED_STORES = 'tgtg:dlv:LAVAL';
    const push = vi.spyOn(deliverect, 'insertProducts').mockResolvedValue({ channel: 'tgtg', ok: true, status: 'done', message: 'OK' } as never);
    expect(await pushDeliverectProducts('loc-dnt')).toMatchObject({ ok: false, message: expect.stringMatching(/Do not touch/) });
    expect(await pushDeliverectProducts('loc-lock')).toMatchObject({ ok: false, message: expect.stringMatching(/locked/) });
    expect(push).not.toHaveBeenCalled();
    expect(await pushDeliverectProducts('loc-ok')).toMatchObject({ ok: true });
    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe('C3 — Clover import leaves the staff menu and in-store promotions out', () => {
  const cat = (id: string, name: string) => ({ id, name });
  const items = [
    { id: 'i-poulet', name: 'Poulet frit', price: 1200, categories: { elements: [cat('c1', 'Poulet frit')] } },
    { id: 'i-staff', name: 'Repas employé', price: 500, categories: { elements: [cat('c2', 'menu employes')] } },
    { id: 'i-promo', name: '2 pour 1', price: 900, categories: { elements: [cat('c3', 'INSTORE  PROMOTIONS')] } },
    { id: 'i-promo2', name: 'Promo du mardi', price: 900, categories: { elements: [cat('c4', 'Menu Promotionnel')] } },
    // Also filed in a real category: kept, under that category only.
    { id: 'i-both', name: 'Poutine', price: 800, categories: { elements: [cat('c2', 'Menu Employés'), cat('c5', 'Frites / Poutines')] } },
    { id: 'i-nocat', name: 'Sans catégorie', price: 300, categories: { elements: [] } },
  ];

  it('default list: case, accents and spacing ignored; an item also in a kept category stays', () => {
    expect(DEFAULT_EXCLUDED_CATEGORIES).toEqual(['Menu Employés', 'INSTORE PROMOTIONS', 'Menu promotionnel']);
    expect(categoryKey('  MENU   EMPLOYÉS ')).toBe(categoryKey('menu employes'));
    const { menu, report } = buildMenuFromClover('Cuisine Test', items, []);
    expect(menu.items.map((i) => i.ref).sort()).toEqual(['i-both', 'i-nocat', 'i-poulet']);
    expect(menu.items.find((i) => i.ref === 'i-both')!.categoryRef).toBe('c5');
    expect(menu.categories.map((c) => c.name)).not.toContain('Menu Employés');
    expect(report.skipped.excluded).toBe(3);
  });

  it('excludeCategories: [] imports everything; a custom list replaces the default', () => {
    expect(buildMenuFromClover('Cuisine Test', items, [], { excludeCategories: [] }).menu.items).toHaveLength(6);
    const custom = buildMenuFromClover('Cuisine Test', items, [], { excludeCategories: ['Poulet frit'] });
    expect(custom.menu.items.map((i) => i.ref).sort()).toEqual(['i-both', 'i-nocat', 'i-promo', 'i-promo2', 'i-staff']);
  });

  it('an item with no inventory category is left out when its Clover menu row is in a staff category', () => {
    const { menu, report } = buildMenuFromClover('Cuisine Test', [{ id: 'i-x', name: 'X', price: 100 }, { id: 'i-y', name: 'Y', price: 100 }], [], {
      menuItems: [{ itemId: 'i-x', categoryId: 'cs', categoryName: 'Menu Employés' }, { itemId: 'i-y', categoryId: 'cp', categoryName: 'Plats' }],
    });
    expect(menu.items.map((i) => i.ref)).toEqual(['i-y']);
    expect(report.skipped.excluded).toBe(1);
  });

  it('the import route passes the request’s own list through', async () => {
    const clover = await import('../lib/foodhub/pos/clover');
    const spy = vi.spyOn(clover, 'importMenuFromClover').mockResolvedValue({ ...sourceMenu(), importReport: undefined });
    process.env.CLOVER_ACCESS_TOKEN = 'tok';
    const { POST } = await import('../app/api/foodhub/menu/import/route');
    const res = await POST(call('POST', '/api/foodhub/menu/import', { brand: 'Cuisine Test', excludeCategories: [] }), ctx);
    expect(res.status).toBe(200);
    expect(spy.mock.calls[0][2]).toMatchObject({ excludeCategories: [] });
    await POST(call('POST', '/api/foodhub/menu/import', { brand: 'Cuisine Test' }), ctx);
    expect(spy.mock.calls[1][2]?.excludeCategories).toBeUndefined();
    delete process.env.CLOVER_ACCESS_TOKEN;
  });
});

describe('C4 — per-brand dishes on a shared menu', () => {
  it('filterMenuToDishes keeps the dishes, their option groups (Duo/Trio/Combo) and their categories only', () => {
    const m = filterMenuToDishes({ ...sourceMenu({ unavailableByLocation: { NDG: ['clv-gateau', 'm-trio', 'm-grand'] }, unavailableUntil: { 'NDG|clv-gateau': 5, 'NDG|m-trio': 6 } }), brandName: 'Pi Pita' }, ['clv-pita', 'gone'], 'Cuisine Test');
    expect(m.items.map((i) => i.ref)).toEqual(['clv-pita']);
    expect(m.modifierGroups.map((g) => g.ref)).toEqual(['g-upsell', 'g-sauce']);
    expect(m.modifierGroups[0].modifiers.map((x) => x.name)).toEqual(['Duo', 'Trio', 'Combo']);
    expect(m.categories.map((c) => c.ref)).toEqual(['c-plats']);
    expect(m.unavailableByLocation).toEqual({ NDG: ['m-trio'] });
    expect(m.unavailableUntil).toEqual({ 'NDG|m-trio': 6 });
    expect(m.sharedDishes).toEqual({ from: 'Cuisine Test', listed: 2, shown: 1, missing: ['gone'] });
    // A ref may also be the Clover id of a dish whose Food Hub ref differs.
    const byClover = { ...sourceMenu(), items: sourceMenu().items.map((i) => (i.ref === 'clv-pizza' ? { ...i, ref: 'fh-pizza' } : i)) };
    expect(dishScope(byClover, ['clv-pizza']).itemRefs).toEqual(new Set(['fh-pizza']));
    expect(cleanBrandDishes({ ' A ': ['x', 'x', ' ', 'y'], B: [], C: 'nope' })).toEqual({ A: ['x', 'y'] });
  });

  it('getBrandMenu: a follower sees only its dishes; the source and allDishes see the whole menu', async () => {
    await getRepo().saveMenu(sourceMenu());
    await saveMenuSharing({ 'Pi Pita': 'Cuisine Test', OOeuf: 'Cuisine Test' });
    await saveBrandDishes({ 'Pi Pita': ['clv-pita', 'clv-gateau'], 'Cuisine Test': ['clv-pizza'] });
    const pita = (await getBrandMenu('Pi Pita'))!;
    expect(pita.brandName).toBe('Pi Pita');
    expect(pita.items.map((i) => i.name)).toEqual(['Pita poulet', 'Gâteau']);
    expect(pita.modifierGroups.map((g) => g.ref).sort()).toEqual(['g-sauce', 'g-taille', 'g-upsell']);
    // No list = every dish; a list on a brand that does not follow anyone is ignored.
    expect((await getBrandMenu('OOeuf'))!.items).toHaveLength(4);
    expect((await getBrandMenu('Cuisine Test'))!.items).toHaveLength(4);
    expect((await getBrandMenu('Pi Pita', undefined, { allDishes: true }))!.items).toHaveLength(4);
  });

  it('one Clover re-import of the source refreshes every brand’s dishes (same refs, new names and prices)', async () => {
    await getRepo().saveMenu(sourceMenu());
    await saveMenuSharing({ 'Pi Pita': 'Cuisine Test' });
    await saveBrandDishes({ 'Pi Pita': ['clv-pita'] });
    await getRepo().saveMenu(sourceMenu({ items: sourceMenu().items.map((i) => (i.ref === 'clv-pita' ? { ...i, name: 'Pita poulet XL', price: 12.5 } : i)) }));
    expect((await getBrandMenu('Pi Pita'))!.items).toMatchObject([{ ref: 'clv-pita', name: 'Pita poulet XL', price: 12.5 }]);
  });

  it('publish: a follower sends only its dishes; a list that matches nothing never publishes an empty menu', async () => {
    await getRepo().saveMenu(sourceMenu());
    await saveMenuSharing({ 'Pi Pita': 'Cuisine Test' });
    await saveBrandDishes({ 'Pi Pita': ['clv-pita'] });
    await store('Pi Pita', 'doordash', 'dd-pita', 'NDG');
    const spy = vi.spyOn(doorDashAdapter, 'publishMenu').mockResolvedValue({ channel: 'doordash', ok: true, status: 'queued', message: 'OK' });
    await publishMenu('Pi Pita');
    const sent = spy.mock.calls[0][1];
    expect(sent.items.map((i) => i.ref)).toEqual(['clv-pita']);
    expect(sent.modifierGroups.map((g) => g.ref)).toEqual(['g-upsell', 'g-sauce']);

    spy.mockClear();
    await saveBrandDishes({ 'Pi Pita': ['no-such-dish'] });
    await expect(publishMenu('Pi Pita')).rejects.toThrow(/nothing was published/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('86 fan-out: a follower’s stores hear only about its dishes and their options', async () => {
    await getRepo().saveMenu(sourceMenu());
    await saveMenuSharing({ 'Pi Pita': 'Cuisine Test', 'Pizza Inntime': 'Cuisine Test' });
    await saveBrandDishes({ 'Pi Pita': ['clv-pita'], 'Pizza Inntime': ['clv-pizza'] });
    await store('Cuisine Test', 'doordash', 'dd-poulet', 'NDG');
    await store('Pi Pita', 'doordash', 'dd-pita', 'NDG');
    await store('Pizza Inntime', 'doordash', 'dd-pizza', 'NDG');
    const dd = vi.spyOn(doorDashAdapter, 'setItemAvailability').mockResolvedValue(ok('doordash'));
    const sentTo = () => dd.mock.calls.map((c) => [c[0].channelStoreId, c[1].join('+'), c[4]]);

    // A dish only Cuisine Test and Pizza Inntime sell.
    const rows = await setItemAvailability('Cuisine Test', ['clv-pizza'], false, { locationCode: 'NDG' });
    expect(sentTo().sort()).toEqual([['dd-pizza', 'clv-pizza', 'item'], ['dd-poulet', 'clv-pizza', 'item']]);
    expect(rows.find((r) => r.channelStoreId === 'dd-pita')!.result).toMatchObject({ status: 'skipped', message: expect.stringMatching(/not on Pi Pita/) });
    expect((await getRepo().listJobs(50)).some((j) => j.request.channelStoreId === 'dd-pita')).toBe(false);

    // The Trio option (Duo/Trio/Combo group of the pita) + the pita itself + a dessert option: each brand gets its part.
    dd.mockClear();
    await setItemAvailability('Pi Pita', ['clv-pita', 'm-trio', 'm-grand'], false, { locationCode: 'NDG' });
    expect(sentTo().sort()).toEqual([
      ['dd-pita', 'clv-pita', 'item'], ['dd-pita', 'm-trio', 'modifier'],
      ['dd-poulet', 'clv-pita', 'item'], ['dd-poulet', 'm-trio+m-grand', 'modifier'],
    ]);
    expect((await getRepo().getMenu('Cuisine Test'))!.unavailableByLocation?.NDG?.sort()).toEqual(['clv-pita', 'clv-pizza', 'm-grand', 'm-trio']);
  });

  it('Menu partagé API: GET returns the dish lists; PUT validates and keeps them; a move to another menu drops the old list', async () => {
    await getRepo().saveMenu(sourceMenu());
    await getRepo().saveMenu({ ...sourceMenu(), brandName: 'OOeuf', items: [{ ref: 'oe-1', name: 'Omelette', price: 9, categoryRef: 'c-plats', available: true, modifierGroupRefs: [] }] });
    const { GET, PUT } = await import('../app/api/foodhub/menu/sharing/route');
    const put = async (body: unknown) => { const r = await PUT(call('PUT', '/api/foodhub/menu/sharing', body), ctx); return { status: r.status, body: await r.json() }; };

    expect((await put({ sharing: { 'Pi Pita': 'Cuisine Test' }, dishes: { 'Pi Pita': ['nothing-here'] } })).status).toBe(422);
    expect((await put({ sharing: { 'Pi Pita': 'Cuisine Test' }, dishes: { 'Pizza Inntime': ['clv-pizza'] } })).status).toBe(422);
    expect((await put({ sharing: { 'Pi Pita': 'Cuisine Test' }, dishes: [] })).status).toBe(400);
    const saved = await put({ sharing: { 'Pi Pita': 'Cuisine Test' }, dishes: { 'Pi Pita': ['clv-pita', 'clv-poulet'] } });
    expect(saved).toMatchObject({ status: 200, body: { dishes: { 'Pi Pita': ['clv-pita', 'clv-poulet'] }, publish: ['Pi Pita'] } });
    expect(await (await GET(call('GET', '/api/foodhub/menu/sharing'), ctx)).json()).toMatchObject({ sharing: { 'Pi Pita': 'Cuisine Test' }, dishes: { 'Pi Pita': ['clv-pita', 'clv-poulet'] } });

    // Only the dish list changes: that brand must be published again.
    expect((await put({ sharing: { 'Pi Pita': 'Cuisine Test' }, dishes: { 'Pi Pita': ['clv-pita'] } })).body.publish).toEqual(['Pi Pita']);
    // Without `dishes`, an unchanged follower keeps its list…
    expect((await put({ sharing: { 'Pi Pita': 'Cuisine Test' } })).body.dishes).toEqual({ 'Pi Pita': ['clv-pita'] });
    // …and a follower that moves to another menu starts from every dish of that menu.
    expect((await put({ sharing: { 'Pi Pita': 'OOeuf' } })).body.dishes).toEqual({});
    expect((await getBrandMenu('Pi Pita'))!.items.map((i) => i.ref)).toEqual(['oe-1']);
  });

  it('a dish list that matches nothing never sends an empty menu: DoorDash "Menu visible", Uber publish plan, Deliverect push, publish route', async () => {
    const repo = getRepo();
    await repo.saveMenu(sourceMenu());
    await saveMenuSharing({ 'Pi Pita': 'Cuisine Test' });
    await saveBrandDishes({ 'Pi Pita': ['gone-after-reimport'] });
    const dd = await store('Pi Pita', 'doordash', 'dd-pita', 'NDG');
    await store('Pi Pita', 'uber_eats', 'ue-pita', 'NDG');
    await store('Pi Pita', 'tgtg', 'dlv:NDG', 'NDG');
    const ddPublish = vi.spyOn(doorDashAdapter, 'publishMenu').mockResolvedValue({ channel: 'doordash', ok: true, status: 'queued', message: 'OK' });
    const uePublish = vi.spyOn(uberEatsAdapter, 'publishMenu').mockResolvedValue({ channel: 'uber_eats', ok: true, status: 'done', message: 'OK' });
    const push = vi.spyOn(deliverect, 'insertProducts').mockResolvedValue({ channel: 'tgtg', ok: true, status: 'done', message: 'OK' } as never);

    const { setDoorDashMenuActive } = await import('../lib/foodhub/doordash/stores');
    expect(await setDoorDashMenuActive(dd, true)).toMatchObject({ ok: false, status: 'blocked', message: expect.stringMatching(/nothing was published/) });
    expect(ddPublish).not.toHaveBeenCalled();

    const { planUberPublish } = await import('../lib/foodhub/menu/uber-publish');
    const row = (await planUberPublish()).rows.find((r) => r.channelStoreId === 'ue-pita')!;
    expect(row).toMatchObject({ action: 'skip', skip: 'menu_errors' });
    expect(row.issues.some((i) => i.code === 'no_dishes')).toBe(true);

    await repo.putDocs(DELIVERECT_LOCATIONS, [{ id: 'loc-ndg', key: 'NDG', at: new Date().toISOString(), data: { accountId: 'acc', locationId: 'loc-ndg', externalLocationId: 'NDG', name: 'NDG', registeredAt: new Date().toISOString() } }]);
    expect(await pushDeliverectProducts('loc-ndg')).toMatchObject({ ok: false, message: expect.stringMatching(/nothing was published/) });
    expect(push).not.toHaveBeenCalled();
    expect((await repo.listActivity({ limit: 20 })).some((a) => a.action === 'deliverect_sync_refused')).toBe(true);

    const { POST } = await import('../app/api/foodhub/menu/publish/route');
    const res = await POST(call('POST', '/api/foodhub/menu/publish', { brand: 'Pi Pita' }), ctx);
    expect(res.status).toBe(422);
    expect(ddPublish).not.toHaveBeenCalled();
    expect(uePublish).not.toHaveBeenCalled();
  });

  it('Menu partagé API: a stale list kept as it was never blocks another change; a failed dish-list write puts the sharing back', async () => {
    const repo = getRepo();
    await repo.saveMenu(sourceMenu());
    await saveMenuSharing({ 'Pi Pita': 'Cuisine Test' });
    // A re-import changed this list's refs: it matches nothing any more.
    await saveBrandDishes({ 'Pi Pita': ['old-ref'] });
    const { PUT } = await import('../app/api/foodhub/menu/sharing/route');
    const put = async (body: unknown) => { const r = await PUT(call('PUT', '/api/foodhub/menu/sharing', body), ctx); return { status: r.status, body: await r.json() }; };

    // Another brand starts sharing: Pi Pita's stale list is kept as it is, without and with `dishes` resent unchanged.
    expect(await put({ sharing: { 'Pi Pita': 'Cuisine Test', OOeuf: 'Cuisine Test' } })).toMatchObject({ status: 200, body: { dishes: { 'Pi Pita': ['old-ref'] } } });
    expect(await put({ sharing: { 'Pi Pita': 'Cuisine Test', OOeuf: 'Cuisine Test' }, dishes: { 'Pi Pita': ['old-ref'], OOeuf: ['clv-pizza'] } })).toMatchObject({ status: 200, body: { dishes: { 'Pi Pita': ['old-ref'], OOeuf: ['clv-pizza'] } } });
    // A list that is new or changed is still checked.
    expect((await put({ sharing: { 'Pi Pita': 'Cuisine Test', OOeuf: 'Cuisine Test' }, dishes: { 'Pi Pita': ['old-ref', 'other-old'], OOeuf: ['clv-pizza'] } })).status).toBe(422);

    // The second write fails: the sharing map is put back, nothing changed.
    const setKv = repo.setKv.bind(repo);
    vi.spyOn(repo, 'setKv').mockImplementation(async (key: string, value: unknown) => { if (key === 'menu_brand_dishes_v1') throw new Error('database down'); return setKv(key, value as never); });
    const failed = await put({ sharing: { OOeuf: 'Cuisine Test' }, dishes: { OOeuf: ['clv-pizza'] } });
    expect(failed.status).toBe(500);
    expect(failed.body.error).toMatch(/Nothing changed/);
    const { getMenuSharing } = await import('../lib/foodhub/menu/shared');
    expect(await getMenuSharing()).toEqual({ 'Pi Pita': 'Cuisine Test', OOeuf: 'Cuisine Test' });
  });
});
