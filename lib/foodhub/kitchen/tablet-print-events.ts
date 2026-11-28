import type { OrderEvent } from '../types';

export const TABLET_PRINT_CLAIM_EVENTS = {
  order: {
    type: 'tablet_print_claimed',
    detail: { stage: 'claimed', message: 'Order ticket reserved for printing.', messageFr: 'Ticket de commande réservé pour impression.' },
  },
  cancel: {
    type: 'tablet_cancel_print_claimed',
    detail: { stage: 'claimed', message: 'Cancellation ticket reserved for printing.', messageFr: 'Ticket d’annulation réservé pour impression.' },
  },
} as const;

const legacyClaims = new Map(Object.entries({
  tablet_printed: TABLET_PRINT_CLAIM_EVENTS.order,
  tablet_cancel_printed: TABLET_PRINT_CLAIM_EVENTS.cancel,
}));

/** Historical tablet print events were emitted at reservation time. Present them accordingly without rewriting history. */
export function presentTabletPrintEvent(event: OrderEvent): OrderEvent {
  const claim = legacyClaims.get(event.type);
  return claim ? { ...event, type: claim.type, detail: { ...event.detail, ...claim.detail } } : event;
}
