// Canadian sales taxes on prepared food, province by province (ON2GO is Canada only, Québec first: owner's direction
// of 2026-10-29). One table, one rounding rule, used by direct-order totals, the storefront, delivery quotes and the
// finance split. Rates as published for 2026 (canada.ca GST/HST rates; each province's own PST/RST/QST page).
//
// Prepared food (restaurant meals, takeout) is taxed at the full rate everywhere, with one exception: British Columbia's
// PST does not apply to restaurant meals (only to liquor), so a BC kitchen charges GST alone. Clover keeps the tax rates
// that its payment page applies (lib/foodhub/pos/clover-checkout.ts); this table is what Food Hub shows and quotes.

export const PROVINCES = ['QC', 'ON', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'YT', 'NT', 'NU'] as const;
export type Province = (typeof PROVINCES)[number];

export type TaxCode = 'GST' | 'HST' | 'QST' | 'PST' | 'RST';

export interface TaxComponent {
  code: TaxCode;
  /** As shown to customers: FR uses the French acronyms (TPS, TVH, TVQ, TVP). */
  label: { fr: string; en: string };
  /** Rate as a fraction (0.09975). */
  rate: number;
  /** Whether it applies to prepared food (restaurant meals, takeout). */
  preparedFood: boolean;
}

export interface ProvinceTaxes {
  code: Province;
  name: { fr: string; en: string };
  components: TaxComponent[];
}

const GST: TaxComponent = { code: 'GST', label: { fr: 'TPS', en: 'GST' }, rate: 0.05, preparedFood: true };
const hst = (rate: number): TaxComponent => ({ code: 'HST', label: { fr: 'TVH', en: 'HST' }, rate, preparedFood: true });

export const PROVINCE_TAXES: Record<Province, ProvinceTaxes> = {
  QC: { code: 'QC', name: { fr: 'Québec', en: 'Quebec' }, components: [GST, { code: 'QST', label: { fr: 'TVQ', en: 'QST' }, rate: 0.09975, preparedFood: true }] },
  ON: { code: 'ON', name: { fr: 'Ontario', en: 'Ontario' }, components: [hst(0.13)] },
  BC: { code: 'BC', name: { fr: 'Colombie-Britannique', en: 'British Columbia' }, components: [GST, { code: 'PST', label: { fr: 'TVP', en: 'PST' }, rate: 0.07, preparedFood: false }] },
  AB: { code: 'AB', name: { fr: 'Alberta', en: 'Alberta' }, components: [GST] },
  MB: { code: 'MB', name: { fr: 'Manitoba', en: 'Manitoba' }, components: [GST, { code: 'RST', label: { fr: 'TVD', en: 'RST' }, rate: 0.07, preparedFood: true }] },
  SK: { code: 'SK', name: { fr: 'Saskatchewan', en: 'Saskatchewan' }, components: [GST, { code: 'PST', label: { fr: 'TVP', en: 'PST' }, rate: 0.06, preparedFood: true }] },
  NS: { code: 'NS', name: { fr: 'Nouvelle-Écosse', en: 'Nova Scotia' }, components: [hst(0.14)] },
  NB: { code: 'NB', name: { fr: 'Nouveau-Brunswick', en: 'New Brunswick' }, components: [hst(0.15)] },
  NL: { code: 'NL', name: { fr: 'Terre-Neuve-et-Labrador', en: 'Newfoundland and Labrador' }, components: [hst(0.15)] },
  PE: { code: 'PE', name: { fr: 'Île-du-Prince-Édouard', en: 'Prince Edward Island' }, components: [hst(0.15)] },
  YT: { code: 'YT', name: { fr: 'Yukon', en: 'Yukon' }, components: [GST] },
  NT: { code: 'NT', name: { fr: 'Territoires du Nord-Ouest', en: 'Northwest Territories' }, components: [GST] },
  NU: { code: 'NU', name: { fr: 'Nunavut', en: 'Nunavut' }, components: [GST] },
};

export const DEFAULT_PROVINCE: Province = 'QC';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100 || 0;
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

/** `qc`, ` Qc `, `Québec`, `Quebec`, `Ontario`… → a province code; null when it is none of them. */
export function parseProvince(value: unknown): Province | null {
  if (typeof value !== 'string') return null;
  const v = plain(value);
  if ((PROVINCES as readonly string[]).includes(v)) return v as Province;
  for (const p of PROVINCES) {
    const n = PROVINCE_TAXES[p].name;
    if (plain(n.fr) === v || plain(n.en) === v) return p;
  }
  return null;
}

/** The province a Canadian postal code belongs to (first letter; X0A/X0B/X0C = Nunavut). Null when unreadable. */
export function provinceFromPostalCode(postalCode: unknown): Province | null {
  if (typeof postalCode !== 'string') return null;
  const p = postalCode.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]\d[A-Z]/.test(p)) return null;
  const first = p[0];
  if (first === 'X') return /^X0[ABC]/.test(p) ? 'NU' : 'NT';
  const map: Record<string, Province> = { A: 'NL', B: 'NS', C: 'PE', E: 'NB', G: 'QC', H: 'QC', J: 'QC', K: 'ON', L: 'ON', M: 'ON', N: 'ON', P: 'ON', R: 'MB', S: 'SK', T: 'AB', V: 'BC', Y: 'YT' };
  return map[first] ?? null;
}

/** A kitchen's province: what was typed, else its postal code, else Québec. */
export function locationProvince(loc: { province?: string | null; postalCode?: string | null } | null | undefined): Province {
  return parseProvince(loc?.province) ?? provinceFromPostalCode(loc?.postalCode) ?? DEFAULT_PROVINCE;
}

/** The tax components that apply to prepared food in a province (BC: GST only). */
export function foodTaxComponents(province: Province): TaxComponent[] {
  return PROVINCE_TAXES[province].components.filter((c) => c.preparedFood);
}

/** Combined rate on prepared food, as a fraction (QC 0.14975, ON 0.13, BC 0.05…). */
export function foodTaxRate(province: Province): number {
  return Math.round(foodTaxComponents(province).reduce((s, c) => s + c.rate, 0) * 1e6) / 1e6;
}

export interface TaxLine { code: TaxCode; label: { fr: string; en: string }; rate: number; amount: number }

/**
 * Taxes on a taxable amount (prepared food, delivery fee), each component rounded to the cent on its own, as a receipt
 * shows them; `tax` is their sum. Each component is computed on the base, never on another tax (QST is not charged on
 * GST since 2013).
 */
export function foodTaxes(province: Province, amount: number): { province: Province; rate: number; lines: TaxLine[]; tax: number } {
  const base = r2(amount);
  const lines = foodTaxComponents(province).map((c) => ({ code: c.code, label: c.label, rate: c.rate, amount: r2(base * c.rate) }));
  return { province, rate: foodTaxRate(province), lines, tax: r2(lines.reduce((s, l) => s + l.amount, 0)) };
}

/** « Taxes (TPS + TVQ) » / « Taxes (HST) » / « Taxes (GST) »: the receipt line's label. */
export function foodTaxLabel(province: Province, lang: 'fr' | 'en'): string {
  return `Taxes (${foodTaxComponents(province).map((c) => c.label[lang]).join(' + ')})`;
}

/** Splits a combined tax amount into its components in their rate proportions (reports that only have one tax column); the last component takes the rounding. */
export function splitFoodTax(province: Province, total: number): { lines: TaxLine[]; byCode: Partial<Record<TaxCode, number>> } {
  const comps = foodTaxComponents(province);
  const rate = comps.reduce((s, c) => s + c.rate, 0);
  const lines: TaxLine[] = [];
  const byCode: Partial<Record<TaxCode, number>> = {};
  let left = r2(total);
  comps.forEach((c, i) => {
    const amount = i === comps.length - 1 ? left : r2((r2(total) * c.rate) / rate);
    left = r2(left - amount);
    byCode[c.code] = amount;
    lines.push({ code: c.code, label: c.label, rate: c.rate, amount });
  });
  return { lines, byCode };
}
