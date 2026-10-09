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

export interface LocationRef { code: string; address_line_1: string }

/** Suggests the brand (longest brand name or alias found in the store name) and location (street number in the address). */
export function matchBrandLocation(name: string, address: string, brands: string[], locations: LocationRef[]): { suggestedBrand?: string; suggestedLocation?: string } {
  const n = normName(name);
  const names = brands.filter((b) => b !== 'Too Good To Go').flatMap((b) => [b, ...(BRAND_ALIASES[b] ?? [])].map((alias) => ({ brand: b, alias: normName(alias) })));
  // "Crèmerie Bin Molle Bin Dure" must win over "Bin molle & Bin Dure" when both match: longest match first.
  const brand = names.filter((x) => x.alias && n.includes(x.alias)).sort((a, b) => b.alias.length - a.alias.length)[0]?.brand;
  const text = `${address} ${name}`;
  const loc = locations.find((l) => new RegExp(`\\b${l.address_line_1.split(' ')[0]}\\b`).test(text));
  let suggestedLocation = loc?.code;
  if (!suggestedLocation && /hochelaga/i.test(text)) suggestedLocation = 'HOCHELAGA';
  if (!suggestedLocation && /l[eé]onard/i.test(text)) suggestedLocation = 'SAINT_LEONARD';
  return { suggestedBrand: brand, suggestedLocation };
}
