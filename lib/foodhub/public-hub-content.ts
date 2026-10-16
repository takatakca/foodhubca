// Words of the public ON2GO Hub pages (/hub in French, /en/hub in English). French first (Québec), English twin.
// Rules: only features that ship today are claimed (the Clover App Market listing in clover-listing.ts is the source,
// reused word for word where it fits); Too Good To Go only "when your account offers an order feed"; the AI phone is
// "coming soon, a separate app"; no hours claims ("24…"), no competitor or aggregator names, no unproven numbers.
// Prices are built from pricing.ts (never typed here). Two tokens are filled per request by fillHub() in public-hub.ts:
// {company} (the legal name, FOODHUB_LEGAL_COMPANY) and {planned} (« (tarif prévu au lancement) » / "(planned launch
// pricing)" while the app is not on the Clover App Market, empty after). Each shared question lives on one page only.
// tests/public-hub.test.ts checks the lengths, the banned words and the Too Good To Go condition.

import { EXTRA_BRAND_PLATFORM_CAD, formatCad, monthlyTotalCad, STANDARD_MONTHLY_CAD, TRIAL_DAYS, type Lang } from './pricing';

const fr$ = (n: number) => formatCad(n, 'fr');
const en$ = (n: number) => formatCad(n, 'en');

/** The hub's own one-line pitch (under the landing H1, SoftwareApplication description, llms.txt). Too Good To Go is
 * left out: it is only ever named with its condition. */
export const HUB_TAGLINE: Record<Lang, string> = {
  fr: 'Uber Eats, DoorDash et SkipTheDishes directement dans votre caisse Clover : un seul écran, des menus et des ruptures synchronisés, des paiements vérifiés.',
  en: 'Uber Eats, DoorDash and SkipTheDishes straight into your Clover register: one screen, synced menus and sold-out items, verified payouts.',
};

export type HubPageKey = 'landing' | 'pricing' | 'uber' | 'doordash' | 'skip' | 'kitchen' | 'phone';

export const HUB_PAGE_KEYS: HubPageKey[] = ['landing', 'pricing', 'uber', 'doordash', 'skip', 'kitchen', 'phone'];

export const HUB_PATHS: Record<HubPageKey, Record<Lang, string>> = {
  landing: { fr: '/hub', en: '/en/hub' },
  pricing: { fr: '/hub/tarifs', en: '/en/hub/pricing' },
  uber: { fr: '/hub/integrations/uber-eats-clover', en: '/en/hub/integrations/uber-eats-clover' },
  doordash: { fr: '/hub/integrations/doordash-clover', en: '/en/hub/integrations/doordash-clover' },
  skip: { fr: '/hub/integrations/skipthedishes-clover', en: '/en/hub/integrations/skipthedishes-clover' },
  kitchen: { fr: '/hub/ecran-de-cuisine-clover', en: '/en/hub/clover-kitchen-display' },
  phone: { fr: '/hub/telephone-ia-restaurant', en: '/en/hub/ai-phone-for-restaurants' },
};

export interface Card { title: string; text: string }
export interface Faq { q: string; a: string }

export type Block =
  | { kind: 'benefits'; id: string; title: string }
  | { kind: 'features'; id: string; title: string; intro?: string; extra?: Card[] }
  | { kind: 'cards'; id: string; title: string; intro?: string; cards: Card[] }
  | { kind: 'steps'; id: string; title: string; steps: Card[] }
  | { kind: 'requirements'; id: string; title: string }
  | { kind: 'text'; id: string; title: string; paragraphs: string[] }
  | { kind: 'pricing'; id: string; title: string }
  | { kind: 'links'; id: string; title: string; pages: HubPageKey[] };

export interface HubPageContent {
  /** ≤ 60 characters, the brand at the end. */
  title: string;
  /** ≤ 155 characters, unique. */
  description: string;
  /** Short name in menus, links and breadcrumbs. */
  label: string;
  eyebrow: string;
  h1: string;
  /** Under the H1. */
  lead: string;
  /** A "coming soon" badge next to the H1. */
  soon?: boolean;
  blocks: Block[];
  faq: Faq[];
}

const STEPS: Record<Lang, Card[]> = {
  fr: [
    { title: 'Installez l’application', text: 'Depuis le Clover App Market, sur le compte marchand Clover de votre restaurant. L’essai gratuit commence à l’installation.' },
    { title: 'Branchez vos plateformes', text: 'Reliez vos propres comptes marchands Uber Eats, DoorDash ou SkipTheDishes, puis choisissez quelle marque et quel établissement chaque magasin représente.' },
    { title: 'Nous approuvons votre restaurant', text: 'Notre équipe vérifie chaque nouveau restaurant avant que la première commande soit envoyée à sa caisse. Ensuite, les commandes arrivent seules.' },
  ],
  en: [
    { title: 'Install the app', text: 'From the Clover App Market, on your restaurant’s Clover merchant account. The free trial starts at install.' },
    { title: 'Connect your platforms', text: 'Link your own Uber Eats, DoorDash or SkipTheDishes merchant accounts, then pick which brand and which location each store is.' },
    { title: 'We approve your restaurant', text: 'Our team checks each new restaurant before the first order is sent to its register. After that, orders arrive on their own.' },
  ],
};

const MULTI_BRAND: Record<Lang, Card> = {
  fr: { title: 'Plusieurs marques, une cuisine', text: 'Chaque marque garde son menu et ses magasins sur chaque plateforme, et toutes les commandes arrivent dans la même caisse Clover.' },
  en: { title: 'Several brands, one kitchen', text: 'Each brand keeps its own menu and stores on every platform, and every order lands in the same Clover register.' },
};

const PHONE_CARD: Record<Lang, Card> = {
  fr: { title: 'Téléphone IA (bientôt)', text: 'Une application distincte, avec son propre abonnement : un assistant conçu pour répondre aux appels de commande et envoyer la commande à Clover.' },
  en: { title: 'AI phone (coming soon)', text: 'A separate app with its own subscription: an assistant designed to answer ordering calls and send the order to Clover.' },
};

const MONTREAL: Record<Lang, string[]> = {
  fr: [
    'ON2GO Hub est conçu à Montréal par {company} et sert chaque jour dans nos propres restaurants ON2GO, à Notre-Dame-de-Grâce et à Saint-Léonard. Chaque fonction est née d’un vrai problème de cuisine : trop de tablettes, des menus qui ne concordent plus, des paiements difficiles à vérifier.',
    'Le service et l’interface sont en français et en anglais.',
  ],
  en: [
    'ON2GO Hub is built in Montréal by {company} and runs every day in our own ON2GO restaurants, in Notre-Dame-de-Grâce and Saint-Léonard. Each feature comes from a real kitchen problem: too many tablets, menus that drift apart, payouts that are hard to check.',
    'Service and interface are in French and English.',
  ],
};

const FAQ_PRICE: Record<Lang, Faq> = {
  fr: { q: 'Combien coûte ON2GO Hub ?', a: `Essai gratuit de ${TRIAL_DAYS} jours, puis ${fr$(STANDARD_MONTHLY_CAD)} par mois par app{planned}. Votre première marque est incluse ; chaque marque supplémentaire coûte ${fr$(EXTRA_BRAND_PLATFORM_CAD)} par mois pour chaque plateforme où elle est branchée. Clover facture l’abonnement.` },
  en: { q: 'How much does ON2GO Hub cost?', a: `${TRIAL_DAYS}-day free trial, then ${en$(STANDARD_MONTHLY_CAD)} a month per app{planned}. Your first brand is included; each extra brand costs ${en$(EXTRA_BRAND_PLATFORM_CAD)} a month for each platform it is connected to. Clover bills the subscription.` },
};

const FAQ_CARDS: Record<Lang, Faq> = {
  fr: { q: 'ON2GO Hub traite-t-il des paiements par carte ?', a: 'Non. Les clients paient sur la plateforme de livraison. ON2GO Hub enregistre seulement la commande comme payée dans Clover, avec un mode de paiement au nom de la plateforme, pour que la fermeture de caisse soit juste.' },
  en: { q: 'Does ON2GO Hub process card payments?', a: 'No. Customers pay on the delivery platform. ON2GO Hub only records the order as paid in Clover, with a tender named after the platform, so your closeout is right.' },
};

const FAQ_APPROVAL: Record<Lang, Faq> = {
  fr: { q: 'Pourquoi une approbation avant la première commande ?', a: 'Pour éviter qu’une commande parte vers la mauvaise caisse. Notre équipe vérifie que chaque magasin de livraison est relié au bon établissement Clover avant d’ouvrir le flux.' },
  en: { q: 'Why an approval before the first order?', a: 'So that no order ever goes to the wrong register. Our team checks that each delivery store is linked to the right Clover location before the flow is opened.' },
};

function integration(lang: Lang, p: { name: string; key: 'uber' | 'doordash' | 'skip' }): Pick<HubPageContent, 'eyebrow' | 'h1' | 'label'> {
  return lang === 'fr'
    ? { label: `${p.name} et Clover`, eyebrow: `Intégration ${p.name} · Clover`, h1: `Les commandes ${p.name} directement dans votre caisse Clover` }
    : { label: `${p.name} and Clover`, eyebrow: `${p.name} · Clover integration`, h1: `${p.name} orders straight into your Clover register` };
}

export const HUB_CONTENT: Record<HubPageKey, Record<Lang, HubPageContent>> = {
  landing: {
    fr: {
      title: 'Uber Eats et DoorDash dans Clover | ON2GO Hub',
      description: 'ON2GO Hub envoie les commandes des applis de livraison dans Clover, avec écran de cuisine et menus par marque. Conçu à Montréal.',
      label: 'Accueil',
      eyebrow: 'Pour les restaurants qui utilisent Clover, au Canada',
      h1: 'Vos commandes Uber Eats, DoorDash et SkipTheDishes directement dans votre caisse Clover',
      lead: HUB_TAGLINE.fr,
      blocks: [
        { kind: 'benefits', id: 'avantages', title: 'Ce qui change dans votre cuisine' },
        { kind: 'steps', id: 'comment', title: 'Comment ça marche', steps: STEPS.fr },
        { kind: 'features', id: 'fonctions', title: 'Tout ce que fait ON2GO Hub', intro: 'Les mêmes fonctions que dans notre fiche du Clover App Market, sans agrégateur entre vous et les plateformes.', extra: [MULTI_BRAND.fr, PHONE_CARD.fr] },
        { kind: 'links', id: 'integrations', title: 'Intégrations et outils', pages: ['uber', 'doordash', 'skip', 'kitchen', 'phone'] },
        { kind: 'requirements', id: 'prealables', title: 'Ce qu’il vous faut' },
        { kind: 'text', id: 'montreal', title: 'Conçu et utilisé à Montréal', paragraphs: MONTREAL.fr },
        { kind: 'pricing', id: 'tarifs', title: 'Tarifs' },
      ],
      faq: [
        { q: 'Faut-il un agrégateur de livraison ?', a: 'Non. ON2GO Hub se branche directement aux plateformes de livraison et à votre caisse Clover, sans intermédiaire entre les deux.' },
        { q: 'Quelles plateformes sont prises en charge ?', a: 'Uber Eats, DoorDash et SkipTheDishes, ainsi que Too Good To Go lorsque votre compte offre un flux de commandes.' },
        { q: 'Quel matériel Clover faut-il ?', a: 'Un forfait Clover qui comprend l’inventaire et les commandes, et un appareil Clover avec une imprimante de commandes.' },
        FAQ_CARDS.fr,
        FAQ_APPROVAL.fr,
        { q: 'L’application est-elle en français ?', a: 'Oui. Toute l’interface est en français et en anglais, et chaque membre de l’équipe choisit sa langue.' },
      ],
    },
    en: {
      title: 'Uber Eats & DoorDash orders in Clover | ON2GO Hub',
      description: 'ON2GO Hub sends delivery app orders into Clover, with a kitchen screen and menus per brand. Built in Montréal for restaurants.',
      label: 'Home',
      eyebrow: 'For restaurants on Clover, in Canada',
      h1: 'Your Uber Eats, DoorDash and SkipTheDishes orders straight into your Clover register',
      lead: HUB_TAGLINE.en,
      blocks: [
        { kind: 'benefits', id: 'benefits', title: 'What changes in your kitchen' },
        { kind: 'steps', id: 'how', title: 'How it works', steps: STEPS.en },
        { kind: 'features', id: 'features', title: 'Everything ON2GO Hub does', intro: 'The same features as our Clover App Market listing, with no aggregator between you and the platforms.', extra: [MULTI_BRAND.en, PHONE_CARD.en] },
        { kind: 'links', id: 'integrations', title: 'Integrations and tools', pages: ['uber', 'doordash', 'skip', 'kitchen', 'phone'] },
        { kind: 'requirements', id: 'requirements', title: 'What you need' },
        { kind: 'text', id: 'montreal', title: 'Built and used in Montréal', paragraphs: MONTREAL.en },
        { kind: 'pricing', id: 'pricing', title: 'Pricing' },
      ],
      faq: [
        { q: 'Do I need a delivery aggregator?', a: 'No. ON2GO Hub connects straight to the delivery platforms and to your Clover register, with nothing in between.' },
        { q: 'Which platforms are supported?', a: 'Uber Eats, DoorDash and SkipTheDishes, plus Too Good To Go when your account offers an order feed.' },
        { q: 'What Clover hardware do I need?', a: 'A Clover plan that includes Inventory and Orders, and a Clover device with an order printer.' },
        FAQ_CARDS.en,
        FAQ_APPROVAL.en,
        { q: 'Is the app in French?', a: 'Yes. The whole interface is in French and English, and each team member picks their language.' },
      ],
    },
  },

  pricing: {
    fr: {
      title: `Tarifs ON2GO Hub : essai gratuit de ${TRIAL_DAYS} jours`,
      description: `Essai gratuit de ${TRIAL_DAYS} jours, puis ${fr$(STANDARD_MONTHLY_CAD)}/mois par app et ${fr$(EXTRA_BRAND_PLATFORM_CAD)} par marque supplémentaire par plateforme, facturé par Clover. Prix en dollars canadiens.`,
      label: 'Tarifs',
      eyebrow: 'Tarifs',
      h1: 'Un prix simple, facturé par Clover',
      lead: 'Une seule app pour toutes vos plateformes de livraison. Vous payez pour les marques que vous branchez, rien d’autre.',
      blocks: [
        { kind: 'pricing', id: 'forfait', title: 'Le forfait' },
        { kind: 'cards', id: 'exemples', title: 'Exemples', cards: [
          { title: 'Une marque', text: `Un restaurant, une marque, branchée sur Uber Eats, DoorDash et SkipTheDishes : ${fr$(monthlyTotalCad(0))} par mois.` },
          { title: 'Deux marques', text: `Une deuxième marque branchée sur les trois plateformes : 3 × ${fr$(EXTRA_BRAND_PLATFORM_CAD)} = ${fr$(3 * EXTRA_BRAND_PLATFORM_CAD)} de plus, soit ${fr$(monthlyTotalCad(3))} par mois.` },
          { title: 'Une marque de plus sur une seule plateforme', text: `Une deuxième marque sur Uber Eats seulement : ${fr$(EXTRA_BRAND_PLATFORM_CAD)} de plus, soit ${fr$(monthlyTotalCad(1))} par mois.` },
        ] },
        { kind: 'text', id: 'facturation', title: 'Comment la facturation fonctionne', paragraphs: [
          'L’abonnement passe par Clover, sur le compte marchand où l’application est installée : Clover gère l’essai gratuit et la facture. Nous ne vous facturons rien directement.',
          'Le téléphone IA sera une application distincte, avec son propre essai gratuit et son propre abonnement Clover.',
        ] },
      ],
      faq: [
        FAQ_PRICE.fr,
        { q: 'Qu’est-ce qu’une marque supplémentaire ?', a: `Votre première marque est incluse. Chaque autre marque coûte ${fr$(EXTRA_BRAND_PLATFORM_CAD)} par mois pour chaque plateforme de livraison où elle est branchée (Uber Eats, DoorDash, SkipTheDishes).` },
        { q: 'Qui facture l’abonnement ?', a: `Clover, sur le compte marchand où l’application est installée. L’essai gratuit de ${TRIAL_DAYS} jours est géré par Clover.` },
        { q: 'Comment arrêter ?', a: 'Désinstallez l’application de votre compte Clover. Les jetons d’accès Clover sont alors supprimés aussitôt.' },
      ],
    },
    en: {
      title: `ON2GO Hub pricing: ${TRIAL_DAYS}-day free trial`,
      description: `${TRIAL_DAYS}-day free trial, then ${en$(STANDARD_MONTHLY_CAD)}/month per app and ${en$(EXTRA_BRAND_PLATFORM_CAD)} per extra brand per platform, billed by Clover. Prices in Canadian dollars.`,
      label: 'Pricing',
      eyebrow: 'Pricing',
      h1: 'Simple pricing, billed by Clover',
      lead: 'One app for all your delivery platforms. You pay for the brands you connect, nothing else.',
      blocks: [
        { kind: 'pricing', id: 'plan', title: 'The plan' },
        { kind: 'cards', id: 'examples', title: 'Examples', cards: [
          { title: 'One brand', text: `One restaurant, one brand, on Uber Eats, DoorDash and SkipTheDishes: ${en$(monthlyTotalCad(0))} a month.` },
          { title: 'Two brands', text: `A second brand on all three platforms: 3 × ${en$(EXTRA_BRAND_PLATFORM_CAD)} = ${en$(3 * EXTRA_BRAND_PLATFORM_CAD)} more, so ${en$(monthlyTotalCad(3))} a month.` },
          { title: 'One more brand on one platform', text: `A second brand on Uber Eats only: ${en$(EXTRA_BRAND_PLATFORM_CAD)} more, so ${en$(monthlyTotalCad(1))} a month.` },
        ] },
        { kind: 'text', id: 'billing', title: 'How billing works', paragraphs: [
          'The subscription runs through Clover, on the merchant account where the app is installed: Clover runs the free trial and the invoice. We never bill you directly.',
          'The AI phone will be a separate app, with its own free trial and its own Clover subscription.',
        ] },
      ],
      faq: [
        FAQ_PRICE.en,
        { q: 'What is an extra brand?', a: `Your first brand is included. Each other brand costs ${en$(EXTRA_BRAND_PLATFORM_CAD)} a month for each delivery platform it is connected to (Uber Eats, DoorDash, SkipTheDishes).` },
        { q: 'Who bills the subscription?', a: `Clover, on the merchant account where the app is installed. The ${TRIAL_DAYS}-day free trial is run by Clover.` },
        { q: 'How do I stop?', a: 'Uninstall the app from your Clover account. Your Clover access tokens are deleted at once.' },
      ],
    },
  },

  uber: {
    fr: {
      ...integration('fr', { name: 'Uber Eats', key: 'uber' }),
      title: 'Intégration Uber Eats et Clover | ON2GO Hub',
      description: 'Recevez les commandes Uber Eats dans Clover : billet imprimé, menu publié, ruptures synchronisées et paiements Uber Eats vérifiés.',
      lead: 'Chaque commande Uber Eats est créée dans Clover avec le type de commande « Uber Eats », imprimée à la cuisine, puis enregistrée payée quand le livreur part.',
      blocks: [
        { kind: 'cards', id: 'fonctions', title: 'Ce que fait l’intégration', cards: [
          { title: 'Commandes', text: 'Alerte sonore, acceptation en un geste, commande créée dans Clover avec ses articles, modificateurs et notes, puis billet à l’imprimante de cuisine.' },
          { title: 'Paiement à la sortie', text: 'Au départ du livreur, la commande est enregistrée payée avec le mode de paiement « Uber Eats » : la fermeture de caisse est juste.' },
          { title: 'Menu', text: 'Votre menu maître est publié sur Uber Eats avec les heures, les jours fériés et, si vous le voulez, une majoration en % propre à Uber Eats.' },
          { title: 'Ruptures et pauses', text: 'Un article en rupture dans Clover est retiré d’Uber Eats ; un établissement se met en pause ou rouvre d’un clic, avec mode occupé et temps de préparation.' },
          { title: 'Paiements vérifiés', text: 'Chaque versement Uber Eats est comparé aux commandes : frais, remboursements, ajustements et argent manquant sont signalés.' },
        ] },
        { kind: 'steps', id: 'brancher', title: 'Brancher Uber Eats', steps: [
          { title: 'Connexion Uber Eats', text: 'Dans ON2GO Hub, le bouton de connexion Uber Eats ouvre la page de connexion d’Uber : vous autorisez l’accès avec votre compte marchand.' },
          { title: 'Choix des magasins', text: 'Vos magasins Uber Eats s’affichent ; pour chacun, choisissez la marque et l’établissement Clover.' },
          { title: 'Approbation', text: 'Notre équipe vérifie le jumelage, puis les commandes Uber Eats arrivent dans Clover.' },
        ] },
        { kind: 'links', id: 'autres', title: 'Autres intégrations', pages: ['doordash', 'skip', 'kitchen'] },
      ],
      faq: [
        { q: 'Mes prix Uber Eats peuvent-ils être différents de ceux du comptoir ?', a: 'Oui, si vous le choisissez : une majoration en % par plateforme s’applique au menu publié. Sans majoration, ce sont les prix de votre menu maître.' },
        { q: 'Que se passe-t-il si un article manque ?', a: 'Marquez-le en rupture dans Clover : il est retiré d’Uber Eats en quelques secondes et remis en vente d’un clic.' },
        { q: 'Comment savoir si Uber Eats m’a tout payé ?', a: 'Chaque versement Uber Eats est comparé aux commandes reçues : les frais, les remboursements, les ajustements et l’argent manquant sont signalés dans ON2GO Hub.' },
      ],
    },
    en: {
      ...integration('en', { name: 'Uber Eats', key: 'uber' }),
      title: 'Uber Eats Clover integration | ON2GO Hub',
      description: 'Get Uber Eats orders in Clover: kitchen ticket printed, menu published, sold-out items synced and Uber Eats payouts checked.',
      lead: 'Each Uber Eats order is created in Clover with the “Uber Eats” order type, printed in the kitchen, then recorded as paid when the courier leaves.',
      blocks: [
        { kind: 'cards', id: 'features', title: 'What the integration does', cards: [
          { title: 'Orders', text: 'Sound alert, one-tap accept, order created in Clover with its items, modifiers and notes, then the ticket on the kitchen printer.' },
          { title: 'Paid at pickup', text: 'When the courier leaves, the order is recorded as paid with the “Uber Eats” tender, so your closeout is right.' },
          { title: 'Menu', text: 'Your master menu is published to Uber Eats with hours, holidays and, if you want, a % markup for Uber Eats only.' },
          { title: 'Sold out and pauses', text: 'An item out of stock in Clover comes off Uber Eats; a location pauses or reopens in one click, with busy mode and prep time.' },
          { title: 'Checked payouts', text: 'Each Uber Eats payout is checked against your orders: fees, refunds, adjustments and missing money are flagged.' },
        ] },
        { kind: 'steps', id: 'connect', title: 'Connect Uber Eats', steps: [
          { title: 'Uber Eats sign-in', text: 'In ON2GO Hub, the Uber Eats connect button opens Uber’s sign-in page: you allow access with your merchant account.' },
          { title: 'Pick your stores', text: 'Your Uber Eats stores are listed; for each one, pick the brand and the Clover location.' },
          { title: 'Approval', text: 'Our team checks the match, then Uber Eats orders flow into Clover.' },
        ] },
        { kind: 'links', id: 'more', title: 'Other integrations', pages: ['doordash', 'skip', 'kitchen'] },
      ],
      faq: [
        { q: 'Can my Uber Eats prices differ from in-store prices?', a: 'Yes, if you choose: a % markup per platform applies to the published menu. Without one, your master menu prices are used.' },
        { q: 'What happens when an item runs out?', a: 'Mark it out of stock in Clover: it comes off Uber Eats within seconds and goes back on sale in one click.' },
        { q: 'How do I know Uber Eats paid me in full?', a: 'Each Uber Eats payout is checked against the orders you received: fees, refunds, adjustments and missing money are flagged in ON2GO Hub.' },
      ],
    },
  },

  doordash: {
    fr: {
      ...integration('fr', { name: 'DoorDash', key: 'doordash' }),
      title: 'Intégration DoorDash et Clover | ON2GO Hub',
      description: 'Les commandes DoorDash arrivent dans Clover et à l’imprimante de cuisine. Menu maître, ruptures et paiements DoorDash suivis au même endroit.',
      lead: 'Fini la tablette DoorDash à surveiller à côté de la caisse : chaque commande DoorDash devient une commande Clover, avec son type « DoorDash » et son billet de cuisine.',
      blocks: [
        { kind: 'cards', id: 'fonctions', title: 'Ce que fait l’intégration', cards: [
          { title: 'Commandes dans Clover', text: 'Articles, modificateurs, notes et allergies arrivent dans Clover avec le type de commande « DoorDash », et le billet sort à la cuisine.' },
          { title: 'Menu lu par DoorDash', text: 'DoorDash lit votre menu maître dans ON2GO Hub : prix, options, heures et une majoration en % propre à DoorDash si vous la voulez.' },
          { title: 'Ruptures', text: 'Un article en rupture dans Clover est retiré de DoorDash, puis remis en vente partout d’un clic.' },
          { title: 'Paiement et fermeture', text: 'À la sortie, la commande est enregistrée payée avec le mode de paiement « DoorDash » : chaque plateforme a sa ligne dans la fermeture de caisse.' },
          { title: 'Versements vérifiés', text: 'Les versements DoorDash sont comparés aux commandes ; les écarts sont signalés, et rien n’est approuvé à votre place.' },
        ] },
        { kind: 'steps', id: 'brancher', title: 'Brancher DoorDash', steps: [
          { title: 'Votre magasin DoorDash', text: 'Vous gardez votre propre compte marchand DoorDash. L’intégration est activée pour votre magasin avec DoorDash.' },
          { title: 'Jumelage', text: 'Dans ON2GO Hub, le magasin DoorDash est relié à sa marque et à son établissement Clover.' },
          { title: 'Approbation', text: 'Notre équipe vérifie le jumelage avant que la première commande DoorDash soit envoyée à votre caisse.' },
        ] },
        { kind: 'links', id: 'autres', title: 'Autres intégrations', pages: ['uber', 'skip', 'kitchen'] },
      ],
      faq: [
        { q: 'Dois-je changer de compte DoorDash ?', a: 'Non. Vous gardez votre compte marchand DoorDash ; ON2GO Hub s’y relie pour recevoir les commandes et fournir le menu.' },
        { q: 'Les allergies sont-elles visibles à la cuisine ?', a: 'Oui. Les notes et les allergies sont imprimées sur le billet et affichées en rouge sur l’écran de cuisine.' },
        { q: 'Que devient la tablette DoorDash ?', a: 'Les commandes DoorDash arrivent dans Clover, à l’imprimante et sur l’écran de cuisine, avec celles des autres plateformes : vous n’avez plus à surveiller une tablette à part pour les recevoir.' },
      ],
    },
    en: {
      ...integration('en', { name: 'DoorDash', key: 'doordash' }),
      title: 'DoorDash Clover integration | ON2GO Hub',
      description: 'DoorDash orders land in Clover and on the kitchen printer. Master menu, sold-out items and DoorDash payouts tracked in one place.',
      lead: 'No more DoorDash tablet to watch next to the register: each DoorDash order becomes a Clover order, with its “DoorDash” order type and its kitchen ticket.',
      blocks: [
        { kind: 'cards', id: 'features', title: 'What the integration does', cards: [
          { title: 'Orders in Clover', text: 'Items, modifiers, notes and allergies reach Clover with the “DoorDash” order type, and the ticket prints in the kitchen.' },
          { title: 'Menu read by DoorDash', text: 'DoorDash reads your master menu from ON2GO Hub: prices, options, hours and a % markup for DoorDash only if you want one.' },
          { title: 'Sold out', text: 'An item out of stock in Clover comes off DoorDash, then goes back on sale everywhere in one click.' },
          { title: 'Paid and closed out', text: 'When it leaves, the order is recorded as paid with the “DoorDash” tender: each platform has its own line in your closeout.' },
          { title: 'Checked payouts', text: 'DoorDash payouts are checked against your orders; gaps are flagged, and nothing is approved for you.' },
        ] },
        { kind: 'steps', id: 'connect', title: 'Connect DoorDash', steps: [
          { title: 'Your DoorDash store', text: 'You keep your own DoorDash merchant account. The integration is turned on for your store with DoorDash.' },
          { title: 'Matching', text: 'In ON2GO Hub, the DoorDash store is linked to its brand and its Clover location.' },
          { title: 'Approval', text: 'Our team checks the match before the first DoorDash order is sent to your register.' },
        ] },
        { kind: 'links', id: 'more', title: 'Other integrations', pages: ['uber', 'skip', 'kitchen'] },
      ],
      faq: [
        { q: 'Do I need a new DoorDash account?', a: 'No. You keep your DoorDash merchant account; ON2GO Hub links to it to receive orders and provide the menu.' },
        { q: 'Does the kitchen see allergies?', a: 'Yes. Notes and allergies are printed on the ticket and shown in red on the kitchen screen.' },
        { q: 'What about the DoorDash tablet?', a: 'DoorDash orders reach Clover, the printer and the kitchen display along with the other platforms, so you no longer watch a separate tablet to receive them.' },
      ],
    },
  },

  skip: {
    fr: {
      ...integration('fr', { name: 'SkipTheDishes', key: 'skip' }),
      title: 'Intégration SkipTheDishes et Clover | ON2GO Hub',
      description: 'Branchez SkipTheDishes à Clover : commandes créées et imprimées, acceptation automatique ou manuelle, menu et ruptures synchronisés.',
      lead: 'Les commandes SkipTheDishes rejoignent celles des autres plateformes dans votre caisse Clover, avec le type de commande « SkipTheDishes » et le billet à la cuisine.',
      blocks: [
        { kind: 'cards', id: 'fonctions', title: 'Ce que fait l’intégration', cards: [
          { title: 'Acceptation à votre façon', text: 'Pour chaque magasin, choisissez l’acceptation automatique ou un geste du personnel avant que la commande parte à la cuisine.' },
          { title: 'Commandes dans Clover', text: 'Articles, options et notes arrivent dans Clover, montants au cent près, et le billet sort à l’imprimante de cuisine.' },
          { title: 'Menu et heures', text: 'Le même menu maître que sur les autres plateformes, avec ses heures, ses jours fériés et une majoration propre à SkipTheDishes si vous la voulez.' },
          { title: 'Ruptures et pauses', text: 'Rupture dans Clover = article retiré ; pause ou réouverture d’un établissement sur toutes les plateformes en même temps.' },
          { title: 'Argent', text: 'Les paiements SkipTheDishes sont comparés aux commandes, et la commande sortie est enregistrée payée avec son propre mode de paiement.' },
        ] },
        { kind: 'steps', id: 'brancher', title: 'Brancher SkipTheDishes', steps: [
          { title: 'Votre compte SkipTheDishes', text: 'Vous gardez votre compte de restaurant SkipTheDishes ; l’intégration est reliée à vos magasins.' },
          { title: 'Jumelage et mode d’acceptation', text: 'Chaque magasin est relié à sa marque et à son établissement Clover, en acceptation automatique ou manuelle.' },
          { title: 'Approbation', text: 'Notre équipe vérifie le tout, puis les commandes arrivent dans Clover.' },
        ] },
        { kind: 'links', id: 'autres', title: 'Autres intégrations', pages: ['uber', 'doordash', 'kitchen'] },
      ],
      faq: [
        { q: 'Puis-je accepter les commandes moi-même ?', a: 'Oui. L’acceptation automatique se règle magasin par magasin ; en mode manuel, la commande attend un geste de votre équipe.' },
        { q: 'Les montants sont-ils exacts dans Clover ?', a: 'Oui. Les montants reçus de SkipTheDishes sont repris au cent près dans la commande Clover.' },
        { q: 'SkipTheDishes utilise-t-il le même menu que les autres plateformes ?', a: 'Oui. Le même menu maître sert à toutes vos plateformes ; seule la majoration en %, si vous en choisissez une pour SkipTheDishes, change les prix publiés.' },
      ],
    },
    en: {
      ...integration('en', { name: 'SkipTheDishes', key: 'skip' }),
      title: 'SkipTheDishes Clover integration | ON2GO Hub',
      description: 'Connect SkipTheDishes to Clover: orders created and printed, automatic or manual accept, menu and sold-out items kept in sync.',
      lead: 'SkipTheDishes orders join the other platforms in your Clover register, with the “SkipTheDishes” order type and the ticket in the kitchen.',
      blocks: [
        { kind: 'cards', id: 'features', title: 'What the integration does', cards: [
          { title: 'Accept your way', text: 'For each store, pick automatic accept or a tap from your staff before the order goes to the kitchen.' },
          { title: 'Orders in Clover', text: 'Items, options and notes reach Clover, amounts to the cent, and the ticket prints on the kitchen printer.' },
          { title: 'Menu and hours', text: 'The same master menu as the other platforms, with its hours, holidays and a markup for SkipTheDishes only if you want one.' },
          { title: 'Sold out and pauses', text: 'Out of stock in Clover = item off; pause or reopen a location on every platform at once.' },
          { title: 'Money', text: 'SkipTheDishes payments are checked against your orders, and the order is recorded as paid with its own tender when it leaves.' },
        ] },
        { kind: 'steps', id: 'connect', title: 'Connect SkipTheDishes', steps: [
          { title: 'Your SkipTheDishes account', text: 'You keep your SkipTheDishes restaurant account; the integration is linked to your stores.' },
          { title: 'Matching and accept mode', text: 'Each store is linked to its brand and its Clover location, with automatic or manual accept.' },
          { title: 'Approval', text: 'Our team checks everything, then orders flow into Clover.' },
        ] },
        { kind: 'links', id: 'more', title: 'Other integrations', pages: ['uber', 'doordash', 'kitchen'] },
      ],
      faq: [
        { q: 'Can I accept orders myself?', a: 'Yes. Automatic accept is set store by store; in manual mode, the order waits for a tap from your team.' },
        { q: 'Are the amounts right in Clover?', a: 'Yes. Amounts from SkipTheDishes are carried to the cent into the Clover order.' },
        { q: 'Does SkipTheDishes use the same menu as the other platforms?', a: 'Yes. One master menu serves all your platforms; only the % markup, if you pick one for SkipTheDishes, changes the published prices.' },
      ],
    },
  },

  kitchen: {
    fr: {
      title: 'Écran de cuisine pour Clover | ON2GO Hub',
      description: 'Un écran de cuisine pour toutes vos commandes de livraison : à préparer, prêtes, livreur en route, allergies en rouge et minuteries.',
      label: 'Écran de cuisine',
      eyebrow: 'Écran de cuisine · Clover',
      h1: 'Un écran de cuisine pour toutes vos commandes de livraison',
      lead: 'Uber Eats, DoorDash et SkipTheDishes sur un seul écran, à côté de votre imprimante Clover : l’équipe voit quoi préparer, quoi remettre et qui arrive.',
      blocks: [
        { kind: 'cards', id: 'ecran', title: 'Ce que voit la cuisine', cards: [
          { title: 'À préparer, prêtes, en route', text: 'Les commandes avancent de colonne en colonne, avec le livreur annoncé quand il arrive.' },
          { title: 'Allergies en rouge', text: 'Les notes et les allergies ressortent en rouge, sur l’écran comme sur le billet.' },
          { title: 'Minuteries', text: 'Chaque commande affiche son temps écoulé, pour savoir laquelle passer en premier.' },
          { title: 'Alerte sonore', text: 'Chaque nouvelle commande s’annonce par une alerte sonore.' },
          { title: 'Billet Clover', text: 'Le billet s’imprime sur l’imprimante de commandes Clover, avec les notes du client.' },
          { title: 'Tablette verrouillée', text: 'La tablette de cuisine s’ouvre avec un NIP, sans le mot de passe du propriétaire.' },
        ] },
        { kind: 'text', id: 'materiel', title: 'Le matériel', paragraphs: [
          'L’écran de cuisine fonctionne dans un navigateur, sur une tablette ou un écran déjà présent en cuisine. L’impression passe par l’imprimante de commandes de votre appareil Clover.',
        ] },
        { kind: 'links', id: 'integrations', title: 'Les commandes qui y arrivent', pages: ['uber', 'doordash', 'skip'] },
      ],
      faq: [
        { q: 'Faut-il acheter un écran spécial ?', a: 'Non. L’écran de cuisine s’ouvre dans un navigateur, sur une tablette ou un écran que vous avez déjà.' },
        { q: 'L’écran remplace-t-il l’imprimante ?', a: 'Non, il la complète : le billet s’imprime toujours sur l’imprimante de commandes Clover.' },
        { q: 'Les commandes de toutes les plateformes sont-elles sur le même écran ?', a: 'Oui. Les commandes Uber Eats, DoorDash et SkipTheDishes s’affichent sur le même écran de cuisine, dans les mêmes colonnes.' },
      ],
    },
    en: {
      title: 'Clover kitchen display for delivery | ON2GO Hub',
      description: 'One kitchen display for all your delivery orders: to cook, ready, courier arriving, allergies in red and timers. Works with Clover.',
      label: 'Kitchen display',
      eyebrow: 'Kitchen display · Clover',
      h1: 'One kitchen display for all your delivery orders',
      lead: 'Uber Eats, DoorDash and SkipTheDishes on one screen, next to your Clover printer: the team sees what to cook, what to hand over and who is coming.',
      blocks: [
        { kind: 'cards', id: 'screen', title: 'What the kitchen sees', cards: [
          { title: 'To cook, ready, on the way', text: 'Orders move from column to column, with the courier shown when they arrive.' },
          { title: 'Allergies in red', text: 'Notes and allergies stand out in red, on screen and on the ticket.' },
          { title: 'Timers', text: 'Each order shows its elapsed time, so you know which one goes first.' },
          { title: 'Sound alert', text: 'Each new order announces itself with a sound alert.' },
          { title: 'Clover ticket', text: 'The ticket prints on the Clover order printer, with the customer’s notes.' },
          { title: 'Locked tablet', text: 'The kitchen tablet opens with a PIN, without the owner’s password.' },
        ] },
        { kind: 'text', id: 'hardware', title: 'Hardware', paragraphs: [
          'The kitchen display runs in a web browser, on a tablet or a screen already in your kitchen. Printing goes through the order printer of your Clover device.',
        ] },
        { kind: 'links', id: 'integrations', title: 'Orders that show up there', pages: ['uber', 'doordash', 'skip'] },
      ],
      faq: [
        { q: 'Do I need special hardware?', a: 'No. The kitchen display opens in a web browser, on a tablet or a screen you already have.' },
        { q: 'Does the display replace the printer?', a: 'No, it adds to it: the ticket still prints on the Clover order printer.' },
        { q: 'Are orders from every platform on the same screen?', a: 'Yes. Uber Eats, DoorDash and SkipTheDishes orders show on the same kitchen display, in the same columns.' },
      ],
    },
  },

  phone: {
    fr: {
      title: 'Téléphone IA pour restaurant (bientôt) | ON2GO Hub',
      description: 'Bientôt : un assistant IA qui répond aux appels de commande de votre restaurant et envoie la commande à Clover. Application distincte.',
      label: 'Téléphone IA',
      eyebrow: 'Bientôt : application distincte',
      h1: 'Un téléphone IA qui prend les commandes de votre restaurant',
      soon: true,
      lead: 'Une application Clover distincte, en préparation : elle est conçue pour répondre aux appels de commande, même pendant le rush, et envoyer la commande à votre caisse.',
      blocks: [
        { kind: 'cards', id: 'prevu', title: 'Ce qui est prévu', cards: [
          { title: 'Conçu pour le rush', text: 'L’assistant est conçu pour décrocher quand toute l’équipe est occupée, pendant les heures de pointe.' },
          { title: 'Français et anglais', text: 'L’assistant parle avec le client dans sa langue et se présente comme un assistant IA.' },
          { title: 'Commande dans Clover', text: 'La commande suit votre menu, ses options et vos heures, puis arrive dans Clover et à la cuisine comme les autres.' },
          { title: 'Lien de paiement', text: 'Le client peut recevoir un lien de paiement par texto pour payer avant de venir chercher sa commande.' },
        ] },
        { kind: 'text', id: 'application', title: 'Une application à part', paragraphs: [
          'Le téléphone IA sera offert comme une application distincte sur le Clover App Market, avec son propre essai gratuit et son propre abonnement.',
          'Il n’est pas encore offert. Pour être avisé de son lancement, écrivez-nous.',
        ] },
        { kind: 'links', id: 'disponible', title: 'Déjà disponible', pages: ['landing', 'kitchen', 'pricing'] },
      ],
      faq: [
        { q: 'Le téléphone IA est-il inclus dans ON2GO Hub ?', a: 'Non. Ce sera une application distincte, avec son propre essai gratuit et son propre abonnement Clover.' },
        { q: 'Quand sera-t-il offert ?', a: 'Il est en préparation. Écrivez-nous pour être avisé de son lancement.' },
        { q: 'Les clients sauront-ils qu’ils parlent à une IA ?', a: 'Oui. L’assistant se présentera comme un assistant IA au début de chaque appel.' },
      ],
    },
    en: {
      title: 'AI phone ordering for restaurants (soon) | ON2GO Hub',
      description: 'Coming soon: an AI assistant that answers your restaurant’s ordering calls and sends the order to Clover. A separate app.',
      label: 'AI phone',
      eyebrow: 'Coming soon: a separate app',
      h1: 'An AI phone that takes your restaurant’s orders',
      soon: true,
      lead: 'A separate Clover app, in the works: it is designed to answer ordering calls, even at rush hour, and send the order to your register.',
      blocks: [
        { kind: 'cards', id: 'planned', title: 'What is planned', cards: [
          { title: 'Built for the rush', text: 'The assistant is designed to pick up when the whole team is busy, at rush hour.' },
          { title: 'French and English', text: 'The assistant speaks with each caller in their language and introduces itself as an AI assistant.' },
          { title: 'Order in Clover', text: 'The order follows your menu, options and hours, then reaches Clover and the kitchen like the others.' },
          { title: 'Payment link', text: 'Callers can get a payment link by text message to pay before they pick up.' },
        ] },
        { kind: 'text', id: 'app', title: 'An app of its own', paragraphs: [
          'The AI phone will be a separate app on the Clover App Market, with its own free trial and its own subscription.',
          'It is not available yet. To hear when it launches, write to us.',
        ] },
        { kind: 'links', id: 'available', title: 'Available today', pages: ['landing', 'kitchen', 'pricing'] },
      ],
      faq: [
        { q: 'Is the AI phone part of ON2GO Hub?', a: 'No. It will be a separate app, with its own free trial and its own Clover subscription.' },
        { q: 'When will it be available?', a: 'It is in the works. Write to us to hear when it launches.' },
        { q: 'Will callers know they are talking to an AI?', a: 'Yes. The assistant will introduce itself as an AI assistant at the start of each call.' },
      ],
    },
  },
};

/** UI words of the page frame. */
export const HUB_UI: Record<Lang, Record<string, string>> = {
  fr: {
    skip: 'Aller au contenu',
    signIn: 'Se connecter',
    otherLang: 'English',
    pricing: 'Tarifs',
    integrations: 'Intégrations',
    home: 'Accueil',
    marketSoon: 'Bientôt sur le Clover App Market',
    marketSoonNote: 'L’application est en révision chez Clover.',
    marketCta: 'Voir sur le Clover App Market',
    marketLive: 'Disponible sur le Clover App Market',
    plannedPricing: 'Tarif prévu au lancement',
    seePricing: 'Voir les tarifs',
    trial: 'jours d’essai gratuit',
    plannedNote: ' (tarif prévu au lancement)',
    perMonthPerApp: 'par mois, par app',
    perExtraBrand: 'par mois, par marque supplémentaire, par plateforme',
    firstBrand: 'Votre première marque est incluse.',
    billedByClover: 'Facturé par Clover. Montants en dollars canadiens.',
    faq: 'Questions fréquentes',
    platformsLabel: 'Plateformes',
    tgtgNote: 'Too Good To Go : lorsque votre compte offre un flux de commandes.',
    soon: 'Bientôt',
    contact: 'Écrivez-nous',
    support: 'Soutien',
    privacy: 'Confidentialité',
    terms: 'Conditions',
    listingName: 'Sur le Clover App Market : TAKATAK Food Hub.',
    madeIn: 'Conçu à Montréal.',
    breadcrumb: 'Fil d’Ariane',
    nav: 'Navigation principale',
    ctaTitle: 'Toutes vos plateformes de livraison, une seule caisse Clover',
  },
  en: {
    skip: 'Skip to content',
    signIn: 'Sign in',
    otherLang: 'Français',
    pricing: 'Pricing',
    integrations: 'Integrations',
    home: 'Home',
    marketSoon: 'Coming soon to the Clover App Market',
    marketSoonNote: 'The app is under review by Clover.',
    marketCta: 'View on the Clover App Market',
    marketLive: 'Available on the Clover App Market',
    plannedPricing: 'Planned launch pricing',
    seePricing: 'See pricing',
    trial: 'day free trial',
    plannedNote: ' (planned launch pricing)',
    perMonthPerApp: 'per month, per app',
    perExtraBrand: 'per month, per extra brand, per platform',
    firstBrand: 'Your first brand is included.',
    billedByClover: 'Billed by Clover. Amounts in Canadian dollars.',
    faq: 'Frequently asked questions',
    platformsLabel: 'Platforms',
    tgtgNote: 'Too Good To Go: when your account offers an order feed.',
    soon: 'Coming soon',
    contact: 'Write to us',
    support: 'Support',
    privacy: 'Privacy',
    terms: 'Terms',
    listingName: 'On the Clover App Market: TAKATAK Food Hub.',
    madeIn: 'Built in Montréal.',
    breadcrumb: 'Breadcrumb',
    nav: 'Main navigation',
    ctaTitle: 'All your delivery platforms, one Clover register',
  },
};
