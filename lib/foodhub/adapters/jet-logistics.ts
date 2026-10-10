// Just Eat Takeaway / SkipTheDishes "logistics" operations of the published specification
// (https://uk.api.just-eat.io/docs/openapi.yaml): the calls a delivery supplier (a restaurant group that runs its own
// couriers, or a courier fleet partner) makes to JET. They are not part of the JET Connect POS contract and use the
// partner API key instead of X-Flyt-Api-Key:
//
//   Authorization: JE-API-KEY <key>          (SKIP_PARTNER_API_KEY)
//   Base URL: the regional JET host JET gives you (SKIP_PARTNER_API_BASE_URL) — the spec lists
//             uk.api.just-eat.io, i18n.api.just-eat.io and aus.api.just-eat.io, none for Canada, so nothing is guessed.
//
//   Delivery pools   GET/POST /delivery/pools · GET/PUT/PATCH /delivery/pools/{id} · PUT /delivery/pools/{id}/hours
//                    GET/PUT /delivery/pools/{id}/availability/relative · POST …/change-risk · GET …/status
//                    POST/DELETE …/offline-events · PUT/DELETE …/restaurants · PUT /restaurants/driver/eta
//   Order delivery   PUT /orders/{orderId}/deliverystate/{driverassigned|driverunassigned|atrestauranteta|atrestaurant|
//                    onitsway|atdeliveryaddress|delivered|driverlocation} · PUT /orders/deliverystate/driverlocation (bulk)
//
// Every call is checked before it is sent (the spec's required fields), goes through the same live switch as the other
// platform calls, and answers with a ChannelResult — never a fake success. Coverage: docs/SKIP_API_COVERAGE.md.
import { callApi, result, stripSlash } from '../config';
import { DAYS } from '../hours';
import type { ChannelResult } from '../types';
import { blockedResult, buildReadiness } from './common';

const KEY = 'skip' as const;

export type JetMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface JetLogisticsOp {
  id: string;
  method: JetMethod;
  /** Path template with {placeholders}. */
  path: string;
  group: 'delivery-pools' | 'order-delivery';
  summary: string;
  /** Path parameters. */
  params: string[];
  /** Required query parameters. */
  query?: string[];
  /** 'none' = no body. */
  body: 'object' | 'array' | 'none';
}

/** The 24 operations. Their ids are the specification's operationIds, so the coverage table can be checked against the spec. */
export const JET_LOGISTICS_OPS: JetLogisticsOp[] = [
  { id: 'deliveryPoolsGet', method: 'GET', path: '/delivery/pools', group: 'delivery-pools', summary: 'Get your delivery pools', params: [], body: 'none' },
  { id: 'deliveryPoolsPost', method: 'POST', path: '/delivery/pools', group: 'delivery-pools', summary: 'Create a new delivery pool', params: [], body: 'object' },
  { id: 'deliveryPoolsDeliveryPoolIdGet', method: 'GET', path: '/delivery/pools/{deliveryPoolId}', group: 'delivery-pools', summary: 'Get an individual delivery pool', params: ['deliveryPoolId'], body: 'none' },
  { id: 'deliveryPoolsDeliveryPoolIdPut', method: 'PUT', path: '/delivery/pools/{deliveryPoolId}', group: 'delivery-pools', summary: 'Replace an existing delivery pool', params: ['deliveryPoolId'], body: 'object' },
  { id: 'deliveryPoolsDeliveryPoolIdPatch', method: 'PATCH', path: '/delivery/pools/{deliveryPoolId}', group: 'delivery-pools', summary: 'Modify a delivery pool', params: ['deliveryPoolId'], body: 'object' },
  { id: 'deliveryPoolsDeliveryPoolIdHoursPut', method: 'PUT', path: '/delivery/pools/{deliveryPoolId}/hours', group: 'delivery-pools', summary: 'Set the delivery pools daily start and end times', params: ['deliveryPoolId'], body: 'object' },
  { id: 'deliveryPoolsDeliveryPoolIdAvailabilityRelativeGet', method: 'GET', path: '/delivery/pools/{deliveryPoolId}/availability/relative', group: 'delivery-pools', summary: 'Get availability for pickup', params: ['deliveryPoolId'], body: 'none' },
  { id: 'deliveryPoolsDeliveryPoolIdAvailabilityRelativePut', method: 'PUT', path: '/delivery/pools/{deliveryPoolId}/availability/relative', group: 'delivery-pools', summary: 'Set availability for pickup', params: ['deliveryPoolId'], body: 'object' },
  { id: 'deliveryPoolsDeliveryPoolIdChangeRiskPost', method: 'POST', path: '/delivery/pools/{deliveryPoolId}/change-risk', group: 'delivery-pools', summary: 'Update delivery pool risk signal', params: ['deliveryPoolId'], body: 'object' },
  { id: 'deliveryPoolsDeliveryPoolIdStatusGet', method: 'GET', path: '/delivery/pools/{deliveryPoolId}/status', group: 'delivery-pools', summary: 'Get status of delivery pool', params: ['deliveryPoolId'], body: 'none' },
  { id: 'deliveryPoolsDeliveryPoolIdOfflineEventsPost', method: 'POST', path: '/delivery/pools/{deliveryPoolId}/offline-events', group: 'delivery-pools', summary: 'Take delivery pool offline', params: ['deliveryPoolId'], body: 'object' },
  { id: 'deliveryPoolsDeliveryPoolIdOfflineEventsDelete', method: 'DELETE', path: '/delivery/pools/{deliveryPoolId}/offline-events', group: 'delivery-pools', summary: 'Delete offline events', params: ['deliveryPoolId'], query: ['reason'], body: 'none' },
  { id: 'deliveryPoolsDeliveryPoolIdRestaurantsPut', method: 'PUT', path: '/delivery/pools/{deliveryPoolId}/restaurants', group: 'delivery-pools', summary: 'Add restaurants to an existing delivery pool', params: ['deliveryPoolId'], body: 'object' },
  { id: 'deliveryPoolsDeliveryPoolIdRestaurantsDelete', method: 'DELETE', path: '/delivery/pools/{deliveryPoolId}/restaurants', group: 'delivery-pools', summary: 'Remove restaurants from a delivery pool', params: ['deliveryPoolId'], body: 'object' },
  { id: 'restaurantsDriverEtaPut', method: 'PUT', path: '/restaurants/driver/eta', group: 'delivery-pools', summary: 'Set ETA for pickup', params: [], body: 'array' },
  { id: 'ordersOrderIdDeliverystateDriverassignedPut', method: 'PUT', path: '/orders/{orderId}/deliverystate/driverassigned', group: 'order-delivery', summary: 'Update order with driver assigned details', params: ['orderId'], body: 'object' },
  { id: 'ordersOrderIdDeliverystateDriverunassignedPut', method: 'PUT', path: '/orders/{orderId}/deliverystate/driverunassigned', group: 'order-delivery', summary: 'Update order with driver unassigned details', params: ['orderId'], body: 'object' },
  { id: 'ordersOrderIdDeliverystateAtrestaurantetaPut', method: 'PUT', path: '/orders/{orderId}/deliverystate/atrestauranteta', group: 'order-delivery', summary: "Update the driver's estimated time to arrive at the Restaurant", params: ['orderId'], body: 'object' },
  { id: 'ordersOrderIdDeliverystateAtrestaurantPut', method: 'PUT', path: '/orders/{orderId}/deliverystate/atrestaurant', group: 'order-delivery', summary: 'Update order with driver at restaurant details', params: ['orderId'], body: 'object' },
  { id: 'ordersOrderIdDeliverystateOnitswayPut', method: 'PUT', path: '/orders/{orderId}/deliverystate/onitsway', group: 'order-delivery', summary: 'Update order with driver on its way details', params: ['orderId'], body: 'object' },
  { id: 'ordersOrderIdDeliverystateAtdeliveryaddressPut', method: 'PUT', path: '/orders/{orderId}/deliverystate/atdeliveryaddress', group: 'order-delivery', summary: 'Update order with driver at delivery address details', params: ['orderId'], body: 'object' },
  { id: 'ordersOrderIdDeliverystateDeliveredPut', method: 'PUT', path: '/orders/{orderId}/deliverystate/delivered', group: 'order-delivery', summary: 'Update order with delivered details', params: ['orderId'], body: 'object' },
  { id: 'ordersOrderIdDeliverystateDriverlocationPut', method: 'PUT', path: '/orders/{orderId}/deliverystate/driverlocation', group: 'order-delivery', summary: "Update the driver's current location", params: ['orderId'], body: 'object' },
  { id: 'ordersDeliverystateDriverlocationPut', method: 'PUT', path: '/orders/deliverystate/driverlocation', group: 'order-delivery', summary: 'Update current driver locations (bulk upload)', params: [], body: 'array' },
];

const OPS = new Map(JET_LOGISTICS_OPS.map((o) => [o.id, o]));
export const jetLogisticsOp = (id: string) => OPS.get(id);

function base() { return stripSlash(process.env.SKIP_PARTNER_API_BASE_URL || ''); }

export function jetLogisticsReadiness() {
  return buildReadiness(KEY, ['SKIP_PARTNER_API_KEY', 'SKIP_PARTNER_API_BASE_URL'], {
    note: 'Delivery pools and order delivery updates (JET delivery-supplier API). JET gives the partner API key and the regional host.',
    noteFr: 'Bassins de livraison et suivi de livraison (API fournisseur de livraison de JET). JET fournit la clé partenaire et l’hôte régional.',
  });
}

const isObj = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const HHMMSS = /^\d{2}:[0-5]\d:[0-5]\d$/;
const isTime = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const lat = (v: unknown) => typeof v === 'number' && v >= -90 && v <= 90;
const lon = (v: unknown) => typeof v === 'number' && v >= -180 && v <= 180;

function validLocation(loc: unknown, required: boolean): string | null {
  if (loc === undefined || loc === null) return required ? 'Location is required.' : null;
  if (!isObj(loc) || !lat(loc.Latitude) || !lon(loc.Longitude)) return 'Location needs Latitude (-90..90) and Longitude (-180..180).';
  return null;
}

/** The documented required fields of each operation, in plain words. null = fine. */
export function validateJetLogisticsBody(id: string, body: unknown): string | null {
  switch (id) {
    case 'deliveryPoolsPost': case 'deliveryPoolsDeliveryPoolIdPut':
      return isObj(body) && String(body.name ?? '').trim() ? null : 'A pool needs a name.';
    case 'deliveryPoolsDeliveryPoolIdPatch':
      return isObj(body) && (body.name !== undefined || body.restaurants !== undefined) ? null : 'Send a new name, new restaurants, or both.';
    case 'deliveryPoolsDeliveryPoolIdRestaurantsPut': case 'deliveryPoolsDeliveryPoolIdRestaurantsDelete':
      return isObj(body) && Array.isArray(body.restaurants) && body.restaurants.length && body.restaurants.every((r: unknown) => Number.isInteger(r)) ? null : 'restaurants must be a list of Just Eat restaurant ids (whole numbers).';
    case 'deliveryPoolsDeliveryPoolIdAvailabilityRelativePut':
      return isObj(body) && typeof body.bestGuess === 'string' && HHMMSS.test(body.bestGuess) ? null : 'bestGuess must be hh:mm:ss.';
    case 'deliveryPoolsDeliveryPoolIdChangeRiskPost':
      return isObj(body) && Number.isInteger(body.riskLevel) && body.riskLevel >= 0 && body.riskLevel <= 9 ? null : 'riskLevel must be a whole number from 0 to 9.';
    case 'deliveryPoolsDeliveryPoolIdOfflineEventsPost':
      return isObj(body) && (body.reason === undefined || body.reason === 'manual') ? null : 'The only offline reason is "manual".';
    case 'deliveryPoolsDeliveryPoolIdHoursPut': {
      if (!isObj(body)) return 'Hours for all seven days are required.';
      for (const day of DAYS) {
        const d = body[day];
        if (!isObj(d) || !Array.isArray(d.poolTimes)) return `${day}: poolTimes is required (an empty list with closed:true when the pool does not run).`;
        if (d.poolTimes.length > 1) return `${day}: only one start and end time per day is accepted.`;
        if (!d.closed && !d.poolTimes.length) return `${day}: give the start and end time, or set closed to true.`;
        for (const t of d.poolTimes) if (!isObj(t) || !HHMM.test(String(t.startTime)) || !HHMM.test(String(t.endTime))) return `${day}: startTime and endTime must be HH:mm.`;
      }
      return null;
    }
    case 'restaurantsDriverEtaPut':
      return Array.isArray(body) && body.length && body.every((r) => isObj(r) && String(r.restaurantId ?? '').trim() && Number.isInteger(r.etaAtRestaurant) && r.etaAtRestaurant >= 0) ? null : 'Send a list of { restaurantId, etaAtRestaurant (minutes) }.';
    case 'ordersDeliverystateDriverlocationPut':
      return Array.isArray(body) && body.length && body.every((r) => isObj(r) && r.DriverId && isTime(r.TimeStampWithUtcOffset) && !validLocation(r.Location, true)) ? null : 'Each row needs DriverId, TimeStampWithUtcOffset and a Location with Latitude and Longitude.';
    case 'ordersOrderIdDeliverystateAtrestaurantetaPut':
      return isObj(body) && String(body.driverId ?? '').trim() ? null : 'driverId is required.';
    case 'ordersOrderIdDeliverystateDriverassignedPut':
      return isObj(body) && body.DriverId && isTime(body.TimeStampWithUtcOffset) && isObj(body.VehicleDetails) ? validLocation(body.Location, false) : 'DriverId, TimeStampWithUtcOffset and VehicleDetails are required.';
    case 'ordersOrderIdDeliverystateDriverunassignedPut': case 'ordersOrderIdDeliverystateOnitswayPut': case 'ordersOrderIdDeliverystateAtdeliveryaddressPut': case 'ordersOrderIdDeliverystateDeliveredPut':
      return isObj(body) && body.DriverId && isTime(body.TimeStampWithUtcOffset) ? validLocation(body.Location, false) : 'DriverId and TimeStampWithUtcOffset are required.';
    case 'ordersOrderIdDeliverystateAtrestaurantPut': case 'ordersOrderIdDeliverystateDriverlocationPut':
      return isObj(body) && body.DriverId && isTime(body.TimeStampWithUtcOffset) ? validLocation(body.Location, id.endsWith('DriverlocationPut')) : 'DriverId and TimeStampWithUtcOffset are required.';
    default: return null;
  }
}

export interface JetLogisticsInput { path?: Record<string, string | number>; query?: Record<string, string>; body?: unknown }

/** Builds the request without sending it (used by the tests and by the preview in the console). */
export function buildJetLogisticsRequest(id: string, input: JetLogisticsInput = {}): { method: JetMethod; url: string; body?: string } | { error: string } {
  const op = OPS.get(id);
  if (!op) return { error: `Unknown JET operation "${id}".` };
  let path = op.path;
  for (const p of op.params) {
    const v = input.path?.[p];
    if (v === undefined || v === null || String(v).trim() === '') return { error: `${p} is required.` };
    path = path.replace(`{${p}}`, encodeURIComponent(String(v).trim()));
  }
  const missingQuery = (op.query ?? []).find((q) => !String(input.query?.[q] ?? '').trim());
  if (missingQuery) return { error: `${missingQuery} is required.` };
  if (op.body !== 'none') {
    const bad = validateJetLogisticsBody(id, input.body);
    if (bad) return { error: bad };
  }
  const qs = op.query?.length ? `?${op.query.map((q) => `${encodeURIComponent(q)}=${encodeURIComponent(String(input.query![q]))}`).join('&')}` : '';
  return { method: op.method, url: `${base()}${path}${qs}`, body: op.body === 'none' ? undefined : JSON.stringify(input.body) };
}

/** Runs one logistics operation. */
export async function jetLogisticsCall(id: string, input: JetLogisticsInput = {}): Promise<ChannelResult> {
  const req = buildJetLogisticsRequest(id, input);
  if ('error' in req) return result(KEY, 'error', req.error);
  const r = jetLogisticsReadiness();
  if (!r.canSend) return blockedResult(KEY, r);
  const headers: Record<string, string> = { Authorization: `JE-API-KEY ${process.env.SKIP_PARTNER_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json', 'x-jet-application': 'takatak-foodhub' };
  const op = OPS.get(id)!;
  const res = await callApi(KEY, req.url, { method: req.method, headers, body: req.body }, 'done');
  if (res.httpStatus === 501) return { ...res, ok: false, status: 'error', message: `${op.summary}: JET has not implemented this operation (HTTP 501).` };
  return res.ok ? { ...res, message: `${op.summary}: accepted by JET (HTTP ${res.httpStatus}).` } : res;
}

/** A timestamp as JET wants callbacks: local time with its UTC offset, e.g. 2026-10-09T01:20:00.000-04:00. */
export function jetLocalTimestamp(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).reduce<Record<string, string>>((a, p) => { a[p.type] = p.value; return a; }, {});
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offsetMin = Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${String(ms % 1000).padStart(3, '0')}${sign}${z(Math.floor(abs / 60))}:${z(abs % 60)}`;
}

// --- Named helpers (thin, so a caller reads like the specification) -------------------------------------------------

export const jetPools = {
  list: () => jetLogisticsCall('deliveryPoolsGet'),
  create: (body: { name: string; restaurants?: number[] }) => jetLogisticsCall('deliveryPoolsPost', { body }),
  get: (id: string) => jetLogisticsCall('deliveryPoolsDeliveryPoolIdGet', { path: { deliveryPoolId: id } }),
  replace: (id: string, body: { name: string; restaurants?: number[] }) => jetLogisticsCall('deliveryPoolsDeliveryPoolIdPut', { path: { deliveryPoolId: id }, body }),
  modify: (id: string, body: { name?: string; restaurants?: number[] }) => jetLogisticsCall('deliveryPoolsDeliveryPoolIdPatch', { path: { deliveryPoolId: id }, body }),
  setHours: (id: string, body: Record<string, { poolTimes: Array<{ startTime: string; endTime: string }>; closed?: boolean }>) => jetLogisticsCall('deliveryPoolsDeliveryPoolIdHoursPut', { path: { deliveryPoolId: id }, body }),
  getPickupAvailability: (id: string) => jetLogisticsCall('deliveryPoolsDeliveryPoolIdAvailabilityRelativeGet', { path: { deliveryPoolId: id } }),
  setPickupAvailability: (id: string, bestGuess: string) => jetLogisticsCall('deliveryPoolsDeliveryPoolIdAvailabilityRelativePut', { path: { deliveryPoolId: id }, body: { bestGuess } }),
  changeRisk: (id: string, riskLevel: number) => jetLogisticsCall('deliveryPoolsDeliveryPoolIdChangeRiskPost', { path: { deliveryPoolId: id }, body: { riskLevel } }),
  status: (id: string) => jetLogisticsCall('deliveryPoolsDeliveryPoolIdStatusGet', { path: { deliveryPoolId: id } }),
  takeOffline: (id: string) => jetLogisticsCall('deliveryPoolsDeliveryPoolIdOfflineEventsPost', { path: { deliveryPoolId: id }, body: { reason: 'manual' } }),
  deleteOfflineEvents: (id: string, reason = 'manual') => jetLogisticsCall('deliveryPoolsDeliveryPoolIdOfflineEventsDelete', { path: { deliveryPoolId: id }, query: { reason } }),
  addRestaurants: (id: string, restaurants: number[]) => jetLogisticsCall('deliveryPoolsDeliveryPoolIdRestaurantsPut', { path: { deliveryPoolId: id }, body: { restaurants } }),
  removeRestaurants: (id: string, restaurants: number[]) => jetLogisticsCall('deliveryPoolsDeliveryPoolIdRestaurantsDelete', { path: { deliveryPoolId: id }, body: { restaurants } }),
  setPickupEta: (rows: Array<{ restaurantId: string; etaAtRestaurant: number }>) => jetLogisticsCall('restaurantsDriverEtaPut', { body: rows }),
};

export const jetDelivery = {
  driverAssigned: (orderId: string, body: Record<string, unknown>) => jetLogisticsCall('ordersOrderIdDeliverystateDriverassignedPut', { path: { orderId }, body }),
  driverUnassigned: (orderId: string, body: Record<string, unknown>) => jetLogisticsCall('ordersOrderIdDeliverystateDriverunassignedPut', { path: { orderId }, body }),
  atRestaurantEta: (orderId: string, body: { driverId: string; bestGuess?: string; estimatedAt?: string }) => jetLogisticsCall('ordersOrderIdDeliverystateAtrestaurantetaPut', { path: { orderId }, body }),
  atRestaurant: (orderId: string, body: Record<string, unknown>) => jetLogisticsCall('ordersOrderIdDeliverystateAtrestaurantPut', { path: { orderId }, body }),
  onItsWay: (orderId: string, body: Record<string, unknown>) => jetLogisticsCall('ordersOrderIdDeliverystateOnitswayPut', { path: { orderId }, body }),
  atDeliveryAddress: (orderId: string, body: Record<string, unknown>) => jetLogisticsCall('ordersOrderIdDeliverystateAtdeliveryaddressPut', { path: { orderId }, body }),
  delivered: (orderId: string, body: Record<string, unknown>) => jetLogisticsCall('ordersOrderIdDeliverystateDeliveredPut', { path: { orderId }, body }),
  driverLocation: (orderId: string, body: Record<string, unknown>) => jetLogisticsCall('ordersOrderIdDeliverystateDriverlocationPut', { path: { orderId }, body }),
  driverLocations: (rows: Array<Record<string, unknown>>) => jetLogisticsCall('ordersDeliverystateDriverlocationPut', { body: rows }),
};
