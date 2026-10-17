// Store availability center — the "Statut maintenant" board: states, who paused, reopens-at, Clover row, locked stores.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { availabilityBoard } from '../lib/foodhub/store-availability/board';
import { GUARD_REASON } from '../lib/foodhub/store-availability/common';
import { saveHours } from '../lib/foodhub/hours';
import { HOLIDAY_REASON } from '../lib/foodhub/ops';
import { getRepo } from '../lib/foodhub/repo';
import { localWallToUtcMs } from '../lib/foodhub/time';
import type { ChannelKey, ChannelStore, DayKey, PlatformStatus, WeeklyHours } from '../lib/foodhub/types';
import { FORBIDDEN_STORE_IDS } from '../lib/foodhub/public-directory';

/** The owner's never-touched DoorDash store, from the constant the code uses (never typed out here). */
const FORBIDDEN_ID = [...FORBIDDEN_STORE_IDS][0];

const TZ = 'America/Toronto';
const DAYS: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const week = (open: string, close: string): WeeklyHours => Object.fromEntries(DAYS.map((d) => [d, [{ open, close }]])) as unknown as WeeklyHours;
const at = (y: number, m: number, d: number, h: number, min = 0) => localWallToUtcMs(y, m, d, h, min, TZ);
const LOC = 'NDG_MAIN';
const OPEN = at(2026, 10, 16, 18, 0); // Friday 18:00, NDG open 16:00–03:00
const CLOSED = at(2026, 10, 16, 10, 0); // Friday 10:00
const ENV = ['FOODHUB_CLOVER_WEBSITE_ORDERS', 'FOODHUB_CLOVER_WEBSITE_BRAND', 'FOODHUB_CLOVER_WEBSITE_LOCATION'];
const saved: Record<string, string | undefined> = {};

async function store(brandName: string, channel: ChannelKey, channelStoreId: string, extra: Partial<ChannelStore> = {}, ps?: Partial<PlatformStatus>) {
  return getRepo().upsertStore({
    channel, channelStoreId, brandName, locationCode: LOC, autoAccept: true, online: extra.online ?? true, pausedUntil: extra.pausedUntil ?? null,
    meta: { ...(extra.meta ?? {}), ...(ps ? { platformStatus: { checkedAt: new Date().toISOString(), source: 'dashboard', state: 'online', ...ps } } : {}) },
  });
}
const rowsOf = async (now: number) => (await availabilityBoard({ locationCodes: [LOC] }, now)).kitchens[0];

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.FOODHUB_TIMEZONE = TZ;
  (globalThis as any).__foodhubMem = undefined;
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  await saveHours({ locations: { [LOC]: week('16:00', '03:00') }, brands: {}, holidays: [] });
});
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('availability board', () => {
  it('states, who paused, and when it reopens', async () => {
    process.env.FOODHUB_CLOVER_WEBSITE_ORDERS = 'off';
    const until = new Date(OPEN + 30 * 60_000).toISOString();
    const online = await store('Alpha', 'uber_eats', 'ue-1', {}, { state: 'online' });
    const mine = await store('Alpha', 'doordash', 'dd-1', { online: false, pausedUntil: until }, { state: 'paused', source: 'dashboard', detail: 'Kitchen too busy', until });
    const platform = await store('Alpha', 'skip', 'sk-1', { online: false }, { state: 'paused', source: 'sync', detail: 'OUT_OF_STOCK' });
    const guard = await store('Beta', 'uber_eats', 'ue-2', { online: false, pausedUntil: until }, { state: 'paused', source: 'dashboard', detail: GUARD_REASON });
    const holiday = await store('Beta', 'skip', 'sk-2', { online: false }, { state: 'paused', source: 'dashboard', detail: HOLIDAY_REASON });
    await store('Beta', 'doordash', 'relay:abc'); // relay stores only receive orders: never shown
    const k = await rowsOf(OPEN);
    const row = (id: string) => k.brands.flatMap((b) => b.channels).find((c) => c.storeId === id)!;
    expect(row(online.id)).toMatchObject({ state: 'online', by: null, reopensAt: null });
    expect(row(mine.id)).toMatchObject({ state: 'paused', by: 'TAKATAK', pausedUntil: until, reopensAt: until, detail: 'Kitchen too busy' });
    expect(row(platform.id)).toMatchObject({ state: 'paused', by: 'plateforme', reopensAt: null });
    expect(row(guard.id)).toMatchObject({ by: 'garde', reopensAt: until });
    expect(row(holiday.id)).toMatchObject({ by: 'horaire' });
    expect(k.brands.flatMap((b) => b.channels).some((c) => c.channel === 'doordash' && c.storeId && !c.locked && c.state === 'online' && c.storeId !== online.id)).toBe(false);
    expect(k.brands.map((b) => b.channels.length)).toEqual([3, 2]);
    expect(k.summary).toMatchObject({ kind: 'paused', count: 4, label: { fr: '4 en pause', en: '4 paused' } });
  });

  it('outside the hours: closed by the hours, reopens at the next opening (after midnight too)', async () => {
    process.env.FOODHUB_CLOVER_WEBSITE_ORDERS = 'off';
    const s = await store('Alpha', 'uber_eats', 'ue-1', {}, { state: 'online' });
    const k = await rowsOf(CLOSED);
    expect(k.brands[0].channels[0]).toMatchObject({ storeId: s.id, state: 'closed', by: 'horaire', reopensAt: new Date(at(2026, 10, 16, 16, 0)).toISOString() });
    expect(k.summary).toMatchObject({ kind: 'closed', label: { fr: 'Fermé (heures)', en: 'Closed (hours)' } });
    expect(k.nextOpening.label.fr).toBe('Ouvre aujourd’hui à 16 h');
    const late = await rowsOf(at(2026, 10, 17, 2, 0)); // Saturday 02:00: still Friday night
    expect(late.brands[0].channels[0].state).toBe('online');
    expect(late.nextOpening.label).toEqual({ fr: 'Ferme à 3 h', en: 'Closes at 3 am' });
  });

  it('a pause ending while closed reopens at the next opening', async () => {
    process.env.FOODHUB_CLOVER_WEBSITE_ORDERS = 'off';
    const until = new Date(at(2026, 10, 17, 5, 0)).toISOString(); // Saturday 05:00 — closed then
    await store('Alpha', 'doordash', 'dd-1', { online: false, pausedUntil: until }, { state: 'paused', source: 'dashboard', until });
    const k = await rowsOf(at(2026, 10, 17, 1, 0));
    expect(k.brands[0].channels[0].reopensAt).toBe(new Date(at(2026, 10, 17, 16, 0)).toISOString());
  });

  it('all open, tablets counted, prep shown', async () => {
    process.env.FOODHUB_CLOVER_WEBSITE_ORDERS = 'off';
    await store('Alpha', 'uber_eats', 'ue-1', {}, { state: 'online' });
    const now = OPEN;
    await getRepo().putDocs('devices', [
      { id: 'd1', key: LOC, at: 'x', data: { id: 'd1', name: 'Tab 1', locationCode: LOC, enrolledBy: 'x', enrolledAt: new Date(now - 86400_000).toISOString(), lastSeenAt: new Date(now - 10_000).toISOString() } },
      { id: 'd2', key: LOC, at: 'x', data: { id: 'd2', name: 'Tab 2', locationCode: LOC, enrolledBy: 'x', enrolledAt: new Date(now - 86400_000).toISOString(), lastSeenAt: new Date(now - 3600_000).toISOString() } },
      { id: 'd3', key: LOC, at: 'x', data: { id: 'd3', name: 'Old', locationCode: LOC, enrolledBy: 'x', enrolledAt: new Date(now - 86400_000).toISOString(), revoked: true } },
    ]);
    const k = await rowsOf(now);
    expect(k.summary).toMatchObject({ kind: 'open', label: { fr: 'Tout ouvert', en: 'All open' } });
    expect(k.devices).toMatchObject({ online: 1, total: 2 });
    expect(k.prep).toMatchObject({ normal: 15, isBusy: false });
  });

  it('locked stores: "do not touch" and the forbidden DoorDash store', async () => {
    process.env.FOODHUB_CLOVER_WEBSITE_ORDERS = 'off';
    const dnt = await store('Alpha', 'uber_eats', 'ue-1', { meta: { doNotTouch: true } }, { state: 'online' });
    const forbidden = await store('Alpha', 'doordash', FORBIDDEN_ID, {}, { state: 'online' });
    const byNumber = await store('Beta', 'doordash', 'msid-9', { meta: { platformStoreId: FORBIDDEN_ID } }, { state: 'online' });
    const free = await store('Beta', 'uber_eats', 'ue-2', {}, { state: 'online' });
    const rows = (await rowsOf(OPEN)).brands.flatMap((b) => b.channels);
    const locked = (id: string) => rows.find((r) => r.storeId === id)!.locked;
    expect([locked(dnt.id), locked(forbidden.id), locked(byNumber.id), locked(free.id)]).toEqual([true, true, true, false]);
  });

  it('Clover Online Ordering row: only for the website brand, only when website orders are on, no Clover call', async () => {
    await store('Alpha', 'uber_eats', 'ue-1', {}, { state: 'online' });
    await store('Beta', 'uber_eats', 'ue-2', {}, { state: 'online' });
    process.env.FOODHUB_CLOVER_WEBSITE_BRAND = 'Beta';
    let k = await rowsOf(OPEN);
    const clover = (name: string) => k.brands.find((b) => b.name === name)!.channels.find((c) => c.channel === 'clover_online');
    expect(clover('Alpha')).toBeUndefined();
    expect(clover('Beta')).toMatchObject({ state: 'manuel', storeId: null, text: { fr: 'Mettez aussi en pause dans Clover', en: 'Also pause it in Clover' } });
    process.env.FOODHUB_CLOVER_WEBSITE_ORDERS = 'off';
    k = await rowsOf(OPEN);
    expect(clover('Beta')).toBeUndefined();
    // Not pinned: a kitchen with only one brand.
    delete process.env.FOODHUB_CLOVER_WEBSITE_ORDERS;
    delete process.env.FOODHUB_CLOVER_WEBSITE_BRAND;
    k = await rowsOf(OPEN);
    expect(clover('Alpha')).toBeUndefined();
    // The clover row never counts as paused.
    expect(k.summary.kind).toBe('open');
  });

  it('scope and brand filters', async () => {
    process.env.FOODHUB_CLOVER_WEBSITE_ORDERS = 'off';
    await store('Alpha', 'uber_eats', 'ue-1', {}, { state: 'online' });
    await store('Beta', 'uber_eats', 'ue-2', {}, { state: 'online' });
    const b = await availabilityBoard({ locationCodes: [LOC], brandNames: ['Beta'] }, OPEN);
    expect(b.kitchens.map((k) => k.code)).toEqual([LOC]);
    expect(b.kitchens[0].brands.map((x) => x.name)).toEqual(['Beta']);
    expect((await availabilityBoard({ locationCodes: ['__none__'] }, OPEN)).kitchens).toEqual([]);
  });
});
