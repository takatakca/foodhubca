import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/foodhub/uber-connect/check/route';
import { fetchUberPosData, fetchUberStoreStatus, forgetUberTokenMemory, uberAccessToken } from '../lib/foodhub/adapters/uber-eats';
import { hashPassword } from '../lib/foodhub/auth';
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

function check(body: Record<string, unknown> = {}, username: string | null = 'test-manager') {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (username) headers.set('authorization', `Basic ${Buffer.from(`${username}:${PASSWORD}`).toString('base64')}`);
  return POST(new Request('http://hub.example.test/api/foodhub/uber-connect/check', {
    method: 'POST', headers, body: JSON.stringify(body),
  }), {});
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
  await mapStore(STORE, 'ORIGINAL');
});

afterEach(() => {
  forgetUberTokenMemory();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('manual Uber store inspection', () => {
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
      expect.objectContaining({ storeId: mapped!.id, ok: true, orderManager: 'foodhub', integrationEnabled: false }),
    ]);
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
});
