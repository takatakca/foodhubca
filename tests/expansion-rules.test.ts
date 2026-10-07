// Expansion: feature switches, Québec alcohol rules, delivery addresses, retail barcodes / CSV.
import { beforeEach, describe, expect, it } from 'vitest';
import { alcoholDecision, cleanLocationAlcohol, menuWithAlcoholRules, saveLocationAlcohol, withinSaleHours, type AlcoholSettings } from '../lib/foodhub/alcohol/rules';
import { addressProblems, distanceKm, formatAddress, normalizePostal, parseAddressText, serviceAreaProblem } from '../lib/foodhub/delivery/address';
import { cleanRule } from '../lib/foodhub/delivery/store';
import { featureOn, getFeatures, setFeature } from '../lib/foodhub/expansion/features';
import { barcodeKind, cleanProduct, parseProductCsv, productProblems, toGtin14 } from '../lib/foodhub/retail/catalog';
import { previewRetailPayloads, toDoorDashRetailItems, toUberEatsGroceryItems } from '../lib/foodhub/retail/platforms';
import type { MasterMenu } from '../lib/foodhub/types';

const actor = { username: 'owner', name: 'Owner', source: 'dashboard' as const };

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  for (const k of ['DELIVERY', 'RETAIL', 'ALCOHOL', 'PHONE']) delete process.env[`FOODHUB_FEATURE_${k}`];
  process.env.FOODHUB_TIMEZONE = 'America/Toronto';
});

describe('feature switches', () => {
  it('start off, turn on by the owner, and the environment wins', async () => {
    expect((await getFeatures()).delivery).toMatchObject({ on: false, source: 'default' });
    await setFeature('delivery', true, actor);
    expect(await featureOn('delivery')).toBe(true);
    process.env.FOODHUB_FEATURE_DELIVERY = 'off';
    expect(await featureOn('delivery')).toBe(false);
    await expect(setFeature('delivery', true, actor)).rejects.toThrow(/set on the server/);
  });
});

// 2026-10-07 18:00 in Montréal (EDT, UTC-4) = 22:00 UTC.
const SIX_PM = Date.parse('2026-10-07T22:00:00Z');
const ELEVEN_THIRTY_PM = Date.parse('2026-10-08T03:30:00Z');

function settings(rule: Parameters<typeof cleanLocationAlcohol>[0]): AlcoholSettings {
  return { minAge: 18, locations: { NDG: cleanLocationAlcohol(rule) } };
}

describe('alcohol rules (Québec)', () => {
  const restaurant = { permitType: 'restaurant' as const, permitNumber: '12345', verifiedAt: '2026-10-01T00:00:00Z', channels: { phone: true, own_delivery: true, uber_eats: true } };

  it('everything is closed by default and when the feature is off', () => {
    expect(alcoholDecision(settings(restaurant), false, 'NDG', 'phone', { now: SIX_PM }).allowed).toBe(false);
    expect(alcoholDecision({ minAge: 18, locations: {} }, true, 'NDG', 'phone', { now: SIX_PM }).reason).toMatch(/No RACJ permit/);
  });

  it('needs the owner check, a valid date and the legal hours', () => {
    expect(alcoholDecision(settings({ ...restaurant, verifiedAt: undefined }), true, 'NDG', 'phone', { now: SIX_PM }).reason).toMatch(/not been checked/);
    expect(alcoholDecision(settings({ ...restaurant, expiresOn: '2026-10-01' }), true, 'NDG', 'phone', { now: SIX_PM }).reason).toMatch(/expired/);
    expect(alcoholDecision(settings(restaurant), true, 'NDG', 'phone', { now: SIX_PM })).toMatchObject({ allowed: true, requireFood: true, minAge: 18 });
    expect(alcoholDecision(settings(restaurant), true, 'NDG', 'phone', { now: ELEVEN_THIRTY_PM }).reason).toMatch(/legal sale hours/);
    expect(alcoholDecision(settings(restaurant), true, 'NDG', 'phone', { now: ELEVEN_THIRTY_PM, ignoreHours: true }).allowed).toBe(true);
  });

  it('third-party delivery: restaurant needs the written agreement, grocery never', () => {
    expect(alcoholDecision(settings(restaurant), true, 'NDG', 'own_delivery', { now: SIX_PM }).reason).toMatch(/written agreement/);
    expect(alcoholDecision(settings({ ...restaurant, thirdPartyAgreement: true }), true, 'NDG', 'own_delivery', { now: SIX_PM }).allowed).toBe(true);
    const grocery = { ...restaurant, permitType: 'epicerie' as const, thirdPartyAgreement: true };
    expect(alcoholDecision(settings(grocery), true, 'NDG', 'uber_eats', { now: SIX_PM }).reason).toMatch(/grocery permit/);
    expect(alcoholDecision(settings(grocery), true, 'NDG', 'phone', { now: SIX_PM }).allowed).toBe(true);
  });

  it('the sale window can be narrowed but never widened past the permit', () => {
    expect(cleanLocationAlcohol({ permitType: 'restaurant', saleFrom: '06:00', saleTo: '02:00' })).toMatchObject({ saleFrom: '08:00', saleTo: '23:00' });
    expect(cleanLocationAlcohol({ permitType: 'epicerie' })).toMatchObject({ saleFrom: '07:00', saleTo: '23:00', thirdPartyAgreement: false });
    expect(cleanLocationAlcohol({ permitType: 'restaurant', saleFrom: '11:00', saleTo: '22:00', requireFood: false })).toMatchObject({ saleFrom: '11:00', saleTo: '22:00', requireFood: true });
    expect(withinSaleHours({ saleFrom: '08:00', saleTo: '23:00' }, SIX_PM)).toBe(true);
  });

  it('opening a channel without a checked permit keeps it closed', async () => {
    const r = await saveLocationAlcohol('NDG', { permitType: 'restaurant', channels: { phone: true } }, actor);
    expect(r.warning).toMatch(/stay closed/);
    expect(r.settings.locations.NDG.channels).toEqual({});
    const ok = await saveLocationAlcohol('NDG', { permitNumber: 'R-1', verify: true, channels: { phone: true } }, actor);
    expect(ok.warning).toBeUndefined();
    expect(ok.settings.locations.NDG).toMatchObject({ verifiedBy: 'Owner', channels: { phone: true } });
    // A new permit number cancels the previous check.
    const changed = await saveLocationAlcohol('NDG', { permitNumber: 'R-2' }, actor);
    expect(changed.settings.locations.NDG.channels).toEqual({});
  });

  it('platform menus: unchanged with the feature off, alcohol left out where not allowed', async () => {
    const menu = { brandName: 'Po Poulet', categories: [], modifierGroups: [], updatedAt: '', items: [
      { ref: 'a', name: 'Bière', price: 7, categoryRef: 'c', available: true, modifierGroupRefs: [], tags: ['alcohol'] },
      { ref: 'b', name: 'Poulet', price: 20, categoryRef: 'c', available: true, modifierGroupRefs: [] },
    ] } as MasterMenu;
    expect((await menuWithAlcoholRules(menu, 'NDG', 'doordash')).items).toHaveLength(2);
    await setFeature('alcohol', true, actor);
    expect((await menuWithAlcoholRules(menu, 'NDG', 'doordash')).items.map((i) => i.ref)).toEqual(['b']);
  });
});

describe('delivery addresses', () => {
  it('reads an address said on the phone or typed in Clover', () => {
    expect(normalizePostal('h4a1b2')).toBe('H4A 1B2');
    expect(parseAddressText('6280 rue Somerled, app 5, Montréal, QC H4V 1R9')).toEqual({ street: '6280 rue Somerled', unit: '5', city: 'Montréal', province: 'QC', postalCode: 'H4V 1R9', country: 'CA' });
    expect(parseAddressText('5555 Monkland H4A1E1', { city: 'Montréal' })).toMatchObject({ street: '5555 Monkland', city: 'Montréal', postalCode: 'H4A 1E1' });
    expect(parseAddressText('near the park')).toBeNull();
    expect(formatAddress({ street: '6280 rue Somerled', unit: '5', city: 'Montréal', province: 'QC', postalCode: 'H4V 1R9', country: 'CA' })).toBe('6280 rue Somerled, #5, Montréal, QC H4V 1R9, Canada');
    expect(addressProblems({ street: '1 rue A', city: 'Montréal', province: 'QC', postalCode: '', country: 'CA' })).toEqual(['Postal code is missing or not a Canadian postal code.']);
  });

  it('service area: postal prefixes and distance when coordinates are known', () => {
    const rule = cleanRule({ enabled: true, postalPrefixes: ['h4a', 'H4V'] as string[], maxDistanceKm: 3, lat: 45.4688, lng: -73.6177 });
    const addr = { street: '1 rue A', city: 'Montréal', province: 'QC', postalCode: 'H4V 1R9', country: 'CA' };
    expect(serviceAreaProblem(rule, addr)).toBeNull();
    expect(serviceAreaProblem(rule, { ...addr, postalCode: 'H2X 1Y4' })).toMatch(/outside/);
    expect(serviceAreaProblem(rule, { ...addr, lat: 45.5017, lng: -73.5673 })).toMatch(/km limit/);
    expect(distanceKm({ lat: 45.4688, lng: -73.6177 }, { lat: 45.5017, lng: -73.5673 })).toBeGreaterThan(5);
  });
});

describe('retail catalogue', () => {
  it('checks barcodes (UPC / EAN / PLU) by length and check digit', () => {
    expect(barcodeKind('036000291452')).toBe('UPC-A');
    expect(barcodeKind('4006381333931')).toBe('EAN-13');
    expect(barcodeKind('4011')).toBe('PLU');
    expect(barcodeKind('036000291453')).toBeNull();
    expect(toGtin14('036000291452')).toBe('00036000291452');
  });

  it('validates units for goods sold by weight', () => {
    expect(productProblems(cleanProduct({ name: 'Pommes', sku: 'P1', price: 4.4, soldBy: 'weight', unit: 'each' }))).toEqual([]);
    expect(cleanProduct({ name: 'Pommes', sku: 'P1', price: 4.4, soldBy: 'weight' }).unit).toBe('kg');
    expect(productProblems({ name: 'X', sku: 'X', price: 1, soldBy: 'weight', unit: 'each' })).toContain('A product sold by weight needs a weight unit (kg, g, lb, oz).');
  });

  it('reads a product CSV (comma or semicolon) and reports bad rows', () => {
    const csv = 'sku;code-barres;nom;prix;unité;stock;alcool\nB1;036000291452;Bière blonde;3,49;each;24;5\nB2;123;Mauvais;2;each;1;\n';
    const r = parseProductCsv(csv, 'NDG');
    expect(r.products).toHaveLength(1);
    expect(r.products[0]).toMatchObject({ sku: 'B1', name: 'Bière blonde', price: 3.49, stock: { NDG: 24 }, alcohol: { abv: 5 } });
    expect(r.errors[0]).toMatch(/Row 3: Barcode 123/);
  });

  it('builds the platform payloads but leaves alcohol out unless allowed', () => {
    const beer = cleanProduct({ name: 'Bière', sku: 'B1', price: 3.49, barcodes: ['036000291452'], alcohol: { abv: 5 }, stock: { NDG: 5 } });
    const apples = cleanProduct({ name: 'Pommes', sku: 'P1', price: 4.4, soldBy: 'weight', unit: 'kg', barcodes: ['4011'], stock: { NDG: 0 } });
    const preview = previewRetailPayloads([beer, apples], 'NDG', { doordash: false, uber_eats: false });
    expect(preview.doordash_retail.readiness.status).toBe('needs_platform_approval');
    expect(preview.doordash_retail.items.map((i) => i.merchant_supplied_item_id)).toEqual(['P1']);
    expect(preview.doordash_retail.leftOut).toBe(1);
    expect(preview.doordash_retail.storeItems[0]).toMatchObject({ price_info: { base_price_per_measurement_unit: 440 }, item_availability: 'INACTIVE' });
    expect(toDoorDashRetailItems([apples])[0]).toMatchObject({ product_traits: ['WEIGHTED'], weighted_item_info: { price_by_measurement_unit: 'kg' }, other_identifiers: [{ identifier_type: 'PLU', identifier_value: '4011' }] });
    const ue = toUberEatsGroceryItems([beer], 'NDG')[0];
    expect(ue).toMatchObject({ price_info: { price: 349 }, product_info: { gtin: '00036000291452', product_traits: ['CONTAINS_ALCOHOL'] }, beverage_info: { alcohol_by_volume: 500 } });
  });
});
