// Own orders and own-courier deliveries.
//
// "Direct orders" are the orders WE take (phone — by a person or the AI agent —, a Clover order with the order type
// "Delivery", our own website, or typed in by hand). They are not platform orders: no marketplace accepts or cancels
// them, so they live in their own collection instead of the platform order table, and never change the platform
// store grid, payouts or commission checks.
// A "delivery" is one courier trip for a direct order, booked on an on-demand fleet (DoorDash Drive first, Uber Direct as
// a comparison quote / fallback). Money is kept in cents on the fleet side and in dollars here, like the rest of Food Hub.
import type { MevRecord } from '../mev/types';
import type { OrderLine } from '../types';

/**
 * 'clover_online' = an order the customer placed on the restaurant's Clover Online Ordering page (the "Order online"
 * button of its website, the Clover app, a QR code). Clover took it, printed it and fired it to its KDS by itself:
 * Food Hub only mirrors it on the kitchen screen (pos/clover-website-orders.ts). Clover is the source of truth.
 */
export type DirectSource = 'phone' | 'phone_ai' | 'clover' | 'website' | 'manual' | 'clover_online';
/**
 * 'awaiting_payment' = a phone order HELD until the customer pays the Clover payment link texted to them: not on the
 * kitchen screen, not in Clover, no courier. Paid → 'in_kitchen' (exactly once, delivery/paylink.ts); unpaid → cancelled.
 */
export type DirectStatus = 'awaiting_payment' | 'new' | 'in_kitchen' | 'ready' | 'out_for_delivery' | 'completed' | 'cancelled';
/** How the customer pays. Couriers never collect money: a delivery waits until the order is paid (or the owner allows unpaid dispatch). */
export type PaymentState = 'paid' | 'pay_at_pickup' | 'unpaid';

/**
 * A fee the customer was shown BEFORE checkout (Québec: the price they commit to is all-inclusive), e.g. the Interac
 * e-Transfer fee. Taxed GST + QST like the delivery fee. Food Hub refuses an order whose declared fee is not its own.
 */
export interface OrderFee { code: 'interac'; name: string; amount: number }

/**
 * An order paid by Interac e-Transfer (website orders, delivery/interac.ts). Modelled NEXT TO `paylink` rather than as a
 * new PaymentState: the order is HELD exactly like a payment-link order (status 'awaiting_payment', payment 'unpaid'), so
 * every screen, dispatch rule, tick and tracking page that already knows a held order works unchanged, and the release
 * copies paylink.ts' discipline (one lock, a claim written and re-read, one Clover order = one ticket). The difference:
 * nobody reads a bank — a PERSON presses "Virement reçu / Transfer received"; a late or second transfer is only flagged.
 */
export interface InteracTransfer {
  /** Short reference the customer writes in the transfer's message field, e.g. "PPP-7K3Q". */
  reference: string;
  /** Exact amount to send: the order total, fee and taxes included. */
  amount: number;
  /** The restaurant's Interac e-mail for that kitchen (Settings → Expansion → Delivery → Paiements). */
  recipient: string;
  autoDeposit: boolean;
  /** Security question when auto-deposit is off (texted with its answer). */
  question?: string;
  /** The answer: texted to the customer, masked in the outbox preview, never logged, never in an API answer. */
  answer?: string;
  lang: 'fr' | 'en';
  createdAt: string;
  /** Not confirmed by then → cancelled at the next tick, courtesy text. */
  expiresAt: string;
  reminderMin: number;
  smsAt?: string;
  smsError?: string;
  remindedAt?: string;
  /** A person confirmed the transfer (the only way an Interac order is released). */
  receivedAt?: string;
  receivedBy?: string;
  /** Release lock (claim + re-read): only one request releases the order. */
  releaseClaim?: string;
  releaseClaimAt?: string;
  releasedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  /**
   * "Received" pressed AFTER the cancel / expiry: never released by itself — a person decides (send to the kitchen
   * anyway, or return the money by hand; Food Hub never refunds).
   */
  lateTransfers?: Array<{ at: string; by: string; releasedAt?: string; releasedBy?: string; refundedAt?: string; refundedBy?: string }>;
}

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

/** The payment link of a held order (Clover Hosted Checkout behind our own link /p/<token>). */
export interface PayLink {
  /** Secret part of our link (22+ characters): never in a log, an outbox preview or a page other than its own. */
  token: string;
  /** The Clover merchant that takes the payment (the kitchen's own merchant — never a default). */
  merchantId: string;
  /** "Réf. IA-1043" on the first Clover line: how a payment is matched when a webhook is lost. */
  marker: string;
  lang: 'fr' | 'en' | 'es';
  /** Our number the texts are sent from (the number the caller called), when set. */
  smsFrom?: string;
  createdAt: string;
  /** The link stops working (the order is cancelled at the next check). */
  expiresAt: string;
  reminderMin: number;
  /** Clover sessions (each lives 15 minutes; a fresh one is made when the customer opens the link later). */
  sessions: Array<{ id: string; href: string; createdAt: string; expiresAt?: string }>;
  /** What Clover will charge (cents), computed like its page: GST and QST rounded one by one. */
  expectedCents: number;
  smsAt?: string;
  smsError?: string;
  remindedAt?: string;
  openedAt?: string;
  lastCheckAt?: string;
  paymentId?: string;
  paidAt?: string;
  paidCents?: number;
  cloverOrderId?: string;
  /** Release lock (claim + re-read): only one request releases the order. */
  releaseClaim?: string;
  releaseClaimAt?: string;
  releasedAt?: string;
  /** Written BEFORE the print request: the ticket prints at most once. */
  printClaimAt?: string;
  printedAt?: string;
  printError?: string;
  cancelledAt?: string;
  cancelReason?: string;
  /** Payments that arrived after the order was paid or cancelled: a person refunds them in Clover. */
  extraPayments?: string[];
  declinedAt?: string;
  /** The flag the release raised (kitchen closed, amount off, ticket not printed): booking a courier keeps it. */
  flag?: string;
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
  /** `id` = the Food Hub customer account (customers/token.ts) the website order was placed with, when its token verified. */
  customer: { name?: string; phone?: string; email?: string; lang?: 'fr' | 'en' | 'es'; id?: string };
  fulfillment: 'pickup' | 'delivery';
  dropoff?: DropoffAddress;
  lines: DirectLine[];
  subtotal: number;
  tax: number;
  /** Delivery fee charged to the customer (not what the courier costs us). */
  deliveryFee: number;
  /** Courier tip paid by the customer (passed to the courier in full). */
  tip: number;
  /** Declared fees the customer saw before checkout (Interac e-Transfer fee). Taxed; in the Clover order as their own lines. */
  fees?: OrderFee[];
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
  /** Clover online orders: the Clover merchant that holds the order (its status is re-read from there). */
  posMerchantId?: string;
  /** Clover online orders: when Clover marked the order printed (its printer / KDS got it). Food Hub never prints these. */
  posPrintedAt?: string;
  /** Clover online orders: someone tapped "Seen" on the Food Hub kitchen screen. */
  seenAt?: string;
  seenBy?: string;
  /** The current delivery (one at a time; earlier cancelled ones stay in the deliveries collection). */
  deliveryId?: string;
  /** Set when a person must look (address missing, alcohol blocked, quote too expensive…). Cleared when fixed. */
  attention?: string;
  /** Auto-dispatch attempts (retried every 2 minutes, at most 3 times, then a person decides). */
  autoDispatch?: { attempts: number; lastAt?: string; stoppedReason?: string };
  /** Paid by a payment link texted to the customer (phone orders): the order is held until paid. */
  paylink?: PayLink;
  /** Paid by Interac e-Transfer (website orders): held until a person confirms the transfer. */
  interac?: InteracTransfer;
  /** Revenu Québec invoice issued by Takatak MEV (QCMEV): the current receipt as QCMEV rendered it (mev/outbox.ts). */
  mev?: MevRecord;
  events: DirectEvent[];
  createdAt: string;
  updatedAt: string;
}

/** Delivery services: DoorDash Drive, Uber Direct, Skip Delivery, and our own couriers. */
export type FleetKey = 'doordash_drive' | 'uber_direct' | 'skip_daas' | 'own_fleet';

/** Normalised courier status, the same for every fleet. Moves forward only (except to a terminal state). */
export type DeliveryStatus =
  | 'quoted' | 'created' | 'assigned' | 'at_pickup' | 'picked_up' | 'at_dropoff' | 'delivered'
  | 'returning' | 'returned' | 'cancelled' | 'failed';

export const DELIVERY_RANK: Record<DeliveryStatus, number> = {
  quoted: 0, created: 1, assigned: 2, at_pickup: 3, picked_up: 4, at_dropoff: 5, delivered: 9, returning: 6, returned: 9, cancelled: 9, failed: 9,
};
export const TERMINAL: DeliveryStatus[] = ['delivered', 'returned', 'cancelled', 'failed'];
export const ACTIVE: DeliveryStatus[] = ['created', 'assigned', 'at_pickup', 'picked_up', 'at_dropoff', 'returning'];

/** Photos the fleet took (pickup, drop-off) and the customer's signature: proof the order was handed over. */
export interface DeliveryProof { pickupImageUrl?: string; dropoffImageUrl?: string; signatureImageUrl?: string }

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
  /** Our own courier the delivery is assigned to (fleet own_fleet). */
  ownCourierId?: string;
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
  /** Uber Direct dropoff PIN (proof "PIN code"): the customer gives it to the courier; texted with the tracking link. */
  dropoffPin?: string;
  courier?: CourierPosition;
  /** Proof of pickup / delivery (DoorDash Drive webhooks: verification images, signature). */
  proof?: DeliveryProof;
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
  /** Uber Direct options (Create Delivery fields). */
  uberDirect: UberDirectOptions;
  /** Interac e-Transfer for website orders (held until a person confirms the transfer). */
  interac: InteracSettings;
  locations: Record<string, LocationDeliveryRule>;
  updatedAt?: string;
}

/**
 * Interac e-Transfer settings. Food Hub never reads a bank account: these only say what the customer is told (where to
 * send, how much, the question) and how long the kitchen waits for a person to confirm.
 */
export interface InteracSettings {
  enabled: boolean;
  /** Fee before taxes (dollars), taxed GST 5 % + QST 9.975 % like a service charge; the site must show the all-in fee. */
  fee: number;
  /** Recipient e-mail for every kitchen (fallback: FOODHUB_INTERAC_EMAIL), unless `recipients` names one for a kitchen. */
  recipientEmail: string;
  /** Recipient e-mail per location code. */
  recipients: Record<string, string>;
  /** Auto-deposit on the recipient account (no question); off → `question` + `answer` are texted to the customer. */
  autoDeposit: boolean;
  question: string;
  /** Stored here, returned MASKED by the settings API (INTERAC_ANSWER_MASK), texted to the customer only. */
  answer: string;
  /** Minutes the order stays held before it is cancelled (a person may still confirm a late transfer by hand). */
  holdMinutes: number;
  /** Minutes after the order before the one reminder text (0 = none). */
  reminderMinutes: number;
}

/** What the settings API shows instead of the stored answer; sent back unchanged, it keeps the stored answer. */
export const INTERAC_ANSWER_MASK = '••••••';
export const DEFAULT_INTERAC_SETTINGS: InteracSettings = { enabled: false, fee: 5, recipientEmail: '', recipients: {}, autoDeposit: true, question: '', answer: '', holdMinutes: 45, reminderMinutes: 20 };

/**
 * Uber Direct Create Delivery options (developer.uber.com/docs/deliveries/api-reference/daas):
 * deliverable_action, dropoff_verification (picture / signature / pincode), and Courier Pick & Pack (pickup_action
 * "pick_pack_pay", needs a separate Uber agreement). Alcohol always means meet at the door + ID check.
 */
export interface UberDirectOptions {
  deliverableAction: 'meet_at_door' | 'leave_at_door';
  proof: 'none' | 'picture' | 'signature' | 'pincode';
  pickPackPay: boolean;
}

export const DEFAULT_UBER_DIRECT_OPTIONS: UberDirectOptions = { deliverableAction: 'meet_at_door', proof: 'picture', pickPackPay: false };

export const DEFAULT_RULE: LocationDeliveryRule = {
  enabled: false, autoDispatch: false, leadMinutes: 10, maxDistanceKm: 8, postalPrefixes: [], maxAutoFee: 15,
};

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  primaryFleet: 'doordash_drive', compareQuotes: true, defaultTip: 3, customerFee: 4.99, smsTracking: true,
  allowUnpaidDispatch: false, undeliverable: 'return_to_pickup', readCloverDeliveryOrders: true, uberDirect: DEFAULT_UBER_DIRECT_OPTIONS, interac: DEFAULT_INTERAC_SETTINGS, locations: {},
};
