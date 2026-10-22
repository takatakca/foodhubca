// Shared fixture of the storefront tests: a made-up menu (no real ids), fixed instants in Montréal time, hours helpers.
import { localWallToUtcMs } from '../../lib/foodhub/time';
import type { MasterMenu, WeeklyHours } from '../../lib/foodhub/types';

export const BRAND = 'Pi Pita';
export const SLUG = 'pi-pita';
export const LOC = 'NDG_MAIN';

/** Wednesday 2026-10-14 at hh:mm, Montréal time. */
export const at = (hh: number, mm = 0, day = 14) => localWallToUtcMs(2026, 10, day, hh, mm, 'America/Toronto');

export const everyDay = (open: string, close: string): WeeklyHours => Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, [{ open, close }]])) as unknown as WeeklyHours;

export function fixtureMenu(): MasterMenu {
  return {
    brandName: BRAND, updatedAt: '', posMerchantId: 'MID-FIXTURE',
    categories: [
      { ref: 'c-main', name: 'Mains', nameFr: 'Plats', sortOrder: 1 },
      { ref: 'c-bfast', name: 'Breakfast', nameFr: 'Déjeuners', sortOrder: 2, hours: everyDay('07:00', '11:00') },
      { ref: 'c-drinks', name: 'Drinks', nameFr: 'Boissons', sortOrder: 3 },
    ],
    items: [
      { ref: 'i-pita', name: 'Chicken pita', nameFr: 'Pita au poulet', description: 'Grilled chicken', price: 12.5, categoryRef: 'c-main', available: true, posItemRef: 'CLV-ITEM-PITA', note: 'operator only note', imageUrl: '/media/pita.jpg', tags: ['halal'], allergens: ['wheat'], modifierGroupRefs: ['g-size', 'g-extra', 'g-duo', 'g-trio'] },
      { ref: 'i-plate', name: 'Shish plate', nameFr: 'Assiette shish', price: 18, categoryRef: 'c-main', available: true, modifierGroupRefs: [] },
      { ref: 'i-out', name: 'Sold out wrap', price: 9, categoryRef: 'c-main', available: false, modifierGroupRefs: [] },
      { ref: 'i-sauce-only', name: 'Needs a sauce', price: 4, categoryRef: 'c-main', available: true, modifierGroupRefs: ['g-gone'] },
      { ref: 'i-beer', name: 'Beer', nameFr: 'Bière', price: 6, categoryRef: 'c-drinks', available: true, tags: ['alcohol'], modifierGroupRefs: [] },
      { ref: 'i-juice', name: 'Juice', nameFr: 'Jus', price: 3, categoryRef: 'c-drinks', available: true, modifierGroupRefs: [] },
      { ref: 'i-eggs', name: 'Eggs', nameFr: 'Œufs', price: 8, categoryRef: 'c-bfast', available: true, modifierGroupRefs: [] },
    ],
    modifierGroups: [
      { ref: 'g-size', name: 'Size', nameFr: 'Format', min: 1, max: 1, modifiers: [
        { ref: 'm-reg', name: 'Regular', nameFr: 'Régulier', price: 0, available: true, posModifierRef: 'CLV-MOD-REG' },
        { ref: 'm-lg', name: 'Large', nameFr: 'Grand', price: 3, available: true, posModifierRef: 'CLV-MOD-LG' },
      ] },
      { ref: 'g-extra', name: 'Extras', nameFr: 'Extras', min: 0, max: 2, modifiers: [
        { ref: 'm-cheese', name: 'Cheese', nameFr: 'Fromage', price: 1, available: true },
        { ref: 'm-garlic', name: 'Garlic sauce', nameFr: 'Sauce à l’ail', price: 0.5, available: true },
        { ref: 'm-hot', name: 'Hot sauce', nameFr: 'Sauce piquante', price: 0.25, available: false },
      ] },
      { ref: 'g-duo', name: 'Duo — Breuvage', min: 0, max: 1, modifiers: [
        { ref: 'd-pepsi', name: 'Pepsi', price: 2.5, available: true, posModifierRef: 'CLV-MOD-DUO-PEPSI' },
        { ref: 'd-7up', name: '7UP', price: 2.5, available: true, posModifierRef: 'CLV-MOD-DUO-7UP' },
      ] },
      { ref: 'g-trio', name: 'Trio — Frite + Breuvage', min: 0, max: 1, modifiers: [
        { ref: 't-pepsi', name: 'Pepsi', price: 5.42, available: true, posModifierRef: 'CLV-MOD-TRIO-PEPSI' },
      ] },
      { ref: 'g-gone', name: 'Sauce', min: 1, max: 1, modifiers: [{ ref: 'm-gone', name: 'Only sauce', price: 0, available: false }] },
    ],
    unavailableByLocation: { [LOC]: ['i-plate'] },
  };
}
