// GET /api/health — public, for an outside uptime monitor. 200 when healthy; 503 when the database does not answer,
// the app runs in memory mode in production, the scheduled sync stopped, or the console is locked. The body never
// carries a secret, an error message, a store, brand or order, or a count.
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pkg from '../package.json';
import { GET } from '../app/api/health/route';
import { proxy } from '../proxy';
import { checkHealth, syncMaxAgeMin } from '../lib/foodhub/health';
import { getRepo } from '../lib/foodhub/repo';
import { runSync } from '../lib/foodhub/sync';

const realFetch = globalThis.fetch;
const KEYS = ['db', 'dbOk', 'lastSyncAgeSec', 'liveConnectors', 'ok', 'problems', 'version', 'watchAgeSec'];
const minAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const read = async () => { const res = await GET(); return { res, body: await res.json() }; };

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  // A plain test server: no scheduler promised, not live, sign-in configured.
  for (const k of ['FOODHUB_HEALTH_SYNC_MAX_MIN', 'FOODHUB_INTERNAL_SYNC_MIN', 'VERCEL', 'LIVE_CONNECTORS_GLOBAL_ENABLED']) vi.stubEnv(k, undefined);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DASHBOARD_PASSWORD', 'Owner-pass-health-123');
  vi.stubEnv('SESSION_SECRET', 'session-secret-health-0123456789abcdef');
  globalThis.fetch = vi.fn(async () => new Response('{}', { status: 503 })) as any;
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); globalThis.fetch = realFetch; });

describe('GET /api/health', () => {
  it('answers 200 with the version, database mode and ages when healthy', async () => {
    await getRepo().setKv('sync:last', { at: minAgo(3) });
    await getRepo().setKv('watch:last', { at: minAgo(0.5) });
    const { res, body } = await read();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(body).toMatchObject({ ok: true, version: pkg.version, db: 'memory', dbOk: true, liveConnectors: false, problems: [] });
    expect(body.lastSyncAgeSec).toBeGreaterThanOrEqual(179);
    expect(body.lastSyncAgeSec).toBeLessThanOrEqual(182);
    expect(body.watchAgeSec).toBeGreaterThanOrEqual(29);
    expect(body.watchAgeSec).toBeLessThanOrEqual(32);
  });

  it('reads the times the sync engine and the Watchtower really record', async () => {
    const before = await checkHealth();
    expect(before.lastSyncAgeSec).toBeNull();
    expect(before.watchAgeSec).toBeNull();
    const run = await runSync({ trigger: 'test', force: true });
    expect(run.ran).toBe(true);
    const after = await checkHealth();
    expect(after.lastSyncAgeSec).toBeLessThanOrEqual(2);
    expect(after.watchAgeSec).toBeLessThanOrEqual(2); // runSync runs the Watchtower right after
  });

  it('answers 503 when the app runs in memory mode in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await getRepo().setKv('sync:last', { at: minAgo(1) });
    const { res, body } = await read();
    expect(res.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.db).toBe('memory');
    expect(body.problems).toEqual(['memory_mode_in_production']);
  });

  it('answers 503 when the scheduled sync stopped (in-server timer or production cron)', async () => {
    vi.stubEnv('FOODHUB_INTERNAL_SYNC_MIN', '5');
    await getRepo().setKv('sync:last', { at: minAgo(25) });
    let { res, body } = await read();
    expect(res.status).toBe(503);
    expect(body.problems).toEqual(['sync_stale']);
    expect(body.lastSyncAgeSec).toBeGreaterThan(20 * 60);

    await getRepo().setKv('sync:last', { at: minAgo(4) });
    ({ res, body } = await read());
    expect(res.status).toBe(200);

    // Without a scheduler (dev, or Vercel without a pinger) an old sync is not an outage.
    vi.stubEnv('FOODHUB_INTERNAL_SYNC_MIN', '0');
    await getRepo().setKv('sync:last', { at: minAgo(300) });
    ({ res } = await read());
    expect(res.status).toBe(200);
  });

  it('gives a fresh server the time to run its first sync, then calls a missing sync stale', async () => {
    vi.stubEnv('FOODHUB_INTERNAL_SYNC_MIN', '5');
    expect((await checkHealth({ uptimeSec: 60 })).problems).toEqual([]);
    expect((await checkHealth({ uptimeSec: 21 * 60 })).problems).toEqual(['sync_stale']);
  });

  it('knows when a regular sync is expected', () => {
    expect(syncMaxAgeMin()).toBe(0); // test/dev, no timer
    vi.stubEnv('FOODHUB_INTERNAL_SYNC_MIN', '5');
    expect(syncMaxAgeMin()).toBe(20);
    vi.stubEnv('FOODHUB_INTERNAL_SYNC_MIN', '30');
    expect(syncMaxAgeMin()).toBe(60); // a slow timer is not called stale between two runs
    vi.stubEnv('FOODHUB_INTERNAL_SYNC_MIN', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    expect(syncMaxAgeMin()).toBe(20); // VPS: the installer's cron syncs every 5 min
    vi.stubEnv('VERCEL', '1');
    expect(syncMaxAgeMin()).toBe(0); // Vercel: only a daily cron unless a pinger is set up…
    vi.stubEnv('FOODHUB_HEALTH_SYNC_MAX_MIN', '15');
    expect(syncMaxAgeMin()).toBe(15); // …which the owner declares here
    vi.stubEnv('FOODHUB_HEALTH_SYNC_MAX_MIN', '0');
    expect(syncMaxAgeMin()).toBe(0);
  });

  it('answers 503 without the reason when the database fails or hangs', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(getRepo(), 'getKv').mockRejectedValue(new Error('connect ECONNREFUSED db.hidden-project.supabase.co key=sb_secret_abc'));
    const { res, body } = await read();
    expect(res.status).toBe(503);
    expect(body).toMatchObject({ ok: false, db: 'error', dbOk: false, lastSyncAgeSec: null, watchAgeSec: null, problems: ['database_unreachable'] });
    expect(JSON.stringify(body)).not.toMatch(/hidden-project|sb_secret|ECONNREFUSED/);
    expect(spy).toHaveBeenCalled(); // the reason goes to the server log only

    vi.useFakeTimers();
    vi.spyOn(getRepo(), 'getKv').mockImplementation(() => new Promise(() => undefined)); // never answers
    const pending = checkHealth();
    await vi.advanceTimersByTimeAsync(4_100);
    const hung = await pending;
    expect(hung.ok).toBe(false);
    expect(hung.problems).toEqual(['database_unreachable']);
  });

  it('answers 503 when every screen would get "Locked" from the sign-in gate', async () => {
    vi.stubEnv('LIVE_CONNECTORS_GLOBAL_ENABLED', 'true');
    vi.stubEnv('DASHBOARD_PASSWORD', undefined);
    let { res, body } = await read();
    expect(res.status).toBe(503);
    expect(body).toMatchObject({ liveConnectors: true, problems: ['console_locked'] });

    vi.stubEnv('LIVE_CONNECTORS_GLOBAL_ENABLED', undefined);
    vi.stubEnv('SESSION_SECRET', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FOODHUB_HEALTH_SYNC_MAX_MIN', '0');
    ({ res, body } = await read());
    expect(body.problems).toContain('console_locked');
  });

  it('never reveals secrets, stores, brands, orders or counts', async () => {
    const secrets = { CRON_SECRET: 'cron-secret-health-xyz', CLOVER_ACCESS_TOKEN: 'clover-token-health-xyz', UBER_CLIENT_SECRET: 'uber-secret-health-xyz', ANTHROPIC_API_KEY: 'sk-ant-health-xyz' };
    for (const [k, v] of Object.entries(secrets)) vi.stubEnv(k, v);
    const repo = getRepo();
    await repo.upsertStore({ channel: 'uber_eats', channelStoreId: 'uber-store-health-77', brandName: 'Po Poulet Health', locationCode: 'NDG_HEALTH', autoAccept: true, online: true } as any);
    const at = minAgo(2);
    await repo.insertOrderIfNew({ channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: 'ext-order-health-991', displayId: 'HX991', channelStoreId: 'uber-store-health-77', brandName: 'Po Poulet Health', fulfillment: 'delivery', placedAt: at, currency: 'CAD', subtotal: 431.17, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 431.17, lines: [], raw: {}, locationCode: 'NDG_HEALTH', createdAt: at });
    // The real sync report holds store names and today's Clover sales: only its time may come out.
    await repo.setKv('sync:last', { at, stores: [{ brandName: 'Po Poulet Health', locationCode: 'NDG_HEALTH', channelStoreId: 'uber-store-health-77' }], clover: [{ total: 9876.54, count: 321 }] });
    await repo.setKv('watch:last', { at });

    const { res, body } = await read();
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(KEYS);
    const text = JSON.stringify(body);
    for (const v of [...Object.values(secrets), 'Owner-pass-health-123', 'session-secret-health', 'Po Poulet Health', 'NDG_HEALTH', 'uber-store-health-77', 'ext-order-health-991', 'HX991', '431.17', '9876.54', '321']) {
      expect(text).not.toContain(v);
    }
  });
});

describe('the sign-in gate lets the uptime monitor in, on that exact path only', () => {
  const passes = (res: Response) => res.headers.get('x-middleware-next') === '1';

  it('opens /api/health without a session, and nothing else that starts like it', async () => {
    expect(passes(await proxy(new NextRequest('http://hub.local/api/health')))).toBe(true);
    for (const path of ['/api/healthz', '/api/health/details', '/api/health-admin', '/api/foodhub/orders']) {
      const res = await proxy(new NextRequest(`http://hub.local${path}`));
      expect(passes(res)).toBe(false);
      expect(res.status).toBe(401);
    }
  });

  it('still answers while the console is locked, so the monitor sees "down"', async () => {
    vi.stubEnv('LIVE_CONNECTORS_GLOBAL_ENABLED', 'true');
    vi.stubEnv('DASHBOARD_PASSWORD', undefined);
    expect(passes(await proxy(new NextRequest('http://hub.local/api/health')))).toBe(true);
    expect((await proxy(new NextRequest('http://hub.local/api/foodhub/orders'))).status).toBe(503);
  });
});
