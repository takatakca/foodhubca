// TakTak's help content: page guides (intro + guided tour) and hints for the controls that matter.
// Written French first, English second, like t(fr, en). A test checks both languages, lengths, and that every
// data-help id used in the console has an entry here.
export type L = [fr: string, en: string];
export interface HintEntry {
  title: L;
  body: L;
  /** Reaches a platform or changes money: the first tap explains BEFORE the action and asks to continue. */
  blocking?: boolean;
}
export interface TourStep { target?: string; title: L; body: L }
export interface PageHelp { match: string; title: L; intro: L; steps: TourStep[]; tips?: L[] }

export const HINTS: Record<string, HintEntry> = {
  'shell.taktak': {
    title: ['Je suis TakTak', 'I’m TakTak'],
    body: ['Touchez-moi n’importe quand : aide de cet écran, visite guidée, taille du texte, état de la connexion, ou une question au copilote.', 'Tap me any time: help for this screen, a guided tour, text size, connection status, or a question for the co-pilot.'],
  },
  'shell.scope': {
    title: ['Quelle succursale ?', 'Which location?'],
    body: ['Choisissez les succursales affichées. Tout l’écran (commandes, ventes, alertes) suit ce choix. Une tablette de cuisine reste sur sa succursale.', 'Pick which locations you see. The whole screen (orders, sales, alerts) follows. A kitchen tablet stays on its own location.'],
  },
  'shell.search': {
    title: ['Tout trouver', 'Find anything'],
    body: ['Un numéro de commande, un client, une page : tapez-le ici (⌘K au clavier).', 'An order number, a customer, a page: type it here (⌘K on a keyboard).'],
  },
  'shell.sound': {
    title: ['Le son des commandes', 'Order sound'],
    body: ['Les tablettes bloquent le son tant qu’on n’a pas touché l’écran. Touchez ici une fois : les nouvelles commandes sonneront.', 'Tablets block sound until the screen is touched. Tap here once: new orders will ring.'],
  },
  'shell.copilot': {
    title: ['Le copilote', 'The co-pilot'],
    body: ['Demandez « qu’est-ce qui ne va pas ? » en français ou en anglais. Il explique ; il n’accepte, ne rembourse et ne supprime jamais rien.', 'Ask “what’s wrong right now?” in French or English. It explains; it never accepts, refunds or deletes anything.'],
  },
  'shell.textsize': {
    title: ['Taille du texte', 'Text size'],
    body: ['A → A+ → A++ : tout l’écran grossit, boutons compris. Réglé pour cet écran seulement (la tablette garde son réglage).', 'A → A+ → A++: the whole screen grows, buttons included. Set for this screen only (the tablet keeps its setting).'],
  },
  'autosave.chip': {
    title: ['Enregistrement automatique', 'Automatic saving'],
    body: ['Pas de bouton Enregistrer : vos changements partent seuls. Si vous fermez par erreur, rien n’est perdu. ⌘Z annule.', 'No Save button: your changes save themselves. Close by mistake and nothing is lost. ⌘Z undoes.'],
  },
  'hours.week': {
    title: ['Heures d’ouverture', 'Opening hours'],
    body: ['Une ligne par jour. « + » ajoute une plage (ex. midi et soir). Les changements s’enregistrent seuls ; les plateformes les reçoivent à la publication.', 'One row per day. “+” adds a slot (e.g. lunch and dinner). Changes save by themselves; platforms get them when you publish.'],
  },
  'hours.copy': {
    title: ['Copier vers une autre succursale', 'Copy to another location'],
    body: ['Même horaire ailleurs en un geste. ⌘Z (ou la flèche ↶) annule si vous vous trompez.', 'Same schedule elsewhere in one tap. ⌘Z (or the ↶ arrow) undoes a mistake.'],
  },
  'hours.publish': {
    title: ['Envoyer aux plateformes', 'Send to the platforms'],
    body: ['Envoie les heures, avec le menu, à Uber Eats, DoorDash et Skip pour toutes les marques. Chaque plateforme répond ; le résultat s’affiche marque par marque.', 'Sends the hours, with the menu, to Uber Eats, DoorDash and Skip for every brand. Each platform answers; the result shows brand by brand.'],
    blocking: true,
  },
  'hours.holidays': {
    title: ['Fériés', 'Holidays'],
    body: ['Fermé toute la journée ou heures spéciales, par succursale. Une suppression se rattrape avec « Annuler » pendant 6 secondes.', 'Closed all day or special hours, per location. A removal can be taken back with “Undo” for 6 seconds.'],
  },
  'profile.alerts': {
    title: ['Mes alertes', 'My alerts'],
    body: ['Choisissez comment TakTak vous prévient : texto, appel pour l’urgent, courriel. Vos heures calmes sont respectées sauf pour l’urgent si vous êtes de garde.', 'Choose how TakTak reaches you: text, a call for urgent things, email. Your quiet hours are respected except for urgent alerts when you are on duty.'],
  },
};

export const PAGES: PageHelp[] = [
  {
    match: '/stores/hours',
    title: ['Heures et fériés', 'Hours & holidays'],
    intro: ['Les heures de chaque succursale, les exceptions par marque et les fériés. Tout s’enregistre seul ; « Publier » les envoie aux plateformes.', 'Each location’s hours, brand exceptions and holidays. Everything saves by itself; “Publish” sends them to the platforms.'],
    steps: [
      { target: 'hours.week', title: ['La semaine', 'The week'], body: ['Touchez une heure pour la changer. « + » ajoute une deuxième plage, la corbeille la retire.', 'Tap a time to change it. “+” adds a second slot, the bin removes it.'] },
      { target: 'autosave.chip', title: ['Pas de bouton Enregistrer', 'No Save button'], body: ['Ici vous voyez « Enregistré ». Fermé par erreur ? Vos changements reviennent tout seuls.', 'This says “Saved”. Closed by mistake? Your changes come back by themselves.'] },
      { target: 'hours.publish', title: ['Envoyer aux plateformes', 'Send to the platforms'], body: ['Quand c’est bon, « Publier » envoie les heures à chaque plateforme et affiche ce que chacune a répondu.', 'When it’s right, “Publish” sends the hours to each platform and shows what each one answered.'] },
    ],
  },
  {
    match: '/stores/mapping',
    title: ['Branchement des magasins', 'Store connections'],
    intro: ['Chaque magasin d’Uber Eats, DoorDash et Skip relié à sa marque, sa succursale et sa caisse Clover. Une commande d’un magasin non relié n’est jamais acceptée toute seule.', 'Each Uber Eats, DoorDash and Skip store linked to its brand, location and Clover register. An order from an unlinked store is never accepted by itself.'],
    steps: [],
  },
  {
    match: '/stores',
    title: ['Magasins', 'Stores'],
    intro: ['L’état de chaque marque × succursale × plateforme : ouvert, en pause, fermé (Z) ou désactivé (I). Pause et réouverture d’un geste.', 'Every brand × location × platform: open, paused, closed (Z) or deactivated (I). Pause and reopen in one tap.'],
    steps: [],
  },
  {
    match: '/orders',
    title: ['Commandes', 'Orders'],
    intro: ['Toutes les commandes, avec leur parcours : reçue, dans Clover, acceptée, prête, livrée. Touchez une commande pour tout voir et agir.', 'Every order and its journey: received, in Clover, accepted, ready, delivered. Tap an order to see everything and act.'],
    steps: [],
    tips: [['Une commande d’un magasin non relié attend une personne : vérifiez la marque et la cuisine avant d’accepter.', 'An order from an unlinked store waits for a person: check the brand and kitchen before accepting.']],
  },
  {
    match: '/kitchen',
    title: ['Écran de cuisine', 'Kitchen screen'],
    intro: ['Les commandes à préparer, de la plus pressée à la moins pressée. « Prête » quand c’est emballé. Le mode occupé allonge le temps annoncé aux plateformes.', 'Orders to cook, most urgent first. “Ready” when it’s bagged. Busy mode lengthens the time sent to the platforms.'],
    steps: [],
  },
  {
    match: '/menu/86',
    title: ['Ruptures (86)', 'Out of stock (86)'],
    intro: ['Retirez un article ou une option partout en un geste, pour une succursale, avec retour automatique si vous voulez.', 'Take an item or option off everywhere in one tap, for one location, with an automatic return if you want.'],
    steps: [],
  },
  {
    match: '/menu',
    title: ['Menus', 'Menus'],
    intro: ['Un menu maître par marque, importé de Clover, publié sur chaque plateforme avec ses prix et ses heures.', 'One master menu per brand, imported from Clover, published to every platform with its prices and hours.'],
    steps: [],
  },
  {
    match: '/alerts',
    title: ['Alertes', 'Alerts'],
    intro: ['Ce que TakTak surveille : commandes qui attendent, tablettes éteintes, Clover, magasins hors ligne, argent à récupérer. « Je m’en occupe » arrête l’escalade.', 'What TakTak watches: waiting orders, tablets off, Clover, offline stores, money to recover. “I’m on it” stops the escalation.'],
    steps: [],
  },
  {
    match: '/insights',
    title: ['Analyses', 'Insights'],
    intro: ['Ventes, heures fortes, annulations, temps de préparation, rapports par courriel.', 'Sales, peak hours, cancellations, prep times, emailed reports.'],
    steps: [],
  },
  {
    match: '/money',
    title: ['Argent', 'Money'],
    intro: ['Chaque commande comparée à ce que la plateforme a payé. Ce qui manque devient un dossier à réclamer.', 'Every order checked against what the platform paid. What is missing becomes a case to claim.'],
    steps: [],
  },
  {
    match: '/settings/profile',
    title: ['Mon profil', 'My profile'],
    intro: ['Votre nom, votre courriel ou cellulaire pour vous connecter, votre NIP et vos alertes. Tout s’enregistre seul.', 'Your name, your email or cell to sign in, your PIN and your alerts. Everything saves by itself.'],
    steps: [{ target: 'profile.alerts', title: ['Vos alertes', 'Your alerts'], body: ['Choisissez texto, appel ou courriel. C’est enregistré dès que vous touchez.', 'Pick text, call or email. Saved as soon as you tap.'] }],
  },
  {
    match: '/settings/go-live',
    title: ['Mise en service', 'Go-live'],
    intro: ['Ce qui reste avant d’ouvrir les vannes. Chaque ligne se vérifie toute seule.', 'What is left before going live. Every row checks itself.'],
    steps: [],
  },
  {
    match: '/settings',
    title: ['Réglages', 'Settings'],
    intro: ['Équipe, tablettes, plateformes et Clover, règles du NIP gérant, alertes, mise en service.', 'Team, tablets, platforms and Clover, manager PIN rules, alerts, go-live.'],
    steps: [],
  },
  {
    match: '/',
    title: ['Aperçu', 'Overview'],
    intro: ['Les ventes du jour, ce qui attend, et l’état de chaque plateforme. Les nouvelles commandes sonnent et s’ouvrent en plein écran.', 'Today’s sales, what is waiting, and every platform’s status. New orders ring and open full screen.'],
    steps: [
      { target: 'shell.scope', title: ['Vos succursales', 'Your locations'], body: ['Choisissez ce que vous voulez voir. Tout l’écran suit.', 'Pick what you want to see. The whole screen follows.'] },
      { target: 'shell.search', title: ['Chercher', 'Search'], body: ['Une commande, un client ou une page, d’un mot.', 'An order, a customer or a page, in one word.'] },
      { target: 'shell.sound', title: ['Le son', 'Sound'], body: ['Touchez une fois pour que les commandes sonnent sur cette tablette.', 'Tap once so orders ring on this tablet.'] },
      { target: 'shell.taktak', title: ['Toujours là', 'Always here'], body: ['Besoin d’aide sur n’importe quel écran ? Touchez-moi.', 'Need help on any screen? Tap me.'] },
    ],
  },
];

/** The guide for a route: the most specific match wins ('/' only matches the overview itself). */
export function pageHelpFor(pathname: string): PageHelp {
  const path = pathname.split('?')[0] || '/';
  return PAGES.find((p) => (p.match === '/' ? path === '/' : path === p.match || path.startsWith(`${p.match}/`)))
    ?? PAGES.find((p) => p.match === '/settings' && path.startsWith('/settings'))
    ?? PAGES[PAGES.length - 1];
}

export function hintFor(id: string): HintEntry | null {
  return Object.hasOwn(HINTS, id) ? HINTS[id] : null;
}

export const pick = (l: L, lang: 'fr' | 'en') => (lang === 'en' ? l[1] : l[0]);
