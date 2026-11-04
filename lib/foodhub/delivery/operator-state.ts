import type { DirectOrder } from '@/lib/foodhub/delivery/types';

type ReviewOrder = Pick<DirectOrder, 'status' | 'payment' | 'paylink' | 'interac' | 'attention'>;

/** Configuration plus the existing write gate; this does not certify a real courier is available. */
export function hasCourierRequestRoute(fleets: ReadonlyArray<{ configured: boolean; canSend: boolean }>): boolean {
  return fleets.some((fleet) => fleet.configured && fleet.canSend);
}

/** Presentation of recorded facts only. This never verifies, releases or refunds a payment. */
export function directOrderReview(order: ReviewOrder) {
  const held = order.status === 'awaiting_payment';
  const extraCardPayment = Boolean(order.paylink?.extraPayments?.length);
  const cardReview = Boolean(order.paylink?.flag?.startsWith('Paiement à vérifier')) || extraCardPayment;
  const cardRecorded = Boolean(order.paylink && (order.payment === 'paid' || order.paylink.paymentId || order.paylink.paidAt || order.paylink.releasedAt));
  const transferRecorded = Boolean(order.interac?.receivedAt);
  const cardReleasePending = held && cardRecorded;
  const transferReleasePending = held && transferRecorded;
  const lateTransfer = order.status === 'cancelled' && (order.interac?.lateTransfers ?? []).some((item) => !item.releasedAt && !item.refundedAt);
  return {
    cardReview, cardRecorded, extraCardPayment, cardReleasePending, transferReleasePending,
    // The existing Interac "finish sending" action remains available for a recorded transfer.
    blockPaymentActions: cardReview || cardReleasePending,
    needsPerson: cardReview || cardReleasePending || transferReleasePending || lateTransfer
      || Boolean(order.attention && !['completed', 'cancelled'].includes(order.status)),
  };
}
