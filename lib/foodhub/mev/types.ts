// Takatak MEV (QCMEV) integration: the shapes Food Hub sends and keeps (docs/MEV_INTEGRATION.md).
//
// QCMEV is the SEV (sales recording system), in mode SEV: it alone numbers, signs, sends to Revenu Québec's MEV-WEB
// and lays out the invoice. Food Hub takes the orders like a terminal of that SEV: it never
// signs, never talks to Revenu Québec, and prints only the exact lines QCMEV rendered.
//
// Identity values (file number, GST/QST numbers, device id given by Revenu Québec, authorization code) live ONLY in
// QCMEV's per-location configuration. Nothing here carries them, and they never go in git, tests or logs.

/** off = nothing at all (default) · shadow = map and check only, no call · simulator = QCMEV in SIMULATOR/DEV · on = PROD. */
export type MevMode = 'off' | 'shadow' | 'simulator' | 'on';
/** Which system issues the legal invoice for a kitchen. Default none: Food Hub sends nothing for it. */
export type SevOfRecord = 'none' | 'qcmev' | 'clover_app';
/** When a platform order becomes a sale: once accepted (default) or once ready. */
export type MevTrigger = 'accept' | 'ready';

/** Line tax code: FP = GST + QST (prepared food, default), F = GST only, P = QST only, NON = not taxable. */
export type MevTaxCode = 'FP' | 'F' | 'P' | 'NON';
export const MEV_TAX_CODES: readonly MevTaxCode[] = ['FP', 'F', 'P', 'NON'];
/** LVT = ordered on a digital platform · LVR = delivered by the restaurant · CMP = counter / pickup · TBL = table. */
export type MevServiceType = 'LVT' | 'LVR' | 'CMP' | 'TBL';
/** The payment modes Food Hub can know (a subset of the 16 MEV-WEB values; QCMEV maps them). */
export type MevPayMode = 'AUT' | 'CRE' | 'DEB' | 'ARG' | 'CPR' | 'MIX' | 'AUC';
export type MevChannel = 'uber_eats' | 'doordash' | 'skip' | 'tgtg' | 'relay' | 'website' | 'phone' | 'storefront' | 'clover_online' | 'manual';

export interface MevSaleModifier { description: string; quantity: string; unitPriceCents: number; totalCents: number }

export interface MevSaleLine {
  ref?: string;
  description: string;
  /** Decimal string ("2", "0.5"): MEV-WEB quantities are decimals. */
  quantity: string;
  unitPriceCents: number;
  totalCents: number;
  taxCode: MevTaxCode;
  activity: 'RES' | 'BAR' | 'NON';
  modifiers: MevSaleModifier[];
}

/** One finalized sale (closing receipt, typTrans RFER). All money in integer cents, CAD. */
export interface FoodHubSaleV1 {
  schema: 'foodhub.sale.v1';
  tenantId: string;
  /** The kitchen (not the brand). QCMEV maps it to its operator + device. */
  locationId: string;
  saleKey: string;
  /** ISO-8601 with the Montréal offset: the moment the sale became final. */
  occurredAt: string;
  source: {
    model: 'stored' | 'direct';
    channel: MevChannel;
    orderId: string;
    externalOrderId: string;
    displayId?: string;
    posOrderId?: string;
    brand?: string;
  };
  serviceType: MevServiceType;
  ecommerce: boolean;
  /** The SEV user (registered in QCMEV through UTL): the staff member who accepted, or FOODHUB-AUTO. */
  user: { id: string; name: string };
  lines: MevSaleLine[];
  /** The restaurant's own fees only (never the platform's delivery / service fees). */
  fees: { deliveryCents: number; serviceFeeCents: number };
  /** Restaurant-funded discount, before tax (a platform-funded promotion is not the restaurant's discount). */
  discountCents: number;
  amounts: { subtotalCents: number; gstCents: number; qstCents: number; totalCents: number; tipCents: number };
  payment: { mode: MevPayMode; collectedBy: 'platform' | 'paylink' | 'clover_tender' | 'cash'; reference?: string };
  receipt: { format: 'PAP' | 'ELE' | 'PEL' | 'NON'; deliver: 'print' | 'sms' | 'email' | 'none' };
  /** Set on a corrected receipt that replaces a credited one (order adjustment): the sale it replaces. */
  referenceSaleKey?: string;
  /** Training transactions (modTrans FOR): every sale in simulator mode. */
  testMode: boolean;
  /**
   * taxGap = the platform's tax differed from the computed split by more than 1 cent; taxComputed = the feed had no tax;
   * taxIncluded = the platform's prices include the taxes (Too Good To Go): the pre-tax prices were worked out from them;
   * subtotalRounded = the platform's subtotal differed from its own lines by 1–2 cents: the lines are the receipt.
   */
  flags?: { taxGap?: boolean; taxComputed?: boolean; taxIncluded?: boolean; subtotalRounded?: boolean };
  /** sha256 of the canonical JSON of everything above. */
  payloadHash: string;
}

export type MevCreditReason = 'cancelled' | 'adjusted' | 'missing_items' | 'refund';

/** A credit note (RFER with negative amounts) that references the original sale. */
export interface FoodHubCreditV1 {
  schema: 'foodhub.credit.v1';
  tenantId: string;
  locationId: string;
  saleKey: string;
  creditKey: string;
  reason: MevCreditReason;
  full: true;
  amounts: FoodHubSaleV1['amounts'];
  occurredAt: string;
  user: { id: string; name: string };
  testMode: boolean;
  payloadHash: string;
}

/** Reprint (RPR) or merchant copy (DUP) of an issued receipt. Both are transmitted by QCMEV. */
export interface FoodHubPrintV1 { schema: 'foodhub.print.v1'; tenantId: string; saleKey: string; printKey: string; mode: 'RPR' | 'DUP'; user: { id: string; name: string }; payloadHash: string }

/** The receipt QCMEV returns: printed and shown exactly as received. */
export interface MevReceipt {
  qcmevTransactionId?: string;
  noTrans?: string;
  datTrans?: string;
  utc?: string;
  deviceId?: string;
  mevProcessedAt?: string;
  mevTransactionNumber?: string;
  qr?: { content?: string; svg?: string; pngDataUrl?: string };
  mentions?: string[];
  text80mm?: string[];
  html?: string;
  /** The electronic document (formImpr ELE / PEL): the link « Consulter la transaction en ligne » right under the QR. */
  electronic?: { mentions?: string[]; lines?: string[]; html?: string } | null;
  renderHash?: string;
  issuedAt?: string;
}

export type MevJobKind = 'sale' | 'credit' | 'print';
export type MevJobStatus = 'pending' | 'sending' | 'done' | 'needs_human' | 'skipped';
/** Why a pending job waits (shown in plain words on the order). */
export type MevWait = 'tender_unknown' | 'location_not_ready' | 'qcmev_unreachable' | 'queued' | 'depends' | 'not_certified' | 'offline_pending';

/** One row of the Food Hub outbox (fh_docs collection "mev_outbox"). doc.key = saleKey of the base sale. */
export interface MevJob {
  id: string;
  /** Idempotency key: saleKey, creditKey or printKey. */
  key: string;
  kind: MevJobKind;
  /** The base sale key of the order (every job of an order shares it). */
  baseKey: string;
  /** For a credit or a print: the sale it refers to. */
  saleKey: string;
  order: { model: 'stored' | 'direct'; id: string; locationCode: string; label: string };
  status: MevJobStatus;
  payload: FoodHubSaleV1 | FoodHubCreditV1 | FoodHubPrintV1;
  payloadHash: string;
  /** Fiscal content only (lines + amounts): an order whose content changes after its receipt gets a credit note. */
  contentHash?: string;
  attempts: number;
  nextAt: string | null;
  /** Key of the job that must be done first (a credit note waits for its sale). */
  dependsOn?: string;
  wait?: MevWait;
  lastError?: string;
  lastHttp?: number;
  result?: { status: 'accepted' | 'offline_pending' | 'rejected'; receipt?: MevReceipt; errors?: Array<{ id?: string; mess?: string; codRetour?: string }> };
  /** A credit or a replacing sale was made for this sale: it is no longer the order's current receipt. */
  creditedBy?: string;
  /**
   * Never sent: the order's data does not make a truthful invoice (lines that do not add up, an item without a name, no
   * line at all). A person fixes the order; the next change maps it again. Food Hub never invents a line to balance it.
   */
  blocked?: MevReview;
  /** Shadow mode: mapped and checked, never sent. */
  shadow?: boolean;
  claim?: string;
  claimedAt?: string;
  firstAttemptAt?: string;
  doneAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Why a sale cannot be sent as it is (shown on the order; needs a person). */
export type MevReview = 'amounts_mismatch' | 'description_missing' | 'no_lines';

export type MevOrderStatus = 'pending' | 'accepted' | 'offline' | 'rejected' | 'needs_human' | 'skipped' | 'shadow' | 'credited';

/** What the order keeps (order.mev): the current receipt as QCMEV rendered it. No identity numbers. */
export interface MevRecord {
  status: MevOrderStatus;
  saleKey: string;
  /** Plain reason for skipped / pending / needs_human (e.g. "tender_unknown", "log_order"). */
  reason?: string;
  noTrans?: string;
  datTrans?: string;
  utc?: string;
  mevNumber?: string;
  /** QR as an image data URL (SVG or PNG from QCMEV), safe to show in an <img>. */
  qrImage?: string;
  /** The URL the QR points to ("Consulter la transaction en ligne"). */
  qrUrl?: string;
  mentions?: string[];
  text80mm?: string[];
  /** The receipt's support: PAP (paper), ELE (electronic), PEL (both), NON (not printed). */
  format?: FoodHubSaleV1['receipt']['format'];
  /** The electronic document's lines (ELE / PEL only): what /r/<token> shows. */
  textElectronic?: string[];
  renderHash?: string;
  issuedAt?: string;
  /** Each document is printed once (« Modes d'impression »): document key → when its original was printed. */
  printed?: Record<string, string>;
  /** Secret part of the public receipt link /r/<token> (electronic receipts only). */
  token?: string;
  /** Staff-chosen tender for a pay-at-pickup order whose Clover payment is not readable. */
  tender?: MevPayMode;
  creditNotes?: Array<{ creditKey: string; reason: MevCreditReason; status: MevOrderStatus; noTrans?: string; at: string }>;
  /** Reprints / merchant copies, with the lines QCMEV rendered for each (the merchant copy carries its own mention). */
  prints?: Array<{ printKey: string; mode: 'RPR' | 'DUP'; status: MevOrderStatus; text80mm?: string[]; qrImage?: string; at: string }>;
  updatedAt: string;
}
