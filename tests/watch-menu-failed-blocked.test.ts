// Regression (PR #6 review): menu_failed now texts the managers by default, but it counts every job with status 'error' — and
// ops.record() stores 'blocked' results (never sent: Too Good To Go has no API, platforms linked through Clover,
// LIVE_CONNECTORS_GLOBAL_ENABLED off) as 'error'. An ordinary 86 then texts "action refused by a platform".
import { beforeEach, describe, expect, it } from 'vitest';
import type { FoodHubUser } from '../lib/foodhub/types';

const AFTERNOON = Date.parse('2026-10-04T17:00:00.000Z'); // 13:00 Montréal, outside quiet hours
const MIN = 60_000;

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  (globalThis as any).__takatakWatchRunning = undefined;
  delete process.env.FOODHUB_TIMEZONE;
  delete process.env.LIVE_CONNECTORS_GLOBAL_ENABLED;
});

describe('menu_failed and actions that were never sent', () => {
  it('an 86 on a brand that also has a Too Good To Go store does not text the managers "refused by a platform"', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { setItemAvailability } = await import('../lib/foodhub/ops');
    const { runWatch, listIncidents } = await import('../lib/foodhub/watch/engine');
    const repo = getRepo();
    await repo.saveUser({ username: 'mona', name: 'Mona', role: 'manager', locations: ['NDG_MAIN'], phone: '+15145550177', active: true, lastLoginAt: null, prefs: { onDuty: true, alertSms: true, alertCall: true } } as unknown as FoodHubUser);
    await repo.upsertStore({ channel: 'tgtg', channelStoreId: 'tg-ndg', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {} });

    const rows = await setItemAvailability('Po Poulet', ['poutine'], false); // the cook 86es the poutine
    expect(rows.map((r) => r.result.status)).toEqual(['blocked']); // nothing was sent to TGTG (no API) — honest
    expect((await repo.listJobs(10)).map((j) => j.status)).toEqual(['error']); // …but recorded as an error job

    await runWatch({ force: true, now: AFTERNOON });
    await runWatch({ force: true, now: AFTERNOON + 3 * MIN });
    const incidents = (await listIncidents({})).filter((i) => i.kind === 'menu_failed');
    // Before the fix: "1 action(s) refused by a platform" opened and texted to Mona.
    expect(incidents.flatMap((i) => i.steps).filter((s) => s.kind === 'sms')).toEqual([]);
    expect(incidents).toEqual([]);
  });
});
