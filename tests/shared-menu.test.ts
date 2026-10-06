// One menu for several brands (UrbanPiper Menu Aggregator style): a brand follows another brand's master menu.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { doorDashAdapter } from '../lib/foodhub/adapters/doordash';
import { uberEatsAdapter } from '../lib/foodhub/adapters/uber-eats';
import { activeMenus, cleanSharing, getBrandMenu, groupOf, saveMenuSharing } from '../lib/foodhub/menu/shared';
import { publishMenu, reenableExpiredItems, setItemAvailability } from '../lib/foodhub/ops';
import { getRepo } from '../lib/foodhub/repo';
import type { MasterMenu } from '../lib/foodhub/types';

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
const call = (method: string, path: string, body?: unknown) => new Request(`http://hub.local${path}`, {
  method, headers: { authorization: basic('owner', 'Owner-pass-123'), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});
const ctx = {} as never;

const menu = (brandName: string, itemName = 'Poutine'): MasterMenu => ({
  brandName,
  categories: [{ ref: 'c1', name: 'Plats', sortOrder: 0 }],
  items: [{ ref: 'i1', name: itemName, price: 9.5, categoryRef: 'c1', available: true, modifierGroupRefs: [] }],
  modifierGroups: [],
  updatedAt: new Date().toISOString(),
});

async function store(brandName: string, channel: 'doordash' | 'uber_eats', id: string) {
  return getRepo().upsertStore({ channel, channelStoreId: id, brandName, locationCode: 'NDG', autoAccept: true, online: true, meta: {} });
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
  (globalThis as any).__foodhubMem = undefined;
  vi.restoreAllMocks();
});

describe('menu sharing map', () => {
  it('drops self-links and chains; refuses to save a chain', async () => {
    expect(cleanSharing({ 'Pi Pita': 'Po Poulet', 'Po Poulet': 'Po Poulet', OOeuf: 'Pi Pita' })).toEqual({ 'Pi Pita': 'Po Poulet' });
    await expect(saveMenuSharing({ 'Pi Pita': 'Po Poulet', 'Po Poulet': 'OOeuf' })).rejects.toThrow(/follows another brand/);
    expect(groupOf({ 'Pi Pita': 'Po Poulet', OOeuf: 'Po Poulet' }, 'OOeuf')).toEqual(['Po Poulet', 'OOeuf', 'Pi Pita']);
  });

  it('a follower sees the source menu under its own name; its own stored menu is kept but inactive', async () => {
    await getRepo().saveMenu(menu('Po Poulet'));
    await getRepo().saveMenu(menu('Pi Pita', 'Old pita item'));
    await saveMenuSharing({ 'Pi Pita': 'Po Poulet' });
    const seen = (await getBrandMenu('Pi Pita'))!;
    expect(seen.brandName).toBe('Pi Pita');
    expect(seen.items[0].name).toBe('Poutine');
    expect((await activeMenus()).map((m) => m.brandName)).toEqual(['Po Poulet']);
    expect((await getRepo().getMenu('Pi Pita'))!.items[0].name).toBe('Old pita item');
  });
});

describe('publish and 86 across brands that share a menu', () => {
  it('publishes the shared menu to a follower store under the follower brand name', async () => {
    await getRepo().saveMenu(menu('Po Poulet'));
    await saveMenuSharing({ 'Pi Pita': 'Po Poulet' });
    await store('Pi Pita', 'doordash', 'dd-pita');
    const spy = vi.spyOn(doorDashAdapter, 'publishMenu').mockResolvedValue({ channel: 'doordash', ok: true, status: 'queued', message: 'OK' });
    const rows = await publishMenu('Pi Pita');
    expect(rows).toHaveLength(1);
    const sent = spy.mock.calls[0][1];
    expect(sent.brandName).toBe('Pi Pita');
    expect(sent.items.map((i) => i.name)).toEqual(['Poutine']);
  });

  it('an 86 on any brand of the group is saved on the shared menu and sent to every brand’s stores', async () => {
    await getRepo().saveMenu(menu('Po Poulet'));
    await saveMenuSharing({ 'Pi Pita': 'Po Poulet', OOeuf: 'Po Poulet' });
    await store('Po Poulet', 'uber_eats', 'ue-poulet');
    await store('Pi Pita', 'doordash', 'dd-pita');
    await store('OOeuf', 'doordash', 'dd-oeuf');
    await store('Pizza Inntime', 'doordash', 'dd-pizza');
    const dd = vi.spyOn(doorDashAdapter, 'setItemAvailability').mockResolvedValue({ channel: 'doordash', ok: true, status: 'done', message: 'OK' });
    const ue = vi.spyOn(uberEatsAdapter, 'setItemAvailability').mockResolvedValue({ channel: 'uber_eats', ok: true, status: 'done', message: 'OK' });
    const rows = await setItemAvailability('Pi Pita', ['i1'], false, { locationCode: 'NDG' });
    expect(rows.map((r) => r.brandName).sort()).toEqual(['OOeuf', 'Pi Pita', 'Po Poulet']);
    expect(dd.mock.calls.map((c) => c[0].channelStoreId).sort()).toEqual(['dd-oeuf', 'dd-pita']);
    expect(ue).toHaveBeenCalledTimes(1);
    expect((await getRepo().getMenu('Po Poulet'))!.unavailableByLocation?.NDG).toEqual(['i1']);
    expect(await getRepo().getMenu('Pi Pita')).toBeNull();
  });

  it('timed 86s left on a follower’s own (inactive) menu finish on its own stores only — never on the shared menu', async () => {
    await getRepo().saveMenu({ ...menu('Pi Pita'), unavailableByLocation: { NDG: ['i1'] }, unavailableUntil: { 'NDG|i1': 1 } });
    await getRepo().saveMenu({ ...menu('Po Poulet'), unavailableByLocation: { NDG: ['i1'] } });
    await saveMenuSharing({ 'Pi Pita': 'Po Poulet' });
    await store('Po Poulet', 'doordash', 'dd-poulet');
    await store('Pi Pita', 'doordash', 'dd-pita');
    const dd = vi.spyOn(doorDashAdapter, 'setItemAvailability').mockResolvedValue({ channel: 'doordash', ok: true, status: 'done', message: 'OK' });
    expect(await reenableExpiredItems(Date.now())).toBe(1);
    expect(dd.mock.calls.map((c) => [c[0].channelStoreId, c[2]])).toEqual([['dd-pita', true]]);
    expect((await getRepo().getMenu('Po Poulet'))!.unavailableByLocation?.NDG).toEqual(['i1']);
    expect((await getRepo().getMenu('Pi Pita'))!.unavailableUntil).toEqual({});
  });

  it('a read error on the sharing map fails closed (never treated as "no sharing")', async () => {
    await getRepo().saveMenu(menu('Po Poulet'));
    const repo = getRepo();
    vi.spyOn(repo, 'getKv').mockRejectedValueOnce(new Error('Supabase: timeout'));
    await expect(getBrandMenu('Pi Pita')).rejects.toThrow(/timeout/);
  });
});

describe('changing who shares a menu', () => {
  it('a brand that stops sharing gets its own menu with the live 86s (a copy when it had none)', async () => {
    const { applySharingChange } = await import('../lib/foodhub/menu/sharing-change');
    await getRepo().saveMenu({ ...menu('Po Poulet'), unavailableByLocation: { NDG: ['i1'] }, unavailableUntil: { 'NDG|i1': 9e12 } });
    await getRepo().saveMenu({ ...menu('OOeuf', 'Omelette'), unavailableByLocation: { NDG: ['x9'] } });
    const out = await applySharingChange({ 'Pi Pita': 'Po Poulet', OOeuf: 'Po Poulet' }, {});
    expect(out).toMatchObject({ copiedMenu: ['Pi Pita'], gotOwnMenu: ['OOeuf'] });
    const pita = (await getRepo().getMenu('Pi Pita'))!;
    expect(pita).toMatchObject({ brandName: 'Pi Pita', unavailableByLocation: { NDG: ['i1'] }, unavailableUntil: { 'NDG|i1': 9e12 } });
    expect(pita.items[0].name).toBe('Poutine');
    const oeuf = (await getRepo().getMenu('OOeuf'))!;
    expect(oeuf.items[0].name).toBe('Omelette');
    expect(oeuf.unavailableByLocation?.NDG?.sort()).toEqual(['i1', 'x9']);
  });

  it('a brand that starts sharing drops the Clover price flags of its own menu', async () => {
    const { applySharingChange } = await import('../lib/foodhub/menu/sharing-change');
    const { listCloverPriceChanges } = await import('../lib/foodhub/clover-sync');
    await getRepo().setKv('clover_price_changes', { 'Pi Pita|i1': { brandName: 'Pi Pita', ref: 'i1', name: 'Pita', foodhubPrice: 9, cloverPrice: 10, merchantId: 'M1', at: 'x' } });
    await saveMenuSharing({ 'Pi Pita': 'Po Poulet' });
    expect(await listCloverPriceChanges()).toEqual([]);
    await applySharingChange({}, { 'Pi Pita': 'Po Poulet' });
    expect(await getRepo().getKv('clover_price_changes')).toEqual({});
  });

  it('an "all brands" scheduled publish is listed and cancelled as one group', async () => {
    const { schedulePublish, cancelScheduled, listScheduled } = await import('../lib/foodhub/menu/schedule');
    const actor = { username: 't', name: 'Test', source: 'dashboard' as const };
    const at = new Date(Date.now() + 3600_000).toISOString();
    const a = await schedulePublish({ brand: 'Po Poulet', at, groupId: 'g1' }, actor);
    await schedulePublish({ brand: 'Pi Pita', at, groupId: 'g1' }, actor);
    await schedulePublish({ brand: 'OOeuf', at }, actor);
    expect(await cancelScheduled(a.id, actor)).toBe(true);
    expect((await listScheduled()).map((x) => [x.brand, x.status]).sort()).toEqual([['OOeuf', 'scheduled'], ['Pi Pita', 'cancelled'], ['Po Poulet', 'cancelled']]);
  });

  it('the menu snapshot report shows a follower brand’s stores with the shared menu', async () => {
    const { buildReport } = await import('../lib/foodhub/reports');
    await getRepo().saveMenu(menu('Po Poulet'));
    await saveMenuSharing({ 'Pi Pita': 'Po Poulet' });
    await store('Pi Pita', 'doordash', 'dd-pita');
    const r = await buildReport('menu_snapshot', { from: new Date(Date.now() - 86400_000).toISOString(), to: new Date().toISOString() } as never);
    expect(r.rows.map((x) => [x[0], x[6]])).toEqual([['Pi Pita', 'Poutine']]);
  });
});

describe('menu API with shared menus', () => {
  it('edits and Clover imports are refused on a follower; GET shows where its menu comes from', async () => {
    await getRepo().saveMenu(menu('Po Poulet'));
    const { PUT: share } = await import('../app/api/foodhub/menu/sharing/route');
    expect((await share(call('PUT', '/api/foodhub/menu/sharing', { sharing: { 'Pi Pita': 'OOeuf' } }), ctx)).status).toBe(409);
    expect((await share(call('PUT', '/api/foodhub/menu/sharing', { sharing: { 'Pi Pita': 'Po Poulet' } }), ctx)).status).toBe(200);
    const { GET, PUT } = await import('../app/api/foodhub/menu/route');
    const got = await (await GET(call('GET', '/api/foodhub/menu?brand=Pi%20Pita'), ctx)).json();
    expect(got).toMatchObject({ sharedFrom: 'Po Poulet', menu: { brandName: 'Pi Pita' } });
    const list = await (await GET(call('GET', '/api/foodhub/menu'), ctx)).json();
    expect(list.summary.find((s: { brandName: string }) => s.brandName === 'Pi Pita')).toMatchObject({ items: 1, sharedFrom: 'Po Poulet' });
    const put = await PUT(call('PUT', '/api/foodhub/menu', { menu: { ...menu('Pi Pita'), updatedAt: undefined } }), ctx);
    expect(put.status).toBe(409);
    const { POST: importMenu } = await import('../app/api/foodhub/menu/import/route');
    expect((await importMenu(call('POST', '/api/foodhub/menu/import', { brand: 'Pi Pita' }), ctx)).status).toBe(409);
  });
});
