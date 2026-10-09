// TAKATAK Food Hub — shared domain types.
// One normalized model for every channel, so the order board, Clover
// injection and the finance control tower all read the same shape.

/** The platform connection that delivered/receives the data (all direct — no aggregator). */
export type ChannelKey = 'uber_eats' | 'doordash' | 'skip' | 'tgtg';

/** Where the customer actually placed the order. */
export type Marketplace = 'uber_eats' | 'doordash' | 'skip' | 'tgtg' | 'other';

/** 'dispatched' = handed to the courier; 'failed' = handed back to the platform (Skip tablet). */
export type OrderStatus = 'new' | 'accepted' | 'ready' | 'dispatched' | 'completed' | 'cancelled' | 'failed';

/** When each step happened (Atlas "order status transitions"). ISO timestamps. */
export interface OrderTimeline {
  acceptedAt?: string;
  /** 'auto' or the username who accepted. */
  acceptedBy?: string;
  readyAt?: string;
  dispatchedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelledBy?: 'store' | 'platform' | 'customer';
  cancelStage?: 'before_accept' | 'after_accept';
  cancelReason?: string;
  /** Target ready time given to the platform / kitchen (prep time). */
  readyTarget?: string;
  printedAt?: string;
  /** Last kitchen-ticket print failure (cleared by a successful print/reprint) and how many fire-time attempts were made. */
  printError?: string;
  printAttempts?: number;
  /** Scheduled (advance) order: when the customer wants it, and when the kitchen should start. */
  scheduledFor?: string;
  fireAt?: string;
  firedAt?: string;
  /** Courier / driver as reported by the platform. */
  courier?: CourierInfo;
  /** Clover: payment recorded with the platform tender (when the order leaves the kitchen). */
  posPaymentId?: string;
  posPaymentError?: string;
  /** Clover: the cancelled order was removed from (or marked cancelled in) Clover. */
  posClosedAt?: string;
  /** Items reported missing to the platform after accepting (Skip modification). */
  missingItems?: Array<{ name: string; ref?: string; quantity: number; at: string }>;
  /** A person saw the new-order pop-up (auto-accepted orders still need eyes in the kitchen). */
  seenAt?: string;
  seenBy?: string;
  /** Extra minutes added to the kitchen timer ("+5 min"). The platform keeps its own estimate. */
  delayedMinutes?: number;
  /** Who approved a gated action with a manager PIN (reject, cancel, missing item, delay). */
  approvedBy?: string;
  /** The kitchen confirmed it saw that the platform / customer cancelled this order (stop cooking). */
  cancelSeenAt?: string;
  cancelSeenBy?: string;
  /** Automatic Clover retries after a failed injection (order-retry.ts). */
  posRetry?: {
    attempts: number;
    nextAt: string | null;
    lastError?: string;
    uncertain?: boolean;
    gaveUpAt?: string;
    doneAt?: string;
    claim?: string;
    claimedAt?: string;
  };
}

export type CourierStatus = 'assigned' | 'arriving' | 'at_store' | 'picked_up' | 'delivered' | 'unassigned';

export interface CourierInfo {
  status: CourierStatus;
  name?: string;
  phone?: string;
  vehicle?: string;
  /** When the courier is expected at the store (ISO). */
  etaAt?: string;
  updatedAt: string;
  source: string;
}

export type Fulfillment = 'delivery' | 'pickup' | 'dine_in';

export interface OrderModifier {
  externalId?: string;
  /** Clover modifier id, when the option is linked to the Clover inventory (sent as a real Clover modification). */
  posModifierRef?: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderLine {
  externalId?: string;
  /** Clover inventory item id, when the item is mapped in the master menu. */
  posItemRef?: string;
  /** How the line was linked to Clover: by id, by name, or not at all (free-text line, with a warning). */
  mapping?: 'id' | 'name' | 'free';
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  notes?: string;
  modifiers: OrderModifier[];
}

/** A line or option that could not be linked to the Clover inventory (shown on the order and the kitchen card). */
export interface OrderMappingWarning { line: number; kind: 'item' | 'modifier'; name: string; reason: 'no_match' | 'no_clover_link' | 'foreign_menu' | 'no_menu' }

export interface NormalizedOrder {
  channel: ChannelKey;
  marketplace: Marketplace;
  externalOrderId: string;
  displayId?: string;
  channelStoreId: string;
  brandName?: string;
  customerName?: string;
  fulfillment: Fulfillment;
  placedAt: string;
  readyBy?: string;
  currency: string;
  subtotal: number;
  tax: number;
  deliveryFee: number;
  tip: number;
  discount: number;
  total: number;
  notes?: string;
  lines: OrderLine[];
  raw: unknown;
  /** Courier details when the platform sends them with the order. */
  courier?: Partial<CourierInfo>;
  /**
   * 'clover' = the platform sent this order to Clover through Clover's own integration (Clover ↔ DoorDash…);
   * Food Hub only follows it: no accept / reject / cancel, never re-sent to Clover, no Clover payment recorded.
   */
  viaPos?: 'clover';
  /**
   * 'relay' = received on the Food Hub Order Relay (a partner pushes the order: TGTG feed, website…).
   * Runs the normal pipeline (Clover ticket, kitchen); accept / ready / reject go back to the relay callback.
   */
  viaHub?: 'relay';
  /** The sender's own order id, used for status callbacks. */
  hubOrderId?: string;
  /** Lines / options that reached Clover as free text (not linked to the Clover inventory). */
  mappingWarnings?: OrderMappingWarning[];
  /**
   * Where the customer ordered inside the platform, as the platform sends it (DoorDash `experience`: DOORDASH,
   * CAVIAR, STOREFRONT, …). Shown to the staff (orderSourceLabel).
   */
  orderSource?: string;
}

/** DoorDash Marketplace order `experience` values (API reference, Order model). */
export const ORDER_SOURCE_LABELS: Record<string, string> = {
  DOORDASH: 'DoorDash', CAVIAR: 'Caviar', STOREFRONT: 'Storefront', WHITE_LABELED: 'White label', DOORDASH_CHECKOUT: 'DoorDash Checkout', ANY_EXPERIENCE: 'DoorDash',
};

/** Staff-facing label of an order source ("Caviar", "Storefront"…); null when the platform sent none. */
export function orderSourceLabel(source?: string | null): string | null {
  const s = String(source ?? '').trim();
  if (!s) return null;
  return ORDER_SOURCE_LABELS[s.toUpperCase()] ?? s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface StoredOrder extends NormalizedOrder {
  id: string;
  status: OrderStatus;
  locationCode?: string;
  posOrderId?: string;
  posError?: string;
  channelError?: string;
  timeline?: OrderTimeline;
  createdAt: string;
  updatedAt: string;
}

export interface OrderEvent {
  id?: string;
  orderId: string;
  type: string;
  detail: Record<string, unknown>;
  at: string;
}

export interface ChannelStore {
  id: string;
  channel: ChannelKey;
  /** Store id on that platform (Uber store UUID, DoorDash merchant_supplied_id, Skip/JET Connect posLocationId…). */
  channelStoreId: string;
  brandName: string;
  locationCode: string;
  cloverMerchantId?: string | null;
  autoAccept: boolean;
  online: boolean;
  pausedUntil?: string | null;
  lastStatusSource?: string | null;
  meta: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

/** Live state of a store on its platform, normalized across channels. */
export type PlatformState = 'online' | 'paused' | 'closed' | 'deactivated' | 'unknown';

export interface PlatformStatus {
  state: PlatformState;
  /** Human-readable reason from the platform (e.g. OUT_OF_MENU_HOURS, operational_issues). */
  detail?: string;
  /** When a pause/deactivation ends, if the platform says so. */
  until?: string | null;
  checkedAt: string;
  source: 'sync' | 'webhook' | 'dashboard';
  error?: string;
}

// ---------- Master menu ----------

export interface MenuModifier {
  ref: string;
  name: string;
  /** French name (Quebec). */
  nameFr?: string;
  price: number;
  available: boolean;
  posModifierRef?: string;
}

export interface MenuModifierGroup {
  ref: string;
  name: string;
  nameFr?: string;
  min: number;
  max: number;
  modifiers: MenuModifier[];
}

export interface MenuItem {
  ref: string;
  name: string;
  description?: string;
  /** French name / description (Quebec); sent as translations where the platform supports them. */
  nameFr?: string;
  descriptionFr?: string;
  /** Dietary tags shown on every platform (vegetarian, vegan, gluten_free, spicy, halal, alcohol). */
  tags?: string[];
  /** Allergens, e.g. ["peanuts", "milk"]. */
  allergens?: string[];
  calories?: number;
  price: number;
  /** Operator note (never sent to the platforms), e.g. why an imported item is unavailable. */
  note?: string;
  imageUrl?: string;
  categoryRef: string;
  available: boolean;
  posItemRef?: string;
  /** Per-marketplace price override (e.g. delivery mark-up). */
  channelPrices?: Partial<Record<Marketplace, number>>;
  /** Uber Eats tax class for this item (key of UBER_TAX_CLASSES, lib/foodhub/menu/uber-tax.ts); overrides the menu default. */
  uberTaxClass?: string;
  modifierGroupRefs: string[];
}

export interface MenuCategory {
  ref: string;
  name: string;
  nameFr?: string;
  sortOrder: number;
  /** Category schedule (e.g. breakfast 7–11). Empty/undefined = same as store hours. */
  hours?: WeeklyHours | null;
}

export type DayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export type WeeklyHours = Record<DayKey, Array<{ open: string; close: string }>>;

export interface MasterMenu {
  brandName: string;
  categories: MenuCategory[];
  items: MenuItem[];
  modifierGroups: MenuModifierGroup[];
  hours?: WeeklyHours;
  /** Items/modifiers 86'd at a specific location: locationCode -> refs. */
  unavailableByLocation?: Record<string, string[]>;
  /** When a timed 86 ends: "locationCode|ref" -> epoch ms. */
  unavailableUntil?: Record<string, number>;
  /** Clover merchant the master menu was imported from (posItemRef ids belong to that merchant). */
  posMerchantId?: string;
  /**
   * Percentage added to every item and modifier price on a platform (e.g. { doordash: 20 } = +20%).
   * The base price stays the in-store (Clover) price; a per-item channelPrices override always wins.
   */
  channelMarkupPct?: Partial<Record<Marketplace, number>>;
  /**
   * Separate PICKUP price on a platform with dual pricing (DoorDash `base_price`; `price` stays the delivery price):
   * percentage added to the in-store price for pickup orders. { doordash: 0 } = pickup at the in-store price.
   * Unset = no separate pickup price (the delivery price applies to pickup too).
   */
  pickupMarkupPct?: Partial<Record<Marketplace, number>>;
  /** Default Uber Eats tax class of the brand's items and options (Item.tax_label_info); unset = none sent. */
  uberTaxClass?: string;
  updatedAt: string;
}

export type MenuLanguage = 'en' | 'fr' | 'both';

export interface Holiday {
  id: string;
  /** YYYY-MM-DD (local date). */
  date: string;
  name: string;
  /** Empty = every location. */
  locationCodes: string[];
  closed: boolean;
  /** Special opening hours when not closed. */
  slots?: Array<{ open: string; close: string }>;
}

export interface HoursConfig {
  locations: Record<string, WeeklyHours>;
  /** Brand-wide override (same hours at every location of that brand). */
  brands: Record<string, WeeklyHours>;
  holidays: Holiday[];
  updatedAt?: string;
}

/** What a menu publish needs besides the menu: the store's effective hours and upcoming holidays. */
export interface PublishContext {
  hours: WeeklyHours | null;
  holidays: Holiday[];
  timezone: string;
  /** Menu language for this platform: English, French, or both ("Poulet / Chicken"). */
  language?: MenuLanguage;
  /** Today's local date, YYYY-MM-DD. */
  today: string;
}

// ---------- Channel adapter contract ----------

export interface ChannelReadiness {
  channel: ChannelKey;
  label: string;
  configured: boolean;
  /** True only when outbound calls can really be made (credentials present AND spec confirmed AND live flag on). */
  canSend: boolean;
  missing: string[];
  note: string;
  /** Same note in French (the console is French first). */
  noteFr?: string;
  /** Linked to Clover directly (FOODHUB_VIA_CLOVER): orders are read from Clover, nothing is sent to the platform. */
  viaClover?: boolean;
  webhookPath: string;
  /** Extra webhook URLs some platforms need (e.g. Skip: cancel, offline, menu status). */
  extraWebhooks?: Array<{ label: string; path: string }>;
  /** Values YOU give the platform (generated by npm run setup). Only env key names here; values are revealed on demand. */
  handoff?: Array<{ label: string; envKey: string }>;
}

export interface ChannelResult {
  channel: ChannelKey;
  ok: boolean;
  status: 'done' | 'queued' | 'blocked' | 'skipped' | 'error';
  message: string;
  reference?: string;
  httpStatus?: number;
  response?: unknown;
}

export interface ChannelAdapter {
  key: ChannelKey;
  label: string;
  readiness(): ChannelReadiness;
  verifyWebhook(headers: Headers, rawBody: string): boolean;
  acceptOrder(order: StoredOrder, posRef?: string): Promise<ChannelResult>;
  denyOrder(order: StoredOrder, reason: string): Promise<ChannelResult>;
  markReady(order: StoredOrder, posRef?: string): Promise<ChannelResult>;
  /** Cancel an order that was already accepted (only where the platform allows it). */
  cancelOrder(order: StoredOrder, reason: CancelReason, details?: string): Promise<ChannelResult>;
  /** The order was picked up / handed over: tell the platform where it can (Too Good To Go through Deliverect: FINALIZED). Never blocks the kitchen. */
  completeOrder?(order: StoredOrder): Promise<ChannelResult>;
  publishMenu(store: ChannelStore, menu: MasterMenu, ctx?: PublishContext): Promise<ChannelResult>;
  setItemAvailability(store: ChannelStore, refs: string[], available: boolean, untilMs?: number, kind?: 'item' | 'modifier'): Promise<ChannelResult>;
  setStoreOnline(store: ChannelStore, online: boolean, untilMs?: number, reason?: string): Promise<ChannelResult>;
}

/** Standard reasons (Atlas-style) mapped to each platform's own codes. */
export type CancelReason = 'out_of_stock' | 'store_closed' | 'too_busy' | 'pos_issue' | 'customer_request' | 'other';

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  out_of_stock: 'Item out of stock',
  store_closed: 'Store / kitchen closed',
  too_busy: 'Kitchen too busy',
  pos_issue: 'POS / Clover problem',
  customer_request: 'Customer asked to cancel',
  other: 'Other',
};

// ---------- Activity log (Atlas "Store Action Report") ----------

export type ActivitySource = 'dashboard' | 'automation' | 'platform' | 'schedule' | 'api';
export type ActivityKind = 'order' | 'store_status' | 'item_availability' | 'menu_publish' | 'hours' | 'settings' | 'users' | 'login'
  | 'device' | 'incident' | 'message' | 'approval' | 'security';

export interface ActivityEntry {
  id?: string;
  at: string;
  actor: string;
  source: ActivitySource;
  kind: ActivityKind;
  action: string;
  status: 'success' | 'failed' | 'queued' | 'info';
  summary: string;
  channel?: ChannelKey | null;
  brandName?: string | null;
  locationCode?: string | null;
  storeId?: string | null;
  orderId?: string | null;
  detail?: Record<string, unknown>;
}

// ---------- Users & roles ----------

export type Role = 'owner' | 'manager' | 'operator' | 'menu' | 'analyst';

export interface UserPrefs {
  /** Interface language. */
  lang?: 'fr' | 'en';
  /** Receive Watchtower alerts by SMS / phone call / email. */
  alertSms?: boolean;
  alertCall?: boolean;
  alertEmail?: boolean;
  /** Personal quiet hours ("22:00"-"07:00"); critical alerts still go through when on duty. */
  quietFrom?: string;
  quietTo?: string;
  /** On duty for escalations (managers) — off = never called. */
  onDuty?: boolean;
}

export interface FoodHubUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  /** Empty = every location. */
  locations: string[];
  /** Sign-in: a one-time code or link is sent here. At least one of email / phone. */
  email?: string | null;
  phone?: string | null;
  /** Optional legacy password (owner recovery, scripts). */
  passwordHash?: string | null;
  /** 4–6 digit staff PIN (scrypt) — unlocks a kitchen tablet and approves gated actions. */
  pinHash?: string | null;
  prefs?: UserPrefs;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
}

export interface FoodHubJob {
  id: string;
  kind: 'menu_push' | 'menu_publish' | 'item_toggle' | 'store_toggle' | 'webhook_unparsed';
  channel: ChannelKey;
  reference?: string | null;
  status: 'queued' | 'done' | 'error';
  request: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
