import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST as saveMapping } from '../app/api/foodhub/stores/route';
import { POST as activate } from '../app/api/foodhub/uber-connect/activate/route';
import { uberEatsAdapter, type UberPosState } from '../lib/foodhub/adapters/uber-eats';
import * as provision from '../lib/foodhub/adapters/uber-provision';
import { getRepo } from '../lib/foodhub/repo';

const LOGIN = 'fixture-owner-uber-mapping-race';
const STORE = 'fixture-race-uber-store';
const BASE = { channel: 'uber_eats', channelStoreId: STORE, brandName: 'PPP Pizzeria', locationCode: 'NDG_6284', cloverMerchantId: 'TESTMERCH0002' };
const PEER = { ...BASE, locationCode: 'SAINT_LEONARD', cloverMerchantId: 'TESTMERCH0003' };

function request(path: string, body: Record<string, unknown>) {
  return new Request(`https://hub.example.test/api/foodhub/${path}`, {
    method: 'POST', headers: { authorization: `Basic ${Buffer.from(`owner:${LOGIN}`).toString('base64')}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function heldProvider(pos: UberPosState | null = null) {
  let markStarted!: () => void;
  let complete!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const reply = new Promise<void>((resolve) => { complete = resolve; });
  const provider = vi.spyOn(provision, 'activateUberStores').mockImplementation(async (_id, picks) => {
    markStarted();
    await reply;
    return picks.map(({ storeId }) => ({ storeId, result: { channel: 'uber_eats', status: 'done', ok: true, message: 'Accepted' }, enabled: null, pos, message: 'Accepted' }));
  });
  const response = activate(request('uber-connect/activate', { id: 'fixture-uber-session', stores: [{ ...BASE, storeId: STORE }] }), undefined);
  return { provider, started, complete, response };
}

beforeEach(() => {
  vi.stubEnv('DASHBOARD_PASSWORD', LOGIN);
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubGlobal('__foodhubMem', undefined);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected provider request')));
  vi.spyOn(uberEatsAdapter, 'readiness').mockReturnValue({ ...uberEatsAdapter.readiness(), canSend: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([true, false])('retains a concurrent manual mapping (initial mapping exists: %s)', async (existing) => {
  if (existing) expect((await saveMapping(request('stores', BASE), undefined)).status).toBe(200);
  const pending = heldProvider();
  await pending.started;
  try {
    expect((await saveMapping(request('stores', PEER), undefined)).status).toBe(200);
  } finally {
    pending.complete();
  }
  const response = await pending.response;
  expect(response.status).toBe(200);
  expect.soft(await response.json()).toMatchObject({ results: [{ storeId: STORE, ok: false, providerAccepted: true, mappingConflict: true }] });
  expect(await getRepo().findStore('uber_eats', STORE)).toMatchObject({ locationCode: PEER.locationCode, cloverMerchantId: PEER.cloverMerchantId });
  expect(pending.provider).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it('retains a first mapping inserted between activation’s final read and write', async () => {
  const repo = getRepo();
  const find = repo.findStore.bind(repo);
  let reads = 0;
  vi.spyOn(repo, 'findStore').mockImplementation(async (channel, storeId) => {
    const existing = await find(channel, storeId);
    if (channel === 'uber_eats' && storeId === STORE && ++reads === 2) {
      expect(existing).toBeNull();
      expect((await saveMapping(request('stores', PEER), undefined)).status).toBe(200);
    }
    return existing;
  });
  const pending = heldProvider();
  await pending.started;
  pending.complete();
  expect(await (await pending.response).json()).toMatchObject({ results: [{ storeId: STORE, ok: false, providerAccepted: true, mappingConflict: true }] });
  expect(await find('uber_eats', STORE)).toMatchObject({ locationCode: PEER.locationCode, cloverMerchantId: PEER.cloverMerchantId });
  expect(pending.provider).toHaveBeenCalledTimes(1);
});

it('requests a no-overwrite insert for the store identity from PostgREST', async () => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'false');
  vi.stubEnv('SUPABASE_URL', 'https://db.example.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key');
  vi.mocked(fetch).mockImplementationOnce(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe('https://db.example.test/rest/v1/fh_channel_stores');
    expect(init?.method).toBe('POST');
    expect(url.searchParams.get('on_conflict')).toBe('channel,channel_store_id');
    expect(new Headers(init?.headers).get('prefer')).toContain('resolution=ignore-duplicates');
    return Response.json([]);
  });
  expect(await getRepo().insertStoreIfAbsent({ ...BASE, channel: 'uber_eats', autoAccept: true, online: true, meta: {} })).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['foodhub', 'other'] as const)('reports newer saved readback while retaining webhook evidence (%s)', async (manager) => {
  expect((await saveMapping(request('stores', BASE), undefined)).status).toBe(200);
  const repo = getRepo();
  const before = (await repo.findStore('uber_eats', STORE))!;
  const pos = { storeId: STORE, orderManager: 'foodhub', integrationEnabled: true, orderManagerClientId: null, checkedAt: '2026-11-27T14:00:00Z' } as const;
  const latest = { ...pos, orderManager: manager, integrationEnabled: false, checkedAt: '2026-11-27T14:01:00Z' } as const;
  const pending = heldProvider(pos);
  await pending.started;
  try {
    await repo.updateStore(before.id, { meta: { ...before.meta, provisioned: true, uberPos: latest } });
  } finally {
    pending.complete();
  }
  const reported = {
    storeId: STORE, ok: true, orderManager: manager, integrationEnabled: false,
    message: expect.stringContaining(manager === 'foodhub' ? 'Order webhooks are off.' : 'another integration'),
  };
  expect.soft(await (await pending.response).json()).toMatchObject({ results: [reported] });
  expect.soft((await repo.listActivity({})).find((entry) => entry.action === 'uber_activate')).toMatchObject({
    status: manager === 'other' ? 'info' : 'success', detail: { results: [reported] },
  });
  expect(await repo.findStore('uber_eats', STORE)).toMatchObject({ meta: { provisioned: true, uberPos: latest } });
  expect(pending.provider).toHaveBeenCalledTimes(1);
});
