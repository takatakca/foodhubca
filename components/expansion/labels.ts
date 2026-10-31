// French / English labels and colours shared by the expansion screens (own orders, couriers, calls, retail).
import type { Tone } from '@/components/ui/badge';
import type { DirectOrder } from '@/lib/foodhub/delivery/types';
import type { T } from '@/lib/i18n';

export function directStatusLabel(t: T, s: string) {
  return ({
    awaiting_payment: t('En attente de paiement', 'Waiting for payment'),
    new: t('Nouvelle', 'New'), in_kitchen: t('En cuisine', 'In the kitchen'), ready: t('Prête', 'Ready'), out_for_delivery: t('En livraison', 'Out for delivery'),
    completed: t('Terminée', 'Completed'), cancelled: t('Annulée', 'Cancelled'),
  } as Record<string, string>)[s] ?? s;
}
export const DIRECT_TONE: Record<string, Tone> = { awaiting_payment: 'violet', new: 'brand', in_kitchen: 'wait', ready: 'go', out_for_delivery: 'info', completed: 'neutral', cancelled: 'stop' };

export function deliveryStatusLabel(t: T, s: string) {
  return ({
    quoted: t('Prix demandé', 'Quoted'), created: t('Livreur demandé', 'Courier requested'), assigned: t('Livreur assigné', 'Courier assigned'), at_pickup: t('Livreur au comptoir', 'Courier at the counter'),
    picked_up: t('En route vers le client', 'On the way to the customer'), at_dropoff: t('Chez le client', 'At the customer'), delivered: t('Livrée', 'Delivered'),
    returning: t('Retour à la cuisine', 'Coming back'), returned: t('Retournée', 'Returned'), cancelled: t('Livreur annulé', 'Courier cancelled'), failed: t('Échec', 'Failed'),
  } as Record<string, string>)[s] ?? s;
}
export const DELIVERY_TONE: Record<string, Tone> = {
  quoted: 'neutral', created: 'wait', assigned: 'info', at_pickup: 'brand', picked_up: 'info', at_dropoff: 'info', delivered: 'go', returning: 'stop', returned: 'stop', cancelled: 'stop', failed: 'stop',
};

export function sourceLabel(t: T, s: string) {
  return ({ phone: t('Téléphone', 'Phone'), phone_ai: t('Téléphone IA', 'AI phone'), clover: 'Clover', website: t('Site web', 'Website'), manual: t('Saisie', 'Typed in'), clover_online: t('Site web / Clover en ligne', 'Website / Clover Online') } as Record<string, string>)[s] ?? s;
}

export function paymentLabel(t: T, s: string) {
  return ({ paid: t('Payée', 'Paid'), pay_at_pickup: t('À payer au comptoir', 'Pay at the counter'), unpaid: t('À encaisser', 'To collect'), link: t('Lien de paiement envoyé', 'Payment link sent') } as Record<string, string>)[s] ?? s;
}
export const PAYMENT_TONE: Record<string, Tone> = { paid: 'go', pay_at_pickup: 'neutral', unpaid: 'wait' };

/** The payment badge of an order: an Interac e-Transfer order says so (expected while held, received once a person confirmed it). */
export function paymentBadge(t: T, o: Pick<DirectOrder, 'payment' | 'status' | 'interac' | 'paylink'>): { label: string; tone: Tone } {
  if (o.interac && o.status === 'awaiting_payment') return { label: t('Virement Interac attendu', 'Interac e-Transfer expected'), tone: 'violet' };
  if (o.interac?.receivedAt && o.payment === 'paid') return { label: t('Payée — virement Interac', 'Paid — Interac e-Transfer'), tone: 'go' };
  if (o.paylink && o.status === 'awaiting_payment') return { label: paymentLabel(t, 'link'), tone: 'violet' };
  return { label: paymentLabel(t, o.payment), tone: PAYMENT_TONE[o.payment] ?? 'neutral' };
}

/** A cancelled order whose Interac transfer arrived late and nobody has dealt with yet (send to the kitchen anyway, or refund by hand). */
export function interacLatePending(o: Pick<DirectOrder, 'interac'>): boolean {
  return (o.interac?.lateTransfers ?? []).some((l) => !l.releasedAt && !l.refundedAt);
}

export const FLEET_NAME: Record<string, string> = { doordash_drive: 'DoorDash Drive', uber_direct: 'Uber Direct', skip_daas: 'Skip Delivery', own_fleet: 'Nos livreurs' };

export function callStatusLabel(t: T, s: string) {
  return ({
    active: t('En cours', 'In progress'), ordered: t('Commande passée', 'Order placed'), handoff: t('Transféré', 'Transferred'), handoff_missed: t('À rappeler', 'Call back'),
    ended: t('Terminé', 'Ended'), abandoned: t('Panier abandonné', 'Cart abandoned'), error: t('Erreur', 'Error'),
  } as Record<string, string>)[s] ?? s;
}
export const CALL_TONE: Record<string, Tone> = { active: 'info', ordered: 'go', handoff: 'violet', handoff_missed: 'stop', ended: 'neutral', abandoned: 'wait', error: 'stop' };

export function eventLabel(t: T, type: string) {
  return ({
    received: t('Reçue', 'Received'), pos_injected: t('Envoyée à Clover', 'Sent to Clover'), pos_failed: t('Clover a refusé', 'Clover refused'), pos_skipped: t('Clover non branché', 'Clover not connected'),
    sms_confirmation: t('Confirmation textée', 'Confirmation texted'), sms_tracking: t('Lien de suivi texté', 'Tracking link texted'), sms_failed: t('Texto non envoyé', 'Text not sent'),
    courier_booked: t('Livreur réservé', 'Courier booked'), courier_failed: t('Service de livraison a refusé', 'Courier service refused'), quote_failed: t('Pas de prix', 'No price'),
    courier_cancelled: t('Livreur annulé', 'Courier cancelled'), courier_cancel_failed: t('Annulation refusée', 'Cancel refused'), courier_picked_up: t('Récupérée par le livreur', 'Picked up by the courier'),
    delivered: t('Livrée', 'Delivered'), auto_dispatch: t('Envoi automatique', 'Auto-dispatch'), auto_dispatch_stopped: t('Envoi automatique arrêté', 'Auto-dispatch stopped'), dispatch_waiting: t('En attente', 'Waiting'),
    paid: t('Paiement encaissé', 'Payment taken'), ready: t('Prête', 'Ready'), picked_up: t('Récupérée par le client', 'Picked up by the customer'), completed: t('Terminée', 'Completed'),
    cancelled: t('Annulée', 'Cancelled'), updated: t('Modifiée', 'Updated'), attention_cleared: t('Vérifiée', 'Checked'),
    awaiting_payment: t('En attente de paiement', 'Waiting for payment'), paylink_created: t('Lien de paiement créé', 'Payment link created'), paylink_sent: t('Lien de paiement texté', 'Payment link texted'),
    paylink_opened: t('Page de paiement ouverte', 'Payment page opened'), paylink_session: t('Nouvelle page de paiement', 'New payment page'), paylink_reminder: t('Rappel de paiement texté', 'Payment reminder texted'),
    paylink_released: t('Envoyée en cuisine (payée)', 'Sent to the kitchen (paid)'), paylink_declined: t('Carte refusée', 'Card declined'), paylink_extra_payment: t('Paiement en trop — à rembourser', 'Extra payment — refund it'),
    paylink_kitchen_closed: t('Payée, cuisine fermée', 'Paid, kitchen closed'), print_failed: t('Billet non imprimé', 'Ticket not printed'), pay_at_counter: t('Paiement au comptoir', 'Pay at the counter'), sms_cancelled: t('Annulation textée', 'Cancellation texted'),
    interac_created: t('Virement Interac demandé', 'Interac e-Transfer requested'), interac_sent: t('Instructions Interac textées', 'Interac instructions texted'), interac_reminder: t('Rappel Interac texté', 'Interac reminder texted'),
    interac_released: t('Envoyée en cuisine (virement reçu)', 'Sent to the kitchen (transfer received)'), interac_late: t('Virement reçu après l’annulation', 'Transfer received after the cancel'), interac_refunded: t('Virement retourné à la main', 'Transfer returned by hand'),
  } as Record<string, string>)[type] ?? type.replace(/_/g, ' ');
}
