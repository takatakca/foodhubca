// Kitchen order tools — the minutes each "Rupture" choice sends: counted at the tap from an absolute closing time, and
// "Aujourd'hui" without hours ends at the real local midnight, daylight-saving days included.
import { describe, expect, it } from 'vitest';
import { nextLocalMidnightMs, quick86Minutes } from '../lib/foodhub/order-tools/quick-86';

const TZ = 'America/Toronto';

describe('quick86Minutes', () => {
  const now = Date.parse('2026-10-16T20:00:00Z'); // 16:00 in Montréal
  const closesAt = '2026-10-17T03:00:00Z'; // 23:00

  it('4 h and "until I turn it back on" never depend on the hours', () => {
    expect(quick86Minutes('four', null, now, TZ)).toBe(240);
    expect(quick86Minutes('forever', null, now, TZ)).toBe(0);
  });

  it('"until closing" and "today" count from closesAt at the moment of the tap', () => {
    expect(quick86Minutes('close', closesAt, now, TZ)).toBe(420);
    expect(quick86Minutes('today', closesAt, now, TZ)).toBe(420);
    // Drawer left open 2 h: the 86 still ends at closing, not 2 h after it.
    const later = now + 2 * 3600_000;
    expect(quick86Minutes('close', closesAt, later, TZ)).toBe(300);
    expect(quick86Minutes('today', closesAt, later, TZ)).toBe(300);
  });

  it('after the closing time has passed, "until closing" is off and "today" falls back to midnight', () => {
    const afterClose = Date.parse('2026-10-17T03:30:00Z'); // 23:30
    expect(quick86Minutes('close', closesAt, afterClose, TZ)).toBeNull();
    expect(quick86Minutes('today', closesAt, afterClose, TZ)).toBe(30);
  });

  it('without hours: "until closing" is off, "today" runs to local midnight', () => {
    expect(quick86Minutes('close', null, now, TZ)).toBeNull();
    expect(quick86Minutes('today', null, now, TZ)).toBe(480);
    expect(quick86Minutes('today', 'not a date', now, TZ)).toBe(480);
  });
});

describe('nextLocalMidnightMs is DST-safe (not "+ 24 h")', () => {
  it('fall back (2026-11-01, a 25-hour day): from 00:30 EDT, midnight is 24 h 30 min away', () => {
    const now = Date.parse('2026-11-01T04:30:00Z'); // 00:30 EDT
    expect(new Date(nextLocalMidnightMs(now, TZ)).toISOString()).toBe('2026-11-02T05:00:00.000Z'); // 00:00 EST
    expect(quick86Minutes('today', null, now, TZ)).toBe(1470);
  });

  it('spring forward (2026-03-08, a 23-hour day): from 00:30 EST, midnight is 22 h 30 min away', () => {
    const now = Date.parse('2026-03-08T05:30:00Z'); // 00:30 EST
    expect(new Date(nextLocalMidnightMs(now, TZ)).toISOString()).toBe('2026-03-09T04:00:00.000Z'); // 00:00 EDT
    expect(quick86Minutes('today', null, now, TZ)).toBe(1350);
  });

  it('an ordinary day and the last minute before midnight', () => {
    expect(new Date(nextLocalMidnightMs(Date.parse('2026-10-16T20:00:00Z'), TZ)).toISOString()).toBe('2026-10-17T04:00:00.000Z');
    expect(quick86Minutes('today', null, Date.parse('2026-10-17T03:59:30Z'), TZ)).toBe(1);
  });
});
