// Kitchen order tools — store status from the kitchen: header text, locked stores never sent, channel / brand filters.
import { describe, expect, it } from 'vitest';
import { RELAY_STORE_PREFIX } from '../lib/foodhub/adapters/relay';
import {
  kitchenStatusText, kitchenStores, lockReasonOf, pauseMinutes, pauseTargets, resumeTargets, stepBusyMinutes, summarizeKitchen, type KitchenStore,
} from '../lib/foodhub/order-tools/kitchen-status';
import { BUILT_IN_MENU_LOCKS } from '../lib/foodhub/menu/lock';
import { FORBIDDEN_STORE_IDS } from '../lib/foodhub/public-directory';
import { localTimeLabel } from '../lib/foodhub/time';

const forbidden = [...FORBIDDEN_STORE_IDS][0];
const store = (s: Partial<KitchenStore> & { id: string }): KitchenStore => ({ channel: 'uber_eats', channelStoreId: `cs-${s.id}`, brandName: 'Alpha', locationCode: 'NDG', online: true, meta: {}, ...s });

const all: KitchenStore[] = [
  store({ id: 'u-alpha' }),
  store({ id: 'd-alpha', channel: 'doordash' }),
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
