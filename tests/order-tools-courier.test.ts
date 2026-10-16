// Kitchen order tools — courier watch: every state, the timers, and the single "arriving" chime per order.
import { describe, expect, it } from 'vitest';
import { ARRIVING_MINUTES, chimeOnce, courierWatchState, etaPassed, mmss } from '../lib/foodhub/order-tools/courier-watch';
import type { CourierInfo, OrderTimeline, StoredOrder } from '../lib/foodhub/types';

const NOW = Date.parse('2026-10-16T22:00:00Z');
const iso = (offsetMin: number) => new Date(NOW + offsetMin * 60_000).toISOString();
const courier = (c: Partial<CourierInfo>): CourierInfo => ({ status: 'assigned', updatedAt: iso(-1), source: 'uber_eats', ...c });
const order = (status: StoredOrder['status'], timeline: OrderTimeline = {}, fulfillment: StoredOrder['fulfillment'] = 'delivery') => ({ status, fulfillment, timeline });

describe('courierWatchState', () => {
  it('no courier, an unassigned courier or a cancelled order: nothing to show', () => {
    expect(courierWatchState(order('accepted'), NOW)).toEqual({ kind: 'none', chime: false });
    expect(courierWatchState(order('accepted', { courier: courier({ status: 'unassigned' }) }), NOW).kind).toBe('none');
    expect(courierWatchState(order('cancelled', { courier: courier({ etaAt: iso(2) }) }), NOW).kind).toBe('none');
    expect(courierWatchState(order('dispatched', { dispatchedAt: iso(-3) }, 'pickup'), NOW).kind).toBe('none'); // customer took it
  });

  it('assigned: arrives around HH:MM, minutes rounded up, no chime', () => {
    const s = courierWatchState(order('accepted', { courier: courier({ etaAt: iso(12.2), name: 'Sam' }) }), NOW);
    expect(s).toMatchObject({ kind: 'assigned', minutes: 13, etaAt: iso(12.2), chime: false, courierName: 'Sam' });
    expect(courierWatchState(order('accepted', { courier: courier({}) }), NOW)).toMatchObject({ kind: 'assigned', chime: false });
  });

  it(`arriving: ETA at ${ARRIVING_MINUTES} min or less (or the platform says so) → highlighted with the chime`, () => {
    expect(courierWatchState(order('accepted', { courier: courier({ etaAt: iso(5) }) }), NOW)).toMatchObject({ kind: 'arriving', minutes: 5, chime: true });
    expect(courierWatchState(order('accepted', { courier: courier({ etaAt: iso(-2) }) }), NOW)).toMatchObject({ kind: 'arriving', minutes: 0, chime: true });
    expect(courierWatchState(order('accepted', { courier: courier({ status: 'arriving' }) }), NOW)).toMatchObject({ kind: 'arriving', chime: true });
    expect(courierWatchState(order('accepted', { courier: courier({ etaAt: iso(6) }) }), NOW).kind).toBe('assigned');
  });

  it('waiting: courier at the counter and the order is not ready → mm:ss since arrival', () => {
    const s = courierWatchState(order('accepted', { courier: courier({ status: 'at_store', updatedAt: new Date(NOW - 125_000).toISOString() }) }), NOW);
    expect(s).toMatchObject({ kind: 'waiting', seconds: 125, minutes: 2, chime: false });
    expect(mmss(s.seconds!)).toBe('02:05');
    // a minute later the timer moved on
    expect(courierWatchState(order('accepted', { courier: courier({ status: 'at_store', updatedAt: new Date(NOW - 125_000).toISOString() }) }), NOW + 60_000).seconds).toBe(185);
  });

  it('here: courier at the counter and the order is ready (status or readyAt)', () => {
    const c = courier({ status: 'at_store', updatedAt: iso(-1) });
    expect(courierWatchState(order('ready', { courier: c }), NOW).kind).toBe('here');
    expect(courierWatchState(order('accepted', { courier: c, readyAt: iso(-2) }), NOW).kind).toBe('here');
  });

  it('gone: left at HH:MM, planned (courier ETA, else ready target) vs actual', () => {
    const s = courierWatchState(order('dispatched', { courier: courier({ status: 'picked_up', etaAt: iso(-10), updatedAt: iso(-4) }), dispatchedAt: iso(-5) }), NOW);
    expect(s).toMatchObject({ kind: 'gone', actualAt: iso(-5), plannedAt: iso(-10), chime: false });
    const t = courierWatchState(order('ready', { courier: courier({ status: 'picked_up', updatedAt: iso(-3) }), readyTarget: iso(-8) }), NOW);
    expect(t).toMatchObject({ kind: 'gone', actualAt: iso(-3), plannedAt: iso(-8) });
  });

  it('mmss past an hour', () => {
    expect(mmss(3725)).toBe('1:02:05');
    expect(mmss(-4)).toBe('00:00');
  });
});

describe('chimeOnce', () => {
  it('chimes once per order id, never again, and never for a non-chiming state', () => {
    const mem = new Set<string>();
    expect(chimeOnce('o1', { chime: false }, mem)).toBe(false);
    expect(chimeOnce('o1', { chime: true }, mem)).toBe(true);
    expect(chimeOnce('o1', { chime: true }, mem)).toBe(false);
    expect(chimeOnce('o1', { chime: true }, mem)).toBe(false);
    expect(chimeOnce('o2', { chime: true }, mem)).toBe(true);
  });
});

describe('waiting timer survives a re-sent at_store update', () => {
  it('a second at_store update (new updatedAt) does not reset the timer seen on this screen', () => {
    const mem = new Map<string, number>();
    const first = { id: 'o-wait', ...order('accepted', { courier: courier({ status: 'at_store', updatedAt: new Date(NOW - 125_000).toISOString() }) }) };
    expect(courierWatchState(first, NOW, { memory: mem })).toMatchObject({ kind: 'waiting', seconds: 125 });
    // 30 s later the platform re-sends at_store (ETA refresh / same status): updatedAt jumps to "now"
    const again = { id: 'o-wait', ...order('accepted', { courier: courier({ status: 'at_store', updatedAt: new Date(NOW + 30_000).toISOString() }) }) };
    expect(courierWatchState(again, NOW + 30_000, { memory: mem })).toMatchObject({ kind: 'waiting', seconds: 155, since: new Date(NOW - 125_000).toISOString() });
  });

  it('counts from the first "courier" at_store event when the screen opens after the re-send', () => {
    const again = { id: 'o-late-open', ...order('accepted', { courier: courier({ status: 'at_store', updatedAt: new Date(NOW - 10_000).toISOString() }) }) };
    const events = [
      { type: 'courier', detail: { status: 'arriving' }, at: new Date(NOW - 400_000).toISOString() },
      { type: 'courier', detail: { status: 'at_store' }, at: new Date(NOW - 300_000).toISOString() },
      { type: 'courier', detail: { status: 'at_store' }, at: new Date(NOW - 10_000).toISOString() },
    ];
    expect(courierWatchState(again, NOW, { events, memory: new Map() })).toMatchObject({ kind: 'waiting', seconds: 300, minutes: 5 });
  });
});

describe('no late chime', () => {
  it('opening an order whose courier ETA already passed marks it chimed, silently', () => {
    const late = courierWatchState(order('accepted', { courier: courier({ etaAt: iso(-3) }) }), NOW);
    expect(etaPassed(late)).toBe(true);
    const mem = new Set<string>();
    expect(chimeOnce('o-late', late, mem, etaPassed(late))).toBe(false);
    expect(chimeOnce('o-late', late, mem)).toBe(false); // never chimes later either
    const near = courierWatchState(order('accepted', { courier: courier({ etaAt: iso(4) }) }), NOW);
    expect(etaPassed(near)).toBe(false);
    expect(chimeOnce('o-near', near, mem, etaPassed(near))).toBe(true);
  });
});
