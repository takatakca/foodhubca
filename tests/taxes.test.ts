import { describe, expect, it } from 'vitest';
import { foodTaxLabel, foodTaxRate, foodTaxes, locationProvince, parseProvince, PROVINCES, provinceFromPostalCode, splitFoodTax } from '../lib/foodhub/taxes';

describe('Canadian sales taxes on prepared food', () => {
  it('knows the 13 provinces and territories with their 2026 rates', () => {
    expect(PROVINCES).toHaveLength(13);
    expect(foodTaxRate('QC')).toBe(0.14975);
    expect(foodTaxRate('ON')).toBe(0.13);
    expect(foodTaxRate('NS')).toBe(0.14);
    for (const p of ['NB', 'NL', 'PE'] as const) expect(foodTaxRate(p)).toBe(0.15);
    expect(foodTaxRate('MB')).toBe(0.12);
    expect(foodTaxRate('SK')).toBe(0.11);
    for (const p of ['AB', 'YT', 'NT', 'NU'] as const) expect(foodTaxRate(p)).toBe(0.05);
  });

  it('British Columbia: PST does not apply to restaurant meals, GST alone', () => {
    expect(foodTaxRate('BC')).toBe(0.05);
    expect(foodTaxes('BC', 100).lines.map((l) => l.code)).toEqual(['GST']);
    expect(foodTaxLabel('BC', 'en')).toBe('Taxes (GST)');
  });

  it('each component is rounded to the cent on the base, never on another tax', () => {
    const qc = foodTaxes('QC', 23.45);
    expect(qc.lines.map((l) => [l.code, l.amount])).toEqual([['GST', 1.17], ['QST', 2.34]]);
    expect(qc.tax).toBe(3.51);
    expect(qc.rate).toBe(0.14975);
    const on = foodTaxes('ON', 23.45);
    expect(on.lines).toEqual([{ code: 'HST', label: { fr: 'TVH', en: 'HST' }, rate: 0.13, amount: 3.05 }]);
    expect(foodTaxes('AB', 0).tax).toBe(0);
  });

  it('labels follow the province and the language', () => {
    expect(foodTaxLabel('QC', 'fr')).toBe('Taxes (TPS + TVQ)');
    expect(foodTaxLabel('QC', 'en')).toBe('Taxes (GST + QST)');
    expect(foodTaxLabel('ON', 'fr')).toBe('Taxes (TVH)');
    expect(foodTaxLabel('SK', 'en')).toBe('Taxes (GST + PST)');
    expect(foodTaxLabel('MB', 'fr')).toBe('Taxes (TPS + TVD)');
  });

  it('splits a combined tax column in rate proportions, the last part taking the rounding', () => {
    const qc = splitFoodTax('QC', 14.98);
    expect(qc.byCode).toEqual({ GST: 5, QST: 9.98 });
    expect(qc.lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(14.98, 2);
    expect(splitFoodTax('ON', 13).byCode).toEqual({ HST: 13 });
    expect(splitFoodTax('BC', 5).byCode).toEqual({ GST: 5 });
  });

  it('reads a province from a code, a name in either language, or a postal code', () => {
    expect(parseProvince(' qc ')).toBe('QC');
    expect(parseProvince('Québec')).toBe('QC');
    expect(parseProvince('quebec')).toBe('QC');
    expect(parseProvince('British Columbia')).toBe('BC');
    expect(parseProvince('Nouvelle-Écosse')).toBe('NS');
    expect(parseProvince('XX')).toBeNull();
    expect(parseProvince(undefined)).toBeNull();
    expect(provinceFromPostalCode('H3X 2B6')).toBe('QC');
    expect(provinceFromPostalCode('m5v3l9')).toBe('ON');
    expect(provinceFromPostalCode('V6B 1A1')).toBe('BC');
    expect(provinceFromPostalCode('X0A 0H0')).toBe('NU');
    expect(provinceFromPostalCode('X1A 2N4')).toBe('NT');
    expect(provinceFromPostalCode('12345')).toBeNull();
  });

  it('a kitchen gets its typed province, else its postal code, else Québec', () => {
    expect(locationProvince({ province: 'on', postalCode: 'H3X 2B6' })).toBe('ON');
    expect(locationProvince({ postalCode: 'T2P 1J9' })).toBe('AB');
    expect(locationProvince({ postalCode: '' })).toBe('QC');
    expect(locationProvince(null)).toBe('QC');
  });
});

describe('the public menu carries its kitchen taxes', () => {
  it('a Québec seed kitchen shows TPS + TVQ; a kitchen outside the seed follows its province or postal code', async () => {
    const { buildPublicMenu } = await import('../lib/foodhub/storefront/catalog');
    const { fixtureMenu, everyDay, at, BRAND, SLUG, LOC } = await import('./helpers/storefront-fixture');
    const base = { slug: SLUG, brandName: BRAND, brandActive: true, menu: fixtureMenu(), stores: [], now: at(13) };
    const qc = buildPublicMenu({ ...base, cfg: { enabled: true, slug: SLUG, locationCode: LOC, payOnline: false, payAtPickup: true, pickupMaxTotal: 150 }, hours: { locations: { [LOC]: everyDay('11:00', '23:00') }, brands: {}, holidays: [] }, location: null });
    expect(qc.menu.taxes).toEqual({ province: 'QC', rate: 0.14975, label: { fr: 'Taxes (TPS + TVQ)', en: 'Taxes (GST + QST)' } });
    const on = buildPublicMenu({ ...base, cfg: { enabled: true, slug: SLUG, locationCode: 'TORONTO', payOnline: false, payAtPickup: true, pickupMaxTotal: 150 }, hours: { locations: { TORONTO: everyDay('11:00', '23:00') }, brands: {}, holidays: [] }, location: { name: 'Toronto', address: '1 Front St W', city: 'Toronto', postalCode: 'M5V 3L9' } });
    expect(on.menu.location.region).toBe('ON');
    expect(on.menu.taxes).toEqual({ province: 'ON', rate: 0.13, label: { fr: 'Taxes (TVH)', en: 'Taxes (HST)' } });
    const bc = buildPublicMenu({ ...base, cfg: { enabled: true, slug: SLUG, locationCode: 'VAN', payOnline: false, payAtPickup: true, pickupMaxTotal: 150 }, hours: { locations: { VAN: everyDay('11:00', '23:00') }, brands: {}, holidays: [] }, location: { name: 'Vancouver', address: '1 Main', city: 'Vancouver', province: 'BC', postalCode: '' } });
    expect(bc.menu.taxes.rate).toBe(0.05);
  });
});
