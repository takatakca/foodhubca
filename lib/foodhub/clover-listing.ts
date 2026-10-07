// Clover App Market listing for "TAKATAK Food Hub" — the one source for the text the owner pastes in the Clover
// developer dashboard (App Market Listing, Overview → Functional Description, Permissions). Shown with Copy buttons
// in Settings → Clover app; docs/CLOVER_APP_LISTING.md carries the same text (tests keep the two in step and check
// Clover's limits: tagline ≤ 255 characters, 3 to 5 benefits of ≤ 100 characters, no "Clover" in the app name).

export type Bilingual = { fr: string; en: string };

export const LISTING_APP_NAME = 'TAKATAK Food Hub';

export const LISTING_TAGLINE: Bilingual = {
  fr: 'Uber Eats, DoorDash, SkipTheDishes et Too Good To Go directement dans votre caisse Clover : un seul écran, des menus et des ruptures synchronisés, des paiements vérifiés.',
  en: 'Uber Eats, DoorDash, SkipTheDishes and Too Good To Go straight into your Clover register: one screen, synced menus and sold-out items, verified payouts.',
};

export const LISTING_BENEFITS: Bilingual[] = [
  { fr: 'Chaque commande de livraison arrive dans Clover et à l’imprimante, sans jongler entre tablettes.', en: 'Every delivery order lands in Clover and on the kitchen printer — no more juggling tablets.' },
  { fr: 'Un menu maître publié sur Uber Eats, DoorDash et Skip, avec majoration par plateforme.', en: 'One master menu published to Uber Eats, DoorDash and Skip, with a markup per platform.' },
  { fr: 'Rupture dans Clover = article retiré de toutes les plateformes en quelques secondes.', en: 'Out of stock in Clover = item off every platform within seconds.' },
  { fr: 'Chaque paiement des plateformes comparé aux commandes : l’argent manquant est signalé.', en: 'Every platform payout checked against your orders: missing money is flagged.' },
  { fr: 'Alerte dès qu’un magasin se met hors ligne ou qu’une commande attend une réponse.', en: 'An alert as soon as a store goes offline or an order is waiting for an answer.' },
];

export const LISTING_DESCRIPTION: Bilingual = {
  fr: [
    'TAKATAK Food Hub réunit toutes vos plateformes de livraison sur un seul écran et les relie directement à votre caisse Clover — sans agrégateur.',
    '',
    '• Commandes : les commandes Uber Eats, DoorDash et SkipTheDishes (et Too Good To Go lorsque votre compte offre un flux de commandes) arrivent avec une alerte sonore, s’acceptent en un geste, sont créées dans Clover avec un type de commande par plateforme et s’impriment à la cuisine. Une fois sorties, elles sont enregistrées payées avec un mode de paiement par plateforme, pour que la fermeture de caisse soit juste.',
    '• Écran de cuisine : à préparer, prêtes, livreur en route ; allergies et notes en rouge ; minuteries.',
    '• Menus : importez votre inventaire Clover, vérifiez-le, puis publiez un menu maître sur chaque plateforme avec les heures, les jours fériés, les catégories à horaire et une majoration en % par plateforme.',
    '• Ruptures (86) : un article en rupture dans Clover est retiré de toutes les plateformes ; remis en vente partout d’un clic.',
    '• Magasins : mettez en pause ou rouvrez une succursale sur toutes les plateformes, mode occupé et temps de préparation.',
    '• Argent : chaque paiement des plateformes est comparé aux commandes ; frais, remboursements, ajustements et argent manquant sont signalés. Rien n’est approuvé ni comptabilisé automatiquement : vous décidez.',
    '• Équipe : connexion par code (courriel ou texto), rôles, NIP de gérant pour tout ce qui touche l’argent.',
    '',
    'Ce qu’il faut : un forfait Clover qui comprend l’inventaire et les commandes, un appareil Clover avec une imprimante de commandes, vos propres comptes marchands Uber Eats, DoorDash ou SkipTheDishes, et un compte TAKATAK Food Hub — chaque nouveau restaurant est approuvé par notre équipe avant que des commandes soient envoyées à sa caisse.',
    '',
    'Interface en français et en anglais. Food Hub ne traite aucun paiement par carte. Les jetons Clover restent sur notre serveur et se renouvellent seuls ; ils sont supprimés à la désinstallation.',
  ].join('\n'),
  en: [
    'TAKATAK Food Hub brings all your delivery platforms onto one screen and connects them straight to your Clover register — no aggregator.',
    '',
    '• Orders: Uber Eats, DoorDash and SkipTheDishes orders (and Too Good To Go when your account offers an order feed) arrive with a sound alert, are accepted in one tap, created in Clover with an order type per platform and printed in the kitchen. Once they leave, they are recorded as paid with a tender per platform, so your Clover closeout is right.',
    '• Kitchen screen: to cook, ready, courier arriving; allergies and notes in red; timers.',
    '• Menus: import your Clover inventory, check it, then publish one master menu to every platform with hours, holidays, scheduled categories and a % markup per platform.',
    '• Sold out (86): an item out of stock in Clover is taken off every platform; back on sale everywhere in one click.',
    '• Stores: pause or reopen a location on every platform, busy mode and prep time.',
    '• Money: every platform payout is checked against your orders; fees, refunds, adjustments and missing money are flagged. Nothing is approved or posted automatically: you decide.',
    '• Team: sign-in by code (email or text), roles, manager PIN for anything that touches money.',
    '',
    'Requirements: a Clover plan that includes Inventory and Orders, a Clover device with an order printer, your own Uber Eats, DoorDash or SkipTheDishes merchant accounts, and a TAKATAK Food Hub account — each new restaurant is approved by our team before any order is sent to its register.',
    '',
    'French and English interface. Food Hub never processes card payments. Clover tokens stay on our server and renew by themselves; they are deleted when the app is uninstalled.',
  ].join('\n'),
};

/** Overview → Functional Description (required for review). `{support}` is replaced by FOODHUB_SUPPORT_EMAIL. */
export const LISTING_FUNCTIONAL_DESCRIPTION: Bilingual = {
  en: [
    'WHAT IT DOES — TAKATAK Food Hub is a delivery-order hub for restaurants. It receives orders from Uber Eats, DoorDash, SkipTheDishes and Too Good To Go through each platform’s own API (no aggregator) and puts them in the merchant’s Clover:',
    '1. Each delivery order is created with the atomic order API: an order type named after the platform ("Uber Eats", "DoorDash"…), line items, modifiers, notes, and any restaurant-funded promotion as an order discount.',
    '2. The kitchen ticket is printed on the Clover order printer (print_event).',
    '3. When the courier picks the order up, Food Hub records the payment with a custom tender named after the platform, so the order closes as PAID and the closeout is right. Food Hub never takes card payments and never charges anyone.',
    '4. Menus: Food Hub imports the Clover inventory (items, categories, modifier groups) into one master menu published to the platforms, and can add a kitchen printer label to items that would not print.',
    '5. Sold out: the Inventory webhook takes an item marked out of stock in Clover off every platform, and puts it back when it is available again.',
    '6. Uninstall: the App webhook deletes the merchant’s tokens at once.',
    '',
    'HOW TO TEST',
    '1. Install the app on your test merchant and open it from the Clover dashboard. Food Hub completes OAuth v2 (expiring tokens, refreshed automatically) and opens its welcome page, pre-filled with the merchant’s name and location, a read-only check of the register (items, categories, order types, tenders, devices) and the app subscription.',
    '2. Each new merchant is approved by our team before Food Hub sends anything to its register (the page says "Waiting for approval" and our team is alerted at once). For the review, write to {support} with your test merchant ID and we approve it right away.',
    '3. Once approved, press "Send a test order to my Clover" on the welcome page: Food Hub creates a TEST Uber Eats order in Clover (OPEN, with order type, items, a modifier and a note), sends the ticket to the printer and pays it with the "Uber Eats" tender for Clover’s own total, tax included (PAID). Each step shows what Clover answered.',
    '4. Uninstall the app: the tokens are deleted.',
    'The functional video shows the full flow in our own restaurant: a platform order arrives, is accepted, created and printed in Clover, then paid at pickup; a menu import; an item 86’d in Clover leaving the platforms.',
  ].join('\n'),
  fr: [
    'CE QUE FAIT L’APPLICATION — TAKATAK Food Hub est un centre de commandes de livraison pour restaurants. Il reçoit les commandes Uber Eats, DoorDash, SkipTheDishes et Too Good To Go par l’API de chaque plateforme (sans agrégateur) et les met dans la caisse Clover du marchand :',
    '1. Chaque commande est créée avec l’API de commande atomique : type de commande au nom de la plateforme (« Uber Eats », « DoorDash »…), articles, modificateurs, notes, et la promotion payée par le restaurant en rabais sur la commande.',
    '2. Le billet de cuisine s’imprime sur l’imprimante de commandes Clover (print_event).',
    '3. Quand le livreur part avec la commande, Food Hub enregistre le paiement avec un mode de paiement au nom de la plateforme : la commande est PAYÉE et la fermeture de caisse est juste. Food Hub ne traite aucun paiement par carte et ne facture personne.',
    '4. Menus : Food Hub importe l’inventaire Clover (articles, catégories, groupes de modificateurs) dans un menu maître publié sur les plateformes, et peut ajouter une étiquette d’imprimante de cuisine aux articles qui ne s’imprimeraient pas.',
    '5. Ruptures : le webhook Inventaire retire de toutes les plateformes un article en rupture dans Clover, et le remet en vente quand il revient.',
    '6. Désinstallation : le webhook App supprime aussitôt les jetons du marchand.',
    '',
    'COMMENT TESTER',
    '1. Installez l’application sur votre marchand de test et ouvrez-la depuis le tableau de bord Clover. Food Hub termine l’OAuth v2 (jetons à expiration, renouvelés automatiquement) et ouvre sa page d’accueil, préremplie avec le nom et la ville du marchand, une vérification en lecture seule de la caisse (articles, catégories, types de commande, modes de paiement, appareils) et l’abonnement.',
    '2. Chaque nouveau marchand est approuvé par notre équipe avant que Food Hub envoie quoi que ce soit à sa caisse (la page indique « En attente d’approbation » et notre équipe est avisée aussitôt). Pour la révision, écrivez à {support} avec l’identifiant de votre marchand de test : nous l’approuvons tout de suite.',
    '3. Une fois approuvé, appuyez sur « Envoyer une commande test à ma caisse Clover » : Food Hub crée une commande Uber Eats TEST dans Clover (OUVERTE, avec type de commande, articles, modificateur et note), envoie le billet à l’imprimante et la paie avec le mode « Uber Eats » pour le total calculé par Clover, taxes comprises (PAYÉE). Chaque étape affiche la réponse de Clover.',
    '4. Désinstallez l’application : les jetons sont supprimés.',
    'La vidéo montre le parcours complet dans notre restaurant : une commande arrive, est acceptée, créée et imprimée dans Clover, puis payée au départ ; un import de menu ; un article en rupture dans Clover retiré des plateformes.',
  ].join('\n'),
};

/** Permissions requested in the Clover app and the justification Clover asks for, one per permission. */
export const LISTING_PERMISSIONS: Array<{ name: string; access: 'Read' | 'Read + Write'; why: Bilingual }> = [
  { name: 'Merchant', access: 'Read + Write', why: {
    en: 'Read: merchant name and address to match each Clover location with its delivery stores; App webhook events. Write: create one tender per delivery platform ("Uber Eats", "DoorDash"…) used to record platform payments.',
    fr: 'Lecture : nom et adresse du marchand pour jumeler chaque emplacement Clover à ses magasins de livraison ; événements du webhook App. Écriture : créer un mode de paiement par plateforme (« Uber Eats », « DoorDash »…) pour enregistrer les paiements des plateformes.' } },
  { name: 'Inventory', access: 'Read + Write', why: {
    en: 'Read: import items, categories and modifier groups into the master menu; follow stock to take sold-out items off the platforms. Write: add a kitchen printer label to items that would not print, only when the owner asks.',
    fr: 'Lecture : importer articles, catégories et groupes de modificateurs dans le menu maître ; suivre les stocks pour retirer les articles en rupture des plateformes. Écriture : ajouter une étiquette d’imprimante de cuisine aux articles qui ne s’impriment pas, seulement à la demande du propriétaire.' } },
  { name: 'Orders', access: 'Read + Write', why: {
    en: 'Write: create each delivery order in Clover with its platform order type and print the kitchen ticket; remove an order the platform cancelled before it was paid. Read: daily totals and orders that platforms create through Clover’s own integrations.',
    fr: 'Écriture : créer chaque commande de livraison dans Clover avec son type de commande et imprimer le billet de cuisine ; retirer une commande annulée par la plateforme avant son paiement. Lecture : totaux du jour et commandes que les plateformes créent par les intégrations de Clover.' } },
  { name: 'Payments', access: 'Read + Write', why: {
    en: 'Write: record each platform order as paid with the platform’s tender when it leaves the kitchen, so the closeout is right (no card is ever processed). Read: match payments and refunds for the payout check.',
    fr: 'Écriture : enregistrer chaque commande de plateforme comme payée avec le mode de paiement de la plateforme à son départ, pour une fermeture de caisse juste (aucune carte n’est traitée). Lecture : rapprocher paiements et remboursements pour la vérification des versements.' } },
];

/** At most 3 functional categories and at least 1 vertical (pick the closest names in Clover's list). */
export const LISTING_CATEGORIES = {
  functional: ['Orders & Delivery', 'Items & Inventory', 'Kitchen Operations'],
  vertical: ['Quick Service Restaurant', 'Full Service Restaurant'],
};

export const SUPPORT_HOURS_DEFAULT: Bilingual = { fr: 'Lun–ven 9 h – 17 h (HE)', en: 'Mon–Fri 9 am – 5 pm ET' };

/** Functional description with the support email filled in (or a visible placeholder). */
export function functionalDescription(lang: 'fr' | 'en', supportEmail = process.env.FOODHUB_SUPPORT_EMAIL): string {
  return LISTING_FUNCTIONAL_DESCRIPTION[lang].replaceAll('{support}', supportEmail || '[FOODHUB_SUPPORT_EMAIL]');
}
