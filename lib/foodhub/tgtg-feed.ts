// Too Good To Go notifications that reach Food Hub through a feed (the token-protected /webhooks/tgtg address, the Order
// Relay, a partner or an automation that forwards what the TGTG Store app / e-mail tells the shop).
// TGTG publishes no notification format, so this reader is deliberately tolerant: it recognises the meaning of an event
// from its words and its fields, never from one fixed layout, and keeps anything it cannot place (never a guess).
//
//   reserved   a customer reserved a bag     → an order (parseGenericOrder / Deliverect), handled by the callers
//   cancelled  the customer or the shop cancelled the reservation → order cancelled
//   collected  the customer showed the reservation and took the bag → order completed ("pickup confirmed")
//   no_show    the pickup window ended and nobody came → order completed, flagged no-show (the bag is still paid)
//   bag_count  a day summary: bags offered / sold / collected for a store → the bag log
//
// End of day: feedBagCounts() counts the day's feed orders per location; syncFeedBagDay() writes them into the bag log
// (Money → TGTG) so sales, analytics and payout reconciliation have the day without anyone typing it.
import { SYSTEM_ACTOR } from './activity';
import { getRepo } from './repo';
import { applyExternalStatus } from './pipeline';
import { saveBagDay, isLogOrder, listBagDays, type BagDay } from './tgtg';
import { foodhubTimeZone, startOfLocalDayMs } from './time';
import { localDate } from './hours';
import { round2 } from './config';

export type TgtgEventKind = 'reserved' | 'cancelled' | 'collected' | 'no_show' | 'bag_count' | 'unknown';

export interface TgtgEvent {
  kind: TgtgEventKind;
  /** The order / reservation id the event is about (matches the id the order arrived with). */
  orderId?: string;
  /** Platform words, as received. */
  word?: string;
  reason?: string;
  by?: 'customer' | 'store' | 'platform';
  /** bag_count */
  storeId?: string;
  date?: string;
  offered?: number;
  sold?: number;
  collected?: number;
  price?: number;
}

const isObj = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const pick = (o: Record<string, any>, keys: string[]) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };
const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : undefined; };

const WORD_KEYS = ['event', 'event_type', 'eventType', 'type', 'kind', 'status', 'state', 'new_state', 'newState', 'action', 'notification_type', 'notificationType', 'name'];
const ID_KEYS = ['order_id', 'orderId', 'reservation_id', 'reservationId', 'order_reference', 'orderReference', 'external_order_id', 'reference', 'id'];

/** The meaning of an event word (English or French). */
export function tgtgEventKind(word: string): TgtgEventKind {
  const w = word.toLowerCase();
  if (/no.?show|not.?(collected|picked)|uncollected|missed|expired|non.?r[ée]cup|absent/.test(w)) return 'no_show';
  if (/cancel|annul|refund|rembours|void/.test(w)) return 'cancelled';
  if (/collect|pick.?up|picked|handed|hand.?over|redeem|swip|r[ée]cup|retir|fulfil|complet|deliver/.test(w)) return 'collected';
  if (/bag.?count|summary|daily|day.?end|end.?of.?day|inventory|stock|r[ée]sum|bilan/.test(w)) return 'bag_count';
  if (/reserv|creat|new|placed|purchas|order|paid|nouvelle/.test(w)) return 'reserved';
  return 'unknown';
}

/** One TGTG notification (any layout) → what happened. */
export function parseTgtgEvent(body: unknown): TgtgEvent {
  const root = isObj(body) ? body : {};
  const o: Record<string, any> = isObj(root.order) ? { ...root, ...root.order } : isObj(root.data) ? { ...root, ...root.data } : isObj(root.reservation) ? { ...root, ...root.reservation } : root;
  const wordRaw = pick(o, WORD_KEYS);
  const word = wordRaw !== undefined ? String(wordRaw) : undefined;
  const orderId = pick(o, ID_KEYS);

  // A day summary carries counts, a date, no order id.
  const offered = num(pick(o, ['bags_offered', 'bagsOffered', 'bags_available', 'bagsAvailable', 'total_bags', 'totalBags', 'offered', 'quantity_offered']));
  const sold = num(pick(o, ['bags_sold', 'bagsSold', 'bags_reserved', 'bagsReserved', 'reserved', 'sold', 'quantity_sold']));
  const collected = num(pick(o, ['bags_collected', 'bagsCollected', 'collected', 'picked_up', 'pickedUp']));
  if ((offered !== undefined || sold !== undefined || collected !== undefined) && orderId === undefined) {
    const date = String(pick(o, ['date', 'day', 'business_date', 'businessDate', 'pickup_date']) ?? '').slice(0, 10);
    return { kind: 'bag_count', word, storeId: pick(o, ['store_id', 'storeId', 'store', 'shop_id', 'restaurantId']) !== undefined ? String(pick(o, ['store_id', 'storeId', 'store', 'shop_id', 'restaurantId'])) : undefined,
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined, offered, sold, collected, price: num(pick(o, ['price', 'price_per_bag', 'pricePerBag', 'bag_price'])) };
  }
  const kind = word ? tgtgEventKind(word) : 'unknown';
  const byWord = String(pick(o, ['cancelled_by', 'cancelledBy', 'canceled_by', 'by', 'source']) ?? word ?? '').toLowerCase();
  const by = /store|shop|merchant|restaurant|magasin/.test(byWord) ? 'store' : /customer|client|user|consumer/.test(byWord) ? 'customer' : /tgtg|platform|system/.test(byWord) ? 'platform' : undefined;
  const reason = pick(o, ['reason', 'cancel_reason', 'cancelReason', 'message', 'note']);
  return { kind, word, orderId: orderId !== undefined ? String(orderId) : undefined, reason: reason !== undefined ? String(reason).slice(0, 300) : undefined, by };
}

/**
 * Applies a status-type event to the order it is about. Collected = pickup confirmed (completed); no-show = completed and
 * flagged (the customer paid, the shop keeps the sale); cancelled = cancelled. An event for an order Food Hub does not
 * have yet is held for when it arrives (applyExternalStatus keeps it).
 */
export async function applyTgtgEvent(e: TgtgEvent): Promise<{ applied: boolean; message: string }> {
  if (!e.orderId) return { applied: false, message: 'The event names no order.' };
  const base = { source: 'tgtg_feed', partnerWord: e.word };
  // A closed order is never reopened by a late pickup / no-show notice.
  const existing = await getRepo().findOrder('tgtg', e.orderId);
  if (existing && e.kind !== 'cancelled' && ['cancelled', 'failed'].includes(existing.status)) return { applied: false, message: `The order is already ${existing.status}: not reopened.` };
  if (e.kind === 'cancelled') {
    const order = await applyExternalStatus('tgtg', e.orderId, 'cancelled', { ...base, reason: e.reason ?? 'Cancelled on Too Good To Go', event: e.by === 'customer' ? 'customer cancelled' : e.by === 'store' ? 'store cancelled' : 'cancelled' });
    return { applied: Boolean(order), message: order ? 'Order cancelled.' : 'Order not received yet: the cancellation is held for it.' };
  }
  if (e.kind === 'collected') {
    const order = await applyExternalStatus('tgtg', e.orderId, 'completed', { ...base, reason: 'Pickup confirmed (the customer collected the bag)', event: 'collected' });
    return { applied: Boolean(order), message: order ? 'Pickup confirmed.' : 'Order not received yet: the pickup is held for it.' };
  }
  if (e.kind === 'no_show') {
    const order = await applyExternalStatus('tgtg', e.orderId, 'completed', { ...base, reason: 'No-show: the bag was not collected (still paid)', event: 'no_show' });
    if (order) await getRepo().addEvent(order.id, 'tgtg_no_show', { message: 'The pickup window ended without a pickup; the reservation stays paid.' });
    return { applied: Boolean(order), message: order ? 'Marked as a no-show.' : 'Order not received yet: the no-show is held for it.' };
  }
  return { applied: false, message: `Nothing to apply for "${e.kind}".` };
}

// --- end of day ---------------------------------------------------------------------------------------------------

export interface FeedBagCounts { date: string; locationCode: string; reserved: number; collected: number; noShow: number; cancelled: number; revenue: number; pricePerBag: number }

/** The day's Too Good To Go feed orders at one location, counted. */
export async function feedBagCounts(date: string, locationCode: string): Promise<FeedBagCounts> {
  const repo = getRepo();
  const dayStart = startOfLocalDayMs(Date.parse(`${date}T12:00:00Z`));
  const dayEnd = startOfLocalDayMs(dayStart + 36 * 3600_000);
  const orders = (await repo.listOrders({ since: new Date(dayStart).toISOString(), until: new Date(dayEnd).toISOString(), limit: 2000, locationCodes: [locationCode] }))
    .filter((o) => o.channel === 'tgtg' && !isLogOrder(o));
  let collected = 0; let noShow = 0; let cancelled = 0; let revenue = 0; let bags = 0;
  for (const o of orders) {
    if (o.status === 'cancelled' || o.status === 'failed') { cancelled++; continue; }
    const qty = o.lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0) || 1;
    if (o.status === 'completed') {
      const events = await repo.listEvents(o.id).catch(() => []);
      if (events.some((e) => e.type === 'tgtg_no_show')) noShow += qty; else collected += qty;
      revenue += o.total; bags += qty;
    }
  }
  const reserved = orders.filter((o) => o.status !== 'cancelled' && o.status !== 'failed').reduce((s, o) => s + (o.lines.reduce((x, l) => x + (Number(l.quantity) || 0), 0) || 1), 0);
  return { date, locationCode, reserved, collected, noShow, cancelled, revenue: round2(revenue), pricePerBag: bags ? round2(revenue / bags) : 0 };
}

/**
 * Writes the day's feed counts into the bag log: bags offered = the larger of what the shop logged / the feed announced and
 * what was reserved; bags sold = bags collected plus no-shows (they are paid). The log never creates a sale while feed
 * orders exist (tgtg.ts), so nothing is counted twice.
 */
export async function syncFeedBagDay(date: string, locationCode: string, announced?: { offered?: number; price?: number }): Promise<BagDay | null> {
  const c = await feedBagCounts(date, locationCode);
  if (!c.reserved && !announced?.offered) return null;
  const prev = (await listBagDays(date, date)).find((d) => d.locationCode === locationCode);
  const sold = c.collected + c.noShow;
  const offered = Math.max(announced?.offered ?? 0, prev?.bagsOffered ?? 0, c.reserved, sold);
  const price = c.pricePerBag || announced?.price || prev?.pricePerBag || 0;
  if (sold > 0 && price <= 0) return null;
  return saveBagDay({ date, locationCode, bagsOffered: offered, bagsSold: sold, pricePerBag: price,
    note: `From the TGTG feed: ${c.reserved} reserved, ${c.collected} collected, ${c.noShow} no-show, ${c.cancelled} cancelled` }, SYSTEM_ACTOR);
}

/** A feed's own day summary (bag_count) for a store: written to the bag log when the store is mapped. */
export async function applyBagCountEvent(e: TgtgEvent): Promise<{ applied: boolean; message: string }> {
  if (e.kind !== 'bag_count') return { applied: false, message: 'Not a bag count.' };
  const store = e.storeId ? await getRepo().findStore('tgtg', e.storeId) : null;
  if (!store) return { applied: false, message: `Store ${e.storeId ?? '?'} is not mapped: the bag count is kept, not applied.` };
  const date = e.date ?? localDate(Date.now());
  const day = await syncFeedBagDay(date, store.locationCode, { offered: e.offered, price: e.price });
  if (day) return { applied: true, message: `Bag log for ${date} at ${store.locationCode}: ${day.bagsSold}/${day.bagsOffered} bags.` };
  // No feed orders to count: the announced numbers stand in (collected if given, else sold).
  const sold = e.collected ?? e.sold ?? 0;
  const offered = Math.max(e.offered ?? 0, sold);
  const prev = (await listBagDays(date, date)).find((d) => d.locationCode === store.locationCode);
  const price = e.price ?? prev?.pricePerBag ?? 0;
  if (offered <= 0 || (sold > 0 && price <= 0)) return { applied: false, message: 'The bag count has no usable numbers (or no price per bag yet).' };
  const saved = await saveBagDay({ date, locationCode: store.locationCode, bagsOffered: offered, bagsSold: sold, pricePerBag: price, note: 'From the TGTG feed (day summary)' }, SYSTEM_ACTOR);
  return { applied: true, message: `Bag log for ${date} at ${store.locationCode}: ${saved.bagsSold}/${saved.bagsOffered} bags.` };
}

/** Every location with a Too Good To Go store: yesterday and today are counted (the cron runs after closing). */
export async function syncAllFeedBagDays(now = Date.now()): Promise<Array<{ date: string; locationCode: string; synced: boolean; sold?: number; offered?: number }>> {
  const stores = await getRepo().listStores('tgtg');
  const codes = [...new Set(stores.map((s) => s.locationCode).filter(Boolean))];
  const tz = foodhubTimeZone();
  const dates = [localDate(now - 24 * 3600_000, tz), localDate(now, tz)];
  const out: Array<{ date: string; locationCode: string; synced: boolean; sold?: number; offered?: number }> = [];
  for (const locationCode of codes) for (const date of dates) {
    const day = await syncFeedBagDay(date, locationCode).catch(() => null);
    out.push({ date, locationCode, synced: Boolean(day), sold: day?.bagsSold, offered: day?.bagsOffered });
  }
  return out;
}
