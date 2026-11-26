import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as channels } from '../app/api/foodhub/channels/route';
import { hashPassword, OWNER } from '../lib/foodhub/auth';
import { goLiveFacts } from '../lib/foodhub/go-live';
import { getRepo } from '../lib/foodhub/repo';
import type { ChannelStore } from '../lib/foodhub/types';

const PASSWORD = 'go-live-uber-test-password';
const CHECKED_AT = '2026-11-26T10:00:00.000Z';
const EARLIER = '2026-11-26T09:00:00.000Z';
const LATER = '2026-11-26T11:00:00.000Z';
const CONFIRMED = { orderManager: 'foodhub', integrationEnabled: true, checkedAt: CHECKED_AT, orderManagerClientId: 'synthetic-app' };
const fetchMock = vi.fn<typeof fetch>();

const store = (channelStoreId: string, meta: ChannelStore['meta'] = {}, locationCode = 'NDG', channel: ChannelStore['channel'] = 'uber_eats') => getRepo().upsertStore({
  channelStoreId, meta, locationCode, channel, brandName: 'Test brand', cloverMerchantId: 'TESTMERCH0001', autoAccept: true, online: true,
});

const request = (username?: string) => channels(new Request('http://hub.local/api/foodhub/channels', {
  headers: username ? { authorization: `Basic ${Buffer.from(`${username}:${PASSWORD}`).toString('base64')}` } : undefined,
}), undefined);

beforeEach(() => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('DASHBOARD_PASSWORD', PASSWORD);
  vi.stubEnv('SESSION_SECRET', undefined);
  vi.stubEnv('FOODHUB_VIA_CLOVER', undefined);
  vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
  (globalThis as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Go-live saved Uber activation', () => {
  it('counts direct Uber mappings and only checked, enabled Food Hub confirmations in one store read', async () => {
    const repo = getRepo();
    expect((await goLiveFacts(OWNER)).uberDirect).toEqual({ confirmed: 0, mapped: 0 });
    const rows: ChannelStore['meta'][] = [
      { uberPos: CONFIRMED },
      { uberPos: { ...CONFIRMED, checkedAt: '2025-10-18T02:00:00.000Z' } },
      { uberPos: { ...CONFIRMED, orderManager: 'other' } },
      { uberPos: { ...CONFIRMED, orderManager: 'pending' } },
      { uberPos: { ...CONFIRMED, integrationEnabled: false } },
      { uberPos: { ...CONFIRMED, integrationEnabled: null } },
      { uberPos: { ...CONFIRMED, integrationEnabled: 'true' } },
      { uberPos: { ...CONFIRMED, checkedAt: undefined } },
      { uberPos: { ...CONFIRMED, checkedAt: 'invalid-time' } },
      { uberPos: { ...CONFIRMED, checkedAt: '0' } },
      {},
    ];
    for (const [i, meta] of rows.entries()) await store(`direct-${i}`, meta);
    await store('relay:synthetic-partner', { uberPos: CONFIRMED });
    await store('other-platform-store', { uberPos: CONFIRMED }, 'NDG', 'doordash');

    const listStores = vi.spyOn(repo, 'listStores');
    const updateStore = vi.spyOn(repo, 'updateStore');
    const setKv = vi.spyOn(repo, 'setKv');
    expect((await goLiveFacts(OWNER)).uberDirect).toEqual({ confirmed: 2, mapped: rows.length });
    expect(listStores).toHaveBeenCalledTimes(1);
    expect(updateStore).not.toHaveBeenCalled();
    expect(setKv).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores evidence superseded by a disconnect, and keeps fresh proof from a successful provision event', async () => {
    await store('disconnected-by-owner', { uberPos: CONFIRMED, uberDisconnectedAt: LATER, provisioned: false });
    await store('deprovisioned-by-webhook', { uberPos: CONFIRMED, provisionChangedAt: LATER, provisioned: false });
    await store('disabled-legacy', { uberPos: CONFIRMED, provisioned: false });
    await store('positive-provision', { uberPos: CONFIRMED, provisioned: true, provisionChangedAt: LATER });
    await store('checked-after-disconnect', { uberPos: CONFIRMED, uberDisconnectedAt: EARLIER, provisioned: false });
    expect((await goLiveFacts(OWNER)).uberDirect).toEqual({ confirmed: 2, mapped: 5 });
  });

  it('keeps Clover-disabled behavior and distinguishes via-Clover mode from unavailable data', async () => {
    const emptyClover = { injectionEnabled: false, unreachableStores: [], defaultRoutedStores: [] };
    vi.stubEnv('FOODHUB_POS_INJECTION', 'off');
    await store('direct-confirmed', { uberPos: CONFIRMED });
    expect(await goLiveFacts(OWNER)).toMatchObject({ clover: emptyClover, uberDirect: { confirmed: 1, mapped: 1 } });

    const listStores = vi.spyOn(getRepo(), 'listStores').mockRejectedValue(new Error('repository unavailable'));
    expect(await goLiveFacts(OWNER)).toMatchObject({ clover: emptyClover, uberDirect: null });
    expect(listStores).toHaveBeenCalledTimes(1);

    listStores.mockClear();
    vi.stubEnv('FOODHUB_VIA_CLOVER', 'uber_eats');
    expect(await goLiveFacts(OWNER)).toMatchObject({ clover: emptyClover, uberDirect: null });
    expect(listStores).not.toHaveBeenCalled();
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    expect(await goLiveFacts(OWNER)).toMatchObject({ clover: { ...emptyClover, injectionEnabled: true }, uberDirect: null });
  });

  it('returns permission-scoped counts from channels without store or provider identifiers', async () => {
    await store('ndg-confirmed', { uberPos: CONFIRMED });
    await store('ndg-unverified');
    await store('private-kitchen-confirmed', { uberPos: CONFIRMED }, 'OTHER');
    const passwordHash = hashPassword(PASSWORD);
    await getRepo().saveUser({ username: 'ndg-manager', name: 'Test manager', role: 'manager', locations: ['NDG'], active: true, passwordHash });
    await getRepo().saveUser({ username: 'ndg-operator', name: 'Test operator', role: 'operator', locations: ['NDG'], active: true, passwordHash });
    expect((await request()).status).toBe(401);
    expect((await request('ndg-operator')).status).toBe(403);
    const owner = await request('owner');
    expect(owner.status).toBe(200);
    expect((await owner.json()).goLive.uberDirect).toEqual({ confirmed: 2, mapped: 3 });
    const manager = await request('ndg-manager');
    expect(manager.status).toBe(200);
    expect((await manager.json()).goLive.uberDirect).toEqual({ confirmed: 1, mapped: 2 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
