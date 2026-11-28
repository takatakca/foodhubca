import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createServiceClient, hasSupabaseEnv } from '../supabase/server';
import { nowIso } from './config';
import type { PendingPlatformEvents } from './courier';
import type { ActivityEntry, ActivityKind, ChannelKey, ChannelStore, CourierInfo, CourierStatus, FoodHubJob, FoodHubUser, MasterMenu, NormalizedOrder, OrderEvent, OrderStatus, OrderTimeline, StoredOrder } from './types';

export interface OrderFilter { limit?: number; statuses?: OrderStatus[]; since?: string; until?: string; locationCodes?: string[] }
export interface ActivityFilter { limit?: number; since?: string; until?: string; kinds?: ActivityKind[]; locationCodes?: string[] }
/** Generic document store (payout lines, statement imports, reconciliation cases, ledger approvals…). */
export interface Doc<T = Record<string, unknown>> { id: string; key?: string | null; at?: string | null; data: T }
export interface DocFilter { since?: string; until?: string; keys?: string[]; limit?: number }

type StoreSnapshot = Pick<ChannelStore, 'channel' | 'channelStoreId' | 'locationCode' | 'updatedAt' | 'meta'>;
type SkipCloverStoreSnapshot = Pick<ChannelStore, 'id' | 'channelStoreId' | 'locationCode' | 'cloverMerchantId' | 'updatedAt'>;
type SkipOrderIdentity = { externalOrderId: string; orderId: string };
type SkipCloverIdentity = SkipOrderIdentity & { merchantId: string };
type SkipReceiptIdentity = SkipCloverIdentity & { posOrderId: string };
type SkipPaymentIdentity = SkipReceiptIdentity & { paymentReference: string };
type SkipPaymentInput =
  | ({ kind: 'check_payment' } & SkipPaymentIdentity)
  | ({ kind: 'prepare_payment'; attemptId?: string } & SkipPaymentIdentity)
  | ({ kind: 'finish_payment'; attemptId: string } & (
    | { result: 'paid'; paymentId: string; closeTerminal?: true }
    | { result: 'refused'; error?: string }
    | { result: 'uncertain' }
  ) & SkipPaymentIdentity);

export interface SkipPaymentAttempt {
  id: string;
  at: string;
  merchantId: string;
  posOrderId: string;
  paymentReference: string;
  state: 'sending' | 'uncertain' | 'paid';
  paymentId?: string;
}

export interface SkipPaymentRecoveryClaim {
  order: StoredOrder;
  paymentAttempt: SkipPaymentAttempt;
  leaseId: string;
}

const SKIP_PAYMENT_REVIEW = 'Skip Clover payment needs review: Verify the outcome on the recorded register before retrying.';
const DEFINITE_PAYMENT_REFUSAL = /^(?:0|400|401|403|404|405|415|422|429)$/;
const PAYMENT_RECOVERY_MIN_AGE_MS = 120_000;
const PAYMENT_RECOVERY_LEASE_MS = 90_000;
const PAYMENT_RECOVERY_LIMIT = 12;

function hasUncertainEarlierPayment(error: string | undefined): boolean {
  if (!error) return false;
  if (error.startsWith('Skip Clover payment needs review:') || error.startsWith('Clover payment error:')) return true;
  const httpStatus = /^Clover payment HTTP (\d+):/.exec(error)?.[1];
  return Boolean(httpStatus && !DEFINITE_PAYMENT_REFUSAL.test(httpStatus));
}

type SkipDriverUpdate = Pick<CourierInfo, 'status'> & Partial<Pick<CourierInfo, 'name' | 'phone' | 'vehicle' | 'etaAt'>>;
const SKIP_DRIVER_STATES: CourierStatus[] = ['assigned', 'arriving', 'at_store', 'picked_up', 'delivered', 'unassigned'];
type SkipJetAttempt = NonNullable<OrderTimeline['skipJetAttempt']>;
type SkipJetSignal = SkipJetAttempt['signal'];
type SkipJetOutcome = NonNullable<SkipJetAttempt['outcome']>;
type SkipJetInput =
  | ({ kind: 'prepare_jet'; signal: SkipJetSignal; manual?: true } & SkipOrderIdentity)
  | ({ kind: 'finish_jet'; attemptId: string; result: SkipJetOutcome | 'refused';
    fields?: Pick<OrderTimeline, 'acceptedBy' | 'seenAt' | 'seenBy' | 'approvedBy'> & { channelError?: string } } & SkipOrderIdentity);

export type SkipLifecycleInput =
  | { kind: 'backup'; order: NormalizedOrder & { locationCode?: string }; mappedStore: boolean; message: string; detail: Record<string, unknown> }
  | { kind: 'cancel'; externalOrderId: string; detail: Record<string, unknown> }
  | { kind: 'intake'; order: NormalizedOrder & { locationCode?: string } }
  | { kind: 'check_intake'; externalOrderId: string }
  | ({ kind: 'prepare_clover'; storeMapping?: SkipCloverStoreSnapshot | null; allowAfterManualAcceptance?: true } & SkipCloverIdentity)
  | ({ kind: 'clear_clover_attempt'; attemptId: string; definiteError?: string } & SkipCloverIdentity)
  | ({ kind: 'hold_legacy_clover' } & SkipOrderIdentity)
  | ({ kind: 'record_receipt'; adopted: boolean; evidence?: Record<string, unknown> } & SkipReceiptIdentity)
  | ({ kind: 'check_receipt' } & SkipReceiptIdentity)
  | ({ kind: 'apply_driver'; driver: SkipDriverUpdate } & SkipOrderIdentity)
  | SkipJetInput
  | SkipPaymentInput;

export interface SkipLifecycleResult {
  order: StoredOrder | null;
  isNew: boolean;
  outcome: 'conflicting_store' | 'conflicting_receipt' | 'conflicting_attempt' | 'ignored' | 'cancelled' | 'parked' | 'backed_up' | 'received'
    | 'prepared' | 'attempt_pending' | 'attempt_cleared' | 'conflicting_jet' | 'jet_prepared' | 'jet_pending' | 'jet_finished' | 'mapping_changed'
    | 'legacy_clover_uncertain' | 'conflicting_payment' | 'payment_prepared' | 'payment_pending' | 'payment_finished';
  paymentAttempt?: SkipPaymentAttempt;
  transitioned?: true;
  recorded?: true;
  finished?: true;
  driverAdvanced?: true;
  completedClosure?: true;
}

export interface FoodHubRepo {
  mode: 'supabase' | 'memory';
  applySkipLifecycle(input: SkipLifecycleInput): Promise<SkipLifecycleResult>;
  claimSkipPaymentRecoveries(input: { now: string; limit: number }): Promise<SkipPaymentRecoveryClaim[]>;
  rescheduleSkipPaymentRecovery(input: { attemptId: string; leaseId: string; nextCheckAt: string }): Promise<boolean>;
  insertOrderIfNew(order: NormalizedOrder & { locationCode?: string; createdAt?: string }): Promise<{ order: StoredOrder; isNew: boolean }>;
  getOrder(id: string): Promise<StoredOrder | null>;
  findOrder(channel: ChannelKey, externalOrderId: string): Promise<StoredOrder | null>;
  updateOrder(id: string, patch: Partial<StoredOrder>): Promise<StoredOrder | null>;
  /**
   * Merges a timeline patch (plus optional top-level fields) into the order as stored NOW, so two writers
   * (courier webhook + operator click, auto-complete + cancel) do not overwrite each other's timeline fields.
   * Supabase: optimistic concurrency on updated_at with one retry; memory: read-merge-write.
   * A guard applies to each fresh snapshot and disables the final unconditional write.
   */
  patchOrder(id: string, timeline: OrderTimeline, extra?: Partial<StoredOrder>, guard?: (order: StoredOrder) => boolean): Promise<StoredOrder | null>;
  listOrders(filter?: OrderFilter): Promise<StoredOrder[]>;
  addEvent(orderId: string, type: string, detail?: Record<string, unknown>): Promise<void>;
  listEvents(orderId: string): Promise<OrderEvent[]>;
  listStores(channel?: ChannelKey): Promise<ChannelStore[]>;
  findStore(channel: ChannelKey, channelStoreId: string): Promise<ChannelStore | null>;
  getStore(id: string): Promise<ChannelStore | null>;
  upsertStore(store: Omit<ChannelStore, 'id'> & { id?: string }): Promise<ChannelStore>;
  /** With a snapshot, update only if the stored identity, location and metadata still match. */
  updateStore(id: string, patch: Partial<ChannelStore>, expected?: StoreSnapshot): Promise<ChannelStore | null>;
  deleteStore(id: string): Promise<void>;
  getMenu(brandName: string): Promise<MasterMenu | null>;
  saveMenu(menu: MasterMenu): Promise<MasterMenu>;
  listMenus(): Promise<MasterMenu[]>;
  addJob(job: Omit<FoodHubJob, 'id' | 'createdAt' | 'updatedAt'>): Promise<FoodHubJob>;
  findJobByReference(reference: string): Promise<FoodHubJob | null>;
  updateJob(id: string, patch: Partial<FoodHubJob>): Promise<void>;
  listJobs(limit?: number): Promise<FoodHubJob[]>;
  /** Small key/value store (last sync report, Clover sales cache). */
  getKv<T = unknown>(key: string): Promise<T | null>;
  setKv(key: string, value: unknown): Promise<void>;
  /**
   * Write `key` only if it does not exist yet, in one atomic step (Supabase: INSERT on the primary key; the database
   * refuses a duplicate). True = this caller claimed it; false = it was already there (another run or container).
   * For "do this once" steps that must hold across processes (Clover metered charges).
   */
  claimKv(key: string, value: unknown): Promise<boolean>;
  /** Gives a claimKv key back (the step it guarded definitely failed), so a later run can claim it again. */
  releaseKv(key: string): Promise<void>;
  addActivity(entry: ActivityEntry): Promise<void>;
  listActivity(filter?: ActivityFilter): Promise<ActivityEntry[]>;
  listUsers(): Promise<FoodHubUser[]>;
  getUser(username: string): Promise<FoodHubUser | null>;
  saveUser(user: Omit<FoodHubUser, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Promise<FoodHubUser>;
  putDocs<T>(collection: string, docs: Doc<T>[]): Promise<void>;
  insertDocIfAbsent<T>(collection: string, doc: Doc<T>): Promise<boolean>;
  listDocs<T>(collection: string, filter?: DocFilter): Promise<Doc<T>[]>;
  getDoc<T>(collection: string, id: string): Promise<Doc<T> | null>;
  deleteDocs(collection: string, ids: string[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory repository — used before Supabase is configured (demo / tests).
// Data lives in process memory and is lost on restart; the UI says so.
// ---------------------------------------------------------------------------

type MemState = {
  orders: Map<string, StoredOrder>;
  skipPayments?: Map<string, SkipPaymentAttempt>;
  skipPaymentRecovery?: Map<string, { due: number; leaseId?: string }>;
  events: OrderEvent[];
  stores: Map<string, ChannelStore>;
  menus: Map<string, MasterMenu>;
  jobs: Map<string, FoodHubJob>;
  kv: Map<string, unknown>;
  activity: ActivityEntry[];
  users: Map<string, FoodHubUser>;
  docs: Map<string, Map<string, Doc<any>>>;
};

function memState(): MemState {
  const g = globalThis as unknown as { __foodhubMem?: MemState };
  if (!g.__foodhubMem) {
    g.__foodhubMem = { orders: new Map(), events: [], stores: new Map(), menus: new Map(), jobs: new Map(), kv: new Map(), activity: [], users: new Map(), docs: new Map() };
  }
  return g.__foodhubMem;
}

function skipNoticeReference(input: SkipLifecycleInput): string {
  const reference = 'order' in input ? input.order.externalOrderId : input.externalOrderId;
  if (!reference || ('order' in input && input.order.channel !== 'skip')) throw new Error('Invalid Skip lifecycle notice');
  return reference;
}

function pendingInboxCancel(state: MemState, reference: string): PendingPlatformEvents['status'] {
  const candidates = [...(state.docs.get('webhook_inbox')?.values() ?? [])].filter(({ data, key }) =>
    data?.channel === 'skip' && data.kind === 'skip_cancel' && data.reference === reference.slice(0, 200)
    && String(data.body?.orderID ?? '') === reference && ['received', 'processing', 'failed', 'done'].includes(key ?? ''));
  candidates.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '') || b.id.localeCompare(a.id));
  const entry = candidates[0]?.data;
  if (!entry) return undefined;
  const { reason, happenedAt } = entry.body;
  return { platformState: 'cancelled', detail: { reason: reason?.code, happenedAt }, at: entry.receivedAt };
}

function pendingInboxBackup(state: MemState, order: StoredOrder): Record<string, unknown> | undefined {
  const storeId = order.channelStoreId;
  if (!storeId?.trim() || !['new', 'accepted', 'ready'].includes(order.status)) return undefined;
  const reference = order.externalOrderId;
  const isReference = (value: unknown, expected: string) =>
    (typeof value === 'string' || typeof value === 'number') && String(value) === expected;
  const candidates = [...(state.docs.get('webhook_inbox')?.values() ?? [])].filter(({ data, key }) =>
    data?.channel === 'skip' && data.kind === 'skip_backup' && data.reference === reference.slice(0, 200)
    && isReference(data.body?.order?.orderId, reference) && isReference(data.body?.order?.restaurant?.id, storeId)
    && ['received', 'processing', 'failed', 'done'].includes(key ?? ''));
  candidates.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '') || b.id.localeCompare(a.id));
  return candidates[0]?.data?.body;
}

function applySkipDriverObservation(order: StoredOrder, driver: SkipDriverUpdate, now: string): StoredOrder {
  const { status, name, phone, vehicle, etaAt } = driver;
  const courier: CourierInfo = {
    ...order.timeline?.courier,
    ...(name ? { name } : {}), ...(phone ? { phone } : {}), ...(vehicle ? { vehicle } : {}), ...(etaAt ? { etaAt } : {}),
    status, source: 'skip:driver_status', updatedAt: now,
  };
  return { ...order, timeline: { ...order.timeline, courier }, updatedAt: now };
}

function advanceSkipDriver(order: StoredOrder, now: string): SkipLifecycleResult {
  const timeline = order.timeline ?? {};
  const driverStatus = timeline.courier?.status;
  const open = ['new', 'accepted', 'ready'].includes(order.status);
  if (driverStatus === 'picked_up' && open) {
    const moved: StoredOrder = { ...order, status: 'dispatched', timeline: { ...timeline, readyAt: timeline.readyAt ?? now, dispatchedAt: timeline.dispatchedAt ?? now } };
    return { order: moved, isNew: false, outcome: 'received', driverAdvanced: true };
  }
  if (driverStatus === 'delivered' && (open || order.status === 'dispatched')) {
    const moved: StoredOrder = { ...order, status: 'completed', timeline: { ...timeline, dispatchedAt: timeline.dispatchedAt ?? now, completedAt: timeline.completedAt ?? now } };
    return { order: moved, isNew: false, outcome: 'received', driverAdvanced: true };
  }
  return { order, isNew: false, outcome: 'received' };
}

function validSkipJetAttempt(attempt: SkipJetAttempt | undefined): attempt is SkipJetAttempt {
  return typeof attempt?.id === 'string' && Boolean(attempt.id) && typeof attempt.at === 'string' && Boolean(attempt.at)
    && (attempt.signal === 'accept' || attempt.signal === 'fallback')
    && (attempt.outcome === undefined || ['accepted', 'fallback', 'uncertain'].includes(attempt.outcome));
}

// Recognize generated transport outcomes by prefix. A definite 4xx can mention a timeout in its response body.
const LEGACY_CLOVER_UNCERTAIN_ERROR = /^(?:(?:clover )?(?:network error|(?:(?:request|operation) (?:was )?|(?:the|this) operation was )?(?:timeout|timed out|aborted)|(?:returned )?http 5[0-9]{2}|(?:response )?did not include an order id)|skip clover receipt needs review)(?:[\s:.]|$)/i;
const DEFINITE_CLOVER_REFUSAL = /^Clover returned HTTP (?:400|401|403|404|405|415|422|429)(?:[\s:.]|$)/i;
export const LEGACY_SKIP_CLOVER_REVIEW = 'Skip Clover receipt needs review: Verify the original register and the earlier result before retrying.';
type CloverRetryLease = NonNullable<OrderTimeline['posRetry']>;
const nonblank = (value: unknown): boolean => typeof value === 'string' && Boolean(value.trim());

function isOnlyCloverResumeLease(retry: CloverRetryLease | undefined): retry is CloverRetryLease {
  return retry?.resumeOnly === true && retry.uncertain === true && retry.attempts === 0 && retry.nextAt === null
    && nonblank(retry.claim) && nonblank(retry.claimedAt) && retry.lastError == null && retry.gaveUpAt == null && retry.doneAt == null;
}

export function hasUnresolvedLegacySkipCloverReceipt(order: Pick<StoredOrder, 'channel' | 'viaHub' | 'viaPos' | 'posOrderId' | 'posError' | 'timeline'>): boolean {
  const timeline = order.timeline;
  const uncertainError = (value: unknown) => typeof value === 'string' && LEGACY_CLOVER_UNCERTAIN_ERROR.test(value.trim());
  if (order.channel !== 'skip' || order.viaHub || order.viaPos || timeline?.posCreateAttempt !== undefined
    || (nonblank(order.posOrderId) && nonblank(timeline?.posMerchantId))) return false;
  const retry = timeline?.posRetry;
  if (uncertainError(order.posError) || uncertainError(retry?.lastError)) return true;
  return retry?.uncertain === true && !isOnlyCloverResumeLease(retry);
}

function skipJetResult(order: StoredOrder, input: SkipJetInput, now: string): SkipLifecycleResult {
  const timeline = (order.timeline ?? {});
  const { skipJetAttempt: attempt, ...unclaimed } = timeline;
  const conflict = { order: null, isNew: false, outcome: 'conflicting_jet' } as const;
  const current = { order, isNew: false };
  if (order.status === 'cancelled') return { ...current, outcome: 'cancelled' };
  if (input.kind === 'prepare_jet') {
    if (order.status !== 'new') return { ...current, outcome: 'ignored' };
    if (attempt !== undefined) return validSkipJetAttempt(attempt) ? { ...current, outcome: 'jet_pending' } : conflict;
    const pos = Boolean(order.posOrderId?.trim());
    const knownReceipt = pos && Boolean(timeline.posMerchantId?.trim());
    if (!pos && timeline.posCreateAttempt !== undefined) return { ...current, outcome: 'attempt_pending' };
    if ((input.signal === 'accept' && input.manual !== true && !knownReceipt)
      || (input.signal === 'fallback' && pos && (input.manual !== true || !knownReceipt))) return conflict;
    const skipJetAttempt: SkipJetAttempt = { id: crypto.randomUUID(), at: now, signal: input.signal, ...(input.manual === true ? { manual: true } : {}) };
    const claimed: OrderTimeline = { ...timeline, skipJetAttempt };
    return { order: { ...order, timeline: claimed, updatedAt: now }, isNew: false, outcome: 'jet_prepared' };
  }
  if (!validSkipJetAttempt(attempt) || input.attemptId !== attempt.id) return conflict;
  if (attempt.outcome === 'accepted' || attempt.outcome === 'fallback') {
    return attempt.outcome === input.result ? { ...current, outcome: 'jet_finished' } : conflict;
  }
  if (order.status !== 'new') return { ...current, outcome: 'ignored' };
  if (attempt.outcome === 'uncertain' && input.result === 'uncertain') return { ...current, outcome: 'jet_pending' };
  const fields = input.fields ?? {};
  const status = input.result === 'accepted' ? 'accepted' : input.result === 'fallback' ? 'failed' : order.status;
  const nextTimeline: OrderTimeline = input.result === 'refused' ? unclaimed : { ...timeline, skipJetAttempt: { ...attempt, outcome: input.result } };
  if (input.result === 'accepted') {
    nextTimeline.acceptedAt = now;
    nextTimeline.acceptedBy = fields.acceptedBy || (attempt.manual ? undefined : 'auto');
  }
  if (input.result === 'accepted' || input.result === 'fallback') {
    if (!nextTimeline.seenAt && fields.seenAt) nextTimeline.seenAt = fields.seenAt;
    if (!nextTimeline.seenBy && fields.seenBy) nextTimeline.seenBy = fields.seenBy;
    if (fields.approvedBy) nextTimeline.approvedBy = fields.approvedBy;
  }
  const channelError = input.result === 'accepted' ? undefined
    : fields.channelError ?? (input.result === 'fallback' ? 'Sent to the Skip tablet (backup flow).' : order.channelError);
  return { order: { ...order, status, timeline: nextTimeline, channelError, updatedAt: now }, isNew: false,
    outcome: input.result === 'uncertain' ? 'jet_pending' : 'jet_finished', finished: true };
}

// No asynchronous boundary between the memory decision, order write and event append, mirroring the SQL atom.
function applySkipPaymentInMemory(input: SkipPaymentInput): SkipLifecycleResult {
  const state = memState();
  const { kind, paymentReference, ...identity } = input;
  const conflict = { order: null, isNew: false, outcome: 'conflicting_payment' } as const;
  if (!paymentReference.trim() || paymentReference.length > 32) return conflict;
  const checked = applySkipLifecycleInMemory({ kind: 'check_receipt', orderId: identity.orderId, externalOrderId: identity.externalOrderId,
    merchantId: identity.merchantId, posOrderId: identity.posOrderId });
  const order = checked.order;
  if (!order) return conflict;
  const attempts = state.skipPayments ??= new Map();
  let attempt = attempts.get(order.id);
  if (attempt && (attempt.merchantId !== identity.merchantId || attempt.posOrderId !== identity.posOrderId || attempt.paymentReference !== paymentReference)) return conflict;
  const { merchantId, posOrderId } = identity;
  if (!attempt && ([...attempts.values()].some((other) => other.merchantId === merchantId && other.posOrderId === posOrderId)
    || [...state.orders.values()].some((other) => other.id !== order.id && other.posOrderId === posOrderId && other.timeline?.posMerchantId === merchantId
      && (Boolean(other.timeline?.posPaymentId) || hasUncertainEarlierPayment(other.timeline?.posPaymentError))))) return conflict;

  const result = (outcome: SkipLifecycleResult['outcome'], current = order): SkipLifecycleResult => ({
    ...checked, order: current, outcome, ...(attempt ? { paymentAttempt: attempt } : {}),
  });
  const markReview = () => {
    const reviewed = order.timeline?.posPaymentError === SKIP_PAYMENT_REVIEW ? order
      : { ...order, timeline: { ...order.timeline, posPaymentError: SKIP_PAYMENT_REVIEW }, updatedAt: nowIso() };
    if (reviewed !== order) state.orders.set(order.id, reviewed);
    if (!state.events.some((event) => event.orderId === order.id && event.type === 'needs_attention'
      && event.detail?.source === 'skip_clover_payment' && event.detail.attemptId === attempt?.id)) {
      state.events.push({ id: crypto.randomUUID(), orderId: order.id, type: 'needs_attention',
        detail: { reason: SKIP_PAYMENT_REVIEW, source: 'skip_clover_payment', attemptId: attempt?.id }, at: reviewed.updatedAt });
    }
    return result(kind !== 'finish_payment' && order.status === 'cancelled' ? 'cancelled' : 'payment_pending', reviewed);
  };
  const confirmPaid = (paid: StoredOrder): SkipLifecycleResult => {
    if (input.kind !== 'finish_payment' || input.result !== 'paid' || !input.closeTerminal
        || (paid.status !== 'cancelled' && paid.status !== 'failed') || paid.timeline?.posClosedAt) return result('payment_finished', paid);
    const close = paid.timeline?.posCloseClaim;
    if (close && !(Date.parse(close.at) <= Date.now() - 5 * 60_000)) return result('payment_finished', paid);
    const at = nowIso();
    const finalized = { ...paid, timeline: { ...paid.timeline, posClosedAt: at, posCloseClaim: undefined }, updatedAt: at };
    state.orders.set(paid.id, finalized);
    state.events.push({ id: crypto.randomUUID(), orderId: paid.id, type: 'pos_paid_then_cancelled',
      detail: { message: 'Cancelled after it was recorded as paid in Clover — refund it in the Clover app if the platform did not pay you.' }, at });
    return { ...result('payment_finished', finalized), completedClosure: true };
  };

  if (kind === 'finish_payment') {
    if (!attempt || attempt.id !== input.attemptId) return conflict;
    const storedPaymentId = order.timeline?.posPaymentId;
    if (attempt.state === 'paid') {
      if (input.result !== 'paid' || attempt.paymentId !== input.paymentId) return conflict;
      if (storedPaymentId === input.paymentId) return confirmPaid(order);
      if (storedPaymentId || !input.closeTerminal || (order.status !== 'cancelled' && order.status !== 'failed')) return conflict;
      const restored = { ...order, timeline: { ...order.timeline, posPaymentId: input.paymentId, posPaymentError: undefined }, updatedAt: nowIso() };
      state.orders.set(order.id, restored);
      return confirmPaid(restored);
    }
    if (input.result === 'refused') {
      if (attempt.state !== 'sending' || storedPaymentId) return conflict;
      attempts.delete(order.id);
      state.skipPaymentRecovery?.delete(attempt.id);
      attempt = undefined;
      if (!input.error?.trim() || (order.status !== 'dispatched' && order.status !== 'completed')) return result('payment_finished');
      const error = input.error.slice(0, 500);
      const refused = { ...order, timeline: { ...order.timeline, posPaymentError: error }, updatedAt: nowIso() };
      state.orders.set(order.id, refused);
      state.events.push({ id: crypto.randomUUID(), orderId: order.id, type: 'pos_payment_failed',
        detail: { error, attemptId: input.attemptId }, at: refused.updatedAt });
      return result('payment_finished', refused);
    }
    if (input.result === 'uncertain') {
      if (storedPaymentId) return conflict;
      attempt = { ...attempt, state: 'uncertain' };
      attempts.set(order.id, attempt);
      return markReview();
    }
    if (input.result !== 'paid' || !input.paymentId.trim() || (storedPaymentId && storedPaymentId !== input.paymentId)) return conflict;
    const paid = { ...order, timeline: { ...order.timeline, posPaymentId: input.paymentId, posPaymentError: undefined }, updatedAt: nowIso() };
    attempt = { ...attempt, state: 'paid', paymentId: input.paymentId };
    attempts.set(order.id, attempt);
    state.orders.set(order.id, paid);
    if (!storedPaymentId) state.events.push({ id: crypto.randomUUID(), orderId: order.id, type: 'pos_paid',
      detail: { message: 'Recorded as paid in Clover (Skip tender)', paymentId: input.paymentId }, at: paid.updatedAt });
    return confirmPaid(paid);
  }

  if (kind === 'prepare_payment' && input.attemptId && (!attempt || attempt.id !== input.attemptId)) return conflict;
  if (attempt?.state === 'paid') {
    if (!attempt.paymentId || (order.timeline?.posPaymentId && order.timeline.posPaymentId !== attempt.paymentId)) return conflict;
    if (order.timeline?.posPaymentId === attempt.paymentId) return result('payment_finished');
    const paid = { ...order, timeline: { ...order.timeline, posPaymentId: attempt.paymentId, posPaymentError: undefined }, updatedAt: nowIso() };
    state.orders.set(order.id, paid);
    return result('payment_finished', paid);
  }
  if (order.timeline?.posPaymentId) return result('payment_finished');
  const active = !order.timeline?.posClosedAt && (order.status === 'dispatched' || order.status === 'completed');
  if (attempt) {
    if (order.status === 'cancelled') return result('cancelled');
    return result(kind === 'prepare_payment' && input.attemptId && attempt.state === 'sending' && active ? 'payment_prepared' : 'payment_pending');
  }
  if (hasUncertainEarlierPayment(order.timeline?.posPaymentError)) {
    attempt = { id: crypto.randomUUID(), at: nowIso(), merchantId, posOrderId, paymentReference, state: 'uncertain' };
    attempts.set(order.id, attempt);
    return markReview();
  }
  if (kind === 'check_payment' || !active) return result(order.status === 'cancelled' ? 'cancelled' : 'received');

  attempt = { id: crypto.randomUUID(), at: nowIso(), merchantId, posOrderId, paymentReference, state: 'sending' };
  attempts.set(order.id, attempt);
  return result('payment_prepared');
}

function applySkipLifecycleInMemory(input: SkipLifecycleInput): SkipLifecycleResult {
  if (input.kind === 'prepare_payment' || input.kind === 'check_payment' || input.kind === 'finish_payment') return applySkipPaymentInMemory(input);
  const state = memState();
  const externalOrderId = skipNoticeReference(input);
  const now = nowIso();
  const key = `pending:skip:${externalOrderId}`;
  const pending = state.kv.get(key) as PendingPlatformEvents | undefined;
  let existing = [...state.orders.values()].find((order) => order.channel === 'skip' && order.externalOrderId === externalOrderId);
  const direct = existing && !existing.viaHub && !existing.viaPos;
  const driver = input.kind === 'apply_driver' ? input : null;
  if (driver && (!existing || !direct || existing.id !== driver.orderId || !SKIP_DRIVER_STATES.includes(driver.driver.status))) {
    return { order: null, isNew: false, outcome: 'ignored' };
  }
  const receipt = 'posOrderId' in input ? input : null;
  const timeline = existing?.timeline;
  const knownMerchant = timeline?.posMerchantId;
  const attempt = timeline?.posCreateAttempt;
  const invalidAttempt = attempt !== undefined && (typeof attempt?.id !== 'string' || !attempt.id
    || typeof attempt.at !== 'string' || !attempt.at || typeof attempt.merchantId !== 'string' || !attempt.merchantId.trim());
  const active = existing && ['new', 'accepted', 'ready', 'dispatched'].includes(existing.status);
  const legacyUncertain = existing && hasUnresolvedLegacySkipCloverReceipt(existing);
  if (input.kind === 'hold_legacy_clover') {
    if (!existing || !direct || existing.id !== input.orderId) return { order: null, isNew: false, outcome: 'conflicting_attempt' };
    if (!legacyUncertain) return { order: existing, isNew: false, outcome: 'ignored' };
    const retry = timeline?.posRetry;
    const previous = nonblank(existing.posError) ? existing.posError : nonblank(retry?.lastError) ? retry?.lastError : undefined;
    const reason = previous?.startsWith(LEGACY_SKIP_CLOVER_REVIEW) ? previous : `${LEGACY_SKIP_CLOVER_REVIEW}${previous ? ` ${previous}` : ''}`;
    const clearRetry = Boolean(retry && typeof retry === 'object' && !Array.isArray(retry) && retry.nextAt !== null);
    if (existing.posError !== reason || clearRetry) {
      existing = { ...existing, posError: reason, updatedAt: now, ...(clearRetry && retry ? { timeline: { ...timeline, posRetry: { ...retry, nextAt: null } } } : {}) };
      state.orders.set(existing.id, existing);
    }
    const orderId = existing.id;
    const source = 'legacy_skip_clover_receipt';
    if (!state.events.some((event) => event.orderId === orderId && event.type === 'needs_attention' && event.detail?.source === source)) {
      state.events.push({ id: crypto.randomUUID(), orderId, type: 'needs_attention', detail: { reason, source }, at: now });
    }
    return { order: existing, isNew: false, outcome: 'legacy_clover_uncertain' };
  }
  const jet = input.kind === 'prepare_jet' || input.kind === 'finish_jet' ? input : null;
  const jetAttempt = timeline?.skipJetAttempt;
  if (jet && (!existing || !direct || existing.id !== jet.orderId
    || (jet.kind === 'prepare_jet' && !['accept', 'fallback'].includes(jet.signal))
    || (jet.kind === 'finish_jet' && (!validSkipJetAttempt(jetAttempt) || jetAttempt.id !== jet.attemptId
      || !['accepted', 'fallback', 'refused', 'uncertain'].includes(jet.result)
      || (jet.result === 'accepted' && jetAttempt.signal !== 'accept') || (jet.result === 'fallback' && jetAttempt.signal !== 'fallback'))))) {
    return { order: null, isNew: false, outcome: 'conflicting_jet' };
  }
  if (receipt && (!existing || !direct || existing.id !== receipt.orderId || !receipt.posOrderId.trim() || !receipt.merchantId.trim()
    || invalidAttempt || (attempt && attempt.merchantId !== receipt.merchantId)
    || (existing.posOrderId && existing.posOrderId !== receipt.posOrderId) || (knownMerchant && knownMerchant !== receipt.merchantId)
    || (receipt.kind === 'check_receipt' && (existing.posOrderId !== receipt.posOrderId || knownMerchant !== receipt.merchantId)))) {
    return { order: null, isNew: false, outcome: 'conflicting_receipt' };
  }
  const preparing = input.kind === 'prepare_clover';
  if (preparing || input.kind === 'clear_clover_attempt') {
    if (!existing || !direct || existing.id !== input.orderId || !input.merchantId.trim()) {
      return { order: null, isNew: false, outcome: 'conflicting_attempt' };
    }
    if ((existing.posOrderId && (!preparing || !legacyUncertain)) || (preparing && !active && existing.status !== 'cancelled')) {
      return { order: existing, isNew: false, outcome: 'ignored' };
    }
    if (input.kind === 'clear_clover_attempt') {
      if (invalidAttempt || !attempt || attempt.id !== input.attemptId || attempt.merchantId !== input.merchantId) {
        return { order: null, isNew: false, outcome: 'conflicting_attempt' };
      }
      const { posCreateAttempt: _cleared, ...rest } = timeline ?? {};
      // A reconciliation while the HTTP request was in flight may have left an uncertainty message on this exact attempt.
      const refused = input.definiteError && DEFINITE_CLOVER_REFUSAL.test(input.definiteError) ? input.definiteError : existing.posError;
      const order = { ...existing, timeline: rest, posError: refused, updatedAt: now };
      state.orders.set(existing.id, order);
      return { order, isNew: false, outcome: 'attempt_cleared' };
    }
  }
  const activeAttemptCheck = active && !invalidAttempt && Boolean(attempt);
  if (input.kind === 'check_intake' && (!existing || !direct || (existing.status !== 'new' && !activeAttemptCheck) || existing.posOrderId)) {
    return { order: existing ?? null, isNew: false, outcome: 'ignored' };
  }
  if (input.kind === 'intake') {
    if (input.order.viaHub || input.order.viaPos) return { order: null, isNew: false, outcome: 'ignored' };
    const existingStore = existing?.channelStoreId;
    const inputStore = input.order.channelStoreId;
    const blank = /^[ \t\n\r\f\v]*$/;
    if (!blank.test(existingStore ?? '') && !blank.test(inputStore ?? '') && existingStore !== inputStore) {
      return { order: null, isNew: false, outcome: 'conflicting_store' };
    }
    if (existing && (!direct || existing.status !== 'new')) return { order: existing, isNew: false, outcome: 'received' };
  }
  const parked = pending && !pending.consumedAt && pending.status && /cancel|fail/i.test(pending.status.platformState) ? pending : undefined;
  const cancellation = input.kind === 'cancel'
    ? { platformState: 'cancelled', detail: input.detail, at: now }
    : parked?.status ?? pendingInboxCancel(state, externalOrderId);

  const backup = (preparing || jet || receipt || driver) && direct && existing && !cancellation ? pendingInboxBackup(state, existing) : undefined;

  if (driver && existing) {
    existing = applySkipDriverObservation(existing, driver.driver, now);
    state.orders.set(existing.id, existing);
    if (!cancellation && !backup) {
      const result = advanceSkipDriver(existing, now);
      if (result.driverAdvanced && result.order) state.orders.set(existing.id, result.order);
      return result;
    }
  }

  if (!cancellation && !backup && existing && legacyUncertain && ((preparing && active) || (jet?.kind === 'prepare_jet' && existing.status === 'new'))) {
    return { order: existing, isNew: false, outcome: 'legacy_clover_uncertain' };
  }

  if (jet && existing && !cancellation && !backup) {
    const result = skipJetResult(existing, jet, now);
    if (result.order && (result.finished || result.outcome === 'jet_prepared')) state.orders.set(existing.id, result.order);
    return result;
  }

  if (preparing && existing && !cancellation && !backup) {
    if (existing.status === 'cancelled') return { order: existing, isNew: false, outcome: 'cancelled' };
    if (invalidAttempt || knownMerchant) return { order: null, isNew: false, outcome: 'conflicting_attempt' };
    if (attempt) return { order: existing, isNew: false, outcome: 'attempt_pending' };
    // A confirmed, explicit manual accept may legitimately be followed by a later POS hand-entry/resend.
    if (jetAttempt !== undefined && !(validSkipJetAttempt(jetAttempt) && jetAttempt.manual === true && jetAttempt.signal === 'accept'
      && jetAttempt.outcome === 'accepted' && existing.status !== 'new' && input.allowAfterManualAcceptance === true)) {
      return { order: existing, isNew: false, outcome: 'jet_pending' };
    }
    // A saved cancellation or attempt takes precedence. Check the mapping only before authorizing a new POST.
    const expected = input.storeMapping;
    const storeId = existing.channelStoreId;
    const mapping = [...state.stores.values()].find((store) => store.channel === 'skip' && store.channelStoreId === storeId);
    const matches = expected === null ? !mapping : Boolean(expected?.updatedAt && mapping
      && expected.id === mapping.id && expected.channelStoreId === mapping.channelStoreId
      && expected.locationCode === mapping.locationCode && mapping.locationCode === existing.locationCode
      && expected.updatedAt === mapping.updatedAt
      && (expected.cloverMerchantId ?? null) === (mapping.cloverMerchantId ?? null)
      && (!mapping.cloverMerchantId || mapping.cloverMerchantId === input.merchantId));
    if (!matches) return { order: existing, isNew: false, outcome: 'mapping_changed' };
    const nextTimeline: OrderTimeline = {
      ...timeline, posCreateAttempt: { merchantId: input.merchantId, at: now, id: crypto.randomUUID() },
    };
    const retry = timeline?.posRetry;
    if (isOnlyCloverResumeLease(retry)) {
      const { resumeOnly: _consumed, ...rest } = retry;
      nextTimeline.posRetry = { ...rest, uncertain: false };
    }
    const order = { ...existing, timeline: nextTimeline, updatedAt: now };
    state.orders.set(existing.id, order);
    return { order, isNew: false, outcome: 'prepared' };
  }

  if (input.kind === 'cancel' && !existing) {
    const { consumedAt: _consumed, ...previous } = pending ?? {};
    state.kv.set(key, { ...previous, status: cancellation });
    return { order: null, isNew: false, outcome: 'parked' };
  }
  if (input.kind === 'backup' && existing?.channelStoreId && existing.channelStoreId !== input.order.channelStoreId
    && (input.mappedStore || (direct && existing.channelStoreId.trim()))) {
    return { order: null, isNew: false, outcome: 'conflicting_store' };
  }
  if (input.kind === 'backup' && !existing && (input.order.viaHub || input.order.viaPos)) {
    return { order: null, isNew: false, outcome: 'ignored' };
  }
  const isNew = !existing;
  let order = existing ?? ('order' in input
    ? { ...input.order, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    : null);
  if (!order) throw new Error('Missing Skip order');
  const orderId = order.id;

  const addEvent = (type: string, detail: Record<string, unknown>) => {
    state.events.push({ id: crypto.randomUUID(), orderId, type, detail: JSON.parse(JSON.stringify(detail)), at: now });
  };
  const consumePending = () => {
    if (input.kind !== 'cancel' && parked) state.kv.set(key, { ...parked, consumedAt: now });
  };

  let recorded: true | undefined;
  if (input.kind === 'record_receipt' && existing) {
    const retry = existing.timeline?.posRetry;
    const finishRetry = retry && (retry.nextAt !== null || !retry.doneAt);
    if (existing.posOrderId !== input.posOrderId || knownMerchant !== input.merchantId || existing.posError !== undefined || finishRetry) {
      const timeline: OrderTimeline = { ...existing.timeline, posMerchantId: input.merchantId };
      if (finishRetry) timeline.posRetry = { ...retry, nextAt: null, doneAt: retry.doneAt || now };
      existing = { ...existing, timeline, posOrderId: input.posOrderId, posError: undefined, updatedAt: now };
      state.orders.set(existing.id, existing);
      order = existing;
    }
    if (!state.events.some((event) => event.orderId === orderId && ['pos_injected', 'pos_adopted'].includes(event.type)
      && event.detail?.posOrderId === input.posOrderId)) {
      addEvent(input.adopted ? 'pos_adopted' : 'pos_injected', { ...input.evidence, posOrderId: input.posOrderId, merchantId: input.merchantId });
      recorded = true;
    }
  }
  const receiptOutcome = recorded ? { recorded } : {};
  if (backup) {
    const message = 'Skip sent this order to the tablet. Make it from the Skip tablet.';
    const backedUp = { ...order, status: 'failed' as const, channelError: message, updatedAt: now };
    state.orders.set(order.id, backedUp);
    const { validationError, unknownReference, menuId } = backup;
    addEvent('routed_to_skip_tablet', { validationError, unknownReference, menuId, message, source: 'signed_skip_backup_inbox' });
    return { order: backedUp, isNew: false, outcome: 'backed_up', ...receiptOutcome };
  }
  if (receipt && existing && !cancellation) {
    return { order: existing, isNew: false, outcome: existing.status === 'cancelled' ? 'cancelled' : 'received', ...receiptOutcome };
  }

  if (existing) {
    if (direct && input.kind === 'backup' && !cancellation && existing.status === 'failed'
      && ((validSkipJetAttempt(jetAttempt) && jetAttempt.signal === 'fallback' && jetAttempt.outcome === 'fallback')
        || state.events.some((event) => event.orderId === order.id && event.type === 'routed_to_skip_tablet'))) {
      return { order: existing, isNew: false, outcome: 'backed_up' };
    }
    if ((input.kind === 'cancel' || direct) && cancellation && existing.status === 'cancelled') {
      consumePending();
      return { order: existing, isNew: false, outcome: 'cancelled', ...receiptOutcome };
    }
    if (input.kind === 'backup' && (!direct || (!['new', 'accepted', 'ready'].includes(existing.status)
      && !(cancellation && existing.status === 'failed')))) {
      consumePending();
      const detail = JSON.parse(JSON.stringify({ ...input.detail, status: existing.status }));
      if (!state.events.some((event) => event.orderId === order.id && event.type === 'skip_backup_ignored' && isDeepStrictEqual(event.detail, detail))) {
        addEvent('skip_backup_ignored', detail);
      }
      return { order: existing, isNew: false, outcome: 'ignored' };
    }
  }

  if (cancellation) {
    const reason = String(cancellation.detail?.reason ?? cancellation.detail?.event ?? 'Cancelled on the platform');
    const cancelled: StoredOrder = {
      ...order, status: 'cancelled', updatedAt: now, channelError: input.kind === 'backup' ? undefined : existing?.channelError,
      timeline: { ...existing?.timeline, cancelledAt: now, cancelledBy: /customer|eater/i.test(reason) ? 'customer' : 'platform',
        cancelStage: existing?.timeline?.acceptedAt ? 'after_accept' : 'before_accept', cancelReason: reason },
    };
    state.orders.set(order.id, cancelled);
    consumePending();
    addEvent('platform_status', { ...cancellation.detail, state: cancellation.platformState, at: cancellation.at ?? now });
    return { order: cancelled, isNew, outcome: 'cancelled', transitioned: true, ...receiptOutcome };
  }
  if (input.kind === 'intake' || input.kind === 'check_intake') {
    if (existing) return { order: existing, isNew: false, outcome: 'received' };
    const received: StoredOrder = { ...order, status: 'new', timeline: {} };
    state.orders.set(order.id, received);
    return { order: received, isNew: true, outcome: 'received' };
  }
  if (input.kind !== 'backup') throw new Error('Missing Skip cancellation');
  const backedUp: StoredOrder = { ...order, status: 'failed', updatedAt: now, channelError: input.message, timeline: existing?.timeline ?? {} };
  state.orders.set(order.id, backedUp);
  addEvent('routed_to_skip_tablet', { ...input.detail, message: input.message });
  return { order: backedUp, isNew, outcome: 'backed_up' };
}

const memoryRepo: FoodHubRepo = {
  mode: 'memory',
  async applySkipLifecycle(input) { return applySkipLifecycleInMemory(input); },
  async claimSkipPaymentRecoveries(input) {
    const state = memState();
    const schedule = state.skipPaymentRecovery ??= new Map();
    const now = Date.parse(input.now);
    const due = [...(state.skipPayments?.entries() ?? [])].flatMap(([orderId, paymentAttempt]) => {
      const order = state.orders.get(orderId);
      if (!order || order.channel !== 'skip' || order.viaHub || order.viaPos
          || order.posOrderId !== paymentAttempt.posOrderId || order.timeline?.posMerchantId !== paymentAttempt.merchantId) return [];
      const marker = order.timeline?.posPaymentId;
      const attemptedAt = Date.parse(paymentAttempt.at);
      const dueAt = schedule.get(paymentAttempt.id)?.due ?? attemptedAt;
      if (!(dueAt <= now)) return [];
      if (paymentAttempt.state === 'paid') {
        if ((order.status !== 'cancelled' && order.status !== 'failed') || order.timeline?.posClosedAt
            || (marker && marker !== paymentAttempt.paymentId)) return [];
      } else if (marker || !(attemptedAt <= now - PAYMENT_RECOVERY_MIN_AGE_MS)) return [];
      return [{ order, paymentAttempt, dueAt, attemptedAt }];
    });
    return due.sort((a, b) => a.dueAt - b.dueAt || a.attemptedAt - b.attemptedAt || a.paymentAttempt.id.localeCompare(b.paymentAttempt.id))
      .slice(0, Math.max(0, Math.min(PAYMENT_RECOVERY_LIMIT, input.limit))).map(({ order, paymentAttempt }) => {
        const leaseId = crypto.randomUUID();
        schedule.set(paymentAttempt.id, { due: now + PAYMENT_RECOVERY_LEASE_MS, leaseId });
        return { order, paymentAttempt, leaseId };
      });
  },
  async rescheduleSkipPaymentRecovery({ attemptId, leaseId, nextCheckAt }) {
    const schedule = memState().skipPaymentRecovery;
    const current = schedule?.get(attemptId);
    const now = Date.now();
    const next = Date.parse(nextCheckAt);
    if (!schedule || !current || current.leaseId !== leaseId || current.due <= now || !Number.isFinite(next)) return false;
    schedule.set(attemptId, { due: Math.max(now + 15_000, Math.min(now + 30 * 60_000, next)) });
    return true;
  },
  async insertOrderIfNew(order) {
    const s = memState();
    for (const o of s.orders.values()) {
      if (o.channel === order.channel && o.externalOrderId === order.externalOrderId) return { order: o, isNew: false };
    }
    const stored: StoredOrder = { ...order, id: crypto.randomUUID(), status: 'new', createdAt: order.createdAt ?? nowIso(), updatedAt: nowIso() };
    s.orders.set(stored.id, stored);
    return { order: stored, isNew: true };
  },
  async getOrder(id) { return memState().orders.get(id) ?? null; },
  async findOrder(channel, externalOrderId) {
    for (const o of memState().orders.values()) if (o.channel === channel && o.externalOrderId === externalOrderId) return o;
    return null;
  },
  async updateOrder(id, patch) {
    const s = memState();
    const cur = s.orders.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: nowIso() };
    s.orders.set(id, next);
    return next;
  },
  async patchOrder(id, timeline, extra = {}, guard) {
    const cur = memState().orders.get(id);
    if (!cur || (guard && !guard(cur))) return null;
    return memoryRepo.updateOrder(id, { ...extra, timeline: { ...(cur.timeline ?? {}), ...timeline } });
  },
  async listOrders(filter = {}) {
    let list = [...memState().orders.values()];
    if (filter.statuses?.length) list = list.filter((o) => filter.statuses!.includes(o.status));
    if (filter.since) list = list.filter((o) => o.createdAt >= filter.since!);
    if (filter.until) list = list.filter((o) => o.createdAt < filter.until!);
    if (filter.locationCodes?.length) list = list.filter((o) => o.locationCode && filter.locationCodes!.includes(o.locationCode));
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, filter.limit ?? 200);
  },
  async addEvent(orderId, type, detail = {}) {
    memState().events.push({ id: crypto.randomUUID(), orderId, type, detail, at: nowIso() });
  },
  async listEvents(orderId) { return memState().events.filter((e) => e.orderId === orderId); },
  async listStores(channel) {
    const list = [...memState().stores.values()];
    return (channel ? list.filter((s) => s.channel === channel) : list).sort((a, b) => (a.brandName + a.locationCode).localeCompare(b.brandName + b.locationCode));
  },
  async findStore(channel, channelStoreId) {
    for (const s of memState().stores.values()) if (s.channel === channel && s.channelStoreId === channelStoreId) return s;
    return null;
  },
  async getStore(id) { return memState().stores.get(id) ?? null; },
  async upsertStore(store) {
    const s = memState();
    const existing = store.id ? s.stores.get(store.id) : await memoryRepo.findStore(store.channel, store.channelStoreId);
    const next: ChannelStore = { ...(existing ?? {}), ...store, id: existing?.id ?? store.id ?? crypto.randomUUID(), updatedAt: nowIso(), createdAt: existing?.createdAt ?? nowIso() } as ChannelStore;
    s.stores.set(next.id, next);
    return next;
  },
  async updateStore(id, patch, expected) {
    const s = memState();
    const cur = s.stores.get(id);
    if (!cur) return null;
    if (expected && (cur.channel !== expected.channel || cur.channelStoreId !== expected.channelStoreId || cur.locationCode !== expected.locationCode
      || cur.updatedAt !== expected.updatedAt || !isDeepStrictEqual(cur.meta, expected.meta))) return null;
    const next = { ...cur, ...patch, updatedAt: nowIso() };
    s.stores.set(id, next);
    return next;
  },
  async deleteStore(id) { memState().stores.delete(id); },
  async getMenu(brandName) { return memState().menus.get(brandName) ?? null; },
  async saveMenu(menu) {
    const next = { ...menu, updatedAt: nowIso() };
    memState().menus.set(menu.brandName, next);
    return next;
  },
  async listMenus() { return [...memState().menus.values()]; },
  async addJob(job) {
    const full: FoodHubJob = { ...job, id: crypto.randomUUID(), createdAt: nowIso(), updatedAt: nowIso() };
    memState().jobs.set(full.id, full);
    return full;
  },
  async findJobByReference(reference) {
    // Newest first, same as the Supabase implementation.
    return [...memState().jobs.values()].reverse().find((j) => j.reference === reference) ?? null;
  },
  async updateJob(id, patch) {
    const s = memState();
    const cur = s.jobs.get(id);
    if (cur) s.jobs.set(id, { ...cur, ...patch, updatedAt: nowIso() });
  },
  async listJobs(limit = 50) {
    return [...memState().jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  },
  async getKv<T>(key: string) { return (memState().kv.get(key) as T) ?? null; },
  async setKv(key, value) { memState().kv.set(key, JSON.parse(JSON.stringify(value))); },
  async claimKv(key, value) {
    const kv = memState().kv;
    if (kv.has(key)) return false;
    kv.set(key, JSON.parse(JSON.stringify(value)));
    return true;
  },
  async releaseKv(key) { memState().kv.delete(key); },
  async addActivity(entry) { memState().activity.push({ ...entry, id: entry.id ?? crypto.randomUUID() }); },
  async listActivity(filter = {}) {
    let list = [...memState().activity];
    if (filter.since) list = list.filter((a) => a.at >= filter.since!);
    if (filter.until) list = list.filter((a) => a.at < filter.until!);
    if (filter.kinds?.length) list = list.filter((a) => filter.kinds!.includes(a.kind));
    if (filter.locationCodes?.length) list = list.filter((a) => !a.locationCode || filter.locationCodes!.includes(a.locationCode));
    return list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, filter.limit ?? 500);
  },
  async listUsers() { return [...memState().users.values()].sort((a, b) => a.username.localeCompare(b.username)); },
  async putDocs(collection, docs) {
    const st = memState();
    if (!st.docs) st.docs = new Map();
    const col = st.docs.get(collection) ?? new Map();
    for (const d of docs) col.set(d.id, JSON.parse(JSON.stringify(d)));
    st.docs.set(collection, col);
  },
  async insertDocIfAbsent(collection, doc) {
    const state = memState();
    if (!state.docs) state.docs = new Map();
    const rows = state.docs.get(collection) ?? new Map();
    if (rows.has(doc.id)) return false;
    rows.set(doc.id, JSON.parse(JSON.stringify(doc)));
    state.docs.set(collection, rows);
    return true;
  },
  async listDocs<T>(collection: string, filter: DocFilter = {}) {
    const col = memState().docs?.get(collection);
    let list = col ? [...col.values()] as Doc<T>[] : [];
    if (filter.since) list = list.filter((d) => (d.at ?? '') >= filter.since!);
    if (filter.until) list = list.filter((d) => (d.at ?? '') < filter.until!);
    if (filter.keys?.length) list = list.filter((d) => d.key && filter.keys!.includes(d.key));
    list.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
    return list.slice(0, filter.limit ?? 100_000);
  },
  async getDoc<T>(collection: string, id: string) { return (memState().docs?.get(collection)?.get(id) as Doc<T> | undefined) ?? null; },
  async deleteDocs(collection, ids) { const col = memState().docs?.get(collection); for (const id of ids) col?.delete(id); },
  async getUser(username) { return memState().users.get(username.toLowerCase()) ?? null; },
  async saveUser(user) {
    const s = memState();
    const key = user.username.toLowerCase();
    const prev = s.users.get(key);
    const full: FoodHubUser = { ...prev, ...user, username: key, id: prev?.id ?? user.id ?? crypto.randomUUID(), createdAt: prev?.createdAt ?? user.createdAt ?? nowIso() } as FoodHubUser;
    s.users.set(key, full);
    return full;
  },
};

// ---------------------------------------------------------------------------
// Supabase repository — production. Tables are created by supabase/foodhub.sql.
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function toIso(v: unknown): string | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : (/^\d{9,13}$/.test(String(v)) ? Number(v) : NaN);
  const ms = Number.isFinite(n) ? (n < 1e11 ? n * 1000 : n) : Date.parse(String(v));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function orderToRow(o: Partial<StoredOrder>): Row {
  const row: Row = {};
  if (o.channel !== undefined) row.channel = o.channel;
  if (o.marketplace !== undefined) row.marketplace = o.marketplace;
  if (o.externalOrderId !== undefined) row.external_order_id = o.externalOrderId;
  if (o.channelStoreId !== undefined) row.channel_store_id = o.channelStoreId;
  if (o.brandName !== undefined) row.brand_name = o.brandName;
  if (o.locationCode !== undefined) row.location_code = o.locationCode;
  if (o.status !== undefined) row.status = o.status;
  if (o.total !== undefined) row.total = o.total;
  // Key presence, not value: a patch of `undefined` clears the column (the pipeline clears errors that way).
  if ('posOrderId' in o) row.pos_order_id = o.posOrderId ?? null;
  if ('posError' in o) row.pos_error = o.posError ?? null;
  if ('channelError' in o) row.channel_error = o.channelError ?? null;
  // timestamptz column: normalise whatever the partner feed sent (ISO, epoch seconds/ms, locale text → null) so the insert never fails.
  if (o.placedAt !== undefined) row.placed_at = toIso(o.placedAt);
  if (o.timeline !== undefined) row.timeline = o.timeline;
  return row;
}
export { orderToRow as orderToSupabaseRow };

const DATA_FIELDS = ['lines', 'subtotal', 'tax', 'total', 'discount', 'deliveryFee', 'tip', 'notes', 'customerName', 'courier', 'readyBy', 'fulfillment', 'mappingWarnings'] as const;

function rowToOrder(r: Row): StoredOrder {
  return {
    ...(r.data as NormalizedOrder),
    id: r.id,
    status: r.status,
    locationCode: r.location_code ?? undefined,
    brandName: r.brand_name ?? (r.data as NormalizedOrder)?.brandName,
    posOrderId: r.pos_order_id ?? undefined,
    posError: r.pos_error ?? undefined,
    channelError: r.channel_error ?? undefined,
    timeline: r.timeline ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function storeToRow(s: Partial<ChannelStore>): Row {
  const row: Row = {};
  if (s.channel !== undefined) row.channel = s.channel;
  if (s.channelStoreId !== undefined) row.channel_store_id = s.channelStoreId;
  if (s.brandName !== undefined) row.brand_name = s.brandName;
  if (s.locationCode !== undefined) row.location_code = s.locationCode;
  if (s.cloverMerchantId !== undefined) row.clover_merchant_id = s.cloverMerchantId;
  if (s.autoAccept !== undefined) row.auto_accept = s.autoAccept;
  if (s.online !== undefined) row.online = s.online;
  if (s.pausedUntil !== undefined) row.paused_until = s.pausedUntil;
  if (s.lastStatusSource !== undefined) row.last_status_source = s.lastStatusSource;
  if (s.meta !== undefined) row.meta = s.meta;
  return row;
}

function rowToStore(r: Row): ChannelStore {
  return {
    id: r.id,
    channel: r.channel,
    channelStoreId: r.channel_store_id,
    brandName: r.brand_name,
    locationCode: r.location_code,
    cloverMerchantId: r.clover_merchant_id,
    autoAccept: r.auto_accept,
    online: r.online,
    pausedUntil: r.paused_until,
    lastStatusSource: r.last_status_source,
    meta: r.meta ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToJob(r: Row): FoodHubJob {
  return { id: r.id, kind: r.kind, channel: r.channel, reference: r.reference, status: r.status, request: r.request ?? {}, result: r.result, createdAt: r.created_at, updatedAt: r.updated_at };
}

function rowToUser(r: Row): FoodHubUser {
  return {
    id: r.id, username: r.username, name: r.name, role: r.role, locations: r.locations ?? [], email: r.email ?? null, phone: r.phone ?? null,
    passwordHash: r.password_hash ?? null, pinHash: r.pin_hash ?? null, prefs: r.prefs ?? {}, active: r.active, createdAt: r.created_at, lastLoginAt: r.last_login_at,
  };
}

function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Supabase: ${res.error.message}`);
  return res.data;
}

function supabaseRepo(): FoodHubRepo {
  const db = createServiceClient();
  const repo: FoodHubRepo = {
    mode: 'supabase',
    async applySkipLifecycle(input) {
      const backup = input.kind === 'backup' ? input : null;
      const seed = 'order' in input ? input.order : null;
      let detail: Record<string, unknown> = 'detail' in input ? input.detail : {};
      if ('orderId' in input) {
        detail = { orderId: input.orderId };
        if ('merchantId' in input) detail.merchantId = input.merchantId;
        if ('posOrderId' in input) detail.posOrderId = input.posOrderId;
        if (input.kind === 'record_receipt') Object.assign(detail, { adopted: input.adopted, evidence: input.evidence });
        if (input.kind === 'clear_clover_attempt') Object.assign(detail, { attemptId: input.attemptId, definiteError: input.definiteError });
        if (input.kind === 'prepare_jet') Object.assign(detail, { signal: input.signal, manual: input.manual });
        if (input.kind === 'finish_jet') Object.assign(detail, { attemptId: input.attemptId, result: input.result, fields: input.fields });
        if (input.kind === 'apply_driver') detail.driver = input.driver;
        if ('paymentReference' in input) detail.paymentReference = input.paymentReference;
        if (input.kind === 'prepare_payment') detail.attemptId = input.attemptId;
        if (input.kind === 'finish_payment') Object.assign(detail, {
          attemptId: input.attemptId, result: input.result, ...(input.result === 'paid' && { paymentId: input.paymentId, closeTerminal: input.closeTerminal }),
          ...(input.result === 'refused' && { error: input.error }),
        });
        if (input.kind === 'prepare_clover') {
          if (input.allowAfterManualAcceptance) detail.allowAfterManualAcceptance = true;
          const store = input.storeMapping;
          detail.storeMapping = store ? {
            id: store.id, channelStoreId: store.channelStoreId, locationCode: store.locationCode,
            cloverMerchantId: store.cloverMerchantId ?? null, updatedAt: store.updatedAt,
          } : store;
        }
      }
      const result = must(await db.rpc('fh_apply_skip_lifecycle', {
        p_kind: input.kind, p_external_id: skipNoticeReference(input),
        p_order: seed ? { ...orderToRow(seed), data: seed } : null,
        p_mapped: backup?.mappedStore ?? false, p_message: backup?.message ?? null, p_detail: detail,
      })) as Omit<SkipLifecycleResult, 'order'> & { order: Row | null };
      return { ...result, order: result.order ? rowToOrder(result.order) : null };
    },
    async claimSkipPaymentRecoveries({ limit }) {
      const claims = must(await db.rpc('fh_claim_skip_payment_recoveries', { p_limit: limit })) as
        (Omit<SkipPaymentRecoveryClaim, 'order'> & { order: Row })[];
      return claims.map(({ order, ...claim }) => ({ ...claim, order: rowToOrder(order) }));
    },
    async rescheduleSkipPaymentRecovery({ attemptId, leaseId, nextCheckAt }) {
      return must(await db.rpc('fh_reschedule_skip_payment_recovery', {
        p_attempt_id: attemptId, p_lease_id: leaseId, p_next_check_at: nextCheckAt,
      })) === true;
    },
    async insertOrderIfNew(order) {
      const existing = await repo.findOrder(order.channel, order.externalOrderId);
      if (existing) return { order: existing, isNew: false };
      const { createdAt, ...rest } = order;
      const row: Row = { ...orderToRow({ ...rest, status: 'new' }), data: rest };
      if (createdAt) row.created_at = createdAt;
      const res = await db.from('fh_orders').insert(row).select('*').single();
      if (res.error) {
        // Unique (channel, external_order_id) race: another webhook delivery won. Treat as duplicate.
        const again = await repo.findOrder(order.channel, order.externalOrderId);
        if (again) return { order: again, isNew: false };
        throw new Error(`Supabase: ${res.error.message}`);
      }
      return { order: rowToOrder(res.data), isNew: true };
    },
    async getOrder(id) {
      const res = await db.from('fh_orders').select('*').eq('id', id).maybeSingle();
      const data = must(res);
      return data ? rowToOrder(data) : null;
    },
    async findOrder(channel, externalOrderId) {
      const res = await db.from('fh_orders').select('*').eq('channel', channel).eq('external_order_id', externalOrderId).maybeSingle();
      const data = must(res);
      return data ? rowToOrder(data) : null;
    },
    async updateOrder(id, patch) {
      const row: Row = { ...orderToRow(patch), updated_at: nowIso() };
      // Order details (lines, amounts…) live in the data column: merge them when they change.
      if (DATA_FIELDS.some((f) => f in patch)) {
        const cur = must(await db.from('fh_orders').select('data').eq('id', id).maybeSingle());
        if (cur) {
          const merged = { ...(cur.data ?? {}) } as Row;
          for (const f of DATA_FIELDS) if (f in patch) merged[f] = (patch as Row)[f];
          row.data = merged;
        }
      }
      const res = await db.from('fh_orders').update(row).eq('id', id).select('*').maybeSingle();
      const data = must(res);
      return data ? rowToOrder(data) : null;
    },
    async patchOrder(id, timeline, extra = {}, guard) {
      // Optimistic concurrency: write only if nobody changed the row since we read it; re-read and retry once.
      for (let attempt = 0; attempt < 2; attempt++) {
        const cur = await repo.getOrder(id);
        if (!cur || (guard && !guard(cur))) return null;
        const row: Row = { ...orderToRow({ ...extra, timeline: { ...(cur.timeline ?? {}), ...timeline } }), updated_at: nowIso() };
        const update = db.from('fh_orders').update(row).eq('id', id).eq('updated_at', cur.updatedAt);
        // Status may change within the same timestamp even though the revision check still matches.
        if (guard) update.eq('status', cur.status);
        const res = await update.select('*').maybeSingle();
        const data = must(res);
        if (data) return rowToOrder(data);
      }
      if (guard) return null;
      // Still racing after a retry: last writer wins (same as before), never lose the patch itself.
      const cur = await repo.getOrder(id);
      return cur ? repo.updateOrder(id, { ...extra, timeline: { ...(cur.timeline ?? {}), ...timeline } }) : null;
    },
    async listOrders(filter = {}) {
      // PostgREST returns at most 1000 rows per request on Supabase: page through.
      const limit = filter.limit ?? 200;
      const out: StoredOrder[] = [];
      for (let from = 0; from < limit; from += 1000) {
        const to = Math.min(limit, from + 1000) - 1;
        let q = db.from('fh_orders').select('*').order('created_at', { ascending: false }).order('id').range(from, to);
        if (filter.statuses?.length) q = q.in('status', filter.statuses);
        if (filter.since) q = q.gte('created_at', filter.since);
        if (filter.until) q = q.lt('created_at', filter.until);
        if (filter.locationCodes?.length) q = q.in('location_code', filter.locationCodes);
        const rows = (must(await q) ?? []) as Row[];
        out.push(...rows.map(rowToOrder));
        if (rows.length < to - from + 1) break;
      }
      return out;
    },
    async addEvent(orderId, type, detail = {}) {
      must(await db.from('fh_order_events').insert({ order_id: orderId, type, detail }));
    },
    async listEvents(orderId) {
      const data = must(await db.from('fh_order_events').select('*').eq('order_id', orderId).order('created_at'));
      return (data ?? []).map((r: Row) => ({ id: r.id, orderId: r.order_id, type: r.type, detail: r.detail, at: r.created_at }));
    },
    async listStores(channel) {
      let q = db.from('fh_channel_stores').select('*').order('brand_name').order('location_code');
      if (channel) q = q.eq('channel', channel);
      return (must(await q) ?? []).map(rowToStore);
    },
    async findStore(channel, channelStoreId) {
      const data = must(await db.from('fh_channel_stores').select('*').eq('channel', channel).eq('channel_store_id', channelStoreId).maybeSingle());
      return data ? rowToStore(data) : null;
    },
    async getStore(id) {
      const data = must(await db.from('fh_channel_stores').select('*').eq('id', id).maybeSingle());
      return data ? rowToStore(data) : null;
    },
    async upsertStore(store) {
      const row = { ...storeToRow(store), updated_at: nowIso() };
      const res = store.id
        ? await db.from('fh_channel_stores').update(row).eq('id', store.id).select('*').single()
        : await db.from('fh_channel_stores').upsert(row, { onConflict: 'channel,channel_store_id' }).select('*').single();
      return rowToStore(must(res));
    },
    async updateStore(id, patch, expected) {
      let query = db.from('fh_channel_stores').update({ ...storeToRow(patch), updated_at: nowIso() }).eq('id', id);
      if (expected) {
        if (!expected.updatedAt) return null;
        query = query.eq('channel', expected.channel).eq('channel_store_id', expected.channelStoreId)
          .eq('location_code', expected.locationCode).eq('updated_at', expected.updatedAt).eq('meta', JSON.stringify(expected.meta));
      }
      const data = must(await query.select('*').maybeSingle());
      return data ? rowToStore(data) : null;
    },
    async deleteStore(id) { must(await db.from('fh_channel_stores').delete().eq('id', id)); },
    async getMenu(brandName) {
      const data = must(await db.from('fh_menus').select('*').eq('brand_name', brandName).maybeSingle());
      return data ? (data.menu as MasterMenu) : null;
    },
    async saveMenu(menu) {
      const next = { ...menu, updatedAt: nowIso() };
      must(await db.from('fh_menus').upsert({ brand_name: menu.brandName, menu: next, updated_at: next.updatedAt }, { onConflict: 'brand_name' }));
      return next;
    },
    async listMenus() {
      const data = must(await db.from('fh_menus').select('menu').order('brand_name'));
      return (data ?? []).map((r: Row) => r.menu as MasterMenu);
    },
    async addJob(job) {
      const data = must(await db.from('fh_jobs').insert({ kind: job.kind, channel: job.channel, reference: job.reference, status: job.status, request: job.request, result: job.result ?? null }).select('*').single());
      return rowToJob(data);
    },
    async findJobByReference(reference) {
      const data = must(await db.from('fh_jobs').select('*').eq('reference', reference).order('created_at', { ascending: false }).limit(1).maybeSingle());
      return data ? rowToJob(data) : null;
    },
    async updateJob(id, patch) {
      const row: Row = { updated_at: nowIso() };
      if (patch.status) row.status = patch.status;
      if (patch.result !== undefined) row.result = patch.result;
      if (patch.reference !== undefined) row.reference = patch.reference;
      must(await db.from('fh_jobs').update(row).eq('id', id));
    },
    async listJobs(limit = 50) {
      const data = must(await db.from('fh_jobs').select('*').order('created_at', { ascending: false }).limit(limit));
      return (data ?? []).map(rowToJob);
    },
    async getKv<T>(key: string) {
      const data = must(await db.from('fh_kv').select('value').eq('key', key).maybeSingle());
      return data ? (data.value as T) : null;
    },
    async setKv(key, value) {
      must(await db.from('fh_kv').upsert({ key, value, updated_at: nowIso() }, { onConflict: 'key' }));
    },
    async claimKv(key, value) {
      const res = await db.from('fh_kv').insert({ key, value, updated_at: nowIso() });
      if (!res.error) return true;
      if ((res.error as { code?: string }).code === '23505') return false; // unique_violation: already claimed
      throw new Error(`Supabase: ${res.error.message}`);
    },
    async releaseKv(key) {
      must(await db.from('fh_kv').delete().eq('key', key));
    },
    async addActivity(e) {
      must(await db.from('fh_activity').insert({
        at: e.at, actor: e.actor, source: e.source, kind: e.kind, action: e.action, status: e.status, summary: e.summary,
        channel: e.channel ?? null, brand_name: e.brandName ?? null, location_code: e.locationCode ?? null, store_id: e.storeId ?? null, order_id: e.orderId ?? null, detail: e.detail ?? {},
      }));
    },
    async listActivity(filter = {}) {
      const limit = filter.limit ?? 500;
      const out: ActivityEntry[] = [];
      for (let from = 0; from < limit; from += 1000) {
        const to = Math.min(limit, from + 1000) - 1;
        let q = db.from('fh_activity').select('*').order('at', { ascending: false }).order('id').range(from, to);
        if (filter.since) q = q.gte('at', filter.since);
        if (filter.until) q = q.lt('at', filter.until);
        if (filter.kinds?.length) q = q.in('kind', filter.kinds);
        if (filter.locationCodes?.length) q = q.or(`location_code.is.null,location_code.in.(${filter.locationCodes.map((c) => `"${c}"`).join(',')})`);
        const rows = (must(await q) ?? []) as Row[];
        out.push(...rows.map((r) => ({
          id: r.id, at: r.at, actor: r.actor, source: r.source, kind: r.kind, action: r.action, status: r.status, summary: r.summary,
          channel: r.channel, brandName: r.brand_name, locationCode: r.location_code, storeId: r.store_id, orderId: r.order_id, detail: r.detail ?? {},
        })));
        if (rows.length < to - from + 1) break;
      }
      return out;
    },
    async putDocs(collection, docs) {
      for (let i = 0; i < docs.length; i += 500) {
        const rows = docs.slice(i, i + 500).map((d) => ({ collection, id: d.id, key: d.key ?? null, at: d.at ?? null, data: d.data, updated_at: nowIso() }));
        must(await db.from('fh_docs').upsert(rows, { onConflict: 'collection,id' }));
      }
    },
    async insertDocIfAbsent(collection, doc) {
      const res = await db.from('fh_docs').insert({ collection, id: doc.id, key: doc.key ?? null, at: doc.at ?? null, data: doc.data, updated_at: nowIso() });
      if (!res.error) return true;
      if (res.error.code === '23505') return false;
      throw new Error(`Supabase: ${res.error.message}`);
    },
    async listDocs<T>(collection: string, filter: DocFilter = {}) {
      const limit = filter.limit ?? 100_000;
      const out: Doc<T>[] = [];
      const keys = filter.keys?.length ? filter.keys : null;
      for (let from = 0; from < limit; from += 1000) {
        const to = Math.min(limit, from + 1000) - 1;
        let q = db.from('fh_docs').select('id,key,at,data').eq('collection', collection).order('at', { ascending: false, nullsFirst: false }).order('id').range(from, to);
        if (filter.since) q = q.gte('at', filter.since);
        if (filter.until) q = q.lt('at', filter.until);
        if (keys) q = q.in('key', keys.slice(0, 500));
        const rows = (must(await q) ?? []) as Row[];
        out.push(...rows.map((r) => ({ id: r.id, key: r.key, at: r.at, data: r.data as T })));
        if (rows.length < to - from + 1) break;
      }
      return out;
    },
    async getDoc<T>(collection: string, id: string) {
      const r = must(await db.from('fh_docs').select('id,key,at,data').eq('collection', collection).eq('id', id).maybeSingle());
      return r ? { id: r.id, key: r.key, at: r.at, data: r.data as T } : null;
    },
    async deleteDocs(collection, ids) {
      for (let i = 0; i < ids.length; i += 500) must(await db.from('fh_docs').delete().eq('collection', collection).in('id', ids.slice(i, i + 500)));
    },
    async listUsers() {
      return ((must(await db.from('fh_users').select('*').order('username')) ?? []) as Row[]).map(rowToUser);
    },
    async getUser(username) {
      const data = must(await db.from('fh_users').select('*').eq('username', username.toLowerCase()).maybeSingle());
      return data ? rowToUser(data) : null;
    },
    async saveUser(u) {
      const row = {
        username: u.username.toLowerCase(), name: u.name, role: u.role, locations: u.locations, email: u.email ? u.email.toLowerCase() : null, phone: u.phone || null,
        password_hash: u.passwordHash ?? null, pin_hash: u.pinHash ?? null, prefs: u.prefs ?? {}, active: u.active, last_login_at: u.lastLoginAt ?? null,
      };
      const data = must(await db.from('fh_users').upsert(row, { onConflict: 'username' }).select('*').single());
      return rowToUser(data);
    },
  };
  return repo;
}

let cached: FoodHubRepo | null = null;
export function getRepo(): FoodHubRepo {
  if (process.env.FOODHUB_FORCE_MEMORY === 'true' || !hasSupabaseEnv()) return memoryRepo;
  if (!cached) cached = supabaseRepo();
  return cached;
}
