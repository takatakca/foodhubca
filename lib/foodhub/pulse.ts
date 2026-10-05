// The live pulse every open screen polls (every 4 s): new orders for the pop-up, lane counts, store and
// tablet health, open incidents. Reads stored data only — no platform calls — and gives the Watchtower
// a heartbeat (at most every 20 s across all screens).
import { liveConnectorsGloballyEnabled, round2 } from './config';
import { deadlineFor } from './deadline';
import { deviceStatus, listDevices } from './identity/devices';
import { allowedActions } from './pipeline';
import { getPrepSettings, DEFAULT_PREP } from './prep';
import { getRepo } from './repo';
import { isWaitingScheduled } from './scheduling';
import { startOfLocalDayMs } from './time';
import type { PlatformStatus, StoredOrder } from './types';
import { customerContact } from './watch/customer';
import { INCIDENTS } from './watch/engine';
import type { Incident } from './watch/types';

const OPEN: StoredOrder['status'][] = ['new', 'accepted', 'ready', 'dispatched'];

/** What the pop-up needs: everything to decide in one look. */
export function liveOrder(o: StoredOrder, now = Date.now()) {
  const c = customerContact(o);
  return {
    id: o.id, channel: o.channel, displayId: o.displayId || o.externalOrderId.slice(0, 8), externalOrderId: o.externalOrderId,
    brandName: o.brandName ?? null, locationCode: o.locationCode ?? null, status: o.status, fulfillment: o.fulfillment,
    customerName: o.customerName ?? null, customerTel: c.tel, createdAt: o.createdAt, placedAt: o.placedAt,
    total: o.total, subtotal: o.subtotal, tax: o.tax, tip: o.tip, deliveryFee: o.deliveryFee, discount: o.discount,
    notes: o.notes ?? null, lines: o.lines.map((l) => ({ name: l.name, quantity: l.quantity, total: l.total, notes: l.notes ?? null, modifiers: l.modifiers.map((m) => ({ name: m.name, quantity: m.quantity })) })),
    deadlineAt: o.status === 'new' ? deadlineFor(o) : null,
    readyTarget: o.timeline?.readyTarget ?? null, acceptedAt: o.timeline?.acceptedAt ?? null, acceptedBy: o.timeline?.acceptedBy ?? null, readyAt: o.timeline?.readyAt ?? null,
    seenAt: o.timeline?.seenAt ?? null, scheduledFor: o.timeline?.scheduledFor ?? null, fireAt: o.timeline?.fireAt ?? null, waitingScheduled: isWaitingScheduled(o, now),
    delayedMinutes: o.timeline?.delayedMinutes ?? 0, courier: o.timeline?.courier ?? null,
    posOrderId: o.posOrderId ?? null, posError: o.posError ?? null, channelError: o.channelError ?? null, printedAt: o.timeline?.printedAt ?? null,
    actions: allowedActions(o),
  };
}
export type LiveOrder = ReturnType<typeof liveOrder>;

export async function buildPulse(opts: { locationCodes?: string[]; now?: number } = {}) {
  const now = opts.now ?? Date.now();
  const scope = opts.locationCodes?.length ? opts.locationCodes : undefined;
  const inScope = (code?: string | null) => !scope || (!!code && scope.includes(code));
  const repo = getRepo();
  const dayStart = startOfLocalDayMs(now);

  const [orders, stores, incidentsDocs, devices, sync, prep] = await Promise.all([
    repo.listOrders({ since: new Date(Math.min(dayStart, now - 6 * 3600_000)).toISOString(), limit: 1500, locationCodes: scope }),
    repo.listStores(),
    repo.listDocs<Incident>(INCIDENTS, { since: new Date(now - 3 * 86400_000).toISOString(), limit: 1000 }),
    listDevices(),
    repo.getKv<{ at: string }>('sync:last').catch(() => null),
    getPrepSettings(),
  ]);
  const today = orders.filter((o) => Date.parse(o.createdAt) >= dayStart);
  const counted = today.filter((o) => o.status !== 'cancelled');
  // Pop-up: every new order, plus auto-accepted orders nobody has looked at yet (last 3 hours).
  const incoming = orders
    .filter((o) => !isWaitingScheduled(o, now) && (o.status === 'new' || (o.status === 'accepted' && !o.timeline?.seenAt && now - Date.parse(o.createdAt) < 3 * 3600_000)))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, 20)
    .map((o) => liveOrder(o, now));
  // Cancelled by the customer or the platform in the last 30 min, not yet confirmed by the kitchen:
  // a red alarm on every screen so nobody keeps cooking (or hands food to a courier) for nothing.
  const cancelAlerts = orders
    .filter((o) => o.status === 'cancelled' && o.timeline?.cancelledBy && o.timeline.cancelledBy !== 'store' && !o.timeline.cancelSeenAt
      && now - Date.parse(o.timeline.cancelledAt ?? o.updatedAt) < 30 * 60_000)
    .sort((a, b) => (b.timeline?.cancelledAt ?? '').localeCompare(a.timeline?.cancelledAt ?? ''))
    .slice(0, 10)
    .map((o) => ({
      id: o.id, channel: o.channel, displayId: o.displayId || o.externalOrderId.slice(0, 8), brandName: o.brandName ?? null, locationCode: o.locationCode ?? null,
      total: o.total, cancelledAt: o.timeline?.cancelledAt ?? o.updatedAt, cancelledBy: o.timeline?.cancelledBy ?? 'platform', reason: o.timeline?.cancelReason ?? null,
      wasCooking: Boolean(o.timeline?.acceptedAt), items: o.lines.reduce((s, l) => s + l.quantity, 0), posOrderId: o.posOrderId ?? null, posClosed: Boolean(o.timeline?.posClosedAt),
    }));

  const myStores = stores.filter((s) => inScope(s.locationCode));
  const state = (s: (typeof stores)[number]) => (s.meta?.platformStatus as PlatformStatus | undefined)?.state ?? (s.online ? 'online' : 'paused');
  const incidents = incidentsDocs.map((d) => d.data).filter((i) => (i.status === 'open' || i.status === 'acknowledged') && (!scope || !i.locationCode || scope.includes(i.locationCode)));
  const myDevices = devices.filter((d) => !d.revoked && inScope(d.locationCode));
  const sev = { critical: 0, warning: 1, info: 2 } as const;

  return {
    at: new Date(now).toISOString(),
    live: liveConnectorsGloballyEnabled(),
    mode: repo.mode,
    lastSyncAt: sync?.at ?? null,
    incoming,
    cancelAlerts,
    orders: {
      new: today.filter((o) => o.status === 'new').length,
      preparing: orders.filter((o) => o.status === 'accepted' && !isWaitingScheduled(o, now)).length,
      ready: orders.filter((o) => o.status === 'ready').length,
      out: orders.filter((o) => o.status === 'dispatched').length,
      scheduled: orders.filter((o) => isWaitingScheduled(o, now)).length,
      open: orders.filter((o) => OPEN.includes(o.status)).length,
      today: counted.length,
      sales: round2(counted.reduce((a, o) => a + (Number(o.total) || 0), 0)),
      cancelled: today.filter((o) => o.status === 'cancelled').length,
      late: orders.filter((o) => o.status === 'accepted' && o.timeline?.readyTarget && Date.parse(o.timeline.readyTarget) < now && !isWaitingScheduled(o, now)).length,
    },
    stores: {
      total: myStores.length,
      online: myStores.filter((s) => state(s) === 'online').length,
      paused: myStores.filter((s) => state(s) === 'paused').length,
      closed: myStores.filter((s) => state(s) === 'closed').length,
      deactivated: myStores.filter((s) => state(s) === 'deactivated').length,
    },
    incidents: {
      open: incidents.length,
      critical: incidents.filter((i) => i.severity === 'critical').length,
      top: incidents.sort((a, b) => sev[a.severity] - sev[b.severity] || b.openedAt.localeCompare(a.openedAt)).slice(0, 5)
        .map((i) => ({ id: i.id, kind: i.kind, severity: i.severity, status: i.status, title: i.title, titleEn: i.titleEn, orderId: i.orderId ?? null, openedAt: i.openedAt })),
    },
    devices: {
      total: myDevices.length,
      offline: myDevices.filter((d) => deviceStatus(d, now) === 'offline').length,
      list: myDevices.map((d) => ({ id: d.id, name: d.name, locationCode: d.locationCode, status: deviceStatus(d, now), lastSeenAt: d.lastSeenAt ?? null, soundOn: d.soundOn ?? null, battery: d.battery ?? null })),
    },
    kitchen: Object.fromEntries(Object.entries(prep).map(([code, p]) => { const v = { ...DEFAULT_PREP, ...p }; return [code, { busy: v.isBusy, minutes: v.isBusy ? v.busy : v.normal }]; })),
  };
}

export type Pulse = Awaited<ReturnType<typeof buildPulse>>;
