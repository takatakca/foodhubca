// Store availability center — "Calendrier occupé": busy mode at the edges of a window; a person's change wins.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.hoisted(() => vi.fn(async () => [] as Array<{ storeId: string; result: unknown }>));
vi.mock('../lib/foodhub/adapters/uber-api', async (orig) => ({ ...(await orig<typeof import('../lib/foodhub/adapters/uber-api')>()), pushPrepTimeToUber: pushMock }));

import { SCHEDULE_ACTOR, type Actor } from '../lib/foodhub/activity';
import { activeBusyWindow, getBusyState, saveBusySchedule, tickBusySchedule, validateBusyWindows } from '../lib/foodhub/store-availability/busy-schedule';
import { getPrepSettings, prepFor, savePrep } from '../lib/foodhub/prep';
import { getRepo } from '../lib/foodhub/repo';
import { localWallToUtcMs } from '../lib/foodhub/time';

const TZ = 'America/Toronto';
const LOC = 'NDG_MAIN';
const at = (y: number, m: number, d: number, h: number, min = 0) => localWallToUtcMs(y, m, d, h, min, TZ);
const PERSON: Actor = { username: 'mona', name: 'Mona', source: 'dashboard' };
// 2026-10-16 is a Friday.
const FRI = (h: number, min = 0) => at(2026, 10, 16, h, min);

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.FOODHUB_TIMEZONE = TZ;
  (globalThis as any).__foodhubMem = undefined;
  pushMock.mockClear();
});

describe('busy schedule — validation', () => {
  it('accepts windows across midnight and refuses overlaps, empty windows and out-of-range minutes', () => {
    expect(validateBusyWindows([{ days: ['friday'], start: '22:00', end: '02:00', extraMin: 10 }]).errors).toEqual([]);
    expect(validateBusyWindows([
      { days: ['friday'], start: '22:00', end: '02:00', extraMin: 10 },
      { days: ['saturday'], start: '01:00', end: '03:00', extraMin: 10 },
    ]).errors[0]).toMatch(/overlaps/);
    expect(validateBusyWindows([
      { days: ['friday'], start: '17:00', end: '20:00', extraMin: 10 },
      { days: ['friday'], start: '20:00', end: '22:00', extraMin: 5 },
    ]).errors).toEqual([]); // back to back is fine
    expect(validateBusyWindows([{ days: ['friday'], start: '17:00', end: '17:00', extraMin: 10 }]).errors[0]).toMatch(/empty/);
    expect(validateBusyWindows([{ days: ['friday'], start: '17:00', end: '20:00', extraMin: 90 }]).errors.length).toBe(1);
    expect(validateBusyWindows([{ days: ['friday'], start: '17:00', end: '20:00', extraMin: 4 }]).errors.length).toBe(1);
    expect(validateBusyWindows([{ days: [], start: '17:00', end: '20:00', extraMin: 10 }]).errors.length).toBe(1);
    expect(validateBusyWindows([{ days: ['friday'], start: '7:00', end: '20:00', extraMin: 10 }]).errors.length).toBe(1);
    const ok = validateBusyWindows([{ days: ['saturday', 'friday', 'friday'], start: '17:00', end: '20:00', extraMin: 10 }]);
    expect(ok.windows[0].days).toEqual(['friday', 'saturday']);
    expect(ok.windows[0].id).toBeTruthy();
  });
  it('saveBusySchedule refuses invalid windows', async () => {
    await expect(saveBusySchedule(LOC, [{ days: ['friday'], start: '17:00', end: '17:00', extraMin: 10 }], PERSON)).rejects.toThrow(/empty/);
  });
});

describe('busy schedule — tick', () => {
  it('turns busy on at the start, once (idempotent), and back to normal at the end with the old busy minutes', async () => {
    await savePrep(LOC, { normal: 15, busy: 30 }, PERSON);
    await saveBusySchedule(LOC, [{ id: 'w1', days: ['friday'], start: '17:00', end: '20:00', extraMin: 10 }], PERSON);
    await tickBusySchedule(FRI(16, 59));
    expect((await prepFor(LOC)).isBusy).toBe(false);

    const r = await tickBusySchedule(FRI(17, 0));
    expect(r.started).toEqual([LOC]);
    const on = (await getPrepSettings())[LOC];
    expect(on).toMatchObject({ isBusy: true, busy: 25, normal: 15, changedBy: SCHEDULE_ACTOR.name });
    expect(pushMock).toHaveBeenCalledWith(LOC, 25, SCHEDULE_ACTOR);
    expect((await getBusyState())[LOC]).toMatchObject({ windowId: 'w1', prevBusy: 30, applied: true });

    const activity = (await getRepo().listActivity({ kinds: ['store_status'] })).length;
    expect((await tickBusySchedule(FRI(17, 30))).started).toEqual([]);
    expect((await tickBusySchedule(FRI(19, 59))).started).toEqual([]);
    expect((await getRepo().listActivity({ kinds: ['store_status'] })).length).toBe(activity);
    expect(pushMock).toHaveBeenCalledTimes(1);

    const end = await tickBusySchedule(FRI(20, 0));
    expect(end.ended).toEqual([LOC]);
    expect((await getPrepSettings())[LOC]).toMatchObject({ isBusy: false, busy: 30, normal: 15 });
    expect(pushMock).toHaveBeenLastCalledWith(LOC, 15, SCHEDULE_ACTOR);
    expect((await getBusyState())[LOC]).toBeUndefined();
    await tickBusySchedule(FRI(20, 30));
    expect(pushMock).toHaveBeenCalledTimes(2);
  });

  it('a person who changes busy mode during the window wins (no re-apply, no restore)', async () => {
    await saveBusySchedule(LOC, [{ id: 'w1', days: ['friday'], start: '17:00', end: '20:00', extraMin: 10 }], PERSON);
    await tickBusySchedule(FRI(17, 1));
    expect((await prepFor(LOC)).isBusy).toBe(true);
    await savePrep(LOC, { isBusy: false }, PERSON);
    await tickBusySchedule(FRI(18, 0));
    expect((await prepFor(LOC)).isBusy).toBe(false); // not turned back on in the same window
    const end = await tickBusySchedule(FRI(20, 5));
    expect(end.kept).toEqual([LOC]);
    expect((await getPrepSettings())[LOC]).toMatchObject({ isBusy: false, changedBy: 'Mona', busy: 25 });
  });

  it('busy already on at the start: left alone, and not turned off at the end', async () => {
    await savePrep(LOC, { isBusy: true }, PERSON);
    await saveBusySchedule(LOC, [{ id: 'w1', days: ['friday'], start: '17:00', end: '20:00', extraMin: 10 }], PERSON);
    expect((await tickBusySchedule(FRI(17, 0))).started).toEqual([]);
    expect((await getBusyState())[LOC]).toMatchObject({ applied: false });
    await tickBusySchedule(FRI(20, 1));
    expect((await prepFor(LOC)).isBusy).toBe(true);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('a window across midnight (Saturday 22:00–02:00) is active on Sunday 01:00 and ends at 02:00', async () => {
    const w = [{ id: 'night', days: ['saturday' as const], start: '22:00', end: '02:00', extraMin: 15 }];
    expect(activeBusyWindow(w, at(2026, 10, 18, 1, 0), TZ)?.occurrence).toBe('night@2026-10-17');
    expect(activeBusyWindow(w, at(2026, 10, 18, 2, 0), TZ)).toBeNull();
    expect(activeBusyWindow(w, at(2026, 10, 17, 21, 59), TZ)).toBeNull();
    await saveBusySchedule(LOC, w, PERSON);
    await tickBusySchedule(at(2026, 10, 18, 1, 0));
    expect((await getPrepSettings())[LOC]).toMatchObject({ isBusy: true, busy: 30 });
    await tickBusySchedule(at(2026, 10, 18, 2, 1));
    expect((await prepFor(LOC)).isBusy).toBe(false);
  });

  it('a window removed while running ends cleanly; the tick never throws', async () => {
    await saveBusySchedule(LOC, [{ id: 'w1', days: ['friday'], start: '17:00', end: '20:00', extraMin: 10 }], PERSON);
    await tickBusySchedule(FRI(17, 0));
    await saveBusySchedule(LOC, [], PERSON);
    expect((await tickBusySchedule(FRI(17, 10))).ended).toEqual([LOC]);
    expect((await prepFor(LOC)).isBusy).toBe(false);
    const repo = getRepo();
    const spy = vi.spyOn(repo, 'getKv').mockRejectedValueOnce(new Error('db down'));
    await expect(tickBusySchedule(FRI(17, 20))).resolves.toBeDefined();
    spy.mockRestore();
  });
});
