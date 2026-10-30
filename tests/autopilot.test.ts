// Settings → Autopilot (MASTER_PLAN Phase 4.1 + 4.2): every automation listed with its switch, rule, last run and what
// it did; the three new automations are OFF by default, persist their switch in the repo kv, log every action as
// "Autopilot", and never touch a protected store (Po Poulet NDG, a locked menu, "Do not touch").
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelAdapter, ChannelKey, ChannelResult, ChannelStore, FoodHubUser, MasterMenu } from '../lib/foodhub/types';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ what: 'publish' | 'item' | 'store'; id: string; online?: boolean; available?: boolean }>,
  /** Statuses to answer, per "what:storeId", in order; then `def`. */
  queue: {} as Record<string, ChannelResult['status'][]>,
  def: 'done' as ChannelResult['status'],
  reportOk: false,
}));
const answer = (channel: ChannelKey, status: ChannelResult['status']): ChannelResult =>
  ({ channel, ok: status === 'done' || status === 'queued', status, message: status === 'error' ? 'HTTP 500 refused by the platform' : status === 'blocked' ? 'Live connector off — not sent' : 'ok' });
const next = (key: string) => (h.queue[key]?.length ? h.queue[key].shift()! : h.def);

vi.mock('../lib/foodhub/adapters', async (orig) => {
  const real = await orig<typeof import('../lib/foodhub/adapters')>();
  const fake = (channel: ChannelKey): ChannelAdapter => ({
    ...real.ADAPTERS[channel],
    publishMenu: async (store: ChannelStore) => { h.calls.push({ what: 'publish', id: store.id }); return answer(channel, next(`publish:${store.id}`)); },
    setItemAvailability: async (store: ChannelStore, _refs: string[], available: boolean) => { h.calls.push({ what: 'item', id: store.id, available }); return answer(channel, next(`item:${store.id}`)); },
    setStoreOnline: async (store: ChannelStore, online: boolean) => { h.calls.push({ what: 'store', id: store.id, online }); return answer(channel, next(`store:${store.id}`)); },
  });
  return { ...real, getAdapter: (key: string) => fake(key as ChannelKey) };
});
vi.mock('../lib/foodhub/adapters/uber-eats', async (orig) => {
  const real = await orig<typeof import('../lib/foodhub/adapters/uber-eats')>();
  return { ...real, requestUberReport: async (...args: Parameters<typeof real.requestUberReport>) => (h.reportOk ? { ok: true, workflowId: `wf-${args[1]}`, message: 'Report requested' } : real.requestUberReport(...args)) };
});

import { AUTOPILOT_ACTOR, logActivity } from '../lib/foodhub/activity';
import { hashPassword } from '../lib/foodhub/auth';
import { afterCloverPriceUsed, afterHoursSaved, listAutomations, runAutopilot, setSwitch } from '../lib/foodhub/autopilot';
import { brandsAffectedByHours, cancelRepublish, pendingRepublishes, REPUBLISH_KEY } from '../lib/foodhub/autopilot/republish';
import { getChains, retryIncidentDetections, RETRY_KEY, stopRetry } from '../lib/foodhub/autopilot/retry';
import { AUTOPILOT_RUNS_KEY, getRuns } from '../lib/foodhub/autopilot/runs';
import { AUTOPILOT_SWITCHES_KEY, getSwitches, isSwitchOn } from '../lib/foodhub/autopilot/switches';
import { tickUberWeekly, uberWeekWindow, UBER_WEEKLY_KEY } from '../lib/foodhub/autopilot/uber-weekly';
import { getHours } from '../lib/foodhub/hours';
import { listScheduled, runDuePublishes } from '../lib/foodhub/menu/schedule';
import { offRefsAt, publishMenu, setItemAvailability, setStoresOnline } from '../lib/foodhub/ops';
import { FORBIDDEN_STORE_IDS } from '../lib/foodhub/public-directory';
import { getRepo } from '../lib/foodhub/repo';
import { GUARD_REASON } from '../lib/foodhub/store-availability/common';
import { localWallToUtcMs } from '../lib/foodhub/time';
import { listIncidents, runWatch } from '../lib/foodhub/watch/engine';
import { translator } from '../lib/i18n';
import { AutopilotList } from '../components/settings/autopilot-list';
import { GET as apGet, POST as apPost, PUT as apPut } from '../app/api/foodhub/autopilot/route';

/** The owner's never-touched DoorDash store, from the constant the code uses (never typed out here). */
const FORBIDDEN_ID = [...FORBIDDEN_STORE_IDS][0];
const TZ = 'America/Toronto';
const LOC = 'NDG_MAIN';
const MIN = 60_000;
const PERSON = { username: 'mona', name: 'Mona', source: 'dashboard' as const };
const OWNER_PASS = 'owner-pass-autopilot-1';
const ids: Record<string, string> = {};

const menuOf = (brandName: string): MasterMenu => ({
  brandName,
  categories: [{ ref: 'c1', name: 'Plats', sortOrder: 0 }],
  items: [{ ref: 'i1', name: 'Poutine', price: 12.5, categoryRef: 'c1', available: true, modifierGroupRefs: [] }, { ref: 'i2', name: 'Frites', price: 5, categoryRef: 'c1', available: true, modifierGroupRefs: [] }],
  modifierGroups: [],
  updatedAt: new Date().toISOString(),
});

async function store(key: string, brandName: string, channel: ChannelKey, channelStoreId: string, meta: Record<string, unknown> = {}) {
  const s = await getRepo().upsertStore({ channel, channelStoreId, brandName, locationCode: LOC, autoAccept: true, online: true, pausedUntil: null, meta });
  ids[key] = s.id;
}
const autopilotLog = async () => (await getRepo().listActivity({ limit: 500 })).filter((e) => e.actor === 'Autopilot');
const pause = () => new Promise((r) => setTimeout(r, 5));
const sendsTo = (id: string) => h.calls.filter((c) => c.id === id);

let ip = 0;
function req(path: string, who: string, init: { method?: string; json?: unknown } = {}): Request {
  ip += 1;
  return new Request(`https://hub.test${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.7.0.${ip % 250}`, authorization: `Basic ${Buffer.from(who).toString('base64')}` },
    ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
  });
}
const OWNER = `owner:${OWNER_PASS}`;
const MANAGER = 'max:manager-pass-1';
const LOCAL_MANAGER = 'lea:manager-pass-2';
const OPERATOR = 'leo:operator-pass-1';

let envBefore: string | undefined;
beforeAll(() => { envBefore = process.env.DASHBOARD_PASSWORD; process.env.DASHBOARD_PASSWORD = OWNER_PASS; });
afterAll(() => { if (envBefore === undefined) delete process.env.DASHBOARD_PASSWORD; else process.env.DASHBOARD_PASSWORD = envBefore; });

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.FOODHUB_TIMEZONE = TZ;
  delete process.env.FOODHUB_MENU_LOCKED_STORES;
  (globalThis as any).__foodhubMem = undefined;
  (globalThis as any).__foodhubAutopilotTick = false;
  h.calls.length = 0; h.queue = {}; h.def = 'done'; h.reportOk = false;
  const repo = getRepo();
  await repo.saveMenu(menuOf('Alpha'));
  await repo.saveMenu(menuOf('Beta'));
  await store('alphaUber', 'Alpha', 'uber_eats', 'ue-alpha');
  await store('alphaSkip', 'Alpha', 'skip', 'sk-alpha');
  await store('alphaForbidden', 'Alpha', 'doordash', FORBIDDEN_ID);
  await store('alphaDnt', 'Alpha', 'doordash', 'dd-alpha', { doNotTouch: true });
  await store('betaForbidden', 'Beta', 'doordash', 'msid-beta', { platformStoreId: FORBIDDEN_ID });
  await store('betaLocked', 'Beta', 'uber_eats', 'ue-beta', { menuLocked: true });
  const user = (username: string, role: FoodHubUser['role'], password: string, locations: string[]) =>
    repo.saveUser({ username, name: username, role, locations, passwordHash: hashPassword(password), active: true, lastLoginAt: null } as unknown as FoodHubUser);
  await user('max', 'manager', 'manager-pass-1', []);
  await user('lea', 'manager', 'manager-pass-2', [LOC]);
  await user('leo', 'operator', 'operator-pass-1', [LOC]);
});

describe('switches', () => {
  it('every new automation is OFF by default and then does nothing at all', async () => {
    expect(await getSwitches()).toEqual({});
    // A refused publish exists: with the switch off nobody retries it.
    h.queue[`publish:${ids.alphaUber}`] = ['error'];
    await publishMenu('Alpha', { storeIds: [ids.alphaUber], actor: PERSON });
    h.calls.length = 0;
    expect(await runAutopilot({ now: Date.now() + 3 * MIN })).toEqual({ ran: false });
    expect(await runAutopilot({ now: localWallToUtcMs(2026, 10, 26, 7, 0, TZ) })).toEqual({ ran: false }); // a Monday morning
    expect(await afterCloverPriceUsed('Alpha', PERSON)).toEqual([]);
    const hours = await getHours();
    expect(await afterHoursSaved(hours, { ...hours, holidays: [{ id: 'x', date: '2026-12-25', name: 'Noël', closed: true, locationCodes: [] }] }, PERSON)).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(await listScheduled()).toEqual([]);
    for (const key of [RETRY_KEY, REPUBLISH_KEY, AUTOPILOT_SWITCHES_KEY, UBER_WEEKLY_KEY, AUTOPILOT_RUNS_KEY]) expect(await getRepo().getKv(key), key).toBeNull();
    expect(await autopilotLog()).toEqual([]);
  });

  it('a switch is kept in the repo kv: still on after a restart, and turning it off is kept too', async () => {
    await setSwitch('retry_failed_jobs', true, PERSON);
    expect(await getRepo().getKv<Record<string, { on: boolean }>>(AUTOPILOT_SWITCHES_KEY)).toMatchObject({ retry_failed_jobs: { on: true, by: 'Mona' } });
    vi.resetModules();
    const fresh = await import('../lib/foodhub/autopilot/switches');
    expect(await fresh.isSwitchOn('retry_failed_jobs')).toBe(true);
    expect(await fresh.isSwitchOn('republish_after_change')).toBe(false);
    await fresh.setSwitch('retry_failed_jobs', false, PERSON);
    vi.resetModules();
    const again = await import('../lib/foodhub/autopilot/switches');
    expect(await again.isSwitchOn('retry_failed_jobs')).toBe(false);
    const log = (await getRepo().listActivity({ limit: 50 })).filter((e) => e.action === 'autopilot_switch');
    expect(log.map((e) => [e.actor, e.detail?.on])).toEqual([['Mona', false], ['Mona', true]]);
  });

  it('the sync results of the existing automations are noted only when they did something', async () => {
    const zero = { reopened: 0, itemsReenabled: 0, scheduledPublishes: 0, autoCompleted: 0, holidayClosures: 0, recon: null, cloverInventory: { turnedOff: 0, turnedOn: 0, priceChanges: 0 } };
    expect(await runAutopilot({ sync: zero })).toEqual({ ran: false });
    expect(await getRepo().getKv(AUTOPILOT_RUNS_KEY)).toBeNull();
    await runAutopilot({ sync: { ...zero, autoCompleted: 2, recon: { opened: 1, closed: 0 } } });
    const runs = await getRuns();
    expect(runs.auto_close).toMatchObject({ status: 'success', en: 'Stale order(s) closed: 2' });
    expect(runs.daily_recon?.fr).toMatch(/1 ouvert/);
  });
});

describe('Settings → Autopilot API', () => {
  it('lists every automation; only a manager of every location or the owner can switch a new one', async () => {
    const list = await (await apGet(req('/api/foodhub/autopilot', OPERATOR), {})).json();
    expect(list.canEdit).toBe(false);
    expect(list.automations.map((a: { id: string }) => a.id)).toEqual(['republish_after_change', 'retry_failed_jobs', 'uber_weekly_report',
      'tablet_guard', 'clover_retry', 'timed_reopen', 'timed_86', 'scheduled_publish', 'auto_close', 'unmapped_hint', 'clover_inventory', 'holiday_closures', 'daily_recon']);
    const put = (who: string, json: unknown) => apPut(req('/api/foodhub/autopilot', who, { method: 'PUT', json }), {});
    expect((await put(OPERATOR, { id: 'retry_failed_jobs', on: true })).status).toBe(403);
    const local = await put(LOCAL_MANAGER, { id: 'retry_failed_jobs', on: true });
    expect(local.status).toBe(403);
    expect((await local.json()).errorFr).toMatch(/gérant de toutes les succursales/);
    expect((await put(MANAGER, { id: 'tablet_guard', on: true })).status).toBe(400); // switched in its own page
    expect((await put(MANAGER, { id: 'retry_failed_jobs', on: 'yes' })).status).toBe(400);
    expect((await put(MANAGER, { id: 'retry_failed_jobs', on: true })).status).toBe(200);
    expect((await put(OWNER, { id: 'uber_weekly_report', on: true })).status).toBe(200);
    expect(await isSwitchOn('retry_failed_jobs')).toBe(true);
    expect((await (await apGet(req('/api/foodhub/autopilot', MANAGER), {})).json()).canEdit).toBe(true);
    expect((await apPost(req('/api/foodhub/autopilot', OPERATOR, { method: 'POST', json: { action: 'stop_retry', id: 'x' } }), {})).status).toBe(403);
    expect((await apPost(req('/api/foodhub/autopilot', MANAGER, { method: 'POST', json: { action: 'stop_retry', id: 'x' } }), {})).status).toBe(409);
  });
});

describe('re-publish 10 min after a change', () => {
  beforeEach(async () => { await setSwitch('republish_after_change', true, PERSON); });

  it('“Use Clover price” schedules one publish 10 min later, as Autopilot, on the unprotected stores only', async () => {
    const t0 = Date.now();
    const out = await afterCloverPriceUsed('Alpha', PERSON);
    expect(out).toEqual([expect.objectContaining({ brand: 'Alpha', outcome: 'scheduled' })]);
    const [entry] = await listScheduled('Alpha');
    expect(entry).toMatchObject({ status: 'scheduled', by: 'autopilot', createdBy: 'Autopilot' });
    expect(entry.storeIds?.sort()).toEqual([ids.alphaUber, ids.alphaSkip].sort()); // never the forbidden or "Do not touch" store
    expect(Date.parse(entry.at) - t0).toBeGreaterThanOrEqual(10 * MIN - 1000);
    expect(Date.parse(entry.at) - t0).toBeLessThanOrEqual(10 * MIN + 5000);
    expect(await autopilotLog()).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'autopilot_republish_planned', source: 'automation', brandName: 'Alpha' })]));
    // It runs through the scheduled publishes, as Autopilot, and reaches only those two stores.
    expect(await runDuePublishes(Date.parse(entry.at) + 1000)).toBe(1);
    expect(h.calls.map((c) => c.id).sort()).toEqual([ids.alphaUber, ids.alphaSkip].sort());
    const publishes = (await getRepo().listActivity({ limit: 100 })).filter((e) => e.action === 'publish');
    expect(publishes.length).toBe(2);
    expect(publishes.every((e) => e.actor === 'Autopilot' && e.source === 'automation')).toBe(true);
    expect((await listScheduled('Alpha'))[0].status).toBe('done');
  });

  it('several changes give ONE publish, moved back each time (at most 30 min after the first)', async () => {
    const t0 = Date.now();
    await afterCloverPriceUsed('Alpha', PERSON);
    const first = (await listScheduled('Alpha'))[0];
    const hours = await getHours();
    const out = await afterHoursSaved(hours, { ...hours, locations: { ...hours.locations, [LOC]: { monday: [{ open: '11:00', close: '22:00' }] } as never } }, PERSON);
    expect(out.find((o) => o.brand === 'Alpha')).toMatchObject({ outcome: 'moved', scheduledId: first.id });
    const list = await listScheduled('Alpha');
    expect(list.length).toBe(1);
    expect(Date.parse(list[0].at)).toBeGreaterThanOrEqual(Date.parse(first.at));
    expect(Date.parse(list[0].at) - t0).toBeLessThanOrEqual(30 * MIN + 5000);
    expect((await autopilotLog()).some((e) => e.action === 'autopilot_republish_moved')).toBe(true);
  });

  it('never schedules a brand whose stores are all protected (Po Poulet NDG, a locked menu)', async () => {
    const out = await afterCloverPriceUsed('Beta', PERSON);
    expect(out).toEqual([{ brand: 'Beta', outcome: 'protected' }]);
    expect(await listScheduled('Beta')).toEqual([]);
    expect((await autopilotLog()).find((e) => e.action === 'autopilot_republish_skipped')?.summary).toMatch(/every one of its stores is protected/);
  });

  it('the hours diff names only the brands whose published hours changed', () => {
    const base = { locations: { [LOC]: { monday: [{ open: '11:00', close: '22:00' }] }, HOCHELAGA: { monday: [{ open: '11:00', close: '22:00' }] } }, brands: {}, holidays: [] } as never;
    const stores = [{ brandName: 'Alpha', locationCode: LOC }, { brandName: 'Gamma', locationCode: 'HOCHELAGA' }];
    const b = base as { locations: Record<string, unknown>; brands: Record<string, unknown>; holidays: unknown[] };
    expect(brandsAffectedByHours(base, base, stores)).toEqual([]);
    expect(brandsAffectedByHours(base, { ...b, locations: { ...b.locations, HOCHELAGA: { monday: [{ open: '12:00', close: '22:00' }] } } } as never, stores)).toEqual(['Gamma']);
    expect(brandsAffectedByHours(base, { ...b, brands: { Delta: { monday: [] } } } as never, stores)).toEqual(['Delta']);
    expect(brandsAffectedByHours(base, { ...b, holidays: [{ id: 'h', date: '2026-12-25', name: 'Noël', closed: true, locationCodes: [] }] } as never, stores)).toEqual(['Alpha', 'Gamma']);
    expect(brandsAffectedByHours(base, { ...b, holidays: [{ id: 'h', date: '2026-12-25', name: 'Noël', closed: true, locationCodes: [LOC] }] } as never, stores)).toEqual(['Alpha']);
  });

  it('can be cancelled (undo) until it starts; the page lists it while it waits', async () => {
    await afterCloverPriceUsed('Alpha', PERSON);
    const [p] = await pendingRepublishes();
    expect(p).toMatchObject({ brand: 'Alpha', reasons: ['clover_price'] });
    expect(await cancelRepublish(p.scheduledId, PERSON)).toBe(true);
    expect(await pendingRepublishes()).toEqual([]);
    expect((await listScheduled('Alpha'))[0].status).toBe('cancelled');
    expect(await runDuePublishes(Date.now() + 20 * MIN)).toBe(0);
    expect(h.calls).toEqual([]);
  });

  it('the hours route and the Clover price route both trigger it', async () => {
    const { PUT: hoursPut } = await import('../app/api/foodhub/hours/route');
    const res = await hoursPut(req('/api/foodhub/hours', OWNER, { method: 'PUT', json: { hours: { locations: { [LOC]: { monday: [{ open: '10:00', close: '23:00' }] } }, brands: {}, holidays: [] } } }), {});
    expect(res.status).toBe(200);
    expect((await pendingRepublishes()).map((p) => p.brand)).toEqual(['Alpha']);
    // "Use Clover price" on Beta (every store protected): answered, nothing scheduled for it.
    const { POST: pricePost } = await import('../app/api/foodhub/menu/clover-prices/route');
    await getRepo().setKv('clover_price_changes', { 'Beta|i1': { brandName: 'Beta', ref: 'i1', name: 'Poutine', foodhubPrice: 12.5, cloverPrice: 13, merchantId: 'm1', at: new Date().toISOString() } });
    const used = await pricePost(req('/api/foodhub/menu/clover-prices', OWNER, { method: 'POST', json: { brand: 'Beta', ref: 'i1', accept: true } }), {});
    expect(await used.json()).toMatchObject({ ok: true, autopilot: [{ brand: 'Beta', outcome: 'protected' }] });
    expect((await getRepo().getMenu('Beta'))!.items[0].price).toBe(13);
    expect(await listScheduled('Beta')).toEqual([]);
  });
});

describe('retry refused sends', () => {
  beforeEach(async () => { await pause(); await setSwitch('retry_failed_jobs', true, PERSON); await pause(); });

  it('retries 3 times (2, 10, 30 min) as Autopilot, then opens an incident', async () => {
    h.def = 'error';
    await publishMenu('Alpha', { storeIds: [ids.alphaUber], actor: PERSON });
    const failed = (await getRepo().listJobs(5))[0];
    h.calls.length = 0;
    let now = Date.now() + 2 * MIN + 1000;
    await runAutopilot({ now });
    expect(sendsTo(ids.alphaUber).length).toBe(1);
    let chain = (await getChains())[failed.id];
    expect(chain).toMatchObject({ status: 'waiting', attempts: 1 });
    expect(Date.parse(chain.nextAt!)).toBe(now + 10 * MIN);
    await runAutopilot({ now: now + 5 * MIN });
    expect(sendsTo(ids.alphaUber).length).toBe(1); // not due yet
    now += 10 * MIN + 1000;
    await runAutopilot({ now });
    chain = (await getChains())[failed.id];
    expect(chain).toMatchObject({ status: 'waiting', attempts: 2 });
    expect(Date.parse(chain.nextAt!)).toBe(now + 30 * MIN);
    now += 30 * MIN + 1000;
    await runAutopilot({ now });
    chain = (await getChains())[failed.id];
    expect(chain).toMatchObject({ status: 'gave_up', attempts: 3 });
    expect(sendsTo(ids.alphaUber).length).toBe(3);
    // A 4th send never happens.
    await runAutopilot({ now: now + 3 * 3600_000 });
    expect(sendsTo(ids.alphaUber).length).toBe(3);
    const log = await autopilotLog();
    expect(log.map((e) => e.action)).toEqual(expect.arrayContaining(['autopilot_retry_planned', 'publish', 'autopilot_retry_failed', 'autopilot_retry_gave_up']));
    expect(log.every((e) => e.source === 'automation')).toBe(true);
    // The Watchtower opens one incident for it.
    const detections = await retryIncidentDetections(now + MIN, await getRepo().listJobs(200));
    expect(detections).toEqual([expect.objectContaining({ key: `autopilot_retry:${failed.id}`, kind: 'menu_failed', brandName: 'Alpha' })]);
    await runWatch({ force: true, now: now + MIN });
    expect((await listIncidents()).some((i) => i.key === `autopilot_retry:${failed.id}` && i.status === 'open')).toBe(true);
    // A person dismisses it from Settings → Autopilot: the incident closes on the next run.
    expect(await stopRetry(failed.id, PERSON)).toMatchObject({ status: 'stopped' });
    expect(await retryIncidentDetections(now + 2 * MIN, await getRepo().listJobs(200))).toEqual([]);
  });

  it('stops as soon as a retry goes through', async () => {
    h.queue[`item:${ids.alphaUber}`] = ['error', 'done'];
    await setItemAvailability('Alpha', ['i1'], false, { locationCode: LOC, storeIds: [ids.alphaUber], actor: PERSON });
    await runAutopilot({ now: Date.now() + 2 * MIN + 1000 });
    const chain = Object.values(await getChains())[0];
    expect(chain).toMatchObject({ kind: 'item_toggle', status: 'done', attempts: 1 });
    expect(h.calls.filter((c) => c.what === 'item')).toEqual([{ what: 'item', id: ids.alphaUber, available: false }, { what: 'item', id: ids.alphaUber, available: false }]);
    expect((await autopilotLog()).some((e) => e.action === 'autopilot_retry_ok')).toBe(true);
    const menu = (await getRepo().getMenu('Alpha'))!;
    expect([...offRefsAt(menu, LOC)]).toEqual(['i1']);
    expect((await getRuns()).retry_failed_jobs?.status).toBe('success');
  });

  it('a newer action by a person wins: the old one is never sent again', async () => {
    h.queue[`item:${ids.alphaUber}`] = ['error'];
    await setItemAvailability('Alpha', ['i1'], false, { locationCode: LOC, storeIds: [ids.alphaUber], actor: PERSON });
    await setItemAvailability('Alpha', ['i1'], true, { locationCode: LOC, storeIds: [ids.alphaUber], actor: PERSON }); // back in stock, by a person
    h.calls.length = 0;
    await runAutopilot({ now: Date.now() + 2 * MIN + 1000 });
    expect(h.calls).toEqual([]);
    expect(Object.values(await getChains())[0]).toMatchObject({ status: 'superseded' });
  });

  it('never retries a protected store, a guard pause, a blocked send, or a refusal from before the switch was on', async () => {
    h.queue[`store:${ids.alphaForbidden}`] = ['error'];
    await setStoresOnline([ids.alphaForbidden], false, { actor: PERSON });
    h.queue[`store:${ids.alphaSkip}`] = ['error'];
    await setStoresOnline([ids.alphaSkip], false, { reason: GUARD_REASON, actor: PERSON });
    h.queue[`publish:${ids.alphaSkip}`] = ['blocked'];
    await publishMenu('Alpha', { storeIds: [ids.alphaSkip], actor: PERSON });
    h.calls.length = 0;
    await runAutopilot({ now: Date.now() + 2 * MIN + 1000 });
    expect(h.calls).toEqual([]);
    const chains = Object.values(await getChains());
    expect(chains.map((c) => [c.storeId, c.status, c.note])).toEqual([[ids.alphaForbidden, 'skipped', 'protected store — never touched by an automation']]);
    // A refusal from before the switch was turned on is left alone.
    await setSwitch('retry_failed_jobs', false, PERSON);
    h.queue[`publish:${ids.alphaUber}`] = ['error'];
    await publishMenu('Alpha', { storeIds: [ids.alphaUber], actor: PERSON });
    await pause();
    await setSwitch('retry_failed_jobs', true, PERSON);
    h.calls.length = 0;
    await runAutopilot({ now: Date.now() + 3 * MIN });
    expect(h.calls).toEqual([]);
  });

  it('a person can stop a waiting retry (undo)', async () => {
    h.def = 'error';
    await setStoresOnline([ids.alphaUber], false, { untilMs: Date.now() + 60 * MIN, actor: PERSON });
    const now = Date.now() + 2 * MIN + 1000;
    await runAutopilot({ now });
    const chain = Object.values(await getChains())[0];
    expect(chain).toMatchObject({ kind: 'store_toggle', status: 'waiting', attempts: 1 });
    const res = await apPost(req('/api/foodhub/autopilot', MANAGER, { method: 'POST', json: { action: 'stop_retry', id: chain.id } }), {});
    expect(res.status).toBe(200);
    h.calls.length = 0;
    await runAutopilot({ now: now + 11 * MIN });
    expect(h.calls).toEqual([]);
    expect((await getRepo().listActivity({ limit: 100 })).some((e) => e.action === 'autopilot_retry_stopped' && e.actor === 'max')).toBe(true);
  });
});

describe('weekly Uber payment report', () => {
  it('the week asked for is Monday to Sunday before, due Monday 06:00 Montréal time', () => {
    const wed = localWallToUtcMs(2026, 10, 28, 15, 0, TZ);
    expect(uberWeekWindow(wed, TZ)).toEqual({ monday: '2026-10-26', dueAt: localWallToUtcMs(2026, 10, 26, 6, 0, TZ), from: '2026-10-19', to: '2026-10-25' });
    const sun = localWallToUtcMs(2026, 11, 1, 23, 0, TZ);
    expect(uberWeekWindow(sun, TZ).monday).toBe('2026-10-26');
  });

  it('asks once a week as Autopilot; a refused request is tried again at most twice, 6 h apart', async () => {
    await setSwitch('uber_weekly_report', true, PERSON);
    const mon = (h24: number, m = 0) => localWallToUtcMs(2026, 10, 26, h24, m, TZ);
    expect(await runAutopilot({ now: mon(5, 59) })).toMatchObject({ ran: true, uber: null });
    const first = await tickUberWeekly(mon(6, 1));
    expect(first).toMatchObject({ week: '2026-10-26', tries: 1, status: 'failed', from: '2026-10-19', to: '2026-10-25' }); // Uber not connected here
    expect(await tickUberWeekly(mon(7))).toBeNull();
    expect(await tickUberWeekly(mon(12, 2))).toMatchObject({ tries: 2 });
    expect(await tickUberWeekly(mon(18, 3))).toMatchObject({ tries: 3 });
    expect(await tickUberWeekly(mon(23, 59))).toBeNull();
    h.reportOk = true;
    const nextWeek = localWallToUtcMs(2026, 11, 2, 6, 30, TZ);
    expect(await tickUberWeekly(nextWeek)).toMatchObject({ week: '2026-11-02', tries: 1, status: 'requested', from: '2026-10-26', to: '2026-11-01' });
    expect(await tickUberWeekly(nextWeek + 7 * 3600_000)).toBeNull();
    const asked = (await getRepo().listActivity({ limit: 50 })).filter((e) => e.action === 'uber_report_request');
    expect(asked.length).toBe(4);
    expect(asked.every((e) => e.actor === AUTOPILOT_ACTOR.name && e.source === 'automation')).toBe(true);
    expect((await getRuns()).uber_weekly_report?.status).toBe('success');
  });
});

describe('the page', () => {
  it('renders every automation with its rule, state, last run and what it did, in French and English', async () => {
    await setSwitch('republish_after_change', true, PERSON);
    await afterCloverPriceUsed('Alpha', PERSON);
    await logActivity({ actor: 'Garde tablette', source: 'automation', kind: 'store_status', action: 'pause', status: 'success', summary: 'Store paused (Tablette de cuisine éteinte)' });
    const items = await listAutomations();
    const republish = items.find((a) => a.id === 'republish_after_change')!;
    expect(republish).toMatchObject({ isNew: true, control: 'here', on: true, switchedBy: 'Mona' });
    expect(republish.lastRunAt).toEqual(expect.any(String));
    expect(republish.lastDid?.fr).toMatch(/Publication prévue à .* Alpha/);
    expect(republish.pending).toEqual([expect.objectContaining({ kind: 'cancel_publish' })]);
    expect(items.find((a) => a.id === 'retry_failed_jobs')).toMatchObject({ on: false, control: 'here' });
    expect(items.find((a) => a.id === 'tablet_guard')).toMatchObject({ control: 'elsewhere', on: false, href: '/stores/availability', lastDid: expect.objectContaining({ fr: 'Store paused (Tablette de cuisine éteinte)' }) });
    expect(items.find((a) => a.id === 'clover_retry')).toMatchObject({ control: 'server', on: true, tech: 'FOODHUB_CLOVER_RETRY_S' });
    expect(items.find((a) => a.id === 'timed_reopen')).toMatchObject({ control: 'always', on: true });
    for (const a of items) {
      expect(a.ruleFr.length, a.id).toBeGreaterThan(30);
      expect(a.ruleEn.length, a.id).toBeGreaterThan(30);
    }
    const fr = renderToStaticMarkup(createElement(AutopilotList, { items, t: translator('fr'), lang: 'fr', canEdit: true, onToggle: () => undefined, onUndo: () => undefined }));
    expect(fr).toContain('Republier 10 min après un changement');
    expect(fr).toContain('Garde tablette éteinte');
    expect(fr).toContain('Dernier passage');
    expect(fr).toContain('role="switch"');
    expect(fr).toContain('Annuler');
    expect(fr).toMatch(/Publication prévue à/);
    expect((fr.match(/data-automation=/g) ?? []).length).toBe(13);
    const en = renderToStaticMarkup(createElement(AutopilotList, { items, t: translator('en'), lang: 'en', canEdit: false, onToggle: () => undefined, onUndo: () => undefined }));
    expect(en).toContain('Re-publish 10 min after a change');
    expect(en).toContain('Last run:');
    expect(en).toContain('disabled');
    const notReal = new RegExp(['virtu(el|al)', 'gh' + 'ost', 'fant' + 'ôme'].join('|'), 'i');
    for (const html of [fr, en]) {
      expect(html).not.toMatch(/24 ?(h|heures|\/ ?7)/i);
      expect(html).not.toMatch(notReal);
    }
  });
});
