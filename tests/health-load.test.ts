// Regression (PR #6 review): the public, unauthenticated GET /api/health reads the database on every request, uncached, and the
// "small" sync:last read is the whole SyncReport (every store row, Clover sales, reconciliation…). Anyone on the
// internet can turn requests into Supabase reads 1:2, the moment the database is already slow included.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../app/api/health/route';
import { getRepo } from '../lib/foodhub/repo';

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DASHBOARD_PASSWORD', 'Owner-pass-health-123');
  vi.stubEnv('SESSION_SECRET', 'session-secret-health-0123456789abcdef');
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('GET /api/health database load', () => {
  it('a burst of anonymous requests does not become a burst of database reads', async () => {
    const at = new Date().toISOString();
    const stores = Array.from({ length: 60 }, (_, i) => ({ brandName: `Brand ${i}`, locationCode: `LOC${i}`, channel: 'uber_eats', channelStoreId: `store-${i}`, state: 'online' }));
    await getRepo().setKv('sync:last', { at, stores, clover: [{ total: 1234.5, count: 99 }] });
    await getRepo().setKv('watch:last', { at });
    const spy = vi.spyOn(getRepo(), 'getKv');

    await Promise.all(Array.from({ length: 50 }, () => GET()));

    // Each request pulls the full sync report (60 store rows here) out of the database just to read `at`.
    const syncReads = spy.mock.calls.filter(([k]) => k === 'sync:last').length;
    expect(syncReads).toBeLessThanOrEqual(2);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(4);
  });
});
