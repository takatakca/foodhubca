// Watchtower alarms (MASTER_PLAN Phase 1, items 3–5): stale statuses and refused platform actions text the managers by
// default, a platform that goes quiet while its stores are open raises the silence alarm, and an order from a store
// nobody mapped raises a critical, escalating incident that names the platform store id.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../lib/foodhub/activity';
import type { ChannelStore, FoodHubUser, NormalizedOrder, WeeklyHours } from '../lib/foodhub/types';

const fresh = () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  (globalThis as any).__takatakWatchRunning = undefined;
  delete process.env.FOODHUB_TIMEZONE;
  delete process.env.CLOVER_MERCHANT_ID; delete process.env.CLOVER_ACCESS_TOKEN; delete process.env.CLOVER_MERCHANT_TOKENS;
};
const owner: Actor = { username: 'owner', name: 'Owner', source: 'dashboard' };
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;
// October 2026 in Montréal is EDT (UTC−4): 17:00Z = 13:00 local, 07:00Z = 03:00 local (quiet hours).
const AFTERNOON = Date.parse('2026-10-04T17:00:00.000Z');
const NIGHT = Date.parse('2026-10-05T07:00:00.000Z');

async function deps() {
  const { getRepo } = await import('../lib/foodhub/repo');
  const engine = await import('../lib/foodhub/watch/engine');
  return { repo: getRepo(), ...engine };
}

/** A platform store mapped long ago (the silence alarm only counts a store from its mapping). */
async function mapStore(over: Partial<ChannelStore> & Pick<ChannelStore, 'channel' | 'channelStoreId'>) {
  const { getRepo } = await import('../lib/foodhub/repo');
  const s = await getRepo().upsertStore({ brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {}, ...over });
  return (await getRepo().updateStore(s.id, { createdAt: '2026-09-01T00:00:00.000Z' }))!;
}

async function addOrder(externalOrderId: string, at: number, over: Partial<NormalizedOrder> & { locationCode?: string; status?: 'new' | 'completed' } = {}) {
  const { getRepo } = await import('../lib/foodhub/repo');
  const { status = 'completed', ...rest } = over;
  const { order } = await getRepo().insertOrderIfNew({
    channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId, displayId: externalOrderId.toUpperCase(), channelStoreId: 'u-ndg', fulfillment: 'delivery', placedAt: iso(at), createdAt: iso(at),
    currency: 'CAD', subtotal: 20, tax: 3, total: 23, deliveryFee: 0, tip: 0, discount: 0, lines: [], raw: {}, brandName: 'Po Poulet', locationCode: 'NDG_MAIN', ...rest,
  } as any);
  if (status !== 'new') await getRepo().updateOrder(order.id, { status });
  return order;
}

async function openDaily(open: string, close: string, codes = ['NDG_MAIN']) {
  const { DAYS, saveHours } = await import('../lib/foodhub/hours');
  const week = Object.fromEntries(DAYS.map((d) => [d, [{ open, close }]])) as unknown as WeeklyHours;
  await saveHours({ locations: Object.fromEntries(codes.map((c) => [c, week])), brands: {}, holidays: [] });
}

async function manager() {
  const { getRepo } = await import('../lib/foodhub/repo');
  await getRepo().saveUser({ username: 'mona', name: 'Mona', role: 'manager', locations: ['NDG_MAIN'], phone: '+15145550177', active: true, lastLoginAt: null, prefs: { onDuty: true, alertSms: true, alertCall: true } } as unknown as FoodHubUser);
}

const ofKind = async (kind: string) => (await (await deps()).listIncidents({})).filter((i) => i.kind === kind);

describe('Watchtower defaults: stale statuses and refused actions text the managers', () => {
  beforeEach(fresh);

  it('escalates sync_stale, menu_failed and the two new alarms by default; a choice the owner saved is kept', async () => {
    const { DEFAULT_RULES, INCIDENT_KINDS, KIND_LABEL } = await import('../lib/foodhub/watch/types');
    const { PLAYBOOK } = await import('../lib/foodhub/watch/ai');
    for (const k of ['sync_stale', 'menu_failed', 'platform_silent', 'store_unmapped'] as const) {
      expect(DEFAULT_RULES[k]).toEqual({ enabled: true, escalate: true });
      expect(INCIDENT_KINDS).toContain(k);
      expect(KIND_LABEL[k].fr && KIND_LABEL[k].en).toBeTruthy();
      expect(PLAYBOOK[k].doFr.length && PLAYBOOK[k].doEn.length).toBeTruthy();
    }
    const { repo, getWatchSettings, saveWatchSettings } = await deps();
    const defaults = await getWatchSettings();
    expect(defaults.rules.sync_stale.escalate).toBe(true);
    expect(defaults.rules.menu_failed.escalate).toBe(true);
    expect(defaults.silenceAfterMin).toBe(180);

    // Rules saved before this release (texts off for both, the new kinds unknown): the owner's choice stays, new kinds get their defaults.
    await repo.setKv('watch:settings', { enabled: true, rules: { sync_stale: { enabled: true, escalate: false }, menu_failed: { enabled: true, escalate: false } } });
    const saved = await getWatchSettings();
    expect(saved.rules.sync_stale).toEqual({ enabled: true, escalate: false });
    expect(saved.rules.menu_failed).toEqual({ enabled: true, escalate: false });
    expect(saved.rules.platform_silent).toEqual({ enabled: true, escalate: true });
    expect(saved.rules.store_unmapped).toEqual({ enabled: true, escalate: true });
    expect(saved.silenceAfterMin).toBe(180);

    expect((await saveWatchSettings({ silenceAfterMin: 5 }, owner)).silenceAfterMin).toBe(30);
    expect((await saveWatchSettings({ silenceAfterMin: 5000 }, owner)).silenceAfterMin).toBe(720);
    const again = await saveWatchSettings({ silenceAfterMin: 240 }, owner);
    expect(again.silenceAfterMin).toBe(240);
    expect(again.rules.sync_stale.escalate).toBe(false); // another save does not undo the owner's choice
  });

  it('texts the manager on duty for stale statuses and a refused menu action — never a call, and not in quiet hours', async () => {
    const { repo, runWatch } = await deps();
    await manager();
    await mapStore({ channel: 'uber_eats', channelStoreId: 'u-ndg' }); // polled, and no sync ever ran
    await repo.addJob({ kind: 'menu_publish', channel: 'uber_eats', reference: 'pub-1', status: 'error', request: {}, result: { message: 'HTTP 400' } });

    await runWatch({ force: true, now: AFTERNOON });
    await runWatch({ force: true, now: AFTERNOON + 3 * MIN });
    await runWatch({ force: true, now: AFTERNOON + 12 * MIN });
    for (const kind of ['sync_stale', 'menu_failed']) {
      const [i] = await ofKind(kind);
      expect(i).toMatchObject({ status: 'open', severity: 'warning', level: 1 });
      expect(i.steps.some((x) => x.kind === 'sms' && x.to?.startsWith('Mona'))).toBe(true);
      expect(i.steps.some((x) => x.kind === 'call')).toBe(false); // warnings text, they never ring
    }

    fresh();
    const night = await deps();
    await manager();
    await mapStore({ channel: 'uber_eats', channelStoreId: 'u-ndg' });
    await night.runWatch({ force: true, now: NIGHT });
    await night.runWatch({ force: true, now: NIGHT + 3 * MIN });
    const [quiet] = await ofKind('sync_stale');
    expect(quiet).toMatchObject({ status: 'open', level: 0 });
    expect(quiet.steps.some((x) => x.kind === 'sms')).toBe(false);
  });
});

describe('silence alarm: a platform that goes quiet while its stores are open', () => {
  beforeEach(fresh);

  it('counts opening minutes only, opens a warning that texts the managers, and closes with the next order', async () => {
    const { runWatch } = await deps();
    await manager();
    await openDaily('10:00', '22:00');
    await mapStore({ channel: 'uber_eats', channelStoreId: 'u-ndg' });
    await addOrder('ue-last', Date.parse('2026-10-04T01:30:00.000Z')); // 21:30 the night before

    // 11:00: 13.5 h since the last order, but only 31 + 60 opening minutes — a closed night does not count.
    await runWatch({ force: true, now: Date.parse('2026-10-04T15:00:00.000Z') });
    expect(await ofKind('platform_silent')).toHaveLength(0);

    // 13:00: 31 + 180 opening minutes ≥ 180 → alarm.
    await runWatch({ force: true, now: AFTERNOON });
    const [open] = await ofKind('platform_silent');
    expect(open).toMatchObject({ key: 'platform_silent:uber_eats', status: 'open', severity: 'warning', channel: 'uber_eats', locationCode: 'NDG_MAIN' });
    expect(open.title).toBe('Aucune commande Uber Eats depuis 15 h 30');
    expect(open.titleEn).toBe('No Uber Eats order for 15 h 30');
    expect(open.detail).toContain('3 h 31 d’ouverture sans commande');
    expect(open.detailEn).toContain('1 Uber Eats store(s) open now');
    expect(open.explanation).toMatch(/webhook/);

    await runWatch({ force: true, now: AFTERNOON + 3 * MIN });
    const [texted] = await ofKind('platform_silent');
    expect(texted.level).toBe(1);
    expect(texted.steps.some((x) => x.kind === 'sms' && x.to?.startsWith('Mona'))).toBe(true);

    await addOrder('ue-back', AFTERNOON + 4 * MIN);
    await runWatch({ force: true, now: AFTERNOON + 5 * MIN });
    const [closed] = await ofKind('platform_silent');
    expect(closed).toMatchObject({ status: 'resolved', resolvedBy: 'auto' });
  });

  it('remembers the last order beyond the 24 h the Watchtower reads', async () => {
    const { runWatch } = await deps();
    await openDaily('10:00', '22:00');
    await mapStore({ channel: 'uber_eats', channelStoreId: 'u-ndg' });
    await addOrder('ue-old', Date.parse('2026-10-02T20:00:00.000Z')); // Friday 16:00
    await runWatch({ force: true, now: Date.parse('2026-10-02T21:00:00.000Z') }); // seen once (and nothing to say yet)
    expect(await ofKind('platform_silent')).toHaveLength(0);
    await runWatch({ force: true, now: AFTERNOON }); // Sunday 13:00: the order is now out of the 24 h window
    const [i] = await ofKind('platform_silent');
    expect(i.title).toBe('Aucune commande Uber Eats depuis 45 h 00');
    expect(i.detailEn).toContain('last order: 2026-10-02 16:00');
  });

  it('stays quiet for a platform never connected, relay-only, paused or Too Good To Go stores, and when every store is closed', async () => {
    const { repo, runWatch } = await deps();
    await openDaily('10:00', '22:00');
    const now = Date.parse('2026-10-04T19:00:00.000Z'); // 15:00
    const sixHoursAgo = now - 6 * 60 * MIN;
    await mapStore({ channel: 'doordash', channelStoreId: 'dd-ndg' }); // DoorDash never sent an order: not connected yet, not "silent"
    await mapStore({ channel: 'skip', channelStoreId: 'relay:skip-ndg' }); // reached only through the relay
    await addOrder('sk-1', sixHoursAgo, { channel: 'skip', marketplace: 'skip', channelStoreId: 'relay:skip-ndg', viaHub: 'relay' });
    const paused = await mapStore({ channel: 'uber_eats', channelStoreId: 'u-ndg', online: false });
    await addOrder('ue-1', sixHoursAgo);
    await mapStore({ channel: 'tgtg', channelStoreId: 'tg-ndg' });
    await addOrder('tg-1', sixHoursAgo, { channel: 'tgtg', marketplace: 'tgtg', channelStoreId: 'tg-ndg' });

    await runWatch({ force: true, now });
    expect(await ofKind('platform_silent')).toHaveLength(0);

    // Same setup with the Uber store back online: only Uber alarms (proves the quiet above was each rule, not the clock).
    await repo.updateStore(paused.id, { online: true });
    await runWatch({ force: true, now: now + MIN });
    expect((await ofKind('platform_silent')).map((i) => i.channel)).toEqual(['uber_eats']);
    // A store paused by the platform does not count either.
    await repo.updateStore(paused.id, { meta: { platformStatus: { state: 'paused', checkedAt: iso(now), source: 'sync' } } });
    await runWatch({ force: true, now: now + 2 * MIN });
    expect((await ofKind('platform_silent'))[0].status).toBe('resolved');
    await repo.updateStore(paused.id, { meta: {} });
    await runWatch({ force: true, now: now + 3 * MIN });
    expect((await ofKind('platform_silent')).find((i) => i.status === 'open')).toBeTruthy();
    // 23:45: every store is closed → nothing to watch.
    await runWatch({ force: true, now: Date.parse('2026-10-05T03:45:00.000Z') });
    expect((await ofKind('platform_silent')).every((i) => i.status === 'resolved')).toBe(true);
  });

  it('uses the owner’s threshold and can be turned off', async () => {
    const { runWatch, saveWatchSettings } = await deps();
    await openDaily('10:00', '22:00');
    await mapStore({ channel: 'uber_eats', channelStoreId: 'u-ndg' });
    await addOrder('ue-1', AFTERNOON - 2 * 60 * MIN); // 11:00 → 2 h of opening time at 13:00
    await runWatch({ force: true, now: AFTERNOON });
    expect(await ofKind('platform_silent')).toHaveLength(0);
    await saveWatchSettings({ silenceAfterMin: 90 }, owner);
    await runWatch({ force: true, now: AFTERNOON + MIN });
    expect(await ofKind('platform_silent')).toHaveLength(1);
    await saveWatchSettings({ rules: { platform_silent: { enabled: false, escalate: true } } as any }, owner);
    await runWatch({ force: true, now: AFTERNOON + 2 * MIN });
    expect((await ofKind('platform_silent'))[0].status).toBe('resolved');
  });
});

describe('an order from a store nobody mapped', () => {
  beforeEach(fresh);
  const incoming = (externalOrderId: string, channelStoreId: string, at: number, over: Partial<NormalizedOrder> = {}) => ({
    channel: 'doordash', marketplace: 'doordash', externalOrderId, displayId: externalOrderId.toUpperCase(), channelStoreId, fulfillment: 'delivery',
    placedAt: iso(at), createdAt: iso(at), currency: 'CAD', subtotal: 10, tax: 1.5, total: 11.5, deliveryFee: 0, tip: 0, discount: 0, lines: [], raw: {}, ...over,
  } as NormalizedOrder);

  it('raises one critical incident per platform store naming its id, suggests the mapping, escalates even at night, and closes once mapped', async () => {
    const { processIncomingOrder } = await import('../lib/foodhub/pipeline');
    const { repo, runWatch } = await deps();
    await manager();
    await mapStore({ channel: 'uber_eats', channelStoreId: 'u-ndg' }); // Po Poulet cooks at NDG MAIN only
    const first = await processIncomingOrder(incoming('dd-a', 'dd-new', NIGHT - 4 * MIN, { brandName: 'po poulet' }));
    const second = await processIncomingOrder(incoming('dd-b', 'dd-new', NIGHT - 3 * MIN));
    expect(first.order.status).toBe('new'); // held by the pipeline: never accepted automatically
    expect(first.order.locationCode).toBeUndefined();

    await runWatch({ force: true, now: NIGHT });
    const all = await (await deps()).listIncidents({});
    expect(all.filter((i) => i.kind === 'order_unaccepted')).toHaveLength(0); // one incident for the problem, not one per order
    const [i] = all.filter((x) => x.kind === 'store_unmapped');
    expect(i).toMatchObject({ key: 'store_unmapped:doordash:dd-new', severity: 'critical', status: 'open', channel: 'doordash', orderId: first.order.id, brandName: 'Po Poulet', locationCode: null });
    expect(i.title).toBe('Commande d’un magasin DoorDash non relié : dd-new');
    expect(i.titleEn).toBe('Order from an unmapped DoorDash store: dd-new');
    expect(i.detail).toContain('2 commande(s) en attente (#DD-A, #DD-B)');
    expect(i.detail).toContain('à relier à Po Poulet · NDG MAIN ?');
    expect(i.detailEn).toContain('link it to Po Poulet · NDG MAIN?');

    // Critical: it escalates through quiet hours like the other critical problems (text at 2 min, call at 5 min).
    await runWatch({ force: true, now: NIGHT + 3 * MIN });
    await runWatch({ force: true, now: NIGHT + 6 * MIN });
    const [esc] = await ofKind('store_unmapped');
    expect(esc.level).toBeGreaterThanOrEqual(2);
    expect(esc.steps.some((x) => x.kind === 'sms' && x.to?.startsWith('Mona'))).toBe(true);
    expect(esc.steps.some((x) => x.kind === 'call' && x.to?.startsWith('Mona'))).toBe(true);

    // The oldest order is handled: the incident now points at the one still waiting.
    await repo.updateOrder(first.order.id, { status: 'accepted' });
    await runWatch({ force: true, now: NIGHT + 7 * MIN });
    const [one] = await ofKind('store_unmapped');
    expect(one).toMatchObject({ status: 'open', orderId: second.order.id });
    expect(one.detailEn).toMatch(/^1 order\(s\) waiting \(#DD-B\)/);

    // The store gets mapped → closed by itself (the order is no longer from "a store nobody mapped").
    await repo.upsertStore({ channel: 'doordash', channelStoreId: 'dd-new', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {} });
    await runWatch({ force: true, now: NIGHT + 8 * MIN });
    expect((await ofKind('store_unmapped'))[0]).toMatchObject({ status: 'resolved', resolvedBy: 'auto' });
  });

  it('closes when the order is rejected, and leaves the usual "order waiting" alarm when the rule is off', async () => {
    const { processIncomingOrder } = await import('../lib/foodhub/pipeline');
    const { repo, runWatch, saveWatchSettings } = await deps();
    const out = await processIncomingOrder(incoming('dd-c', '', AFTERNOON - 4 * MIN));
    await runWatch({ force: true, now: AFTERNOON });
    const [i] = await ofKind('store_unmapped');
    expect(i.title).toContain('(sans identifiant)');
    expect(i.titleEn).toContain('(no id)');
    await repo.updateOrder(out.order.id, { status: 'cancelled' });
    await runWatch({ force: true, now: AFTERNOON + MIN });
    expect((await ofKind('store_unmapped'))[0].status).toBe('resolved');

    await saveWatchSettings({ rules: { store_unmapped: { enabled: false, escalate: true } } as any }, owner);
    await processIncomingOrder(incoming('dd-d', 'dd-x', AFTERNOON - 4 * MIN));
    await runWatch({ force: true, now: AFTERNOON + 2 * MIN });
    expect((await ofKind('store_unmapped')).filter((x) => x.status === 'open')).toHaveLength(0);
    expect((await ofKind('order_unaccepted')).filter((x) => x.status === 'open')).toHaveLength(1);
  });
});
