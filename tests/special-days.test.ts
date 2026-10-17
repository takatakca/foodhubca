// Store availability center — special days in one tap (saved as holidays; publishing stays on /stores/hours).
import { beforeEach, describe, expect, it } from 'vitest';
import { addSpecialDays, nthSunday, specialDayPresets } from '../lib/foodhub/store-availability/special-days';
import { getHours, saveHours } from '../lib/foodhub/hours';
import { getRepo } from '../lib/foodhub/repo';

const PERSON = { username: 'mona', name: 'Mona', source: 'dashboard' as const };

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
});

describe('special day presets', () => {
  it('dates per year (Mother’s Day = 2nd Sunday of May, Father’s Day = 3rd Sunday of June)', () => {
    const by = (y: number) => Object.fromEntries(specialDayPresets(y).map((p) => [p.id, p.date]));
    expect(by(2026)).toEqual({
      valentines: '2026-02-14', mothers_day: '2026-05-10', fathers_day: '2026-06-21', halloween: '2026-10-31',
      remembrance: '2026-11-11', christmas_eve: '2026-12-24', boxing_day: '2026-12-26', new_years_eve: '2026-12-31',
    });
    expect(by(2027)).toMatchObject({ mothers_day: '2027-05-09', fathers_day: '2027-06-20' });
    expect(by(2028)).toMatchObject({ mothers_day: '2028-05-14', fathers_day: '2028-06-18' });
    expect(nthSunday(2026, 3, 2)).toBe(8);
    const list = specialDayPresets(2026);
    expect(list.map((p) => p.date)).toEqual([...list.map((p) => p.date)].sort());
    for (const p of list) { expect(p.nameFr).toBeTruthy(); expect(p.nameEn).toBeTruthy(); expect(p.suggestion.fr).toBeTruthy(); expect(p.suggestion.en).toBeTruthy(); }
    expect(list.find((p) => p.id === 'christmas_eve')?.nameFr).toBe('Veille de Noël');
  });
});

describe('addSpecialDays', () => {
  it('merges with the saved hours without duplicates, and logs it', async () => {
    await saveHours({ locations: {}, brands: {}, holidays: [{ id: 'qc-xmas', date: '2026-12-25', name: 'Noël', locationCodes: [], closed: true }] });
    const r = await addSpecialDays(['christmas_eve', 'new_years_eve'], 2026, { slots: [{ open: '11:00', close: '18:00' }] }, ['NDG_MAIN'], PERSON);
    expect(r.added.map((x) => x.date)).toEqual(['2026-12-24', '2026-12-31']);
    expect(r.added[0]).toMatchObject({ name: 'Veille de Noël', closed: false, slots: [{ open: '11:00', close: '18:00' }], locationCodes: ['NDG_MAIN'] });
    const again = await addSpecialDays(['christmas_eve', 'halloween'], 2026, { closed: true }, ['NDG_MAIN'], PERSON);
    expect(again.added.map((x) => x.date)).toEqual(['2026-10-31']);
    expect(again.skipped).toEqual([expect.objectContaining({ id: 'christmas_eve', date: '2026-12-24' })]);
    // Every kitchen clashes with a kitchen's own day; another kitchen does not.
    expect((await addSpecialDays(['christmas_eve'], 2026, { closed: true }, [], PERSON)).added).toEqual([]);
    expect((await addSpecialDays(['christmas_eve'], 2026, { closed: true }, ['HOCHELAGA'], PERSON)).added.length).toBe(1);
    const hours = await getHours();
    expect(hours.holidays.map((x) => x.date)).toEqual(['2026-10-31', '2026-12-24', '2026-12-24', '2026-12-25', '2026-12-31']);
    expect(new Set(hours.holidays.map((x) => x.id)).size).toBe(hours.holidays.length);
    const log = await getRepo().listActivity({ kinds: ['hours'] });
    expect(log.filter((a) => a.action === 'special_days_added').length).toBe(3);
  });

  it('validates: hours that cross midnight, no hours, unknown days, bad year', async () => {
    await expect(addSpecialDays(['halloween'], 2026, { slots: [{ open: '18:00', close: '02:00' }] }, [], PERSON)).rejects.toThrow(/cross midnight/);
    await expect(addSpecialDays(['halloween'], 2026, { slots: [] }, [], PERSON)).rejects.toThrow(/special hours/);
    await expect(addSpecialDays(['easter'], 2026, { closed: true }, [], PERSON)).rejects.toThrow(/Unknown/);
    await expect(addSpecialDays([], 2026, { closed: true }, [], PERSON)).rejects.toThrow(/at least one/);
    await expect(addSpecialDays(['halloween'], 1999, { closed: true }, [], PERSON)).rejects.toThrow(/year/);
    expect((await getHours()).holidays).toEqual([]);
  });
});
