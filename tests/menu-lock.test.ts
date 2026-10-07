// "Do not touch this store's menu": Po Poulet NDG on DoorDash (store 27982486) and any store a manager locks never
// receive a publish, an 86 or a back-in-stock from Food Hub — whoever or whatever asks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdapter } from '../lib/foodhub/adapters';
import { doorDashAdapter } from '../lib/foodhub/adapters/doordash';
import { uberEatsAdapter } from '../lib/foodhub/adapters/uber-eats';
import { isMenuLocked, menuLockOf } from '../lib/foodhub/menu/lock';
import { publishMenu, setItemAvailability } from '../lib/foodhub/ops';
import { getRepo } from '../lib/foodhub/repo';
import type { MasterMenu } from '../lib/foodhub/types';

const basic = `Basic ${Buffer.from('owner:Owner-pass-123').toString('base64')}`;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = { authorization: basic }) => new Request(`http://hub.local${path}`, {
  method, headers: { ...headers, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});
const ctx = {} as never;

const menu: MasterMenu = {
  brandName: 'Po Poulet',
  categories: [{ ref: 'c1', name: 'Poulet', sortOrder: 0 }],
  items: [{ ref: 'i1', name: 'Poulet grillé', price: 14.99, categoryRef: 'c1', available: true, modifierGroupRefs: [] }],
  modifierGroups: [],
  updatedAt: new Date().toISOString(),
};

const ok = { ok: true, status: 'done' as const, message: 'OK' };

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
  delete process.env.FOODHUB_MENU_LOCKED_STORES;
  (globalThis as any).__foodhubMem = undefined;
  vi.restoreAllMocks();
  await getRepo().saveMenu(menu);
});
afterEach(() => { delete process.env.FOODHUB_MENU_LOCKED_STORES; });

describe('which stores are locked', () => {
  it('Po Poulet NDG on DoorDash (27982486) is locked for good, by its mapping id or its DoorDash store number', () => {
    expect(menuLockOf({ channel: 'doordash', channelStoreId: '27982486', meta: {} })).toMatchObject({ locked: true, source: 'built_in' });
    expect(menuLockOf({ channel: 'doordash', channelStoreId: 'NDG_6284-POPOULET', meta: { platformStoreId: '27982486' } })).toMatchObject({ locked: true, source: 'built_in' });
    // Same number on another platform is a different store.
    expect(isMenuLocked({ channel: 'uber_eats', channelStoreId: '27982486', meta: {} })).toBe(false);
    expect(isMenuLocked({ channel: 'doordash', channelStoreId: 'dd-other', meta: {} })).toBe(false);
  });

  it('the hosting setup and the Stores screen can lock more stores', () => {
    process.env.FOODHUB_MENU_LOCKED_STORES = 'uber_eats:ue-123, 555';
    expect(menuLockOf({ channel: 'uber_eats', channelStoreId: 'ue-123', meta: {} })).toMatchObject({ locked: true, source: 'env' });
    expect(isMenuLocked({ channel: 'doordash', channelStoreId: 'x', meta: { platformStoreId: '555' } })).toBe(true);
    expect(isMenuLocked({ channel: 'doordash', channelStoreId: 'ue-123', meta: {} })).toBe(false);
    expect(menuLockOf({ channel: 'skip', channelStoreId: 'NDG', meta: { menuLocked: true, menuLockedReason: 'Menu managed on the tablet' } })).toEqual({ locked: true, source: 'store', reason: 'Menu managed on the tablet', reasonFr: 'Menu managed on the tablet' });
  });
});

describe('a locked store never receives a menu change', () => {
  async function stores() {
    const repo = getRepo();
    const locked = await repo.upsertStore({ channel: 'doordash', channelStoreId: 'NDG_6284-POPOULET', brandName: 'Po Poulet', locationCode: 'NDG_6284', autoAccept: true, online: true, meta: { platformStoreId: '27982486' } });
    const open = await repo.upsertStore({ channel: 'uber_eats', channelStoreId: 'ue-popoulet', brandName: 'Po Poulet', locationCode: 'NDG_6284', autoAccept: true, online: true, meta: {} });
    return { locked, open };
  }

  it('publish: the other stores get the menu; the locked one is reported "not sent", never "done"', async () => {
    const { locked } = await stores();
    const dd = vi.spyOn(doorDashAdapter, 'publishMenu').mockResolvedValue({ channel: 'doordash', ...ok });
    const ue = vi.spyOn(uberEatsAdapter, 'publishMenu').mockResolvedValue({ channel: 'uber_eats', ...ok });
    const rows = await publishMenu('Po Poulet');
    expect(dd).not.toHaveBeenCalled();
    expect(ue).toHaveBeenCalledTimes(1);
    const row = rows.find((r) => r.storeId === locked.id)!;
    expect(row.result.status).toBe('skipped');
    expect(row.result.message).toMatch(/locked/);
    const job = (await getRepo().listJobs(10)).find((j) => j.request.storeId === locked.id);
    expect(job?.request.locked).toBe(true);
    // The publish baseline is only saved for stores that really received the menu.
    expect((await getRepo().getStore(locked.id))!.meta.lastPublished).toBeUndefined();
  });

  it('86 and back in stock — from staff, Clover or a timer — skip the locked store', async () => {
    const { locked } = await stores();
    const dd = vi.spyOn(doorDashAdapter, 'setItemAvailability').mockResolvedValue({ channel: 'doordash', ...ok });
    const ue = vi.spyOn(uberEatsAdapter, 'setItemAvailability').mockResolvedValue({ channel: 'uber_eats', ...ok });
    const off = await setItemAvailability('Po Poulet', ['i1'], false, { locationCode: 'NDG_6284', actor: { username: 'clover', name: 'Clover', source: 'automation' } });
    const on = await setItemAvailability('Po Poulet', ['i1'], true, { locationCode: 'NDG_6284' });
    expect(dd).not.toHaveBeenCalled();
    expect(ue).toHaveBeenCalledTimes(2);
    expect([off, on].map((rows) => rows.find((r) => r.storeId === locked.id)?.result.status)).toEqual(['skipped', 'skipped']);
  });

  it('the adapter itself refuses, whatever code path asks', async () => {
    const { locked } = await stores();
    const dd = vi.spyOn(doorDashAdapter, 'publishMenu').mockResolvedValue({ channel: 'doordash', ...ok });
    const res = await getAdapter('doordash').publishMenu(locked, menu);
    const res86 = await getAdapter('doordash').setItemAvailability(locked, ['i1'], false);
    expect(dd).not.toHaveBeenCalled();
    expect([res.status, res86.status]).toEqual(['skipped', 'skipped']);
  });

  it('DoorDash Menu Request (menu pull) for a locked store is refused: DoorDash keeps its own menu', async () => {
    process.env.DOORDASH_WEBHOOK_SECRET = 'dd-hook';
    await stores();
    const { GET } = await import('../app/api/foodhub/webhooks/doordash/[locationId]/route');
    const res = await GET(call('GET', '/api/foodhub/webhooks/doordash/NDG_6284-POPOULET', undefined, { authorization: 'dd-hook' }) as never, { params: Promise.resolve({ locationId: 'NDG_6284-POPOULET' }) });
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).not.toMatch(/Poulet grillé/);
  });

  it('Stores: a manager locks and unlocks a store; the owner’s standing lock cannot be lifted', async () => {
    const { locked, open } = await stores();
    const { GET, POST } = await import('../app/api/foodhub/stores/route');
    const lockIt = await POST(call('POST', '/api/foodhub/stores', { id: open.id, channel: 'uber_eats', channelStoreId: 'ue-popoulet', brandName: 'Po Poulet', locationCode: 'NDG_6284', menuLocked: true, menuLockedReason: 'Promo menu managed by Uber' }), ctx);
    expect(lockIt.status).toBe(200);
    expect((await lockIt.json()).store.menuLock).toEqual({ locked: true, source: 'store', reason: 'Promo menu managed by Uber', reasonFr: 'Promo menu managed by Uber' });
    const unlock = await POST(call('POST', '/api/foodhub/stores', { id: open.id, channel: 'uber_eats', channelStoreId: 'ue-popoulet', brandName: 'Po Poulet', locationCode: 'NDG_6284', menuLocked: false }), ctx);
    expect((await unlock.json()).store.menuLock.locked).toBe(false);
    const refuse = await POST(call('POST', '/api/foodhub/stores', { id: locked.id, channel: 'doordash', channelStoreId: 'NDG_6284-POPOULET', brandName: 'Po Poulet', locationCode: 'NDG_6284', menuLocked: false }), ctx);
    expect(refuse.status).toBe(409);
    const list = await (await GET(call('GET', '/api/foodhub/stores'), ctx)).json();
    expect(list.stores.find((s: { id: string }) => s.id === locked.id).menuLock).toMatchObject({ locked: true, source: 'built_in' });
  });
});
