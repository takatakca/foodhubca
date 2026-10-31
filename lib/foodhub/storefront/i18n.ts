// Strings of the public ordering page ("Commander direct"), French first (Québec), English second. Used by the server
// (errors, metadata) and the client page. No platform names; real brick-and-mortar restaurant wording only.
import { foodhubTimeZone, localParts } from '../time';

export type SfLang = 'fr' | 'en';

export function sfLang(raw: unknown): SfLang {
  return String(raw ?? '').toLowerCase().startsWith('en') ? 'en' : 'fr';
}

export const SF_TEXT = {
  fr: {
    order: 'Commander',
    orderOnline: 'Commander en ligne',
    metaDescription: (brand: string, city: string) => `Commandez ${brand} en ligne pour emporter${city ? ` à ${city}` : ''}. Menu à jour, prix du restaurant, paiement sécurisé ou au comptoir.`,
    pickupOnly: 'Pour emporter seulement',
    pickupAt: 'Cueillette au',
    open: 'Ouvert',
    closesAt: (t: string) => `Ferme à ${t}`,
    closed: 'Fermé',
    opensToday: (t: string) => `Ouvre aujourd’hui à ${t}`,
    opensTomorrow: (t: string) => `Ouvre demain à ${t}`,
    opensOn: (day: string, t: string) => `Ouvre ${day} à ${t}`,
    noHours: 'Les heures ne sont pas encore affichées. Revenez bientôt.',
    paused: 'Le restaurant ne prend pas de commandes en ligne pour le moment. Revenez un peu plus tard.',
    from: (t: string) => `dès ${t}`,
    add: 'Ajouter',
    addFor: (p: string) => `Ajouter · ${p}`,
    required: 'Obligatoire',
    optional: 'Facultatif',
    chooseN: (min: number, max: number) => (min === max ? `Choisissez ${min}` : min > 0 ? `Choisissez de ${min} à ${max}` : `Jusqu’à ${max}`),
    notes: 'Instructions pour la cuisine',
    notesHint: 'Ex. : sans oignon (140 caractères)',
    meal: 'Faites-en un repas',
    mealIntro: 'Ajoutez une boisson, et plus selon la formule. Facultatif.',
    mealNo: 'Non merci',
    mealPickDrink: 'Choisissez votre boisson',
    cart: 'Panier',
    viewCart: 'Voir le panier',
    emptyCart: 'Votre panier est vide.',
    subtotal: 'Sous-total',
    taxes: 'Taxes (TPS + TVQ)',
    total: 'Total',
    remove: 'Retirer',
    yourInfo: 'Vos coordonnées',
    name: 'Prénom et nom',
    phone: 'Téléphone',
    email: 'Courriel (facultatif)',
    phoneHint: 'Pour vous joindre au sujet de votre commande.',
    payment: 'Paiement',
    payOnline: 'Payer en ligne maintenant (carte, par Clover)',
    payAtPickup: 'Payer au comptoir à la cueillette',
    placeOrder: 'Passer la commande',
    placeAndPay: 'Continuer vers le paiement',
    placing: 'Envoi…',
    fallbackPayAtPickup: 'Le paiement en ligne n’est pas disponible pour le moment. Votre commande n’a pas été passée. Vous pouvez la passer en payant au comptoir.',
    tryPayAtPickup: 'Passer la commande et payer au comptoir',
    track: 'Suivi de votre commande',
    lastOrder: 'Votre dernière commande',
    status: {
      awaiting_payment: 'En attente du paiement',
      new: 'Reçue',
      in_kitchen: 'En préparation',
      ready: 'Prête pour la cueillette',
      out_for_delivery: 'En route',
      completed: 'Récupérée. Merci !',
      cancelled: 'Annulée',
    } as Record<string, string>,
    readyAround: (t: string) => `Prête vers ${t}`,
    number: 'Commande',
    refresh: 'La page se met à jour toute seule.',
    interac: {
      title: 'Payez par virement Interac',
      recipient: 'Destinataire', amount: 'Montant exact', message: 'Message à inscrire', question: 'Question de sécurité', answerByText: 'La réponse vous a été envoyée par texto.',
      before: (t: string) => `À envoyer avant ${t}.`,
      then: 'Dès qu’une personne de notre équipe confirme la réception, votre commande part en cuisine.',
    },
    backToMenu: 'Retour au menu',
    allergens: 'Allergènes',
    allergensList: (list: string) => `Allergènes : ${list}`,
    close: 'Fermer',
    decrease: 'Diminuer la quantité',
    increase: 'Augmenter la quantité',
    categories: 'Catégories du menu',
    poweredBy: 'Commande directe au restaurant, sans frais de service.',
    language: 'English',
    unknownTrack: 'Ce lien de suivi n’est pas valide.',
    alcoholNote: 'Les boissons alcoolisées ne sont pas offertes en ligne.',
    errors: {
      generic: 'La commande n’a pas pu être envoyée. Réessayez dans un instant.',
      closed: 'Le restaurant est fermé en ce moment.',
      paused: 'Le restaurant ne prend pas de commandes en ligne pour le moment.',
      notFound: 'Cette page de commande n’existe pas.',
      unknownItem: (n: string) => `« ${n} » n’est plus au menu.`,
      itemUnavailable: (n: string) => `« ${n} » n’est plus disponible.`,
      categoryClosed: (n: string) => `« ${n} » n’est pas servi à cette heure-ci.`,
      unknownOption: (n: string) => `Une option de « ${n} » n’existe plus.`,
      optionUnavailable: (o: string, n: string) => `« ${o} » n’est plus disponible pour « ${n} ».`,
      groupMin: (g: string, min: number, n: string) => `« ${n} » : choisissez au moins ${min} option${min > 1 ? 's' : ''} dans « ${g} ».`,
      groupMax: (g: string, max: number, n: string) => `« ${n} » : ${max} option${max > 1 ? 's' : ''} au plus dans « ${g} ».`,
      oneMeal: (n: string) => `« ${n} » : un seul repas (Duo, Trio ou Combo) par article.`,
      phone: 'Entrez un numéro de téléphone valide du Canada ou des États-Unis.',
      lastOrder: 'Trop tard pour commander : la cuisine ferme bientôt. Revenez à la prochaine ouverture.',
      pickupTooBig: (max: string, online: boolean) => `Au comptoir, une commande en ligne est limitée à ${max}.${online ? ' Choisissez « Payer en ligne maintenant » pour une commande plus grande.' : ' Pour une commande plus grande, appelez le restaurant.'}`,
      pickupTooMany: (n: number, online: boolean) => `Au comptoir, une commande en ligne est limitée à ${n} articles.${online ? ' Choisissez « Payer en ligne maintenant » pour une commande plus grande.' : ' Pour une commande plus grande, appelez le restaurant.'}`,
      forbidden: 'Commande refusée. Passez-la depuis la page de commande du restaurant.',
      name: 'Entrez votre nom.',
      tooMany: 'Trop de commandes en peu de temps. Réessayez dans quelques minutes.',
      payOnlineOff: 'Le paiement en ligne n’est pas offert pour ce restaurant.',
      payAtPickupOff: 'Ce restaurant demande le paiement en ligne.',
      tooBig: 'Commande trop volumineuse.',
      invalid: 'La commande est incomplète.',
    },
  },
  en: {
    order: 'Order',
    orderOnline: 'Order online',
    metaDescription: (brand: string, city: string) => `Order ${brand} online for pickup${city ? ` in ${city}` : ''}. Up-to-date menu, restaurant prices, secure online payment or pay at the counter.`,
    pickupOnly: 'Pickup only',
    pickupAt: 'Pickup at',
    open: 'Open',
    closesAt: (t: string) => `Closes at ${t}`,
    closed: 'Closed',
    opensToday: (t: string) => `Opens today at ${t}`,
    opensTomorrow: (t: string) => `Opens tomorrow at ${t}`,
    opensOn: (day: string, t: string) => `Opens ${day} at ${t}`,
    noHours: 'Opening hours are not posted yet. Please check back soon.',
    paused: 'The restaurant is not taking online orders right now. Please check back a little later.',
    from: (t: string) => `from ${t}`,
    add: 'Add',
    addFor: (p: string) => `Add · ${p}`,
    required: 'Required',
    optional: 'Optional',
    chooseN: (min: number, max: number) => (min === max ? `Choose ${min}` : min > 0 ? `Choose ${min} to ${max}` : `Up to ${max}`),
    notes: 'Instructions for the kitchen',
    notesHint: 'E.g. no onions (140 characters)',
    meal: 'Make it a meal',
    mealIntro: 'Add a drink, and more depending on the meal. Optional.',
    mealNo: 'No thanks',
    mealPickDrink: 'Choose your drink',
    cart: 'Cart',
    viewCart: 'View cart',
    emptyCart: 'Your cart is empty.',
    subtotal: 'Subtotal',
    taxes: 'Taxes (GST + QST)',
    total: 'Total',
    remove: 'Remove',
    yourInfo: 'Your details',
    name: 'Full name',
    phone: 'Phone',
    email: 'Email (optional)',
    phoneHint: 'To reach you about your order.',
    payment: 'Payment',
    payOnline: 'Pay online now (card, by Clover)',
    payAtPickup: 'Pay at the counter on pickup',
    placeOrder: 'Place order',
    placeAndPay: 'Continue to payment',
    placing: 'Sending…',
    fallbackPayAtPickup: 'Online payment is not available right now. Your order was not placed. You can place it and pay at the counter.',
    tryPayAtPickup: 'Place the order and pay at the counter',
    track: 'Your order',
    lastOrder: 'Your last order',
    status: {
      awaiting_payment: 'Waiting for payment',
      new: 'Received',
      in_kitchen: 'Being prepared',
      ready: 'Ready for pickup',
      out_for_delivery: 'On its way',
      completed: 'Picked up. Thank you!',
      cancelled: 'Cancelled',
    } as Record<string, string>,
    readyAround: (t: string) => `Ready around ${t}`,
    number: 'Order',
    refresh: 'This page updates by itself.',
    interac: {
      title: 'Pay by Interac e-Transfer',
      recipient: 'Recipient', amount: 'Exact amount', message: 'Message to write', question: 'Security question', answerByText: 'The answer was sent to you by text.',
      before: (t: string) => `Send it before ${t}.`,
      then: 'As soon as a team member confirms it arrived, your order goes to the kitchen.',
    },
    backToMenu: 'Back to the menu',
    allergens: 'Allergens',
    allergensList: (list: string) => `Allergens: ${list}`,
    close: 'Close',
    decrease: 'Decrease quantity',
    increase: 'Increase quantity',
    categories: 'Menu categories',
    poweredBy: 'Order directly from the restaurant, no service fees.',
    language: 'Français',
    unknownTrack: 'This tracking link is not valid.',
    alcoholNote: 'Alcoholic drinks are not offered online.',
    errors: {
      generic: 'The order could not be sent. Please try again in a moment.',
      closed: 'The restaurant is closed right now.',
      paused: 'The restaurant is not taking online orders right now.',
      notFound: 'This ordering page does not exist.',
      unknownItem: (n: string) => `"${n}" is no longer on the menu.`,
      itemUnavailable: (n: string) => `"${n}" is no longer available.`,
      categoryClosed: (n: string) => `"${n}" is not served at this time.`,
      unknownOption: (n: string) => `An option of "${n}" no longer exists.`,
      optionUnavailable: (o: string, n: string) => `"${o}" is no longer available for "${n}".`,
      groupMin: (g: string, min: number, n: string) => `"${n}": choose at least ${min} option${min > 1 ? 's' : ''} in "${g}".`,
      groupMax: (g: string, max: number, n: string) => `"${n}": at most ${max} option${max > 1 ? 's' : ''} in "${g}".`,
      oneMeal: (n: string) => `"${n}": one meal (Duo, Trio or Combo) per item.`,
      phone: 'Enter a valid Canadian or US phone number.',
      lastOrder: 'Too late to order: the kitchen closes soon. Please come back when it opens again.',
      pickupTooBig: (max: string, online: boolean) => `Online orders paid at the counter are limited to ${max}.${online ? ' Choose "Pay online now" for a larger order.' : ' For a larger order, please call the restaurant.'}`,
      pickupTooMany: (n: number, online: boolean) => `Online orders paid at the counter are limited to ${n} items.${online ? ' Choose "Pay online now" for a larger order.' : ' For a larger order, please call the restaurant.'}`,
      forbidden: 'Order refused. Please place it from the restaurant’s ordering page.',
      name: 'Enter your name.',
      tooMany: 'Too many orders in a short time. Please try again in a few minutes.',
      payOnlineOff: 'Online payment is not offered for this restaurant.',
      payAtPickupOff: 'This restaurant asks for online payment.',
      tooBig: 'Order too large.',
      invalid: 'The order is incomplete.',
    },
  },
} as const;

export type SfText = (typeof SF_TEXT)[SfLang];
export const sfText = (lang: SfLang): SfText => SF_TEXT[lang];

const DAY_NAMES: Record<SfLang, string[]> = {
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

/** "16 h" / "16 h 30" (Québec) or "4 PM" / "4:30 PM", in the hub's zone. */
export function clockLabel(ms: number, lang: SfLang, tz = foodhubTimeZone()): string {
  const p = localParts(ms, tz);
  if (lang === 'fr') return `${p.hour} h${p.minute ? ` ${String(p.minute).padStart(2, '0')}` : ''}`;
  const h12 = p.hour % 12 || 12;
  return `${h12}${p.minute ? `:${String(p.minute).padStart(2, '0')}` : ''} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

/** "Ouvre aujourd’hui à 16 h" / "Ouvre mardi à 9 h" / "Opens tomorrow at 9 AM". */
export function opensLabel(nextOpenMs: number, nowMs: number, lang: SfLang, tz = foodhubTimeZone()): string {
  const t = sfText(lang);
  const day = (ms: number) => { const p = localParts(ms, tz); return Date.UTC(p.year, p.month - 1, p.day) / 86400_000; };
  const diff = day(nextOpenMs) - day(nowMs);
  const at = clockLabel(nextOpenMs, lang, tz);
  if (diff <= 0) return t.opensToday(at);
  if (diff === 1) return t.opensTomorrow(at);
  const p = localParts(nextOpenMs, tz);
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return t.opensOn(DAY_NAMES[lang][dow], at);
}

/** Dollars the local way: "12,99 $" / "$12.99". */
export function priceLabel(n: number, lang: SfLang): string {
  return lang === 'fr' ? `${n.toFixed(2).replace('.', ',')} $` : `$${n.toFixed(2)}`;
}
