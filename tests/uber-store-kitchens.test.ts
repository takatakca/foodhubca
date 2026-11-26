// The 7 Uber store UUIDs the owner gave on 2026-10-04 are all at 5839 Rue Jean-Talon E (Saint-Léonard) in Uber's own
// records, though Uber names most of them "(Hochelaga)". Production had them mapped to NDG_6284. Food Hub now
// suggests their real kitchen, and flags (with a one-click move) any of them mapped elsewhere.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import rawUber from '../data/actual/platform-stores-uber.json';
import rawLocations from '../data/actual/locations.json';
import { POST } from '../app/api/foodhub/stores/route';
import { GET as listKnown } from '../app/api/foodhub/stores/known/route';
import { POST as discover } from '../app/api/foodhub/stores/discover/route';
import * as uber from '../lib/foodhub/adapters/uber-eats';
import { hashPassword } from '../lib/foodhub/auth';
import { suggestMapping } from '../lib/foodhub/adapters/uber-provision';
import { KNOWN_UBER_KITCHENS, knownStores } from '../lib/foodhub/known-stores';
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
  FOODHUB_FORCE_MEMORY: 'true', DASHBOARD_PASSWORD: 'Owner-pass-123', SESSION_SECRET: undefined,
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
const save = (body: Record<string, unknown>) => POST(new Request('http://hub.local/api/foodhub/stores', { method: 'POST', headers: { authorization: `Basic ${Buffer.from('owner:Owner-pass-123').toString('base64')}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any, ctx);

describe('the 7 known Uber stores are in the Saint-Léonard kitchen', () => {
  it('data/actual records SAINT_LEONARD and 5839 Jean-Talon for exactly those 7 UUIDs', () => {
    expect(stores.map((s) => s.store_id).sort()).toEqual([...SAINT_LEONARD_UUIDS].sort());
    expect(stores.every((s) => s.location_code === 'SAINT_LEONARD' && /^5839 Rue Jean-Talon E\b.*H1S 1M4$/.test(s.address_on_uber))).toBe(true);
    expect((rawLocations as Array<{ code: string; address_line_1: string }>).find((l) => l.code === 'SAINT_LEONARD')?.address_line_1).toBe('5839 Rue Jean-Talon E');
    expect([...KNOWN_UBER_KITCHENS.values()]).toEqual(Array(7).fill('SAINT_LEONARD'));
  });

  it("Uber's own name and address pick Saint-Léonard: the civic number beats the \"(Hochelaga)\" in the name", () => {
    for (const s of stores) expect(suggestMapping(s.name_on_uber, s.address_on_uber).suggestedLocation, s.name_on_uber).toBe('SAINT_LEONARD');
    // Without an address, the name alone says Hochelaga — the reason the known kitchen is used instead of the name.
    expect(suggestMapping('Pi pita (Hochelaga)').suggestedLocation).toBe('HOCHELAGA');
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

  it('flags a store mapped to NDG_6284, and moving it keeps its brand, Clover register and menu lock', async () => {
    const id = '627d09f0-8fb4-57f2-8ec1-6a71984ad267';
    const first = await save({ channel: 'uber_eats', channelStoreId: id, brandName: 'PPP Pizzeria', locationCode: 'NDG_6284', cloverMerchantId: 'TESTMERCH0002', menuLocked: true, autoAccept: false });
    expect(first.status).toBe(200);
    const wrong = (await knownStores()).find((k) => k.storeId === id)!;
    expect(wrong).toMatchObject({ expectedLocation: 'SAINT_LEONARD', locationMismatch: true, mapped: { brandName: 'PPP Pizzeria', locationCode: 'NDG_6284' } });
    expect((await knownStores()).filter((k) => k.locationMismatch)).toHaveLength(1);

    // What the console's "Move" button sends.
    const moved = await save({ id: wrong.mapped!.id, channel: 'uber_eats', channelStoreId: id, brandName: 'PPP Pizzeria', locationCode: 'SAINT_LEONARD' });
    expect(moved.status).toBe(200);
    const store = await getRepo().findStore('uber_eats', id);
    expect(store).toMatchObject({ id: wrong.mapped!.id, locationCode: 'SAINT_LEONARD', brandName: 'PPP Pizzeria', cloverMerchantId: 'TESTMERCH0002', autoAccept: false });
    expect(store?.meta?.menuLocked).toBe(true);
    expect((await knownStores()).some((k) => k.locationMismatch)).toBe(false);
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
    vi.spyOn(uber.uberEatsAdapter, 'readiness').mockReturnValue({ ...readiness, canSend: true });
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
