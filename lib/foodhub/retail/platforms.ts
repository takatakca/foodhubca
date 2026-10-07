// Publishing the retail catalogue to DoorDash Marketplace Retail and Uber Eats (grocery) — DESIGNED, NOT SENT.
//
// Both platforms gate these APIs behind their own approval, and alcohol behind a separate contract / market approval:
//   DoorDash Marketplace Retail (openapi.doordash.com/marketplace/api/v2): catalogue items (no prices) on
//     POST/PATCH /api/v2/items; price + availability per store on POST/PATCH /api/v2/stores/{store_location_id}/items.
//     Weighted items use weighted_item_info with units ea|kg|lb|gm|oz. "Flagging an item is not authorization to sell
//     it": alcohol needs a signed contract addendum.
//   Uber Eats: no separate grocery API — retail items go through the Menu API (PUT /v2/eats/stores/{id}/menus) with
//     product_info.gtin / plu, selling_info.sold_by_unit for weight, suspension_info for out of stock (no stock count),
//     beverage_info.alcohol_by_volume (E2: 1275 = 12.75 %). Alcohol only in alcohol-enabled markets.
// Food Hub builds the exact payloads (shown under Retail → Platforms) so the day access is granted only the send call is
// added. Until then every adapter answers "blocked — needs platform approval" and nothing leaves Food Hub.
import { toCents } from '../config';
import { toGtin14, barcodeKind, sellableAt, type RetailProduct } from './catalog';

export type RetailPlatform = 'doordash_retail' | 'uber_eats_grocery';

export interface RetailPlatformReadiness {
  platform: RetailPlatform;
  label: string;
  approved: false;
  status: 'needs_platform_approval';
  note: string;
  noteFr: string;
  steps: Array<{ fr: string; en: string }>;
}

export const RETAIL_PLATFORMS: Record<RetailPlatform, RetailPlatformReadiness> = {
  doordash_retail: {
    platform: 'doordash_retail', label: 'DoorDash Marketplace Retail', approved: false, status: 'needs_platform_approval',
    note: 'Needs DoorDash approval for "Marketplace for Retail" (Developer Portal → Add integrations), then a technical account manager. Alcohol needs a signed contract addendum.',
    noteFr: 'Demande l’approbation DoorDash pour « Marketplace for Retail » (Portail développeur → Add integrations), puis un gestionnaire technique. L’alcool exige un avenant signé au contrat.',
    steps: [
      { fr: 'Demander « Marketplace for Retail » dans le portail développeur DoorDash (org FoodHub By Takatak).', en: 'Request "Marketplace for Retail" in the DoorDash Developer Portal (org FoodHub By Takatak).' },
      { fr: 'Obtenir le business_id et les store_location_id de chaque épicerie.', en: 'Get the business_id and each grocery store_location_id.' },
      { fr: 'Photos : au moins 1400×800 (16:9) pour chaque produit.', en: 'Photos: at least 1400×800 (16:9) for every product.' },
      { fr: 'Alcool : signer l’avenant alcool — et un permis d’épicerie l’interdit de toute façon (livraison par un tiers).', en: 'Alcohol: sign the alcohol addendum — and a grocery permit forbids it anyway (third-party delivery).' },
    ],
  },
  uber_eats_grocery: {
    platform: 'uber_eats_grocery', label: 'Uber Eats (grocery)', approved: false, status: 'needs_platform_approval',
    note: 'Uber Eats needs written approval for retail menus; alcohol only in alcohol-enabled markets (ask the partner manager).',
    noteFr: 'Uber Eats demande une approbation écrite pour les menus d’épicerie ; l’alcool seulement dans les marchés autorisés (demander au gestionnaire de compte).',
    steps: [
      { fr: 'Demander à Uber l’accès « retail / grocery » pour l’app existante (même Client ID).', en: 'Ask Uber for retail / grocery access for the existing app (same Client ID).' },
      { fr: 'Créer un magasin Uber Eats de type épicerie et le connecter (Magasins → Connecter Uber Eats).', en: 'Create a grocery-type Uber Eats store and connect it (Stores → Connect Uber Eats).' },
      { fr: 'Codes-barres (GTIN) valides sur chaque produit emballé — Uber les vérifie à la cueillette.', en: 'Valid barcodes (GTIN) on every packaged product — Uber checks them at pickup.' },
    ],
  },
};

const DD_UNIT: Record<string, string> = { kg: 'kg', g: 'gm', lb: 'lb', oz: 'oz', each: 'ea' };
const UBER_WEIGHT: Record<string, string> = { kg: 'WEIGHT_UNIT_TYPE_METRIC_KILOGRAM', g: 'WEIGHT_UNIT_TYPE_METRIC_GRAM', lb: 'WEIGHT_UNIT_TYPE_IMPERIAL_POUND', oz: 'WEIGHT_UNIT_TYPE_IMPERIAL_OUNCE' };

function identifiers(p: RetailProduct) {
  return p.barcodes.map((b) => {
    const kind = barcodeKind(b);
    return { identifier_type: kind === 'PLU' ? 'PLU' : kind === 'UPC-A' ? 'UPC' : 'GTIN', identifier_value: kind === 'PLU' ? b : (kind === 'UPC-A' ? b : toGtin14(b) ?? b) };
  });
}

/** Products a platform may receive: active, and no alcohol unless the alcohol rules opened it for that channel. */
export function retailForPlatform(products: RetailProduct[], opts: { alcoholAllowed: boolean }): RetailProduct[] {
  return products.filter((p) => p.active && (!p.alcohol || opts.alcoholAllowed));
}

/** DoorDash Retail catalogue items (POST /api/v2/items) — no prices here, by DoorDash's design. */
export function toDoorDashRetailItems(products: RetailProduct[]) {
  return products.map((p) => ({
    merchant_supplied_item_id: p.sku,
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    ...(p.brand ? { brand_info: { name: p.brand } } : {}),
    ...(p.barcodes.length ? { other_identifiers: identifiers(p) } : {}),
    item_categorizations: [{ category_name: p.category }],
    ...(p.imageUrl ? { images: [{ url: p.imageUrl, sort_id: 0 }] } : {}),
    ...(p.alcohol || p.soldBy === 'weight' ? { product_traits: [...(p.alcohol ? ['ALCOHOL'] : []), ...(p.soldBy === 'weight' ? ['WEIGHTED'] : [])] } : {}),
    ...(p.soldBy === 'weight' ? { weighted_item_info: { average_weight_per_each: 1, average_weight_measurement_unit: DD_UNIT[p.unit] ?? 'kg', shop_by_measurement_unit: DD_UNIT[p.unit] ?? 'kg', price_by_measurement_unit: DD_UNIT[p.unit] ?? 'kg' } } : {}),
  }));
}

/** DoorDash Retail store items (price + availability at one store, POST /api/v2/stores/{store_location_id}/items). */
export function toDoorDashRetailStoreItems(products: RetailProduct[], locationCode: string) {
  return products.map((p) => ({
    merchant_supplied_item_id: p.sku,
    price_info: p.soldBy === 'weight' ? { base_price_per_measurement_unit: toCents(p.price) } : { base_price: toCents(p.price) },
    item_availability: sellableAt(p, locationCode) ? 'ACTIVE' : 'INACTIVE',
    ...(p.trackStock ? { balance_on_hand: Math.max(0, Math.floor(p.stock[locationCode] ?? 0)) } : {}),
  }));
}

/** Uber Eats Menu API items for a grocery store (inside PUT /v2/eats/stores/{id}/menus). */
export function toUberEatsGroceryItems(products: RetailProduct[], locationCode: string) {
  return products.map((p) => {
    const gtin = p.barcodes.map((b) => (barcodeKind(b) !== 'PLU' ? toGtin14(b) : null)).find(Boolean);
    const plu = p.barcodes.find((b) => barcodeKind(b) === 'PLU');
    return {
      id: p.sku,
      title: { translations: { en_us: p.name, ...(p.nameFr ? { fr_ca: p.nameFr } : {}) } },
      ...(p.description ? { description: { translations: { en_us: p.description, ...(p.descriptionFr ? { fr_ca: p.descriptionFr } : {}) } } } : {}),
      ...(p.imageUrl ? { image_url: p.imageUrl } : {}),
      price_info: { price: toCents(p.price) },
      product_info: {
        ...(gtin ? { gtin } : plu ? { plu } : { merchant_id: p.sku }),
        target_market: 124, // Canada (ISO 3166 numeric)
        ...(p.alcohol ? { product_traits: ['CONTAINS_ALCOHOL'] } : {}),
      },
      ...(p.soldBy === 'weight' ? { selling_info: { selling_options: [{ sold_by_unit: { measurement_type: 'MEASUREMENT_TYPE_WEIGHT', weight_unit: UBER_WEIGHT[p.unit] ?? UBER_WEIGHT.kg } }] } } : {}),
      ...(p.alcohol ? { beverage_info: { alcohol_by_volume: Math.round((p.alcohol.abv ?? 0) * 100) } } : {}),
      // Uber has no stock count: an item out of stock at this store is suspended instead.
      ...(sellableAt(p, locationCode) ? {} : { suspension_info: { suspension: { suspend_until: 0, reason: 'Out of stock' } } }),
    };
  });
}

/** What would be sent, for the preview screen — never sent. */
export function previewRetailPayloads(products: RetailProduct[], locationCode: string, alcoholAllowed: { doordash: boolean; uber_eats: boolean }) {
  const dd = retailForPlatform(products, { alcoholAllowed: alcoholAllowed.doordash });
  const ue = retailForPlatform(products, { alcoholAllowed: alcoholAllowed.uber_eats });
  return {
    doordash_retail: { readiness: RETAIL_PLATFORMS.doordash_retail, items: toDoorDashRetailItems(dd), storeItems: toDoorDashRetailStoreItems(dd, locationCode), leftOut: products.length - dd.length },
    uber_eats_grocery: { readiness: RETAIL_PLATFORMS.uber_eats_grocery, items: toUberEatsGroceryItems(ue, locationCode), leftOut: products.length - ue.length },
  };
}
