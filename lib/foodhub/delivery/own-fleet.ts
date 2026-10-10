// Our own couriers: the third fleet next to DoorDash Drive and Uber Direct (docs/ON2GO_HUB_ECOSYSTEM.md § 5).
// Same contract (CourierFleet): a quote is our internal cost per delivery, a booking assigns the delivery to one of our
// couriers on shift for that kitchen (the one with the fewest running deliveries), and the courier moves it forward from
// his page (/courier, delivery/courier-app.ts) through the same applyFleetEvent path as the Drive / Uber Direct webhooks —
// so the order, the kitchen strip and the customer's texts follow by themselves.
//
// Rules kept: couriers never collect money (dispatch checks the payment first); alcohol only where the rules allow it,
// with the ID check (18+); nothing is "delivered" without the courier's tap. No password: each courier opens a personal
// signed link, and "New link" in the console cancels every older one. Nothing here talks to an outside service.
import crypto from 'node:crypto';
import { logActivity, type Actor } from '../activity';
import { nowIso, publicBaseUrl, round2 } from '../config';
import { normalizePhone } from '../notify';
import { getRepo } from '../repo';
import { signCourier, verifyCourier } from '../session';
import { blocked, type CourierFleet, type DeliveryRequest, type FleetResult } from './fleet';
import { getDelivery, listDeliveries } from './store';
import { ACTIVE, type Delivery, type DeliveryQuote } from './types';

export interface OwnCourier {
  id: string;
  name: string;
  /** E.164 — the kitchen and the customer can call him. */
  phone: string;
  /** Kitchens (location codes) he delivers for. */
  locations: string[];
  /** Off = he can no longer open his page or get deliveries. */
  active: boolean;
  /** On shift now: only couriers on shift get deliveries. He switches it on his page; a manager can too. */
  onShift: boolean;
  /** Bumped by "New link": older links stop working. */
  linkVersion: number;
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OwnFleetSettings {
  /** The fleet is offered at all (Settings → Expansion → Our couriers). Off by default. */
  enabled: boolean;
  /** What one delivery costs us (pay per delivery, gas…), in dollars: the "price" compared with Drive / Uber Direct. */
  costPerDelivery: number;
  couriers: OwnCourier[];
  updatedAt?: string;
}

const KEY = 'own_fleet_v1';
export const DEFAULT_OWN_FLEET: OwnFleetSettings = { enabled: false, costPerDelivery: 6, couriers: [] };
const CODE = /^[A-Z0-9_]{2,30}$/;

export function cleanCourier(raw: Partial<OwnCourier>, prev?: OwnCourier): OwnCourier {
  const name = String(raw.name ?? prev?.name ?? '').trim().slice(0, 60);
  if (!name) throw new Error('Courier: a name is needed.');
  const phone = normalizePhone(raw.phone ?? prev?.phone);
  if (!phone) throw new Error(`Courier ${name}: a phone number is needed (the kitchen and the customer call it).`);
  const locations = [...new Set((raw.locations ?? prev?.locations ?? []).map(String).filter((c) => CODE.test(c)))];
  if (!locations.length) throw new Error(`Courier ${name}: choose at least one kitchen.`);
  const at = nowIso();
  return {
    id: prev?.id ?? raw.id ?? `cour_${crypto.randomBytes(5).toString('hex')}`,
    name, phone, locations,
    active: raw.active ?? prev?.active ?? true,
    onShift: Boolean(raw.onShift ?? prev?.onShift ?? false),
    linkVersion: prev?.linkVersion ?? 1,
    ...(prev?.lastSeenAt ? { lastSeenAt: prev.lastSeenAt } : {}),
    createdAt: prev?.createdAt ?? at,
    updatedAt: at,
  };
}

export async function getOwnFleet(): Promise<OwnFleetSettings> {
  const raw = (await getRepo().getKv<Partial<OwnFleetSettings>>(KEY).catch(() => null)) ?? {};
  const cost = Number(raw.costPerDelivery);
  return {
    enabled: Boolean(raw.enabled),
    costPerDelivery: Number.isFinite(cost) && cost >= 0 && cost <= 100 ? round2(cost) : DEFAULT_OWN_FLEET.costPerDelivery,
    couriers: Array.isArray(raw.couriers) ? raw.couriers : [],
    updatedAt: raw.updatedAt,
  };
}

async function write(next: OwnFleetSettings): Promise<OwnFleetSettings> {
  await getRepo().setKv(KEY, { ...next, updatedAt: nowIso() });
  return getOwnFleet();
}

/** Console: turn the fleet on/off, the cost per delivery, add / edit / remove couriers (ids kept, links kept). */
export async function saveOwnFleet(patch: { enabled?: boolean; costPerDelivery?: number; couriers?: Array<Partial<OwnCourier>> }, actor: Actor): Promise<OwnFleetSettings> {
  const cur = await getOwnFleet();
  const couriers = patch.couriers ? patch.couriers.map((c) => cleanCourier(c, cur.couriers.find((x) => x.id === c.id))) : cur.couriers;
  const dup = couriers.find((c, i) => couriers.findIndex((x) => x.phone === c.phone) !== i);
  if (dup) throw new Error(`${dup.name}: this phone number is already used by another courier.`);
  const cost = patch.costPerDelivery !== undefined ? Number(patch.costPerDelivery) : cur.costPerDelivery;
  if (!(Number.isFinite(cost) && cost >= 0 && cost <= 100)) throw new Error('Cost per delivery: between 0 and 100 $.');
  const next = await write({ enabled: patch.enabled ?? cur.enabled, costPerDelivery: round2(cost), couriers });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'own_fleet', status: 'success',
    summary: `Our couriers: ${next.enabled ? 'on' : 'off'}, ${next.couriers.filter((c) => c.active).length} active courier(s), ${next.costPerDelivery.toFixed(2)} $ per delivery` });
  return next;
}

async function patchCourier(id: string, patch: Partial<OwnCourier>): Promise<OwnCourier | null> {
  const cur = await getOwnFleet();
  const c = cur.couriers.find((x) => x.id === id);
  if (!c) return null;
  const next = { ...c, ...patch, updatedAt: nowIso() };
  await write({ ...cur, couriers: cur.couriers.map((x) => (x.id === id ? next : x)) });
  return next;
}

export const setShift = (id: string, onShift: boolean) => patchCourier(id, { onShift });

/** A new personal link for this courier: every older link stops working. The link carries the token in the fragment
 *  (#t=…), which browsers never send to a server or put in a Referer. */
export async function newCourierLink(id: string): Promise<string> {
  const cur = await getOwnFleet();
  const c = cur.couriers.find((x) => x.id === id);
  if (!c) throw new Error('Unknown courier.');
  const next = await patchCourier(id, { linkVersion: c.linkVersion + 1 });
  const token = await signCourier(id, next!.linkVersion);
  return `${publicBaseUrl()}/courier#t=${token}`;
}

/** The courier behind a link — only while he is active and the link is his latest one. */
export async function courierFromToken(token: string | null | undefined): Promise<OwnCourier | null> {
  const p = await verifyCourier(token);
  if (!p) return null;
  const c = (await getOwnFleet()).couriers.find((x) => x.id === p.c);
  if (!c || !c.active || c.linkVersion !== p.v) return null;
  return c;
}

export async function touchCourier(id: string): Promise<void> {
  await patchCourier(id, { lastSeenAt: nowIso() }).catch(() => undefined);
}

/** Deliveries assigned to this courier that are still running. */
export async function runningFor(courierId: string, list?: Delivery[]): Promise<Delivery[]> {
  const all = list ?? (await listDeliveries({ since: new Date(Date.now() - 2 * 86400_000).toISOString(), limit: 1000 }));
  return all.filter((d) => d.fleet === 'own_fleet' && d.ownCourierId === courierId && ACTIVE.includes(d.status));
}

/** The courier on shift for this kitchen with the fewest running deliveries (null = nobody on shift there). */
export async function pickCourier(locationCode: string, s?: OwnFleetSettings): Promise<OwnCourier | null> {
  const fleet = s ?? (await getOwnFleet());
  const here = fleet.couriers.filter((c) => c.active && c.onShift && c.locations.includes(locationCode));
  if (!here.length) return null;
  const list = await listDeliveries({ since: new Date(Date.now() - 2 * 86400_000).toISOString(), limit: 1000 });
  const load = await Promise.all(here.map(async (c) => ({ c, n: (await runningFor(c.id, list)).length })));
  return load.sort((a, b) => a.n - b.n || a.c.name.localeCompare(b.c.name))[0].c;
}

const OFF = 'Our couriers are turned off (Settings → Expansion → Our couriers).';

export const ownFleet: CourierFleet = {
  key: 'own_fleet',
  label: 'Our couriers',
  readiness() {
    return {
      fleet: 'own_fleet', label: 'Our couriers', configured: true, canSend: true, environment: 'production', missing: [],
      note: 'Our own couriers: turn the fleet on, add couriers and send each one his personal link (Settings → Expansion → Our couriers). Nothing goes to an outside service.',
      noteFr: 'Nos propres livreurs : allumez la flotte, ajoutez les livreurs et envoyez à chacun son lien personnel (Réglages → Expansion → Nos livreurs). Rien ne part vers un service externe.',
      webhookPath: '/courier',
    };
  },
  async quote(req: DeliveryRequest): Promise<DeliveryQuote> {
    const at = nowIso();
    const s = await getOwnFleet();
    if (!s.enabled) return { fleet: 'own_fleet', ok: false, blocked: true, error: OFF, at };
    const c = await pickCourier(req.pickup.locationCode, s);
    if (!c) return { fleet: 'own_fleet', ok: false, error: `None of our couriers is on shift for ${req.pickup.locationCode}.`, at };
    return { fleet: 'own_fleet', ok: true, fee: s.costPerDelivery, currency: req.currency, at };
  },
  async create(req: DeliveryRequest): Promise<FleetResult> {
    const s = await getOwnFleet();
    if (!s.enabled) return blocked(OFF);
    const c = await pickCourier(req.pickup.locationCode, s);
    if (!c) return { ok: false, status: 'error', message: `None of our couriers is on shift for ${req.pickup.locationCode}.` };
    return {
      ok: true, status: 'done', message: `Assigned to ${c.name}.`, deliveryStatus: 'assigned', fee: s.costPerDelivery,
      courier: { name: c.name, phone: c.phone, updatedAt: nowIso() }, assignedCourierId: c.id,
    };
  },
  async get(id: string): Promise<FleetResult> {
    const d = await getDelivery(id);
    return d ? { ok: true, status: 'done', message: d.status, deliveryStatus: d.status, courier: d.courier } : { ok: false, status: 'error', message: 'Unknown delivery.' };
  },
  async cancel(): Promise<FleetResult> {
    // Nothing to call: the courier's page shows the delivery as cancelled at its next refresh.
    return { ok: true, status: 'done', message: 'Cancelled — the courier’s page shows it.', deliveryStatus: 'cancelled' };
  },
  verifyWebhook: () => false,
  parseWebhook: () => null,
};
