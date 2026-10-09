// The courier fleets behind "Call a courier": one contract, three implementations (DoorDash Drive, Uber Direct, and our own
// couriers — delivery/own-fleet.ts).
import type { CourierPosition, DeliveryQuote, DeliveryStatus, DropoffAddress, FleetKey } from './types';

/** Address parts for fleets that want them structured (Uber Direct). */
export type AddressParts = Pick<DropoffAddress, 'street' | 'unit' | 'city' | 'province' | 'postalCode' | 'country'>;

/** Everything a fleet needs to price and send a courier. Money in dollars here; each fleet converts to cents. */
export interface DeliveryRequest {
  /** Our delivery id (external_delivery_id / external_id). */
  id: string;
  pickup: { businessName: string; address: string; parts?: AddressParts; phone: string; instructions?: string; locationCode: string };
  dropoff: { name: string; givenName?: string; familyName?: string; address: string; parts?: AddressParts; phone: string; instructions?: string; lat?: number; lng?: number; businessName?: string };
  orderValue: number;
  tip: number;
  currency: string;
  items: Array<{ name: string; quantity: number; price?: number; externalId?: string; description?: string }>;
  /** Ready for pickup at (ISO). Absent = as soon as possible. */
  pickupAt?: string;
  containsAlcohol: boolean;
  /** Minimum age to check at the door (alcohol). */
  minAge?: number;
  /** Undeliverable: bring it back, or leave / dispose. */
  undeliverable: 'return_to_pickup' | 'dispose';
  /** Order number the kitchen and the courier both see. */
  reference: string;
  /** Let the fleet text the customer its own status messages too. */
  fleetSms: boolean;
}

export interface FleetResult {
  ok: boolean;
  /** 'blocked' = nothing was sent (missing credentials, live switch off in production, needs platform approval). */
  status: 'done' | 'blocked' | 'error';
  message: string;
  httpStatus?: number;
  fleetDeliveryId?: string;
  deliveryStatus?: DeliveryStatus;
  fee?: number;
  trackingUrl?: string;
  supportReference?: string;
  pickupEta?: string;
  dropoffEta?: string;
  courier?: CourierPosition;
  /** Our own fleet: the courier the delivery was assigned to. */
  assignedCourierId?: string;
  raw?: unknown;
}

export interface FleetReadiness {
  fleet: FleetKey;
  label: string;
  configured: boolean;
  canSend: boolean;
  environment: 'sandbox' | 'production';
  missing: string[];
  note: string;
  noteFr: string;
  webhookPath: string;
}

/** A status event pushed by a fleet webhook, normalised. */
export interface FleetEvent {
  fleet: FleetKey;
  /** Our delivery id when the fleet echoes it, else the fleet's id. */
  ref: string;
  fleetDeliveryId?: string;
  status: DeliveryStatus | null;
  event: string;
  at: string;
  fee?: number;
  trackingUrl?: string;
  supportReference?: string;
  pickupEta?: string;
  dropoffEta?: string;
  courier?: CourierPosition;
  cancelReason?: string;
}

export interface CourierFleet {
  key: FleetKey;
  label: string;
  readiness(): FleetReadiness;
  quote(req: DeliveryRequest): Promise<DeliveryQuote>;
  /** Book the courier. With a fresh quote the fleet accepts it; otherwise it creates the delivery directly. */
  create(req: DeliveryRequest, quote?: DeliveryQuote): Promise<FleetResult>;
  get(id: string, fleetDeliveryId?: string): Promise<FleetResult>;
  cancel(id: string, fleetDeliveryId?: string): Promise<FleetResult>;
  verifyWebhook(headers: Headers, rawBody: string): boolean;
  parseWebhook(body: unknown): FleetEvent | null;
}

export const FLEET_LABELS: Record<FleetKey, string> = { doordash_drive: 'DoorDash Drive', uber_direct: 'Uber Direct', own_fleet: 'Our couriers' };

export const blocked = (message: string): FleetResult => ({ ok: false, status: 'blocked', message });
