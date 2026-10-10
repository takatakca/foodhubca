// French / English labels and colours shared by the expansion screens (own orders, couriers, calls, retail).
import type { Tone } from '@/components/ui/badge';
import type { T } from '@/lib/i18n';

export function directStatusLabel(t: T, s: string) {
  return ({
    new: t('Nouvelle', 'New'), in_kitchen: t('En cuisine', 'In the kitchen'), ready: t('Prête', 'Ready'), out_for_delivery: t('En livraison', 'Out for delivery'),
    completed: t('Terminée', 'Completed'), cancelled: t('Annulée', 'Cancelled'),
  } as Record<string, string>)[s] ?? s;
}
export const DIRECT_TONE: Record<string, Tone> = { new: 'brand', in_kitchen: 'wait', ready: 'go', out_for_delivery: 'info', completed: 'neutral', cancelled: 'stop' };

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
  return ({ paid: t('Payée', 'Paid'), pay_at_pickup: t('À payer au comptoir', 'Pay at the counter'), unpaid: t('À encaisser', 'To collect') } as Record<string, string>)[s] ?? s;
}
export const PAYMENT_TONE: Record<string, Tone> = { paid: 'go', pay_at_pickup: 'neutral', unpaid: 'wait' };

export const FLEET_NAME: Record<string, string> = { doordash_drive: 'DoorDash Drive', uber_direct: 'Uber Direct', skip_daas: 'Skip Delivery' };

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
  } as Record<string, string>)[type] ?? type.replace(/_/g, ' ');
}
