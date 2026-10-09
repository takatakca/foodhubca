// Uber Eats item tax categories: Item.tax_label_info (V2 menu, PUT /v2/eats/stores/{id}/menus).
// https://developer.uber.com/docs/eats/references/api/v2/put-eats-stores-storeid-menu, "TaxLabels" table.
// tax_label_info = { default_value: { labels: [...], source: "MANUAL" } }; a category label and a temperature label are
// required (the temperature is optional for beer, wine and liquor). Every class below is one row of Uber's table, with
// the temperature picked for a restaurant: no label is made up. Uber's table has NO row for a hot main dish
// (CAT_PREPARED_FOOD exists only with TEMP_UNHEATED): asked to Uber (docs/CERTIFICATION_BACKLOG.md).
// Client-safe (no server imports): the menu editor lists the classes.

export const UBER_TAX_CLASSES = {
  prepared_unheated: { en: 'Prepared food, unheated', fr: 'Plat préparé non chauffé', labels: ['CAT_PREPARED_FOOD', 'TEMP_UNHEATED'] },
  side_hot: { en: 'Prepared side dish, hot', fr: 'Accompagnement chaud', labels: ['CAT_PREPARED_FOOD_PREPARED_SIDE_DISHES', 'TEMP_HEATED'] },
  side_cold: { en: 'Prepared side dish, cold', fr: 'Accompagnement froid', labels: ['CAT_PREPARED_FOOD_PREPARED_SIDE_DISHES', 'TEMP_COLD'] },
  sandwich_hot: { en: 'Sandwich / wrap, hot', fr: 'Sandwich / wrap chaud', labels: ['CAT_SANDWICH', 'TEMP_HEATED'] },
  sandwich_cold: { en: 'Sandwich / wrap, cold', fr: 'Sandwich / wrap froid', labels: ['CAT_SANDWICH', 'TEMP_COLD'] },
  salad: { en: 'Prepared salad', fr: 'Salade préparée', labels: ['CAT_PREPARED_FOOD_PREPARED_SALADS', 'TEMP_COLD'] },
  dessert: { en: 'Dessert', fr: 'Dessert', labels: ['CAT_PREPACKAGED_FOOD_DESSERTS', 'TEMP_COLD'] },
  pastry: { en: 'Cake / pie / pastry', fr: 'Gâteau / tarte / pâtisserie', labels: ['CAT_PREPACKAGED_FOOD_CAKES', 'TEMP_UNHEATED'] },
  soft_drink: { en: 'Soft drink, bottled', fr: 'Boisson gazeuse en bouteille', labels: ['CAT_SOFT_DRINK', 'CONTAINER_BOTTLED', 'TEMP_COLD'] },
  water: { en: 'Bottled water', fr: 'Eau en bouteille', labels: ['CAT_WATER', 'TRAIT_NONCARB', 'TRAIT_UNFLV_UNSWT', 'CONTAINER_BOTTLED', 'TEMP_COLD'] },
  sparkling_water: { en: 'Sparkling water', fr: 'Eau pétillante', labels: ['CAT_WATER', 'TRAIT_CARB', 'TRAIT_UNFLV_UNSWT', 'CONTAINER_BOTTLED', 'TEMP_COLD'] },
  juice_100: { en: '100% juice', fr: 'Jus 100 %', labels: ['CAT_JUICE', 'TRAIT_PCT_100', 'TEMP_COLD'] },
  candy: { en: 'Candy', fr: 'Bonbons', labels: ['CAT_CANDY', 'TEMP_UNHEATED'] },
  snack: { en: 'Pre-packaged snack', fr: 'Collation emballée', labels: ['CAT_PREPACKAGED_FOOD', 'CAT_SNACK', 'TEMP_UNHEATED'] },
  alcohol: { en: 'Alcohol', fr: 'Alcool', labels: ['CAT_ALCOHOL', 'TEMP_COLD'] },
  beer: { en: 'Beer', fr: 'Bière', labels: ['CAT_BEER', 'TEMP_COLD'] },
  wine: { en: 'Wine', fr: 'Vin', labels: ['CAT_WINE'] },
  liquor: { en: 'Liquor', fr: 'Spiritueux', labels: ['CAT_LIQUOR'] },
} as const satisfies Record<string, { en: string; fr: string; labels: readonly string[] }>;

export type UberTaxClass = keyof typeof UBER_TAX_CLASSES;
export const UBER_TAX_CLASS_KEYS = Object.keys(UBER_TAX_CLASSES) as [UberTaxClass, ...UberTaxClass[]];

export const isUberTaxClass = (v: unknown): v is UberTaxClass => typeof v === 'string' && Object.prototype.hasOwnProperty.call(UBER_TAX_CLASSES, v);

/**
 * The class an item is sent with: its own, else (once the menu has a default) Alcohol for an item tagged alcohol, else
 * the menu default. Null = nothing chosen: tax_label_info is left out (Uber's store tax setup applies, as before).
 */
export function uberTaxClassOf(item: { uberTaxClass?: string; tags?: string[] } | null, menuDefault?: string): UberTaxClass | null {
  if (item && isUberTaxClass(item.uberTaxClass)) return item.uberTaxClass;
  if (!isUberTaxClass(menuDefault)) return null;
  if (item && (item.tags ?? []).includes('alcohol')) return 'alcohol';
  return menuDefault;
}

/** Item.tax_label_info for a class, or {} when none is chosen. */
export function uberTaxLabelInfo(cls: UberTaxClass | null): { tax_label_info?: { default_value: { labels: string[]; source: 'MANUAL' } } } {
  return cls ? { tax_label_info: { default_value: { labels: [...UBER_TAX_CLASSES[cls].labels], source: 'MANUAL' } } } : {};
}
