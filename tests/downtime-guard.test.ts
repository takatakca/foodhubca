// Store availability center — "Garde tablette éteinte": off by default, acts only when every tablet of an open kitchen is
// off past the grace time, pauses only the chosen channels, never touches locked stores, resumes only its own pauses.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelAdapter, ChannelKey, ChannelResult, ChannelStore } from '../lib/foodhub/types';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ id: string; online: boolean; untilMs?: number; reason?: string }>,
  status: 'done' as ChannelResult['status'],
  statusById: {} as Record<string, ChannelResult['status']>,
}));
vi.mock('../lib/foodhub/adapters', async (orig) => {
  const real = await orig<typeof import('../lib/foodhub/adapters')>();
  const fake = (channel: ChannelKey): ChannelAdapter => ({
    ...real.ADAPTERS[channel],
    setStoreOnline: async (store: ChannelStore, online: boolean, untilMs?: number, reason?: string) => {
      h.calls.push({ id: store.id, online, untilMs, reason });
      const status = h.statusById[store.id] ?? h.status;
      return { channel, ok: status === 'done', status, message: status === 'blocked' ? 'Live connector off — not sent' : 'ok' };
    },
  });
  return { ...real, getAdapter: (key: string) => fake(key as ChannelKey) };
});

import { GUARD_REASON } from '../lib/foodhub/store-availability/common';
import { DEFAULT_GUARD, getGuardConfigs, getGuardState, saveGuardConfig, tickDowntimeGuard } from '../lib/foodhub/store-availability/downtime-guard';
import { statusHistory } from '../lib/foodhub/store-availability/history';
import { saveHours } from '../lib/foodhub/hours';
import { setStoresOnline } from '../lib/foodhub/ops';
import { getRepo } from '../lib/foodhub/repo';
import { localWallToUtcMs } from '../lib/foodhub/time';
import type { DayKey, PlatformStatus, WeeklyHours } from '../lib/foodhub/types';
import { FORBIDDEN_STORE_IDS } from '../lib/foodhub/public-directory';

/** The owner's never-touched DoorDash store, from the constant the code uses (never typed out here). */
const FORBIDDEN_ID = [...FORBIDDEN_STORE_IDS][0];

const TZ = 'America/Toronto';
const LOC = 'NDG_MAIN';
const DAYS: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const week = (open: string, close: string): WeeklyHours => Object.fromEntries(DAYS.map((d) => [d, [{ open, close }]])) as unknown as WeeklyHours;
const OPEN = localWallToUtcMs(2026, 10, 16, 18, 0, TZ); // Friday 18:00
const CLOSED = localWallToUtcMs(2026, 10, 16, 10, 0, TZ);
const MIN = 60_000;
const PERSON = { username: 'mona', name: 'Mona', source: 'dashboard' as const };
const ids: Record<string, string> = {};

async function store(key: string, brandName: string, channel: ChannelKey, channelStoreId: string, meta: Record<string, unknown> = {}) {
  const s = await getRepo().upsertStore({ channel, channelStoreId, brandName, locationCode: LOC, autoAccept: true, online: true, pausedUntil: null, meta });
  ids[key] = s.id;
}
async function tablet(lastSeenMs: number | null, id = 'd1') {
  await getRepo().putDocs('devices', [{ id, key: LOC, at: 'x', data: { id, name: id, locationCode: LOC, enrolledBy: 'x', enrolledAt: new Date(OPEN - 86400_000).toISOString(), lastSeenAt: lastSeenMs ? new Date(lastSeenMs).toISOString() : null } }]);
}
const get = async (key: string) => (await getRepo().getStore(ids[key]))!;
const detail = async (key: string) => ((await get(key)).meta.platformStatus as PlatformStatus | undefined)?.detail;
const on = (cfg: Partial<typeof DEFAULT_GUARD> = {}) => saveGuardConfig(LOC, { ...DEFAULT_GUARD, enabled: true, ...cfg }, PERSON);

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.FOODHUB_TIMEZONE = TZ;
  (globalThis as any).__foodhubMem = undefined;
  h.calls.length = 0;
  h.status = 'done';
  h.statusById = {};
  await saveHours({ locations: { [LOC]: week('16:00', '03:00') }, brands: {}, holidays: [] });
  await store('alphaUber', 'Alpha', 'uber_eats', 'ue-1');
  await store('forbidden', 'Alpha', 'doordash', FORBIDDEN_ID);
  await store('forbiddenByNumber', 'Alpha', 'doordash', 'msid-1', { platformStoreId: FORBIDDEN_ID });
  await store('dnt', 'Alpha', 'skip', 'sk-1', { doNotTouch: true });
  await store('betaSkip', 'Beta', 'skip', 'sk-2');
  await store('betaTgtg', 'Beta', 'tgtg', 'tg-1');
  await store('relay', 'Beta', 'doordash', 'relay:abc');
});

describe('tablet-off guard', () => {
  it('is OFF by default: nothing happens', async () => {
    expect(await getGuardConfigs()).toEqual({});
    await tablet(OPEN - 60 * MIN);
    const r = await tickDowntimeGuard(OPEN);
    expect(r.paused).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it('outside the opening hours, without tablets or without hours: nothing', async () => {
    await on();
    await tickDowntimeGuard(OPEN); // no tablet enrolled
    expect(h.calls).toEqual([]);
    await tablet(CLOSED - 60 * MIN);
    await tickDowntimeGuard(CLOSED);
    expect(h.calls).toEqual([]);
    await saveHours({ locations: {}, brands: {}, holidays: [] });
    await tickDowntimeGuard(OPEN);
    expect(h.calls).toEqual([]);
  });

  it('respects the grace time, pauses only the chosen channels, never a locked, forbidden or relay store', async () => {
    await on({ graceMin: 5, pauseMin: 30, channels: ['uber_eats', 'doordash', 'skip'] });
    await tablet(OPEN - 3 * MIN);
    await tickDowntimeGuard(OPEN);
    expect(h.calls).toEqual([]); // off for 3 min < 5
    await tablet(OPEN - 6 * MIN);
    const r = await tickDowntimeGuard(OPEN);
    expect(r.paused.sort()).toEqual([ids.alphaUber, ids.betaSkip].sort());
    expect(h.calls.map((c) => c.id).sort()).toEqual([ids.alphaUber, ids.betaSkip].sort());
    expect(h.calls.every((c) => !c.online && c.untilMs === OPEN + 30 * MIN && c.reason === GUARD_REASON)).toBe(true);
    for (const k of ['forbidden', 'forbiddenByNumber', 'dnt', 'relay', 'betaTgtg']) expect((await get(k)).online).toBe(true);
    expect(await detail('alphaUber')).toBe(GUARD_REASON);
    expect((await get('alphaUber')).pausedUntil).toBe(new Date(OPEN + 30 * MIN).toISOString());
    expect((await getGuardState())[LOC]).toMatchObject({ storeIds: expect.arrayContaining([ids.alphaUber, ids.betaSkip]) });
  });

  it('re-extends every pauseMin/2 while the tablets stay off', async () => {
    await on({ pauseMin: 30, channels: ['uber_eats'] });
    await tablet(OPEN - 10 * MIN);
    await tickDowntimeGuard(OPEN);
    expect(h.calls.length).toBe(1);
    await tickDowntimeGuard(OPEN + 10 * MIN);
    expect(h.calls.length).toBe(1); // < 15 min
    const r = await tickDowntimeGuard(OPEN + 16 * MIN);
    expect(r.extended).toEqual([ids.alphaUber]);
    expect(h.calls[1]).toMatchObject({ id: ids.alphaUber, online: false, untilMs: OPEN + 46 * MIN });
  });

  it('when a tablet is back it resumes only what it paused; a person’s re-pause is kept', async () => {
    await on({ channels: ['uber_eats', 'skip'] });
    await tablet(OPEN - 10 * MIN);
    await tickDowntimeGuard(OPEN);
    // Meanwhile a person pauses Beta's Skip store for their own reason: theirs now.
    await setStoresOnline([ids.betaSkip], false, { reason: 'Kitchen too busy', actor: PERSON });
    // A store the guard never paused, paused by a person: never resumed by the guard.
    await setStoresOnline([ids.betaTgtg], false, { reason: 'Closed', actor: PERSON });
    h.calls.length = 0;
    await tablet(OPEN + 5 * MIN);
    const r = await tickDowntimeGuard(OPEN + 5 * MIN + 1000);
    expect(r.resumed).toEqual([ids.alphaUber]);
    expect(h.calls.map((c) => [c.id, c.online])).toEqual([[ids.alphaUber, true]]);
    expect((await get('alphaUber')).online).toBe(true);
    expect((await get('betaSkip')).online).toBe(false);
    expect(await detail('betaSkip')).toBe('Kitchen too busy');
    expect((await get('betaTgtg')).online).toBe(false);
    expect((await getGuardState())[LOC]).toBeUndefined();
  });

  it('switching the guard off gives back what it paused', async () => {
    await on({ channels: ['uber_eats'] });
    await tablet(OPEN - 10 * MIN);
    await tickDowntimeGuard(OPEN);
    await saveGuardConfig(LOC, { ...DEFAULT_GUARD, enabled: false }, PERSON);
    const r = await tickDowntimeGuard(OPEN + MIN);
    expect(r.resumed).toEqual([ids.alphaUber]);
  });

  it('blocked results (live connector off) are not counted as paused and are logged as not sent', async () => {
    h.status = 'blocked';
    await on({ pauseMin: 30, channels: ['uber_eats'] });
    await tablet(OPEN - 10 * MIN);
    const r = await tickDowntimeGuard(OPEN);
    expect(r.paused).toEqual([]);
    expect(r.blocked).toBe(1);
    expect((await get('alphaUber')).online).toBe(true);
    expect((await getGuardState())[LOC]).toMatchObject({ storeIds: [], blocked: 1 });
    const log = await getRepo().listActivity({ kinds: ['device'] });
    expect(log.some((a) => a.action === 'guard_blocked' && a.detail?.notSent === true)).toBe(true);
    const history = await statusHistory({ locationCode: LOC });
    expect(history.find((x) => x.event === 'guard_pause')).toMatchObject({ result: 'blocked', by: 'Garde tablette' });
    // No retry on every tick; a retry after pauseMin/2.
    await tickDowntimeGuard(OPEN + 5 * MIN);
    expect(h.calls.length).toBe(1);
    h.status = 'done';
    const retry = await tickDowntimeGuard(OPEN + 16 * MIN);
    expect(retry.paused).toEqual([ids.alphaUber]);
    expect((await getGuardState())[LOC]).toMatchObject({ storeIds: [ids.alphaUber], blocked: 0 });
  });

  it('counts the grace time from the opening, not from a tablet switched off overnight', async () => {
    await on({ graceMin: 5, channels: ['uber_eats'] });
    const opening = localWallToUtcMs(2026, 10, 16, 16, 0, TZ); // Friday 16:00, the kitchen opens
    await tablet(localWallToUtcMs(2026, 10, 16, 3, 5, TZ)); // last seen at 03:05, after closing
    expect((await tickDowntimeGuard(opening)).paused).toEqual([]);
    expect((await tickDowntimeGuard(opening + 4 * MIN)).paused).toEqual([]);
    expect(h.calls).toEqual([]);
    const r = await tickDowntimeGuard(opening + 6 * MIN);
    expect(r.paused).toEqual([ids.alphaUber]);
  });

  it('a pause that failed on the platform (not blocked) is tried again after pauseMin/2', async () => {
    h.status = 'error';
    await on({ pauseMin: 30, channels: ['uber_eats'] });
    await tablet(OPEN - 10 * MIN);
    const r = await tickDowntimeGuard(OPEN);
    expect(r.paused).toEqual([]);
    expect((await getGuardState())[LOC]).toMatchObject({ storeIds: [], failed: 1 });
    expect((await getRepo().listActivity({ kinds: ['device'] })).some((a) => a.action === 'guard_blocked')).toBe(true);
    await tickDowntimeGuard(OPEN + 5 * MIN);
    expect(h.calls.length).toBe(1);
    h.status = 'done';
    const retry = await tickDowntimeGuard(OPEN + 16 * MIN);
    expect(retry.paused).toEqual([ids.alphaUber]);
    expect((await get('alphaUber')).online).toBe(false);
    expect((await getGuardState())[LOC]).toMatchObject({ storeIds: [ids.alphaUber], blocked: 0, failed: 0 });
  });

  it('pauses only the brands open right now, not a closed brand of the same kitchen', async () => {
    await saveHours({ locations: { [LOC]: week('16:00', '03:00') }, brands: { Beta: week('11:00', '14:00') }, holidays: [] });
    await on({ channels: ['uber_eats', 'skip', 'tgtg'] });
    await tablet(OPEN - 10 * MIN);
    const r = await tickDowntimeGuard(OPEN);
    expect(r.paused).toEqual([ids.alphaUber]);
    expect(h.calls.map((c) => c.id)).toEqual([ids.alphaUber]);
    expect((await get('betaSkip')).online).toBe(true);
  });

  it('with nothing of its own (empty storeIds) it never re-extends or resumes the whole kitchen', async () => {
    await on({ channels: ['uber_eats'] });
    await tablet(OPEN - 10 * MIN);
    // Someone else paused Beta's Skip store with the guard's reason text; the guard paused nothing itself.
    await setStoresOnline([ids.betaSkip], false, { reason: GUARD_REASON, actor: PERSON });
    // The guard already tried Alpha's Uber store in this episode (a person resumed it since): not targeted again.
    await getRepo().setKv('downtime_guard_state_v1', { [LOC]: { storeIds: [], attemptedIds: [ids.alphaUber], pendingIds: [], pausedAt:new Date(OPEN).toISOString(), extendedAt: new Date(OPEN).toISOString(), untilMs: OPEN + 30 * MIN, blocked: 0 } });
    h.calls.length = 0;
    const r = await tickDowntimeGuard(OPEN + 16 * MIN);
    expect(r.extended).toEqual([]);
    expect(h.calls).toEqual([]);
    await tablet(OPEN + 17 * MIN);
    const back = await tickDowntimeGuard(OPEN + 17 * MIN + 1000);
    expect(back.resumed).toEqual([]);
    expect((await get('betaSkip')).online).toBe(false);
  });

  it('a store a person resumed stays online while another store of the kitchen keeps being blocked', async () => {
    await on({ pauseMin: 30, channels: ['uber_eats', 'skip'] });
    await tablet(OPEN - 10 * MIN);
    // Uber takes the pause, Skip is blocked (live switch off): a lasting condition.
    h.statusById[ids.betaSkip] = 'blocked';
    const first = await tickDowntimeGuard(OPEN);
    expect(first.paused).toEqual([ids.alphaUber]);
    expect((await getGuardState())[LOC]).toMatchObject({ storeIds: [ids.alphaUber], pendingIds: [ids.betaSkip] });
    // A person resumes Uber by hand.
    await setStoresOnline([ids.alphaUber], true, { actor: PERSON });
    expect((await get('alphaUber')).online).toBe(true);
    h.calls.length = 0;
    await tickDowntimeGuard(OPEN + 16 * MIN);
    await tickDowntimeGuard(OPEN + 32 * MIN);
    // Only Skip is tried again (once per pauseMin/2); Uber is never paused again in this episode.
    expect(h.calls.map((c) => c.id)).toEqual([ids.betaSkip, ids.betaSkip]);
    expect((await get('alphaUber')).online).toBe(true);
    expect(await detail('alphaUber')).not.toBe(GUARD_REASON);
    expect((await getGuardState())[LOC]).toMatchObject({ storeIds: [], pendingIds: [ids.betaSkip], blocked: 1 });
  });

  it('a brand that opens during an episode is paused once its own grace time is over', async () => {
    // Alpha open from 16:00 (kitchen hours), Beta only from 19:00.
    await saveHours({ locations: { [LOC]: week('16:00', '03:00') }, brands: { Beta: week('19:00', '23:00') }, holidays: [] });
    await on({ graceMin: 5, pauseMin: 30, channels: ['uber_eats', 'skip'] });
    await tablet(OPEN - 10 * MIN);
    expect((await tickDowntimeGuard(OPEN)).paused).toEqual([ids.alphaUber]);
    const beta = localWallToUtcMs(2026, 10, 16, 19, 0, TZ);
    expect((await tickDowntimeGuard(beta + 2 * MIN)).paused).toEqual([]); // Beta's grace time not over yet
    expect((await get('betaSkip')).online).toBe(true);
    const r = await tickDowntimeGuard(beta + 6 * MIN);
    expect(r.paused).toEqual([ids.betaSkip]);
    expect(await detail('betaSkip')).toBe(GUARD_REASON);
    expect((await getGuardState())[LOC].storeIds.sort()).toEqual([ids.alphaUber, ids.betaSkip].sort());
    // Back: both resumed (both are the guard's own pauses).
    await tablet(beta + 7 * MIN);
    expect((await tickDowntimeGuard(beta + 7 * MIN + 1000)).resumed.sort()).toEqual([ids.alphaUber, ids.betaSkip].sort());
  });

  it('never pauses a DoorDash store locked through FOODHUB_MENU_LOCKED_STORES or Stores → Mapping', async () => {
    const before = process.env.FOODHUB_MENU_LOCKED_STORES;
    process.env.FOODHUB_MENU_LOCKED_STORES = 'doordash:dd-env';
    try {
      await store('envLocked', 'Alpha', 'doordash', 'dd-env');
      await store('mapLocked', 'Alpha', 'doordash', 'dd-map', { menuLocked: true });
      await store('free', 'Alpha', 'doordash', 'dd-free');
      await on({ channels: ['doordash'] });
      await tablet(OPEN - 10 * MIN);
      const r = await tickDowntimeGuard(OPEN);
      expect(r.paused).toEqual([ids.free]);
      expect((await get('envLocked')).online).toBe(true);
      expect((await get('mapLocked')).online).toBe(true);
    } finally {
      if (before === undefined) delete process.env.FOODHUB_MENU_LOCKED_STORES; else process.env.FOODHUB_MENU_LOCKED_STORES = before;
    }
  });

  it('validates its settings', async () => {
    await expect(saveGuardConfig(LOC, { enabled: true, graceMin: 1 }, PERSON)).rejects.toThrow();
    await expect(saveGuardConfig(LOC, { enabled: true, pauseMin: 500 }, PERSON)).rejects.toThrow();
    await expect(saveGuardConfig(LOC, { enabled: true, channels: ['fax'] }, PERSON)).rejects.toThrow();
    expect(await saveGuardConfig(LOC, { enabled: true }, PERSON)).toEqual({ ...DEFAULT_GUARD, enabled: true });
  });
});
