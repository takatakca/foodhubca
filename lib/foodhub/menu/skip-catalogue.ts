// JET Connect "Ingest menu from POS" with the WHOLE published menu model — restaurants and grocery / retail:
// portions, includes, swap options, ingredients, allergens, additives, nutrition (kcal / kJ, ranges), servings,
// volume, weight, gross weight, deposit, manufacturer, storage, GTIN, product types, low-stock threshold, quantity
// restrictions, translations, galleries and sub-categories. (toSkipMenu in translate.ts builds the restaurant menu from
// the master menu; this module is for catalogues that arrive already in JET's shape — a retail merchant, an import.)
//
// POST /menus  → 202; the callback_url receives the result. POST /item-availability for stock changes (adapters/skip.ts).
// Specification: https://uk.api.just-eat.io/docs/openapi.yaml (JetConnectMenusUtfConnector*). Coverage: docs/SKIP_API_COVERAGE.md.
import { publicBaseUrl, result } from '../config';
import { skipSend } from '../adapters/skip';
import type { ChannelResult } from '../types';

export const SKIP_ALLERGENS = ['CEREAL_WHEAT', 'CEREAL_RYE', 'CEREAL_BARLEY', 'CEREAL_OATS', 'CEREAL_SPELT', 'CEREAL_KAMUT', 'CRUSTACEANS', 'EGGS', 'FISH', 'PEANUTS', 'SOYBEANS', 'MILK', 'NUTS_ALMONDS', 'NUTS_HAZELNUTS', 'NUTS_WALNUTS', 'NUTS_CASHEWS', 'NUTS_PECAN', 'NUTS_BRAZIL', 'NUTS_PISTACHIO', 'NUTS_MACADAMIA', 'CELERY', 'MUSTARD', 'SESAME_SEEDS', 'SULPHUR_DIOXIDE_SULPHITES', 'LUPIN', 'MOLLUSCS'] as const;
export const SKIP_ADDITIVES = ['UNSPECIFIED', 'COLORANT_UNSPECIFIED', 'COLORANT_ADVERSE_EFFECT', 'PRESERVATIVES_UNSPECIFIED', 'PRESERVATIVES_NITRITE_CURING_SALT', 'PRESERVATIVES_NITRATE', 'PRESERVATIVES_NITRATE_CURING_SALT_AND_NITRATE', 'ANTIOXIDANT', 'FLAVOURE_ENHANCER', 'SULFITES', 'BLACKENED', 'WAXED', 'PHOSPHATE', 'SWEETENER_UNSPECIFIED', 'SWEETENER_PHENYLALANINE', 'SWEETENER_LAXATIVE', 'CAFFEINE_UNSPECIFIED', 'CAFFEINE_HIGH_CAFFEINE', 'CAFFEINE_CAFFEINE', 'QUININE', 'GENETICALLY_MODIFIED', 'ACIDIFIERS', 'STABILISERS', 'PROTEIN_UNSPECIFIED', 'PROTEIN_MILK_PROTEIN', 'PROTEIN_STARCH', 'PROTEIN_EGG_WHITE'] as const;
export const SKIP_PRODUCT_TYPES = ['ALCOHOL', 'ANTIHISTAMINES', 'BABY_FORMULA', 'CANNABIDIOL', 'CODEINE', 'COLD_FLU', 'DECONGESTANTS', 'DRINK', 'ENERGY_DRINK', 'HFSS', 'MATURE', 'MEDICINE', 'NICOTINE', 'PACKAGED_FOOD', 'PAINKILLERS', 'PHARMACY_CONTROLLED', 'RESTAURANT_PREPARED_FOOD', 'SEDATIVES', 'SENSITIVE', 'TOBACCO', 'VAPING_PRODUCT'] as const;
const TAX_CATEGORIES = ['NO_TAX', 'ALCOHOL', 'SUGARED_DRINK', 'STANDARD_RATE', 'REDUCED_RATE'];
const SPICINESS = ['UNKNOWN', 'MILD', 'MEDIUM', 'HOT', 'VERY_HOT'];
const DIETARY = ['NONE', 'VEGETARIAN', 'VEGAN'];
const VOLUME_UNITS = ['ml', 'cl', 'l', 'm', 'cm', 'g', 'kg', 'sheet', 'sqm', 'unit'];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const AVAILABILITY = /^[0-2][0-9]:[0-5][0-9] - [0-2][0-9]:[0-5][0-9]$/;

export interface SkipTranslations { [bcp47: string]: { name: string; description?: string } }
export interface SkipRange { min: number; max: number }
export interface SkipItemFields {
  name: string; description?: string; translations?: SkipTranslations; plu: string; out_of_stock?: boolean; price?: number; reference?: string;
  modifiers?: SkipModifier[]; portions?: SkipPortion[]; includes?: SkipInclude[]; ingredients?: Array<{ name: string; country_of_origin?: string; country_of_production?: string; translations?: Record<string, { name: string }> }>;
  tax_category?: string; tax_percentage?: number; swap?: { name: string; options: Array<{ name: string; plu: string; price: number; reference: string; out_of_stock?: boolean; tax_category?: string; translations?: Record<string, { name: string }> }> };
  gallery?: Array<{ url: string }>; is_alcoholic?: boolean; spiciness?: string; dietary_restrictions?: string[]; allergens?: string[]; additives?: string[];
  nutritional_info?: { kcal?: number; kj?: number; additional_details?: string }; nutritional_info_range?: { kcal_range?: SkipRange; kj_range?: SkipRange };
  servings?: number; servings_range?: SkipRange; caffeine?: { unit?: 'mg' | 'g'; value: number }; alcohol_percentage?: number;
  volume?: { unit?: string; gross_value?: number; net_value: number; quantity?: number }; weight?: { unit?: 'kg' | 'g'; gross_value: number; net_value: number }; gross_weight?: { unit: 'g' | 'kg'; value: number };
  deposit?: { type: 'single_use' | 'multiple_use' | 'not_specified'; amount: number; included_in_total_price: boolean };
  manufacturer?: { name: string; brand: string; country_of_origin: string; additional_details?: string }; storage?: { type: string; additional_details?: string };
  gtin?: string; product_types?: string[]; low_stock_threshold?: number;
}
export interface SkipModifier { name: string; description: string; translations?: SkipTranslations; pick: { pick_same_option: boolean; exactly?: number; range?: { from?: number; to?: number } }; options?: SkipItemFields[] }
export interface SkipPortion extends Omit<SkipItemFields, 'portions' | 'includes' | 'ingredients' | 'swap' | 'gallery'> { price: number; modifiers: SkipModifier[] }
export interface SkipInclude { name: string; description: string; plu: string; out_of_stock?: boolean; modifiers: SkipModifier[] }
export interface SkipCategory { name: string; description: string; translations?: SkipTranslations; items?: SkipItemFields[]; gallery?: Array<{ url: string }>; type?: 'root' | 'subcategory'; categories?: SkipCategory[] }
export interface SkipMenuDoc {
  default_language?: string; name: string; description?: string; reference: string; type: 'COLLECTION' | 'DELIVERY'; translations?: Record<string, { name: string }>;
  availability?: Record<string, string[]>; categories: SkipCategory[];
  quantity_restrictions?: Array<{ id: string; name: string; maximum: number; restricted_quantity_plus: Array<{ plu: string; contributing_quantity: number }> }>;
}
export interface SkipMenusPayload { restaurants: string[]; menus: SkipMenuDoc[]; callback_url?: string }

const isObj = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const int = (v: unknown) => Number.isInteger(v);
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function checkRange(r: unknown, where: string, out: string[]) {
  if (r === undefined) return;
  if (!isObj(r) || !num(r.min) || !num(r.max)) out.push(`${where}: min and max are required.`);
  else if (r.min > r.max) out.push(`${where}: min is above max.`);
}

function checkItem(it: any, where: string, out: string[], opts: { portion?: boolean } = {}) {
  if (!isObj(it)) { out.push(`${where}: not an object.`); return; }
  if (!str(it.name)) out.push(`${where}: name is required.`);
  if (!str(it.plu)) out.push(`${where}: plu is required.`);
  if (it.price !== undefined && !int(it.price)) out.push(`${where}: price is a whole number of cents.`);
  if (opts.portion && !int(it.price)) out.push(`${where}: a portion needs a price in cents.`);
  if (it.tax_category !== undefined && !TAX_CATEGORIES.includes(it.tax_category)) out.push(`${where}: tax_category must be ${TAX_CATEGORIES.join(', ')}.`);
  if (it.spiciness !== undefined && !SPICINESS.includes(it.spiciness)) out.push(`${where}: spiciness must be ${SPICINESS.join(', ')}.`);
  for (const [field, allowed] of [['allergens', SKIP_ALLERGENS], ['additives', SKIP_ADDITIVES], ['product_types', SKIP_PRODUCT_TYPES], ['dietary_restrictions', DIETARY]] as const) {
    const v = it[field];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some((x: unknown) => !(allowed as readonly string[]).includes(String(x)))) out.push(`${where}: ${field} can only hold ${allowed.slice(0, 6).join(', ')}…`);
  }
  if (it.volume !== undefined && (!isObj(it.volume) || !num(it.volume.net_value) || (it.volume.unit !== undefined && !VOLUME_UNITS.includes(it.volume.unit)))) out.push(`${where}: volume needs net_value and a unit of ${VOLUME_UNITS.join(', ')}.`);
  if (it.weight !== undefined && (!isObj(it.weight) || !int(it.weight.net_value) || !int(it.weight.gross_value) || (it.weight.unit !== undefined && !['g', 'kg'].includes(it.weight.unit)))) out.push(`${where}: weight needs whole net_value and gross_value in g or kg.`);
  if (it.gross_weight !== undefined && (!isObj(it.gross_weight) || !num(it.gross_weight.value) || it.gross_weight.value < 0 || !['g', 'kg'].includes(it.gross_weight.unit))) out.push(`${where}: gross_weight needs a non-negative value and g or kg.`);
  if (it.deposit !== undefined && (!isObj(it.deposit) || !['single_use', 'multiple_use', 'not_specified'].includes(it.deposit.type) || !int(it.deposit.amount) || typeof it.deposit.included_in_total_price !== 'boolean')) out.push(`${where}: deposit needs type, amount and included_in_total_price.`);
  if (it.manufacturer !== undefined && (!isObj(it.manufacturer) || !str(it.manufacturer.name) || !str(it.manufacturer.brand) || !str(it.manufacturer.country_of_origin))) out.push(`${where}: manufacturer needs name, brand and country_of_origin.`);
  if (it.storage !== undefined && (!isObj(it.storage) || !str(it.storage.type))) out.push(`${where}: storage needs a type (FROZEN or COOL_DRY).`);
  if (it.caffeine !== undefined && (!isObj(it.caffeine) || !num(it.caffeine.value))) out.push(`${where}: caffeine needs a value.`);
  if (it.low_stock_threshold !== undefined && !int(it.low_stock_threshold)) out.push(`${where}: low_stock_threshold is a whole number.`);
  checkRange(it.servings_range, `${where} servings_range`, out);
  if (it.nutritional_info_range !== undefined) { checkRange(it.nutritional_info_range?.kcal_range, `${where} kcal_range`, out); checkRange(it.nutritional_info_range?.kj_range, `${where} kj_range`, out); }
  for (const [i, ing] of (Array.isArray(it.ingredients) ? it.ingredients : []).entries()) {
    if (!str(ing?.name)) out.push(`${where} ingredient ${i + 1}: name is required.`);
    for (const c of ['country_of_origin', 'country_of_production']) if (ing?.[c] !== undefined && !/^[A-Z]{2}$/.test(String(ing[c]))) out.push(`${where} ingredient ${i + 1}: ${c} is a two-letter country code.`);
  }
  if (it.swap !== undefined) {
    if (!isObj(it.swap) || !str(it.swap.name) || !Array.isArray(it.swap.options) || !it.swap.options.length) out.push(`${where}: swap needs a name and options.`);
    else for (const [i, o] of it.swap.options.entries()) if (!str(o?.name) || !str(o?.plu) || !int(o?.price) || !str(o?.reference)) out.push(`${where} swap option ${i + 1}: name, plu, price (cents) and reference are required.`);
  }
  for (const [i, m] of (Array.isArray(it.modifiers) ? it.modifiers : []).entries()) checkModifier(m, `${where} modifier ${i + 1}`, out);
  for (const [i, p] of (Array.isArray(it.portions) ? it.portions : []).entries()) checkItem(p, `${where} portion ${i + 1}`, out, { portion: true });
  for (const [i, inc] of (Array.isArray(it.includes) ? it.includes : []).entries()) { if (!str(inc?.name) || !str(inc?.plu)) out.push(`${where} include ${i + 1}: name and plu are required.`); }
  for (const [i, g] of (Array.isArray(it.gallery) ? it.gallery : []).entries()) if (!str(g?.url)) out.push(`${where} gallery ${i + 1}: url is required.`);
}

function checkModifier(m: any, where: string, out: string[]) {
  if (!isObj(m)) { out.push(`${where}: not an object.`); return; }
  if (!str(m.name)) out.push(`${where}: name is required.`);
  if (!isObj(m.pick) || typeof m.pick.pick_same_option !== 'boolean') out.push(`${where}: pick.pick_same_option is required.`);
  else if (m.pick.exactly === undefined && m.pick.range === undefined) out.push(`${where}: pick needs "exactly" or "range".`);
  else if (m.pick.range && int(m.pick.range.from) && int(m.pick.range.to) && m.pick.range.from > m.pick.range.to) out.push(`${where}: pick range from is above to.`);
  for (const [i, o] of (Array.isArray(m.options) ? m.options : []).entries()) checkItem(o, `${where} option ${i + 1}`, out);
}

function checkCategory(c: any, where: string, out: string[], depth = 0) {
  if (!isObj(c)) { out.push(`${where}: not an object.`); return; }
  if (!str(c.name)) out.push(`${where}: name is required.`);
  if (typeof c.description !== 'string') out.push(`${where}: description is required (it can be empty text).`);
  if (c.type !== undefined && !['root', 'subcategory'].includes(c.type)) out.push(`${where}: type is root or subcategory.`);
  for (const [i, it] of (Array.isArray(c.items) ? c.items : []).entries()) checkItem(it, `${where} item ${i + 1}`, out);
  if (Array.isArray(c.categories) && c.categories.length) {
    if (depth > 4) out.push(`${where}: sub-categories are nested too deep.`);
    else for (const [i, sub] of c.categories.entries()) checkCategory(sub, `${where} › sub-category ${i + 1}`, out, depth + 1);
  }
}

/** The documented rules of the menu payload, as a list of problems (empty = JET will accept the structure). */
export function validateSkipMenusPayload(payload: unknown): string[] {
  const out: string[] = [];
  if (!isObj(payload)) return ['The menu payload must be an object.'];
  if (!Array.isArray(payload.restaurants) || !payload.restaurants.length || payload.restaurants.some((r: unknown) => !str(r))) out.push('restaurants: at least one restaurant id (the POS id JET maps to the restaurant).');
  if (payload.callback_url !== undefined && !/^https:\/\//i.test(String(payload.callback_url))) out.push('callback_url must be an https:// address.');
  if (!Array.isArray(payload.menus) || !payload.menus.length) { out.push('menus: at least one menu.'); return out; }
  payload.menus.forEach((m: any, n: number) => {
    const where = `menu ${n + 1}`;
    if (!isObj(m)) { out.push(`${where}: not an object.`); return; }
    if (!str(m.name)) out.push(`${where}: name is required.`);
    if (!str(m.reference)) out.push(`${where}: reference is required.`);
    if (m.type !== 'COLLECTION' && m.type !== 'DELIVERY') out.push(`${where}: type is COLLECTION or DELIVERY.`);
    if (m.availability !== undefined) {
      if (!isObj(m.availability)) out.push(`${where}: availability must list the seven days.`);
      else for (const d of DAYS) {
        const slots = m.availability[d];
        if (!Array.isArray(slots)) out.push(`${where}: availability.${d} is required (an empty list when closed).`);
        else if (slots.some((s: unknown) => !AVAILABILITY.test(String(s)))) out.push(`${where}: availability.${d} slots look like "10:00 - 23:30".`);
      }
    }
    if (!Array.isArray(m.categories) || !m.categories.length) out.push(`${where}: categories are required.`);
    else m.categories.forEach((c: unknown, i: number) => checkCategory(c, `${where} › category ${i + 1}`, out));
    for (const [i, q] of (Array.isArray(m.quantity_restrictions) ? m.quantity_restrictions : []).entries()) {
      if (!str(q?.id) || !str(q?.name) || !num(q?.maximum) || !Array.isArray(q?.restricted_quantity_plus) || q.restricted_quantity_plus.some((x: any) => !str(x?.plu) || !num(x?.contributing_quantity))) out.push(`${where} quantity restriction ${i + 1}: id, name, maximum and restricted_quantity_plus (plu, contributing_quantity) are required.`);
    }
  });
  return out.slice(0, 50);
}

/** POST /menus with a ready JET payload (callback_url defaults to Food Hub's menu-status address). Nothing is sent if the structure is wrong. */
export async function publishSkipMenus(payload: SkipMenusPayload): Promise<ChannelResult> {
  const withCallback = { ...payload, callback_url: payload.callback_url ?? `${publicBaseUrl()}/api/foodhub/webhooks/skip/menu-status` };
  const problems = validateSkipMenusPayload(withCallback);
  if (problems.length) return result('skip', 'error', `The menu is not valid for Skip: ${problems.slice(0, 5).join(' ')}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ''}`, { response: { problems } });
  return skipSend('POST', '/menus', withCallback, 'queued');
}
