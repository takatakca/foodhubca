// Platform orders that reach Clover through Clover's OWN integrations (Clover ↔ DoorDash, Clover ↔ Uber Eats…).
//
// When a delivery platform is linked to Clover directly (Clover → Online ordering → Partners), the platform's
// orders are created in Clover by that integration — Food Hub never receives them by webhook. Food Hub reads them
// from Clover so they still show up in the Command Center, the order history, analytics, payout checks and
// reports, and so they are never counted as in-store sales.
//
// These orders are READ-ONLY in Food Hub ("via Clover"): Clover's integration already accepted, printed and paid
// them, so Food Hub never accepts, rejects, cancels, re-sends to Clover or records a payment for them. The kitchen
// can still move them to Ready / Completed on its own screen (local only — nothing is sent anywhere).
//
// How an order is recognised: its order type, a payment tender, its title or its note names the platform
// ("DoorDash", "Uber Eats", "SkipTheDishes", "Too Good To Go"). Orders Food Hub created itself (known Clover order
// ids) are always skipped, and an order is read only once it is 2 minutes old so Food Hub's own new orders have
// time to be saved first. Turn it off with FOODHUB_CLOVER_PLATFORM_ORDERS=off.
import { logActivity } from '../activity';
import { CHANNEL_LABELS, CHANNEL_MARKETPLACE, fromCents, nowIso } from '../config';
import { cloverFetch } from './clover-http';
import { getRepo } from '../repo';
import { screenEntryStoreRef } from '../screen-entry-id';
import type { ChannelKey, NormalizedOrder, OrderLine } from '../types';
import { cloverBaseUrl, cloverToken } from './clover';
import { isPlatformTender, platformFromLabel } from './platform-labels';
import { cloverOrderTitle, normName, normalizeCloverOrderTitle } from './clover-order';
import { noteLastOrder } from '../order-retry';
import { mevOnOrderChange } from '../mev/hooks';

const SINCE_KEY = (mid: string) => `clover_platform_orders_since:${mid}`;
const WINDOW_KEY = (mid: string) => `clover_platform_orders_window:${mid}`;
const MIN_AGE_MS = 2 * 60_000;
const FIRST_LOOKBACK_MS = 24 * 3600_000;
const MAX_HISTORY_MS = 90 * FIRST_LOOKBACK_MS;
const MAX_PAGES = 10;
const PAGE = 100;

interface ImportWindow {
  since: number;
  until: number;
  offset: number;
  lastId?: string;
}

function ordersQuery(window: ImportWindow, offset: number, expand: string): URLSearchParams {
  const query = new URLSearchParams({ expand, limit: String(PAGE), offset: String(offset), orderBy: 'createdTime ASC,id ASC' });
  query.append('filter', `createdTime>=${window.since}`);
  query.append('filter', `createdTime<${window.until}`);
  return query;
}

function checkedOrders(json: { elements?: unknown } | null, window: ImportWindow): any[] {
  const rows = json?.elements;
  if (!Array.isArray(rows) || rows.length > PAGE) throw new Error('Invalid Clover order page');
  let previousTime = -Infinity;
  let previousId = '';
  for (const order of rows) {
    const time = Number(order?.createdTime);
    const id = order?.id;
    if (typeof id !== 'string' || !id || !Number.isSafeInteger(time) || time < window.since || time >= window.until) {
      throw new Error('Invalid order in Clover order page');
    }
    if (time < previousTime || (time === previousTime && id <= previousId)) throw new Error('Unordered Clover order page');
    previousTime = time;
    previousId = id;
  }
  return rows;
}

export function cloverPlatformOrdersEnabled() {
  return process.env.FOODHUB_CLOVER_PLATFORM_ORDERS !== 'off';
}

export { isPlatformTender, platformFromLabel };

async function cloverGet(mid: string, token: string, path: string, qs: Record<string, string> | URLSearchParams = {}): Promise<any> {
  const q = new URLSearchParams(qs);
  const res = await cloverFetch(`${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(mid)}/${path}${q.toString() ? `?${q}` : ''}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Clover ${path} HTTP ${res.status}`);
  return res.json();
}

async function labelMap(mid: string, token: string, path: 'order_types' | 'tenders'): Promise<Map<string, string>> {
  const json = await cloverGet(mid, token, path, { limit: '200' }).catch(() => ({ elements: [] }));
  const m = new Map<string, string>();
  for (const e of Array.isArray(json?.elements) ? json.elements : []) if (e?.id) m.set(String(e.id), String(e.label ?? e.labelKey ?? ''));
  return m;
}

/** Platform of a Clover order: order type first, then payment tenders, then title and note. */
export function detectPlatform(order: any, orderTypes: Map<string, string>, tenders: Map<string, string>): ChannelKey | null {
  const typeLabel = order?.orderType?.label ?? orderTypes.get(String(order?.orderType?.id ?? ''));
  const payments: any[] = order?.payments?.elements ?? [];
  const tenderLabels = payments.map((p) => p?.tender?.label ?? tenders.get(String(p?.tender?.id ?? '')));
  for (const label of [typeLabel, ...tenderLabels]) {
    const ch = platformFromLabel(label);
    if (ch) return ch;
  }
  for (const text of [order?.title, order?.note]) {
    const ch = platformFromLabel(text, true);
    if (ch) return ch;
  }
  return null;
}

function linesOf(order: any): OrderLine[] {
  const items: any[] = order?.lineItems?.elements ?? [];
  return items.filter((li) => !li?.refunded).map((li) => {
    const mods: any[] = li?.modifications?.elements ?? [];
    const modifiers = mods.map((m) => ({ externalId: m?.modifier?.id ? String(m.modifier.id) : undefined, name: String(m?.name ?? 'Option'), quantity: 1, unitPrice: fromCents(Number(m?.amount) || 0) }));
    // Clover quantities: one line item per unit; unitQty (thousandths) only for items sold by weight/quantity.
    const quantity = li?.unitQty ? Math.max(1, Math.round(Number(li.unitQty) / 1000)) : 1;
    const unitPrice = fromCents(Number(li?.price) || 0);
    const modTotal = modifiers.reduce((s, m) => s + m.unitPrice, 0);
    return {
      externalId: li?.id ? String(li.id) : undefined,
      posItemRef: li?.item?.id ? String(li.item.id) : undefined,
      name: String(li?.name ?? 'Item'),
      quantity,
      unitPrice,
      total: Math.round((unitPrice + modTotal) * quantity * 100) / 100,
      notes: li?.note ? String(li.note) : undefined,
      modifiers,
    };
  });
}

export interface CloverPlatformImport { merchantId: string; imported: number; skipped: number; posOrderIds: string[]; error?: string }

/**
 * Reads the Clover orders created since the last run, keeps the ones a delivery platform created through Clover's
 * own integration, and records them in Food Hub (read-only, "via Clover"). Returns their Clover order ids so the
 * in-store sales never count them.
 */
export async function importCloverPlatformOrders(mid: string, opts: { now?: number; knownPosOrderIds?: Set<string> } = {}): Promise<CloverPlatformImport> {
  const out: CloverPlatformImport = { merchantId: mid, imported: 0, skipped: 0, posOrderIds: [] };
  if (!cloverPlatformOrdersEnabled()) return out;
  const token = await cloverToken(mid);
  if (!token) return { ...out, error: `No Clover API token for merchant ${mid}` };
  const repo = getRepo();
  const now = opts.now ?? Date.now();
  // The exclusive bound includes orders exactly MIN_AGE_MS old, like the original poll.
  const until = now - MIN_AGE_MS + 1;
  const cursor = await repo.getKv<number>(SINCE_KEY(mid));
  const pending = await repo.getKv<ImportWindow>(WINDOW_KEY(mid));
  const since = cursor ?? pending?.since ?? now - FIRST_LOOKBACK_MS;
  if (since >= until) return out;
  if (since < now - MAX_HISTORY_MS) {
    return { ...out, error: 'Clover order cursor is outside the last 90 days supported by the Orders API; retained for reconciliation' };
  }
  const window = pending?.since === since && pending.until <= until ? pending : { since, until, offset: 0 };
  let progress = window;

  // Match our full scoped screen title when the Clover ID was lost. Older orders still use platform and visible code.
  const recent = await repo.listOrders({ since: new Date(since - 3 * 24 * 3600_000).toISOString(), limit: 5000 });
  const known = opts.knownPosOrderIds ?? new Set(recent.map((o) => o.posOrderId).filter(Boolean) as string[]);
  const ownScreenTitles = new Set<string>();
  const ownOrderCodes = new Set<string>();
  for (const order of recent) {
    if (order.viaPos) continue;
    if (order.viaHub === 'screen' && screenEntryStoreRef(order.externalOrderId)) {
      ownScreenTitles.add(normalizeCloverOrderTitle(cloverOrderTitle(order)));
    } else {
      ownOrderCodes.add(`${order.channel}|${(order.displayId || order.externalOrderId.slice(0, 8)).toLowerCase()}`);
    }
  }
  try {
    // Pin discovery even when the first provider page fails, so retries retain the same window.
    if (window !== pending) await repo.setKv(WINDOW_KEY(mid), window);
    const [orderTypes, tenders] = await Promise.all([labelMap(mid, token, 'order_types'), labelMap(mid, token, 'tenders')]);
    const stores = await repo.listStores();
    const def = process.env.CLOVER_MERCHANT_ID;
    const storesHere = stores.filter((s) => (s.cloverMerchantId || def) === mid);
    // One Clover merchant can serve several kitchens and many brands: a location is only assumed when it is the only one.
    const onlyLocation = (list: typeof storesHere) => { const locs = [...new Set(list.map((s) => s.locationCode))]; return locs.length === 1 ? locs[0] : undefined; };
    const fallbackLocation = onlyLocation(storesHere);

    let exhausted = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      // Re-read the last row before using an offset. A deleted row can move the whole page.
      const overlap = progress.offset > 0;
      const offset = overlap ? progress.offset - 1 : 0;
      const qs = (expand: string) => ordersQuery(window, offset, expand);
      // If Clover refuses the nested expansion, read the orders with the essentials only.
      const json = await cloverGet(mid, token, 'orders', qs('lineItems,lineItems.modifications,payments,orderType,customers'))
        .catch((e) => (/HTTP 400/.test(String(e?.message)) ? cloverGet(mid, token, 'orders', qs('lineItems,payments,orderType')) : Promise.reject(e)));
      const rows = checkedOrders(json, window);
      if (overlap && rows[0]?.id !== progress.lastId) {
        progress = { ...window, offset: 0, lastId: undefined };
        continue;
      }
      for (const co of overlap ? rows.slice(1) : rows) {
        const id = String(co?.id ?? '');
        const created = Number(co?.createdTime) || 0;
        if (!id || created > until || known.has(id)) continue;
        const channel = detectPlatform(co, orderTypes, tenders);
        if (!channel) continue; // an in-store order
        const titleId = String(co?.title ?? '').replace(/^[^#]*#\s*/, '').trim().toLowerCase();
        if (ownScreenTitles.has(normalizeCloverOrderTitle(co?.title)) || (titleId && ownOrderCodes.has(`${channel}|${titleId}`))) continue;
        // The brand: the only store of that platform on this merchant, or the brand named in the Clover title / note.
        // Several candidates and no name → brand left unknown rather than guessed (never filed under the wrong brand).
        const candidates = storesHere.filter((s) => s.channel === channel);
        const text = normName(`${co?.title ?? ''} ${co?.note ?? ''}`);
        const named = candidates.filter((s) => normName(s.brandName) && text.includes(normName(s.brandName)));
        const store = candidates.length === 1 ? candidates[0] : named.length === 1 ? named[0] : undefined;
        const location = store?.locationCode ?? onlyLocation(named.length ? named : candidates) ?? fallbackLocation;
        const payments: any[] = co?.payments?.elements ?? [];
        const sum = (f: string) => fromCents(payments.reduce((s, p) => s + (Number(p?.[f]) || 0), 0));
        const lines = linesOf(co);
        const subtotal = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;
        const customer = co?.customers?.elements?.[0];
        const label = String(co?.orderType?.label ?? orderTypes.get(String(co?.orderType?.id ?? '')) ?? '');
        const n: NormalizedOrder & { locationCode?: string; createdAt?: string } = {
          channel,
          marketplace: CHANNEL_MARKETPLACE[channel],
          externalOrderId: `clover-${id}`,
          displayId: String(co?.title || id).replace(/^\s*(door\s*dash|uber\s*eats|skip\s*the\s*dishes|too\s*good\s*to\s*go)\s*#?\s*/i, '').slice(0, 40) || id.slice(0, 8),
          channelStoreId: store?.channelStoreId ?? `clover:${mid}`,
          brandName: store?.brandName,
          customerName: customer ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') || undefined : undefined,
          fulfillment: /pick\s*up|emporter|takeout/i.test(label) ? 'pickup' : 'delivery',
          placedAt: new Date(created || now).toISOString(),
          currency: String(co?.currency || 'CAD'),
          subtotal,
          tax: sum('taxAmount'),
          deliveryFee: 0,
          tip: sum('tipAmount'),
          discount: 0,
          total: co?.total != null ? fromCents(Number(co.total)) : subtotal,
          notes: co?.note ? String(co.note).slice(0, 500) : undefined,
          lines,
          raw: { cloverOrderId: id, title: co?.title ?? null, orderType: label || null, state: co?.state ?? null },
          viaPos: 'clover',
          locationCode: location,
          createdAt: new Date(created || now).toISOString(),
        };
        const fresh = now - created < 90 * 60_000;
        const seenAt = nowIso();
        // Persist what Clover already did together with the order, so a retry never finds a half-imported row.
        const { order, isNew } = await repo.insertOrderIfNew(n, {
          status: fresh ? 'accepted' : 'completed',
          posOrderId: id,
          timeline: { acceptedAt: n.placedAt, acceptedBy: 'clover', seenAt, seenBy: 'Clover', ...(fresh ? {} : { completedAt: seenAt }) },
        });
        known.add(id);
        if (!isNew) { out.skipped++; continue; }
        await repo.addEvent(order.id, 'via_clover', { message: `Received in Clover through Clover's own ${CHANNEL_LABELS[channel]} integration — Food Hub only follows it (nothing is sent to ${CHANNEL_LABELS[channel]} or Clover).${store ? '' : ` Brand not known: ${candidates.length} ${CHANNEL_LABELS[channel]} stores use this Clover and the order does not name one.`}`, cloverOrderId: id });
        await noteLastOrder(channel, n.placedAt);
        // Only for a kitchen whose invoices go through Takatak MEV (sevOfRecord qcmev); the Clover MEV app otherwise.
        await mevOnOrderChange(order);
        out.imported++;
        out.posOrderIds.push(id);
      }
      if (rows.length < PAGE) {
        exhausted = true;
        break;
      }
      progress = { ...window, offset: offset + rows.length, lastId: rows[rows.length - 1].id };
    }
    // Another poll may have completed this window. A stale progress write is ignored once its start
    // no longer matches the numeric cursor. Overlapping completions have independently scanned the window.
    const latest = await repo.getKv<number>(SINCE_KEY(mid));
    if (exhausted) {
      if (latest === null || latest < window.until) await repo.setKv(SINCE_KEY(mid), window.until);
    } else if (latest === null || latest === window.since) {
      await repo.setKv(WINDOW_KEY(mid), progress);
    }
    if (out.imported) {
      await logActivity({ actor: 'Clover', source: 'platform', kind: 'order', action: 'clover_platform_orders', status: 'info',
        summary: `${out.imported} delivery order(s) received through Clover's own platform integration (merchant ${mid}) added to Food Hub — read-only.` });
    }
    return out;
  } catch (error) {
    return { ...out, error: error instanceof Error ? error.message : String(error) };
  }
}
