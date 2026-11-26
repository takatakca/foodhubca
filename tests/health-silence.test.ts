// /api/health for an outside uptime monitor and the Overview, and the silence alarm: a platform that used to send
// orders goes quiet for hours while its stores are open.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as healthRoute } from '../app/api/health/route';
import { allDayWeek, saveHours } from '../lib/foodhub/hours';
import { buildHealth } from '../lib/foodhub/health';
import { noteLastOrder } from '../lib/foodhub/order-retry';
import { getRepo } from '../lib/foodhub/repo';
import { listIncidents, runWatch, saveWatchSettings } from '../lib/foodhub/watch/engine';
import { WATCH_BACKGROUND_COMPLETION_KEY } from '../lib/foodhub/watch/types';

const saved: Record<string, string | undefined> = {};
const OLD_RELEASE = 'a'.repeat(40);
const NEXT_RELEASE = 'b'.repeat(40);
const ENV: Record<string, string | undefined> = {
  FOODHUB_FORCE_MEMORY: 'true', CRON_SECRET: 'cron-test', UBER_CLIENT_ID: 'uber-id', UBER_CLIENT_SECRET: 'uber-secret',
  CLOVER_MERCHANT_ID: undefined, CLOVER_ACCESS_TOKEN: undefined, CLOVER_CLIENT_ID: undefined, DASHBOARD_PASSWORD: 'Owner-pass-123',
  FOODHUB_RELEASE_SHA: undefined, SOURCE_COMMIT: undefined, GITHUB_SHA: undefined, COOLIFY_COMMIT_SHA: undefined,
};
beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  (globalThis as any).__foodhubMem = undefined;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('/api/health', () => {
  it('nothing has run yet: the Watchtower is "down" (nobody would be alerted) → 503; memory mode is a warning', async () => {
    const h = await buildHealth();
    expect(h.status).toBe('down');
    expect(h.checks.watchtower.status).toBe('down');
    expect(h.checks.database.status).toBe('warn');
    expect(h.checks.clover.status).toBe('warn');
    const res = await healthRoute(new Request('http://hub.local/api/health'));
    expect(res.status).toBe(503);
    const body = await res.json();
    // The public answer names each check's status, nothing else.
    expect(Object.keys(body).sort()).toEqual(['at', 'checks', 'ok', 'status']);
    expect(body.checks.watchtower).toBe('down');
  });

  it('once the Watchtower, the sync and the recovery run: degraded only for the warnings; details with the cron secret', async () => {
    const repo = getRepo();
    const now = Date.now();
    await repo.setKv('watch:last', { at: new Date(now - 30_000).toISOString() });
    await repo.setKv('recovery:last', { at: new Date(now - 20_000).toISOString() });
    await repo.setKv('sync:last', { at: new Date(now - 60_000).toISOString(), clover: [], stores: [] });
    await noteLastOrder('uber_eats', new Date(now - 3600_000).toISOString());
    const h = await buildHealth({ now });
    expect(h.status).toBe('degraded'); // memory mode + no Clover in this test
    expect([h.checks.watchtower.status, h.checks.sync.status, h.checks.recovery.status, h.checks.inbox.status]).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(h.platforms.find((p) => p.channel === 'uber_eats')).toMatchObject({ mode: 'direct', lastOrderAt: new Date(now - 3600_000).toISOString() });
    const res = await healthRoute(new Request('http://hub.local/api/health', { headers: { authorization: 'Bearer cron-test' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platforms).toHaveLength(4);
    expect(body.checks.sync.detail).toMatch(/Last sync/);
  });

  it('an open order Clover never got (automatic retries used up) makes it "down"', async () => {
    process.env.CLOVER_MERCHANT_ID = 'M1'; process.env.CLOVER_ACCESS_TOKEN = 't';
    const repo = getRepo();
    await repo.setKv('watch:last', { at: new Date().toISOString() });
    const { order } = await repo.insertOrderIfNew({ channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: 'u-1', channelStoreId: 's', fulfillment: 'delivery', placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 1, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 1, lines: [], raw: {} });
    await repo.updateOrder(order.id, { posError: 'Clover returned HTTP 503', timeline: { posRetry: { attempts: 2, nextAt: null, gaveUpAt: new Date().toISOString() } } });
    const h = await buildHealth();
    expect(h.checks.clover.status).toBe('down');
    expect(h.status).toBe('down');
  });

  it('shows allowlisted background completion only in the authenticated health detail', async () => {
    const repo = getRepo();
    const at = new Date().toISOString();
    const request = (authorization?: string) => healthRoute(new Request('http://hub.local/api/health', { headers: authorization ? { authorization } : undefined }));
    const admin = `Basic ${Buffer.from('owner:Owner-pass-123').toString('base64')}`;
    expect((await (await request(admin)).json()).checks.watchtower.lastBackgroundCompletion).toBeNull();
    await repo.setKv(WATCH_BACKGROUND_COMPLETION_KEY, { at, trigger: 'timer', internal: 'should not be returned' });
    const getKv = vi.spyOn(repo, 'getKv');
    const publicHealth = await (await request()).json();
    expect(Object.keys(publicHealth).sort()).toEqual(['at', 'checks', 'ok', 'status']);
    expect(typeof publicHealth.checks.watchtower).toBe('string');
    expect(getKv).not.toHaveBeenCalledWith(WATCH_BACKGROUND_COMPLETION_KEY);
    for (const authorization of [admin, 'Bearer cron-test']) {
      const response = await request(authorization);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      const body = await response.json();
      expect(body.checks.watchtower.lastBackgroundCompletion).toEqual({ at, trigger: 'timer' });
    }
    await repo.setKv(WATCH_BACKGROUND_COMPLETION_KEY, { at, trigger: 'cron', sha: NEXT_RELEASE, internal: 'do not expose' });
    for (const authorization of [admin, 'Bearer cron-test']) {
      expect((await (await request(authorization)).json()).checks.watchtower.lastBackgroundCompletion).toEqual({ at, trigger: 'cron', sha: NEXT_RELEASE });
    }
    expect((await (await request()).json()).checks.watchtower).toEqual(expect.any(String));
    await repo.setKv(WATCH_BACKGROUND_COMPLETION_KEY, { at, trigger: 'cron', sha: 'short-sha' });
    expect((await (await request(admin)).json()).checks.watchtower.lastBackgroundCompletion).toEqual({ at, trigger: 'cron' });
    await repo.setKv(WATCH_BACKGROUND_COMPLETION_KEY, { at, trigger: 'pulse' });
    expect((await (await request(admin)).json()).checks.watchtower.lastBackgroundCompletion).toBeNull();
  });
});

describe('Watchtower background completion', () => {
  const start = Date.parse('2026-11-26T17:00:00.000Z');
  const stamp = (offset: number) => new Date(start + offset).toISOString();
  const completion = () => getRepo().getKv(WATCH_BACKGROUND_COMPLETION_KEY);
  const runAt = (trigger: string, offset: number) => {
    vi.setSystemTime(start + offset);
    return runWatch({ trigger });
  };

  it('keeps the completion marker separate from manual and pulse heartbeats and throttle skips', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    expect((await runAt('manual', 0)).ran).toBe(true);
    expect(await completion()).toBeNull();
    expect((await runAt('timer', 30_000)).ran).toBe(true);
    expect(await completion()).toEqual({ at: stamp(30_000), trigger: 'timer' });
    expect((await runAt('cron', 40_000)).ran).toBe(false);
    expect((await runAt('pulse', 60_000)).ran).toBe(true);
    expect(await getRepo().getKv('watch:last')).toEqual({ at: stamp(60_000) });
    expect(await completion()).toEqual({ at: stamp(30_000), trigger: 'timer' });

    vi.spyOn(getRepo(), 'listUsers').mockImplementationOnce(async () => {
      vi.setSystemTime(start + 92_000);
      return [];
    });
    expect((await runAt('cron', 90_000)).ran).toBe(true);
    expect(await getRepo().getKv('watch:last')).toEqual({ at: stamp(90_000) });
    expect(await completion()).toEqual({ at: stamp(92_000), trigger: 'cron' });
  });

  it('retains previous completion if a background run fails or Watchtower is disabled', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    expect((await runAt('timer', 0)).ran).toBe(true);
    vi.spyOn(getRepo(), 'listUsers').mockRejectedValueOnce(new Error('test incident handling error'));
    await expect(runAt('cron', 30_000)).rejects.toThrow('test incident handling error');
    expect(await getRepo().getKv('watch:last')).toEqual({ at: stamp(30_000) });
    expect(await completion()).toEqual({ at: stamp(0), trigger: 'timer' });
    await saveWatchSettings({ enabled: false }, { username: 'test-owner', name: 'Test owner', source: 'dashboard' });
    expect((await runAt('timer', 60_000)).ran).toBe(false);
    expect(await completion()).toEqual({ at: stamp(0), trigger: 'timer' });
  });

  it('attributes completed background runs to the release that executed them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    process.env.SOURCE_COMMIT = NEXT_RELEASE;
    process.env.FOODHUB_RELEASE_SHA = ` ${OLD_RELEASE} `;
    expect((await runAt('timer', 0)).ran).toBe(true);
    expect(await completion()).toEqual({ at: stamp(0), trigger: 'timer', sha: OLD_RELEASE });

    delete process.env.FOODHUB_RELEASE_SHA;
    expect((await runAt('cron', 30_000)).ran).toBe(true);
    expect(await completion()).toEqual({ at: stamp(30_000), trigger: 'cron', sha: NEXT_RELEASE });

    // A malformed higher-priority value cannot be replaced by a different SHA here.
    process.env.FOODHUB_RELEASE_SHA = 'not-a-full-sha';
    expect((await runAt('timer', 60_000)).ran).toBe(true);
    expect(await completion()).toEqual({ at: stamp(60_000), trigger: 'timer' });
  });
});

describe('silence alarm', () => {
  async function setup(opts: { lastOrderMinAgo: number; paused?: boolean; hours?: boolean }) {
    const repo = getRepo();
    if (opts.hours !== false) await saveHours({ locations: { NDG_6284: allDayWeek() }, brands: {}, holidays: [] });
    await repo.upsertStore({ channel: 'uber_eats', channelStoreId: 'ue-1', brandName: 'Po Poulet', locationCode: 'NDG_6284', autoAccept: true, online: !opts.paused, meta: opts.paused ? { platformStatus: { state: 'paused', checkedAt: new Date().toISOString(), source: 'sync' } } : {} });
    await noteLastOrder('uber_eats', new Date(Date.now() - opts.lastOrderMinAgo * 60_000).toISOString());
    await runWatch({ force: true });
    return (await listIncidents({ status: ['open'] })).filter((i) => i.kind === 'platform_silent');
  }

  it('no Uber order for 4 h while a store was open all along → "Platform gone quiet"', async () => {
    const found = await setup({ lastOrderMinAgo: 240 });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: 'platform_silent:uber_eats', severity: 'warning', channel: 'uber_eats' });
    expect(found[0].titleEn).toMatch(/No Uber Eats order for 4 h — 1 store\(s\) open/);
  });

  it('quiet for less than the threshold, the stores paused, or no hours known → no alarm', async () => {
    expect(await setup({ lastOrderMinAgo: 60 })).toHaveLength(0);
    (globalThis as any).__foodhubMem = undefined;
    expect(await setup({ lastOrderMinAgo: 300, paused: true })).toHaveLength(0);
    (globalThis as any).__foodhubMem = undefined;
    expect(await setup({ lastOrderMinAgo: 300, hours: false })).toHaveLength(0);
  });
});
