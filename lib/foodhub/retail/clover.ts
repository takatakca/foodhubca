// Retail catalogue ↔ Clover inventory. Clover stays the register: its item id, barcode ("code"), SKU, price type and
// stock count are read into Food Hub, and a stock count or a price changed in Food Hub can be sent back item by item.
//   GET  /v3/merchants/{mId}/items?expand=categories,itemStock     read (paged)
//   POST /v3/merchants/{mId}/item_stocks/{itemId}  {quantity}       stock count
//   POST /v3/merchants/{mId}/items/{itemId}        {price}          price (cents)
// Only items that carry a barcode or a SKU are imported (restaurant dishes are not products), unless `all` is asked.
import { logActivity, type Actor } from '../activity';
import { fromCents, nowIso, timedFetch, toCents } from '../config';
import { cloverBaseUrl, cloverToken, defaultCloverMerchant } from '../pos/clover';
import { barcodeKind, cleanProduct, listProducts, saveProductsBulk, type RetailProduct, type RetailUnit } from './catalog';

const UNIT_MAP: Record<string, RetailUnit> = { kg: 'kg', kilo: 'kg', kilogram: 'kg', g: 'g', gram: 'g', lb: 'lb', lbs: 'lb', pound: 'lb', oz: 'oz', l: 'l', litre: 'l', liter: 'l', ml: 'ml' };

/** One Clover item → product fields (null when it does not look like a product and `all` is off). */
export function productFromCloverItem(it: any, mid: string, locationCode: string | null, all = false): Partial<RetailProduct> | null {
  if (!it?.id || !it?.name || it.hidden) return null;
  const code = String(it.code ?? '').replace(/\s|-/g, '');
  const sku = String(it.sku ?? '').trim();
  if (!all && !code && !sku) return null;
  const priceType = String(it.priceType ?? 'FIXED').toUpperCase();
  const unitName = String(it.unitName ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const unit = UNIT_MAP[unitName] ?? 'each';
  const soldBy = priceType === 'PER_UNIT' && ['kg', 'g', 'lb', 'oz'].includes(unit) ? 'weight' : 'unit';
  const qty = Number(it.itemStock?.quantity ?? it.itemStock?.stockCount ?? it.stockCount);
  return {
    sku: sku || `CLV-${it.id}`,
    barcodes: code && barcodeKind(code) ? [code] : [],
    name: String(it.name),
    description: it.alternateName ? String(it.alternateName) : undefined,
    category: it.categories?.elements?.[0]?.name ? String(it.categories.elements[0].name) : 'Clover',
    soldBy,
    unit: soldBy === 'weight' ? unit : (unit === 'l' || unit === 'ml' ? unit : 'each'),
    // VARIABLE price items have no fixed price in Clover: imported at 0 and inactive until a price is set.
    price: priceType === 'VARIABLE' ? 0 : fromCents(Number(it.price) || 0),
    active: priceType !== 'VARIABLE' && it.available !== false,
    trackStock: Number.isFinite(qty),
    ...(Number.isFinite(qty) && locationCode ? { stock: { [locationCode]: qty } } : {}),
    taxable: Array.isArray(it.taxRates?.elements) ? it.taxRates.elements.length > 0 : it.defaultTaxRates !== false,
    posItemRef: String(it.id),
    cloverMerchantId: mid,
    source: 'clover',
  };
}

async function cloverItems(mid: string, token: string): Promise<any[]> {
  const out: any[] = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const url = `${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(mid)}/items?limit=1000&offset=${offset}&expand=categories,itemStock,taxRates`;
    const res = await timedFetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Clover items returned HTTP ${res.status}`);
    const rows = (await res.json())?.elements ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** Import (or refresh) products from one Clover merchant. Existing products are matched by Clover id, then barcode, then SKU. */
export async function importRetailFromClover(opts: { merchantId?: string | null; locationCode: string | null; all?: boolean; actor: Actor }): Promise<{ added: number; updated: number; skipped: number }> {
  const mid = opts.merchantId || (await defaultCloverMerchant());
  if (!mid) throw new Error('No Clover merchant: set CLOVER_MERCHANT_ID or connect a merchant first.');
  const token = await cloverToken(mid);
  if (!token) throw new Error(`No Clover API token for merchant ${mid}.`);
  const items = await cloverItems(mid, token);
  const existing = await listProducts();
  const out: RetailProduct[] = [];
  let added = 0; let updated = 0; let skipped = 0;
  for (const it of items) {
    const fields = productFromCloverItem(it, mid, opts.locationCode, opts.all);
    if (!fields) { skipped++; continue; }
    const prev = existing.find((p) => p.posItemRef === fields.posItemRef && p.cloverMerchantId === mid)
      ?? existing.find((p) => fields.barcodes?.length && p.barcodes.includes(fields.barcodes[0]))
      ?? existing.find((p) => p.sku === fields.sku);
    // Food Hub-only fields (French name, alcohol, locations, low-stock level) are kept on refresh; stock merges per location.
    const merged = prev ? { ...fields, stock: { ...prev.stock, ...(fields.stock ?? {}) }, category: prev.category || fields.category, active: prev.active } : fields;
    out.push(cleanProduct(merged, prev));
    if (prev) updated++; else added++;
  }
  if (out.length) await saveProductsBulk(out);
  await logActivity({ actor: opts.actor.name, source: opts.actor.source, kind: 'settings', action: 'retail_import_clover', status: 'success', locationCode: opts.locationCode,
    summary: `Retail catalogue imported from Clover ${mid}: ${added} new, ${updated} updated, ${skipped} skipped (no barcode / SKU)` });
  return { added, updated, skipped };
}

/** Sends one product's stock count (for a location) and price to its Clover item. */
export async function pushProductToClover(p: RetailProduct, locationCode: string, actor: Actor): Promise<{ ok: boolean; message: string }> {
  if (!p.posItemRef || !p.cloverMerchantId) return { ok: false, message: 'This product is not linked to a Clover item (import it from Clover first).' };
  const token = await cloverToken(p.cloverMerchantId);
  if (!token) return { ok: false, message: `No Clover API token for merchant ${p.cloverMerchantId}.` };
  const base = `${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(p.cloverMerchantId)}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  const errors: string[] = [];
  try {
    if (p.trackStock && p.stock[locationCode] !== undefined) {
      const r = await timedFetch(`${base}/item_stocks/${encodeURIComponent(p.posItemRef)}`, { method: 'POST', headers, body: JSON.stringify({ quantity: p.stock[locationCode] }) });
      if (!r.ok) errors.push(`stock HTTP ${r.status}`);
    }
    const r2 = await timedFetch(`${base}/items/${encodeURIComponent(p.posItemRef)}`, { method: 'POST', headers, body: JSON.stringify({ price: toCents(p.price) }) });
    if (!r2.ok) errors.push(`price HTTP ${r2.status}`);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  const ok = errors.length === 0;
  await logActivity({ actor: actor.name, source: actor.source, kind: 'item_availability', action: 'retail_push_clover', status: ok ? 'success' : 'failed', locationCode,
    summary: `${p.name} → Clover: ${ok ? `stock ${p.stock[locationCode] ?? '—'}, price ${p.price.toFixed(2)} $` : errors.join(', ')}`, detail: { at: nowIso() } });
  return { ok, message: ok ? 'Sent to Clover.' : `Clover refused: ${errors.join(', ')}` };
}
