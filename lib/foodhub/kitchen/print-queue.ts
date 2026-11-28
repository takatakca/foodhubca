// Print queue of the Food Hub tablet app (apps/kitchen-tablet): the kitchen's new orders (platform + our own) with a
// plain-text ticket each, for the tablet's own thermal printer. Where a Clover printer exists, Clover's print_event
// (pos/clover-order.ts printKitchenTicket) stays the first choice: the tablet's auto-print is switched off there.
//
//   GET  /api/foodhub/kitchen/print-queue?since=<iso>&location=<code>&device=<id>&paper=58|80&lang=fr|en
//   POST /api/foodhub/kitchen/print-queue/<orderId>/printed  { deviceId, source?, kind? }
//
// Never twice: the tablet claims a ticket BEFORE printing it. The claim is an atomic insert (repo.claimKv, a primary
// key in Supabase) that is read back; only the caller whose nonce comes back prints. One claim per device, order and
// kind ('order' = the ticket, 'cancel' = the short « ANNULÉE » ticket, only for an order this device printed).
// A cancelled order is never printed. The first claim of a ticket in a kitchen also leaves a kitchen-wide mark: a
// reinstalled app (new device id, empty memory) is told what the kitchen already printed (printedElsewhere) and does
// not print it again.
//
// Who may call: a signed-in person who can see the kitchen ('view', location in scope), or an enrolled kitchen tablet
// (its signed device cookie, its own location only) — so printing goes on while the tablet sits on its PIN screen.
import { getActor, inScope, type AuthUser } from '../auth';
import { listDirectOrders, getDirectOrder } from '../delivery/store';
import { KITCHEN_SOURCES } from '../delivery/kitchen';
import type { DirectOrder } from '../delivery/types';
import { fail } from '../http';
import { deviceFromRequest, getDevice } from '../identity/devices';
import { getRepo } from '../repo';
import { isWaitingScheduled } from '../scheduling';
import { can, signPrintQueueContinuation, verifyPrintQueueContinuation } from '../session';
import type { StoredOrder } from '../types';
import {
  directLabel, platformLabel, platformNumber, renderCancelTicket, renderKitchenTicket, ticketFromDirectOrder, ticketFromStoredOrder,
  type TicketLang, type TicketWidth,
} from './ticket-text';

export type PrintSource = 'platform' | 'direct';
export type PrintKind = 'order' | 'cancel';

export interface PrintQueueItem {
  /** Unique per ticket: `${source}:${orderId}:${kind}`. */
  id: string;
  orderId: string;
  source: PrintSource;
  kind: PrintKind;
  /** Platform (uber_eats, doordash…) or own-order source (phone, website…). */
  channel: string;
  number: string;
  brandName: string | null;
  locationCode: string;
  createdAt: string;
  /** When it reached the kitchen (fire time / payment released / created), or when it was cancelled. */
  at: string;
  /** Already claimed by this device (null when no device id was given). */
  printed: boolean | null;
  /**
   * Not claimed by this device, but already printed by another tablet of this kitchen (null when no device id was
   * given). The app reads it on its first run after an install or a data wipe: no second ticket for what the previous
   * install printed. Afterwards each tablet prints its own copy, as before.
   */
  printedElsewhere: boolean | null;
  ticket: string;
}

/** Default and furthest look-back of the since cursor. */
export const DEFAULT_SINCE_MS = 15 * 60_000;
export const MAX_SINCE_MS = 24 * 3600_000;
/** How far back orders are read to find the ones that reached the kitchen since the cursor (scheduled, paid later). */
const PLATFORM_WINDOW_MS = 24 * 3600_000;
const DIRECT_WINDOW_MS = 12 * 3600_000; // same as the kitchen screen (delivery/kitchen.ts)
const MAX_ITEMS = 50;
const CONTINUATION_LIFETIME_MS = 15 * 60_000;

// ------------------------------------------------------------------ small pure helpers

export function validDeviceId(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s);
}

export function ticketWidth(paper: unknown): TicketWidth {
  return String(paper ?? '').trim() === '58' ? 32 : 42;
}

export function ticketLang(lang: unknown): TicketLang {
  return String(lang ?? '').trim().toLowerCase().startsWith('en') ? 'en' : 'fr';
}

/** The since cursor: a valid ISO date, never in the future, never more than 24 h back. Default: 15 minutes back. */
export function parseSince(raw: unknown, now = Date.now()): string {
  const t = typeof raw === 'string' && raw ? Date.parse(raw) : NaN;
  const v = Number.isFinite(t) ? Math.min(now, Math.max(now - MAX_SINCE_MS, t)) : now - DEFAULT_SINCE_MS;
  return new Date(v).toISOString();
}

export function claimKey(deviceId: string, kind: PrintKind, source: PrintSource, orderId: string): string {
  return `tablet_print:${deviceId}:${kind}:${source}:${orderId}`;
}

/** Kitchen-wide mark left by the first tablet that printed this ticket (any device). */
export function kitchenPrintKey(kind: PrintKind, source: PrintSource, orderId: string): string {
  return `tablet_print_any:${kind}:${source}:${orderId}`;
}

const later = (a: string, b?: string | null): string => (b && b > a ? b : a);

/**
 * When a platform order reached the kitchen: its fire time for a scheduled order, else its arrival. An order that
 * came in through Clover's own DoorDash / Uber integration (viaPos) reaches Food Hub only at the next Clover import
 * (every few minutes) but keeps Clover's creation time: it counts from its import (timeline.seenAt, set then).
 */
export function platformKitchenAt(o: Pick<StoredOrder, 'createdAt' | 'timeline' | 'viaPos'>): string {
  const at = o.timeline?.firedAt ?? o.createdAt;
  return o.viaPos ? later(at, o.timeline?.seenAt) : at;
}

/** A platform order to cook now (not cancelled, not waiting for its fire time). */
export function platformToCook(o: Pick<StoredOrder, 'status' | 'timeline'>, now = Date.now()): boolean {
  return (o.status === 'new' || o.status === 'accepted') && !isWaitingScheduled(o, now);
}

/**
 * When an own order reached the kitchen: when it left the payment hold — paid (paylink.releasedAt) or switched to
 * « pay at the counter » (that event; the link is stopped at the same moment, paylink.cancelledAt) — else when it was
 * placed. Never earlier than its creation. (payAtCounter does not set releasedAt: that field means "paid".)
 */
export function directKitchenAt(o: Pick<DirectOrder, 'createdAt' | 'placedAt' | 'paylink' | 'events' | 'status'>): string {
  const pl = o.paylink as { releasedAt?: string; cancelledAt?: string } | undefined;
  const counter = [...(o.events ?? [])].reverse().find((e) => e.type === 'pay_at_counter')?.at;
  const leftHold = o.status === 'new' || o.status === 'in_kitchen' ? pl?.cancelledAt : undefined;
  let at = o.createdAt ?? o.placedAt;
  for (const t of [pl?.releasedAt, counter, leftHold]) at = later(at, t);
  return at;
}

/** An own order to cook now: one of the kitchen screen's sources, not held for payment, not done or cancelled. */
export function directToCook(o: Pick<DirectOrder, 'source' | 'status'>): boolean {
  return KITCHEN_SOURCES.includes(o.source) && (o.status === 'new' || o.status === 'in_kitchen');
}

function directCancelledAt(o: DirectOrder): string {
  return [...(o.events ?? [])].reverse().find((e) => e.type === 'cancelled')?.at ?? o.updatedAt;
}

// ------------------------------------------------------------------ who is calling

export type PrintCaller = { location: string; label: string; actor: AuthUser | null; cursorScope: string };

/** A staff session (with 'view', location in scope) or an enrolled tablet's device cookie (its own location). 401 otherwise. */
export async function resolvePrintCaller(req: Request, requested?: string | null): Promise<PrintCaller | Response> {
  const want = (requested ?? '').trim() || null;
  const actor = await getActor(req);
  if (actor) {
    if (!can(actor.role, 'view')) return fail(`Your role (${actor.role}) cannot do this.`, 403);
    let location = want;
    if (!location && actor.deviceId) location = (await getDevice(actor.deviceId))?.locationCode ?? null;
    if (!location && actor.locations.length === 1) location = actor.locations[0];
    if (!location) return fail('Choose the kitchen: add ?location=<code> (Settings in the tablet app).', 400, { needLocation: true });
    if (!inScope(actor, location)) return fail('This kitchen is not in your locations.', 403);
    return { location, label: actor.name, actor, cursorScope: `staff:${actor.username}:${actor.deviceId ?? ''}` };
  }
  const device = await deviceFromRequest(req);
  if (device) {
    if (want && want !== device.locationCode) return fail('This tablet is enrolled for another kitchen.', 403);
    return { location: device.locationCode, label: `Tablet ${device.name}`, actor: null, cursorScope: `tablet:${device.id}:${device.enrolledAt}` };
  }
  return fail('Please sign in.', 401);
}

// ------------------------------------------------------------------ the queue

export interface QueueOptions {
  location: string;
  since?: string | null;
  deviceId?: string | null;
  paper?: unknown;
  lang?: unknown;
  now?: number;
  page?: { scope: string; continuation: string | null };
}

export class InvalidPrintQueueContinuation extends Error {}

function ticketOrder(a: { at: string; id: string }, b: { at: string; id: string }): number {
  const time = Date.parse(a.at) - Date.parse(b.at);
  if (time) return time;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export async function buildPrintQueue(opts: QueueOptions): Promise<{ items: PrintQueueItem[]; since: string; serverTime: string; width: TicketWidth; lang: TicketLang; paged?: true; continuation?: string }> {
  const now = opts.now ?? Date.now();
  const device = validDeviceId(opts.deviceId) ? opts.deviceId : null;
  const token = opts.page?.continuation;
  const cursor = typeof token === 'string' && token.length <= 2048 && /^[\w-]+\.[\w-]{43}$/.test(token)
    ? await verifyPrintQueueContinuation(token) : null;
  if (token != null && (!cursor || cursor.scope !== opts.page?.scope || cursor.location !== opts.location || cursor.device !== device
    || Date.parse(cursor.horizon) > now || (opts.since && parseSince(opts.since, Date.parse(cursor.horizon)) !== cursor.from))) {
    throw new InvalidPrintQueueContinuation();
  }
  const horizon = cursor?.horizon ?? new Date(now).toISOString();
  const snapshot = Date.parse(horizon);
  const since = cursor?.from ?? parseSince(opts.since, snapshot);
  const lowerBound = Date.parse(since);
  const reachedWithin = (at: string) => {
    if (!opts.page) return at >= since;
    const time = Date.parse(at);
    return time >= lowerBound && time <= snapshot;
  };
  const until = opts.page ? new Date(snapshot + 1).toISOString() : undefined; // repository bounds are exclusive
  const width = ticketWidth(opts.paper);
  const lang = ticketLang(opts.lang);
  const timeZone = process.env.FOODHUB_TIMEZONE || 'America/Toronto';
  const repo = getRepo();

  // The paged response is terminal only after both bounded-by-time source queries are exhausted.
  const [platform, direct] = await Promise.all([
    repo.listOrders({
      since: new Date(snapshot - PLATFORM_WINDOW_MS).toISOString(), until, statuses: ['new', 'accepted', 'cancelled'],
      locationCodes: [opts.location], limit: opts.page ? Number.POSITIVE_INFINITY : 500,
    }),
    listDirectOrders({
      since: new Date(snapshot - DIRECT_WINDOW_MS).toISOString(), until, limit: opts.page ? Number.POSITIVE_INFINITY : 1000,
      ...(opts.page ? { locationCode: opts.location } : { locationCodes: [opts.location] }),
    }),
  ]);

  type Draft = Omit<PrintQueueItem, 'printed' | 'printedElsewhere' | 'ticket'> & { render: () => string };
  const drafts: Draft[] = [];
  for (const o of platform) {
    if (o.locationCode !== opts.location) continue;
    const base = { orderId: o.id, source: 'platform' as const, channel: o.channel, number: platformNumber(o), brandName: o.brandName ?? null, locationCode: opts.location, createdAt: o.createdAt };
    if (platformToCook(o, snapshot) && reachedWithin(platformKitchenAt(o))) {
      drafts.push({ ...base, id: `platform:${o.id}:order`, kind: 'order', at: platformKitchenAt(o), render: () => renderKitchenTicket(ticketFromStoredOrder(o), { width, lang, timeZone }) });
    } else if (o.status === 'cancelled' && device) {
      const at = o.timeline?.cancelledAt ?? o.updatedAt;
      if (reachedWithin(at)) drafts.push({ ...base, id: `platform:${o.id}:cancel`, kind: 'cancel', at, render: () => renderCancelTicket({ platform: platformLabel(o.channel), number: platformNumber(o), brandName: o.brandName, cancelledAt: at, reason: o.timeline?.cancelReason }, { width, lang, timeZone }) });
    }
  }
  for (const o of direct) {
    if (o.locationCode !== opts.location || !KITCHEN_SOURCES.includes(o.source)) continue;
    const base = { orderId: o.id, source: 'direct' as const, channel: o.source, number: o.number, brandName: o.brandName ?? null, locationCode: opts.location, createdAt: o.createdAt };
    if (directToCook(o) && reachedWithin(directKitchenAt(o))) {
      drafts.push({ ...base, id: `direct:${o.id}:order`, kind: 'order', at: directKitchenAt(o), render: () => renderKitchenTicket(ticketFromDirectOrder(o, lang), { width, lang, timeZone }) });
    } else if (o.status === 'cancelled' && device) {
      const at = directCancelledAt(o);
      if (reachedWithin(at)) drafts.push({ ...base, id: `direct:${o.id}:cancel`, kind: 'cancel', at, render: () => renderCancelTicket({ platform: directLabel(o.source, lang), number: o.number, brandName: o.brandName, cancelledAt: at }, { width, lang, timeZone }) });
    }
  }
  drafts.sort(opts.page ? ticketOrder : (a, b) => a.at.localeCompare(b.at));

  const items: PrintQueueItem[] = [];
  let more = false;
  for (const d of drafts) {
    if (!opts.page && items.length >= MAX_ITEMS) break;
    if (cursor && ticketOrder(d, cursor) <= 0) continue;
    let printed: boolean | null = null;
    let printedElsewhere: boolean | null = null;
    if (device) {
      printed = Boolean(await repo.getKv(claimKey(device, d.kind, d.source, d.orderId)));
      // A cancel ticket only for an order this tablet printed (and only once).
      if (d.kind === 'cancel' && (printed || !(await repo.getKv(claimKey(device, 'order', d.source, d.orderId))))) continue;
      printedElsewhere = !printed && d.kind === 'order' && Boolean(await repo.getKv(kitchenPrintKey(d.kind, d.source, d.orderId)));
    }
    if (items.length === MAX_ITEMS) { more = true; break; }
    const { render, ...rest } = d;
    items.push({ ...rest, printed, printedElsewhere, ticket: render() });
  }
  const last = items.at(-1);
  const continuation = opts.page && more && last ? await signPrintQueueContinuation({
    scope: opts.page.scope, location: opts.location, device, from: since, horizon, at: last.at, id: last.id,
    exp: Math.ceil((now + CONTINUATION_LIFETIME_MS) / 1000),
  }) : undefined;
  return { items, since, serverTime: horizon, width, lang, ...(opts.page ? { paged: true } as const : {}), ...(continuation ? { continuation } : {}) };
}

// ------------------------------------------------------------------ the claim

export type ClaimResult =
  | { claimed: true; id: string }
  | { claimed: false; id?: string; reason: 'already_printed' | 'cancelled' | 'not_cancelled' | 'not_printed_here' | 'not_found' | 'other_kitchen' | 'not_for_kitchen' | 'conflict' };

type Found = { source: 'platform'; order: StoredOrder } | { source: 'direct'; order: DirectOrder };

async function findOrder(orderId: string, source?: PrintSource | null): Promise<Found | null> {
  if (source !== 'direct') {
    const o = await getRepo().getOrder(orderId);
    if (o) return { source: 'platform', order: o };
  }
  if (source !== 'platform') {
    const d = await getDirectOrder(orderId);
    if (d) return { source: 'direct', order: d };
  }
  return null;
}

/**
 * Claims one ticket for one device, BEFORE it is printed: written once (atomic insert), then read back. Only a
 * { claimed: true } answer may print. A second call — the same device again, a retry after a lost answer — gets
 * { claimed: false, reason: 'already_printed' }; the queue then says printed: true for it, and the app prints a ticket
 * it claimed but never wrote down as handled (apps/kitchen-tablet QueueLogic.plan, step RECOVER).
 */
export async function claimTabletPrint(opts: { orderId: string; deviceId: string; location: string; by: string; source?: PrintSource | null; kind?: PrintKind | null; now?: number }): Promise<ClaimResult> {
  const kind: PrintKind = opts.kind === 'cancel' ? 'cancel' : 'order';
  const found = await findOrder(opts.orderId, opts.source);
  if (!found) return { claimed: false, reason: 'not_found' };
  const { source, order } = found;
  if (order.locationCode !== opts.location) return { claimed: false, reason: 'other_kitchen' };
  const id = `${source}:${order.id}:${kind}`;
  const cancelled = order.status === 'cancelled';
  if (kind === 'order') {
    if (cancelled) return { claimed: false, id, reason: 'cancelled' };
    const toCook = source === 'platform' ? platformToCook(order as StoredOrder, opts.now) : directToCook(order as DirectOrder);
    if (!toCook) return { claimed: false, id, reason: 'not_for_kitchen' };
  } else {
    if (!cancelled) return { claimed: false, id, reason: 'not_cancelled' };
    if (!(await getRepo().getKv(claimKey(opts.deviceId, 'order', source, order.id)))) return { claimed: false, id, reason: 'not_printed_here' };
  }
  const repo = getRepo();
  const key = claimKey(opts.deviceId, kind, source, order.id);
  const nonce = crypto.randomUUID();
  const won = await repo.claimKv(key, { at: new Date(opts.now ?? Date.now()).toISOString(), deviceId: opts.deviceId, by: opts.by, nonce });
  if (!won) return { claimed: false, id, reason: 'already_printed' };
  // Read back: only the nonce we wrote may print (never twice, even if two calls raced through the insert).
  const back = await repo.getKv<{ nonce?: string }>(key);
  if (back?.nonce !== nonce) return { claimed: false, id, reason: 'conflict' };
  // Kitchen-wide mark (the first tablet wins; never read by the claim itself): a reinstalled app skips it on its first run.
  await repo.claimKv(kitchenPrintKey(kind, source, order.id), { at: new Date(opts.now ?? Date.now()).toISOString(), deviceId: opts.deviceId }).catch(() => false);
  if (source === 'platform') {
    await repo.addEvent(order.id, kind === 'cancel' ? 'tablet_cancel_printed' : 'tablet_printed', { message: `${kind === 'cancel' ? 'Cancel ticket' : 'Ticket'} printed on the kitchen tablet app`, deviceId: opts.deviceId, by: opts.by }).catch(() => undefined);
  }
  return { claimed: true, id };
}
