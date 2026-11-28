import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as saveMapping } from '../app/api/foodhub/stores/route';
import { POST } from '../app/api/foodhub/uber-connect/check/route';
import { pushPrepTimeToUber } from '../lib/foodhub/adapters/uber-api';
import { fetchUberPosData, fetchUberStoreStatus, forgetUberTokenMemory, uberAccessToken, uberEatsAdapter } from '../lib/foodhub/adapters/uber-eats';
import { recoverMissedUberOrders } from '../lib/foodhub/adapters/uber-events';
import { hashPassword } from '../lib/foodhub/auth';
import { saveBrand, saveLocation } from '../lib/foodhub/catalog';
import { getRepo } from '../lib/foodhub/repo';

const AUTH = 'https://auth.uber.example.test';
const API = 'https://api.uber.example.test';
const CLIENT = 'synthetic-uber-client';
const PASSWORD = 'synthetic-manager-password';
const READ_SCOPE = 'eats.store';
const ORDER_SCOPES = 'eats.order eats.store eats.store.status.write';
const STORE = 'synthetic-mapped-store';
const POS_PATH = `/v1/eats/stores/${STORE}/pos_data`;
const fetchMock = vi.fn<typeof fetch>();
let tokenScopes: string[];
let posRequests: Array<{ path: string; method: string; bearer: string | null }>;
let allowOrderToken: boolean;
let allowStoreToken: boolean;
let refusedReads: number;
let integrationEnabled: boolean;
let duringPosRead: (() => Promise<void>) | undefined;

function request(path: string, body: Record<string, unknown>, username: string | null = 'test-manager') {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (username) headers.set('authorization', `Basic ${Buffer.from(`${username}:${PASSWORD}`).toString('base64')}`);
  return new Request(`http://hub.example.test/api/foodhub/${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
}

function check(body: Record<string, unknown> = {}, username?: string | null) {
  return POST(request('uber-connect/check', body, username), {});
}

async function mapStore(channelStoreId: string, locationCode: string) {
  return getRepo().upsertStore({ channel: 'uber_eats', channelStoreId, locationCode, brandName: 'Test brand', online: true, autoAccept: false, meta: {} });
}

beforeEach(async () => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('UBER_BASE_URL', API);
  vi.stubEnv('UBER_AUTH_URL', `${AUTH}/oauth/v2/token`);
  vi.stubEnv('UBER_CLIENT_ID', CLIENT);
  vi.stubEnv('UBER_CLIENT_SECRET', 'synthetic-secret');
  vi.stubEnv('UBER_OAUTH_SCOPE', undefined);
  vi.stubEnv('UBER_ACCESS_TOKEN', undefined);
  vi.stubEnv('LIVE_CONNECTORS_GLOBAL_ENABLED', 'false');
  vi.stubGlobal('__foodhubMem', undefined);
  forgetUberTokenMemory();
  tokenScopes = [];
  posRequests = [];
  allowOrderToken = false;
  allowStoreToken = true;
  integrationEnabled = false;
  duringPosRead = undefined;
  refusedReads = 0;
  fetchMock.mockReset().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.origin === AUTH && url.pathname === '/oauth/v2/token' && method === 'POST') {
      const body = new URLSearchParams(String(init?.body));
      if (body.get('grant_type') !== 'client_credentials') throw new Error('Unexpected OAuth grant');
      const scope = body.get('scope') ?? '';
      tokenScopes.push(scope);
      if (scope === READ_SCOPE && allowStoreToken) return Response.json({ access_token: `store-token-${tokenScopes.length}` });
      if (scope === ORDER_SCOPES && allowOrderToken) return Response.json({ access_token: 'order-token' });
      return Response.json({ error: 'invalid_scope', error_description: 'Synthetic provider detail' }, { status: 400 });
    }
    if (url.origin === API && url.pathname === POS_PATH) {
      posRequests.push({ path: url.pathname, method, bearer: new Headers(init?.headers).get('authorization') });
      if (method === 'GET') {
        await duringPosRead?.();
        if (refusedReads > 0) {
          refusedReads--;
          return new Response(null, { status: 401 });
        }
        return Response.json({ order_manager_client_id: CLIENT, integration_enabled: integrationEnabled });
      }
      if (method === 'PATCH') {
        integrationEnabled = JSON.parse(String(init?.body)).integration_enabled;
        return new Response(null, { status: 204 });
      }
    }
    throw new Error('Unexpected provider request');
  });
  vi.stubGlobal('fetch', fetchMock);
  const passwordHash = hashPassword(PASSWORD);
  await getRepo().saveUser({ username: 'test-manager', name: 'Test manager', active: true, role: 'manager', locations: ['ORIGINAL'], passwordHash });
  await saveLocation({ code: 'ORIGINAL', name: 'Test location', address: '', active: true });
  await saveBrand({ name: 'Test brand', active: true });
  await mapStore(STORE, 'ORIGINAL');
});

afterEach(() => {
  forgetUberTokenMemory();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('manual Uber store inspection', () => {
  it('clears the former Uber identity evidence on a remap and retains the row protections', async () => {
    const repo = getRepo();
    const mapped = (await repo.findStore('uber_eats', STORE))!;
    const protectedMeta = { menuLocked: true, doNotTouch: true, localNote: 'Synthetic note' };
    const uberMeta = {
      uberPos: { storeId: STORE, orderManager: 'foodhub', integrationEnabled: true },
      provisioned: true, awaitingProvision: false, provisionedAt: '2026-11-25T13:00:00Z',
      provisionChangedAt: '2026-11-25T13:00:00Z', menuRefreshRequested: '2026-11-25T13:00:00Z',
      uberDisconnectedAt: '2026-11-24T13:00:00Z',
    };
    await repo.updateStore(mapped.id, { meta: { ...protectedMeta, ...uberMeta } });
    const fields = { id: mapped.id, channel: mapped.channel, brandName: mapped.brandName, locationCode: mapped.locationCode };
    expect((await saveMapping(request('stores', { ...fields, channelStoreId: STORE }), {})).status).toBe(200);
    expect((await repo.getStore(mapped.id))?.meta).toEqual({ ...protectedMeta, ...uberMeta });

    const replacement = 'synthetic-replacement-store';
    expect((await saveMapping(request('stores', { ...fields, channelStoreId: replacement }), {})).status).toBe(200);
    expect(await repo.getStore(mapped.id)).toMatchObject({ channelStoreId: replacement });
    expect((await repo.getStore(mapped.id))?.meta).toEqual(protectedMeta);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('discards the delayed read when the original mapping is replaced', async () => {
    const repo = getRepo();
    const mapped = (await repo.findStore('uber_eats', STORE))!;
    const replacement = 'synthetic-replacement-store';
    duringPosRead = async () => {
      await repo.updateStore(mapped.id, { channelStoreId: replacement, meta: { menuLocked: true } });
    };

    const row = (await (await check()).json()).rows[0];

    expect(row).toMatchObject({ storeId: mapped.id, ok: false, orderManager: null, integrationEnabled: null });
    expect(await repo.getStore(mapped.id)).toMatchObject({ channelStoreId: replacement, meta: { menuLocked: true } });
    expect((await repo.getStore(mapped.id))?.meta.uberPos).toBeUndefined();
    expect(posRequests.map(({ method }) => method)).toEqual(['GET']);
  });

  it('retains a concurrent protection change on the same mapping', async () => {
    const repo = getRepo();
    const mapped = (await repo.findStore('uber_eats', STORE))!;
    duringPosRead = async () => {
      await repo.updateStore(mapped.id, { meta: { menuLocked: true } });
    };

    expect((await (await check()).json()).rows[0]).toMatchObject({ ok: true, orderManager: 'foodhub' });
    expect((await repo.getStore(mapped.id))?.meta).toMatchObject({ menuLocked: true, uberPos: { storeId: STORE, orderManager: 'foodhub' } });
  });

  it('merges the current protection when a write races with another mapping edit', async () => {
    const repo = getRepo();
    const mapped = (await repo.findStore('uber_eats', STORE))!;
    const update = repo.updateStore.bind(repo);
    const race = vi.spyOn(repo, 'updateStore').mockImplementationOnce(async (id, patch, expected) => {
      await update(id, { meta: { doNotTouch: true } });
      return update(id, patch, expected);
    });
    try {
      expect((await (await check()).json()).rows[0]).toMatchObject({ ok: true, orderManager: 'foodhub' });
      expect(race).toHaveBeenCalledTimes(2);
      expect((await repo.getStore(mapped.id))?.meta).toMatchObject({ doNotTouch: true, uberPos: { storeId: STORE } });
    } finally {
      race.mockRestore();
    }
  });

  it('leaves a concurrent disconnect untouched and does not enable webhooks', async () => {
    vi.stubEnv('LIVE_CONNECTORS_GLOBAL_ENABLED', 'true');
    allowOrderToken = true;
    const repo = getRepo();
    const mapped = (await repo.findStore('uber_eats', STORE))!;
    const meta = { provisioned: false, uberDisconnectedAt: '2026-11-26T14:00:00Z' };
    duringPosRead = async () => { await repo.updateStore(mapped.id, { meta }); };

    expect((await (await check({ enable: true })).json()).rows[0]).toMatchObject({ ok: false, orderManager: null });
    expect((await repo.getStore(mapped.id))?.meta).toEqual(meta);
    expect(posRequests.map(({ method }) => method)).toEqual(['GET']);
  });

  it('does not use an explicit older Uber identity for prep time or missing-order recovery', async () => {
    vi.stubEnv('LIVE_CONNECTORS_GLOBAL_ENABLED', 'true');
    expect(uberEatsAdapter.readiness().canSend).toBe(true);
    const repo = getRepo();
    const mapped = (await repo.findStore('uber_eats', STORE))!;
    await repo.updateStore(mapped.id, { meta: { uberPos: { storeId: 'synthetic-former-store', orderManager: 'foodhub' } } });

    expect(await pushPrepTimeToUber(mapped.locationCode, 20)).toEqual([]);
    expect(await recoverMissedUberOrders()).toEqual({ recovered: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses just eats.store, only for the authorized direct mapping, with the live switch off', async () => {
    vi.stubEnv('UBER_OAUTH_SCOPE', ORDER_SCOPES);
    const other = await mapStore('synthetic-other-store', 'OTHER');
    const relay = await mapStore('relay:synthetic-relay-store', 'ORIGINAL');
    const mapped = await getRepo().findStore('uber_eats', STORE);
    expect((await check({}, null)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();

    const response = await check({ storeIds: [mapped!.id, other.id, relay.id] });
    expect(response.status).toBe(200);
    expect((await response.json()).rows).toEqual([
      expect.objectContaining({
        storeId: mapped!.id, ok: true, orderManager: 'foodhub', integrationEnabled: false,
        message: expect.stringContaining('Order webhooks are off.'),
      }),
    ]);
    expect((await getRepo().listActivity({})).find((entry) => entry.action === 'uber_check')?.summary)
      .toContain('0 report Food Hub as order manager with order webhooks enabled');
    expect(tokenScopes).toEqual([READ_SCOPE]);
    expect(posRequests).toEqual([{ path: POS_PATH, method: 'GET', bearer: 'Bearer store-token-1' }]);
    expect((await getRepo().getStore(mapped!.id))?.meta.uberPos).toMatchObject({ orderManager: 'foodhub', integrationEnabled: false });
  });

  it('shares and persists the inspection token, then honors explicit removal of the exact scope', async () => {
    const concurrent = await Promise.all([check(), check()]);
    for (const res of concurrent) expect((await res.json()).rows[0].ok).toBe(true);
    forgetUberTokenMemory();
    expect((await (await check()).json()).rows[0].ok).toBe(true);
    expect(tokenScopes).toEqual([READ_SCOPE]);
    expect(posRequests).toHaveLength(3);

    vi.stubEnv('UBER_OAUTH_SCOPE', 'eats.store.status.write eats.store.orders.read');
    expect((await (await check()).json()).rows[0]).toMatchObject({ ok: false, message: expect.stringContaining('UBER_OAUTH_SCOPE') });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([1, 2])('renews just the inspection token once when %i GETs return 401', async (denials) => {
    allowOrderToken = true;
    refusedReads = denials;
    expect(await uberAccessToken()).toBe('order-token');
    const checked = (await (await check()).json()).rows[0];
    expect(checked.ok).toBe(denials === 1);
    if (denials === 2) expect(checked.message).toBe('Uber pos_data HTTP 401');
    expect(await uberAccessToken()).toBe('order-token');
    expect(tokenScopes).toEqual([ORDER_SCOPES, READ_SCOPE, READ_SCOPE]);
    expect(posRequests.map((req) => req.bearer)).toEqual(['Bearer store-token-2', 'Bearer store-token-3']);
  });

  it('uses the configured static token and does not refresh it after 401', async () => {
    vi.stubEnv('UBER_ACCESS_TOKEN', 'synthetic-static-token');
    vi.stubEnv('UBER_OAUTH_SCOPE', 'eats.order');
    refusedReads = 1;
    expect((await (await check()).json()).rows[0]).toMatchObject({ ok: false, message: 'Uber pos_data HTTP 401' });
    expect(tokenScopes).toEqual([]);
    expect(posRequests).toEqual([{ path: POS_PATH, method: 'GET', bearer: 'Bearer synthetic-static-token' }]);
  });

  it('reports a provider scope refusal without requesting broader permissions or showing provider detail', async () => {
    allowStoreToken = false;
    const row = (await (await check()).json()).rows[0];
    expect(row).toMatchObject({ ok: false, message: expect.stringMatching(/invalid_scope.*eats\.store/) });
    expect(row.message).not.toContain('Synthetic provider detail');
    expect(tokenScopes).toEqual([READ_SCOPE]);
    expect(posRequests).toEqual([]);
  });

  it('keeps background status and activation reads on the existing token path', async () => {
    vi.stubEnv('UBER_OAUTH_SCOPE', ORDER_SCOPES);
    expect((await (await check()).json()).rows[0].ok).toBe(true);
    expect(await fetchUberStoreStatus(STORE)).toMatchObject({ ok: false, state: 'unknown', error: expect.stringContaining('invalid_scope') });
    expect(await fetchUberPosData(STORE)).toMatchObject({ ok: false, error: expect.stringContaining('invalid_scope') });
    expect(tokenScopes).toEqual([READ_SCOPE, ORDER_SCOPES, ORDER_SCOPES]);
    expect(posRequests).toHaveLength(1);
  });

  it('keeps enable:true behind the live switch and on the existing order token path', async () => {
    expect((await check({ enable: true })).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv('LIVE_CONNECTORS_GLOBAL_ENABLED', 'true');
    allowOrderToken = true;
    expect((await (await check({ enable: true })).json()).rows[0]).toMatchObject({ ok: true, integrationEnabled: true });
    expect(tokenScopes).toEqual([ORDER_SCOPES]);
    expect(posRequests.map(({ method, bearer }) => [method, bearer])).toEqual([
      ['GET', 'Bearer order-token'], ['PATCH', 'Bearer order-token'], ['GET', 'Bearer order-token'],
    ]);
  });

  it('sends the mapping snapshot filters with the conditional database update', async () => {
    vi.stubEnv('FOODHUB_FORCE_MEMORY', 'false');
    vi.stubEnv('SUPABASE_URL', 'https://db.example.test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key');
    const expected = {
      channel: 'uber_eats' as const, channelStoreId: STORE, locationCode: 'ORIGINAL',
      updatedAt: '2026-11-26T14:00:00Z', meta: { doNotTouch: true, localNote: 'A, B (synthetic) ' },
    };
    fetchMock.mockImplementationOnce(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe('https://db.example.test/rest/v1/fh_channel_stores');
      expect(init?.method).toBe('PATCH');
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        id: 'eq.synthetic-row', channel: 'eq.uber_eats', channel_store_id: `eq.${STORE}`,
        location_code: 'eq.ORIGINAL', updated_at: `eq.${expected.updatedAt}`, meta: `eq.${JSON.stringify(expected.meta)}`,
      });
      return Response.json([]);
    });

    expect(await getRepo().updateStore('synthetic-row', { meta: { ...expected.meta, uberPos: { storeId: STORE } } }, expected)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
