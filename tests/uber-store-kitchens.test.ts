// The 7 Uber store UUIDs the owner gave on 2026-10-04 are all at 5839 Rue Jean-Talon E (Saint-Léonard) in Uber's own
// records, though Uber names most of them "(Hochelaga)". Production had them mapped to NDG_6284. Food Hub now
// suggests their real kitchen, and flags (with a one-click move) any of them mapped elsewhere.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import rawUber from '../data/actual/platform-stores-uber.json';
import rawLocations from '../data/actual/locations.json';
import { POST } from '../app/api/foodhub/stores/route';
import { GET as listKnown } from '../app/api/foodhub/stores/known/route';
import { POST as discover } from '../app/api/foodhub/stores/discover/route';
import { POST as activate } from '../app/api/foodhub/uber-connect/activate/route';
import * as uber from '../lib/foodhub/adapters/uber-eats';
import { hashPassword } from '../lib/foodhub/auth';
import * as uberProvision from '../lib/foodhub/adapters/uber-provision';
import { KNOWN_UBER_KITCHENS, knownStores } from '../lib/foodhub/known-stores';
import { saveLocation } from '../lib/foodhub/catalog';
import { getRepo } from '../lib/foodhub/repo';

const SAINT_LEONARD_UUIDS = [
  'b6b36ca0-bc57-50d0-a184-1d28bf74771f', '627d09f0-8fb4-57f2-8ec1-6a71984ad267', 'd4e00c50-971f-5eb4-afa2-d48231f98a48',
  'c5585882-ab06-5a2f-bbc2-66fe5ec9179c', '8c0a69ee-1667-5aa7-a8e6-7fdb707095da', '8179598e-a40f-509e-8b03-59ce49d57d77',
  '7656b055-48d1-5f46-a6a7-2a0d23668c0b',
];
type Row = { store_id: string; uber_name?: string; name_on_uber: string; location_code?: string; address_on_uber: string };
const stores = rawUber.stores as Row[];
const ndg = rawUber.ndg_not_mapped.stores as Row[];

const saved: Record<string, string | undefined> = {};
const ENV: Record<string, string | undefined> = {
  CLOVER_MERCHANT_ID: 'DEFAULTCAISSE', FOODHUB_FORCE_MEMORY: 'true', DASHBOARD_PASSWORD: 'Owner-pass-123', SESSION_SECRET: undefined,
  UBER_CLIENT_ID: undefined, UBER_CLIENT_SECRET: undefined, UBER_ACCESS_TOKEN: undefined,
};
beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  (globalThis as any).__foodhubMem = undefined;
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.restoreAllMocks();
});

const ctx = { params: Promise.resolve({}) } as any;
const ownerPost = (path: string, body: Record<string, unknown>) => new Request(`http://hub.local/api/foodhub/${path}`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from('owner:Owner-pass-123').toString('base64')}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const save = (body: Record<string, unknown>) => POST(ownerPost('stores', body), ctx);

describe('the 7 known Uber stores are in the Saint-Léonard kitchen', () => {
  it('data/actual records SAINT_LEONARD and 5839 Jean-Talon for exactly those 7 UUIDs', () => {
    expect(stores.map((s) => s.store_id).sort()).toEqual([...SAINT_LEONARD_UUIDS].sort());
    expect(stores.every((s) => s.location_code === 'SAINT_LEONARD' && /^5839 Rue Jean-Talon E\b.*H1S 1M4$/.test(s.address_on_uber))).toBe(true);
    expect((rawLocations as Array<{ code: string; address_line_1: string }>).find((l) => l.code === 'SAINT_LEONARD')?.address_line_1).toBe('5839 Rue Jean-Talon E');
    expect([...KNOWN_UBER_KITCHENS.values()]).toEqual(Array(7).fill('SAINT_LEONARD'));
  });

  it("Uber's own name and address pick Saint-Léonard: the civic number beats the \"(Hochelaga)\" in the name", () => {
    for (const s of stores) expect(uberProvision.suggestMapping(s.name_on_uber, s.address_on_uber).suggestedLocation, s.name_on_uber).toBe('SAINT_LEONARD');
    // Without an address, the name alone says Hochelaga — the reason the known kitchen is used instead of the name.
    expect(uberProvision.suggestMapping('Pi pita (Hochelaga)').suggestedLocation).toBe('HOCHELAGA');
  });

  it('the NDG stores are only a reference list: other UUIDs, at 6280 Somerled, never Po Poulet', () => {
    expect(ndg.length).toBe(9);
    expect(ndg.some((s) => SAINT_LEONARD_UUIDS.includes(s.store_id))).toBe(false);
    expect(ndg.every((s) => /^6280 Somerled|^6280 Avenue Somerled/.test(s.address_on_uber) && !('location_code' in s))).toBe(true);
    expect([...stores, ...ndg].some((s) => /po\s*poulet|peau\s*poulet/i.test(`${s.name_on_uber} ${s.uber_name ?? ''}`))).toBe(false);
    expect(ndg.every((s) => !KNOWN_UBER_KITCHENS.has(s.store_id))).toBe(true);
  });
});

describe('Stores → Mapping: known Uber stores', () => {
  it('suggests Saint-Léonard for an unlinked store, even without the Uber keys', async () => {
    const list = await knownStores();
    expect(list).toHaveLength(7);
    expect(list.every((k) => !k.confirmedByPlatform && k.suggestedLocation === 'SAINT_LEONARD' && k.expectedLocation === 'SAINT_LEONARD' && !k.locationMismatch)).toBe(true);
  });

  it('keeps the recorded kitchen distinct from a kitchen suggested by a current Uber address', async () => {
    vi.spyOn(uber.uberEatsAdapter, 'readiness').mockReturnValue({ ...uber.uberEatsAdapter.readiness(), configured: true });
    const details = vi.spyOn(uber, 'fetchUberStoreDetails');
    for (const result of [
      { ok: false, error: 'invalid_scope' }, { ok: true, name: 'Test brand' },
    ]) {
      details.mockResolvedValue(result);
      const list = await knownStores();
      expect(list[0]).toMatchObject({ confirmedByPlatform: false, expectedLocation: 'SAINT_LEONARD' });
    }
    details.mockResolvedValue({ ok: true, address: '100 Example Street' });
    expect((await knownStores())[0]).toMatchObject({ confirmedByPlatform: false, expectedLocation: null, suggestedLocation: null });
    details.mockResolvedValue({ ok: true, address: '6280 Avenue Somerled' });
    const list = await knownStores();
    expect(list[0]).toMatchObject({ confirmedByPlatform: true, expectedLocation: 'NDG_MAIN' });
  });

  it('flags a store mapped to NDG_6284 and moves it only with an explicit destination Clover merchant', async () => {
    const id = '627d09f0-8fb4-57f2-8ec1-6a71984ad267';
    const mapping = { channel: 'uber_eats', channelStoreId: id, brandName: 'PPP Pizzeria' };
    const first = await save({ ...mapping, locationCode: 'NDG_6284', cloverMerchantId: 'TESTMERCH0002', menuLocked: true, autoAccept: false });
    expect(first.status).toBe(200);
    const wrong = (await knownStores()).find((k) => k.storeId === id)!;
    expect(wrong).toMatchObject({ expectedLocation: 'SAINT_LEONARD', locationMismatch: true, mapped: { brandName: 'PPP Pizzeria', locationCode: 'NDG_6284' } });
    expect((await knownStores()).filter((k) => k.locationMismatch)).toHaveLength(1);

    const before = await getRepo().findStore('uber_eats', id);
    const move = { ...mapping, locationCode: 'SAINT_LEONARD' };
    const rowId = wrong.mapped!.id;
    for (const incomplete of [move, { ...move, id: rowId, cloverMerchantId: ' ' }, { ...move, id: '00000000-0000-4000-8000-000000000001' }]) {
      const refused = await save(incomplete);
      expect(refused.status).toBe(400);
      expect((await refused.json()).error).toMatch(/destination Clover merchant/);
    }
    expect((await save({ ...move, id: rowId, cloverMerchantId: '123456789' })).status).toBe(400);
    expect(await getRepo().findStore('uber_eats', id)).toEqual(before);

    for (const permit of [{ cloverMerchantId: ' TESTMERCH0003 ' }, {}]) {
      expect((await save({ ...move, id: rowId, ...permit })).status).toBe(200);
      const store = await getRepo().findStore('uber_eats', id);
      expect(store).toMatchObject({ id: rowId, locationCode: 'SAINT_LEONARD', brandName: 'PPP Pizzeria', cloverMerchantId: 'TESTMERCH0003', autoAccept: false });
      expect(store?.meta?.menuLocked).toBe(true);
    }
    expect((await knownStores()).some((k) => k.locationMismatch)).toBe(false);

    // Kitchens sharing a Clover merchant can explicitly select that same register.
    expect((await save({ ...mapping, id: rowId, locationCode: 'NDG_6284', cloverMerchantId: 'TESTMERCH0003' })).status).toBe(200);
    expect(await getRepo().findStore('uber_eats', id)).toMatchObject({ id: rowId, locationCode: 'NDG_6284', cloverMerchantId: 'TESTMERCH0003' });
  });

  it('validates every Uber activation pick before calling the provider or saving any mapping', async () => {
    const storeId = 'synthetic-moved-uber-store';
    const brandName = 'PPP Pizzeria';
    expect((await save({ channel: 'uber_eats', channelStoreId: storeId, brandName, locationCode: 'NDG_6284', cloverMerchantId: 'TESTMERCH0002', autoAccept: false, menuLocked: true })).status).toBe(200);
    const before = await getRepo().findStore('uber_eats', storeId);
    const readiness = uber.uberEatsAdapter.readiness();
    vi.spyOn(uber.uberEatsAdapter, 'readiness').mockReturnValue({ ...readiness, canSend: true });
    const provider = vi.spyOn(uberProvision, 'activateUberStores').mockImplementation(async (_id, picks) => picks.map((pick) => ({
      storeId: pick.storeId, result: { channel: 'uber_eats', status: 'done', ok: true, message: 'OK' }, enabled: null, pos: null, message: 'OK',
    })));
    const destination = { storeId, brandName, locationCode: 'SAINT_LEONARD' };
    const fresh = { storeId: 'synthetic-new-uber-store', brandName, locationCode: 'NDG_6284' };
    const request = (pick: typeof destination & { cloverMerchantId?: string }) => activate(ownerPost('uber-connect/activate', { id: 'synthetic-session', stores: [fresh, pick] }), ctx);

    const refused = await request(destination);
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/destination Clover merchant/);
    expect(provider).not.toHaveBeenCalled();
    expect(await getRepo().listStores('uber_eats')).toEqual([before]);

    expect((await request({ ...destination, cloverMerchantId: 'TESTMERCH0003' })).status).toBe(200);
    expect((await request(destination)).status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(await getRepo().findStore('uber_eats', fresh.storeId)).toMatchObject({ locationCode: fresh.locationCode, cloverMerchantId: null });
    expect(await getRepo().findStore('uber_eats', storeId)).toMatchObject({ id: before!.id, locationCode: destination.locationCode, brandName, cloverMerchantId: 'TESTMERCH0003', autoAccept: false, meta: { menuLocked: true } });
  });
});

describe('scope of merchant inventory route results', () => {
  const managerPassword = 'Test-manager-123';

  async function manager(username: string, locations: string[]) {
    await getRepo().saveUser({
      username, name: 'Test manager', role: 'manager', locations, active: true,
      passwordHash: hashPassword(managerPassword),
    });
  }

  function inventoryRequest(endpoint: 'known' | 'discover', username = 'owner') {
    const password = username === 'owner' ? 'Owner-pass-123' : managerPassword;
    const headers = {
      authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      'content-type': 'application/json',
    };
    return new Request(`http://hub.local/api/foodhub/stores/${endpoint}`, endpoint === 'known'
      ? { headers }
      : { headers, method: 'POST', body: JSON.stringify({ channel: 'uber_eats' }) });
  }

  async function linkStore(channelStoreId: string, locationCode: string) {
    expect((await save({ channel: 'uber_eats', channelStoreId, brandName: 'PPP Pizzeria', locationCode })).status).toBe(200);
  }

  it('shows known stores only at the recorded kitchen and hides conflicting mappings from single-kitchen managers', async () => {
    const [conflicting] = KNOWN_UBER_KITCHENS.keys();
    await linkStore(conflicting, 'NDG_6284');
    await manager('saint-manager', ['SAINT_LEONARD']);
    await manager('ndg-manager', ['NDG_6284']);

    const owner = await listKnown(inventoryRequest('known'), ctx);
    expect(owner.status).toBe(200);
    expect((await owner.json()).stores).toHaveLength(7);
    const saint = await listKnown(inventoryRequest('known', 'saint-manager'), ctx);
    expect(saint.status).toBe(200);
    expect((await saint.json()).stores).toHaveLength(6);
    const ndg = await listKnown(inventoryRequest('known', 'ndg-manager'), ctx);
    expect(ndg.status).toBe(200);
    expect(await ndg.json()).toMatchObject({ stores: [] });
  });

  it('keeps discovery complete for unscoped users and withholds unknown and conflicting stores from a scoped manager', async () => {
    const [conflicting, recorded] = KNOWN_UBER_KITCHENS.keys();
    const ndgAddress = rawLocations.find((loc) => loc.code === 'NDG_6284')!.address_line_1;
    const stores = [
      { id: 'test-mapped-uber-store', name: 'Mapped store' },
      { id: 'test-unmapped-uber-store', name: 'Unmapped store' },
      { id: conflicting, name: 'Conflicting mapping' },
      { id: recorded, name: 'Recorded kitchen' },
      { id: 'test-moved-uber-store', name: 'Address conflicts with mapping', address: ndgAddress },
    ];
    const readiness = uber.uberEatsAdapter.readiness();
    vi.spyOn(uber.uberEatsAdapter, 'readiness').mockReturnValue({ ...readiness, configured: true, canSend: false });
    vi.spyOn(uber, 'discoverUberStores').mockResolvedValue(stores);
    await linkStore('test-mapped-uber-store', 'SAINT_LEONARD');
    await linkStore(conflicting, 'NDG_6284');
    await linkStore('test-moved-uber-store', 'SAINT_LEONARD');
    await manager('saint-manager', ['SAINT_LEONARD']);

    const owner = await discover(inventoryRequest('discover'), ctx);
    expect(owner.status).toBe(200);
    expect(await owner.json()).toMatchObject({ stores });
    const saint = await discover(inventoryRequest('discover', 'saint-manager'), ctx);
    expect(saint.status).toBe(200);
    expect(await saint.json()).toMatchObject({ stores: [stores[0], stores[3]] });
  });
});

describe('merchant address evidence', () => {
  it.each([
    ['6284 Avenue Somerled, Montréal', 'NDG_6284', true],
    ['6280 Somerled Ave', 'NDG_MAIN', true],
    ['6284 Av Somerled, Laval', null, false],
    ['6284 Av Somerled, Laval QC H3X 2B6', null, false],
    ['6284 Av Somerled, local 2, Montréal', null, false],
    ['6284 Av Somerled, Montréal, QC H1W 2E6', null, false],
    ['5837 Rue Jean-Talon Est, Montréal', 'SAINT_LEONARD', true],
    ['5839 rue Jean-Talon Est, Saint-Léonard', 'SAINT_LEONARD', true],
    ['6280 Rue Exemple, Montréal', null, false],
    ['6280 Avenue Somerled Ouest', null, false],
    ['Av. Somerled', null, false],
    ['Rue Jean-Talon Est', null, false],
    ['Saint-Léonard', null, false],
    ['', 'SAINT_LEONARD', false],
  ] as const)('resolves the kitchen from the returned street address %j', async (address, expectedLocation, confirmedByPlatform) => {
    vi.spyOn(uber.uberEatsAdapter, 'readiness').mockReturnValue({ ...uber.uberEatsAdapter.readiness(), configured: true });
    vi.spyOn(uber, 'fetchUberStoreDetails').mockResolvedValue({ ok: true, name: 'Pi pita (Hochelaga)', address });
    const rows = await knownStores();
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row).toMatchObject({ expectedLocation, suggestedLocation: expectedLocation, confirmedByPlatform });
    }
  });

  it('rechecks saved Uber sessions against active kitchens before suggesting the Clover destination', async () => {
    const id = 'a'.repeat(36);
    const address = '42 Rue Exemple';
    await getRepo().setKv(`uber-connect:${id}`, {
      createdAt: Date.now(), token: 'test-session', stores: [{ id: 'sample', name: 'Pi Pita', address, suggestedLocation: 'NDG_MAIN' }],
    });
    const place = { code: 'NEW_KITCHEN', name: 'Test kitchen', address, active: true };
    const suggestion = async () => (await uberProvision.uberConnectSession(id))?.stores[0].suggestedLocation;
    expect(await suggestion()).toBeUndefined();
    await saveLocation(place);
    expect(await suggestion()).toBe(place.code);
    await saveLocation({ ...place, code: 'SECOND_KITCHEN' });
    expect(await suggestion()).toBeUndefined();
    await saveLocation({ ...place, active: false });
    expect(await suggestion()).toBe('SECOND_KITCHEN');
  });

});

describe('Clover register selection in the Uber connection flow', () => {
  const brandName = 'Pi Pita';
  const kitchen = 'NDG_MAIN';
  const sessionId = 'b'.repeat(36);
  async function link(id: string, register: string, locationCode = kitchen) {
    expect((await save({ channel: 'uber_eats', channelStoreId: id, brandName, locationCode, cloverMerchantId: register })).status).toBe(200);
  }
  async function session(storeId: string) {
    await getRepo().setKv(`uber-connect:${sessionId}`, {
      createdAt: Date.now(), token: 'test-only', stores: [{ id: storeId, name: brandName, address: '6280 Avenue Somerled' }],
    });
    return (await uberProvision.uberConnectSession(sessionId))!.stores[0];
  }

  it('keeps a store’s own register and never suggests the majority register for a new or moving store', async () => {
    await link('majority-one', 'REGISTERAAA');
    await link('majority-two', 'REGISTERAAA');
    expect((await session('new')).suggestedClover).toBe('REGISTERAAA');
    await link('moving', 'REGISTERSRC', 'HOCHELAGA');
    expect((await session('moving')).suggestedClover).toBeUndefined();
    await link('minority', 'REGISTERBBB');
    expect((await session('minority')).suggestedClover).toBe('REGISTERBBB');
    expect((await session('new')).suggestedClover).toBeUndefined();
    await link('uses-default', '');
    expect((await session('uses-default')).suggestedClover).toBeUndefined();
  });

  it('counts an implicit default using its actual destination, including an unresolved default', async () => {
    await link('implicit', '');
    await link('explicit', 'DEFAULTCAISSE');
    expect((await session('new')).suggestedClover).toBe('DEFAULTCAISSE');
    process.env.CLOVER_MERCHANT_ID = 'OTHERREGISTER';
    expect((await session('new')).suggestedClover).toBeUndefined();
    delete process.env.CLOVER_MERCHANT_ID;
    expect((await session('new')).suggestedClover).toBeUndefined();
  });

  it('rechecks a stale suggestion and the whole batch before activation, then accepts a deliberate choice', async () => {
    const pick = { storeId: 'new', locationCode: kitchen, brandName };
    const other = { ...pick, storeId: 'unrelated', locationCode: 'HOCHELAGA' };
    const submit = (patch: Record<string, unknown>) => activate(ownerPost('uber-connect/activate', {
      id: sessionId, stores: [other, { ...pick, ...patch }],
    }), ctx);
    await link('peer', 'REGISTERAAA');
    const suggestion = (await session('new')).suggestedClover;
    expect(suggestion).toBe('REGISTERAAA');
    await link('second-peer', '');
    vi.spyOn(uber.uberEatsAdapter, 'readiness').mockReturnValue({ ...uber.uberEatsAdapter.readiness(), canSend: true });
    const provider = vi.spyOn(uberProvision, 'activateUberStores').mockImplementation(async (_id, picks) => picks.map((p) => ({
      storeId: p.storeId, result: { channel: 'uber_eats', status: 'done', ok: true, message: 'OK' }, enabled: null, pos: null, message: 'OK',
    })));
    for (const patch of [{}, { cloverMerchantId: suggestion, cloverSuggested: true }]) {
      const response = await submit(patch);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/Clover/);
    }
    expect(provider).not.toHaveBeenCalled();
    expect(await getRepo().findStore('uber_eats', 'unrelated')).toBeNull();
    expect((await submit({ cloverMerchantId: 'REGISTERAAA' })).status).toBe(200);
    expect(await getRepo().findStore('uber_eats', 'new')).toMatchObject({ cloverMerchantId: 'REGISTERAAA' });
  });
});
