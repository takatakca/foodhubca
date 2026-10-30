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
// A cancelled order is never printed.
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
import { can } from '../session';
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
  ticket: string;
}

/** Default and furthest look-back of the since cursor. */
export const DEFAULT_SINCE_MS = 15 * 60_000;
export const MAX_SINCE_MS = 24 * 3600_000;
/** How far back orders are read to find the ones that reached the kitchen since the cursor (scheduled, paid later). */
const PLATFORM_WINDOW_MS = 24 * 3600_000;
const DIRECT_WINDOW_MS = 12 * 3600_000; // same as the kitchen screen (delivery/kitchen.ts)
const MAX_ITEMS = 50;

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

/** When a platform order reached the kitchen: its fire time for a scheduled order, else its arrival. */
export function platformKitchenAt(o: Pick<StoredOrder, 'createdAt' | 'timeline'>): string {
  return o.timeline?.firedAt ?? o.createdAt;
}

/** A platform order to cook now (not cancelled, not waiting for its fire time). */
export function platformToCook(o: Pick<StoredOrder, 'status' | 'timeline'>, now = Date.now()): boolean {
  return (o.status === 'new' || o.status === 'accepted') && !isWaitingScheduled(o, now);
}

/** When an own order reached the kitchen: released after payment (payment link), else placed. */
export function directKitchenAt(o: Pick<DirectOrder, 'createdAt' | 'placedAt' | 'paylink'>): string {
  return (o.paylink as { releasedAt?: string } | undefined)?.releasedAt ?? o.createdAt ?? o.placedAt;
}

/** An own order to cook now: one of the kitchen screen's sources, not held for payment, not done or cancelled. */
export function directToCook(o: Pick<DirectOrder, 'source' | 'status'>): boolean {
  return KITCHEN_SOURCES.includes(o.source) && (o.status === 'new' || o.status === 'in_kitchen');
}

function directCancelledAt(o: DirectOrder): string {
  return [...(o.events ?? [])].reverse().find((e) => e.type === 'cancelled')?.at ?? o.updatedAt;
}

// ------------------------------------------------------------------ who is calling

export type PrintCaller = { location: string; label: string; actor: AuthUser | null };

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
    return { location, label: actor.name, actor };
  }
  const device = await deviceFromRequest(req);
  if (device) {
    if (want && want !== device.locationCode) return fail('This tablet is enrolled for another kitchen.', 403);
    return { location: device.locationCode, label: `Tablet ${device.name}`, actor: null };
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
}

export async function buildPrintQueue(opts: QueueOptions): Promise<{ items: PrintQueueItem[]; since: string; serverTime: string; width: TicketWidth; lang: TicketLang }> {
  const now = opts.now ?? Date.now();
  const since = parseSince(opts.since, now);
  const width = ticketWidth(opts.paper);
  const lang = ticketLang(opts.lang);
  const timeZone = process.env.FOODHUB_TIMEZONE || 'America/Toronto';
  const device = validDeviceId(opts.deviceId) ? opts.deviceId : null;
  const repo = getRepo();

  const [platform, direct] = await Promise.all([
    repo.listOrders({ since: new Date(now - PLATFORM_WINDOW_MS).toISOString(), statuses: ['new', 'accepted', 'cancelled'], locationCodes: [opts.location], limit: 500 }),
    listDirectOrders({ since: new Date(now - DIRECT_WINDOW_MS).toISOString(), limit: 1000, locationCodes: [opts.location] }),
  ]);

  type Draft = Omit<PrintQueueItem, 'printed' | 'ticket'> & { render: () => string };
  const drafts: Draft[] = [];
  for (const o of platform) {
    if (o.locationCode !== opts.location) continue;
    const base = { orderId: o.id, source: 'platform' as const, channel: o.channel, number: platformNumber(o), brandName: o.brandName ?? null, locationCode: opts.location, createdAt: o.createdAt };
    if (platformToCook(o, now) && platformKitchenAt(o) >= since) {
      drafts.push({ ...base, id: `platform:${o.id}:order`, kind: 'order', at: platformKitchenAt(o), render: () => renderKitchenTicket(ticketFromStoredOrder(o), { width, lang, timeZone }) });
    } else if (o.status === 'cancelled' && device) {
      const at = o.timeline?.cancelledAt ?? o.updatedAt;
      if (at >= since) drafts.push({ ...base, id: `platform:${o.id}:cancel`, kind: 'cancel', at, render: () => renderCancelTicket({ platform: platformLabel(o.channel), number: platformNumber(o), brandName: o.brandName, cancelledAt: at, reason: o.timeline?.cancelReason }, { width, lang, timeZone }) });
    }
  }
  for (const o of direct) {
    if (o.locationCode !== opts.location || !KITCHEN_SOURCES.includes(o.source)) continue;
    const base = { orderId: o.id, source: 'direct' as const, channel: o.source, number: o.number, brandName: o.brandName ?? null, locationCode: opts.location, createdAt: o.createdAt };
    if (directToCook(o) && directKitchenAt(o) >= since) {
      drafts.push({ ...base, id: `direct:${o.id}:order`, kind: 'order', at: directKitchenAt(o), render: () => renderKitchenTicket(ticketFromDirectOrder(o, lang), { width, lang, timeZone }) });
    } else if (o.status === 'cancelled' && device) {
      const at = directCancelledAt(o);
      if (at >= since) drafts.push({ ...base, id: `direct:${o.id}:cancel`, kind: 'cancel', at, render: () => renderCancelTicket({ platform: directLabel(o.source, lang), number: o.number, brandName: o.brandName, cancelledAt: at }, { width, lang, timeZone }) });
    }
  }
  drafts.sort((a, b) => a.at.localeCompare(b.at));

  const items: PrintQueueItem[] = [];
  for (const d of drafts) {
    if (items.length >= MAX_ITEMS) break;
    let printed: boolean | null = null;
    if (device) {
      printed = Boolean(await repo.getKv(claimKey(device, d.kind, d.source, d.orderId)));
      // A cancel ticket only for an order this tablet printed (and only once).
      if (d.kind === 'cancel' && (printed || !(await repo.getKv(claimKey(device, 'order', d.source, d.orderId))))) continue;
    }
    const { render, ...rest } = d;
    items.push({ ...rest, printed, ticket: render() });
  }
  return { items, since, serverTime: new Date(now).toISOString(), width, lang };
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
 * { claimed: false, reason: 'already_printed' }.
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
  if (source === 'platform') {
    await repo.addEvent(order.id, kind === 'cancel' ? 'tablet_cancel_printed' : 'tablet_printed', { message: `${kind === 'cancel' ? 'Cancel ticket' : 'Ticket'} printed on the kitchen tablet app`, deviceId: opts.deviceId, by: opts.by }).catch(() => undefined);
  }
  return { claimed: true, id };
}
