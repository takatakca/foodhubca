// Brand + location matching for platform store names and addresses. Pure (no I/O): used by Uber Eats store
// provisioning (adapters/uber-provision.ts) and by the offline finance report (finance/stores.ts).

export const normName = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** Other names the platforms use for your brands (Uber Eats store names differ from DoorDash ones). */
export const BRAND_ALIASES: Record<string, string[]> = {
  'Gateau Montreal': ['Gateaux Montreal', 'Gateaux Montréal', 'Gâteau Montréal'],
  'Nutrition Shake': ['Nutri Shake', 'Nutrishake'],
  'Cafe Bolon': ['Bolon Cafe', 'Bolon Café', 'Café Bolon'],
  OOeuf: ["O'Oeufs", 'O Oeufs', 'OOeufs', 'Ooeuf'],
  'Bin molle & Bin Dure': ['Bin Molle Bin Dure', 'Binmolle Bindure'],
  'Dejeuner & Dinner': ['Dejeuner et Dinner', 'Déjeuner & Dîner'],
};

/**
 * Other civic numbers the platforms use for a location's building. Saint-Léonard's public address is 5839 Rue
 * Jean-Talon E (owner, 2026-10-09; data/actual/locations.json); 5837 is the next unit of the same kitchen, still on
 * some platform store records.
 */
export const LOCATION_NUMBER_ALIASES: Record<string, string[]> = { SAINT_LEONARD: ['5837'] };

export interface LocationRef { code: string; address_line_1: string }

/** "6280 Av Somerled" → "somerled": the street name without the number or the street type, for a fallback match. */
const streetOf = (line: string) => normName(line.replace(/^\s*\d+[a-z]?\s+/i, '').replace(/\b(av|ave|avenue|rue|boul|boulevard|ch|chemin|e|o|est|ouest)\b\.?/gi, ' '));

/**
 * Suggests the brand (longest brand name or alias found in the store name) and location (civic number in the address,
 * then a street that only one location is on, then the neighbourhood name). The owner always confirms.
 */
export function matchBrandLocation(name: string, address: string, brands: string[], locations: LocationRef[]): { suggestedBrand?: string; suggestedLocation?: string } {
  const n = normName(name);
  const names = brands.filter((b) => b !== 'Too Good To Go').flatMap((b) => [b, ...(BRAND_ALIASES[b] ?? [])].map((alias) => ({ brand: b, alias: normName(alias) })));
  // "Crèmerie Bin Molle Bin Dure" must win over "Bin molle & Bin Dure" when both match: longest match first.
  const brand = names.filter((x) => x.alias && n.includes(x.alias)).sort((a, b) => b.alias.length - a.alias.length)[0]?.brand;
  const text = `${address} ${name}`;
  const numbers = (l: LocationRef) => [l.address_line_1.split(' ')[0], ...(LOCATION_NUMBER_ALIASES[l.code] ?? [])];
  let suggestedLocation = locations.find((l) => numbers(l).some((num) => new RegExp(`\\b${num}\\b`).test(text)))?.code;
  if (!suggestedLocation && address) {
    // Same street, unknown number: only when a single location is on that street (two kitchens share Somerled).
    const a = normName(address);
    const onStreet = locations.filter((l) => streetOf(l.address_line_1) && a.includes(streetOf(l.address_line_1)));
    if (onStreet.length === 1) suggestedLocation = onStreet[0].code;
  }
  if (!suggestedLocation && /hochelaga/i.test(text)) suggestedLocation = 'HOCHELAGA';
  if (!suggestedLocation && /l[eé]onard/i.test(text)) suggestedLocation = 'SAINT_LEONARD';
  return { suggestedBrand: brand, suggestedLocation };
}
