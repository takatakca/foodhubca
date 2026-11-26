import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetUberTokenMemory } from '../lib/foodhub/adapters/uber-eats';
import { getRepo } from '../lib/foodhub/repo';
import { lastSyncReport, runSync } from '../lib/foodhub/sync';
import type { ChannelStore, PlatformStatus } from '../lib/foodhub/types';

const UBER_AUTH = 'https://uber-auth.example.test';
const UBER_API = 'https://uber-api.example.test';
const DOORDASH_API = 'https://doordash-api.example.test';
const EXPLICIT_SCOPE = 'eats.order eats.store';
const DEFAULT_SCOPE = 'eats.order eats.store eats.store.status.write';
const DIRECT_STORES = 8;
const BEFORE_CHECK = '2025-01-01T12:00:00.000Z';
const DOORDASH_STORE = 'test-doordash-store';
const RELAY_STORE = 'relay:test-uber-screen';

let tokenScopes: string[];
let uberReads: string[];
let doordashReads: string[];
let unexpected: string[];
let oauthError: (scope: string) => string | null;
let uberReadStatus: number;
let storesBefore: ChannelStore[];

beforeEach(async () => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('FOODHUB_RETRY_TIMER', 'off');
  vi.stubEnv('FOODHUB_MEV', 'off');
  vi.stubEnv('LIVE_CONNECTORS_GLOBAL_ENABLED', 'false');
  vi.stubEnv('CLOVER_MERCHANT_ID', undefined);
  vi.stubEnv('CLOVER_MERCHANT_TOKENS', undefined);
  vi.stubEnv('CLOVER_CLIENT_ID', undefined);
  vi.stubEnv('UBER_AUTH_URL', `${UBER_AUTH}/oauth/v2/token`);
  vi.stubEnv('UBER_BASE_URL', UBER_API);
  vi.stubEnv('UBER_CLIENT_ID', 'test-uber-app');
  vi.stubEnv('UBER_CLIENT_SECRET', 'test-uber-secret');
  vi.stubEnv('UBER_ACCESS_TOKEN', undefined);
  vi.stubEnv('UBER_OAUTH_SCOPE', EXPLICIT_SCOPE);
  vi.stubEnv('DOORDASH_BASE_URL', DOORDASH_API);
  vi.stubEnv('DOORDASH_ENV', 'production');
  vi.stubEnv('DOORDASH_PROVIDER_TYPE', 'test_marketplace');
  vi.stubEnv('DOORDASH_DEVELOPER_ID', 'test-doordash-app');
  vi.stubEnv('DOORDASH_KEY_ID', 'test-doordash-key');
  vi.stubEnv('DOORDASH_SIGNING_SECRET', Buffer.from('test-doordash-secret').toString('base64'));
  vi.stubGlobal('__foodhubMem', undefined);
  forgetUberTokenMemory();

  tokenScopes = [];
  uberReads = [];
  doordashReads = [];
  unexpected = [];
  oauthError = () => 'invalid_scope';
  uberReadStatus = 200;
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const { origin, pathname } = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (origin === UBER_AUTH && pathname === '/oauth/v2/token' && method === 'POST') {
      const params = new URLSearchParams(String(init?.body));
      const scope = params.get('scope') ?? '';
      tokenScopes.push(scope);
      const error = oauthError(scope);
      if (error) return Response.json({ error, error_description: 'Synthetic OAuth refusal' }, { status: 400 });
      return Response.json({ access_token: 'test-uber-token' });
    }
    const store = /^\/v1\/eats\/store\/(test-uber-store-\d+)\/status$/.exec(pathname);
    if (origin === UBER_API && method === 'GET' && store) {
      uberReads.push(store[1]);
      if (uberReadStatus !== 200) return Response.json({ error: 'invalid_scope' }, { status: uberReadStatus });
      return Response.json({ status: 'ONLINE' });
    }
    if (origin === DOORDASH_API && pathname === `/api/v1/stores/${DOORDASH_STORE}/store_details` && method === 'GET') {
      doordashReads.push(DOORDASH_STORE);
      return Response.json({ is_active: true });
    }
    unexpected.push(`${method} ${origin}${pathname}`);
    throw new Error('Unexpected provider request');
  }));

  const repo = getRepo();
  await repo.setKv('watch:settings', { enabled: false });
  const future = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const store = { locationCode: 'TEST_KITCHEN', autoAccept: false };
  storesBefore = await Promise.all(Array.from({ length: DIRECT_STORES }, (_, index) => {
    const pausedUntil = index % 2 === 0 ? future : null;
    const platformStatus: PlatformStatus = {
      state: pausedUntil ? 'paused' : 'online', detail: `Saved provider status ${index}`, until: pausedUntil, checkedAt: BEFORE_CHECK, source: 'webhook',
    };
    return repo.upsertStore({ ...store, channel: 'uber_eats', channelStoreId: `test-uber-store-${index}`, brandName: `Test Uber ${index}`, online: !pausedUntil, pausedUntil, meta: { platformStatus } });
  }));
  await repo.upsertStore({ ...store, channel: 'uber_eats', channelStoreId: RELAY_STORE, brandName: 'Test relay', online: false, meta: {} });
  await repo.upsertStore({ ...store, channel: 'doordash', channelStoreId: DOORDASH_STORE, brandName: 'Test DoorDash', online: true, meta: {} });
});

afterEach(() => {
  forgetUberTokenMemory();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Uber OAuth scope refusal in status sync', () => {
  it('uses one app token attempt per sync, preserves the saved states and retries next run', async () => {
    const failed = await runSync({ force: true, trigger: 'test-scope-refusal' });
    expect(failed.ran).toBe(true);
    expect(tokenScopes).toEqual([EXPLICIT_SCOPE]);
    expect(uberReads).toEqual([]);
    expect(doordashReads).toEqual([DOORDASH_STORE]);
    expect(failed.report?.platformErrors?.uber_eats).toMatch(/invalid_scope/i);
    expect(await lastSyncReport()).toMatchObject({ platformErrors: { uber_eats: expect.stringMatching(/invalid_scope/i) } });
    for (const saved of storesBefore) {
      const current = await getRepo().getStore(saved.id);
      const status = saved.meta.platformStatus as PlatformStatus;
      expect(failed.report?.stores.find((row) => row.storeId === saved.id)).toMatchObject({ ok: false, changed: false, state: status.state });
      expect(current).toMatchObject({ online: saved.online, pausedUntil: saved.pausedUntil, meta: { platformStatus: { state: status.state, detail: status.detail, until: status.until } } });
    }
    expect(failed.report?.stores.find((row) => row.channelStoreId === RELAY_STORE)).toMatchObject({ polled: false, ok: true, state: 'paused' });
    expect(failed.report?.stores.find((row) => row.channelStoreId === DOORDASH_STORE)).toMatchObject({ polled: true, ok: true, state: 'online' });

    oauthError = () => null;
    const recovered = await runSync({ force: true, trigger: 'test-scope-recovered' });
    expect(recovered.ran).toBe(true);
    expect(tokenScopes).toEqual([EXPLICIT_SCOPE, EXPLICIT_SCOPE]);
    expect(uberReads.toSorted()).toEqual(storesBefore.map((s) => s.channelStoreId).toSorted());
    expect(recovered.report?.platformErrors?.uber_eats).toBeUndefined();
    expect((await getRepo().getStore(storesBefore[0].id))).toMatchObject({ online: true, pausedUntil: null, meta: { platformStatus: { state: 'online' } } });
    expect(unexpected).toEqual([]);
  });

  it('continues store reads if the existing narrower default fallback succeeds', async () => {
    vi.stubEnv('UBER_OAUTH_SCOPE', undefined);
    oauthError = (scope) => scope === DEFAULT_SCOPE ? 'invalid_scope' : null;
    const result = await runSync({ force: true });
    expect(tokenScopes).toEqual([DEFAULT_SCOPE, EXPLICIT_SCOPE]);
    expect(uberReads).toHaveLength(DIRECT_STORES);
    expect(result.report?.platformErrors?.uber_eats).toBeUndefined();
    expect(unexpected).toEqual([]);
  });

  it('does not treat a store status HTTP 400 as an app OAuth scope refusal', async () => {
    oauthError = () => null;
    uberReadStatus = 400;
    const result = await runSync({ force: true });
    expect(tokenScopes).toEqual([EXPLICIT_SCOPE]);
    expect(uberReads).toHaveLength(DIRECT_STORES);
    expect(result.report?.platformErrors?.uber_eats).toBeUndefined();
    expect(result.report?.stores.find((row) => row.storeId === storesBefore[0].id)).toMatchObject({ state: 'paused', ok: false, error: 'Uber status HTTP 400' });
    expect(unexpected).toEqual([]);
  });
});
