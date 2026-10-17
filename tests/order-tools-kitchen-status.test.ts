// Kitchen order tools — store status from the kitchen: header text, locked stores never sent, channel / brand filters.
import { describe, expect, it } from 'vitest';
import { RELAY_STORE_PREFIX } from '../lib/foodhub/adapters/relay';
import {
  checkKitchenStatusBody, HOLIDAY_PAUSE_REASON, kitchenStatusText, MAX_KITCHEN_PAUSE_MINUTES, PAUSE_REASONS, kitchenStores, lockReasonOf, pauseMinutes, pauseTargets, resumeHeld, resumeHoldOf, resumeTargets, splitKitchenRequest,
  stepBusyMinutes, summarizeKitchen, type KitchenStore,
} from '../lib/foodhub/order-tools/kitchen-status';
import { BUILT_IN_MENU_LOCKS } from '../lib/foodhub/menu/lock';
import { FORBIDDEN_STORE_IDS } from '../lib/foodhub/public-directory';
import { localTimeLabel } from '../lib/foodhub/time';

const forbidden = [...FORBIDDEN_STORE_IDS][0];
const store = (s: Partial<KitchenStore> & { id: string }): KitchenStore => ({ channel: 'uber_eats', channelStoreId: `cs-${s.id}`, brandName: 'Alpha', locationCode: 'NDG', online: true, meta: {}, ...s });

const all: KitchenStore[] = [
  store({ id: 'u-alpha' }),
  store({ id: 'd-alpha', channel: 'doordash', meta: { platformStoreId: '55550001' } }),
  store({ id: 'u-beta', brandName: 'Beta' }),
  store({ id: 's-beta', channel: 'skip', brandName: 'Beta', online: false, pausedUntil: '2026-10-16T23:00:00Z' }),
  store({ id: 'd-protected', channel: 'doordash', brandName: 'Gamma', channelStoreId: forbidden }),
  store({ id: 'd-protected-number', channel: 'doordash', brandName: 'Gamma', channelStoreId: 'merchant-supplied', meta: { platformStoreId: forbidden } }),
  store({ id: 'u-dnt', brandName: 'Gamma', meta: { doNotTouch: true }, online: false }),
  store({ id: 'relay', channel: 'tgtg', channelStoreId: `${RELAY_STORE_PREFIX}abc` }),
  store({ id: 'other-kitchen', locationCode: 'SAINT_LEONARD' }),
];

describe('which stores the kitchen sheet shows and may send', () => {
  const k = kitchenStores(all, 'NDG', FORBIDDEN_STORE_IDS);

  it('keeps this kitchen only, hides relay stores, lists channels and brands present', () => {
    expect(k.stores.map((s) => s.id).sort()).toEqual(['d-alpha', 'd-protected', 'd-protected-number', 's-beta', 'u-alpha', 'u-beta', 'u-dnt'].sort());
    expect(k.channels).toEqual(['uber_eats', 'doordash', 'skip']);
    expect(k.brands).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('locks the protected DoorDash store (by its id or its DoorDash number) and "Do not touch" stores', () => {
    const locked = Object.fromEntries(k.stores.filter((s) => s.locked).map((s) => [s.id, s.lockReason]));
    expect(locked).toEqual({ 'd-protected': 'forbidden', 'd-protected-number': 'forbidden', 'u-dnt': 'do_not_touch' });
    // The built-in menu lock (same store) also counts, even without the forbidden list.
    const viaLock = store({ id: 'x', channel: 'doordash', channelStoreId: 'some-id', menuLock: { locked: true, source: 'built_in' } });
    expect(lockReasonOf(viaLock, [])).toBe('forbidden');
    expect(BUILT_IN_MENU_LOCKS.some((l) => FORBIDDEN_STORE_IDS.has(l.id))).toBe(true);
  });

  it('a pause never includes a locked store, even with every channel and brand ticked', () => {
    const ids = pauseTargets(k, { channels: k.channels, brands: k.brands });
    expect(ids.sort()).toEqual(['d-alpha', 's-beta', 'u-alpha', 'u-beta']);
    expect(ids).not.toContain('d-protected');
    expect(ids).not.toContain('d-protected-number');
    expect(ids).not.toContain('u-dnt');
  });

  it('filters on the ticked channels and brands', () => {
    expect(pauseTargets(k, { channels: ['uber_eats'], brands: k.brands }).sort()).toEqual(['u-alpha', 'u-beta']);
    expect(pauseTargets(k, { channels: k.channels, brands: ['Beta'] }).sort()).toEqual(['s-beta', 'u-beta']);
    expect(pauseTargets(k, { channels: ['doordash'], brands: ['Gamma'] })).toEqual([]);
    expect(pauseTargets(k, { channels: [], brands: k.brands })).toEqual([]);
  });

  it('"Tout rouvrir" reopens paused unlocked stores only', () => {
    expect(resumeTargets(k)).toEqual(['s-beta']);
  });
});

describe('header summary', () => {
  const fmt = (iso: string) => localTimeLabel(iso, {}, 'America/Toronto');
  const k = kitchenStores(all, 'NDG', FORBIDDEN_STORE_IDS);
  const open = kitchenStores(all.map((s) => (s.id === 's-beta' ? { ...s, online: true } : s)), 'NDG', FORBIDDEN_STORE_IDS);

  it('Normal and Busy show the prep minutes in force', () => {
    expect(kitchenStatusText(summarizeKitchen({ isBusy: false, normal: 15, busy: 25 }, open), 'fr', fmt)).toBe('Ouvert · Normal 15 min');
    expect(kitchenStatusText(summarizeKitchen({ isBusy: true, normal: 15, busy: 25 }, open), 'fr', fmt)).toBe('Occupé · 25 min');
    expect(kitchenStatusText(summarizeKitchen({ isBusy: true, normal: 15, busy: 25 }, open), 'en', fmt)).toBe('Busy · 25 min');
    expect(kitchenStatusText(summarizeKitchen(null, open), 'fr', fmt)).toBe('Ouvert · Normal 15 min');
  });

  it('a pause wins: "En pause jusqu’à HH:MM (N/M)" counted on unlocked stores only', () => {
    const s = summarizeKitchen({ isBusy: true, normal: 15, busy: 25 }, k);
    expect(s).toMatchObject({ kind: 'paused', paused: 1, total: 4, until: '2026-10-16T23:00:00.000Z' });
    expect(kitchenStatusText(s, 'fr', fmt)).toBe('En pause jusqu’à 19:00 (1/4)');
    expect(kitchenStatusText(s, 'en', fmt)).toBe('Paused until 19:00 (1/4)');
    const open2 = kitchenStores(all.map((x) => (x.id === 's-beta' ? { ...x, pausedUntil: null } : x)), 'NDG', FORBIDDEN_STORE_IDS);
    expect(kitchenStatusText(summarizeKitchen(null, open2), 'fr', fmt)).toBe('En pause (1/4)');
  });
});

describe('choices', () => {
  it('pause durations, "until close" only when known', () => {
    expect(pauseMinutes(15, null)).toBe(15);
    expect(pauseMinutes(60, 10)).toBe(60);
    expect(pauseMinutes('close', 95)).toBe(95);
    expect(pauseMinutes('close', null)).toBeNull();
    expect(pauseMinutes('close', 0)).toBeNull();
  });
  it('busy minutes ±5 stay between 5 and 120', () => {
    expect(stepBusyMinutes(25, 5)).toBe(30);
    expect(stepBusyMinutes(5, -5)).toBe(5);
    expect(stepBusyMinutes(120, 5)).toBe(120);
  });
});

describe('"Tout rouvrir" reopens the kitchen’s own pauses only', () => {
  const TODAY = '2026-10-16';
  const k = kitchenStores([
    store({ id: 'mine', online: false, meta: { platformStatus: { state: 'paused', detail: 'Kitchen too busy', source: 'dashboard' } } }),
    store({ id: 'holiday-reason', online: false, meta: { platformStatus: { state: 'paused', detail: HOLIDAY_PAUSE_REASON, source: 'dashboard' } } }),
    store({ id: 'holiday-today', channel: 'skip', online: false, meta: { holidayPause: TODAY } }),
    store({ id: 'holiday-old', channel: 'skip', online: false, meta: { holidayPause: '2026-10-01' } }),
    store({ id: 'dd-shut', channel: 'doordash', online: false, meta: { platformStoreId: '55550002', platformStatus: { state: 'deactivated', source: 'webhook' } } }),
    store({ id: 'uber-closed', online: false, meta: { platformStatus: { state: 'closed', detail: 'OUT_OF_MENU_HOURS', source: 'sync' } } }),
  ], 'NDG', FORBIDDEN_STORE_IDS);

  it('skips holiday auto-pauses and stores the platform shut or closed', () => {
    expect(resumeTargets(k, TODAY).sort()).toEqual(['holiday-old', 'mine']);
    expect(Object.fromEntries(resumeHeld(k, TODAY))).toEqual({ 'holiday-reason': 'holiday', 'holiday-today': 'holiday', 'dd-shut': 'platform', 'uber-closed': 'platform' });
    expect(resumeHoldOf({ meta: {} }, TODAY)).toBeNull();
  });
});

describe('splitKitchenRequest (the server-side refusal)', () => {
  const opts = { locationCode: 'NDG', forbiddenIds: FORBIDDEN_STORE_IDS, today: '2026-10-16' };
  it('never lets a protected, "Do not touch", relay, other-kitchen or unknown store through', () => {
    const r = splitKitchenRequest(['u-alpha', 'd-protected', 'd-protected-number', 'u-dnt', 'relay', 'other-kitchen', 'missing', 'u-alpha'], all, { ...opts, online: false });
    expect(r.send).toEqual(['u-alpha']);
    expect(r.notSent).toEqual([
      { storeId: 'd-protected', reason: 'forbidden' }, { storeId: 'd-protected-number', reason: 'forbidden' }, { storeId: 'u-dnt', reason: 'do_not_touch' },
      { storeId: 'relay', reason: 'other_kitchen' }, { storeId: 'other-kitchen', reason: 'other_kitchen' }, { storeId: 'missing', reason: 'unknown' },
    ]);
  });
  it('the built-in menu lock refuses the store even with an empty forbidden list', () => {
    const s = [store({ id: 'dd', channel: 'doordash', channelStoreId: 'x', menuLock: { locked: true, source: 'built_in' } })];
    expect(splitKitchenRequest(['dd'], s, { ...opts, forbiddenIds: [], online: false })).toEqual({ send: [], notSent: [{ storeId: 'dd', reason: 'forbidden' }] });
  });
  it('a reopen also leaves holiday and platform closures out; a pause does not care', () => {
    const s = [store({ id: 'h', online: false, meta: { holidayPause: '2026-10-16' } }), store({ id: 'p', online: false, meta: { platformStatus: { state: 'deactivated' } } })];
    expect(splitKitchenRequest(['h', 'p'], s, { ...opts, online: true }).notSent).toEqual([{ storeId: 'h', reason: 'holiday' }, { storeId: 'p', reason: 'platform' }]);
    expect(splitKitchenRequest(['h', 'p'], s, { ...opts, online: false }).send).toEqual(['h', 'p']);
  });
});

describe('fails closed for DoorDash (Po Poulet NDG can be mapped by merchant_supplied_id)', () => {
  it('a DoorDash store without its DoorDash store number is locked, never paused nor reopened', () => {
    const noNumber = store({ id: 'dd-no-number', channel: 'doordash', channelStoreId: 'merchant-supplied-ndg', online: false, meta: {} });
    expect(lockReasonOf(noNumber, FORBIDDEN_STORE_IDS)).toBe('dd_number_missing');
    expect(lockReasonOf({ ...noNumber, meta: { platformStoreId: '  ' } }, FORBIDDEN_STORE_IDS)).toBe('dd_number_missing');
    const k = kitchenStores([noNumber, store({ id: 'u' })], 'NDG', FORBIDDEN_STORE_IDS);
    expect(pauseTargets(k, { channels: k.channels, brands: k.brands })).toEqual(['u']);
    expect(resumeTargets(k)).toEqual([]);
    expect(splitKitchenRequest(['dd-no-number'], [noNumber], { locationCode: 'NDG', online: false, forbiddenIds: FORBIDDEN_STORE_IDS, today: '2026-10-16' }).notSent)
      .toEqual([{ storeId: 'dd-no-number', reason: 'dd_number_missing' }]);
    // Uber / Skip stores do not need a DoorDash number.
    expect(lockReasonOf(store({ id: 'u2' }), FORBIDDEN_STORE_IDS)).toBeNull();
  });
  it('an env lock (FOODHUB_MENU_LOCKED_STORES) protects the DoorDash store like the built-in one; a manager menu lock does not block a pause', () => {
    const base = { id: 'dd', channel: 'doordash' as const, channelStoreId: 'x', meta: { platformStoreId: '1234' } };
    expect(lockReasonOf(store({ ...base, menuLock: { locked: true, source: 'env' } }), [])).toBe('forbidden');
    expect(lockReasonOf(store({ ...base, menuLock: { locked: true, source: 'built_in' } }), [])).toBe('forbidden');
    expect(lockReasonOf(store({ ...base, menuLock: { locked: true, source: 'store' } }), [])).toBeNull();
    expect(lockReasonOf(store({ ...base, menuLock: { locked: false } }), [])).toBeNull();
  });
});

describe('header after closing time: platform closures are "Fermé", not a pause', () => {
  const TODAY = '2026-10-16';
  const closed = (id: string, channel: KitchenStore['channel'] = 'uber_eats') => store({ id, channel, online: false, meta: { platformStoreId: '9000', platformStatus: { state: 'closed', detail: 'OUT_OF_MENU_HOURS', source: 'sync' } } });
  it('every store closed by the platform → "Fermé", never "En pause"', () => {
    const k = kitchenStores([closed('a'), closed('b'), closed('c', 'doordash'), closed('d', 'skip')], 'NDG', FORBIDDEN_STORE_IDS);
    const s = summarizeKitchen({ isBusy: true, normal: 15, busy: 25 }, k, TODAY);
    expect(s).toMatchObject({ kind: 'closed', paused: 0, closed: 4, total: 4 });
    expect(kitchenStatusText(s, 'fr', () => '')).toBe('Fermé');
    expect(kitchenStatusText(s, 'en', () => '')).toBe('Closed');
    expect(resumeTargets(k, TODAY)).toEqual([]); // header and "Tout rouvrir" agree
  });
  it('a holiday closure does not count as the kitchen’s pause; a real pause still wins', () => {
    const holiday = store({ id: 'h', online: false, meta: { holidayPause: TODAY } });
    const mine = store({ id: 'm', online: false, pausedUntil: '2026-10-16T23:00:00Z' });
    expect(summarizeKitchen(null, kitchenStores([holiday, store({ id: 'o' })], 'NDG', []), TODAY)).toMatchObject({ kind: 'normal', paused: 0, closed: 1 });
    expect(summarizeKitchen(null, kitchenStores([holiday, mine], 'NDG', []), TODAY)).toMatchObject({ kind: 'paused', paused: 1, closed: 1, total: 2 });
  });
});

describe('checkKitchenStatusBody (what the route accepts)', () => {
  it('a reopen needs nothing else', () => {
    expect(checkKitchenStatusBody({ online: true, minutes: -3, reason: 'anything' })).toEqual({ online: true });
  });
  it('a pause needs whole minutes 1..max and one of the sheet’s reasons', () => {
    expect(checkKitchenStatusBody({ online: false, minutes: 30, reason: PAUSE_REASONS[0].text })).toEqual({ online: false, minutes: 30, reason: PAUSE_REASONS[0].text });
    expect(checkKitchenStatusBody({ online: false, minutes: '15' })).toEqual({ online: false, minutes: 15 });
    expect(checkKitchenStatusBody({ online: false, minutes: MAX_KITCHEN_PAUSE_MINUTES })).toMatchObject({ minutes: MAX_KITCHEN_PAUSE_MINUTES });
    for (const minutes of [undefined, null, 0, -1, NaN, Infinity, 1.5, 'abc', '', MAX_KITCHEN_PAUSE_MINUTES + 1]) {
      expect(checkKitchenStatusBody({ online: false, minutes })).toHaveProperty('error');
    }
    expect(checkKitchenStatusBody({ online: false, minutes: 15, reason: 'free text' })).toHaveProperty('error');
  });
});
