// Store availability center — status history: how each activity line becomes an event, its result, and the scope filter.
import { beforeEach, describe, expect, it } from 'vitest';
import { logActivity } from '../lib/foodhub/activity';
import { BUSY_ACTOR, BUSY_KEPT_ACTION, BUSY_SCHEDULE_ACTION, GUARD_ACTOR } from '../lib/foodhub/store-availability/common';
import { statusHistory } from '../lib/foodhub/store-availability/history';
import { HOLIDAY_REASON } from '../lib/foodhub/ops';
import type { ActivityEntry } from '../lib/foodhub/types';

const LOC = 'NDG_MAIN';
let n = 0;
const line = (e: Partial<ActivityEntry> & Pick<ActivityEntry, 'action'>) => logActivity({
  actor: 'Mona', source: 'dashboard', kind: 'store_status', status: 'success', locationCode: LOC, summary: `line ${n}`,
  at: new Date(Date.now() - 60_000 + n++ * 10).toISOString(), ...e,
});
const only = async (action: string) => (await statusHistory({ locationCode: LOC })).filter((r) => r.summary.startsWith(action));

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  n = 0;
});

describe('status history', () => {
  it('maps every event kind', async () => {
    const cases: Array<[Partial<ActivityEntry> & Pick<ActivityEntry, 'action'>, string]> = [
      [{ action: 'pause', summary: 'p1 Store paused (Kitchen too busy) — Alpha' }, 'pause'],
      [{ action: 'pause', actor: GUARD_ACTOR.name, source: 'automation', summary: 'p2 paused' }, 'guard_pause'],
      [{ action: 'pause', summary: `p3 Store paused (${HOLIDAY_REASON}) — Alpha` }, 'holiday_closure'],
      [{ action: 'resume', summary: 'p4 resumed' }, 'resume'],
      [{ action: 'resume', actor: GUARD_ACTOR.name, source: 'automation', summary: 'p5 resumed' }, 'guard_resume'],
      [{ action: 'platform_paused', source: 'platform', summary: 'p6 platform' }, 'platform_paused'],
      [{ action: 'store_deactivated', summary: 'p7 deactivated' }, 'platform_deactivated'],
      [{ action: 'busy_on', summary: 'p8 busy' }, 'busy_on'],
      [{ action: 'uber_prep_time', summary: 'p9 prep' }, 'prep_time'],
      [{ action: 'reopen_failed', status: 'failed', summary: 'pa reopen' }, 'reopen_failed'],
      [{ action: 'hours_saved', kind: 'hours', summary: 'pb hours' }, 'hours'],
      [{ action: 'special_days_added', kind: 'hours', summary: 'pc special' }, 'holiday'],
      [{ action: BUSY_SCHEDULE_ACTION, kind: 'hours', summary: 'pd schedule' }, 'busy_schedule'],
      [{ action: BUSY_KEPT_ACTION, kind: 'hours', actor: BUSY_ACTOR.name, source: 'schedule', summary: 'pe kept' }, 'busy_kept'],
    ];
    for (const [e] of cases) await line(e);
    await line({ action: 'menu_published', summary: 'pf not a status line' });
    for (const [e, event] of cases) expect((await only(e.summary!.split(' ')[0]))[0]?.event).toBe(event);
    expect(await only('pf')).toEqual([]);
    expect((await only('p1'))[0].reason).toBe('Kitchen too busy');
  });

  it('results: ok, blocked (not sent), failed', async () => {
    await line({ action: 'pause', summary: 'r1 ok' });
    await line({ action: 'pause', status: 'failed', detail: { result: { status: 'blocked' } }, summary: 'r2 blocked' });
    await line({ action: 'pause', status: 'failed', detail: { result: { status: 'error' } }, summary: 'r3 failed' });
    expect((await only('r1'))[0].result).toBe('ok');
    expect((await only('r2'))[0].result).toBe('blocked');
    expect((await only('r3'))[0].result).toBe('failed');
  });

  it('scope: other kitchens left out; a line with no location is kept only for hours saved for every kitchen', async () => {
    await line({ action: 'pause', summary: 's1 mine' });
    await line({ action: 'pause', locationCode: 'OTHER', summary: 's2 other' });
    await line({ action: 'pause', locationCode: undefined, summary: 's3 no location' });
    await line({ action: 'hours_saved', kind: 'hours', locationCode: undefined, summary: 's4 all hours' });
    const rows = (await statusHistory({ locationCode: LOC })).map((r) => r.summary.split(' ')[0]).sort();
    expect(rows).toEqual(['s1', 's4']);
  });
});
