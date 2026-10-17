// Hours as the phone assistants hear them: today / tomorrow per kitchen, overnight slots joined (NDG open late until
// 3:15 the next morning), Saint-Léonard closing at 23:00, holidays, and hours never set (the assistant must not claim
// the kitchen is open, and a phone order is refused).
import { describe, expect, it } from 'vitest';
import { brandHoursState, describeHours } from '../lib/foodhub/hours';
import type { HoursConfig, WeeklyHours } from '../lib/foodhub/types';

const every = (open: string, close: string): WeeklyHours => Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, [{ open, close }]])) as unknown as WeeklyHours;
const CFG: HoursConfig = { locations: { NDG: every('16:30', '03:15'), SAINT_LEONARD: every('09:00', '23:00') }, brands: {}, holidays: [] };
// Thursday 2026-10-15, Montréal (EDT, UTC-4).
const local = (hhmm: string, day = '2026-10-15') => Date.parse(`${day}T${hhmm}:00-04:00`);

describe('describeHours', () => {
  it('NDG late night: open at 23:30, closes 03:15 the next morning; the night is one slot', () => {
    const h = describeHours(CFG, ['Pi Pita'], 'NDG', local('23:30'));
    expect(h.state).toBe('open');
    expect(h.text).toContain('today Thursday 16:30 to 03:15 (next morning)');
    expect(h.text).toContain('tomorrow Friday 16:30 to 03:15 (next morning)');
    expect(h.text).toContain('OPEN now, closes tomorrow at 03:15');
    expect(h.text).not.toMatch(/24 ?h|24\/7|23:59|00:00/);
  });

  it('NDG after closing: 03:30 Friday is closed and opens at 16:30', () => {
    const h = describeHours(CFG, ['Pi Pita'], 'NDG', local('03:30', '2026-10-16'));
    expect(h.state).toBe('closed');
    expect(h.text).toContain('CLOSED now, opens today at 16:30');
    expect(brandHoursState(CFG, 'Pi Pita', 'NDG', local('02:00', '2026-10-16'))).toBe('open');
    expect(brandHoursState(CFG, 'Pi Pita', 'NDG', local('03:30', '2026-10-16'))).toBe('closed');
  });

  it('Saint-Léonard closes at 23:00', () => {
    expect(describeHours(CFG, ['Po Poulet'], 'SAINT_LEONARD', local('22:59')).state).toBe('open');
    const late = describeHours(CFG, ['Po Poulet'], 'SAINT_LEONARD', local('23:01'));
    expect(late.state).toBe('closed');
    expect(late.text).toContain('today Thursday 09:00 to 23:00');
    expect(late.text).toContain('opens tomorrow at 09:00');
  });

  it('a closed holiday and hours never set', () => {
    const cfg: HoursConfig = { ...CFG, holidays: [{ date: '2026-10-15', name: 'Fermeture', closed: true, locationCodes: ['SAINT_LEONARD'], slots: [] } as any] };
    const h = describeHours(cfg, ['Po Poulet'], 'SAINT_LEONARD', local('12:00'));
    expect(h.state).toBe('closed');
    expect(h.text).toContain('today Thursday closed (holiday: Fermeture)');
    const none = describeHours({ locations: {}, brands: {}, holidays: [] }, ['Pi Pita'], 'NDG', local('12:00'));
    expect(none.state).toBe('unknown');
    expect(none.text).toMatch(/NOT SET/);
    expect(brandHoursState({ locations: {}, brands: {}, holidays: [] }, 'Pi Pita', 'NDG', local('12:00'))).toBe('unknown');
  });

  it('an all-day week is "open all day" (never a round-the-clock claim)', () => {
    const h = describeHours({ locations: { X1: every('00:00', '23:59') }, brands: {}, holidays: [] }, ['B'], 'X1', local('12:00'));
    expect(h.state).toBe('open');
    expect(h.text).toContain('open all day');
    expect(h.text).not.toMatch(/24 ?h|24\/7|24 hours/i);
  });
});
