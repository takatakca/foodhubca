// The product's name on screen. Food Hub becomes ON2GO Hub (docs/ON2GO_HUB_ECOSYSTEM.md § 1): the owner flips it with
// one server variable, FOODHUB_PRODUCT_NAME="ON2GO Hub", read at request time (no rebuild). Unset = "Food Hub", exactly
// as today.
//
// What changes with the name: every console text that says "Food Hub" (through the translator, one place), the page
// description and the installable-app name. What never changes: FOODHUB_* variables, fh_* tables, /api/foodhub/* routes
// and webhook addresses (internal names the platforms are registered with), the legal pages (owner and legal review),
// and the Clover App Market app name ("TAKATAK Food Hub" until Clover reviews a new listing).
//
// No Node-only import here: the client translator uses it too.

export const DEFAULT_PRODUCT_NAME = 'Food Hub';
/** The Clover App Market listing name. Renaming it needs a Clover review: never follows FOODHUB_PRODUCT_NAME. */
export const CLOVER_APP_NAME = 'TAKATAK Food Hub';

export interface ProductInfo {
  /** "Food Hub" (default) or the owner's choice, e.g. "ON2GO Hub". */
  name: string;
  /** The name with the company: "TAKATAK Food Hub" — or the name alone when it is its own brand ("ON2GO Hub"). */
  fullName: string;
  /** Short title for the browser tab and the home-screen icon. */
  shortName: string;
  isDefault: boolean;
}

/** Cleans a configured name: plain text, 2–40 characters; anything else falls back to the default. */
export function cleanProductName(raw: string | null | undefined): string {
  const v = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return v.length >= 2 && v.length <= 40 && !/[<>"'`{}\\]/.test(v) ? v : DEFAULT_PRODUCT_NAME;
}

export function productInfo(raw: string | null | undefined = typeof process !== 'undefined' ? process.env.FOODHUB_PRODUCT_NAME : undefined): ProductInfo {
  const name = cleanProductName(raw);
  const isDefault = name === DEFAULT_PRODUCT_NAME;
  return {
    name,
    fullName: isDefault ? `TAKATAK ${name}` : name,
    shortName: isDefault ? 'TAKATAK' : name,
    isDefault,
  };
}

/**
 * A screen text with the product's name: "TAKATAK Food Hub" → the full name, then "Food Hub" → the name.
 * Unchanged with the default name. The Clover app's listing name is protected (see CLOVER_APP_NAME).
 */
export function withProductName(text: string, product: Pick<ProductInfo, 'name' | 'fullName' | 'isDefault'>): string {
  if (product.isDefault || !text.includes('Food Hub')) return text;
  const KEEP = '\u0000clover-app\u0000';
  return text
    .split(`« ${CLOVER_APP_NAME} »`).join(`« ${KEEP} »`)
    .split(`“${CLOVER_APP_NAME}”`).join(`“${KEEP}”`)
    .split(`TAKATAK Food Hub`).join(product.fullName)
    .split('Food Hub').join(product.name)
    .split(KEEP).join(CLOVER_APP_NAME);
}
