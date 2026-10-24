// Too Good To Go — what is possible without a public store API (verified Oct 2026: TGTG offers no store API;
// its only POS order feed is through Deliverect, and quantities are set in the TGTG Store app).
//  - Daily bag log per location: bags offered, sold, price → becomes a "Too Good To Go" sale for that day,
//    so the Command Center, analytics, reconciliation and Clover-free reporting include TGTG.
//  - If real TGTG orders arrive by webhook (Deliverect feed) for that day and location, the log is
//    informational only (no double counting). Bags handed over one by one (« Sac remis ») are their own sales: the
//    log then counts only the bags sold without one (never twice in the reports).
//  - TGTG payouts are reconciled from their statements in Statement imports.
//  - Kitchens on Takatak MEV (Revenu Québec invoices): the daily count is NEVER a sale sent to Revenu Québec. Each meal
//    needs its own invoice handed over right after payment, and each sale is sent « sans délai »; a count typed after
//    the day has no customer left to hand an invoice to. Each bag is its own sale, printed at pickup: a TGTG e-mail
//    order (tgtg-email/), or « Sac remis » here (recordBagPickup). The day screen shows bags sold without an invoice.
import crypto from 'node:crypto';
import { logActivity, type Actor } from './activity';
import { nowIso } from './config';
import { localDate } from './hours';
import { mevGate } from './mev/config';
import { mevOnOrderChange } from './mev/hooks';
import { settleMevKicks } from './mev/outbox';
import type { MevRecord } from './mev/types';
import { getRepo } from './repo';
import { PICKUP_PREFIX, normalizeTgtgCode, tgtgMailOrderId, tgtgPickupOrderId } from './tgtg-email/ids';
import { getTgtgEmailSettings, tgtgEmailActive } from './tgtg-email/settings';
import { foodhubTimeZone, startOfLocalDayMs } from './time';
import type { StoredOrder } from './types';

export const BAGS = 'tgtg_bag_days';

export interface BagDay {
  id: string;
  date: string;
  locationCode: string;
  bagsOffered: number;
  bagsSold: number;
  /** What the customer pays per bag (taxes included), e.g. 5.99. */
  pricePerBag: number;
  note?: string;
  by: string;
  at: string;
  orderId: string | null;
  /** True when real TGTG orders exist for that day/location (then the log does not create a sale). */
  feedOrders: number;
  /** Bags handed over one by one that day (« Sac remis », their own sales): the log counts only the rest. */
  pickupBags?: number;
  /**
   * Read, never stored: the kitchen is on Takatak MEV, and how many of the bags sold that day have their own invoice
   * (a TGTG e-mail order or a « Sac remis » whose receipt Takatak MEV issued). null: not a Takatak MEV kitchen.
   */
  mev?: { invoicedBags: number; missingBags: number } | null;
}

/** One bag (or a few, for one customer) handed over at the counter, with its own Revenu Québec invoice. */
export interface BagPickup {
  id: string;
  locationCode: string;
  at: string;
  quantity: number;
  total: number;
  code?: string;
  mev: MevRecord | null;
  /** Already recorded: the TGTG e-mail order of that reservation, or the same code tapped twice. */
  existing?: 'email' | 'pickup';
}

export { PICKUP_PREFIX };
export const isPickupOrder = (o: Pick<StoredOrder, 'raw' | 'externalOrderId'>) => (o.raw as { source?: string } | undefined)?.source === 'tgtg_pickup' || o.externalOrderId.startsWith(PICKUP_PREFIX);
const bagsOf = (o: Pick<StoredOrder, 'lines'>) => o.lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0) || 1;
/** A bag has its invoice when Takatak MEV issued the receipt of its order (or would have, in a shadow test). */
const invoiced = (o: StoredOrder) => ['accepted', 'offline', 'shadow'].includes(o.timeline?.mev?.status ?? '');

const r2 = (n: number) => Math.round(n * 100) / 100;
/** "2026-10-24T21:30:00Z" → "1730" (the kitchen's wall clock, for a ticket number staff can read). */
const localHhmm = (iso: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: foodhubTimeZone() }).format(new Date(iso)).replace(/\D/g, '');

function noonLocal(date: string) {
  return new Date(startOfLocalDayMs(Date.parse(`${date}T12:00:00Z`), foodhubTimeZone()) + 18 * 3600_000).toISOString();
}

export async function listBagDays(from?: string, to?: string): Promise<BagDay[]> {
  return (await getRepo().listDocs<BagDay>(BAGS, {})).map((d) => d.data)
    .filter((d) => (!from || d.date >= from) && (!to || d.date <= to))
    .sort((a, b) => b.date.localeCompare(a.date) || a.locationCode.localeCompare(b.locationCode));
}

export async function saveBagDay(input: { date: string; locationCode: string; bagsOffered: number; bagsSold: number; pricePerBag: number; note?: string }, actor: Actor): Promise<BagDay> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Date must be YYYY-MM-DD.');
  const offered = Math.max(0, Math.round(Number(input.bagsOffered) || 0));
  const sold = Math.max(0, Math.round(Number(input.bagsSold) || 0));
  const price = r2(Number(input.pricePerBag) || 0);
  if (sold > offered && offered > 0) throw new Error('Bags sold cannot be more than bags offered.');
  if (price <= 0 && sold > 0) throw new Error('Enter the price customers pay per bag.');
  const repo = getRepo();
  const id = `${input.locationCode}|${input.date}`;
  const prev = await repo.getDoc<BagDay>(BAGS, id);
  const { orderId, feed, pickupBags } = await settleDayLog({ date: input.date, locationCode: input.locationCode, offered, sold, price, note: input.note }, prev?.data.orderId ?? null);
  const day: BagDay = { id, date: input.date, locationCode: input.locationCode, bagsOffered: offered, bagsSold: sold, pricePerBag: price, note: input.note?.slice(0, 200), by: actor.name, at: nowIso(), orderId, feedOrders: feed, ...(pickupBags ? { pickupBags } : {}) };
  await repo.putDocs(BAGS, [{ id, at: noonLocal(input.date), key: input.locationCode, data: day }]);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'tgtg_bag_log', status: 'success', channel: 'tgtg', locationCode: input.locationCode,
    summary: `Too Good To Go ${input.date} at ${input.locationCode}: ${sold}/${offered} bags sold × ${price.toFixed(2)} $${feed ? ' (orders already received by webhook — log not counted as sales)' : pickupBags ? ` (${pickupBags} handed over one by one with their own sale — the log counts the other ${Math.max(0, sold - pickupBags)})` : ''}` });
  const [withMev] = await withInvoiceCounts([day]);
  if (withMev.mev?.missingBags) {
    await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'tgtg_bags_without_invoice', status: 'failed', channel: 'tgtg', locationCode: input.locationCode,
      summary: `Too Good To Go ${input.date} at ${input.locationCode}: ${withMev.mev.missingBags} of ${sold} bag(s) sold have no invoice of their own. The daily count is not a sale and is not sent to Revenu Québec: record each bag at pickup (« Sac remis ») or connect the TGTG e-mails.` });
  }
  return withMev;
}

/**
 * The day's log order, for the reports only (Takatak MEV never receives it: mev/map.ts storedExclusion log_order).
 *   real per-order feed that day (webhook, e-mails) → no log sale (the feed is the day's sales, as before)
 *   bags handed over one by one (« Sac remis »)     → the log counts only the other bags (never twice)
 *   nothing left / nothing sold                      → a previous log order is cancelled
 */
async function settleDayLog(input: { date: string; locationCode: string; offered: number; sold: number; price: number; note?: string }, prevOrderId: string | null): Promise<{ orderId: string | null; feed: number; pickupBags: number }> {
  const repo = getRepo();
  const { date, locationCode, offered, sold, price } = input;
  const dayStart = startOfLocalDayMs(Date.parse(`${date}T12:00:00Z`));
  // The local day ends at the next local midnight (25 h on the fall-back day), not at dayStart + 24 h.
  const dayEnd = startOfLocalDayMs(dayStart + 36 * 3600_000);
  const dayOrders = (await repo.listOrders({ since: new Date(dayStart).toISOString(), until: new Date(dayEnd).toISOString(), limit: 2000, locationCodes: [locationCode] }))
    .filter((o) => o.channel === 'tgtg');
  const feed = dayOrders.filter((o) => !isLogOrder(o) && !isPickupOrder(o));
  const pickupBags = dayOrders.filter((o) => isPickupOrder(o) && o.status !== 'cancelled' && o.status !== 'failed').reduce((n, o) => n + bagsOf(o), 0);
  const logBags = feed.length ? 0 : Math.max(0, sold - pickupBags);
  const stores = await repo.listStores('tgtg');
  const store = stores.find((s) => s.locationCode === locationCode);
  const externalOrderId = `tgtg-log-${locationCode}-${date}`;
  let orderId = prevOrderId;
  const fields = {
    lines: [{ name: 'Surprise Bag', quantity: logBags, unitPrice: price, total: r2(logBags * price), modifiers: [] }],
    subtotal: r2(logBags * price), tax: 0, total: r2(logBags * price),
    notes: `Daily bag log: ${sold}/${offered} bags sold${pickupBags ? ` (${pickupBags} handed over one by one with their own sale)` : ''}${input.note ? ` — ${input.note}` : ''}`,
  };
  if (feed.length || logBags === 0) {
    // Real orders exist (or nothing left to count): the log must not create a sale → cancel a previous log order.
    if (orderId) await repo.updateOrder(orderId, { status: 'cancelled', ...fields, total: 0, subtotal: 0, notes: feed.length ? 'Replaced by Too Good To Go orders received by webhook' : pickupBags ? 'Every bag sold was handed over with its own sale' : 'No bags sold' });
  } else if (orderId) {
    await repo.updateOrder(orderId, { ...fields, status: 'completed' });
  } else {
    const { order } = await repo.insertOrderIfNew({
      channel: 'tgtg', marketplace: 'tgtg', externalOrderId, displayId: `BAGS-${date.slice(5)}`, channelStoreId: store?.channelStoreId ?? `log-${locationCode}`,
      brandName: store?.brandName ?? 'Too Good To Go', customerName: undefined, fulfillment: 'pickup', placedAt: noonLocal(date), currency: 'CAD',
      deliveryFee: 0, tip: 0, discount: 0, raw: { source: 'daily_log' }, ...fields, locationCode, createdAt: noonLocal(date),
    });
    orderId = order.id;
    await repo.updateOrder(order.id, { status: 'completed', timeline: { completedAt: noonLocal(date) } });
  }
  // Takatak MEV never receives the day's count (mev/map.ts storedExclusion: log_order): it is Food Hub's report only.
  // The order is still looked at, so it shows « not a sale » rather than nothing.
  if (orderId) await mevOnOrderChange({ id: orderId });
  return { orderId, feed: feed.length, pickupBags };
}

/** A « Sac remis » after the day was logged: the log stops counting that bag (it is its own sale now). */
async function resettleLoggedDay(locationCode: string, atIso: string): Promise<void> {
  const repo = getRepo();
  const id = `${locationCode}|${localDate(Date.parse(atIso))}`;
  const prev = (await repo.getDoc<BagDay>(BAGS, id))?.data;
  if (!prev) return;
  const r = await settleDayLog({ date: prev.date, locationCode, offered: prev.bagsOffered, sold: prev.bagsSold, price: prev.pricePerBag, note: prev.note }, prev.orderId);
  const next: BagDay = { ...prev, orderId: r.orderId, feedOrders: r.feed };
  if (r.pickupBags) next.pickupBags = r.pickupBags; else delete next.pickupBags;
  await repo.putDocs(BAGS, [{ id, at: noonLocal(prev.date), key: locationCode, data: next }]);
}

/** Too Good To Go e-mails are read for this kitchen: a reservation may already be an order (then its code is needed). */
async function emailsCover(locationCode: string): Promise<boolean> {
  if (!(await tgtgEmailActive().catch(() => false))) return false;
  const settings = await getTgtgEmailSettings().catch(() => null);
  return Boolean(settings?.mappings.some((m) => m.locationCode === locationCode));
}

/** Per kitchen: the reservation code is required at « Sac remis » (TGTG e-mails are read for it). */
export async function pickupCodeRequired(locationCodes: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const c of locationCodes) out[c] = await emailsCover(c);
  return out;
}

/**
 * For kitchens on Takatak MEV: how many bags of each day have their own invoice. Nothing is read for the other kitchens
 * (FOODHUB_MEV=off answers without any read).
 */
export async function withInvoiceCounts(days: BagDay[]): Promise<BagDay[]> {
  const on = new Set<string>();
  for (const c of new Set(days.map((d) => d.locationCode))) if ((await mevGate(c).catch(() => ({ active: false }))).active) on.add(c);
  if (!on.size) return days.map((d) => ({ ...d, mev: null }));
  const dates = days.filter((d) => on.has(d.locationCode)).map((d) => d.date).sort();
  const since = startOfLocalDayMs(Date.parse(`${dates[0]}T12:00:00Z`));
  const until = startOfLocalDayMs(startOfLocalDayMs(Date.parse(`${dates[dates.length - 1]}T12:00:00Z`)) + 36 * 3600_000);
  const orders = (await getRepo().listOrders({ since: new Date(since).toISOString(), until: new Date(until).toISOString(), limit: 5000, locationCodes: [...on] }))
    .filter((o) => o.channel === 'tgtg' && !isLogOrder(o) && o.status !== 'cancelled' && o.status !== 'failed' && invoiced(o));
  const count = new Map<string, number>();
  for (const o of orders) {
    const k = `${o.locationCode}|${localDate(Date.parse(o.createdAt))}`;
    count.set(k, (count.get(k) ?? 0) + bagsOf(o));
  }
  return days.map((d) => {
    if (!on.has(d.locationCode)) return { ...d, mev: null };
    const invoicedBags = count.get(`${d.locationCode}|${d.date}`) ?? 0;
    return { ...d, mev: { invoicedBags, missingBags: Math.max(0, d.bagsSold - invoicedBags) } };
  });
}

function pickupOf(o: StoredOrder, existing?: BagPickup['existing']): BagPickup {
  const code = (o.raw as { tgtg?: { code?: string } } | undefined)?.tgtg?.code;
  return { id: o.id, locationCode: o.locationCode ?? '', at: o.timeline?.completedAt ?? o.createdAt, quantity: bagsOf(o), total: o.total, ...(code ? { code } : {}), mev: o.timeline?.mev ?? null, ...(existing ? { existing } : {}) };
}

/**
 * « Sac remis » — a Too Good To Go customer takes their bag at the counter: one sale for that customer (LVT, the price
 * paid in the app, taxes included), recorded by Takatak MEV and printed now, so the invoice goes in their hand.
 * Only for a kitchen on Takatak MEV. With the reservation code: a reservation already read from a TGTG e-mail is that
 * order (never a second sale), and the same code tapped twice is the same sale.
 */
export async function recordBagPickup(input: { locationCode: string; pricePerBag: number; quantity?: number; code?: string; firstName?: string }, actor: Actor, opts: { waitMs?: number } = {}): Promise<BagPickup> {
  const price = r2(Number(input.pricePerBag) || 0);
  const qty = Math.round(Number(input.quantity ?? 1));
  if (!Number.isFinite(qty) || qty < 1 || qty > 20) throw new Error('Bags handed over: 1 to 20.');
  if (price <= 0) throw new Error('Enter the price customers pay per bag.');
  const gate = await mevGate(input.locationCode);
  if (!gate.active) throw new Error('This kitchen does not issue its invoices through Takatak MEV: log the day instead.');
  const code = normalizeTgtgCode(input.code);
  const repo = getRepo();
  if (code) {
    const mail = await repo.findOrder('tgtg', tgtgMailOrderId(code));
    if (mail) return pickupOf(mail, 'email');
  } else if (await emailsCover(input.locationCode)) {
    // A reservation read from its e-mail is already an order with its own invoice: without the code, a tap here could
    // make a second sale for the same bag.
    throw new Error('Too Good To Go e-mails are read for this kitchen: type the reservation code (TGTG app), so a reservation already received is never a second sale.');
  }
  const store = (await repo.listStores('tgtg')).find((s) => s.locationCode === input.locationCode);
  const at = nowIso();
  const firstName = String(input.firstName ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || undefined;
  const total = r2(qty * price);
  const { order, isNew } = await repo.insertOrderIfNew({
    channel: 'tgtg', marketplace: 'tgtg', externalOrderId: code ? tgtgPickupOrderId(code) : `${PICKUP_PREFIX}${input.locationCode}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    displayId: code ?? `SAC-${localHhmm(at)}`, channelStoreId: store?.channelStoreId ?? `pickup-${input.locationCode}`,
    brandName: store?.brandName ?? 'Too Good To Go', customerName: firstName, fulfillment: 'pickup', placedAt: at, currency: 'CAD',
    lines: [{ name: 'Surprise Bag', quantity: qty, unitPrice: price, total, modifiers: [] }],
    subtotal: total, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total,
    notes: `Too Good To Go — remis au comptoir${code ? ` (${code})` : ''}`,
    raw: { source: 'tgtg_pickup', tgtg: { ...(code ? { code } : {}), quantity: qty, pricePaid: total } }, locationCode: input.locationCode,
  });
  if (!isNew) return pickupOf(order, 'pickup');
  await repo.patchOrder(order.id, { acceptedAt: at, acceptedBy: actor.username, readyAt: at, completedAt: at }, { status: 'completed' });
  await mevOnOrderChange({ id: order.id });
  // The day was already logged: its log stops counting this bag (reports never count it twice).
  await resettleLoggedDay(input.locationCode, at);
  // The invoice is handed over now: wait (briefly) for Takatak MEV's answer, so the ticket that opens next prints it.
  await Promise.race([settleMevKicks(), new Promise((r) => setTimeout(r, opts.waitMs ?? 8000))]);
  const fresh = (await repo.getOrder(order.id)) ?? order;
  await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'tgtg_bag_pickup', status: 'success', channel: 'tgtg', locationCode: input.locationCode,
    summary: `Too Good To Go bag handed over at ${input.locationCode}: ${qty} × ${price.toFixed(2)} $ (invoice ${fresh.timeline?.mev?.status ?? 'pending'})` });
  return pickupOf(fresh);
}

/** The « Sac remis » since a moment, newest first. */
export async function listBagPickups(sinceIso: string, locationCodes?: string[]): Promise<BagPickup[]> {
  return (await getRepo().listOrders({ since: sinceIso, limit: 2000, ...(locationCodes?.length ? { locationCodes } : {}) }))
    .filter((o) => o.channel === 'tgtg' && isPickupOrder(o)).map((o) => pickupOf(o));
}

export function isLogOrder(o: Pick<StoredOrder, 'raw' | 'externalOrderId'>) {
  return (o.raw as { source?: string } | undefined)?.source === 'daily_log' || o.externalOrderId.startsWith('tgtg-log-');
}
