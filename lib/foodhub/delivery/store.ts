// Persistence for direct orders, deliveries and the dispatch rules (generic fh_docs / fh_kv store — no new tables).
import crypto from 'node:crypto';
import { nowIso, round2 } from '../config';
import { getRepo } from '../repo';
import {
  DEFAULT_DELIVERY_SETTINGS, DEFAULT_RULE, type Delivery, type DeliverySettings, type DirectEvent, type DirectOrder, type DirectSource, type LocationDeliveryRule,
} from './types';

export const DIRECT_ORDERS = 'direct_orders';
export const DELIVERIES = 'deliveries';
const SETTINGS_KEY = 'delivery_settings_v1';
const SEQ_KEY = 'direct_order_seq';

const PREFIX: Record<DirectSource, string> = { phone: 'T', phone_ai: 'IA', clover: 'C', website: 'W', manual: 'M', clover_online: 'WEB' };

/** Short number said on the phone and printed on the ticket: T-1042, IA-1043, C-1044… */
export async function nextOrderNumber(source: DirectSource): Promise<string> {
  const repo = getRepo();
  const cur = (await repo.getKv<number>(SEQ_KEY).catch(() => null)) ?? 1000;
  const next = cur + 1;
  await repo.setKv(SEQ_KEY, next).catch(() => undefined);
  return `${PREFIX[source]}-${next}`;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

export async function saveDirectOrder(order: DirectOrder): Promise<DirectOrder> {
  const next = { ...order, updatedAt: nowIso() };
  await getRepo().putDocs<DirectOrder>(DIRECT_ORDERS, [{ id: next.id, key: next.sourceRef ? `${next.source}:${next.sourceRef}` : next.locationCode, at: next.createdAt, data: next }]);
  return next;
}

export async function getDirectOrder(id: string): Promise<DirectOrder | null> {
  return (await getRepo().getDoc<DirectOrder>(DIRECT_ORDERS, id))?.data ?? null;
}

/** The order already made from this source (a Clover order read twice, a call that placed its order). */
export async function findDirectOrderBySource(source: DirectSource, sourceRef: string): Promise<DirectOrder | null> {
  const docs = await getRepo().listDocs<DirectOrder>(DIRECT_ORDERS, { keys: [`${source}:${sourceRef}`], limit: 1 });
  return docs[0]?.data ?? null;
}

export async function listDirectOrders(opts: { since?: string; limit?: number; locationCodes?: string[] } = {}): Promise<DirectOrder[]> {
  const docs = await getRepo().listDocs<DirectOrder>(DIRECT_ORDERS, { since: opts.since, limit: opts.limit ?? 500 });
  const list = docs.map((d) => d.data);
  return opts.locationCodes?.length ? list.filter((o) => opts.locationCodes!.includes(o.locationCode)) : list;
}

export async function addDirectEvent(order: DirectOrder, type: string, message: string, by?: string, patch: Partial<DirectOrder> = {}): Promise<DirectOrder> {
  // Re-read so two writers (courier webhook + a person's click) keep each other's events.
  const cur = (await getDirectOrder(order.id)) ?? order;
  const ev: DirectEvent = { at: nowIso(), type, message, ...(by ? { by } : {}) };
  return saveDirectOrder({ ...cur, ...patch, events: [...(cur.events ?? []), ev].slice(-200) });
}

const fleetRefKey = (fleetId: string) => `delivery_fleet_ref:${fleetId}`;

export async function saveDelivery(d: Delivery): Promise<Delivery> {
  const next = { ...d, updatedAt: nowIso() };
  const repo = getRepo();
  await repo.putDocs<Delivery>(DELIVERIES, [{ id: next.id, key: next.orderId, at: next.createdAt, data: next }]);
  // The fleet's own id (Uber Direct) → ours, so its webhooks find the delivery.
  if (next.fleetDeliveryId && next.fleetDeliveryId !== next.id) await repo.setKv(fleetRefKey(next.fleetDeliveryId), next.id).catch(() => undefined);
  return next;
}

export async function getDelivery(id: string): Promise<Delivery | null> {
  return (await getRepo().getDoc<Delivery>(DELIVERIES, id))?.data ?? null;
}

/** By our id first, then by the fleet's own id (Uber Direct sends its delivery id). */
export async function findDelivery(ref: string): Promise<Delivery | null> {
  if (!ref) return null;
  const own = await getDelivery(ref);
  if (own) return own;
  const ours = await getRepo().getKv<string>(fleetRefKey(ref)).catch(() => null);
  return ours ? getDelivery(ours) : null;
}

export async function listDeliveries(opts: { since?: string; limit?: number } = {}): Promise<Delivery[]> {
  return (await getRepo().listDocs<Delivery>(DELIVERIES, { since: opts.since, limit: opts.limit ?? 500 })).map((d) => d.data);
}

export async function deliveriesForOrder(orderId: string): Promise<Delivery[]> {
  return (await getRepo().listDocs<Delivery>(DELIVERIES, { keys: [orderId], limit: 20 })).map((d) => d.data).filter((d) => d.orderId === orderId);
}

// ---------- settings ----------

const num = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export function cleanRule(raw: Partial<LocationDeliveryRule> | undefined): LocationDeliveryRule {
  const r = { ...DEFAULT_RULE, ...(raw ?? {}) };
  const coord = (v: unknown, lim: number) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) || Math.abs(Number(v)) > lim ? undefined : Number(v));
  return {
    enabled: Boolean(r.enabled),
    autoDispatch: Boolean(r.autoDispatch),
    leadMinutes: Math.round(num(r.leadMinutes, DEFAULT_RULE.leadMinutes, 0, 60)),
    maxDistanceKm: num(r.maxDistanceKm, DEFAULT_RULE.maxDistanceKm, 0, 50),
    postalPrefixes: (Array.isArray(r.postalPrefixes) ? r.postalPrefixes : String(r.postalPrefixes ?? '').split(/[\s,;]+/))
      .map((p) => String(p).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)).filter(Boolean).slice(0, 200),
    maxAutoFee: round2(num(r.maxAutoFee, DEFAULT_RULE.maxAutoFee, 0, 500)),
    lat: coord(r.lat, 90),
    lng: coord(r.lng, 180),
    pickupInstructions: r.pickupInstructions ? String(r.pickupInstructions).slice(0, 280) : undefined,
  };
}

export function cleanSettings(raw: Partial<DeliverySettings> | null | undefined): DeliverySettings {
  const s = { ...DEFAULT_DELIVERY_SETTINGS, ...(raw ?? {}) };
  const locations: Record<string, LocationDeliveryRule> = {};
  for (const [code, rule] of Object.entries(s.locations ?? {})) if (/^[A-Z0-9_]{2,30}$/.test(code)) locations[code] = cleanRule(rule);
  return {
    primaryFleet: s.primaryFleet === 'uber_direct' ? 'uber_direct' : 'doordash_drive',
    compareQuotes: Boolean(s.compareQuotes),
    defaultTip: round2(num(s.defaultTip, DEFAULT_DELIVERY_SETTINGS.defaultTip, 0, 100)),
    customerFee: round2(num(s.customerFee, DEFAULT_DELIVERY_SETTINGS.customerFee, 0, 100)),
    smsTracking: Boolean(s.smsTracking),
    allowUnpaidDispatch: Boolean(s.allowUnpaidDispatch),
    undeliverable: s.undeliverable === 'dispose' ? 'dispose' : 'return_to_pickup',
    readCloverDeliveryOrders: Boolean(s.readCloverDeliveryOrders),
    locations,
    updatedAt: s.updatedAt,
  };
}

export async function getDeliverySettings(): Promise<DeliverySettings> {
  return cleanSettings(await getRepo().getKv<DeliverySettings>(SETTINGS_KEY).catch(() => null));
}

export async function saveDeliverySettings(patch: Partial<DeliverySettings>): Promise<DeliverySettings> {
  const cur = await getDeliverySettings();
  const next = cleanSettings({ ...cur, ...patch, locations: { ...cur.locations, ...(patch.locations ?? {}) }, updatedAt: nowIso() });
  await getRepo().setKv(SETTINGS_KEY, next);
  return next;
}

export function ruleFor(settings: DeliverySettings, locationCode: string): LocationDeliveryRule {
  return settings.locations[locationCode] ?? { ...DEFAULT_RULE };
}
