import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as disconnectStore } from '../app/api/foodhub/uber-connect/disconnect/route';
import { POST as saveStore } from '../app/api/foodhub/stores/route';
import { hashPassword } from '../lib/foodhub/auth';
import { getRepo } from '../lib/foodhub/repo';

const sessionId = 'f'.repeat(36);
const originalId = 'uber-fixture-original';
const replacementId = 'uber-fixture-replacement';
const unmappedId = 'uber-fixture-unmapped';
const ownerPassword = 'fixture-owner-disconnect-password';
const managerPassword = 'fixture-manager-disconnect-password';

function request(path: string, data: Record<string, unknown>, username = 'owner') {
  const password = username === 'owner' ? ownerPassword : managerPassword;
  return new Request('http://hub.local/api/foodhub/' + path, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(username + ':' + password).toString('base64'),
      'content-type': 'application/json',
    },
    body: JSON.stringify(data),
  });
}

function disconnect(storeId = originalId, username = 'owner') {
  return disconnectStore(request('uber-connect/disconnect', { id: sessionId, storeId }, username), undefined);
}

function suspendedDelete() {
  let started!: () => void;
  let release!: () => void;
  const issued = new Promise<void>((resolve) => { started = resolve; });
  const providerResponse = new Promise<void>((resolve) => { release = resolve; });
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.method).toBe('DELETE');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-merchant-token');
    expect(new URL(url).pathname).toBe('/v1/eats/stores/' + originalId + '/pos_data');
    started();
    await providerResponse;
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetch);
  const result = disconnect();
  return {
    result, release, fetch,
    ready: Promise.race([issued, result.then((response) => { throw new Error('DELETE not issued: ' + response.status); })]),
  };
}

async function mappedStore() {
  return getRepo().upsertStore({
    channel: 'uber_eats', channelStoreId: originalId, brandName: 'Po Poulet', locationCode: 'NDG_MAIN',
    cloverMerchantId: null, autoAccept: true, online: true,
    meta: { provisioned: true, awaitingProvision: true, uberPos: { storeId: originalId, orderManager: 'foodhub' }, retainedFlag: 'before' },
  });
}

beforeEach(async () => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('DASHBOARD_PASSWORD', ownerPassword);
  vi.stubEnv('UBER_CLIENT_ID', 'fixture-app');
  vi.stubEnv('UBER_CLIENT_SECRET', 'fixture-app-secret');
  vi.stubEnv('UBER_BASE_URL', 'http://127.0.0.1:12345');
  vi.stubEnv('LIVE_CONNECTORS_GLOBAL_ENABLED', 'true');
  (globalThis as unknown as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  await getRepo().setKv('uber-connect:' + sessionId, {
    createdAt: Date.now(), token: 'fixture-merchant-token',
    stores: [originalId, unmappedId].map((id) => ({ id, name: 'Synthetic Uber store' })),
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Uber disconnect while a mapping changes', () => {
  it.each(['replacement', 'provider evidence'] as const)('preserves newer %s when the earlier provider DELETE finishes', async (change) => {
    const existing = await mappedStore();
    const repo = getRepo();
    const operation = suspendedDelete();
    try {
      await operation.ready;
      if (change === 'replacement') {
        const response = await saveStore(request('stores', {
          id: existing.id, channel: 'uber_eats', channelStoreId: replacementId,
          brandName: 'Pi Pita', locationCode: 'SAINT_LEONARD', cloverMerchantId: 'TESTMERCH0001',
        }), undefined);
        expect(response.status, await response.text()).toBe(200);
      }
      const checkedId = change === 'replacement' ? replacementId : originalId;
      const current = await repo.getStore(existing.id);
      expect(current?.channelStoreId).toBe(checkedId);
      const fresh = await repo.updateStore(existing.id, {
        meta: { ...current?.meta, provisioned: true, provisionChangedAt: '2026-11-28T06:30:00Z',
          uberPos: { storeId: checkedId, orderManager: 'foodhub', integrationEnabled: true }, retainedFlag: 'newer' },
      });
      operation.release();
      const response = await operation.result;
      expect(await repo.getStore(existing.id)).toEqual(fresh);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, mappingConflict: true });
      expect(operation.fetch).toHaveBeenCalledTimes(1);
    } finally {
      operation.release();
    }
  });

  it('records a normal disconnect and preserves unrelated metadata saved while Uber was replying', async () => {
    const existing = await mappedStore();
    const repo = getRepo();
    const operation = suspendedDelete();
    try {
      await operation.ready;
      await repo.updateStore(existing.id, { meta: { ...existing.meta, retainedFlag: 'newer' } });
      const update = repo.updateStore.bind(repo);
      const raced = vi.spyOn(repo, 'updateStore').mockImplementationOnce(async (id, patch, expected) => {
        const current = await repo.getStore(id);
        await update(id, { meta: { ...current?.meta, savedAtWrite: true } });
        return update(id, patch, expected);
      });
      try {
        operation.release();
        const response = await operation.result;
        expect(response.status).toBe(200);
        expect(await response.json()).not.toHaveProperty('mappingConflict', true);
        const saved = await repo.getStore(existing.id);
        expect(saved?.meta).toMatchObject({ provisioned: false, retainedFlag: 'newer', savedAtWrite: true });
        expect(saved?.meta).toHaveProperty('uberDisconnectedAt');
        expect(saved?.meta).not.toHaveProperty('uberPos');
        expect(saved?.meta).not.toHaveProperty('awaitingProvision');
        expect(raced).toHaveBeenCalledTimes(2);
        expect(operation.fetch).toHaveBeenCalledTimes(1);
      } finally {
        raced.mockRestore();
      }
    } finally {
      operation.release();
    }
  });

  it('reports review if a mapping first appears while the account-wide disconnect is in flight', async () => {
    const repo = getRepo();
    expect(await repo.findStore('uber_eats', originalId)).toBeNull();
    const operation = suspendedDelete();
    try {
      await operation.ready;
      const newlyMapped = await mappedStore();
      operation.release();
      const response = await operation.result;
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, mappingConflict: true });
      expect(await repo.getStore(newlyMapped.id)).toEqual(newlyMapped);
      expect(operation.fetch).toHaveBeenCalledTimes(1);
    } finally {
      operation.release();
    }
  });

  it('reports review when an account-wide disconnect cannot check for a new mapping', async () => {
    const repo = getRepo();
    const operation = suspendedDelete();
    try {
      await operation.ready;
      const reread = vi.spyOn(repo, 'findStore').mockRejectedValueOnce(new Error('Fixture storage read failed'));
      try {
        operation.release();
        const response = await operation.result;
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ ok: true, mappingConflict: true });
        expect(operation.fetch).toHaveBeenCalledTimes(1);
      } finally {
        reread.mockRestore();
      }
    } finally {
      operation.release();
    }
  });

  it('refuses a scoped manager with no mapped kitchen while preserving the account-wide path', async () => {
    await getRepo().saveUser({
      username: 'fixture-manager', name: 'Fixture manager', active: true, role: 'manager', locations: ['NDG_MAIN'],
      passwordHash: hashPassword(managerPassword),
    });
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    expect((await disconnect(unmappedId, 'fixture-manager')).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect((await disconnect(unmappedId)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await getRepo().findStore('uber_eats', unmappedId)).toBeNull();
  });
});
