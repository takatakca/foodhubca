// Words of the premium visual sections of the public landing (/hub, /en/hub): the live device in the hero, the
// "one brain" diagram, the two showcase cards, the feature explorer, the integrations panel and the facts band.
// Same rules as public-hub-content.ts: only what ships today (the Clover listing is the source), no competitor or
// aggregator names, no unproven numbers, no hours claims, none of the banned words of tests/public-hub.test.ts.
// The orders shown in the device and the tablet are an illustration (marked aria-hidden in the page), not data.
// Tests: tests/public-hub-showcase.test.ts.

import type { Lang } from './pricing';

export interface ShowcaseFeature { id: string; tab: string; title: string; text: string; points: string[] }
export interface DemoOrder { platform: 'uber' | 'doordash' | 'skip'; label: string; ref: string; items: string; total: string; state: string }

export interface ShowcaseWords {
  live: string; liveSub: string; newOrder: string; accept: string; sentToClover: string; printed: string;
  chips: [string, string, string];
  orders: DemoOrder[];
  brainEyebrow: string; brainTitle: string; brainLead: string; brainSteps: Array<{ title: string; text: string }>;
  core: string; coreSub: string; register: string; registerSub: string; kitchen: string; kitchenSub: string;
  tabletTitle: string; tabletText: string; tabletHeader: string; tabletNew: string;
  menuTitle: string; menuText: string; menuMaster: string; menuItems: string[]; soldOut: string; synced: string;
  explorerEyebrow: string; explorerTitle: string; explorerLead: string; features: ShowcaseFeature[];
  integrationsTitle: string; deliveryTitle: string; deliveryText: string; posTitle: string; posText: string;
  connected: string; certifying: string; tgtgCondition: string; otherPos: string; otherPosCta: string;
  facts: Array<{ big: string; small: string }>;
  demoNote: string;
}

const ORDERS_FR: DemoOrder[] = [
  { platform: 'uber', label: 'Uber Eats', ref: 'A-1043', items: '2 × Shawarma poulet · Frites', total: '31,48 $', state: 'Nouvelle' },
  { platform: 'doordash', label: 'DoorDash', ref: 'D-8821', items: 'Poutine · Boisson', total: '18,95 $', state: 'En préparation' },
  { platform: 'skip', label: 'SkipTheDishes', ref: 'S-5512', items: 'Pizza moyenne · Salade', total: '27,10 $', state: 'Prête' },
];
const ORDERS_EN: DemoOrder[] = [
  { platform: 'uber', label: 'Uber Eats', ref: 'A-1043', items: '2 × Chicken shawarma · Fries', total: '$31.48', state: 'New' },
  { platform: 'doordash', label: 'DoorDash', ref: 'D-8821', items: 'Poutine · Drink', total: '$18.95', state: 'Cooking' },
  { platform: 'skip', label: 'SkipTheDishes', ref: 'S-5512', items: 'Medium pizza · Salad', total: '$27.10', state: 'Ready' },
];

export const SHOWCASE: Record<Lang, ShowcaseWords> = {
  fr: {
    live: 'Commandes en direct', liveSub: 'Toutes les plateformes, un seul écran', newOrder: 'Nouvelle commande', accept: 'Accepter',
    sentToClover: 'Envoyée à la caisse Clover', printed: 'Imprimée en cuisine',
    chips: ['Rupture retirée partout', 'Paiement vérifié', 'Magasin en ligne'],
    orders: ORDERS_FR,
    brainEyebrow: 'Un seul cerveau pour votre restaurant',
    brainTitle: 'Chaque commande entre par un seul chemin',
    brainLead: 'Uber Eats, DoorDash et SkipTheDishes envoient leurs commandes à TAKATAK Food Hub. Il les crée dans votre caisse Clover, les imprime en cuisine et garde chaque plateforme à jour.',
    brainSteps: [
      { title: 'La commande arrive', text: 'Une alerte sonore, la commande s’accepte en un geste, sur l’écran que vous voulez.' },
      { title: 'Elle entre dans Clover', text: 'Créée dans la caisse avec un type de commande par plateforme, puis imprimée en cuisine.' },
      { title: 'Tout reste synchronisé', text: 'Menus, ruptures, pauses et paiements : un changement fait ici vaut pour chaque plateforme.' },
    ],
    core: 'Food Hub', coreSub: 'TAKATAK', register: 'Clover', registerSub: 'votre caisse', kitchen: 'Cuisine', kitchenSub: 'imprimante et écran',
    tabletTitle: 'Fini la jonglerie entre tablettes',
    tabletText: 'Les commandes de chaque plateforme arrivent ensemble, triées par état : à préparer, prêtes, livreur en route. Une seule alerte, un seul geste pour accepter.',
    tabletHeader: 'À préparer', tabletNew: 'Nouvelle',
    menuTitle: 'Un menu, partout',
    menuText: 'Un menu maître publié sur Uber Eats, DoorDash et SkipTheDishes, avec une majoration par plateforme. Un article en rupture dans Clover est retiré de toutes les plateformes en quelques secondes.',
    menuMaster: 'Menu maître', menuItems: ['Shawarma poulet', 'Poutine classique', 'Pizza moyenne', 'Baklava'], soldOut: 'Rupture', synced: 'Synchronisé',
    explorerEyebrow: 'Ce que fait TAKATAK Food Hub', explorerTitle: 'Cliquez sur une fonction',
    explorerLead: 'Huit outils, un seul écran. Chacun fonctionne avec votre caisse Clover et vos propres comptes marchands.',
    features: [
      { id: 'orders', tab: 'Commandes', title: 'Toutes vos commandes de livraison au même endroit', text: 'Les commandes Uber Eats, DoorDash et SkipTheDishes arrivent avec une alerte sonore, s’acceptent en un geste et entrent dans Clover. Une fois sorties, elles sont enregistrées payées avec un mode de paiement par plateforme, pour que la fermeture de caisse soit juste.', points: ['Alerte sonore', 'Acceptation en un geste', 'Type de commande par plateforme dans Clover'] },
      { id: 'kitchen', tab: 'Cuisine', title: 'Un écran de cuisine clair', text: 'À préparer, prêtes, livreur en route : chaque commande avance d’une colonne à l’autre. Les allergies et les notes ressortent en rouge à l’écran, et chaque commande a sa minuterie.', points: ['Colonnes par état', 'Allergies en rouge à l’écran', 'Minuteries'] },
      { id: 'menus', tab: 'Menus', title: 'Un menu maître publié partout', text: 'Importez votre inventaire Clover, vérifiez-le, puis publiez un menu maître sur chaque plateforme avec les heures, les jours fériés, les catégories à horaire et une majoration en % par plateforme.', points: ['Import de l’inventaire Clover', 'Heures et jours fériés', 'Majoration par plateforme'] },
      { id: 'soldout', tab: 'Ruptures', title: 'Une rupture, retirée partout', text: 'Un article en rupture dans Clover est retiré de toutes les plateformes en quelques secondes, puis remis en vente partout d’un clic.', points: ['Depuis Clover', 'Toutes les plateformes', 'Remise en vente d’un clic'] },
      { id: 'stores', tab: 'Magasins', title: 'Vos succursales sous contrôle', text: 'Mettez en pause ou rouvrez une succursale sur toutes les plateformes, passez en mode occupé et ajustez le temps de préparation.', points: ['Pause et réouverture', 'Mode occupé', 'Temps de préparation'] },
      { id: 'money', tab: 'Argent', title: 'Chaque paiement vérifié', text: 'Chaque paiement des plateformes est comparé aux commandes ; frais, remboursements, ajustements et argent manquant sont signalés. Rien n’est approuvé ni comptabilisé automatiquement : vous décidez.', points: ['Comparaison aux commandes', 'Argent manquant signalé', 'Vous gardez la décision'] },
      { id: 'alerts', tab: 'Alertes', title: 'Vous êtes prévenu à temps', text: 'Une alerte dès qu’un magasin se met hors ligne ou qu’une commande attend une réponse.', points: ['Magasin hors ligne', 'Commande sans réponse', 'Sur l’écran de votre choix'] },
      { id: 'team', tab: 'Équipe', title: 'Une équipe, des rôles clairs', text: 'Connexion par code (courriel ou texto), des rôles pour chacun et un NIP de gérant pour tout ce qui touche l’argent.', points: ['Connexion par code', 'Rôles', 'NIP de gérant'] },
    ],
    integrationsTitle: 'Branché sur ce que vous utilisez déjà',
    deliveryTitle: 'Plateformes de livraison', deliveryText: 'Vos propres comptes marchands, reliés directement : aucun agrégateur entre vous et les plateformes.',
    posTitle: 'Caisse', posText: 'TAKATAK Food Hub est une application Clover : les commandes entrent dans votre caisse et sortent à votre imprimante de commandes.',
    connected: 'Disponible', certifying: 'Certification en cours', tgtgCondition: 'lorsque votre compte offre un flux de commandes',
    otherPos: 'Vous utilisez une autre caisse ?', otherPosCta: 'Écrivez-nous',
    facts: [
      { big: '1 écran', small: 'au lieu d’une tablette par plateforme' },
      { big: 'Quelques secondes', small: 'pour retirer une rupture de toutes les plateformes' },
      { big: 'Chaque paiement', small: 'comparé à vos commandes' },
      { big: 'Français et anglais', small: 'pour toute l’équipe' },
    ],
    demoNote: 'Illustration : commandes et prix fictifs.',
  },
  en: {
    live: 'Live orders', liveSub: 'Every platform, one screen', newOrder: 'New order', accept: 'Accept',
    sentToClover: 'Sent to the Clover register', printed: 'Printed in the kitchen',
    chips: ['Sold out everywhere', 'Payout checked', 'Store online'],
    orders: ORDERS_EN,
    brainEyebrow: 'One brain for your restaurant',
    brainTitle: 'Every order comes in one way',
    brainLead: 'Uber Eats, DoorDash and SkipTheDishes send their orders to TAKATAK Food Hub. It creates them in your Clover register, prints them in the kitchen and keeps every platform up to date.',
    brainSteps: [
      { title: 'The order arrives', text: 'A sound alert, and the order is accepted in one tap, on the screen you choose.' },
      { title: 'It goes into Clover', text: 'Created in the register with an order type per platform, then printed in the kitchen.' },
      { title: 'Everything stays in sync', text: 'Menus, sold-out items, pauses and payouts: a change made here counts on every platform.' },
    ],
    core: 'Food Hub', coreSub: 'TAKATAK', register: 'Clover', registerSub: 'your register', kitchen: 'Kitchen', kitchenSub: 'printer and screen',
    tabletTitle: 'No more juggling tablets',
    tabletText: 'Orders from every platform arrive together, sorted by state: to cook, ready, courier arriving. One alert, one tap to accept.',
    tabletHeader: 'To cook', tabletNew: 'New',
    menuTitle: 'One menu, everywhere',
    menuText: 'One master menu published to Uber Eats, DoorDash and SkipTheDishes, with a markup per platform. An item out of stock in Clover is taken off every platform within seconds.',
    menuMaster: 'Master menu', menuItems: ['Chicken shawarma', 'Classic poutine', 'Medium pizza', 'Baklava'], soldOut: 'Sold out', synced: 'Synced',
    explorerEyebrow: 'What TAKATAK Food Hub does', explorerTitle: 'Click a feature',
    explorerLead: 'Eight tools, one screen. Each works with your Clover register and your own merchant accounts.',
    features: [
      { id: 'orders', tab: 'Orders', title: 'All your delivery orders in one place', text: 'Uber Eats, DoorDash and SkipTheDishes orders arrive with a sound alert, are accepted in one tap and go into Clover. Once they leave, they are recorded as paid with a tender per platform, so your Clover closeout is right.', points: ['Sound alert', 'One-tap accept', 'Order type per platform in Clover'] },
      { id: 'kitchen', tab: 'Kitchen', title: 'A clear kitchen screen', text: 'To cook, ready, courier arriving: each order moves from one column to the next. Allergies and notes stand out in red on screen, and every order has its timer.', points: ['Columns by state', 'Allergies in red on screen', 'Timers'] },
      { id: 'menus', tab: 'Menus', title: 'One master menu, published everywhere', text: 'Import your Clover inventory, check it, then publish one master menu to every platform with hours, holidays, scheduled categories and a % markup per platform.', points: ['Clover inventory import', 'Hours and holidays', 'Markup per platform'] },
      { id: 'soldout', tab: 'Sold out', title: 'Sold out once, off everywhere', text: 'An item out of stock in Clover is taken off every platform within seconds, then back on sale everywhere in one click.', points: ['From Clover', 'Every platform', 'Back on sale in one click'] },
      { id: 'stores', tab: 'Stores', title: 'Your locations under control', text: 'Pause or reopen a location on every platform, switch to busy mode and adjust the prep time.', points: ['Pause and reopen', 'Busy mode', 'Prep time'] },
      { id: 'money', tab: 'Money', title: 'Every payout checked', text: 'Every platform payout is checked against your orders; fees, refunds, adjustments and missing money are flagged. Nothing is approved or posted automatically: you decide.', points: ['Checked against orders', 'Missing money flagged', 'You keep the decision'] },
      { id: 'alerts', tab: 'Alerts', title: 'You hear about it in time', text: 'An alert as soon as a store goes offline or an order is waiting for an answer.', points: ['Store offline', 'Order waiting', 'On the screen you choose'] },
      { id: 'team', tab: 'Team', title: 'One team, clear roles', text: 'Sign-in by code (email or text), roles for everyone and a manager PIN for anything that touches money.', points: ['Sign-in by code', 'Roles', 'Manager PIN'] },
    ],
    integrationsTitle: 'Connected to what you already use',
    deliveryTitle: 'Delivery platforms', deliveryText: 'Your own merchant accounts, connected directly: no aggregator between you and the platforms.',
    posTitle: 'Register', posText: 'TAKATAK Food Hub is a Clover app: orders go into your register and out of your order printer.',
    connected: 'Available', certifying: 'Certification in progress', tgtgCondition: 'when your account offers an order feed',
    otherPos: 'Using another register?', otherPosCta: 'Write to us',
    facts: [
      { big: '1 screen', small: 'instead of one tablet per platform' },
      { big: 'Seconds', small: 'to take a sold-out item off every platform' },
      { big: 'Every payout', small: 'checked against your orders' },
      { big: 'French and English', small: 'for the whole team' },
    ],
    demoNote: 'Illustration: fictional orders and prices.',
  },
};
