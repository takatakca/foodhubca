// Store availability center — "rouvre à …": next opening / closing from the Food Hub hours.
import { beforeAll, describe, expect, it } from 'vitest';
import { enTime, frTime, nextOpening } from '../lib/foodhub/store-availability/next-open';
import { localWallToUtcMs } from '../lib/foodhub/time';
import type { DayKey, Holiday, WeeklyHours } from '../lib/foodhub/types';

const TZ = 'America/Toronto';
const DAYS: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const week = (open: string, close: string, except: DayKey[] = []): WeeklyHours =>
  Object.fromEntries(DAYS.map((d) => [d, except.includes(d) ? [] : [{ open, close }]])) as unknown as WeeklyHours;
const at = (y: number, m: number, d: number, h: number, min = 0) => localWallToUtcMs(y, m, d, h, min, TZ);
const holiday = (date: string, closed: boolean, slots?: Array<{ open: string; close: string }>): Holiday => ({ id: date, date, name: 'Test', locationCodes: [], closed, ...(slots ? { slots } : {}) });

beforeAll(() => { process.env.FOODHUB_TIMEZONE = TZ; });

describe('nextOpening — overnight hours (NDG 16:00–03:00)', () => {
  const ndg = week('16:00', '03:00');
  it('after midnight it is still open and closes at 3 h', () => {
    const now = at(2026, 10, 16, 1, 30); // Friday 01:30, the Thursday night
    const r = nextOpening(ndg, [], now, TZ);
    expect(r).toMatchObject({ known: true, openNow: true });
    expect(r.closesAt).toBe(at(2026, 10, 16, 3, 0));
    expect(r.label).toEqual({ fr: 'Ferme à 3 h', en: 'Closes at 3 am' });
  });
  it('in the morning it opens today at 16 h', () => {
    const r = nextOpening(ndg, [], at(2026, 10, 16, 10, 0), TZ);
    expect(r.openNow).toBe(false);
    expect(r.nextOpenAt).toBe(at(2026, 10, 16, 16, 0));
    expect(r.label).toEqual({ fr: 'Ouvre aujourd’hui à 16 h', en: 'Opens today at 4 pm' });
  });
  it('in the evening the night is one opening (closes at 3 h the next morning)', () => {
    const r = nextOpening(ndg, [], at(2026, 10, 16, 22, 0), TZ);
    expect(r.closesAt).toBe(at(2026, 10, 17, 3, 0));
  });
});

describe('nextOpening — days, holidays, labels', () => {
  it('tomorrow and a named weekday', () => {
    const daily = week('09:00', '17:00');
    expect(nextOpening(daily, [], at(2026, 10, 16, 18, 0), TZ).label).toEqual({ fr: 'Ouvre demain à 9 h', en: 'Opens tomorrow at 9 am' });
    const noMonday = week('09:00', '17:00', ['monday']);
    const r = nextOpening(noMonday, [], at(2026, 10, 18, 18, 0), TZ); // Sunday evening, closed Monday
    expect(r.nextOpenAt).toBe(at(2026, 10, 20, 9, 0));
    expect(r.label).toEqual({ fr: 'Ouvre mardi à 9 h', en: 'Opens Tuesday at 9 am' });
  });
  it('a closed holiday is skipped', () => {
    const r = nextOpening(week('09:00', '17:00'), [holiday('2026-12-25', true)], at(2026, 12, 24, 20, 0), TZ);
    expect(r.nextOpenAt).toBe(at(2026, 12, 26, 9, 0));
    expect(r.label.fr).toBe('Ouvre samedi à 9 h');
  });
  it('holiday special hours replace the day', () => {
    const h = [holiday('2026-12-24', false, [{ open: '10:00', close: '14:30' }])];
    expect(nextOpening(week('09:00', '17:00'), h, at(2026, 12, 24, 8, 0), TZ).label).toEqual({ fr: 'Ouvre aujourd’hui à 10 h', en: 'Opens today at 10 am' });
    const open = nextOpening(week('09:00', '17:00'), h, at(2026, 12, 24, 12, 0), TZ);
    expect(open.closesAt).toBe(at(2026, 12, 24, 14, 30));
    expect(open.label).toEqual({ fr: 'Ferme à 14 h 30', en: 'Closes at 2:30 pm' });
  });
  it('hours never set, and no opening at all', () => {
    expect(nextOpening(null, [], Date.now(), TZ)).toMatchObject({ known: false, openNow: false, label: { fr: 'Heures non définies', en: 'Hours not set' } });
    const closed = nextOpening(week('09:00', '17:00', DAYS), [], at(2026, 10, 16, 12, 0), TZ);
    expect(closed).toMatchObject({ known: true, openNow: false });
    expect(closed.nextOpenAt).toBeUndefined();
  });
  it('open all week says "Ouvert" without a closing time', () => {
    const r = nextOpening(week('00:00', '23:59'), [], at(2026, 10, 16, 12, 0), TZ);
    expect(r).toMatchObject({ openNow: true, label: { fr: 'Ouvert', en: 'Open' } });
    expect(r.closesAt).toBeUndefined();
  });
  it('time formats', () => {
    expect(frTime(at(2026, 10, 16, 16, 30), TZ)).toBe('16 h 30');
    expect(enTime(at(2026, 10, 16, 16, 30), TZ)).toBe('4:30 pm');
    expect(enTime(at(2026, 10, 16, 0, 0), TZ)).toBe('12 am');
    expect(frTime(at(2026, 10, 16, 9, 0), TZ)).toBe('9 h');
  });
});

describe('nextOpening — DST days', () => {
  it('fall back (2026-11-01): the night closes at 3 h standard time', () => {
    const r = nextOpening(week('16:00', '03:00'), [], at(2026, 11, 1, 0, 30), TZ);
    expect(r.openNow).toBe(true);
    expect(new Date(r.closesAt!).toISOString()).toBe('2026-11-01T08:00:00.000Z'); // 03:00 EST = 08:00 UTC
  });
  it('spring forward (2026-03-08): opens at 16 h daylight time', () => {
    const r = nextOpening(week('16:00', '03:00'), [], at(2026, 3, 8, 10, 0), TZ);
    expect(new Date(r.nextOpenAt!).toISOString()).toBe('2026-03-08T20:00:00.000Z'); // 16:00 EDT = 20:00 UTC
    expect(r.label.fr).toBe('Ouvre aujourd’hui à 16 h');
  });
});
