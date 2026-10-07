// Own orders and own-courier deliveries.
//
// "Direct orders" are the orders WE take (phone — by a person or the AI agent —, a Clover order with the order type
// "Delivery", our own website, or typed in by hand). They are not platform orders: no marketplace accepts or cancels
// them, so they live in their own collection instead of the platform order table, and never change the platform
// store grid, payouts or commission checks.
// A "delivery" is one courier trip for a direct order, booked on an on-demand fleet (DoorDash Drive first, Uber Direct as
// a comparison quote / fallback). Money is kept in cents on the fleet side and in dollars here, like the rest of Food Hub.
import type { OrderLine } from '../types';

export type DirectSource = 'phone' | 'phone_ai' | 'clover' | 'website' | 'manual';
export type DirectStatus = 'new' | 'in_kitchen' | 'ready' | 'out_for_delivery' | 'completed' | 'cancelled';
/** How the customer pays. Couriers never collect money: a delivery waits until the order is paid (or the owner allows unpaid dispatch). */
export type PaymentState = 'paid' | 'pay_at_pickup' | 'unpaid';

export interface DropoffAddress {
  street: string;
  unit?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  /** Door code, floor, "leave at the door"… — sent to the courier as dropoff instructions. */
  instructions?: string;
  lat?: number;
  lng?: number;
}

export interface DirectLine extends OrderLine {
  /** Contains alcohol (menu tag "alcohol" or a retail product flagged alcohol). */
  alcohol?: boolean;
}

export interface DirectEvent {
  at: string;
  type: string;
  message: string;
  by?: string;
}

export interface DirectOrder {
  id: string;
  /** Short number said to the customer and printed on the Clover ticket. */
  number: string;
  source: DirectSource;
  /** Clover order id, phone call id, website order id… */
  sourceRef?: string;
  brandName: string;
  locationCode: string;
  customer: { name?: string; phone?: string; email?: string; lang?: 'fr' | 'en' };
  fulfillment: 'pickup' | 'delivery';
  dropoff?: DropoffAddress;
  lines: DirectLine[];
  subtotal: number;
  tax: number;
  /** Delivery fee charged to the customer (not what the courier costs us). */
  deliveryFee: number;
  /** Courier tip paid by the customer (passed to the courier in full). */
  tip: number;
  total: number;
  currency: string;
  payment: PaymentState;
  status: DirectStatus;
  notes?: string;
  containsAlcohol: boolean;
  placedAt: string;
  /** When the kitchen expects it ready (prep time). Drives auto-dispatch. */
  readyAt?: string;
  /** For a scheduled order: when the customer wants it. */
  wantedAt?: string;
  posOrderId?: string;
  posError?: string;
  /** The current delivery (one at a time; earlier cancelled ones stay in the deliveries collection). */
  deliveryId?: string;
  /** Set when a person must look (address missing, alcohol blocked, quote too expensive…). Cleared when fixed. */
  attention?: string;
  /** Auto-dispatch attempts (retried every 2 minutes, at most 3 times, then a person decides). */
  autoDispatch?: { attempts: number; lastAt?: string; stoppedReason?: string };
  events: DirectEvent[];
  createdAt: string;
  updatedAt: string;
}

export type FleetKey = 'doordash_drive' | 'uber_direct';

/** Normalised courier status, the same for every fleet. Moves forward only (except to a terminal state). */
export type DeliveryStatus =
  | 'quoted' | 'created' | 'assigned' | 'at_pickup' | 'picked_up' | 'at_dropoff' | 'delivered'
  | 'returning' | 'returned' | 'cancelled' | 'failed';

export const DELIVERY_RANK: Record<DeliveryStatus, number> = {
  quoted: 0, created: 1, assigned: 2, at_pickup: 3, picked_up: 4, at_dropoff: 5, delivered: 9, returning: 6, returned: 9, cancelled: 9, failed: 9,
};
export const TERMINAL: DeliveryStatus[] = ['delivered', 'returned', 'cancelled', 'failed'];
export const ACTIVE: DeliveryStatus[] = ['created', 'assigned', 'at_pickup', 'picked_up', 'at_dropoff', 'returning'];

export interface CourierPosition { name?: string; phone?: string; vehicle?: string; lat?: number; lng?: number; updatedAt: string }

export interface DeliveryQuote {
  fleet: FleetKey;
  ok: boolean;
  /** What the fleet charges us, in dollars (tip excluded). */
  fee?: number;
  currency?: string;
  /** Uber Direct quote id (DoorDash Drive accepts the quote by our own delivery id). */
  quoteId?: string;
  expiresAt?: string;
  pickupEta?: string;
  dropoffEta?: string;
  error?: string;
  /** 'blocked' = not sent (credentials, live switch, platform approval) — never shown as a real price. */
  blocked?: boolean;
  at: string;
}

export interface Delivery {
  /** Our id, sent to the fleet as external_delivery_id / external_id. */
  id: string;
  orderId: string;
  fleet: FleetKey;
  environment: 'sandbox' | 'production';
  /** The fleet's own id when it differs from ours (Uber Direct). */
  fleetDeliveryId?: string;
  status: DeliveryStatus;
  quote?: DeliveryQuote;
  /** Competing quotes collected when this delivery was booked (Drive vs Uber Direct). */
  comparedQuotes?: DeliveryQuote[];
  fee?: number;
  tip: number;
  orderValue: number;
  containsAlcohol: boolean;
  trackingUrl?: string;
  supportReference?: string;
  courier?: CourierPosition;
  pickupEta?: string;
  dropoffEta?: string;
  cancelReason?: string;
  error?: string;
  /** Who asked for the courier: a person's name, or "Auto-dispatch". */
  requestedBy: string;
  /** Customer was texted the tracking link. */
  trackingSmsAt?: string;
  timeline: Array<{ at: string; status: DeliveryStatus | 'note'; message: string }>;
  createdAt: string;
  updatedAt: string;
}

/** Per-location dispatch rules. */
export interface LocationDeliveryRule {
  /** Own deliveries from this kitchen at all. */
  enabled: boolean;
  /** Ask for the courier automatically at "ready time − leadMinutes" (otherwise a person taps "Call a courier"). */
  autoDispatch: boolean;
  leadMinutes: number;
  /** Max straight-line distance (km) when both ends have coordinates; 0 = no limit. */
  maxDistanceKm: number;
  /** Postal-code prefixes served (e.g. "H4A", "H4B"); empty = any. */
  postalPrefixes: string[];
  /** Above this courier fee (dollars) auto-dispatch stops and asks a person; 0 = no limit. */
  maxAutoFee: number;
  /** Kitchen coordinates (for the distance rule). */
  lat?: number;
  lng?: number;
  /** Pickup instructions for the courier ("Side door, ask for the Po Poulet counter"). */
  pickupInstructions?: string;
}

export interface DeliverySettings {
  /** Fleet asked first. */
  primaryFleet: FleetKey;
  /** Also ask the other fleet for a price and keep the cheaper one (only fleets that are configured). */
  compareQuotes: boolean;
  /** Default tip (dollars) when the customer did not give one — DoorDash Drive expects a tip on most deliveries. */
  defaultTip: number;
  /** Delivery fee charged to the customer on phone / manual orders. */
  customerFee: number;
  /** Text the customer the tracking link when a courier is assigned. */
  smsTracking: boolean;
  /** Allow sending a courier for an order that is not paid yet (couriers never collect money). Off by default. */
  allowUnpaidDispatch: boolean;
  /** Undeliverable: return the food to the kitchen, or leave it / dispose. */
  undeliverable: 'return_to_pickup' | 'dispose';
  /** Read Clover orders whose order type says "Delivery" / "Livraison" (not a platform) as direct orders. */
  readCloverDeliveryOrders: boolean;
  locations: Record<string, LocationDeliveryRule>;
  updatedAt?: string;
}

export const DEFAULT_RULE: LocationDeliveryRule = {
  enabled: false, autoDispatch: false, leadMinutes: 10, maxDistanceKm: 8, postalPrefixes: [], maxAutoFee: 15,
};

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  primaryFleet: 'doordash_drive', compareQuotes: true, defaultTip: 3, customerFee: 4.99, smsTracking: true,
  allowUnpaidDispatch: false, undeliverable: 'return_to_pickup', readCloverDeliveryOrders: true, locations: {},
};
