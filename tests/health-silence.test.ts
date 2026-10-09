// /api/health for an outside uptime monitor and the Overview, and the silence alarm: a platform that used to send
// orders goes quiet for hours while its stores are open.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allDayWeek, saveHours } from '../lib/foodhub/hours';
import { buildHealth } from '../lib/foodhub/health';
import { noteLastOrder } from '../lib/foodhub/order-retry';
import { getRepo } from '../lib/foodhub/repo';
import { listIncidents, runWatch } from '../lib/foodhub/watch/engine';

const saved: Record<string, string | undefined> = {};
const ENV: Record<string, string | undefined> = {
  FOODHUB_FORCE_MEMORY: 'true', CRON_SECRET: 'cron-test', UBER_CLIENT_ID: 'uber-id', UBER_CLIENT_SECRET: 'uber-secret',
  CLOVER_MERCHANT_ID: undefined, CLOVER_ACCESS_TOKEN: undefined, CLOVER_CLIENT_ID: undefined, DASHBOARD_PASSWORD: 'Owner-pass-123',
};
beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  (globalThis as any).__foodhubMem = undefined;
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

describe('/api/health', () => {
  it('nothing has run yet: the Watchtower is "down" (nobody would be alerted) → 503; memory mode is a warning', async () => {
    const h = await buildHealth();
    expect(h.status).toBe('down');
    expect(h.checks.watchtower.status).toBe('down');
    expect(h.checks.database.status).toBe('warn');
    expect(h.checks.clover.status).toBe('warn');
    const { GET } = await import('../app/api/health/route');
    const res = await GET(new Request('http://hub.local/api/health'));
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
    const { GET } = await import('../app/api/health/route');
    const res = await GET(new Request('http://hub.local/api/health', { headers: { authorization: 'Bearer cron-test' } }));
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
