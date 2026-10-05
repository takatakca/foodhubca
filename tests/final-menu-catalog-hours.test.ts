// Final — master menu editing/import/publish, 86 origin, catalog, store hours, TGTG days (menu-catalog-hours fix group).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { holidaySlotErrors, isOpenAt, openIntervals, saveHours } from '../lib/foodhub/hours';
import { localParts, startOfLocalDayMs } from '../lib/foodhub/time';
import type { MasterMenu, WeeklyHours } from '../lib/foodhub/types';

const publishMenuMock = vi.fn();
vi.mock('../lib/foodhub/ops', async (orig) => ({ ...(await orig<typeof import('../lib/foodhub/ops')>()), publishMenu: (...args: unknown[]) => publishMenuMock(...args) }));
const importMock = vi.fn();
vi.mock('../lib/foodhub/pos/clover', async (orig) => ({ ...(await orig<typeof import('../lib/foodhub/pos/clover')>()), importMenuFromClover: (...args: unknown[]) => importMock(...args) }));

const TZ = 'America/Toronto';
const actor = { username: 't', name: 'Test', source: 'dashboard' as const };
const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
const call = (method: string, path: string, body?: unknown) => new Request(`http://hub.local${path}`, {
  method, headers: { authorization: basic('owner', 'Owner-pass-123'), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});
const week = (open: string, close: string): WeeklyHours => Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, [{ open, close }]])) as WeeklyHours;
const dayStart = (date: string) => startOfLocalDayMs(Date.parse(`${date}T12:00:00Z`), TZ);
const ctx = {} as never;

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
  process.env.CLOVER_MERCHANT_ID = 'M1';
  delete process.env.CLOVER_MERCHANT_TOKENS;
  delete process.env.FOODHUB_TIMEZONE;
  (globalThis as any).__foodhubMem = undefined;
  publishMenuMock.mockReset();
  importMock.mockReset();
});

describe('store hours — DST-safe open intervals and holiday slots', () => {
  it('builds slot instants through the zone on the 25-hour (fall back) and 23-hour (spring forward) days', () => {
    for (const date of ['2026-11-01', '2026-03-08', '2026-10-05']) {
      const from = dayStart(date);
      const to = startOfLocalDayMs(from + 36 * 3600_000, TZ);
      const [slot] = openIntervals(week('11:00', '23:59'), [], from, to, TZ);
      expect(localParts(slot[0], TZ)).toMatchObject({ hour: 11, minute: 0 });
      // 23:59 + the closing minute = next local midnight, clamped to the day end.
      expect(slot[1]).toBe(to);
    }
    expect(new Date(openIntervals(week('11:00', '23:00'), [], dayStart('2026-11-01'), dayStart('2026-11-02'), TZ)[0][0]).toISOString()).toBe('2026-11-01T16:00:00.000Z'); // 11:00 EST
    expect(new Date(openIntervals(week('11:00', '23:00'), [], dayStart('2026-03-08'), dayStart('2026-03-09'), TZ)[0][0]).toISOString()).toBe('2026-03-08T15:00:00.000Z'); // 11:00 EDT
  });
  it('isOpenAt: 10:30 local on the fall-back day is closed, 11:30 is open', () => {
    const w = week('11:00', '23:00');
    expect(isOpenAt(w, [], Date.parse('2026-11-01T15:30:00Z'), TZ)).toBe(false); // 10:30 EST (the old dayStart + minutes maths said open)
    expect(isOpenAt(w, [], Date.parse('2026-11-01T16:30:00Z'), TZ)).toBe(true);  // 11:30 EST
    expect(isOpenAt(w, [], Date.parse('2026-11-02T03:30:00Z'), TZ)).toBe(true);  // 22:30 EST
    expect(isOpenAt(w, [], Date.parse('2026-11-02T04:30:00Z'), TZ)).toBe(false); // 23:30 EST
  });
  it('holiday special hours must end after they start (no crossing midnight)', async () => {
    expect(holidaySlotErrors({ closed: true, slots: [{ open: '18:00', close: '02:00' }] })).toEqual([]);
    expect(holidaySlotErrors({ closed: false, slots: [{ open: '12:00', close: '16:00' }] })).toEqual([]);
    expect(holidaySlotErrors({ closed: false, slots: [{ open: '18:00', close: '02:00' }] })[0]).toMatch(/cannot cross midnight/);
    expect(holidaySlotErrors({ closed: false, slots: [{ open: '10:00', close: '10:00' }] })).toHaveLength(1);
    expect(holidaySlotErrors({ closed: false, slots: [{ open: '25:00', close: '10:00' }] })[0]).toMatch(/HH:MM/);
    const bad = { id: 'h1', date: '2026-12-31', name: 'NYE', locationCodes: [], closed: false, slots: [{ open: '18:00', close: '02:00' }] };
    await expect(saveHours({ locations: {}, brands: {}, holidays: [bad] })).rejects.toThrow(/NYE.*cannot cross midnight/);
    const saved = await saveHours({ locations: {}, brands: {}, holidays: [{ ...bad, slots: [{ open: '18:00', close: '23:59' }] }] });
    expect(saved.holidays[0].slots).toEqual([{ open: '18:00', close: '23:59' }]);
  });
});

describe('Too Good To Go — bag day covers the whole local day', () => {
  it('sees a webhook order placed in the 25th hour of the fall-back day (no double counting)', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { saveBagDay } = await import('../lib/foodhub/tgtg');
    const at = '2026-11-02T04:20:00.000Z'; // 23:20 EST on 2026-11-01, after dayStart + 24 h
    await getRepo().insertOrderIfNew({ channel: 'tgtg', marketplace: 'tgtg', externalOrderId: 'tgtg-feed-1', displayId: 'F1', channelStoreId: 'tgtg-ndg', brandName: 'Too Good To Go', fulfillment: 'pickup', placedAt: at, currency: 'CAD', deliveryFee: 0, tip: 0, discount: 0, lines: [], subtotal: 5.99, tax: 0, total: 5.99, raw: {}, locationCode: 'NDG_MAIN', createdAt: at });
    const day = await saveBagDay({ date: '2026-11-01', locationCode: 'NDG_MAIN', bagsOffered: 5, bagsSold: 3, pricePerBag: 5.99 }, actor);
    expect(day.feedOrders).toBe(1);
    expect(day.orderId).toBeNull();
  });
});

describe('scheduled publish — claimed as running, results written per entry, stale runs fail', () => {
  it('never shows done before the publish was sent, and reports a cut-off run as failed', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { runDuePublishes } = await import('../lib/foodhub/menu/schedule');
    const now = Date.now();
    const base = { brand: 'Po Poulet', createdBy: 'owner', createdAt: new Date(now - 3600_000).toISOString() };
    await getRepo().setKv('scheduled_publishes', [
      { ...base, id: 'A', at: new Date(now - 60_000).toISOString(), status: 'scheduled' },
      { ...base, id: 'B', at: new Date(now - 30_000).toISOString(), status: 'scheduled' },
      { ...base, id: 'C', at: new Date(now - 20 * 60_000).toISOString(), status: 'running', startedAt: new Date(now - 15 * 60_000).toISOString() },
      { ...base, id: 'D', at: new Date(now - 5 * 60_000).toISOString(), status: 'running', startedAt: new Date(now - 2 * 60_000).toISOString() },
      { ...base, id: 'E', at: new Date(now + 3600_000).toISOString(), status: 'scheduled' },
    ]);
    const kv = async () => Object.fromEntries(((await getRepo().getKv<any[]>('scheduled_publishes')) ?? []).map((x) => [x.id, x]));
    publishMenuMock
      .mockImplementationOnce(async () => {
        const s = await kv();
        expect(s.A.status).toBe('running'); expect(s.A.startedAt).toBeTruthy(); expect(s.B.status).toBe('running'); // claimed, not "done"
        return [{ result: { ok: true, status: 'done' } }, { result: { ok: true, status: 'queued' } }];
      })
      .mockImplementationOnce(async () => {
        const s = await kv();
        expect(s.A).toMatchObject({ status: 'done', result: '2/2 stores updated' }); // A's outcome persisted before B started
        throw new Error('Uber timed out');
      });
    expect(await runDuePublishes(now)).toBe(2);
    const s = await kv();
    expect(s.A.status).toBe('done');
    expect(s.B).toMatchObject({ status: 'failed', result: 'Uber timed out' });
    expect(s.C.status).toBe('failed'); expect(s.C.result).toMatch(/interrupted/i);
    expect(s.D.status).toBe('running'); // still within the 10-minute grace
    expect(s.E.status).toBe('scheduled');
    expect(publishMenuMock).toHaveBeenCalledTimes(2);
  });
  it('a publish that reached no store is failed, not done', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { runDuePublishes } = await import('../lib/foodhub/menu/schedule');
    await getRepo().setKv('scheduled_publishes', [{ id: 'Z', brand: 'Po Poulet', createdBy: 'o', createdAt: new Date().toISOString(), at: new Date(Date.now() - 1000).toISOString(), status: 'scheduled' }]);
    publishMenuMock.mockResolvedValueOnce([]);
    await runDuePublishes();
    expect((await getRepo().getKv<any[]>('scheduled_publishes'))![0]).toMatchObject({ status: 'failed', result: '0/0 stores updated' });
  });
});

describe('Clover inventory sync — staff always has the last word on an 86', () => {
  async function setup() {
    const { getRepo } = await import('../lib/foodhub/repo');
    const repo = getRepo();
    await repo.upsertStore({ channel: 'uber_eats', channelStoreId: 'uber-1', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true } as any);
    await repo.saveMenu({ brandName: 'Po Poulet', categories: [{ ref: 'c', name: 'Plats', sortOrder: 0 }], items: [{ ref: 'clv-1', posItemRef: 'clv-1', name: 'Poutine', price: 9, categoryRef: 'c', available: true, modifierGroupRefs: [] }], modifierGroups: [], updatedAt: new Date().toISOString() });
    return repo;
  }
  const offAt = async (repo: Awaited<ReturnType<typeof setup>>) => ((await repo.getMenu('Po Poulet'))?.unavailableByLocation?.NDG_MAIN ?? []).includes('clv-1');

  it('a Clover restock re-enables only what Clover switched off', async () => {
    const repo = await setup();
    const { applyCloverItem } = await import('../lib/foodhub/clover-sync');
    expect((await applyCloverItem('M1', { id: 'clv-1', available: false })).turnedOff).toBe(1);
    expect(await offAt(repo)).toBe(true);
    expect((await applyCloverItem('M1', { id: 'clv-1', available: true })).turnedOn).toBe(1);
    expect(await offAt(repo)).toBe(false);
  });
  it('after staff re-enable and re-86 through the 86 Board, a Clover restock does not undo the staff 86', async () => {
    const repo = await setup();
    const { applyCloverItem, clearCloverOrigin } = await import('../lib/foodhub/clover-sync');
    const { POST } = await import('../app/api/foodhub/availability/route');
    await applyCloverItem('M1', { id: 'clv-1', available: false });
    expect((await repo.getKv<Record<string, boolean>>('clover_86'))?.['Po Poulet|NDG_MAIN|clv-1']).toBe(true);
    // Staff: "Back on" from the 86 Board (route clears the Clover origin and reports honest counts).
    const on = await POST(call('POST', '/api/foodhub/availability', { brand: 'Po Poulet', locationCode: 'NDG_MAIN', itemRefs: ['clv-1'], available: true }), ctx);
    const body = await on.json();
    expect(on.status).toBe(200);
    expect(body.results).toHaveLength(1);
    expect(body.okCount + body.blockedCount + body.errorCount).toBe(1);
    expect((await repo.getKv<Record<string, boolean>>('clover_86'))?.['Po Poulet|NDG_MAIN|clv-1']).toBeUndefined();
    // Staff: 86 it again for their own reason (fryer broken).
    await POST(call('POST', '/api/foodhub/availability', { brand: 'Po Poulet', locationCode: 'NDG_MAIN', itemRefs: ['clv-1'], available: false, minutes: 0 }), ctx);
    expect(await offAt(repo)).toBe(true);
    // Clover restock → must stay off.
    expect((await applyCloverItem('M1', { id: 'clv-1', available: true })).turnedOn).toBe(0);
    expect(await offAt(repo)).toBe(true);
    expect(await clearCloverOrigin('Po Poulet', ['clv-1'])).toBe(0);
  });
  it('clearCloverOrigin only touches the brand/location/refs asked for', async () => {
    const repo = await setup();
    const { clearCloverOrigin } = await import('../lib/foodhub/clover-sync');
    await repo.setKv('clover_86', { 'Po Poulet|NDG_MAIN|clv-1': true, 'Po Poulet|LAVAL|clv-1': true, 'Po Poulet|NDG_MAIN|clv-2': true, 'Pi Pita|NDG_MAIN|clv-1': true });
    expect(await clearCloverOrigin('Po Poulet', ['clv-1'], 'NDG_MAIN')).toBe(1);
    expect(await clearCloverOrigin('Po Poulet', ['clv-1'])).toBe(1); // every location
    expect(Object.keys((await repo.getKv<Record<string, boolean>>('clover_86'))!).sort()).toEqual(['Pi Pita|NDG_MAIN|clv-1', 'Po Poulet|NDG_MAIN|clv-2']);
  });
});

describe('PUT /api/foodhub/menu — validated allow-list, 86 state never from the editor', () => {
  const valid = (): Record<string, unknown> => ({
    brandName: 'Po Poulet',
    categories: [{ ref: 'c1', name: 'Plats', sortOrder: 0 }],
    items: [{ ref: 'i1', name: 'Poutine', price: 9.5, categoryRef: 'c1', available: true, modifierGroupRefs: ['g1'], channelPrices: { uber_eats: 10.5 } }],
    modifierGroups: [{ ref: 'g1', name: 'Sauce', min: 0, max: 1, modifiers: [{ ref: 'm1', name: 'Gravy', price: 0, available: true }] }],
  });
  it('rejects malformed shapes that would break the 86 Board and publish for the brand', async () => {
    const { PUT } = await import('../app/api/foodhub/menu/route');
    const put = async (menu: unknown) => { const r = await PUT(call('PUT', '/api/foodhub/menu', { menu }), ctx); return { status: r.status, body: await r.json() }; };
    expect((await put({ ...valid(), modifierGroups: [{ ref: 'g1', name: 'Sauces' }] })).body.error).toMatch(/modifierGroups\.0\.modifiers/);
    expect((await put({ ...valid(), items: [{ ...(valid().items as any[])[0], price: '12.50' }] })).body.error).toMatch(/items\.0\.price/);
    expect((await put({ ...valid(), items: [{ ...(valid().items as any[])[0], price: -1 }] })).status).toBe(400);
    expect((await put({ ...valid(), modifierGroups: [{ ...(valid().modifierGroups as any[])[0], min: 'two' }] })).status).toBe(400);
    expect((await put({ ...valid(), items: [(valid().items as any[])[0], (valid().items as any[])[0]] })).body.error).toMatch(/Duplicate item ref/);
    expect((await put({ ...valid(), brandName: 'No Such Brand' })).status).toBe(422);
    expect((await put({ brandName: 'Po Poulet' })).status).toBe(400);
    expect((await put(null)).status).toBe(400);
  });
  it('stores only allow-listed fields, defaults modifierGroupRefs, and keeps the stored 86 state', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { PUT } = await import('../app/api/foodhub/menu/route');
    await getRepo().saveMenu({ ...(valid() as unknown as MasterMenu), unavailableByLocation: { NDG_MAIN: ['i1'] }, unavailableUntil: { 'NDG_MAIN|i1': 123 }, updatedAt: 'x' });
    const items = [{ ref: 'i1', name: 'Poutine', price: 9.5, categoryRef: 'c1', available: true, rogue: 'x' }];
    // min > max and an orphan category are verifier errors (publish is blocked), not save errors.
    const payload = { ...valid(), items, modifierGroups: [{ ...(valid().modifierGroups as any[])[0], min: 3, max: 1 }], unavailableByLocation: { NDG_MAIN: ['i1', 'ghost'] }, unavailableUntil: {}, evil: true, hours: { monday: [] } };
    const r = await PUT(call('PUT', '/api/foodhub/menu', { menu: payload }), ctx);
    expect(r.status).toBe(200);
    const saved = (await getRepo().getMenu('Po Poulet'))!;
    expect(saved.items[0].modifierGroupRefs).toEqual([]);
    expect((saved.items[0] as any).rogue).toBeUndefined();
    expect((saved as any).evil).toBeUndefined();
    expect(saved.unavailableByLocation).toEqual({ NDG_MAIN: ['i1'] });
    expect(saved.unavailableUntil).toEqual({ 'NDG_MAIN|i1': 123 });
    expect(saved.modifierGroups[0]).toMatchObject({ min: 3, max: 1 });
  });
});

describe('POST /api/foodhub/menu/import — re-import keeps what the owner created in Food Hub', () => {
  const cloverMenu = (): MasterMenu => ({
    brandName: 'Po Poulet',
    categories: [{ ref: 'clv-cat-1', name: 'Plats', sortOrder: 1 }],
    items: [{ ref: 'clv-1', posItemRef: 'clv-1', name: 'Grilled chicken', description: 'Poulet grillé', price: 14.99, categoryRef: 'clv-cat-1', available: true, modifierGroupRefs: ['grp-1'] }],
    modifierGroups: [{ ref: 'grp-1', name: 'Sauce', min: 0, max: 1, modifiers: [{ ref: 'mod-1', posModifierRef: 'mod-1', name: 'Piri-piri', price: 1, available: true }] }],
    updatedAt: new Date().toISOString(),
  });
  it('merges Clover with the existing menu: custom items/categories/groups stay, gone Clover objects go, owner description wins', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { POST } = await import('../app/api/foodhub/menu/import/route');
    importMock.mockResolvedValue(cloverMenu());
    await getRepo().saveMenu({
      brandName: 'Po Poulet',
      categories: [{ ref: 'clv-cat-1', name: 'Plats', nameFr: 'Plats', sortOrder: 1, hours: week('11:00', '14:00') }, { ref: 'cat-combo', name: 'Combos', sortOrder: 5 }, { ref: 'clv-cat-old', name: 'Old', sortOrder: 2 }],
      items: [
        { ref: 'clv-1', posItemRef: 'clv-1', name: 'Grilled chicken', description: 'Half chicken, fries, coleslaw', nameFr: 'Poulet grillé', price: 13, channelPrices: { uber_eats: 16.49 }, categoryRef: 'clv-cat-1', available: true, modifierGroupRefs: ['grp-1', 'grp-custom'] },
        { ref: 'clv-old', posItemRef: 'clv-old', name: 'Removed in Clover', price: 5, categoryRef: 'clv-cat-old', available: true, modifierGroupRefs: [] },
        { ref: 'item-combo', name: 'Combo du jour', price: 19, categoryRef: 'cat-combo', available: true, modifierGroupRefs: ['grp-custom', 'grp-gone'] },
      ],
      modifierGroups: [
        { ref: 'grp-1', name: 'Sauce', nameFr: 'Sauce', min: 0, max: 1, modifiers: [{ ref: 'mod-1', posModifierRef: 'mod-1', name: 'Piri-piri', nameFr: 'Piri-piri', price: 1, available: true }] },
        { ref: 'grp-custom', name: 'Sides', min: 0, max: 2, modifiers: [{ ref: 'mod-side', name: 'Fries', price: 2, available: true }] },
        { ref: 'grp-gone', name: 'Was Clover', min: 0, max: 1, modifiers: [{ ref: 'mod-gone', posModifierRef: 'mod-gone', name: 'X', price: 0, available: true }] },
      ],
      unavailableByLocation: { NDG_MAIN: ['clv-1'] },
      updatedAt: 'x',
    });
    const r = await POST(call('POST', '/api/foodhub/menu/import', { brand: 'Po Poulet' }), ctx);
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(importMock).toHaveBeenCalledWith('Po Poulet', 'M1');
    expect(body.imported).toEqual({ categories: 1, items: 1, modifierGroups: 1 });
    expect(body.kept).toEqual({ categories: 1, items: 1, modifierGroups: 1 });
    const m = (await getRepo().getMenu('Po Poulet'))! as MasterMenu & { posMerchantId?: string };
    expect(m.posMerchantId).toBe('M1');
    expect(m.items.map((i) => i.ref)).toEqual(['clv-1', 'item-combo']);
    const clv = m.items[0];
    expect(clv).toMatchObject({ price: 14.99, description: 'Half chicken, fries, coleslaw', nameFr: 'Poulet grillé', channelPrices: { uber_eats: 16.49 } });
    expect(clv.modifierGroupRefs).toEqual(['grp-1', 'grp-custom']);
    expect(m.items[1].modifierGroupRefs).toEqual(['grp-custom']); // grp-gone no longer exists
    expect(m.categories.map((c) => c.ref)).toEqual(['clv-cat-1', 'cat-combo']);
    expect(m.categories[0]).toMatchObject({ nameFr: 'Plats', hours: week('11:00', '14:00') });
    expect(m.modifierGroups.map((g) => g.ref)).toEqual(['grp-1', 'grp-custom']);
    expect(m.modifierGroups[0].modifiers[0].nameFr).toBe('Piri-piri');
    expect(m.unavailableByLocation).toEqual({ NDG_MAIN: ['clv-1'] });
  });
  it('first import works without an existing menu; the merchant must be a configured one', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { GET, POST } = await import('../app/api/foodhub/menu/import/route');
    importMock.mockResolvedValue(cloverMenu());
    process.env.CLOVER_MERCHANT_TOKENS = JSON.stringify({ M2: 'tok' });
    await getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'dd-laval', brandName: 'Po Poulet', locationCode: 'LAVAL', cloverMerchantId: 'M2', autoAccept: true, online: true } as any);
    const list = await (await GET(call('GET', '/api/foodhub/menu/import'), ctx)).json();
    expect(list.defaultMerchantId).toBe('M1');
    expect(list.merchants).toEqual([{ id: 'M1', isDefault: true, locations: [] }, { id: 'M2', isDefault: false, locations: ['LAVAL'] }]);
    expect((await POST(call('POST', '/api/foodhub/menu/import', { brand: 'Po Poulet', merchantId: 'M9' }), ctx)).status).toBe(400);
    const r = await POST(call('POST', '/api/foodhub/menu/import', { brand: 'Po Poulet', merchantId: 'M2' }), ctx);
    expect((await r.json()).merchantId).toBe('M2');
    expect(importMock).toHaveBeenLastCalledWith('Po Poulet', 'M2');
    expect(((await getRepo().getMenu('Po Poulet')) as any).posMerchantId).toBe('M2');
  });
});

describe('publish status and catalog', () => {
  it('GET /api/foodhub/menu/publish finds the last publish even when 500+ 86 toggles came after it', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { GET } = await import('../app/api/foodhub/menu/publish/route');
    const repo = getRepo();
    const store = await repo.upsertStore({ channel: 'uber_eats', channelStoreId: 'uber-1', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true } as any);
    await repo.addActivity({ at: '2026-10-01T12:00:00.000Z', actor: 'owner', source: 'dashboard', kind: 'menu_publish', action: 'publish', status: 'success', summary: 'Menu published', storeId: store.id, channel: 'uber_eats', detail: { result: { status: 'done', message: 'Menu accepted' } } });
    for (let i = 0; i < 520; i++) await repo.addJob({ kind: 'item_toggle', channel: 'uber_eats', status: 'done', request: { storeId: store.id }, result: null });
    const body = await (await GET(call('GET', '/api/foodhub/menu/publish?brand=Po%20Poulet'), ctx)).json();
    expect(body.stores[0]).toMatchObject({ storeId: store.id, status: 'done', at: '2026-10-01T12:00:00.000Z', message: 'Menu accepted' });
  });
  it('rejects a comma in a brand name', async () => {
    const { saveBrand } = await import('../lib/foodhub/catalog');
    await expect(saveBrand({ name: 'Bin molle, Bin dure', active: true })).rejects.toThrow(/comma/);
    expect((await saveBrand({ name: 'Nouvelle Marque', active: true })).brands.some((b) => b.name === 'Nouvelle Marque')).toBe(true);
  });
});
