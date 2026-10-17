// The 7 Uber store UUIDs the owner gave on 2026-10-04 are all at 5839 Rue Jean-Talon E (Saint-Léonard) in Uber's own
// records, though Uber names most of them "(Hochelaga)". Production had them mapped to NDG_6284. Food Hub now
// suggests their real kitchen, and flags (with a one-click move) any of them mapped elsewhere.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import rawUber from '../data/actual/platform-stores-uber.json';
import rawLocations from '../data/actual/locations.json';
import { POST } from '../app/api/foodhub/stores/route';
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
