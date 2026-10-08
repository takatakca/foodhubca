// Website orders through Clover (Clover Online Ordering) → the Food Hub kitchen screen. Clover keeps control.
//
// The customer orders on the restaurant's Clover Online Ordering page (the "Commander en ligne" button of its website,
// the Clover app, a QR code). Clover takes the payment, prints the ticket on its remote-firing printer and fires it to
// its KDS by itself: Clover always acts first. Food Hub then mirrors the order on its kitchen screen as
// "accepted in Clover" and follows what Clover says afterwards (Clover is the source of truth):
//   - lines marked printed in Clover              → "printed by Clover" on the card;
//   - refunded, credited, voided or deleted there → cancelled in Food Hub too (even after a local "ready" / "done");
//   - paid in Clover                              → paid.
// Food Hub never sends these orders to Clover again, never prints them (no second ticket), never accepts, rejects,
// cancels or refunds them: those are done in Clover. The kitchen screen keeps only its own taps ("Seen", "Ready",
// "Done"), which change nothing in Clover — Clover has no public "ready" state to write to.
//
// How an order is recognised (Clover's REST API has no documented "source" field for online orders):
//   1. Food Hub did not create it — known Clover ids, "<Platform> #…" and "🌐 W-1043 · …" titles;
//   2. no delivery platform's name in its order type, tender, title or note (those are platform orders);
//   3. its order type is one of the merchant's online-ordering types: a label with "online" / "en ligne" / "web"
//      ("Online Order Pick Up"…), or the ids / labels pinned in FOODHUB_CLOVER_WEBSITE_ORDER_TYPES.
// Sources: the Clover webhook (O:<id> CREATE / UPDATE / DELETE — instant, needs the "Orders" event subscription) and a
// poller (every FOODHUB_CLOVER_WEBSITE_POLL_S, default 30 s, while a screen is open or the cron runs, and at each sync).
// Both write the same document (id derived from the Clover order id), so an order is never shown twice.
import { logActivity, type Actor } from '../activity';
import { getCatalog } from '../catalog';
import { fromCents, nowIso, round2 } from '../config';
import { prepFor } from '../prep';
import { getRepo } from '../repo';
import { addDirectEvent, getDirectOrder, listDirectOrders, nextOrderNumber, saveDirectOrder } from '../delivery/store';
import type { DirectEvent, DirectLine, DirectOrder, PaymentState } from '../delivery/types';
import { allCloverMerchants, cloverBaseUrl, cloverToken } from './clover';
import { cloverFetch } from './clover-http';
import { normName } from './clover-order';
import { detectPlatform, platformFromLabel } from './clover-platform-orders';

const SINCE_KEY = (mid: string) => `clover_website_orders_since:${mid}`;
const TICK_KEY = 'clover_website_orders_tick';
/** A few seconds, so an order Food Hub itself just created has its Clover id saved first (its title excludes it anyway). */
const MIN_AGE_MS = 10_000;
const FIRST_LOOKBACK_MS = 6 * 3600_000;
/** Each run reads again the last 2 minutes (Clover's clock and ours may differ): an order already shown is only updated. */
const OVERLAP_MS = 2 * 60_000;
/** An order Food Hub sees for the first time when it is already this old was made long ago: history only, not the kitchen. */
const FRESH_MS = 90 * 60_000;
/** Open website orders are re-read from Clover for this long after they were placed. */
const OPEN_WINDOW_MS = 12 * 3600_000;
const MAX_REFRESH = 25;
const MAX_PAGES = 5;
const PAGE = 100;
const EXPAND = 'lineItems,lineItems.modifications,payments,orderType,customers';
const OPEN: DirectOrder['status'][] = ['new', 'in_kitchen', 'ready'];

const on = (v: unknown) => !/^(off|false|0|no)$/i.test(String(v ?? '').trim());

/** On unless FOODHUB_CLOVER_WEBSITE_ORDERS=off. */
export function cloverWebsiteOrdersEnabled(): boolean {
  return on(process.env.FOODHUB_CLOVER_WEBSITE_ORDERS);
}

/** Website orders still open this long after they were placed are closed in Food Hub (Clover keeps its own copy). */
export function closeAfterMs(): number {
  const n = Number(process.env.FOODHUB_CLOVER_WEBSITE_CLOSE_MIN ?? 240);
  return (Number.isFinite(n) && n >= 30 ? n : 240) * 60_000;
}

function pollMs(): number {
  const n = Number(process.env.FOODHUB_CLOVER_WEBSITE_POLL_S ?? 30);
  return (Number.isFinite(n) && n >= 10 ? n : 30) * 1000;
}

/** A setting given either as one value for every merchant, or as JSON { "<merchant id>": value, "*": default }. */
function perMerchant(envKey: string, mid: string): string | undefined {
  const raw = String(process.env[envKey] ?? '').trim();
  if (!raw) return undefined;
  if (!raw.startsWith('{')) return raw;
  try {
    const map = JSON.parse(raw) as Record<string, unknown>;
    const v = map[mid] ?? map['*'];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- recognising a website order

const ONLINE_TYPE = /online|en\s*ligne|\bweb\b|site\s*web|website/i;

function pinnedTypes(): string[] {
  return String(process.env.FOODHUB_CLOVER_WEBSITE_ORDER_TYPES || '').split(/[,;\n]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function orderTypeOf(co: any, orderTypes: Map<string, string>): { id: string; label: string } {
  const id = String(co?.orderType?.id ?? '');
  return { id, label: String(co?.orderType?.label ?? orderTypes.get(id) ?? '') };
}

/** True when the order type is one of the merchant's online-ordering types (never a platform's). False while switched off. */
export function isCloverOnlineOrderType(co: any, orderTypes: Map<string, string>): boolean {
  if (!cloverWebsiteOrdersEnabled()) return false;
  const { id, label } = orderTypeOf(co, orderTypes);
  if ((!id && !label) || platformFromLabel(label)) return false;
  const pinned = pinnedTypes();
  if (pinned.length) return pinned.includes(id.toLowerCase()) || pinned.includes(label.trim().toLowerCase());
  return ONLINE_TYPE.test(label);
}

// Titles Food Hub gives the orders it creates in Clover: "DoorDash #9F3K2", "CANCELLED — Uber Eats #…" (platform orders,
// test orders) and "🌐 W-1043 · Po Poulet" (our own phone / website / typed-in orders).
const OWN_PLATFORM_TITLE = /^(cancelled\s*[—-]\s*)?(uber\s*eats|door\s*dash|skip\s*the\s*dishes|too\s*good\s*to\s*go)\s*#/i;
const OWN_DIRECT_TITLE = /^\S+\s+(T|IA|C|W|M|WEB)-\d+\s·/;

export function isFoodHubTitle(title: unknown): boolean {
  const s = String(title ?? '').trim();
  return OWN_PLATFORM_TITLE.test(s) || OWN_DIRECT_TITLE.test(s);
}

export type CloverOrderKind = 'website' | 'platform' | 'foodhub' | 'other';

/** Which kind of Clover order this is. `known` = Clover ids of the orders Food Hub created itself. */
export function classifyCloverOrder(co: any, ctx: { orderTypes: Map<string, string>; tenders: Map<string, string>; known?: Set<string> }): CloverOrderKind {
  const id = String(co?.id ?? '');
  if (id && ctx.known?.has(id)) return 'foodhub';
  if (isFoodHubTitle(co?.title)) return 'foodhub';
  if (detectPlatform(co, ctx.orderTypes, ctx.tenders)) return 'platform';
  if (isCloverOnlineOrderType(co, ctx.orderTypes)) return 'website';
  return 'other';
}

// ---------------------------------------------------------------- what Clover says about the order

export interface CloverOrderState {
  /** Deleted in Clover (or not found any more). */
  gone: boolean;
  /** Fully refunded / credited, or every payment voided. */
  refunded: boolean;
  partlyRefunded: boolean;
  paid: boolean;
  /** Clover marked the lines printed (its order printer / KDS got the ticket). */
  printed: boolean;
  reason?: string;
}

/** Clover order JSON (null = deleted / not found) → the facts Food Hub mirrors. Never guesses a "ready" state: Clover has none. */
export function readCloverOrderState(co: any | null): CloverOrderState {
  if (!co || co.deleted === true || Number(co.deletedTimestamp) > 0) {
    return { gone: true, refunded: false, partlyRefunded: false, paid: false, printed: false, reason: 'Removed in Clover' };
  }
  const ps = String(co.paymentState ?? '').toUpperCase();
  const total = Number(co.total) || 0;
  const payments: any[] = co?.payments?.elements ?? [];
  const live = payments.filter((p) => !/VOID|FAIL/i.test(String(p?.result ?? '')));
  const paidCents = live.reduce((s, p) => s + (Number(p?.amount) || 0), 0);
  const refundCents = (co?.refunds?.elements ?? []).reduce((s: number, r: any) => s + (Number(r?.amount) || 0), 0);
  const voided = payments.length > 0 && live.length === 0;
  const refunded = ps === 'REFUNDED' || ps === 'CREDITED' || (total > 0 && refundCents >= total) || voided;
  const partlyRefunded = !refunded && (ps === 'PARTIALLY_REFUNDED' || refundCents > 0);
  const paid = !refunded && (ps === 'PAID' || (total > 0 && paidCents >= total));
  const printed = (co?.lineItems?.elements ?? []).some((li: any) => li?.printed === true);
  return { gone: false, refunded, partlyRefunded, paid, printed, ...(refunded ? { reason: voided ? 'Payment voided in Clover' : 'Refunded in Clover' } : {}) };
}

/** Clover line items → kitchen lines (refunded lines left out; one Clover line per unit unless sold by quantity). */
export function cloverLines(co: any): DirectLine[] {
  const items: any[] = co?.lineItems?.elements ?? [];
  return items.filter((li) => !li?.refunded).map((li) => {
    const modifiers = (li?.modifications?.elements ?? []).map((m: any) => ({ externalId: m?.modifier?.id ? String(m.modifier.id) : undefined, name: String(m?.name ?? 'Option'), quantity: 1, unitPrice: fromCents(Number(m?.amount) || 0) }));
    const quantity = li?.unitQty ? Math.max(1, Math.round(Number(li.unitQty) / 1000)) : 1;
    const unitPrice = fromCents(Number(li?.price) || 0);
    const mods = modifiers.reduce((s: number, m: { unitPrice: number }) => s + m.unitPrice, 0);
    return {
      externalId: li?.id ? String(li.id) : undefined,
      posItemRef: li?.item?.id ? String(li.item.id) : undefined,
      name: String(li?.name ?? 'Item'),
      quantity,
      unitPrice,
      total: round2((unitPrice + mods) * quantity),
      notes: li?.note ? String(li.note).slice(0, 200) : undefined,
      modifiers,
    } satisfies DirectLine;
  });
}

// ---------------------------------------------------------------- Clover reads

async function cloverGet(mid: string, token: string, path: string, qs: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  const q = new URLSearchParams(qs);
  const res = await cloverFetch(`${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(mid)}/${path}${q.toString() ? `?${q}` : ''}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function labelMaps(mid: string, token: string): Promise<{ orderTypes: Map<string, string>; tenders: Map<string, string> }> {
  const read = async (path: 'order_types' | 'tenders') => {
    const m = new Map<string, string>();
    const r = await cloverGet(mid, token, path, { limit: '200' }).catch(() => null);
    for (const e of Array.isArray(r?.json?.elements) ? r!.json.elements : []) if (e?.id) m.set(String(e.id), String(e.label ?? e.labelKey ?? ''));
    return m;
  };
  const [orderTypes, tenders] = await Promise.all([read('order_types'), read('tenders')]);
  return { orderTypes, tenders };
}

/** One Clover order: the object, null when Clover says it does not exist (deleted), undefined on any other answer. */
async function cloverOrder(mid: string, token: string, id: string): Promise<any | null | undefined> {
  const r = await cloverGet(mid, token, `orders/${encodeURIComponent(id)}`, { expand: `${EXPAND},refunds` }).catch(() => null);
  if (!r) return undefined;
  if (r.status === 404) return null;
  if (r.status === 400) {
    // Clover refused the nested expansion: read it again with the essentials only.
    const r2 = await cloverGet(mid, token, `orders/${encodeURIComponent(id)}`, { expand: 'lineItems,payments,orderType,refunds' }).catch(() => null);
    return r2 && r2.status >= 200 && r2.status < 300 ? r2.json : r2?.status === 404 ? null : undefined;
  }
  return r.status >= 200 && r.status < 300 ? r.json : undefined;
}

/** Clover ids of the orders Food Hub created itself (platform orders, our own phone / website orders). */
async function knownFoodHubCloverIds(sinceMs: number): Promise<Set<string>> {
  const since = new Date(sinceMs - 3 * 86400_000).toISOString();
  const [stored, direct] = await Promise.all([
    getRepo().listOrders({ since, limit: 5000 }).catch(() => []),
    listDirectOrders({ since, limit: 2000 }).catch(() => []),
  ]);
  return new Set([...stored.map((o) => o.posOrderId), ...direct.filter((o) => o.source !== 'clover_online').map((o) => o.posOrderId)].filter(Boolean) as string[]);
}

// ---------------------------------------------------------------- mirror in Food Hub

/** One Food Hub document per Clover order: the webhook and the poller always write the same one (never twice). */
export function websiteOrderDocId(cloverOrderId: string): string {
  return `dir_clv_${String(cloverOrderId).replace(/[^A-Za-z0-9]/g, '')}`;
}

/** The kitchen and the brand for a website order of this Clover merchant. */
async function placeFor(mid: string, co: any): Promise<{ locationCode: string; brandName: string; attention?: string } | null> {
  const repo = getRepo();
  const catalog = await getCatalog();
  const valid = new Set(catalog.locations.map((l) => l.code));
  const def = process.env.CLOVER_MERCHANT_ID;
  const stores = await repo.listStores();
  const locs = [...new Set(stores.filter((s) => (s.cloverMerchantId || def) === mid).map((s) => s.locationCode))].filter((c) => valid.has(c));
  const pinned = perMerchant('FOODHUB_CLOVER_WEBSITE_LOCATION', mid);
  let locationCode = pinned && valid.has(pinned) ? pinned : locs.length === 1 ? locs[0] : undefined;
  let attention: string | undefined;
  if (!locationCode) {
    locationCode = locs[0] ?? catalog.locations.find((l) => l.active)?.code;
    if (locationCode && locs.length !== 1) attention = 'Kitchen guessed: several kitchens use this Clover. Set FOODHUB_CLOVER_WEBSITE_LOCATION to the kitchen that makes website orders.';
  }
  if (!locationCode) return null;
  const brands = [...new Set(stores.filter((s) => s.locationCode === locationCode).map((s) => s.brandName))];
  const text = normName(`${co?.title ?? ''} ${co?.note ?? ''}`);
  const named = brands.filter((b) => normName(b) && text.includes(normName(b)));
  const brandName = perMerchant('FOODHUB_CLOVER_WEBSITE_BRAND', mid) ?? (named.length === 1 ? named[0] : brands.length === 1 ? brands[0] : 'Site web');
  return { locationCode, brandName, ...(attention ? { attention } : {}) };
}

function customerName(co: any): string | undefined {
  const c = co?.customers?.elements?.[0];
  if (!c) return undefined;
  const first = String(c.firstName ?? '').trim();
  const last = String(c.lastName ?? '').trim();
  return [first, last ? `${last[0].toUpperCase()}.` : ''].filter(Boolean).join(' ') || undefined;
}

const ev = (type: string, message: string, by = 'Clover'): DirectEvent => ({ at: nowIso(), type, message, by });

/** Applies what Clover says to the Food Hub copy. Clover always wins: a refund cancels even a locally "done" order. */
export async function applyCloverState(order: DirectOrder, s: CloverOrderState): Promise<{ order: DirectOrder; changed: boolean }> {
  const patch: Partial<DirectOrder> = {};
  const events: DirectEvent[] = [];
  if ((s.gone || s.refunded) && order.status !== 'cancelled') {
    patch.status = 'cancelled';
    patch.attention = undefined;
    events.push(ev('clover_cancelled', `${s.reason ?? 'Cancelled in Clover'} — cancelled in Food Hub too (Clover is the source of truth; refunds are done in Clover).`));
  }
  if (!s.gone && s.printed && !order.posPrintedAt) {
    patch.posPrintedAt = nowIso();
    events.push(ev('clover_printed', 'Printed by Clover (its order printer / KDS). Food Hub prints nothing for this order.'));
  }
  if (s.paid && order.payment !== 'paid') {
    patch.payment = 'paid';
    events.push(ev('clover_paid', 'Paid in Clover.'));
  }
  if (s.partlyRefunded && !order.events.some((e) => e.type === 'clover_partly_refunded')) events.push(ev('clover_partly_refunded', 'Partly refunded in Clover.'));
  if (!events.length) return { order, changed: false };
  // Re-read so a kitchen tap made meanwhile is kept.
  const cur = (await getDirectOrder(order.id)) ?? order;
  const next = await saveDirectOrder({ ...cur, ...patch, events: [...(cur.events ?? []), ...events].slice(-200) });
  if (patch.status === 'cancelled') {
    await logActivity({ actor: 'Clover', source: 'platform', kind: 'order', action: 'clover_website_cancel', status: 'info', brandName: next.brandName, locationCode: next.locationCode,
      summary: `Website order ${next.number} (Clover online): ${s.reason ?? 'cancelled in Clover'} — cancelled on the Food Hub kitchen screen too.` });
  }
  return { order: next, changed: true };
}

/** Creates the Food Hub copy of a Clover online order, or brings an existing copy up to date. */
export async function upsertCloverOnlineOrder(mid: string, co: any, opts: { now?: number } = {}): Promise<{ order: DirectOrder | null; created: boolean; changed: boolean }> {
  const cloverId = String(co?.id ?? '');
  if (!cloverId) return { order: null, created: false, changed: false };
  const id = websiteOrderDocId(cloverId);
  const state = readCloverOrderState(co);
  const existing = await getDirectOrder(id);
  if (existing) {
    const r = await applyCloverState(existing, state);
    return { order: r.order, created: false, changed: r.changed };
  }
  // Already refunded or deleted the first time Food Hub sees it: nothing to cook.
  if (state.gone || state.refunded) return { order: null, created: false, changed: false };
  const lines = cloverLines(co);
  if (!lines.length) return { order: null, created: false, changed: false };
  const place = await placeFor(mid, co);
  if (!place) return { order: null, created: false, changed: false };
  const now = opts.now ?? Date.now();
  const createdMs = Number(co?.createdTime) || now;
  const old = now - createdMs > Math.min(FRESH_MS, closeAfterMs());
  const prep = await prepFor(place.locationCode);
  const payments: any[] = co?.payments?.elements ?? [];
  const sum = (f: string) => fromCents(payments.filter((p) => !/VOID|FAIL/i.test(String(p?.result ?? ''))).reduce((s, p) => s + (Number(p?.[f]) || 0), 0));
  const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
  const typeLabel = String(co?.orderType?.label ?? '');
  const fulfillment: DirectOrder['fulfillment'] = /livraison|deliver/i.test(typeLabel) ? 'delivery' : 'pickup';
  const payment: PaymentState = state.paid ? 'paid' : fulfillment === 'pickup' ? 'pay_at_pickup' : 'unpaid';
  const at = nowIso();
  const events: DirectEvent[] = [ev('received', `Website / Clover Online — accepted in Clover${typeLabel ? ` (${typeLabel})` : ''}. Clover prints it and sends it to its KDS; Food Hub only shows it (nothing is sent to Clover).`)];
  if (state.printed) events.push(ev('clover_printed', 'Printed by Clover (its order printer / KDS). Food Hub prints nothing for this order.'));
  if (old) events.push(ev('auto_completed', 'Placed more than the kitchen window ago — kept as history only.', 'Food Hub'));
  const order: DirectOrder = {
    id,
    number: await nextOrderNumber('clover_online'),
    source: 'clover_online',
    sourceRef: cloverId,
    brandName: place.brandName,
    locationCode: place.locationCode,
    customer: { name: customerName(co) },
    fulfillment,
    lines,
    subtotal,
    tax: sum('taxAmount'),
    deliveryFee: 0,
    tip: sum('tipAmount'),
    total: co?.total != null ? fromCents(Number(co.total)) : subtotal,
    currency: String(co?.currency || process.env.FOODHUB_CURRENCY || 'CAD'),
    payment,
    status: old ? 'completed' : 'in_kitchen',
    notes: co?.note ? String(co.note).slice(0, 500) : undefined,
    containsAlcohol: false,
    placedAt: new Date(createdMs).toISOString(),
    readyAt: new Date(createdMs + prep.minutes * 60_000).toISOString(),
    posOrderId: cloverId,
    posMerchantId: mid,
    ...(state.printed ? { posPrintedAt: at } : {}),
    ...(place.attention ? { attention: place.attention } : {}),
    events,
    createdAt: at,
    updatedAt: at,
  };
  // The webhook and the poller may meet here: whoever wrote first wins, the other only updates.
  const raced = await getDirectOrder(id);
  if (raced) {
    const r = await applyCloverState(raced, state);
    return { order: r.order, created: false, changed: r.changed };
  }
  const saved = await saveDirectOrder(order);
  if (!old) {
    await logActivity({ actor: 'Clover', source: 'platform', kind: 'order', action: 'clover_website_order', status: 'info', brandName: saved.brandName, locationCode: saved.locationCode,
      summary: `Website order ${saved.number} (Clover online, ${saved.total.toFixed(2)} $) — accepted and printed by Clover, shown on the Food Hub kitchen screen.` });
  }
  return { order: saved, created: true, changed: true };
}

// ---------------------------------------------------------------- poller

export interface CloverWebsiteImport { merchantId: string; imported: number; updated: number; closed: number; error?: string }

/** New website orders since the last run, then the open ones re-read from Clover (Clover is the source of truth). */
export async function importCloverWebsiteOrders(mid: string, opts: { now?: number } = {}): Promise<CloverWebsiteImport> {
  const out: CloverWebsiteImport = { merchantId: mid, imported: 0, updated: 0, closed: 0 };
  if (!cloverWebsiteOrdersEnabled()) return out;
  const token = await cloverToken(mid);
  if (!token) return { ...out, error: `No Clover API token for merchant ${mid}` };
  const repo = getRepo();
  const now = opts.now ?? Date.now();
  const until = now - MIN_AGE_MS;
  const since = Math.max((await repo.getKv<number>(SINCE_KEY(mid))) ?? 0, now - FIRST_LOOKBACK_MS);
  try {
    let listed = false;
    if (since < until) {
      const maps = await labelMaps(mid, token);
      const known = await knownFoodHubCloverIds(since);
      for (let page = 0; page < MAX_PAGES; page++) {
        const qs = (expand: string) => ({ filter: `createdTime>=${since}`, expand, limit: String(PAGE), offset: String(page * PAGE) });
        let r = await cloverGet(mid, token, 'orders', qs(EXPAND));
        if (r.status === 400) r = await cloverGet(mid, token, 'orders', qs('lineItems,payments,orderType'));
        if (r.status < 200 || r.status >= 300) throw new Error(`Clover orders HTTP ${r.status}`);
        listed = true;
        const rows: any[] = Array.isArray(r.json?.elements) ? r.json.elements : [];
        for (const co of rows) {
          const created = Number(co?.createdTime) || 0;
          if (!co?.id || created > until) continue;
          if (classifyCloverOrder(co, { ...maps, known }) !== 'website') continue;
          const res = await upsertCloverOnlineOrder(mid, co, { now });
          if (res.created) out.imported++;
          else if (res.changed) out.updated++;
        }
        if (rows.length < PAGE) break;
      }
      await repo.setKv(SINCE_KEY(mid), until - OVERLAP_MS);
    }

    // Mirror: re-read the open ones. A 404 counts as "deleted in Clover" only when Clover answered the token this run.
    const open = (await listDirectOrders({ since: new Date(now - OPEN_WINDOW_MS).toISOString(), limit: 1000 }))
      .filter((o) => o.source === 'clover_online' && o.posMerchantId === mid && o.sourceRef && OPEN.includes(o.status));
    for (const o of open.slice(0, MAX_REFRESH)) {
      if (now - Date.parse(o.placedAt) > closeAfterMs()) {
        await addDirectEvent(o, 'auto_completed', `Closed automatically on the Food Hub screen after ${Math.round(closeAfterMs() / 60_000)} min (Clover keeps the order).`, 'Food Hub', { status: 'completed' });
        out.closed++;
        continue;
      }
      const co = await cloverOrder(mid, token, o.sourceRef!);
      if (co === undefined) continue;
      if (co === null && !listed) {
        // Make sure the token still works before calling the order deleted.
        const probe = await cloverGet(mid, token, 'order_types', { limit: '1' }).catch(() => null);
        if (!probe || probe.status < 200 || probe.status >= 300) continue;
        listed = true;
      }
      const r = await applyCloverState(o, readCloverOrderState(co));
      if (r.changed) out.updated++;
    }
    return out;
  } catch (error) {
    return { ...out, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Heartbeat (live pulse, cron): at most every FOODHUB_CLOVER_WEBSITE_POLL_S, one run at a time. Never throws. */
export async function tickCloverWebsiteOrders(now = Date.now()): Promise<{ ran: boolean; imported?: number; updated?: number }> {
  if (!cloverWebsiteOrdersEnabled()) return { ran: false };
  const g = globalThis as { __foodhubWebsiteTick?: boolean };
  if (g.__foodhubWebsiteTick) return { ran: false };
  g.__foodhubWebsiteTick = true;
  try {
    const repo = getRepo();
    const last = await repo.getKv<number>(TICK_KEY).catch(() => null);
    if (last && now - last < pollMs()) return { ran: false };
    await repo.setKv(TICK_KEY, now);
    let imported = 0;
    let updated = 0;
    for (const mid of await allCloverMerchants((await repo.listStores()).map((s) => s.cloverMerchantId))) {
      const r = await importCloverWebsiteOrders(mid, { now });
      imported += r.imported;
      updated += r.updated;
    }
    return { ran: true, imported, updated };
  } catch (e) {
    console.error('[foodhub] Clover website orders tick failed', e instanceof Error ? e.message : e);
    return { ran: false };
  } finally {
    g.__foodhubWebsiteTick = false;
  }
}

// ---------------------------------------------------------------- webhook

/** Orders seen through the webhook that are not website orders, so their later updates cost no Clover call. */
const NOT_WEBSITE = new Map<string, number>();
const NOT_WEBSITE_TTL_MS = 30 * 60_000;

function rememberNotWebsite(id: string, now: number) {
  if (NOT_WEBSITE.size > 5000) for (const [k, exp] of NOT_WEBSITE) if (exp < now || NOT_WEBSITE.size > 4000) NOT_WEBSITE.delete(k);
  NOT_WEBSITE.set(id, now + NOT_WEBSITE_TTL_MS);
}

/**
 * Clover webhook, Orders events: { merchants: { MID: [{ objectId: "O:<orderId>", type: "CREATE" | "UPDATE" | "DELETE" }] } }.
 * A new order is read once and kept if it is a website order; updates and deletes of website orders are mirrored.
 */
export async function handleCloverOrderEvents(body: any, now = Date.now()): Promise<{ events: number; imported: number; updated: number }> {
  const out = { events: 0, imported: 0, updated: 0 };
  if (!cloverWebsiteOrdersEnabled()) return out;
  for (const [mid, list] of Object.entries((body?.merchants ?? {}) as Record<string, any[]>)) {
    const byId = new Map<string, string>();
    for (const e of Array.isArray(list) ? list : []) {
      const [kind, oid] = String(e?.objectId ?? '').split(':');
      if (kind !== 'O' || !oid) continue;
      const type = String(e?.type ?? '').toUpperCase();
      const prev = byId.get(oid);
      // DELETE beats everything; CREATE beats UPDATE.
      if (prev === 'DELETE' || (prev === 'CREATE' && type === 'UPDATE')) continue;
      byId.set(oid, type);
    }
    if (!byId.size) continue;
    out.events += byId.size;
    const token = await cloverToken(mid);
    if (!token) continue;
    let maps: Awaited<ReturnType<typeof labelMaps>> | null = null;
    let known: Set<string> | null = null;
    for (const [oid, type] of byId) {
      const existing = await getDirectOrder(websiteOrderDocId(oid));
      if (type === 'DELETE') {
        if (existing && (await applyCloverState(existing, readCloverOrderState(null))).changed) out.updated++;
        continue;
      }
      if (!existing && (NOT_WEBSITE.get(oid) ?? 0) > now) continue;
      const co = await cloverOrder(mid, token, oid);
      if (co === undefined) continue;
      if (co === null) {
        if (existing && (await applyCloverState(existing, readCloverOrderState(null))).changed) out.updated++;
        continue;
      }
      if (existing) {
        if ((await applyCloverState(existing, readCloverOrderState(co))).changed) out.updated++;
        continue;
      }
      maps ??= await labelMaps(mid, token);
      known ??= await knownFoodHubCloverIds(now);
      const kind = classifyCloverOrder(co, { ...maps, known });
      if (kind !== 'website') {
        // Remember it only once Clover has finished building it (an order type set): a website order can start bare.
        if (kind !== 'other' || co?.orderType?.id) rememberNotWebsite(oid, now);
        continue;
      }
      const r = await upsertCloverOnlineOrder(mid, co, { now });
      if (r.created) out.imported++;
      else if (r.changed) out.updated++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- kitchen screen actions

/** What the kitchen screen may do with a Clover online order: its own steps only — nothing is sent to Clover. */
export const CLOVER_ONLINE_LOCAL_ACTIONS = ['ack', 'ready', 'picked_up', 'complete', 'clear_attention'] as const;

export const DO_IT_IN_CLOVER = 'Commande du site web reçue par Clover : faites-le dans Clover (Commandes → la commande → Rembourser). Food Hub suit Clover. · Website order received by Clover: do it in Clover (Orders → the order → Refund). Food Hub follows Clover.';

/** Why an action is refused on a Clover online order (null = allowed, or not a Clover online order). */
export function cloverOnlineBlockedReason(order: Pick<DirectOrder, 'source'>, action: string): string | null {
  if (order.source !== 'clover_online') return null;
  return (CLOVER_ONLINE_LOCAL_ACTIONS as readonly string[]).includes(action) ? null : DO_IT_IN_CLOVER;
}

export type WebsiteOrderAction = 'ack' | 'ready' | 'complete';

/** "Seen", "Ready", "Done" on the Food Hub kitchen screen. Local only: Clover is not changed (it has no such state). */
export async function runWebsiteOrderAction(id: string, action: WebsiteOrderAction, actor: Actor): Promise<DirectOrder> {
  const order = await getDirectOrder(id);
  if (!order || order.source !== 'clover_online') throw new Error('Order not found.');
  const closed = order.status === 'completed' || order.status === 'cancelled';
  const at = nowIso();
  let next: DirectOrder;
  if (action === 'ack') {
    if (order.seenAt) return order;
    next = await addDirectEvent(order, 'seen', 'Seen on the kitchen screen.', actor.name, { seenAt: at, seenBy: actor.name });
  } else if (closed) {
    throw new Error(`Order ${order.number} is already ${order.status === 'cancelled' ? 'cancelled in Clover' : 'done'}.`);
  } else if (action === 'ready') {
    if (order.status === 'ready') return order;
    next = await addDirectEvent(order, 'ready', 'Ready — on the Food Hub screen only (nothing sent to Clover).', actor.name, { status: 'ready', seenAt: order.seenAt ?? at, seenBy: order.seenBy ?? actor.name });
  } else {
    next = await addDirectEvent(order, 'completed', 'Done — on the Food Hub screen only (nothing sent to Clover).', actor.name, { status: 'completed', attention: undefined, seenAt: order.seenAt ?? at, seenBy: order.seenBy ?? actor.name });
  }
  if (action !== 'ack') {
    await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: `clover_website_${action}`, status: 'success', brandName: order.brandName, locationCode: order.locationCode,
      summary: `Website order ${order.number} (Clover online): ${action === 'ready' ? 'ready' : 'done'} on the kitchen screen — nothing sent to Clover.` });
  }
  return next;
}

/** Open Clover online orders for the kitchen screen (newest window only), optionally limited to some locations. */
export async function listOpenWebsiteOrders(opts: { locationCodes?: string[]; now?: number } = {}): Promise<DirectOrder[]> {
  const now = opts.now ?? Date.now();
  const list = await listDirectOrders({ since: new Date(now - OPEN_WINDOW_MS).toISOString(), limit: 1000, locationCodes: opts.locationCodes });
  return list.filter((o) => o.source === 'clover_online' && OPEN.includes(o.status)).sort((a, b) => a.placedAt.localeCompare(b.placedAt));
}
