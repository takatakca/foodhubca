// Words of the public ON2GO.ca pages (/hub in French, /en/hub in English). French first (Québec), English twin.
// Copy describes configured workflows and their prerequisites, without treating a code path as live API approval.
// The protected Clover listing name and pricing remain sourced separately; the AI phone is
// TAKATAK Phone AI, a separate Clover app (submitted to the Clover App Market with TAKATAK Food Hub on 2026-10-17);
// no hours claims, no competitor or aggregator names, no unproven numbers.
// Prices are built from pricing.ts (never typed here). Two tokens are filled per request by fillHub() in public-hub.ts:
// {company} (the legal name, FOODHUB_LEGAL_COMPANY) and {pending} (« L’intégration avec DoorDash … est en cours de
// certification. » for the platforms not yet in FOODHUB_PUBLIC_LIVE_PLATFORMS, empty once all are live).
// Each shared question lives on one page only.
// tests/public-hub.test.ts checks the lengths, the banned words and the Too Good To Go condition.

import {
  EXTRA_BRAND_PLATFORM_CAD, formatCadLabel, monthlyTotalCad, PHONE_MINUTE_CAD, PHONE_MONTHLY_CAD, PHONE_TRIAL_DAYS,
  STANDARD_MONTHLY_CAD, TRIAL_DAYS, type HubPlatform, type Lang,
} from './pricing';
import { TOKEN_DELETION } from './legal';

const fr$ = (n: number) => formatCadLabel(n, 'fr');
const en$ = (n: number) => formatCadLabel(n, 'en');

/** The hub's own one-line pitch (under the landing H1, SoftwareApplication description, llms.txt). Too Good To Go is
 * left out: it is only ever named with its condition. */
export const HUB_TAGLINE: Record<Lang, string> = {
  fr: 'Food Hub réunit les outils de gestion de vos commandes, menus et établissements, avec des espaces pour Uber Eats, DoorDash et SkipTheDishes.',
  en: 'Food Hub brings order, menu and location management together, with workspaces for Uber Eats, DoorDash and SkipTheDishes.',
};

export type HubPageKey = 'landing' | 'pricing' | 'uber' | 'doordash' | 'skip' | 'kitchen' | 'phone' | 'help';

export const HUB_PAGE_KEYS: HubPageKey[] = ['landing', 'pricing', 'uber', 'doordash', 'skip', 'kitchen', 'phone', 'help'];

export const HUB_PATHS: Record<HubPageKey, Record<Lang, string>> = {
  landing: { fr: '/hub', en: '/en/hub' },
  pricing: { fr: '/hub/tarifs', en: '/en/hub/pricing' },
  uber: { fr: '/hub/integrations/uber-eats-clover', en: '/en/hub/integrations/uber-eats-clover' },
  doordash: { fr: '/hub/integrations/doordash-clover', en: '/en/hub/integrations/doordash-clover' },
  skip: { fr: '/hub/integrations/skipthedishes-clover', en: '/en/hub/integrations/skipthedishes-clover' },
  kitchen: { fr: '/hub/ecran-de-cuisine-clover', en: '/en/hub/clover-kitchen-display' },
  phone: { fr: '/hub/telephone-ia-restaurant', en: '/en/hub/ai-phone-for-restaurants' },
  help: { fr: '/hub/aide', en: '/en/hub/help' },
};

export interface Card { title: string; text: string }
export interface Faq { q: string; a: string }

export type Block =
  | { kind: 'cards'; id: string; title: string; intro?: string; cards: Card[] }
  | { kind: 'steps'; id: string; title: string; steps: Card[] }
  | { kind: 'text'; id: string; title: string; paragraphs: string[] }
  | { kind: 'pricing'; id: string; title: string; product?: 'foodhub' | 'phone' | 'both' }
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
  /** The delivery platform an integration page is about: until that platform approved the integration
   * (FOODHUB_PUBLIC_LIVE_PLATFORMS), the page shows « in certification » and stays out of the index. */
  platform?: HubPlatform;
  blocks: Block[];
  faq: Faq[];
}

/** TAKATAK Phone AI price, with how the AI minutes are counted (same words as the terms, lib/foodhub/legal.ts). */
const PHONE_PRICE_TEXT: Record<Lang, string> = {
  fr: `Essai gratuit de ${PHONE_TRIAL_DAYS} jours, puis ${fr$(PHONE_MONTHLY_CAD)} par mois, plus ${fr$(PHONE_MINUTE_CAD)} par minute d’IA. Les minutes couvrent seulement le temps avec l’assistant, de sa réponse jusqu’au transfert à une personne, à la fin de l’appel ou au raccrochage, arrondi à la minute supérieure par appel, qu’une commande soit passée ou non. L’attente pendant un transfert et le temps avec le personnel sont exclus. Aucune minute n’est facturée pendant l’essai ni lorsque l’abonnement Clover n’est pas actif. Clover facture l’abonnement et les minutes.`,
  en: `${PHONE_TRIAL_DAYS}-day free trial, then ${en$(PHONE_MONTHLY_CAD)} a month, plus ${en$(PHONE_MINUTE_CAD)} per AI minute. Minutes cover only time with the assistant, from its answer until transfer to a person, the end of the call or hang-up, rounded up per call, whether or not an order is placed. Transfer wait and time with restaurant staff are excluded. No minutes are billed during the trial or while the Clover subscription is inactive. Clover bills the subscription and the minutes.`,
};

function integrationContent(lang: Lang, key: HubPlatform, name: string): HubPageContent {
  const fr = lang === 'fr';
  const access: Record<HubPlatform, Card> = fr ? {
    uber: { title: 'Autorisez votre compte', text: 'Lorsque l’accès est disponible, vous autorisez Food Hub depuis la page Uber. Votre mot de passe reste sur la page de la plateforme.' },
    doordash: { title: 'Vérifiez l’accès de votre magasin', text: 'L’activation dépend de l’accès accordé par DoorDash pour votre magasin. Cet accès est vérifié avant de configurer le flux.' },
    skip: { title: 'Vérifiez votre accès Skip', text: 'La connexion nécessite les accès Skip autorisés pour vos magasins. Les écrans marchands peuvent être configurés séparément.' },
  } : {
    uber: { title: 'Authorize your account', text: 'When access is available, authorize Food Hub from Uber’s page. Your password stays on the platform’s sign-in page.' },
    doordash: { title: 'Review your store’s access', text: 'Activation depends on access granted by DoorDash for your store. That access is reviewed before configuring the flow.' },
    skip: { title: 'Review your Skip access', text: 'The connection requires authorized Skip access for your stores. Merchant screens can be configured separately.' },
  };
  return {
    platform: key, label: `${name} ${fr ? 'et' : 'and'} Clover`, eyebrow: `FOOD HUB · ${name.toUpperCase()} · CLOVER`,
    title: `${fr ? 'Intégration' : 'Integration:'} ${name} ${fr ? 'et' : 'and'} Clover | Food Hub`,
    description: fr ? `Gérez vos opérations ${name} avec Food Hub et Clover : commandes, menus, établissements et relevés. Accès autorisés et configuration requis.` : `Manage ${name} operations with Food Hub and Clover: orders, menus, locations and statements. Authorized access and setup are required.`,
    h1: fr ? `Vos opérations ${name}, dans Food Hub.` : `Your ${name} operations, in Food Hub.`,
    lead: fr ? `Un espace dédié au suivi de vos commandes, de vos menus et de vos établissements ${name}, avec Clover au centre de votre configuration.` : `A dedicated workspace for your ${name} orders, menus and locations, with Clover at the center of your setup.`,
    blocks: [
      { kind: 'cards', id: 'outils', title: fr ? 'Vos opérations, dans la bonne vue.' : 'Your operations, in the right view.', intro: fr ? `Les fonctions connectées nécessitent les accès autorisés par ${name}, une configuration Clover compatible et un parcours de commande vérifié avant l’activation.` : `Connected features require access authorized by ${name}, a compatible Clover setup and an order flow verified before activation.`, cards: fr ? [
        { title: 'De la commande à la cuisine', text: 'Suivez les commandes reçues et leurs notes. Une connexion active permet de transmettre les commandes à Clover et les billets à la cuisine.' },
        { title: 'Votre menu, par plateforme', text: `Préparez votre menu maître, vos options et vos prix ${name}. Consultez le résultat des publications sur la connexion configurée.` },
        { title: 'Vos établissements disponibles', text: `Gérez les articles indisponibles, les horaires et les pauses selon les fonctions offertes par ${name}. Les actions disponibles sont indiquées dans Food Hub.` },
        { title: 'Vos relevés, à examiner', text: 'Comparez les relevés disponibles à vos commandes. Examinez les frais, les remboursements et les écarts signalés avant toute décision.' },
      ] : [
        { title: 'From order to kitchen', text: 'Track received orders and their notes. An active connection supports sending orders to Clover and tickets to the kitchen.' },
        { title: 'Your menu, by platform', text: `Prepare your master menu, options and ${name} prices. Check publication results on the configured connection.` },
        { title: 'Your locations’ availability', text: `Manage unavailable items, hours and pauses using the features provided by ${name}. Available actions are shown in Food Hub.` },
        { title: 'Your statements, ready for review', text: 'Compare available statements with your orders. Review fees, refunds and flagged differences before making a decision.' },
      ] },
      { kind: 'steps', id: 'configuration', title: fr ? `Configurer ${name} avec votre restaurant.` : `Set up ${name} for your restaurant.`, steps: [access[key], fr ? { title: 'Associez le bon établissement', text: 'Chaque magasin est relié à sa marque et au bon établissement Clover.' } : { title: 'Match the right location', text: 'Each store is matched to its brand and the correct Clover location.' }, fr ? { title: 'Validez le parcours', text: 'Un test vérifie la réception, l’association à Clover et l’arrivée en cuisine avant l’activation du flux.' } : { title: 'Verify the flow', text: 'A test checks receipt, Clover mapping and the path to the kitchen before the flow is activated.' }] },
      { kind: 'links', id: 'autres', title: fr ? 'Continuez votre visite.' : 'Continue exploring.', pages: [...(['uber', 'doordash', 'skip'] as const).filter((p) => p !== key), 'kitchen', 'help'] },
    ],
    faq: fr ? [
      { q: `Puis-je continuer à utiliser le portail ${name}?`, a: `Oui. Vous conservez votre compte marchand et son portail. Certaines fonctions et certaines demandes restent gérées directement avec ${name}.` },
      { q: `Comment connecter les écrans ${name}?`, a: 'Le mur de tablettes utilise des sessions hébergées sur un ordinateur ou un serveur configuré. Vous vous connectez vous-même. Ces écrans et la connexion API sont configurés séparément.' },
      { q: `Quand les commandes ${name} peuvent-elles être activées?`, a: 'Après vérification des accès autorisés, de l’association à l’établissement Clover et d’un test du parcours de commande. La présence d’outils dans Food Hub ne remplace pas ces vérifications.' },
    ] : [
      { q: `Can I keep using the ${name} portal?`, a: `Yes. You keep your merchant account and its portal. Some functions and requests continue to be managed directly with ${name}.` },
      { q: `How do I connect ${name} screens?`, a: 'The tablet wall uses sessions hosted on a configured computer or server. You sign in yourself. Those screens and the API connection are configured separately.' },
      { q: `When can ${name} orders be activated?`, a: 'After authorized access, Clover location mapping and an order-flow test are verified. The presence of tools in Food Hub does not replace those checks.' },
    ],
  };
}

export const HUB_CONTENT: Record<HubPageKey, Record<Lang, HubPageContent>> = {
  landing: {
    fr: {
      title: 'Food Hub pour restaurants | ON2GO.ca',
      description: 'Vos commandes, menus et établissements dans un même espace. Découvrez Food Hub pour Uber Eats, DoorDash, SkipTheDishes et Clover.',
      label: 'Accueil',
      eyebrow: 'Pour les restaurateurs',
      h1: 'Vos plateformes de livraison. Un seul espace de travail.',
      lead: HUB_TAGLINE.fr,
      blocks: [],
      faq: [
        { q: 'Puis-je conserver mes comptes de livraison ?', a: 'Oui. Vous utilisez vos propres comptes marchands. Chaque compte est associé à votre marque et au bon établissement dans Food Hub.' },
        { q: 'Une tablette remplace-t-elle une connexion API ?', a: 'Non. Le mur d’écrans affiche des sessions marchandes hébergées sur votre ordinateur ou votre serveur; vous vous y connectez vous-même. Une connexion API échange des données avec une plateforme et nécessite ses autorisations. Afficher un écran ne l’active pas.' },
        { q: 'Puis-je gérer plusieurs marques ou établissements ?', a: 'Oui. Food Hub permet de choisir une marque, un établissement ou une plateforme pour adapter la vue. Les frais pour marques supplémentaires sont indiqués dans les tarifs.' },
        { q: 'De quoi ai-je besoin pour utiliser Clover ?', a: 'D’un compte Clover avec les fonctions d’inventaire et de commandes, d’appareils compatibles avec votre configuration et d’un compte Food Hub approuvé. Les préalables sont vérifiés avant d’activer les flux.' },
        { q: 'Qui traite les paiements des commandes de livraison ?', a: 'Les commandes des plateformes restent payées sur ces plateformes. Food Hub peut enregistrer leur mode de paiement dans Clover pour faciliter le suivi; il ne prélève pas un nouveau paiement par carte pour ces commandes.' },
        { q: 'Puis-je travailler en français et en anglais ?', a: 'Oui. L’interface Food Hub est offerte dans les deux langues. Les écrans des plateformes conservent leurs propres options de langue.' },
      ],
    },
    en: {
      title: 'Food Hub for restaurants | ON2GO.ca',
      description: 'Bring orders, menus and locations into one workspace. Explore Food Hub for Uber Eats, DoorDash, SkipTheDishes and Clover.',
      label: 'Home',
      eyebrow: 'For restaurant operators',
      h1: 'Your delivery platforms. One workspace.',
      lead: HUB_TAGLINE.en,
      blocks: [],
      faq: [
        { q: 'Can I keep my delivery accounts?', a: 'Yes. You use your own merchant accounts. Each account is matched to your brand and the correct location in Food Hub.' },
        { q: 'Does a tablet replace an API connection?', a: 'No. The tablet wall displays merchant sessions hosted on your computer or server; you sign in yourself. An API connection exchanges data with a platform and requires its authorization. Displaying a screen does not enable it.' },
        { q: 'Can I manage several brands or locations?', a: 'Yes. Food Hub lets you select a brand, location or platform to adjust your view. Additional-brand charges are shown in the pricing.' },
        { q: 'What do I need to use Clover?', a: 'A Clover account with inventory and order features, devices compatible with your setup and an approved Food Hub account. Requirements are reviewed before enabling order flows.' },
        { q: 'Who processes delivery order payments?', a: 'Platform orders remain paid through those platforms. Food Hub can record their payment method in Clover for tracking; it does not take a new card payment for those orders.' },
        { q: 'Can I work in French and English?', a: 'Yes. The Food Hub interface is available in both languages. Platform screens keep their own language options.' },
      ],
    },
  },

  pricing: {
    fr: {
      title: 'Tarifs Food Hub et Phone AI | Food Hub',
      description: `Food Hub : ${fr$(STANDARD_MONTHLY_CAD)}/mois, +${fr$(EXTRA_BRAND_PLATFORM_CAD)}/mois par marque et plateforme. Phone AI est distinct. Taxes en sus. Facturé par Clover.`,
      label: 'Tarifs', eyebrow: 'TARIFS · CANADA', h1: 'Le prix de Food Hub, en toute clarté.',
      lead: 'Un abonnement pour votre première marque. Des frais selon les plateformes connectées pour les marques supplémentaires. Une application distincte pour les commandes par téléphone.',
      blocks: [
        { kind: 'pricing', id: 'forfaits', title: 'Choisissez le service dont vous avez besoin.', product: 'both' },
        { kind: 'cards', id: 'exemples', title: 'Ce que coûtent les marques supplémentaires.', intro: 'Exemples Food Hub avant taxes. Le nombre de marques connectées à chaque plateforme détermine les frais supplémentaires.', cards: [
          { title: 'Une marque', text: `Votre première marque sur ses plateformes connectées : ${fr$(monthlyTotalCad(0))} par mois.` },
          { title: 'Deux marques, trois plateformes', text: `La deuxième marque sur trois plateformes ajoute 3 × ${fr$(EXTRA_BRAND_PLATFORM_CAD)}, pour un total de ${fr$(monthlyTotalCad(3))} par mois.` },
          { title: 'Une marque ajoutée sur une plateforme', text: `Une marque supplémentaire connectée à une seule plateforme : ${fr$(EXTRA_BRAND_PLATFORM_CAD)} de plus, pour un total de ${fr$(monthlyTotalCad(1))} par mois.` },
        ] },
        { kind: 'text', id: 'facturation', title: 'La facturation passe par Clover.', paragraphs: ['Clover gère l’essai gratuit, l’abonnement et les frais supplémentaires sur le compte marchand où l’application est installée. Les prix sont en dollars canadiens, taxes en sus.', 'Le prix en vigueur apparaît dans la fiche Clover App Market au moment de l’installation. Les accès aux plateformes et la configuration sont vérifiés avant l’activation des flux.'] },
      ],
      faq: [
        { q: 'Que comprend le forfait Food Hub?', a: `L’abonnement de ${fr$(STANDARD_MONTHLY_CAD)} par mois comprend votre première marque sur ses plateformes connectées. Les fonctions disponibles dépendent des accès autorisés et de la configuration. L’essai gratuit de ${TRIAL_DAYS} jours est géré par Clover.` },
        { q: 'Comment se calcule une marque supplémentaire?', a: `Chaque marque supplémentaire coûte ${fr$(EXTRA_BRAND_PLATFORM_CAD)} par mois pour chaque plateforme où elle est connectée. Une marque ajoutée sur trois plateformes représente donc ${fr$(3 * EXTRA_BRAND_PLATFORM_CAD)} de plus par mois, avant taxes.` },
        { q: 'Food Hub et Phone AI partagent-ils le même abonnement?', a: 'Non. TAKATAK Food Hub et TAKATAK Phone AI sont deux applications Clover distinctes. Chacune a son propre essai et son propre abonnement; Phone AI comporte aussi des frais à la minute d’IA.' },
        { q: 'Comment arrêter mon abonnement Clover?', a: `Désinstallez l’application de votre compte Clover. Vos jetons d’accès Clover ${TOKEN_DELETION.fr}. Consultez les conditions de facturation de Clover pour la fin de l’abonnement.` },
      ],
    },
    en: {
      title: 'Food Hub and Phone AI pricing | Food Hub',
      description: `Food Hub: ${en$(STANDARD_MONTHLY_CAD)}/month, ${en$(EXTRA_BRAND_PLATFORM_CAD)} per extra brand and platform. Phone AI is separate. Plus tax, billed by Clover.`,
      label: 'Pricing', eyebrow: 'PRICING · CANADA', h1: 'A clear price for Food Hub.',
      lead: 'One subscription for your first brand. Additional brands are billed by connected platform. Phone ordering is a separate app.',
      blocks: [
        { kind: 'pricing', id: 'plans', title: 'Choose the service you need.', product: 'both' },
        { kind: 'cards', id: 'examples', title: 'What additional brands cost.', intro: 'Food Hub examples before tax. Additional charges depend on the brands connected to each platform.', cards: [
          { title: 'One brand', text: `Your first brand across its connected platforms: ${en$(monthlyTotalCad(0))} per month.` },
          { title: 'Two brands, three platforms', text: `The second brand on three platforms adds 3 × ${en$(EXTRA_BRAND_PLATFORM_CAD)}, for a total of ${en$(monthlyTotalCad(3))} per month.` },
          { title: 'One brand added on one platform', text: `An additional brand connected to one platform adds ${en$(EXTRA_BRAND_PLATFORM_CAD)}, for a total of ${en$(monthlyTotalCad(1))} per month.` },
        ] },
        { kind: 'text', id: 'billing', title: 'Billed through Clover.', paragraphs: ['Clover manages the free trial, subscription and additional charges on the merchant account where the app is installed. Prices are in Canadian dollars, plus applicable taxes.', 'The current price appears in the Clover App Market listing at installation. Platform access and setup are reviewed before order flows are enabled.'] },
      ],
      faq: [
        { q: 'What does the Food Hub plan include?', a: `The ${en$(STANDARD_MONTHLY_CAD)} monthly subscription includes your first brand across its connected platforms. Available features depend on authorized access and setup. Clover manages the ${TRIAL_DAYS}-day free trial.` },
        { q: 'How is an additional brand billed?', a: `Each additional brand costs ${en$(EXTRA_BRAND_PLATFORM_CAD)} per month for every platform it connects to. One added brand on three platforms therefore adds ${en$(3 * EXTRA_BRAND_PLATFORM_CAD)} per month, before tax.` },
        { q: 'Do Food Hub and Phone AI share a subscription?', a: 'No. TAKATAK Food Hub and TAKATAK Phone AI are separate Clover apps. Each has its own trial and subscription; Phone AI also has per-AI-minute charges.' },
        { q: 'How do I end my Clover subscription?', a: `Uninstall the app from your Clover account. Your Clover access tokens ${TOKEN_DELETION.en}. Check Clover’s billing terms for the end of the subscription.` },
      ],
    },
  },
  uber: { fr: integrationContent('fr', 'uber', 'Uber Eats'), en: integrationContent('en', 'uber', 'Uber Eats') },
  doordash: { fr: integrationContent('fr', 'doordash', 'DoorDash'), en: integrationContent('en', 'doordash', 'DoorDash') },
  skip: { fr: integrationContent('fr', 'skip', 'SkipTheDishes'), en: integrationContent('en', 'skip', 'SkipTheDishes') },
  kitchen: {
    fr: {
      title: 'Écran de cuisine et Clover | Food Hub', description: 'Une vue claire pour les commandes reçues dans Food Hub : préparation, notes, allergies et minuteries, avec votre configuration Clover.',
      label: 'Écran de cuisine', eyebrow: 'FOOD HUB · CUISINE', h1: 'Une vue claire pour votre cuisine.',
      lead: 'Retrouvez les commandes reçues dans Food Hub, leur préparation et les notes des clients. L’équipe garde le service en vue, à côté de l’imprimante Clover.',
      blocks: [
        { kind: 'cards', id: 'ecran', title: 'Les informations utiles, au bon moment.', cards: [
          { title: 'Les commandes, par état', text: 'Suivez ce qui est à préparer et ce qui est prêt. Les informations de livraison s’affichent lorsqu’elles sont transmises par la plateforme.' },
          { title: 'Les notes au bon endroit', text: 'Les notes et les allergies reçues ressortent en rouge à l’écran et sont imprimées sur le billet de cuisine.' },
          { title: 'Le temps de préparation en vue', text: 'Les minuteries et les alertes sonores aident l’équipe à repérer les nouvelles commandes et celles en attente.' },
          { title: 'Un accès pour l’équipe', text: 'Une tablette de cuisine enregistrée utilise son NIP. L’impression suit la configuration Clover de l’établissement.' },
        ] },
        { kind: 'text', id: 'materiel', title: 'Votre matériel, une configuration vérifiée.', paragraphs: ['Un navigateur compatible, un appareil connecté et une configuration Clover vérifiée sont nécessaires. Les commandes affichées dépendent des flux actifs de votre restaurant.', 'L’écran complète les billets de cuisine. Un test d’impression permet de vérifier le parcours sur les appareils de l’établissement.'] },
        { kind: 'links', id: 'integrations', title: 'Consultez les connexions par plateforme.', pages: ['uber', 'doordash', 'skip'] },
      ],
      faq: [
        { q: 'Quel appareil convient à l’écran de cuisine?', a: 'L’écran s’ouvre dans un navigateur compatible, sur une tablette ou un écran connecté. La lisibilité, le son, la connexion et la configuration Clover sont vérifiés avant utilisation.' },
        { q: 'Comment vérifier l’impression en cuisine?', a: 'Un test de commande et d’impression valide la bonne caisse et la bonne imprimante Clover. L’écran permet de suivre la préparation; il ne prouve pas à lui seul qu’un billet a été imprimé.' },
        { q: 'Quelles commandes sont visibles dans la cuisine?', a: 'Les commandes reçues par les flux actifs et autorisés de votre restaurant. Les accès des plateformes, leur association à l’établissement et le parcours de commande doivent être configurés.' },
      ],
    },
    en: {
      title: 'Kitchen display and Clover | Food Hub', description: 'A clear view of orders received in Food Hub: preparation, notes, allergies and timers, alongside your configured Clover setup.',
      label: 'Kitchen display', eyebrow: 'FOOD HUB · KITCHEN', h1: 'A clear view for your kitchen.',
      lead: 'Bring received Food Hub orders, preparation status and customer notes into view. Your team keeps track of service alongside the Clover printer.',
      blocks: [
        { kind: 'cards', id: 'screen', title: 'The right information, when it matters.', cards: [
          { title: 'Orders, by status', text: 'Follow what needs preparing and what is ready. Delivery information appears when it is supplied by the platform.' },
          { title: 'Notes where they belong', text: 'Received notes and allergies stand out in red on screen and are printed on the kitchen ticket.' },
          { title: 'Preparation time in view', text: 'Timers and sound alerts help the team identify new and waiting orders.' },
          { title: 'Access for your team', text: 'An enrolled kitchen tablet uses its PIN. Printing follows the location’s Clover configuration.' },
        ] },
        { kind: 'text', id: 'hardware', title: 'Your equipment, a verified setup.', paragraphs: ['A compatible browser, connected device and verified Clover setup are required. Displayed orders depend on your restaurant’s active flows.', 'The screen works alongside kitchen tickets. A print test checks the path through the location’s devices.'] },
        { kind: 'links', id: 'integrations', title: 'Explore each platform connection.', pages: ['uber', 'doordash', 'skip'] },
      ],
      faq: [
        { q: 'Which device can run the kitchen display?', a: 'The screen opens in a compatible browser on a connected tablet or display. Readability, sound, connectivity and Clover setup are reviewed before use.' },
        { q: 'How do I verify kitchen printing?', a: 'An order and print test checks the correct Clover register and printer. The screen tracks preparation; it does not by itself prove that a ticket was printed.' },
        { q: 'Which orders appear in the kitchen?', a: 'Orders received through your restaurant’s active, authorized flows. Platform access, location mapping and the order path must be configured.' },
      ],
    },
  },
  phone: {
    fr: {
      title: 'TAKATAK Phone AI pour restaurants | Food Hub', description: 'Découvrez TAKATAK Phone AI : commandes par téléphone à partir du menu configuré, transfert vers l’équipe et parcours Clover. Application distincte.',
      label: 'TAKATAK Phone AI', eyebrow: 'APPLICATION CLOVER DISTINCTE', h1: 'Un assistant pour les commandes par téléphone.',
      lead: 'Un assistant automatisé prend la commande à partir du menu configuré, confirme les choix du client et suit le parcours prévu vers Clover et la cuisine. Le service se configure séparément de Food Hub.',
      blocks: [
        { kind: 'cards', id: 'fonctions', title: 'Un parcours téléphonique clair.', cards: [
          { title: 'Un accueil transparent', text: 'L’assistant se présente comme automatisé et annonce la transcription. Le client peut faire le 0 pour parler à une personne.' },
          { title: 'Le menu de votre restaurant', text: 'La commande utilise le menu, les options et les heures configurés pour l’établissement. Les choix sont confirmés avec le client.' },
          { title: 'Un parcours vers la cuisine', text: 'La configuration relie la ligne au bon établissement, à Clover et à la cuisine. Un appel test valide le parcours avant l’activation.' },
          { title: 'Le paiement Clover par texto', text: 'Lorsque le parcours est configuré, le client reçoit un lien de paiement Clover par texto pour sa commande.' },
        ] },
        { kind: 'text', id: 'activation', title: 'Une activation distincte de Food Hub.', paragraphs: ['Une ligne téléphonique configurée, un menu, une connexion Clover, un numéro de transfert vers le restaurant et un appel test sont nécessaires.', 'TAKATAK Phone AI possède son propre essai gratuit et son propre abonnement Clover. Le service est offert au Canada seulement.'] },
        { kind: 'pricing', id: 'abonnement', title: 'L’abonnement TAKATAK Phone AI.', product: 'phone' },
        { kind: 'text', id: 'minutes', title: 'Comment les minutes sont comptées.', paragraphs: [PHONE_PRICE_TEXT.fr] },
        { kind: 'links', id: 'autres', title: 'Les autres outils Food Hub.', pages: ['landing', 'kitchen', 'pricing', 'help'] },
      ],
      faq: [
        { q: 'TAKATAK Phone AI est-il inclus dans Food Hub?', a: 'Non. C’est une application Clover distincte, avec son propre essai, son abonnement et ses frais à la minute d’IA.' },
        { q: 'Un client peut-il joindre mon équipe pendant l’appel?', a: 'Oui. Le client peut faire le 0 pour parler à une personne. Le numéro de transfert du restaurant est configuré et testé avant l’activation.' },
        { q: 'Que se passe-t-il avant l’activation du téléphone?', a: 'La ligne, le menu, les heures, le parcours Clover et le transfert vers le personnel sont configurés puis vérifiés par un appel test. Une fiche App Market disponible ne signifie pas que votre ligne est déjà active.' },
      ],
    },
    en: {
      title: 'TAKATAK Phone AI for restaurants | Food Hub', description: 'Explore TAKATAK Phone AI: phone orders from your configured menu, hand-off to your team and a Clover order flow. A separate Clover app.',
      label: 'TAKATAK Phone AI', eyebrow: 'A SEPARATE CLOVER APP', h1: 'An assistant for phone orders.',
      lead: 'An automated assistant takes orders from the configured menu, confirms the customer’s choices and follows the configured path to Clover and the kitchen. The service is set up separately from Food Hub.',
      blocks: [
        { kind: 'cards', id: 'features', title: 'A clear phone-ordering flow.', cards: [
          { title: 'A clear introduction', text: 'The assistant introduces itself as automated and announces transcription. Callers can press 0 to speak with a person.' },
          { title: 'Your restaurant’s menu', text: 'The order uses the location’s configured menu, options and hours. Choices are confirmed with the customer.' },
          { title: 'A path to the kitchen', text: 'The setup links the line to the right location, Clover and the kitchen. A test call verifies the flow before activation.' },
          { title: 'A Clover payment link by text', text: 'When that flow is configured, the customer receives a Clover payment link by text for the order.' },
        ] },
        { kind: 'text', id: 'activation', title: 'Set up separately from Food Hub.', paragraphs: ['Activation requires a configured phone line, menu, Clover connection, restaurant transfer number and test call.', 'TAKATAK Phone AI has its own free trial and Clover subscription. The service is offered in Canada only.'] },
        { kind: 'pricing', id: 'subscription', title: 'The TAKATAK Phone AI subscription.', product: 'phone' },
        { kind: 'text', id: 'minutes', title: 'How minutes are counted.', paragraphs: [PHONE_PRICE_TEXT.en] },
        { kind: 'links', id: 'more', title: 'More Food Hub tools.', pages: ['landing', 'kitchen', 'pricing', 'help'] },
      ],
      faq: [
        { q: 'Is TAKATAK Phone AI included in Food Hub?', a: 'No. It is a separate Clover app with its own trial, subscription and per-AI-minute charges.' },
        { q: 'Can a caller reach my team during the call?', a: 'Yes. Callers can press 0 to speak with a person. The restaurant’s transfer number is configured and tested before activation.' },
        { q: 'What happens before phone service is activated?', a: 'The line, menu, hours, Clover flow and staff hand-off are configured and verified with a test call. An available App Market listing does not mean that your line is already active.' },
      ],
    },
  },
  help: {
    fr: {
      title: 'Aide et configuration restaurant | Food Hub', description: 'Préparez votre configuration Food Hub : comptes marchands, accès plateformes, caisse Clover, tablettes hébergées et aide pour votre restaurant.',
      label: 'Aide', eyebrow: 'AIDE FOOD HUB', h1: 'Un point de départ clair pour votre restaurant.',
      lead: 'Retrouvez les préalables, les différences entre connexions et tablettes, et les bons renseignements à transmettre pour obtenir de l’aide.',
      blocks: [
        { kind: 'cards', id: 'preparer', title: 'Avant de connecter vos comptes.', cards: [
          { title: 'Vos marques et vos établissements', text: 'Préparez la liste des marques, des établissements et des comptes marchands associés à chaque plateforme.' },
          { title: 'Votre configuration Clover', text: 'Identifiez le compte marchand, les appareils et l’imprimante de commandes utilisés par chaque cuisine.' },
          { title: 'Vos écrans hébergés', text: 'Si vous utilisez le mur de tablettes, identifiez l’ordinateur ou le serveur qui héberge les sessions et gardez les profils existants.' },
        ] },
        { kind: 'steps', id: 'diagnostic', title: 'Pour signaler un problème.', steps: [
          { title: 'Situez le problème', text: 'Indiquez l’établissement, la plateforme et l’action concernée : réception, menu, impression, accès ou versement.' },
          { title: 'Notez ce qui s’affiche', text: 'Relevez l’heure, le message affiché et une référence de commande si nécessaire. Évitez les données personnelles dans une capture.' },
          { title: 'Contactez le soutien', text: 'Transmettez les faits utiles par le canal de soutien. Aucun mot de passe, code de connexion ni jeton d’accès ne doit être envoyé.' },
        ] },
        { kind: 'text', id: 'soutien', title: 'Besoin d’aide pour votre configuration?', paragraphs: ['Nous faisons le point avec vous sur les comptes, les accès disponibles et les prochaines étapes. Les demandes de compte propres à une plateforme restent gérées dans son portail marchand.'] },
        { kind: 'links', id: 'ressources', title: 'Consultez le bon guide.', pages: ['pricing', 'uber', 'doordash', 'skip', 'kitchen', 'phone'] },
      ],
      faq: [
        { q: 'Comment distinguer le mur d’écrans d’une intégration?', a: 'Le mur affiche des sessions marchandes hébergées séparément; vous vous y connectez vous-même. Une intégration échange des données par une API autorisée. L’un n’active pas automatiquement l’autre.' },
        { q: 'Dois-je réinstaller un ordinateur déjà configuré?', a: 'Commencez par vérifier l’installation et les sessions existantes. Les profils, identifiants d’écran et associations aux comptes doivent être conservés avant toute extension.' },
        { q: 'Puis-je transmettre mes mots de passe au soutien?', a: 'Non. Connectez-vous directement dans le portail de la plateforme. Ne transmettez aucun mot de passe, code à usage unique ou jeton d’accès dans un message ou une capture.' },
        { q: 'Où commander un repas sur ON2GO?', a: 'ON2GO.ca est le site destiné aux clients qui souhaitent trouver un restaurant et commander. Food Hub est l’espace de gestion destiné aux restaurateurs.' },
      ],
    },
    en: {
      title: 'Restaurant help and setup | Food Hub', description: 'Prepare your Food Hub setup: merchant accounts, platform access, Clover register, hosted tablets and help for your restaurant.',
      label: 'Help', eyebrow: 'FOOD HUB HELP', h1: 'A clear starting point for your restaurant.',
      lead: 'Find the requirements, understand connections and tablets, and gather the right information when you need help.',
      blocks: [
        { kind: 'cards', id: 'prepare', title: 'Before connecting your accounts.', cards: [
          { title: 'Your brands and locations', text: 'Prepare a list of brands, locations and merchant accounts associated with each platform.' },
          { title: 'Your Clover setup', text: 'Identify the merchant account, devices and order printer used by each kitchen.' },
          { title: 'Your hosted screens', text: 'If you use the tablet wall, identify the computer or server hosting the sessions and preserve existing profiles.' },
        ] },
        { kind: 'steps', id: 'diagnostics', title: 'When reporting a problem.', steps: [
          { title: 'Identify the issue', text: 'Include the location, platform and action: order receipt, menu, printing, access or payout.' },
          { title: 'Note what you see', text: 'Record the time, displayed message and an order reference if needed. Avoid personal information in screenshots.' },
          { title: 'Contact support', text: 'Send the relevant facts through the support channel. Do not send passwords, sign-in codes or access tokens.' },
        ] },
        { kind: 'text', id: 'support', title: 'Need help with your setup?', paragraphs: ['We review your accounts, available access and next steps with you. Platform-specific account requests continue to be managed through that platform’s merchant portal.'] },
        { kind: 'links', id: 'resources', title: 'Find the right guide.', pages: ['pricing', 'uber', 'doordash', 'skip', 'kitchen', 'phone'] },
      ],
      faq: [
        { q: 'How does the tablet wall differ from an integration?', a: 'The wall displays separately hosted merchant sessions; you sign in yourself. An integration exchanges data through an authorized API. One does not automatically enable the other.' },
        { q: 'Should I reinstall a computer that is already configured?', a: 'Start by checking the existing installation and sessions. Profiles, screen identifiers and account mappings should be preserved before adding more screens.' },
        { q: 'Should I send passwords to support?', a: 'No. Sign in directly through the platform’s portal. Do not send passwords, one-time codes or access tokens in a message or screenshot.' },
        { q: 'Where can I order food on ON2GO?', a: 'ON2GO.ca is the diner-facing site for finding restaurants and ordering. Food Hub is the management workspace for restaurant operators.' },
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
    marketReview: 'Soumise au Clover App Market : en révision',
    marketSoonNote: 'Les applications seront bientôt offertes sur le Clover App Market.',
    marketReviewNote: 'Les deux applications sont soumises au Clover App Market et en révision chez Clover.',
    pricingBadge: 'Le forfait TAKATAK Food Hub',
    marketCta: 'Voir sur le Clover App Market',
    marketLive: 'Disponible sur le Clover App Market',
    seePricing: 'Voir les tarifs',
    trial: 'jours d’essai gratuit',
    perMonthPerApp: 'par mois, par application',
    perExtraBrand: 'par mois, par marque supplémentaire, par plateforme',
    firstBrand: 'Votre première marque est incluse.',
    billedByClover: 'Facturé par Clover. Montants en dollars canadiens. Taxes en sus.',
    faq: 'Questions fréquentes',
    platformsLabel: 'Plateformes',
    tgtgNote: 'Too Good To Go : lorsque votre compte offre un flux de commandes.',
    certification: 'La connexion {platform} nécessite des accès autorisés et une configuration vérifiée.',
    certBadge: 'Configuration requise',
    pending: ' Connexions {platforms} : activation selon les accès autorisés.',
    and: ' et ',
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
    marketReview: 'Submitted to the Clover App Market: under review',
    marketSoonNote: 'The apps are coming soon to the Clover App Market.',
    marketReviewNote: 'Both apps are submitted to the Clover App Market and under review by Clover.',
    pricingBadge: 'The TAKATAK Food Hub plan',
    marketCta: 'View on the Clover App Market',
    marketLive: 'Available on the Clover App Market',
    seePricing: 'See pricing',
    trial: 'days of free trial',
    perMonthPerApp: 'per month, per app',
    perExtraBrand: 'per month, per extra brand, per platform',
    firstBrand: 'Your first brand is included.',
    billedByClover: 'Billed by Clover. Amounts in Canadian dollars. Plus applicable taxes.',
    faq: 'Frequently asked questions',
    platformsLabel: 'Platforms',
    tgtgNote: 'Too Good To Go: when your account offers an order feed.',
    certification: 'The {platform} connection requires authorized access and verified setup.',
    certBadge: 'Setup required',
    pending: ' {platforms} connections: activation depends on authorized access.',
    and: ' and ',
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

/** Public names of the delivery platforms with an integration page. */
export const PLATFORM_NAME: Record<HubPlatform, string> = { uber: 'Uber Eats', doordash: 'DoorDash', skip: 'SkipTheDishes' };
