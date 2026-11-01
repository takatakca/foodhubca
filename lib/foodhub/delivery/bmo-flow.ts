/**
 * Provider-agnostic BMO Request Money orchestration for sandbox simulation.
 * Implement bank adapter ONLY from the authenticated BMO 4.3.1 OpenAPI schema.
 * Store.compareAndSwap MUST be an atomic persistent database operation.
 *
 * This is not exposed from an HTTP route until merchant consent and sandbox
 * approval; production is disabled in the transport.
 * — signé : GPT-6 (ChatGPT) · 2026-11-01
 */
import {
  assertBmoOrder, bmoMayRelease, bmoMessageId, bmoPaymentLink,
  bmoStatus, type BmoOrderFingerprint, type BmoStatusObservation,
} from './bmo-gateway';

export type BmoFlowState =
  | 'reserved' | 'link_ready' | 'sms_sending' | 'sms_sent' | 'sms_uncertain'
  | 'submission_uncertain' | 'paid_verified' | 'rejected' | 'cancelled';
export interface BmoFlowRecord extends BmoOrderFingerprint {
  messageId: string;
  state: BmoFlowState;
  bankPaymentId?: string;
  paymentUrl?: string;
}
export interface BmoFlowStore {
  insertIfAbsent(record: BmoFlowRecord): Promise<boolean>; // atomic unique (merchantKey, orderId)
  read(merchantKey: string, orderId: string): Promise<BmoFlowRecord | null>;
  compareAndSwap(previous: BmoFlowRecord, next: BmoFlowRecord): Promise<boolean>;
}
export interface BmoFlowBank {
  requestMoney(order: BmoOrderFingerprint, messageId: string): Promise<{
    messageId: string; bankPaymentId: string; fulfillmentUrl: string;
  }>;
  getRequestStatus(record: BmoFlowRecord): Promise<BmoStatusObservation>;
}
export interface BmoFlowSms {
  send(to: string, message: string): Promise<void>;
}
export interface BmoFlowDependencies {
  store: BmoFlowStore; bank: BmoFlowBank;
  sms: BmoFlowSms; allowedPaymentHosts: readonly string[];
}
const keyFor = (r: BmoOrderFingerprint) => [r.merchantKey, r.orderId] as const;

/**
 * First step of an Interac-by-SMS order; does NOT send the text.
 * Failure after bank submission is UNKNOWN, not safe for an automatic new POST.
 */
export async function beginBmoCheckout(
  order: BmoOrderFingerprint, deps: BmoFlowDependencies,
): Promise<BmoFlowRecord> {
  assertBmoOrder(order);
  const messageId = bmoMessageId(order);
  const record: BmoFlowRecord = { ...order, messageId, state: 'reserved' };
  const reserved = await deps.store.insertIfAbsent(record);
  if (!reserved) {
    const previous = await deps.store.read(...keyFor(order));
    if (!previous) throw new Error('BMO reservation contention: verify database');
    if (previous.amountCents !== order.amountCents || previous.messageId !== messageId)
      throw new Error('BMO order already exists with different payment details');
    return previous; // never submit a second payment for the same order
  }
  try {
    const bank = await deps.bank.requestMoney(order, messageId);
    if (bank.messageId !== messageId || !bank.bankPaymentId?.trim())
      throw new Error('BMO response did not bind to the submitted payment');
    const paymentUrl = bmoPaymentLink(bank.fulfillmentUrl, deps.allowedPaymentHosts);
    const ready: BmoFlowRecord = {
      ...record, state: 'link_ready',
      bankPaymentId: bank.bankPaymentId, paymentUrl,
    };
    if (!await deps.store.compareAndSwap(record, ready))
      throw new Error('BMO reservation changed: manual reconciliation needed');
    return ready;
  } catch {
    // Do not release or auto-submit another request, even after a network timeout.
    await deps.store.compareAndSwap(record, { ...record, state: 'submission_uncertain' });
    throw new Error('BMO request outcome uncertain; reconcile same message ID before retry');
  }
}

/** Claim SMS before sending, to avoid duplicate links from concurrent processes. */
export async function sendBmoCheckoutSms(
  order: BmoOrderFingerprint,
  customerPhone: string,
  customerLanguage: 'fr' | 'en',
  deps: BmoFlowDependencies,
): Promise<BmoFlowRecord> {
  const record = await deps.store.read(...keyFor(order));
  if (!record || record.state !== 'link_ready' || !record.paymentUrl)
    throw new Error('BMO link is not ready or was already sent');
  const claimed: BmoFlowRecord = { ...record, state: 'sms_sending' };
  if (!await deps.store.compareAndSwap(record, claimed))
    throw new Error('BMO SMS has already been claimed');
  const amount = (record.amountCents / 100).toFixed(2);
  const message = customerLanguage === 'fr'
    ? 'Paiement sécurisé Interac pour la commande ' + record.orderId + ' : ' + amount + ' $ CAD. ' + record.paymentUrl
    : 'Secure Interac payment for order ' + record.orderId + ': CAD $' + amount + '. ' + record.paymentUrl;
  try {
    await deps.sms.send(customerPhone, message);
    const sent: BmoFlowRecord = { ...claimed, state: 'sms_sent' };
    if (!await deps.store.compareAndSwap(claimed, sent))
      throw new Error('SMS claim changed');
    return sent;
  } catch {
    await deps.store.compareAndSwap(claimed, { ...claimed, state: 'sms_uncertain' });
    throw new Error('BMO SMS outcome uncertain; human review before resending');
  }
}

/**
 * Poll authenticated BMO status. Returns evidence for an eventual kitchen
 * release, but does NOT itself create a Clover order or mark an order paid.
 */
export async function reconcileBmoCheckout(
  order: BmoOrderFingerprint, deps: BmoFlowDependencies,
): Promise<{ verifiedPaid: boolean; record: BmoFlowRecord }> {
  const saved = await deps.store.read(...keyFor(order));
  if (!saved) throw new Error('Unknown BMO checkout order');
  if (saved.amountCents !== order.amountCents || saved.messageId !== bmoMessageId(order))
    throw new Error('BMO checkout order fingerprint mismatch');
  if (saved.state === 'paid_verified') return { verifiedPaid: true, record: saved };
  const observed = await deps.bank.getRequestStatus(saved); // approved BMO auth is required in the bank adapter
  const verified = bmoMayRelease(order, saved.messageId, observed)
    && saved.bankPaymentId === observed.providerPaymentId;
  const nextState: BmoFlowState = verified ? 'paid_verified'
    : bmoStatus(observed.statusCode) === 'rejected' ? 'rejected'
    : bmoStatus(observed.statusCode) === 'cancelled' ? 'cancelled'
    : saved.state;
  if (nextState === saved.state) return { verifiedPaid: false, record: saved };
  const updated: BmoFlowRecord = { ...saved, state: nextState };
  if (!await deps.store.compareAndSwap(saved, updated)) {
    const current = await deps.store.read(...keyFor(order));
    if (!current) throw new Error('BMO settlement changed during reconciliation');
    return { verifiedPaid: current.state === 'paid_verified', record: current };
  }
  return { verifiedPaid: verified, record: updated };
}
