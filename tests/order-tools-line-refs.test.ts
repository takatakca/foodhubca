// Kitchen order tools — "Rupture" from an order line: which menu item / option each line is, and minutes until close.
import { describe, expect, it } from 'vitest';
import { closesAtMs, coreName, minutesUntilClose, plainName, resolveLineRefs } from '../lib/foodhub/order-tools/line-refs';
import { localWallToUtcMs } from '../lib/foodhub/time';
import type { HoursConfig, MasterMenu, OrderLine, WeeklyHours } from '../lib/foodhub/types';

const TZ = 'America/Toronto';

const menu: MasterMenu = {
  brandName: 'Test Poulet',
  categories: [{ ref: 'c1', name: 'Mains', sortOrder: 0 }],
  items: [
    { ref: 'it-poutine', name: 'Poutine', nameFr: 'Poutine', price: 10, categoryRef: 'c1', available: true, posItemRef: 'CLV-POUT', modifierGroupRefs: ['g-sauce', 'g-size'] },
    { ref: 'it-creme', name: 'Crème brûlée', price: 6, categoryRef: 'c1', available: true, modifierGroupRefs: [] },
    { ref: 'it-wings', name: 'Chicken wings', nameFr: 'Ailes de poulet', price: 12, categoryRef: 'c1', available: true, modifierGroupRefs: ['g-sauce'] },
    { ref: 'it-pita-a', name: 'Pita', price: 9, categoryRef: 'c1', available: true, modifierGroupRefs: [] },
    { ref: 'it-pita-b', name: 'Pita', price: 11, categoryRef: 'c1', available: true, modifierGroupRefs: [] },
  ],
  modifierGroups: [
    { ref: 'g-sauce', name: 'Sauce', min: 0, max: 2, modifiers: [
      { ref: 'm-bbq', name: 'BBQ', price: 0, available: true, posModifierRef: 'CLV-BBQ' },
      { ref: 'm-epicee', name: 'Épicée', nameFr: 'Épicée', price: 0.5, available: true },
    ] },
    { ref: 'g-size', name: 'Size', min: 1, max: 1, modifiers: [{ ref: 'm-large', name: 'Large', price: 3, available: true }] },
    { ref: 'g-other', name: 'Other', min: 0, max: 1, modifiers: [{ ref: 'm-cheese', name: 'Extra cheese', price: 2, available: true, posModifierRef: 'CLV-CHEESE' }] },
  ],
  updatedAt: '2026-10-01T00:00:00Z',
};

const line = (l: Partial<OrderLine> & { name: string }): OrderLine => ({ quantity: 1, unitPrice: 0, total: 0, modifiers: [], ...l });

describe('names', () => {
  it('drops accents, case, punctuation and size words', () => {
    expect(plainName('  Crème   BRÛLÉE! ')).toBe('creme brulee');
    expect(coreName('Grande poutine')).toBe('poutine');
    expect(coreName('Poutine (Large)')).toBe('poutine');
    expect(coreName('Large')).toBe('large'); // only size words: keep them
  });
});

describe('resolveLineRefs', () => {
  it('matches the merchant-supplied id first, then the Clover id, then the name', () => {
    const r = resolveLineRefs({ lines: [
      line({ name: 'Anything', externalId: 'it-wings' }),
      line({ name: 'Mystery', posItemRef: 'CLV-POUT' }),
      line({ name: 'creme brulee' }),
    ] }, menu);
    expect(r.map((x) => [x.index, x.itemRef, x.match])).toEqual([[0, 'it-wings', 'ref'], [1, 'it-poutine', 'pos'], [2, 'it-creme', 'name']]);
  });

  it('ignores accents and size words, and knows the French name', () => {
    const r = resolveLineRefs({ lines: [line({ name: 'GRANDE Poutine' }), line({ name: 'Ailes de poulet' }), line({ name: 'Creme Brulee (petite)' })] }, menu);
    expect(r.map((x) => x.itemRef)).toEqual(['it-poutine', 'it-wings', 'it-creme']);
    expect(r.every((x) => x.match === 'name')).toBe(true);
  });

  it('matches options by id, Clover id or name — inside the item’s own groups', () => {
    const [r] = resolveLineRefs({ lines: [line({ name: 'Poutine', externalId: 'it-poutine', modifiers: [
      { name: 'Barbecue', posModifierRef: 'CLV-BBQ', quantity: 1, unitPrice: 0 },
      { name: 'epicee', quantity: 1, unitPrice: 0 },
      { name: 'x', externalId: 'm-large', quantity: 1, unitPrice: 0 },
      { name: 'Extra cheese', quantity: 1, unitPrice: 0 }, // exists on the menu, but not in this item's groups
    ] })] }, menu);
    expect(r.modifierRefs).toEqual([
      { name: 'Barbecue', ref: 'm-bbq', match: 'pos' },
      { name: 'epicee', ref: 'm-epicee', match: 'name' },
      { name: 'x', ref: 'm-large', match: 'ref' },
      { name: 'Extra cheese', match: 'none' },
    ]);
  });

  it('an unknown or ambiguous line is "none" (never a guess); its options still match by id only', () => {
    const r = resolveLineRefs({ lines: [
      line({ name: 'Pizza hawaïenne' }),
      line({ name: 'Pita' }), // two items called Pita
      line({ name: 'Unknown', modifiers: [{ name: 'Cheese', posModifierRef: 'CLV-CHEESE', quantity: 1, unitPrice: 0 }, { name: 'BBQ', quantity: 1, unitPrice: 0 }] }),
    ] }, menu);
    expect(r[0]).toMatchObject({ match: 'none' });
    expect(r[0].itemRef).toBeUndefined();
    expect(r[1]).toMatchObject({ match: 'none' });
    expect(r[2].modifierRefs).toEqual([{ name: 'Cheese', ref: 'm-cheese', match: 'pos' }, { name: 'BBQ', match: 'none' }]);
  });

  it('no menu: every line and option is unmatched', () => {
    const r = resolveLineRefs({ lines: [line({ name: 'Poutine', modifiers: [{ name: 'BBQ', quantity: 1, unitPrice: 0 }] })] }, null);
    expect(r).toEqual([{ index: 0, name: 'Poutine', match: 'none', modifierRefs: [{ name: 'BBQ', match: 'none' }] }]);
  });
});

describe('minutesUntilClose', () => {
  const week = (open: string, close: string): WeeklyHours => Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, [{ open, close }]])) as unknown as WeeklyHours;
  const cfg = (w: WeeklyHours, extra: Partial<HoursConfig> = {}): HoursConfig => ({ locations: { NDG: w }, brands: {}, holidays: [], ...extra });
  // Friday 2026-10-16 (EDT)
  const at = (d: number, h: number, m = 0) => localWallToUtcMs(2026, 10, d, h, m, TZ);

  it('counts down to the closing time of today’s slot', () => {
    expect(minutesUntilClose(cfg(week('11:00', '22:00')), 'Test Poulet', 'NDG', at(16, 20, 30), TZ)).toBe(90);
  });

  it('handles a 03:00 close after midnight (one night, not two slots)', () => {
    const c = cfg(week('16:30', '03:00'));
    expect(minutesUntilClose(c, 'Test Poulet', 'NDG', at(16, 23, 0), TZ)).toBe(240);
    expect(minutesUntilClose(c, 'Test Poulet', 'NDG', at(17, 1, 0), TZ)).toBe(120);
    expect(minutesUntilClose(c, 'Test Poulet', 'NDG', at(17, 10, 0), TZ)).toBeNull(); // closed in the morning
  });

  it('closesAtMs gives the absolute closing minute (the drawer counts the minutes at the tap)', () => {
    const c = cfg(week('16:30', '03:00'));
    expect(closesAtMs(c, 'Test Poulet', 'NDG', at(16, 23, 0), TZ)).toBe(at(17, 3, 0));
    expect(closesAtMs(c, 'Test Poulet', 'NDG', at(17, 1, 0), TZ)).toBe(at(17, 3, 0));
    expect(closesAtMs(c, 'Test Poulet', 'NDG', at(17, 10, 0), TZ)).toBeNull();
  });

  it('brand hours win over the kitchen’s; a closed holiday means closed; no hours = unknown', () => {
    const c = cfg(week('11:00', '22:00'), { brands: { 'Test Poulet': week('11:00', '21:00') } });
    expect(minutesUntilClose(c, 'Test Poulet', 'NDG', at(16, 20, 0), TZ)).toBe(60);
    expect(minutesUntilClose(c, 'Other', 'NDG', at(16, 20, 0), TZ)).toBe(120);
    const holiday = cfg(week('11:00', '22:00'), { holidays: [{ id: 'h', date: '2026-10-16', name: 'Fête', locationCodes: [], closed: true }] });
    expect(minutesUntilClose(holiday, 'Test Poulet', 'NDG', at(16, 20, 0), TZ)).toBeNull();
    expect(minutesUntilClose({ locations: {}, brands: {}, holidays: [] }, 'Test Poulet', 'NDG', at(16, 20, 0), TZ)).toBeNull();
  });
});
