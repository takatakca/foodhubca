// Words and pictures of the public landing's product tour (/hub, /en/hub): real stills of the console, taken from the
// local demo build with fictional data (scripts/hub-shots.mjs → scripts/hub-media.mjs → public/hub-media/).
// Rules: every sentence says what the still shows or what the Clover App Market listing already claims
// (clover-listing.ts); no numbers that are not on screen, no hype words, no competitor names, no "coming soon".
// Tests: tests/public-hub-tour.test.ts.

import type { Lang } from './pricing';

export type ShotKey = 'orders' | 'today' | 'reports' | 'kitchen' | 'newOrder' | 'phone';

export interface Shot {
  /** File stem in public/hub-media. */
  file: string;
  /** Widths on disk, largest first (each one is `<file>-<lang>-<w>.webp`, or `<file>-<w>.webp` when not per language). */
  widths: number[];
  /** Intrinsic size of the largest file (CSS aspect ratio, no layout shift). */
  width: number;
  height: number;
  /** One still per language (the console speaks the visitor's language), or one for both. */
  perLang: boolean;
}

export const HUB_SHOTS: Record<ShotKey, Shot> = {
  orders: { file: 'orders', widths: [1280, 768], width: 1280, height: 800, perLang: true },
  today: { file: 'today', widths: [1280, 768], width: 1280, height: 800, perLang: true },
  reports: { file: 'reports', widths: [1280, 768], width: 1280, height: 800, perLang: true },
  kitchen: { file: 'kitchen', widths: [1280, 768], width: 1280, height: 800, perLang: true },
  newOrder: { file: 'new-order', widths: [960, 560], width: 960, height: 566, perLang: true },
  // The ordering page opens in French (its own first language, with an English button).
  phone: { file: 'ordering-phone', widths: [780, 390], width: 780, height: 1400, perLang: false },
};

export const shotSrc = (key: ShotKey, lang: Lang, w: number) => {
  const s = HUB_SHOTS[key];
  return `/hub-media/${s.file}${s.perLang ? `-${lang}` : ''}-${w}.webp`;
};
export const shotSrcSet = (key: ShotKey, lang: Lang) => HUB_SHOTS[key].widths.map((w) => `${shotSrc(key, lang, w)} ${w}w`).join(', ');

export interface TourSection {
  id: string;
  shot: ShotKey;
  /** A second, smaller still laid over the first (the new-order pop-up over the kitchen screen). */
  inset?: ShotKey;
  eyebrow: string;
  title: string;
  text: string;
  points: string[];
  alt: string;
  insetAlt?: string;
}

export interface TourWords {
  heroAlt: string;
  /** Under every still: the data is a demo. */
  demoNote: string;
  benefitsTitle: string;
  tourEyebrow: string;
  tourTitle: string;
  tourLead: string;
  sections: TourSection[];
}

export const TOUR: Record<Lang, TourWords> = {
  fr: {
    heroAlt: 'Le tableau des commandes de TAKATAK Food Hub : les commandes Uber Eats, DoorDash et SkipTheDishes de quatre succursales, en colonnes nouvelles, en préparation, prêtes et parties.',
    demoNote: 'Captures de la vraie console, avec des données de démonstration.',
    benefitsTitle: 'Ce qui change dans votre cuisine',
    tourEyebrow: 'Le produit',
    tourTitle: 'Ce que votre équipe voit chaque jour',
    tourLead: 'Une console pour le comptoir, une tablette pour la cuisine, la caisse Clover au centre. Voici les vrais écrans.',
    sections: [
      {
        id: 'commandes', shot: 'orders', eyebrow: 'Commandes',
        title: 'Toutes vos plateformes sur un seul tableau',
        text: 'Les commandes Uber Eats, DoorDash et SkipTheDishes de toutes vos succursales et de toutes vos marques arrivent au même endroit. Chacune passe de nouvelle à en préparation, prête, puis partie.',
        points: ['Filtres par succursale, par marque et par plateforme', 'Une alerte sonore à chaque nouvelle commande', 'La commande est créée dans Clover et son billet sort à la cuisine'],
        alt: 'Tableau des commandes : colonnes nouvelles, en préparation, prêtes et parties, avec un bouton « Prête » sur chaque commande.',
      },
      {
        id: 'cuisine', shot: 'kitchen', inset: 'newOrder', eyebrow: 'Écran de cuisine',
        title: 'La cuisine voit chaque commande, en grand',
        text: 'Une tablette suffit. Les articles sont en gros caractères, chaque commande a sa minuterie, et une nouvelle commande s’affiche par-dessus tout jusqu’à ce que quelqu’un la confirme d’un geste.',
        points: ['À préparer, prêtes, livreur en route', 'Allergies et notes en rouge', 'Rappel dans une minute et réimpression du billet'],
        alt: 'Écran de cuisine sombre : les commandes à préparer en grosses cartes, les commandes prêtes qui attendent le livreur à droite.',
        insetAlt: 'Une nouvelle commande DoorDash par-dessus l’écran de cuisine : la pizzeria, le total, les articles et le bouton « Vu — en préparation ».',
      },
      {
        id: 'aujourdhui', shot: 'today', eyebrow: 'Aujourd’hui',
        title: 'Votre journée en un coup d’œil',
        text: 'Ventes, commandes, temps de préparation et magasins ouverts, comparés à la même heure hier. La liste « À faire » montre ce qui attend une réponse, comme une commande en attente ou un magasin hors ligne.',
        points: ['Ventes des plateformes et ventes en salle Clover', 'Une alerte dès qu’un magasin se met hors ligne', 'Les commandes en cours, de toutes les plateformes'],
        alt: 'Page Aujourd’hui : ventes, nombre de commandes, temps de préparation, magasins ouverts, la liste À faire et les commandes en cours.',
      },
      {
        id: 'rapports', shot: 'reports', eyebrow: 'Rapports et argent',
        title: 'Des chiffres que vous pouvez vérifier',
        text: 'Ventes et tendances comparées à la période précédente, par plateforme et par marque. Chaque versement des plateformes est comparé aux commandes : l’argent manquant est signalé, et rien n’est approuvé à votre place.',
        points: ['Export Excel et lien à partager', 'Les ventes perdues (annulées) comptées à part', 'Temps pour accepter, temps de préparation, temps en ligne'],
        alt: 'Page Ventes et tendances : ventes, commandes, panier moyen, ventes perdues, temps pour accepter, temps de préparation et temps en ligne.',
      },
      {
        id: 'commande-directe', shot: 'phone', eyebrow: 'Commande directe',
        title: 'Votre propre page de commande',
        text: 'Une page pour emporter au nom de votre restaurant, en français et en anglais. Le client paie au comptoir ou en ligne par Clover, et la commande arrive à la caisse et à l’écran de cuisine comme les autres.',
        points: ['Activée marque par marque, dans les réglages', 'Paiement au comptoir ou en ligne par Clover', 'Le même billet et le même écran de cuisine'],
        alt: 'Page de commande pour emporter sur un téléphone : le nom du restaurant, l’adresse de cueillette, les catégories et les plats avec leur prix.',
      },
    ],
  },
  en: {
    heroAlt: 'The TAKATAK Food Hub orders board: Uber Eats, DoorDash and SkipTheDishes orders from four locations, in new, preparing, ready and picked-up columns.',
    demoNote: 'Stills of the real console, with demo data.',
    benefitsTitle: 'What changes in your kitchen',
    tourEyebrow: 'Product',
    tourTitle: 'What your team sees every day',
    tourLead: 'A console for the counter, a tablet for the kitchen, your Clover register in the middle. These are the real screens.',
    sections: [
      {
        id: 'orders', shot: 'orders', eyebrow: 'Orders',
        title: 'All your platforms on one board',
        text: 'Uber Eats, DoorDash and SkipTheDishes orders from every location and every brand land in one place. Each one moves from new to preparing, ready, then picked up.',
        points: ['Filters by location, brand and platform', 'A sound alert for every new order', 'The order is created in Clover and its ticket prints in the kitchen'],
        alt: 'Orders board: new, preparing, ready and picked-up columns, with a “Ready” button on each order.',
      },
      {
        id: 'kitchen', shot: 'kitchen', inset: 'newOrder', eyebrow: 'Kitchen screen',
        title: 'The kitchen sees every order, big',
        text: 'One tablet is enough. Items are in large type, each order has its timer, and a new order shows on top of everything until someone confirms it with one tap.',
        points: ['To cook, ready, courier arriving', 'Allergies and notes in red', 'Remind in one minute and reprint the ticket'],
        alt: 'Kitchen screen in night colours: orders to cook as large cards, ready orders waiting for the courier on the right.',
        insetAlt: 'A new DoorDash order on top of the kitchen screen: the pizzeria, the total, the items and the “Seen — cooking it” button.',
      },
      {
        id: 'today', shot: 'today', eyebrow: 'Today',
        title: 'Your day at a glance',
        text: 'Sales, orders, prep time and open stores, compared with the same time yesterday. The “To do” list shows what is waiting for an answer, like an order on hold or a store gone offline.',
        points: ['Platform sales and Clover in-store sales', 'An alert as soon as a store goes offline', 'Orders in progress, from every platform'],
        alt: 'Today page: sales, order count, prep time, open stores, the To do list and the orders in progress.',
      },
      {
        id: 'reports', shot: 'reports', eyebrow: 'Reports and money',
        title: 'Numbers you can check',
        text: 'Sales and trends compared with the previous period, by platform and by brand. Every platform payout is checked against your orders: missing money is flagged, and nothing is approved for you.',
        points: ['Excel export and a link to share', 'Lost (cancelled) sales counted on their own', 'Time to accept, prep time, time online'],
        alt: 'Sales and trends page: sales, orders, average order, lost sales, time to accept, prep time and time online.',
      },
      {
        id: 'direct-ordering', shot: 'phone', eyebrow: 'Direct ordering',
        title: 'Your own ordering page',
        text: 'A pickup page in your restaurant’s name, in French and English. Customers pay at the counter or online through Clover, and the order reaches the register and the kitchen screen like every other one.',
        points: ['Turned on brand by brand, in Settings', 'Pay at the counter or online through Clover', 'The same ticket and the same kitchen screen'],
        alt: 'Pickup ordering page on a phone: the restaurant name, the pickup address, the categories and the dishes with their prices.',
      },
    ],
  },
};
