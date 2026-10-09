// Grocery / retail catalogue: packaged products and goods sold by weight, with SKU, barcodes, units, stock per location
// and categories. Kept next to the restaurant menus (not inside them: a product is not a dish with options) and linked
// to Clover inventory item by item, so the register, the stock and Food Hub agree.
// Stored in fh_docs ("retail_products") — no new table.
import crypto from 'node:crypto';
import { logActivity, type Actor } from '../activity';
import { nowIso, round2 } from '../config';
import { getRepo } from '../repo';

export const RETAIL_PRODUCTS = 'retail_products';

export type RetailUnit = 'each' | 'kg' | 'g' | 'lb' | 'oz' | 'l' | 'ml';
export const WEIGHT_UNITS: RetailUnit[] = ['kg', 'g', 'lb', 'oz'];
export const UNITS: RetailUnit[] = ['each', 'kg', 'g', 'lb', 'oz', 'l', 'ml'];

export interface RetailProduct {
  id: string;
  sku: string;
  /** UPC-A / EAN-13 / EAN-8 / PLU — the first one is the main barcode. */
  barcodes: string[];
  name: string;
  nameFr?: string;
  /** Manufacturer brand ("Lactantia"), not one of our restaurant brands. */
  brand?: string;
  description?: string;
  descriptionFr?: string;
  category: string;
  /** 'weight' = priced per kg / lb (deli, produce, bulk); 'unit' = per item. */
  soldBy: 'unit' | 'weight';
  unit: RetailUnit;
  /** Pack size shown to customers: "500 g", "1 L", "6 × 355 ml". */
  size?: string;
  /** Price per item, or per unit of weight when sold by weight. */
  price: number;
  /** Stock per location, in items (or in the weight unit). Missing = not stocked there. */
  stock: Record<string, number>;
  trackStock: boolean;
  lowStockAt?: number;
  /** Alcohol product (beer, wine, cider…). Sold only where the alcohol rules allow it. */
  alcohol?: { abv?: number; volumeMl?: number } | null;
  /** Taxable in Québec (prepared food, snacks, soft drinks…). Basic groceries are zero-rated. */
  taxable: boolean;
  imageUrl?: string;
  /** Locations that sell it ([] = every location). */
  locations: string[];
  posItemRef?: string;
  cloverMerchantId?: string;
  active: boolean;
  source: 'manual' | 'clover' | 'csv';
  createdAt: string;
  updatedAt: string;
}

// ---------- barcodes ----------

function gtinCheckDigitOk(code: string): boolean {
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  // From the right (excluding the check digit), weights alternate 3, 1, 3, 1…
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export type BarcodeKind = 'UPC-A' | 'EAN-13' | 'EAN-8' | 'GTIN-14' | 'PLU';

/** Which barcode this is, or null when it is not a valid one (wrong length or check digit). */
export function barcodeKind(raw: string): BarcodeKind | null {
  const code = String(raw ?? '').replace(/\s|-/g, '');
  if (!/^\d+$/.test(code)) return null;
  if (code.length === 4 || code.length === 5) return 'PLU';
  if (![8, 12, 13, 14].includes(code.length) || !gtinCheckDigitOk(code)) return null;
  return code.length === 8 ? 'EAN-8' : code.length === 12 ? 'UPC-A' : code.length === 13 ? 'EAN-13' : 'GTIN-14';
}

/** The barcode as a 14-digit GTIN (what catalogue APIs usually key on); PLU codes stay as they are. */
export function toGtin14(raw: string): string | null {
  const code = String(raw ?? '').replace(/\s|-/g, '');
  const kind = barcodeKind(code);
  if (!kind) return null;
  return kind === 'PLU' ? code : code.padStart(14, '0');
}

// ---------- validation ----------

export function productProblems(p: Partial<RetailProduct>): string[] {
  const out: string[] = [];
  if (!p.name?.trim()) out.push('Name is required.');
  if (!p.sku?.trim()) out.push('SKU is required.');
  if (!(Number(p.price) >= 0)) out.push('Price must be 0 or more.');
  for (const b of p.barcodes ?? []) if (!barcodeKind(b)) out.push(`Barcode ${b} is not a valid UPC / EAN / PLU (check digit or length).`);
  if (p.soldBy === 'weight' && p.unit && !WEIGHT_UNITS.includes(p.unit)) out.push('A product sold by weight needs a weight unit (kg, g, lb, oz).');
  if (p.soldBy === 'unit' && p.unit && WEIGHT_UNITS.includes(p.unit)) out.push('A product sold by the item uses "each", "l" or "ml" as its unit.');
  if (p.alcohol && p.alcohol.abv !== undefined && (p.alcohol.abv < 0 || p.alcohol.abv > 100)) out.push('Alcohol % must be between 0 and 100.');
  return out;
}

export function cleanProduct(raw: Partial<RetailProduct>, prev?: RetailProduct): RetailProduct {
  const now = nowIso();
  const soldBy = raw.soldBy === 'weight' ? 'weight' : raw.soldBy === 'unit' ? 'unit' : prev?.soldBy ?? 'unit';
  const asked = (UNITS.includes(raw.unit as RetailUnit) ? raw.unit : prev?.unit) as RetailUnit | undefined;
  // A unit that does not fit how the product is sold falls back to the usual one (kg by weight, "each" by the item).
  const fits = asked && (soldBy === 'weight' ? WEIGHT_UNITS.includes(asked) : !WEIGHT_UNITS.includes(asked));
  const unit: RetailUnit = fits ? asked! : soldBy === 'weight' ? 'kg' : 'each';
  const stock: Record<string, number> = {};
  for (const [code, q] of Object.entries(raw.stock ?? prev?.stock ?? {})) {
    const n = Number(q);
    if (/^[A-Z0-9_]{2,30}$/.test(code) && Number.isFinite(n)) stock[code] = soldBy === 'weight' ? Math.round(n * 1000) / 1000 : Math.round(n);
  }
  const barcodes = [...new Set((raw.barcodes ?? prev?.barcodes ?? []).map((b) => String(b).replace(/\s|-/g, '')).filter(Boolean))].slice(0, 10);
  const alcohol = raw.alcohol === null ? null : raw.alcohol ?? prev?.alcohol ?? null;
  return {
    id: prev?.id ?? raw.id ?? `rp_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`,
    sku: String(raw.sku ?? prev?.sku ?? '').trim().slice(0, 64),
    barcodes,
    name: String(raw.name ?? prev?.name ?? '').trim().slice(0, 200),
    nameFr: (raw.nameFr ?? prev?.nameFr)?.trim().slice(0, 200) || undefined,
    brand: (raw.brand ?? prev?.brand)?.trim().slice(0, 120) || undefined,
    description: (raw.description ?? prev?.description)?.trim().slice(0, 1000) || undefined,
    descriptionFr: (raw.descriptionFr ?? prev?.descriptionFr)?.trim().slice(0, 1000) || undefined,
    category: String(raw.category ?? prev?.category ?? 'Épicerie').trim().slice(0, 80) || 'Épicerie',
    soldBy,
    unit,
    size: (raw.size ?? prev?.size)?.trim().slice(0, 40) || undefined,
    price: round2(Math.max(0, Number(raw.price ?? prev?.price ?? 0) || 0)),
    stock,
    trackStock: raw.trackStock ?? prev?.trackStock ?? true,
    lowStockAt: raw.lowStockAt !== undefined ? Math.max(0, Number(raw.lowStockAt) || 0) : prev?.lowStockAt,
    alcohol: alcohol ? { abv: alcohol.abv !== undefined ? Number(alcohol.abv) : undefined, volumeMl: alcohol.volumeMl !== undefined ? Math.round(Number(alcohol.volumeMl)) : undefined } : null,
    taxable: raw.taxable ?? prev?.taxable ?? false,
    imageUrl: (raw.imageUrl ?? prev?.imageUrl)?.trim() || undefined,
    locations: (raw.locations ?? prev?.locations ?? []).filter((c) => /^[A-Z0-9_]{2,30}$/.test(c)),
    posItemRef: raw.posItemRef ?? prev?.posItemRef,
    cloverMerchantId: raw.cloverMerchantId ?? prev?.cloverMerchantId,
    active: raw.active ?? prev?.active ?? true,
    source: raw.source ?? prev?.source ?? 'manual',
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
}

// ---------- storage ----------

export async function listProducts(): Promise<RetailProduct[]> {
  const docs = await getRepo().listDocs<RetailProduct>(RETAIL_PRODUCTS, { limit: 20_000 });
  return docs.map((d) => d.data).sort((a, b) => a.category.localeCompare(b.category, 'fr') || a.name.localeCompare(b.name, 'fr'));
}

export async function getProduct(id: string): Promise<RetailProduct | null> {
  return (await getRepo().getDoc<RetailProduct>(RETAIL_PRODUCTS, id))?.data ?? null;
}

export async function findByBarcode(code: string): Promise<RetailProduct | null> {
  const clean = String(code).replace(/\s|-/g, '');
  const gtin = toGtin14(clean);
  const list = await listProducts();
  return list.find((p) => p.barcodes.some((b) => b === clean || (gtin && toGtin14(b) === gtin))) ?? list.find((p) => p.sku === clean) ?? null;
}

export async function saveProduct(raw: Partial<RetailProduct>, actor: Actor): Promise<RetailProduct> {
  const prev = raw.id ? await getProduct(raw.id) : null;
  const next = cleanProduct(raw, prev ?? undefined);
  const problems = productProblems(next);
  if (problems.length) throw new Error(problems.join(' '));
  const all = await listProducts();
  const clash = all.find((p) => p.id !== next.id && (p.sku === next.sku || p.barcodes.some((b) => next.barcodes.includes(b))));
  if (clash) throw new Error(`"${clash.name}" already uses this SKU or barcode.`);
  await getRepo().putDocs<RetailProduct>(RETAIL_PRODUCTS, [{ id: next.id, key: next.sku, at: next.createdAt, data: next }]);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: prev ? 'retail_product_update' : 'retail_product_add', status: 'success',
    summary: `${prev ? 'Updated' : 'Added'} product ${next.name} (SKU ${next.sku})` });
  return next;
}

export async function saveProductsBulk(list: RetailProduct[]): Promise<void> {
  await getRepo().putDocs<RetailProduct>(RETAIL_PRODUCTS, list.map((p) => ({ id: p.id, key: p.sku, at: p.createdAt, data: p })));
}

export async function deleteProduct(id: string, actor: Actor): Promise<void> {
  const p = await getProduct(id);
  await getRepo().deleteDocs(RETAIL_PRODUCTS, [id]);
  if (p) await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'retail_product_delete', status: 'success', summary: `Removed product ${p.name} (SKU ${p.sku})` });
}

/** Stock change at one location (a sale, a delivery received, a count). Never below zero. */
export async function adjustStock(id: string, locationCode: string, delta: number, actor: Actor, reason = 'adjustment'): Promise<RetailProduct> {
  const p = await getProduct(id);
  if (!p) throw new Error('Product not found.');
  const cur = p.stock[locationCode] ?? 0;
  const nextQty = Math.max(0, p.soldBy === 'weight' ? Math.round((cur + delta) * 1000) / 1000 : Math.round(cur + delta));
  const next = { ...p, stock: { ...p.stock, [locationCode]: nextQty }, updatedAt: nowIso() };
  await saveProductsBulk([next]);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'item_availability', action: 'retail_stock', status: 'success', locationCode,
    summary: `Stock ${p.name} at ${locationCode}: ${cur} → ${nextQty} ${p.unit === 'each' ? '' : p.unit} (${reason})`.replace(/\s+\(/, ' (') });
  return next;
}

/** Available to sell at a location: active, sold there, in stock (or stock not tracked). */
export function sellableAt(p: RetailProduct, locationCode: string): boolean {
  if (!p.active) return false;
  if (p.locations.length && !p.locations.includes(locationCode)) return false;
  if (!p.trackStock) return true;
  return (p.stock[locationCode] ?? 0) > 0;
}

export function lowStock(p: RetailProduct, locationCode: string): boolean {
  return p.trackStock && p.lowStockAt !== undefined && (p.stock[locationCode] ?? 0) <= p.lowStockAt;
}

// ---------- CSV import ----------

const HEADERS: Record<string, keyof RetailProduct | 'stock_qty' | 'abv' | 'volume_ml'> = {
  sku: 'sku', barcode: 'barcodes', upc: 'barcodes', ean: 'barcodes', 'code barre': 'barcodes', 'code-barres': 'barcodes',
  name: 'name', nom: 'name', name_fr: 'nameFr', nom_fr: 'nameFr', brand: 'brand', marque: 'brand', category: 'category', categorie: 'category', 'catégorie': 'category',
  price: 'price', prix: 'price', unit: 'unit', unite: 'unit', 'unité': 'unit', size: 'size', format: 'size', stock: 'stock_qty', quantite: 'stock_qty', 'quantité': 'stock_qty',
  taxable: 'taxable', abv: 'abv', alcool: 'abv', volume_ml: 'volume_ml', description: 'description',
};

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === sep && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Reads a product list (CSV with a header row; comma or semicolon). Stock goes to `locationCode`.
 * Returns the products ready to save and one message per refused row — nothing is saved here.
 */
export function parseProductCsv(text: string, locationCode: string): { products: Array<Partial<RetailProduct>>; errors: string[] } {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { products: [], errors: ['The file needs a header row and at least one product.'] };
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const head = splitCsvLine(lines[0], sep).map((h) => HEADERS[h.toLowerCase().trim()] ?? null);
  if (!head.includes('name') || !head.includes('sku')) return { products: [], errors: ['Columns "sku" and "name" (or "nom") are required.'] };
  const products: Array<Partial<RetailProduct>> = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, idx) => {
    const cells = splitCsvLine(line, sep);
    const p: Partial<RetailProduct> & { barcodes: string[] } = { barcodes: [], source: 'csv' };
    let abv: number | undefined;
    let volumeMl: number | undefined;
    head.forEach((h, i) => {
      const v = cells[i] ?? '';
      if (!h || v === '') return;
      if (h === 'barcodes') p.barcodes.push(...v.split(/[|/ ]+/).filter(Boolean));
      else if (h === 'price') p.price = Number(v.replace(/[$\s]/g, '').replace(',', '.'));
      else if (h === 'stock_qty') p.stock = { [locationCode]: Number(v.replace(',', '.')) };
      else if (h === 'taxable') p.taxable = /^(1|y|yes|o|oui|true|vrai)$/i.test(v);
      else if (h === 'abv') abv = Number(v.replace('%', '').replace(',', '.'));
      else if (h === 'volume_ml') volumeMl = Number(v);
      else if (h === 'unit') { const u = v.toLowerCase() as RetailUnit; p.unit = UNITS.includes(u) ? u : 'each'; p.soldBy = WEIGHT_UNITS.includes(u) ? 'weight' : 'unit'; }
      else (p as Record<string, unknown>)[h] = v;
    });
    if (abv !== undefined && abv > 0) p.alcohol = { abv, volumeMl };
    const problems = productProblems(cleanProduct(p));
    if (problems.length) errors.push(`Row ${idx + 2}: ${problems.join(' ')}`);
    else products.push(p);
  });
  return { products, errors };
}
