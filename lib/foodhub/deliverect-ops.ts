// What Food Hub does with each Deliverect webhook (the catch-all route app/api/foodhub/webhooks/deliverect/[...kind]):
//   register            Deliverect registers a location → we answer with every URL it may call (orders, sync, tax, status…)
//   orders              a Too Good To Go order → the normal pipeline; a channel CANCEL (status 100) → cancelled + 110 back
//   sync-products       Deliverect asks for the products → 204, then the brand's master menu is pushed (Insert Products)
//   sync-tables/floors  answered (Food Hub is a pick-up / delivery POS: one "delivery" table, no floors)
//   tax-calculation     taxes of an order from DELIVERECT_TAX_RATES (tax-exclusive regions); otherwise the channel's own taxes
//   validate-order      is every item still on sale? (the master menu's availability)
//   store-status        the store opened / closed on a channel → kept on the store
//   reporting           order, order-status and courier events (informational)
//   product-sync-callback / kds / retail   kept as events, answered as the docs ask
import { AUTOMATION, logActivity } from './activity';
import { DELIVERECT_ID_PREFIX, DELIVERECT_STORE_PREFIX, deliverectRef, parseDeliverectOrder } from './adapters/deliverect';
import { DELIVERECT_STATUS, deliverect } from './adapters/deliverect-api';
import { nowIso, publicBaseUrl } from './config';
import { getBrandMenu } from './menu/shared';
import { applyExternalStatus } from './pipeline';
import { getRepo } from './repo';
import type { ChannelStore, MasterMenu, NormalizedOrder } from './types';

export const DELIVERECT_EVENTS = 'deliverect_events';
export const DELIVERECT_LOCATIONS = 'deliverect_locations';

const isObj = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Keeps one received webhook (small, newest last 200 per kind are not pruned here: the table is for support). */
export async function keepDeliverectEvent(kind: string, body: unknown, reference?: string | null): Promise<void> {
  const id = `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await getRepo().putDocs(DELIVERECT_EVENTS, [{ id, key: kind, at: nowIso(), data: { kind, reference: reference ?? null, body } }]).catch(() => undefined);
}

function urlWithToken(path: string, extra: Record<string, string> = {}): string {
  const u = new URL(`${publicBaseUrl()}/api/foodhub/webhooks/deliverect/${path}`);
  if (process.env.DELIVERECT_WEBHOOK_SECRET) u.searchParams.set('token', process.env.DELIVERECT_WEBHOOK_SECRET);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

// --- register -----------------------------------------------------------------------------------------------------

export interface DeliverectLocationRecord { accountId: string; locationId: string; externalLocationId: string; name: string; registeredAt: string }

/** "Register POS": remember the location and return every URL Deliverect may call (empty string = not supported). */
export async function handleDeliverectRegister(body: any): Promise<Record<string, string> | null> {
  if (!isObj(body) || !body.locationId) return null;
  const rec: DeliverectLocationRecord = { accountId: String(body.accountId ?? ''), locationId: String(body.locationId), externalLocationId: String(body.externalLocationId ?? ''), name: String(body.locationName ?? ''), registeredAt: nowIso() };
  await getRepo().putDocs(DELIVERECT_LOCATIONS, [{ id: rec.locationId, key: rec.externalLocationId || rec.locationId, at: rec.registeredAt, data: rec }]);
  await logActivity({ actor: 'Deliverect', source: 'platform', kind: 'settings', action: 'deliverect_register', status: 'success', channel: 'tgtg',
    summary: `Deliverect registered location ${rec.name || rec.locationId}${rec.externalLocationId ? ` (our id ${rec.externalLocationId})` : ''}. Map the Food Hub store with the store id ${DELIVERECT_STORE_PREFIX}${rec.externalLocationId || rec.locationId}.` });
  return {
    ordersWebhookURL: urlWithToken('orders'),
    syncProductsURL: urlWithToken('sync-products', { locationID: rec.locationId }),
    syncTablesURL: urlWithToken('sync-tables'),
    syncFloorsURL: urlWithToken('sync-floors'),
    operationsWebhookURL: '',
    storeStatusWebhookURL: urlWithToken('store-status'),
    taxCalculationWebhookURL: taxRates().length ? urlWithToken('tax-calculation') : '',
  };
}

export function handleDeliverectKdsRegister(body: any): Record<string, string> | null {
  if (!isObj(body) || !body.locationId) return null;
  return { productSyncUrl: urlWithToken('kds/product-update'), orderWebhookUrl: urlWithToken('kds/orders'), orderStatusUpdateUrl: urlWithToken('kds/order-status') };
}

// --- orders -------------------------------------------------------------------------------------------------------

export type DeliverectOrderOutcome =
  | { kind: 'order'; order: NormalizedOrder }
  | { kind: 'cancel'; deliverectOrderId: string; externalOrderId: string }
  | { kind: 'ignored'; reason: string };

/** Splits an order notification into a new order, a channel cancel (status 100) or something Food Hub does not take. */
export function classifyDeliverectOrder(body: any): DeliverectOrderOutcome {
  if (isObj(body) && Number(body.status) === DELIVERECT_STATUS.CANCEL && body._id) {
    return { kind: 'cancel', deliverectOrderId: String(body._id), externalOrderId: `${DELIVERECT_ID_PREFIX}${body._id}` };
  }
  const parsed = parseDeliverectOrder(body);
  return 'ignored' in parsed ? { kind: 'ignored', reason: parsed.ignored } : { kind: 'order', order: parsed.order };
}

/**
 * A channel CANCEL: void the order in Food Hub (stopping its Clover ticket), then confirm CANCELED (110) on the original
 * _id. The cancel can beat the order itself: applyExternalStatus keeps it and applies it on arrival.
 */
export async function applyDeliverectCancel(deliverectOrderId: string, body?: any): Promise<{ confirmed: boolean; message: string }> {
  const externalOrderId = `${DELIVERECT_ID_PREFIX}${deliverectOrderId}`;
  const order = await applyExternalStatus('tgtg', externalOrderId, 'cancelled', { reason: 'Cancelled on Too Good To Go (Deliverect CANCEL)', source: 'deliverect' });
  const ref = order ? deliverectRef(order) : null;
  const receiptId = ref?.receiptId ?? String(body?.channelOrderDisplayId ?? deliverectOrderId);
  const res = await deliverect.orderStatus(deliverectOrderId, receiptId, DELIVERECT_STATUS.CANCELED, { reason: 'cancellation' });
  if (order) await getRepo().addEvent(order.id, res.ok ? 'deliverect_cancel_confirmed' : 'deliverect_cancel_not_confirmed', { message: res.message });
  return { confirmed: res.ok, message: res.message };
}

// --- products -----------------------------------------------------------------------------------------------------

export function taxRates(): Array<{ name: string; rate: number }> {
  try {
    const raw = JSON.parse(process.env.DELIVERECT_TAX_RATES || '[]');
    return (Array.isArray(raw) ? raw : []).filter((t) => isObj(t) && t.name && Number.isFinite(Number(t.rate))).map((t) => ({ name: String(t.name), rate: Number(t.rate) }));
  } catch { return []; }
}

/** Percent rate → Deliverect's integer with 3 decimals (10% = 10000). */
const milli = (pct: number) => Math.round(pct * 1000);

export function deliverectProductsFromMenu(menu: MasterMenu, ids: { accountId: string; locationId: string }): Record<string, unknown> {
  const totalMilli = taxRates().reduce((s, t) => s + milli(t.rate), 0);
  const cents = (n: number) => Math.round((Number(n) || 0) * 100);
  const tax = { deliveryTax: totalMilli, takeawayTax: totalMilli, eatInTax: totalMilli };
  const products: Record<string, unknown>[] = [];
  const groupPlu = (ref: string) => `GRP-${ref}`;
  for (const g of menu.modifierGroups) {
    products.push({ name: g.name, plu: groupPlu(g.ref), price: 0, productType: 3, min: g.min, max: g.max, subProducts: g.modifiers.map((m) => m.ref), ...tax });
    for (const m of g.modifiers) products.push({ name: m.name, plu: m.ref, price: cents(m.price), productType: 2, visible: m.available, ...tax });
  }
  for (const it of menu.items) {
    products.push({
      name: it.name, plu: it.ref, price: cents(it.price), productType: 1, description: it.description, posCategoryIds: [it.categoryRef], visible: it.available, imageUrl: it.imageUrl,
      subProducts: it.modifierGroupRefs.map(groupPlu), ...(it.nameFr ? { nameTranslations: { fr: it.nameFr } } : {}), ...(it.descriptionFr ? { descriptionTranslations: { fr: it.descriptionFr } } : {}), ...tax,
    });
  }
  const seen = new Set<string>();
  const unique = products.filter((p) => (seen.has(String(p.plu)) ? false : (seen.add(String(p.plu)), true)));
  return { accountId: ids.accountId, locationId: ids.locationId, products: unique, categories: menu.categories.map((c) => ({ name: c.name, posCategoryId: c.ref })) };
}

async function storeForDeliverectLocation(locationId: string): Promise<{ store: ChannelStore | null; record: DeliverectLocationRecord | null }> {
  const repo = getRepo();
  const record = (await repo.getDoc<DeliverectLocationRecord>(DELIVERECT_LOCATIONS, locationId))?.data ?? null;
  const candidates = [record?.externalLocationId, locationId].filter(Boolean) as string[];
  for (const c of candidates) {
    const store = await repo.findStore('tgtg', `${DELIVERECT_STORE_PREFIX}${c}`);
    if (store) return { store, record };
  }
  return { store: null, record };
}

/** "Sync Products" from Deliverect: push the brand's master menu for that location. */
export async function pushDeliverectProducts(locationId: string): Promise<{ ok: boolean; message: string }> {
  const { store, record } = await storeForDeliverectLocation(locationId);
  if (!store || !record?.accountId) {
    await logActivity({ actor: AUTOMATION, source: 'automation', kind: 'menu_publish', action: 'deliverect_sync', status: 'info', channel: 'tgtg', summary: `Deliverect asked for the products of ${locationId}: ${!record ? 'the location was never registered' : 'no Food Hub store is mapped to it'} — nothing sent.` });
    return { ok: false, message: 'Location not registered or store not mapped.' };
  }
  const menu = await getBrandMenu(store.brandName);
  if (!menu) return { ok: false, message: `No menu for ${store.brandName}.` };
  const res = await deliverect.insertProducts(deliverectProductsFromMenu(menu, { accountId: record.accountId, locationId }));
  await logActivity({ actor: AUTOMATION, source: 'automation', kind: 'menu_publish', action: 'deliverect_sync', status: res.ok ? 'success' : 'failed', channel: 'tgtg', brandName: store.brandName, locationCode: store.locationCode, storeId: store.id,
    summary: `Products sent to Deliverect for ${store.brandName} · ${store.locationCode}: ${res.message}` });
  return { ok: res.ok, message: res.message };
}

// --- tax calculation & validation -----------------------------------------------------------------------------------

function cartSubtotal(items: any[]): number {
  let sum = 0;
  const walk = (list: any[], mult: number) => { for (const s of Array.isArray(list) ? list : []) { const q = Math.max(1, Number(s?.quantity) || 1); sum += (Number(s?.price) || 0) * q * mult; walk(s?.subItems, mult * q); } };
  walk(items, 1);
  return sum;
}

/** Tax of the order (minor units) from DELIVERECT_TAX_RATES; without rates the channel's own taxes are returned as they came. */
export function deliverectTaxCalculation(order: any): { taxes: Array<{ name: string; taxClassId: number; total: number }> } {
  const rates = taxRates();
  if (!rates.length) return { taxes: (Array.isArray(order?.taxes) ? order.taxes : []).map((t: any, i: number) => ({ name: String(t?.name ?? 'tax'), taxClassId: Number(t?.taxClassId ?? i), total: Math.round(Number(t?.total) || 0) })) };
  const base = Math.max(0, cartSubtotal(order?.items ?? []) + Math.min(0, Number(order?.discountTotal) || 0));
  return { taxes: rates.map((t, i) => ({ name: t.name, taxClassId: i, total: Math.round((base * t.rate) / 100) })) };
}

/** Order validation (before payment): every cart line must still be on sale in the brand's master menu. */
export async function validateDeliverectCart(body: any): Promise<{ isValid: boolean; errors: Array<Record<string, unknown>>; items: Array<Record<string, unknown>> }> {
  const errors: Array<Record<string, unknown>> = [];
  const items: Array<Record<string, unknown>> = [];
  const loc = String(body?.posLocationId || body?.location || '');
  const repo = getRepo();
  const store = loc ? (await repo.findStore('tgtg', `${DELIVERECT_STORE_PREFIX}${loc}`)) ?? (await storeForDeliverectLocation(String(body?.location ?? ''))).store : null;
  const menu = store ? await getBrandMenu(store.brandName) : null;
  for (const it of Array.isArray(body?.items) ? body.items : []) {
    const plu = String(it?.plu ?? '');
    const found = menu?.items.find((m) => m.ref === plu || m.posItemRef === plu);
    const off = found && (!found.available || (store && (menu?.unavailableByLocation?.[store.locationCode] ?? []).includes(found.ref)));
    items.push({ itemId: it?._id, plu, available: !off, quantity: Number(it?.quantity) || 1 });
    if (off) errors.push({ code: 'product_snoozed', plu, itemId: it?._id, message: `${found!.name} is temporarily unavailable`, expected: Number(it?.quantity) || 1, actual: 0 });
  }
  return { isValid: errors.length === 0, errors, items };
}

// --- store status, reporting, product sync, KDS, retail --------------------------------------------------------------

export async function handleDeliverectStoreStatus(body: any): Promise<number> {
  const repo = getRepo();
  let applied = 0;
  for (const u of Array.isArray(body?.storeStatusSyncUpdates) ? body.storeStatusSyncUpdates : []) {
    const loc = String(u?.posLocationId || u?.locationId || '');
    const store = loc ? await repo.findStore('tgtg', `${DELIVERECT_STORE_PREFIX}${loc}`) : null;
    const closed = u?.event === 'storeClosed';
    if (!store) { await keepDeliverectEvent('store-status', u, loc); continue; }
    await repo.updateStore(store.id, { online: !closed, lastStatusSource: 'deliverect:platform', meta: { ...store.meta, deliverectStoreStatus: { event: u.event, source: u.source, reason: u.reason ?? null, channel: u.channel, channelLinkId: u.channelLinkId, at: u.eventTime ?? nowIso() } } });
    applied++;
    await logActivity({ actor: 'Deliverect', source: 'platform', kind: 'store_status', action: closed ? 'platform_paused' : 'platform_online', status: 'info', channel: 'tgtg', brandName: store.brandName, locationCode: store.locationCode, storeId: store.id,
      summary: `${store.brandName} · ${store.locationCode} ${closed ? 'closed' : 'opened'} on a Deliverect channel${u.reason ? ` (${u.reason})` : ''}` });
  }
  return applied;
}

/** Reporting events: order status ({orderId,status,timeStamp}), courier update ({orderId,courier,received}) or a copy of the order. */
export async function handleDeliverectReporting(body: any): Promise<'status' | 'courier' | 'order' | 'unknown'> {
  const repo = getRepo();
  const orderId = String(body?.orderId ?? body?._id ?? '');
  const order = orderId ? await repo.findOrder('tgtg', `${DELIVERECT_ID_PREFIX}${orderId}`) : null;
  if (isObj(body) && body.orderId && body.status !== undefined && body.timeStamp) {
    if (order) await repo.addEvent(order.id, 'deliverect_status', { status: body.status, reason: body.reason ?? null, at: body.timeStamp });
    else await keepDeliverectEvent('reporting-status', body, orderId);
    return 'status';
  }
  if (isObj(body) && body.orderId && isObj(body.courier)) {
    if (order) await repo.addEvent(order.id, 'deliverect_courier', { courier: body.courier, pickupTime: body.pickupTime, deliveryTime: body.deliveryTime });
    else await keepDeliverectEvent('reporting-courier', body, orderId);
    return 'courier';
  }
  if (isObj(body) && Array.isArray(body.items) && body._id) return 'order';
  await keepDeliverectEvent('reporting-unknown', body);
  return 'unknown';
}

export async function handleDeliverectProductSyncCallback(body: any): Promise<void> {
  await getRepo().setKv('deliverect_last_product_sync', { at: nowIso(), report: body });
  const errors = Number(body?.errors) || 0;
  await logActivity({ actor: 'Deliverect', source: 'platform', kind: 'menu_publish', action: 'deliverect_product_callback', status: errors ? 'failed' : 'success', channel: 'tgtg',
    summary: `Deliverect product update: ${body?.products?.inserted ?? 0} added, ${body?.products?.updated ?? 0} updated, ${body?.products?.deleted ?? 0} removed, ${Number(body?.warnings) || 0} warning(s), ${errors} error(s)` });
}

/** Retail channel callbacks (picking status, amendments): kept so the order shows what the store did. */
export async function handleDeliverectRetailEvent(kind: 'events' | 'amendments', body: any): Promise<void> {
  const channelOrderId = String(body?.eventData?.channelOrderId ?? body?.channelOrderId ?? '');
  await keepDeliverectEvent(`retail-${kind}`, body, channelOrderId || null);
  if (kind === 'events' && body?.eventData?.status === 'PICKING_REJECTED') {
    await logActivity({ actor: 'Deliverect', source: 'platform', kind: 'order', action: 'retail_picking_rejected', status: 'failed', channel: 'tgtg', summary: `Picking rejected for ${channelOrderId || 'an order'}: ${body.eventData.rejectReason ?? 'no reason given'}` });
  }
}

export async function handleDeliverectKdsProducts(body: any): Promise<number> {
  const n = Array.isArray(body) ? body.length : 0;
  await getRepo().setKv('deliverect_kds_products', { at: nowIso(), count: n });
  return n;
}

