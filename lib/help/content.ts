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
    body: ['Pas de bouton Enregistrer : vos changements s’enregistrent seuls. Si vous fermez par erreur, rien n’est perdu. La flèche ↶ annule.', 'No Save button: your changes save themselves. Close by mistake and nothing is lost. The ↶ arrow undoes.'],
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
  'security.rule': {
    title: ['Qui peut le faire seul ?', 'Who can do it alone?'],
    body: ['Libre : tout le monde avec le bon rôle. NIP gérant : un employé fait entrer le NIP d’un gérant. Toujours un NIP : même les gérants confirment. S’enregistre tout seul ; ↶ annule.', 'Open: anyone with the right role. Manager PIN: staff get a manager to enter their PIN. Always PIN: even managers confirm. Saves by itself; ↶ undoes.'],
  },
  'security.team': {
    title: ['L’équipe et ces règles', 'The team and these rules'],
    body: ['Protège l’équipe, les tablettes, les règles d’alerte et cet écran. Sur « Toujours un NIP », changer ces règles demande un NIP : créez le vôtre d’abord dans Mon profil.', 'Protects the team, the tablets, the alert rules and this screen. On “Always PIN”, changing these rules asks for a PIN: create yours first in My profile.'],
  },
  'security.strict': {
    title: ['Préréglage strict', 'Strict preset'],
    body: ['D’un geste : refuser, annuler, rembourser, texter un client, fermer un magasin et changer un prix demandent un gérant ; argent et équipe, toujours un NIP. « Annuler » revient en arrière.', 'One tap: rejecting, cancelling, refunding, texting a customer, pausing a store and changing a price need a manager; money and team always need a PIN. “Undo” takes it back.'],
  },
  'alerts.watch': {
    title: ['Surveillance active ou arrêtée', 'Watchtower on or off'],
    body: ['Arrêtée, la surveillance ne voit plus rien : aucune alerte, aucun texto, aucun appel. Le bip des nouvelles commandes continue. Touchez « Annuler » dans les 6 secondes pour la rallumer.', 'Off, the watchtower sees nothing: no alerts, no texts, no calls. The new-order beep keeps working. Tap “Undo” within 6 seconds to turn it back on.'],
  },
  'alerts.steps': {
    title: ['Qui est prévenu, et quand', 'Who hears about it, and when'],
    body: ['Une alerte sonne d’abord à l’écran. Si personne ne touche « Je m’en occupe », les gérants de garde reçoivent un texto. Pour une urgence suivent un appel, puis le propriétaire. Les minutes comptent depuis le début.', 'An alert rings on screen first. If nobody taps “I’m on it”, the managers on duty get a text. For urgent alerts, a call follows, then the owner. Minutes count from the start of the alert.'],
  },
  'alerts.phones': {
    title: ['Numéros pour les urgences', 'Numbers for critical alerts'],
    body: ['Ces numéros reçoivent chaque urgence : un texto avec les gérants, puis un appel à l’étape du propriétaire. Le × retire un numéro ; touchez « Annuler » dans les 6 secondes pour le remettre.', 'These numbers get every critical alert: a text along with the managers, then a call at the owner step. The × removes a number; tap “Undo” within 6 seconds to bring it back.'],
  },
  'alerts.rules': {
    title: ['Surveiller ou escalader', 'Watch or escalate'],
    body: ['« Surveiller » montre l’alerte à l’écran. « Escalader » ajoute un texto si personne ne répond, puis un appel pour une urgence. Éteignez ce qui ne vous sert pas pour ne pas tout recevoir.', '“Watch” shows the alert on screen. “Escalate” adds a text if nobody answers, then a call for urgent alerts. Turn off what you don’t need so you don’t get everything.'],
  },
  'alerts.test': {
    title: ['Tester avant le service', 'Test before service'],
    body: ['Envoie un test à vous seulement (texto, appel ou courriel, selon Mon profil) ou dans le clavardage de l’équipe. Faites-le avant le premier service : vous saurez que les alertes arrivent.', 'Sends a test to you only (text, call or email, from My profile) or to the team chat. Do it before your first service so you know alerts get through.'],
  },
  'fees.plan': {
    title: ['Le plan de la plateforme', 'The platform plan'],
    body: ['Choisissez la grille qui correspond à votre entente, ou « Personnalisé » pour entrer vos propres taux. Les paiements attendus sont recalculés après chaque changement.', 'Pick the rate card that matches your agreement, or “Custom” to enter your own rates. Expected payouts are recalculated after every change.'],
  },
  'fees.confirm': {
    title: ['Conforme à mon contrat', 'Matches my contract'],
    body: ['Activez-le une fois les taux comparés à votre contrat. Tant qu’il est éteint, les écarts sont marqués « non confirmés » et la mise en service vous le rappelle.', 'Turn it on once the rates are checked against your contract. Until then, differences are marked “unconfirmed” and the go-live checklist reminds you.'],
  },
  'fees.stores': {
    title: ['Un taux pour un seul magasin', 'A rate for one store'],
    body: ['Une marque ou une succursale a une autre entente (promo, autre contrat) ? Ajoutez-la ici : son taux remplace celui de la plateforme. « Retirer » se rattrape avec « Annuler » pendant 6 secondes.', 'A brand or location on another deal (a promotion, a different contract)? Add it here: its rate replaces the platform’s. “Remove” can be taken back with “Undo” for 6 seconds.'],
  },
  'fees.tolerance': {
    title: ['Tolérance', 'Matching tolerance'],
    body: ['Petit écart permis entre le paiement attendu et le paiement reçu, pour les arrondis de taxes et de frais. 0,10 $ suffit d’habitude. Un litige n’est ouvert qu’à partir de 1,00 $.', 'Small difference allowed between the expected and the received payout, for rounding of taxes and fees. $0.10 is usually enough. A dispute only opens from $1.00.'],
  },
  'team.add': {
    title: ['Ajouter une personne', 'Add a person'],
    body: ['Nom, rôle, succursales, puis un courriel ou un cellulaire pour se connecter. Fermé par erreur ? Ce que vous aviez tapé revient, sauf le NIP.', 'Name, role, locations, then an email or cell to sign in. Closed by mistake? What you typed comes back, except the PIN.'],
  },
  'team.search': {
    title: ['Trouver quelqu’un', 'Find someone'],
    body: ['Tapez un nom, un courriel ou un cellulaire. Chaque ligne montre le rôle, les succursales, le NIP et la dernière connexion.', 'Type a name, an email or a cell. Each row shows the role, locations, PIN and last sign-in.'],
  },
  'team.show': {
    title: ['Actifs et retirés', 'Active and removed'],
    body: ['« Retirés » montre les personnes dont l’accès est coupé. Ouvrez-en une, rallumez « Accès actif », puis « Enregistrer » pour lui redonner l’accès.', '“Removed” shows people whose access is off. Open one, turn “Access active” back on, then “Save” to let them in again.'],
  },
  'team.pin': {
    title: ['Le NIP', 'The PIN'],
    body: ['4 à 6 chiffres, différent pour chaque personne. Il déverrouille les tablettes de cuisine ; celui d’un gérant approuve les actions sensibles. Jamais gardé si vous fermez sans enregistrer.', '4–6 digits, different for each person. It unlocks kitchen tablets; a manager’s PIN approves sensitive actions. Never kept if you close without saving.'],
  },
  'team.active': {
    title: ['Couper l’accès', 'Turn off access'],
    body: ['Éteignez-le, puis « Enregistrer » : la personne est déconnectée partout, tout de suite. Son historique reste. Rallumez pour lui redonner l’accès.', 'Turn it off, then “Save”: the person is signed out everywhere, at once. Their history stays. Turn it back on to let them in again.'],
  },
  'business.add': {
    title: ['Ajouter une succursale', 'Add a location'],
    body: ['Un code court (ex. VERDUN), le nom, l’adresse et le téléphone de la cuisine. Fermé par erreur ? Ce que vous aviez tapé revient à la prochaine ouverture.', 'A short code (e.g. VERDUN), the name, the address and the kitchen phone. Closed by mistake? What you typed comes back next time.'],
  },
  'business.phone': {
    title: ['Téléphone de la cuisine', 'Kitchen phone'],
    body: ['Si une tablette s’éteint ou qu’une commande attend, la surveillance appelle ce numéro en premier. Mettez un téléphone qui sonne en cuisine.', 'If a tablet goes off or an order waits, the watchtower calls this number first. Use a phone that rings in the kitchen.'],
  },
  'business.brand': {
    title: ['Nouvelle marque', 'New brand'],
    body: ['Tapez le nom (sans virgule) et « Ajouter ». Reliez-la ensuite à ses magasins Uber Eats, DoorDash et Skip dans Magasins › Branchement des magasins.', 'Type the name (no comma) and tap “Add”. Then link it to its Uber Eats, DoorDash and Skip stores in Stores › Store connections.'],
  },
  'business.brands': {
    title: ['Vos marques', 'Your brands'],
    body: ['« Désactiver » cache la marque des nouveaux écrans ; l’historique reste. Touchez « Annuler » dans les 6 secondes, ou « Réactiver » plus tard.', '“Deactivate” hides the brand from new screens; history stays. Tap “Undo” within 6 seconds, or “Activate” later.'],
  },
  'stores.resume': {
    title: ['Rouvrir', 'Resume'],
    body: ['Remet en ligne tout de suite : un magasin (« Rouvrir ») ou toute la succursale (« Tout rouvrir »). Chaque plateforme répond ; un refus s’affiche avec sa raison.', 'Back online right away: one store (“Resume”) or the whole location (“Resume all”). Each platform answers; a refusal shows with its reason.'],
  },
  'stores.prep': {
    title: ['Temps de préparation', 'Prep time'],
    body: ['Le temps visé par la cuisine pour chaque nouvelle commande (DoorDash le reçoit aussi) : « normal », ou « occupé » en mode occupé. De 5 à 120 min, occupé au moins égal au normal. Tapez : c’est enregistré tout seul.', 'The kitchen’s target time for each new order (DoorDash gets it too): “normal”, or “busy” in busy mode. 5 to 120 min, busy at least normal. Just type: it saves by itself.'],
  },
  'stores.busy': {
    title: ['Mode occupé', 'Busy mode'],
    body: ['En plein rush, un toucher passe les nouvelles commandes de la succursale au temps « occupé ». Touchez encore pour revenir au normal. Rien n’est mis en pause.', 'In a rush, one tap moves new orders at this location to the “busy” time. Tap again to go back to normal. Nothing is paused.'],
  },
  'mapping.uber': {
    title: ['Brancher Uber Eats', 'Connect Uber Eats'],
    body: ['Vous allez chez Uber pour vous connecter et autoriser TAKATAK. Au retour, vous cochez les magasins voulus ; aucun magasin n’est activé avant « Activer et relier ».', 'You go to Uber to sign in and allow TAKATAK. Back here, you tick the stores you want; no store is activated before “Activate & link”.'],
    blocking: true,
  },
  'mapping.add': {
    title: ['Ajouter un magasin', 'Add a store'],
    body: ['Collez l’identifiant du magasin donné par la plateforme, puis choisissez la marque et la succursale. Fermé par erreur ? Ce que vous avez tapé est gardé jusqu’à « Enregistrer ».', 'Paste the store id the platform gave you, then pick the brand and location. Closed by mistake? What you typed is kept until you press “Save”.'],
  },
  'mapping.autoaccept': {
    title: ['Accepter automatiquement', 'Accept automatically'],
    body: ['TAKATAK accepte la commande seulement quand Clover l’a bien reçue. Sinon, elle attend une personne. La cuisine touche quand même « Vu ».', 'TAKATAK accepts the order only once Clover has it. Otherwise it waits for a person. The kitchen still taps “Seen”.'],
  },
  'mapping.activate': {
    title: ['Activer chez Uber', 'Activate at Uber'],
    body: ['Chaque magasin coché est activé chez Uber Eats et relié à sa marque et sa succursale. Ses commandes arrivent ensuite ici et dans Clover. Vérifiez la marque et la succursale avant.', 'Each ticked store is activated at Uber Eats and linked to its brand and location. Its orders then arrive here and in Clover. Check the brand and location first.'],
    blocking: true,
  },
  'mapping.disconnect': {
    title: ['Débrancher un magasin', 'Disconnect a store'],
    body: ['Ses commandes arriveront « non reliées » : pas acceptées toutes seules, ni envoyées à la bonne caisse Clover. Vous avez 6 secondes pour « Annuler ». Le magasin reste ouvert sur la plateforme.', 'Its orders will arrive unlinked: not accepted by themselves, not sent to the right Clover register. You get 6 seconds to “Undo”. The store stays open on the platform.'],
    blocking: true,
  },
  'devices.enrol': {
    title: ['Faire de cet écran une tablette de cuisine', 'Make this screen a kitchen tablet'],
    body: ['À faire sur la tablette elle-même. Elle reste connectée un an et montre l’écran NIP ; les gérants sont avertis si elle s’éteint ou perd le son. Un NIP de gérant peut être demandé.', 'Do it on the tablet itself. It stays signed in for a year and shows the PIN screen; managers are warned if it turns off or loses sound. A manager PIN may be asked.'],
  },
  'devices.sound': {
    title: ['Tester le son', 'Test the sound'],
    body: ['Joue la sonnerie des nouvelles commandes. Pas de son ? Montez le volume de la tablette, enlevez le mode silencieux, puis touchez de nouveau ce bouton.', 'Plays the new-order ring. No sound? Turn the tablet volume up, turn silent mode off, then tap this button again.'],
  },
  'devices.edit': {
    title: ['Modifier la tablette', 'Edit the tablet'],
    body: ['Changez son nom ou sa succursale. Fermé par erreur ? Ce que vous avez tapé revient à la prochaine ouverture. Rien ne change avant « Enregistrer ».', 'Change its name or its location. Closed by mistake? What you typed comes back next time. Nothing changes until you press “Save”.'],
  },
  'devices.remove': {
    title: ['Retirer une tablette', 'Remove a tablet'],
    body: ['Pour une tablette perdue, volée ou remplacée : elle est déconnectée tout de suite et devra être enregistrée de nouveau. On vous demande de confirmer, parfois avec un NIP de gérant.', 'For a lost, stolen or replaced tablet: it is signed out at once and must be enrolled again. You are asked to confirm first, sometimes with a manager PIN.'],
  },
  'reports.period': {
    title: ['Période et filtres', 'Period and filters'],
    body: ['La période, les succursales et les plateformes choisies ici s’appliquent aux téléchargements, à l’aperçu et à « Envoyer ». Les envois programmés ont leur propre période.', 'The period, locations and platforms picked here apply to downloads, the preview and “Email”. Scheduled emails use their own period.'],
  },
  'reports.download': {
    title: ['Télécharger', 'Download'],
    body: ['Excel s’ouvre tel quel pour la comptabilité ; CSV va dans n’importe quel logiciel. Le fichier suit la période et les filtres du haut de la page.', 'Excel opens as is for your bookkeeping; CSV goes into any software. The file follows the period and filters at the top of the page.'],
  },
  'reports.email': {
    title: ['Envoyer par courriel', 'Email it'],
    body: ['Envoie ce rapport maintenant, en pièce jointe, aux adresses tapées (séparées par des virgules). Fermé par erreur ? Les adresses reviennent à la prochaine ouverture.', 'Sends this report now, attached, to the addresses you type (comma-separated). Closed by mistake? The addresses come back next time.'],
  },
  'reports.schedule': {
    title: ['Envoi automatique', 'Automatic email'],
    body: ['Chaque jour (la veille), chaque lundi (la semaine passée) ou le 1er du mois (le mois passé), après 8 h. Pratique pour votre comptable.', 'Every day (yesterday), every Monday (last week) or on the 1st (last month), after 8:00. Handy for your accountant.'],
  },
  'reports.stop': {
    title: ['Arrêter un envoi', 'Stop an email'],
    body: ['L’envoi disparaît tout de suite. Vous avez 6 secondes pour toucher « Annuler » ; après, il est vraiment arrêté.', 'The email disappears at once. You have 6 seconds to tap “Undo”; after that it is really stopped.'],
  },
  'payouts.gaps': {
    title: ['Dépôts différents', 'Deposits that differ'],
    body: ['Le nombre de paiements où la banque a reçu un autre montant que le relevé. Un écart de 1 $ ou plus ouvre un dossier dans Litiges, qui se ferme seul quand ça concorde.', 'How many payouts reached the bank with a different amount than the statement. A gap of $1 or more opens a case in Disputes, which closes by itself once it matches.'],
  },
  'payouts.deposit': {
    title: ['Entrer le dépôt', 'Enter the deposit'],
    body: ['Ouvrez votre relevé bancaire et entrez le montant reçu pour ce paiement. Food Hub le compare au relevé de la plateforme et montre l’écart.', 'Open your bank statement and enter the amount received for this payout. Food Hub compares it with the platform statement and shows any gap.'],
  },
  'payouts.amount': {
    title: ['Le montant de la banque', 'The bank amount'],
    body: ['Mettez le montant exact de votre relevé bancaire, pas celui de la plateforme. S’il diffère, un avertissement le montre avant d’enregistrer.', 'Type the exact amount from your bank statement, not the platform’s. If it differs, a warning shows it before you save.'],
  },
  'payouts.save': {
    title: ['Enregistrer le dépôt', 'Save the deposit'],
    body: ['Ceci inscrit le dépôt dans vos livres (grand livre et exports comptables). Un gérant peut devoir entrer son NIP. Rien n’est envoyé à la plateforme ni à la banque.', 'This writes the deposit into your books (ledger and accounting exports). A manager may need to enter a PIN. Nothing is sent to the platform or the bank.'],
    blocking: true,
  },
  'payouts.csv': {
    title: ['Pour le comptable', 'For your accountant'],
    body: ['Téléchargez chaque paiement de la période avec ventes, commission et ses taxes, remboursements, dépôt et écart. S’ouvre dans Excel ou Google Sheets.', 'Download every payout of the period with sales, commission and its tax, refunds, deposit and gap. Opens in Excel or Google Sheets.'],
  },
  'disputes.tabs': {
    title: ['À faire d’abord', 'To do first'],
    body: ['« À faire » montre les dossiers ouverts et contestés, les plus gros montants en haut. Ils passent seuls dans « Fermés » quand un paiement suivant règle le problème.', '“To do” shows open and disputed cases, biggest amounts first. They move to “Closed” by themselves when a later payout settles it.'],
  },
  'disputes.update': {
    title: ['Mettre à jour un dossier', 'Update a case'],
    body: ['Notez ce que vous avez fait : contesté, no de dossier, montant revenu. Vos décisions ne sont jamais écrasées par les relevés suivants.', 'Record what you did: disputed, case number, amount back. Your decisions are never overwritten by later statements.'],
  },
  'disputes.casenumber': {
    title: ['No de dossier de la plateforme', 'Platform case number'],
    body: ['Copiez le numéro que la plateforme vous donne (Uber Eats, DoorDash, Skip…). Toute l’équipe peut ensuite faire le suivi sans recommencer.', 'Copy the number the platform gives you (Uber Eats, DoorDash, Skip…). Anyone on the team can then follow up without starting over.'],
  },
  'disputes.save': {
    title: ['Enregistrer le dossier', 'Save the case'],
    body: ['Ceci note la décision ici seulement : rien n’est envoyé à la plateforme. Contestez d’abord dans son portail (voir « Comment contester »). Un gérant peut devoir entrer son NIP.', 'This records the decision here only: nothing is sent to the platform. Dispute in its portal first (see “How to dispute”). A manager may need to enter a PIN.'],
  },
  'disputes.how': {
    title: ['Comment contester', 'How to dispute'],
    body: ['Où aller pour chaque plateforme. Contestez vite : les plateformes refusent les litiges après un certain temps.', 'Where to go for each platform. Dispute quickly: platforms refuse disputes after a while.'],
  },
  'tgtg.day': {
    title: ['Quelle journée ?', 'Which day?'],
    body: ['Choisissez la date et la succursale. Une journée déjà entrée revient pour la corriger. Ce que vous tapez est gardé si vous changez de journée.', 'Pick the date and location. A day already logged comes back so you can fix it. What you type is kept if you switch days.'],
  },
  'tgtg.sold': {
    title: ['Sacs vendus', 'Bags sold'],
    body: ['Comptez les sacs ramassés par les clients, comme dans l’app TGTG Store. C’est ce chiffre × le prix qui compte dans vos ventes.', 'Count the bags customers picked up, as in the TGTG Store app. This number × the price is what counts in your sales.'],
  },
  'tgtg.save': {
    title: ['Enregistrer la journée', 'Save the day'],
    body: ['La journée compte dans les ventes, les rapports et la vérification des paiements. Rien n’est envoyé à Too Good To Go. Si les commandes TGTG arrivent déjà toutes seules, rien n’est compté deux fois.', 'The day counts in sales, reports and payout checks. Nothing is sent to Too Good To Go. If TGTG orders already arrive on their own, nothing is counted twice.'],
  },
  'tgtg.history': {
    title: ['Corriger une journée', 'Fix a day'],
    body: ['Touchez une ligne pour la recharger dans le formulaire, corrigez, puis « Enregistrer la journée ». Les nouveaux chiffres remplacent les anciens.', 'Tap a row to load it into the form, fix it, then “Save day”. The new numbers replace the old ones.'],
  },
  'orders.view': {
    title: ['En direct ou historique', 'Live or history'],
    body: ['En direct : les commandes en cours, rangées par étape. Historique : toutes les commandes d’une période, avec recherche et export CSV.', 'Live: orders in progress, sorted by step. History: every order for a period, with search and a CSV export.'],
  },
  'orders.card': {
    title: ['Une commande', 'An order'],
    body: ['Touchez la carte pour tout voir : articles, client, parcours, Clover. Le bouton du bas passe à l’étape suivante : « Accepter », « Prête », « Remise au livreur ».', 'Tap the card to see everything: items, customer, journey, Clover. The bottom button moves it to the next step: “Accept”, “Ready”, “Picked up”.'],
  },
  'orders.filters': {
    title: ['Retrouver une commande', 'Find an order'],
    body: ['Choisissez la période, la succursale, la marque ou le statut. La recherche trouve un numéro de commande, un client ou un numéro Clover. « CSV » télécharge la liste.', 'Pick the period, location, brand or status. Search finds an order number, a customer or a Clover number. “CSV” downloads the list.'],
  },
  'kitchen.ticket': {
    title: ['À préparer', 'To cook'],
    body: ['Les commandes à cuisiner, la plus pressée en premier. Touchez-en une pour tout voir. « Accepter » une nouvelle commande, « Vu » quand vous l’avez vue, « Prête » quand c’est emballé : la plateforme est prévenue.', 'Orders to cook, most urgent first. Tap one to see everything. “Accept” a new order, “Seen” once you’ve seen it, “Ready” when it’s bagged: the platform is told.'],
  },
  'kitchen.busy': {
    title: ['Mode occupé', 'Busy mode'],
    body: ['Trop de commandes ? Touchez : les nouvelles commandes reçoivent un temps de préparation plus long. Touchez encore pour revenir au temps normal.', 'Swamped? Tap it: new orders get a longer prep time. Tap again to go back to normal time.'],
  },
  'kitchen.pickup': {
    title: ['Prêtes, en attente du livreur', 'Ready, waiting for the courier'],
    body: ['Ces commandes sont prêtes. Touchez-en une pour voir où est le livreur. « Remise au livreur » quand il part avec le sac.', 'These orders are ready. Tap one to see where the courier is. “Picked up” when the courier leaves with the bag.'],
  },
  'kitchen.fullscreen': {
    title: ['Plein écran', 'Full screen'],
    body: ['Cache les barres du navigateur pour donner plus de place aux commandes. « Quitter » pour en sortir.', 'Hides the browser bars to give the orders more room. “Exit” to leave.'],
  },
  'menu86.toggle': {
    title: ['En rupture d’un geste', '86 in one tap'],
    body: ['Touchez un article : il disparaît d’Uber Eats, DoorDash et Skip à cette succursale. Touchez-le encore pour le remettre. En rouge = en rupture.', 'Tap an item: it disappears from Uber Eats, DoorDash and Skip at this location. Tap it again to bring it back. Red = 86’d.'],
  },
  'menu86.return': {
    title: ['Retour automatique', 'Automatic return'],
    body: ['Choisissez avant de toucher l’article : il revient tout seul dans 30 min, 1 h, 2 h ou en fin de journée. « Quand je le remets » : il reste retiré jusqu’à ce que vous le remettiez.', 'Pick this before tapping the item: it comes back by itself in 30 min, 1 h, 2 h or at end of day. “When I turn it on”: it stays off until you bring it back.'],
  },
  'menu86.location': {
    title: ['La bonne succursale', 'The right location'],
    body: ['Une rupture vaut pour une seule succursale. Vérifiez que c’est la bonne avant de toucher. Une tablette de cuisine reste sur sa succursale.', 'An 86 applies to one location only. Check it’s the right one before tapping. A kitchen tablet stays on its own location.'],
  },
  'menu86.tabs': {
    title: ['Articles, options, en rupture', 'Items, options, 86’d now'],
    body: ['Les options, ce sont les sauces, tailles et extras. « En rupture » montre tout ce qui est retiré pour cette marque à cette succursale : touchez pour le remettre.', 'Options are sauces, sizes and extras. “86’d now” shows everything off for this brand at this location: tap to bring it back.'],
  },
  'incident.card': {
    title: ['Une alerte', 'An alert'],
    body: ['Touchez pour voir ce qui se passe et quoi faire. Les pastilles montrent jusqu’où l’alerte est allée : écran, texto, appel, puis le propriétaire.', 'Tap to see what’s happening and what to do. The pills show how far the alert has gone: screen, text, call, then the owner.'],
  },
  'incident.ack': {
    title: ['Je m’en occupe', 'I’m on it'],
    body: ['Dit à l’équipe que vous vous en occupez et arrête les textos et les appels pour cette alerte. Si ça empire, elle se rouvre. « Réglé » quand c’est fini.', 'Tells the team you’re handling it and stops the texts and calls for this alert. If it gets worse, it reopens. “Fixed” when it’s done.'],
  },
  'incident.snooze': {
    title: ['Sourdine 30 min', 'Snooze 30 min'],
    body: ['Met l’alerte de côté pendant 30 minutes. Si le problème est encore là après, elle revient. S’il se règle, elle se ferme toute seule.', 'Puts the alert aside for 30 minutes. If the problem is still there afterwards, it comes back. If it clears, the alert closes by itself.'],
  },
  'incident.check': {
    title: ['Vérifier maintenant', 'Check now'],
    body: ['Tout est vérifié automatiquement, jour et nuit. Ce bouton relance une vérification tout de suite, par exemple après avoir réglé un problème.', 'Everything is checked automatically, day and night. This button runs a check right now, for example after you fixed something.'],
  },
  'money.recover': {
    title: ['Argent à récupérer', 'Money to recover'],
    body: ['Ce que les plateformes vous doivent encore pour cette période : commandes absentes des paiements, payées en moins, frais d’erreur, remboursements. Chaque cas devient un litige.', 'What the platforms still owe you for this period: orders missing from payouts, paid less, error charges, refunds. Each one becomes a dispute case.'],
  },
  'money.period': {
    title: ['Période et succursale', 'Period and location'],
    body: ['Choisissez la période et les succursales. Une commande récente reste « pas encore due » tant que la plateforme n’a pas eu le temps de payer : rien n’est marqué absent trop tôt.', 'Pick the period and the locations. A recent order stays “not due yet” until the platform has had time to pay: nothing is marked missing too early.'],
  },
  'money.diff': {
    title: ['L’écart', 'The difference'],
    body: ['Ce qui a été payé moins ce qui était attendu selon votre plan de commission. Négatif : vous avez reçu moins. Un écart étrange ? Vérifiez d’abord le plan de commission.', 'What was paid minus what your commission plan says you should get. Negative: you got less. Odd difference? Check the commission plan first.'],
  },
  'money.unknown': {
    title: ['Payées mais inconnues', 'Paid but unknown'],
    body: ['Des commandes payées par une plateforme que TAKATAK n’a jamais reçues : un magasin pas encore relié ou un message perdu. Reliez-le dans Magasins → Branchement des magasins.', 'Orders a platform paid for that TAKATAK never received: a store not linked yet, or a lost message. Link it under Stores → Store connections.'],
  },
  'insights.period': {
    title: ['Période et filtres', 'Period and filters'],
    body: ['Choisissez la période, les succursales et les marques. Chaque chiffre est comparé à la période d’avant de même durée (ex. 7 jours contre les 7 jours précédents).', 'Pick the period, locations and brands. Every number is compared with the period before of the same length (e.g. 7 days vs the 7 days before).'],
  },
  'insights.kpis': {
    title: ['Les chiffres clés', 'Key numbers'],
    body: ['Chaque chiffre est comparé à la période précédente. Vert = bonne nouvelle, rouge = à surveiller. Pour les annulations et les délais, une baisse est en vert.', 'Each number is compared with the previous period. Green = good news, red = keep an eye on it. For cancellations and wait times, going down is green.'],
  },
  'insights.metric': {
    title: ['Ventes ou commandes', 'Sales or orders'],
    body: ['Passez du montant des ventes au nombre de commandes. La ligne pointillée montre la période précédente.', 'Switch between sales dollars and number of orders. The dotted line shows the previous period.'],
  },
  'insights.export': {
    title: ['Fichier Excel', 'Excel file'],
    body: ['Télécharge toutes les commandes de la période, avec les mêmes filtres, dans un fichier Excel. Pratique pour votre comptable.', 'Downloads every order of the period, with the same filters, as an Excel file. Handy for your accountant.'],
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
    intro: ['Chaque magasin Uber Eats, DoorDash, Skip et TGTG relié à sa marque, sa succursale et sa caisse Clover. Une commande d’un magasin non relié n’est jamais acceptée toute seule.', 'Each Uber Eats, DoorDash, Skip and TGTG store linked to its brand, location and Clover register. An order from an unlinked store is never accepted by itself.'],
    steps: [
      { target: 'mapping.uber', title: ['Brancher Uber Eats', 'Connect Uber Eats'], body: ['Le plus simple pour Uber : connectez-vous chez Uber, revenez ici, cochez vos magasins et activez.', 'Easiest for Uber: sign in at Uber, come back here, tick your stores and activate.'] },
      { target: 'mapping.add', title: ['Ajouter à la main', 'Add by hand'], body: ['Pour DoorDash, Skip ou TGTG : collez l’identifiant du magasin, choisissez la marque et la succursale. Ce que vous tapez est gardé si vous fermez.', 'For DoorDash, Skip or TGTG: paste the store id, pick the brand and location. What you type is kept if you close.'] },
      { target: 'mapping.disconnect', title: ['Débrancher', 'Disconnect'], body: ['La corbeille débranche un magasin. Vous avez 6 secondes pour « Annuler ».', 'The bin disconnects a store. You get 6 seconds to “Undo”.'] },
    ],
    tips: [['Le crayon modifie un branchement : marque, succursale, marchand Clover, acceptation automatique.', 'The pencil edits a connection: brand, location, Clover merchant, automatic accept.']],
  },
  {
    match: '/stores',
    title: ['Magasins', 'Stores'],
    intro: ['Chaque marque de chaque succursale, sur chaque plateforme : en ligne, en pause, fermée ou désactivée. Pause, réouverture et mode occupé d’un geste ; le temps de préparation s’enregistre seul.', 'Every brand at every location, on every platform: online, paused, closed or deactivated. Pause, reopen and busy mode in one tap; prep time saves by itself.'],
    steps: [
      { target: 'stores.resume', title: ['Pause et réouverture', 'Pause and reopen'], body: ['« Tout mettre en pause » ou « Pause » sur un magasin : choisissez combien de temps. « Tout rouvrir » remet toute la succursale en ligne tout de suite.', '“Pause all”, or “Pause” on one store: pick how long. “Resume all” puts the whole location back online right away.'] },
      { target: 'stores.prep', title: ['Temps de préparation', 'Prep time'], body: ['Normal et occupé, en minutes, pour cette succursale. Tapez le nombre : pas de bouton Enregistrer.', 'Normal and busy, in minutes, for this location. Just type the number: no Save button.'] },
      { target: 'autosave.chip', title: ['Enregistré tout seul', 'Saves by itself'], body: ['Cette pastille dit si c’est enregistré. En rouge : pas enregistré, touchez pour réessayer. ↶ annule le dernier changement.', 'This chip says whether it is saved. Red: not saved, tap to retry. ↶ undoes the last change.'] },
      { target: 'stores.busy', title: ['Mode occupé', 'Busy mode'], body: ['En plein rush, un toucher passe au temps occupé. Touchez encore pour revenir au normal.', 'In a rush, one tap switches to the busy time. Tap again to go back to normal.'] },
    ],
    tips: [['Une pause minutée rouvre toute seule à l’heure affichée.', 'A timed pause reopens by itself at the time shown.'], ['« par la plateforme » : c’est Uber, DoorDash ou Skip qui a fermé le magasin, pas TAKATAK.', '“by the platform”: Uber, DoorDash or Skip closed the store, not TAKATAK.']],
  },
  {
    match: '/orders',
    title: ['Commandes', 'Orders'],
    intro: ['Toutes les commandes d’Uber Eats, DoorDash et Skip au même endroit. En direct : rangées par étape. Historique : par période, avec recherche. Touchez une commande pour tout voir et agir.', 'Every Uber Eats, DoorDash and Skip order in one place. Live: sorted by step. History: by period, with search. Tap an order to see everything and act.'],
    steps: [
      { target: 'orders.view', title: ['En direct ou historique', 'Live or history'], body: ['En direct pour le service ; Historique pour retrouver une commande passée.', 'Live for service; History to find a past order.'] },
      { target: 'orders.card', title: ['Une commande', 'An order'], body: ['Les colonnes suivent l’étape : nouvelles, en préparation, prêtes, parties. Le bouton du bas passe à l’étape suivante.', 'Columns follow the step: new, preparing, ready, picked up. The bottom button moves it to the next step.'] },
      { target: 'orders.filters', title: ['Retrouver une commande', 'Find an order'], body: ['Dans Historique : période, succursale, statut, et recherche par numéro, client ou numéro Clover.', 'In History: period, location, status, and search by number, customer or Clover number.'] },
    ],
    tips: [['Une commande d’un magasin non relié attend une personne : vérifiez la marque et la cuisine avant d’accepter.', 'An order from an unlinked store waits for a person: check the brand and kitchen before accepting.'], ['Une bande rouge en haut = des commandes en retard sur leur heure « prête ».', 'A red strip at the top = orders past their ready time.']],
  },
  {
    match: '/kitchen',
    title: ['Écran de cuisine', 'Kitchen screen'],
    intro: ['Les commandes à préparer, la plus pressée en premier, en gros pour être lues de loin. « Prête » quand c’est emballé. Le mode occupé donne plus de temps aux nouvelles commandes.', 'Orders to cook, most urgent first, big enough to read from across the kitchen. “Ready” when it’s bagged. Busy mode gives new orders more time.'],
    steps: [
      { target: 'kitchen.ticket', title: ['À préparer', 'To cook'], body: ['Chaque carte montre les articles et les notes (allergies en rouge). « Prête » quand c’est emballé.', 'Each card shows the items and notes (allergies in red). “Ready” when it’s bagged.'] },
      { target: 'kitchen.busy', title: ['Mode occupé', 'Busy mode'], body: ['Débordé ? Un geste donne plus de temps de préparation aux nouvelles commandes. Encore un geste pour revenir à la normale.', 'Swamped? One tap gives new orders more prep time. Tap again to go back to normal.'] },
      { target: 'kitchen.pickup', title: ['Prêtes', 'Ready'], body: ['Elles attendent le livreur. « Remise au livreur » quand il part avec le sac.', 'They wait for the courier. “Picked up” when the courier leaves with the bag.'] },
      { target: 'kitchen.fullscreen', title: ['Plein écran', 'Full screen'], body: ['Sur la tablette de la cuisine, passez en plein écran pour donner plus de place aux commandes.', 'On the kitchen tablet, go full screen to give the orders more room.'] },
    ],
    tips: [['Une tablette enregistrée reste sur sa succursale ; l’équipe entre avec son NIP.', 'An enrolled tablet stays on its location; the team unlocks it with their PIN.']],
  },
  {
    match: '/menu/86',
    title: ['Ruptures (86)', 'Out of stock (86)'],
    intro: ['Un article manque ? Touchez-le : il disparaît d’Uber Eats, DoorDash et Skip à cette succursale. Choisissez d’abord s’il revient tout seul.', 'Out of something? Tap it: it disappears from Uber Eats, DoorDash and Skip at this location. Pick first whether it comes back by itself.'],
    steps: [
      { target: 'menu86.location', title: ['La succursale', 'The location'], body: ['Une rupture vaut pour une seule succursale. Vérifiez-la avant de toucher.', 'An 86 applies to one location. Check it before tapping.'] },
      { target: 'menu86.return', title: ['Retour automatique', 'Automatic return'], body: ['30 min, 1 h, 2 h ou fin de journée : l’article revient tout seul. Sinon, il reste retiré jusqu’à ce que vous le remettiez.', '30 min, 1 h, 2 h or end of day: the item comes back by itself. Otherwise it stays off until you bring it back.'] },
      { target: 'menu86.toggle', title: ['Un geste', 'One tap'], body: ['Touchez l’article : il passe en rouge et disparaît des plateformes. Touchez encore pour le remettre.', 'Tap the item: it turns red and disappears from the platforms. Tap again to bring it back.'] },
      { target: 'menu86.tabs', title: ['Ce qui est en rupture', 'What’s 86’d'], body: ['« En rupture » liste tout ce qui est retiré pour cette marque à cette succursale.', '“86’d now” lists everything off for this brand at this location.'] },
    ],
    tips: [['DoorDash n’a pas de minuterie : TAKATAK remet l’article lui-même à l’heure prévue.', 'DoorDash has no timer: TAKATAK turns the item back on itself at the planned time.']],
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
    intro: ['Ce qui est surveillé jour et nuit : commandes qui attendent, tablettes éteintes, Clover, magasins hors ligne, paiements. Sans réponse, une alerte urgente passe au texto, à l’appel, puis au propriétaire.', 'What is watched day and night: waiting orders, tablets off, Clover, offline stores, payouts. With no answer, an urgent alert goes to text, then a call, then the owner.'],
    steps: [
      { target: 'incident.card', title: ['Une alerte', 'An alert'], body: ['Touchez-la pour voir ce qui se passe, quoi faire, et qui a été prévenu.', 'Tap it to see what’s happening, what to do, and who was told.'] },
      { target: 'incident.ack', title: ['Je m’en occupe', 'I’m on it'], body: ['Arrête les textos et les appels pour cette alerte. « Réglé » quand c’est fini.', 'Stops the texts and calls for this alert. “Fixed” when it’s done.'] },
      { target: 'incident.snooze', title: ['Sourdine', 'Snooze'], body: ['Met l’alerte de côté 30 minutes ; elle revient si le problème est encore là.', 'Puts the alert aside for 30 minutes; it comes back if the problem is still there.'] },
      { target: 'incident.check', title: ['Vérifier maintenant', 'Check now'], body: ['Relance une vérification tout de suite, par exemple après avoir réglé un problème.', 'Runs a check right now, for example after you fixed something.'] },
    ],
    tips: [['Beaucoup d’alertes se règlent toutes seules : elles passent alors dans « Réglées ».', 'Many alerts fix themselves: they then move to “Fixed”.'], ['« Règles » choisit qui est prévenu, comment et quand.', '“Rules” chooses who is told, how and when.']],
  },
  {
    match: '/insights/reports',
    title: ['Rapports', 'Reports'],
    intro: ['Tous les rapports en Excel ou CSV pour la période choisie : téléchargez-les, envoyez-les tout de suite ou programmez un envoi automatique.', 'Every report in Excel or CSV for the chosen period: download it, email it now, or schedule an automatic email.'],
    steps: [
      { target: 'reports.period', title: ['Choisir la période', 'Pick the period'], body: ['Hier, 7 jours, le mois passé… Les rapports suivent ce choix et les filtres de succursale et de plateforme.', 'Yesterday, 7 days, last month… Reports follow this choice and the location and platform filters.'] },
      { target: 'reports.download', title: ['Télécharger', 'Download'], body: ['« Excel » pour la comptabilité, « CSV » pour un autre logiciel. « Aperçu » montre les 20 premières lignes.', '“Excel” for bookkeeping, “CSV” for other software. “Preview” shows the first 20 rows.'] },
      { target: 'reports.schedule', title: ['Envoi automatique', 'Automatic email'], body: ['Programmez un envoi quotidien, hebdomadaire ou mensuel à votre comptable. La liste du bas montre chaque envoi et son dernier résultat.', 'Schedule a daily, weekly or monthly email to your accountant. The list below shows each email and how it last went.'] },
      { target: 'reports.stop', title: ['Arrêter un envoi', 'Stop an email'], body: ['La corbeille arrête un envoi ; « Annuler » le reprend pendant 6 secondes.', 'The bin stops an email; “Undo” brings it back for 6 seconds.'] },
    ],
    tips: [['Courriel pas branché ? Les téléchargements marchent quand même ; l’envoi demande que le courriel soit configuré.', 'Email not set up? Downloads still work; emailing needs email to be set up.'], ['Envoyer ou programmer un rapport : réservé au propriétaire et aux gérants. Les téléchargements marchent pour tous.', 'Emailing or scheduling a report: owner and managers only. Downloads work for everyone.']],
  },
  {
    match: '/insights',
    title: ['Analyses', 'Insights'],
    intro: ['Ventes, commandes, annulations et délais, toujours comparés à la période précédente de même durée. Les commandes annulées comptent comme ventes perdues.', 'Sales, orders, cancellations and wait times, always compared with the previous period of the same length. Cancelled orders count as lost sales.'],
    steps: [
      { target: 'insights.period', title: ['La période', 'The period'], body: ['Choisissez la période, les succursales et les marques. Tous les graphiques suivent.', 'Pick the period, locations and brands. Every chart follows.'] },
      { target: 'insights.kpis', title: ['Les chiffres clés', 'Key numbers'], body: ['Vert = mieux que la période précédente, rouge = à surveiller.', 'Green = better than the previous period, red = keep an eye on it.'] },
      { target: 'insights.metric', title: ['Ventes ou commandes', 'Sales or orders'], body: ['Le graphique par jour montre les ventes ou le nombre de commandes ; le pointillé, c’est la période d’avant.', 'The daily chart shows sales or number of orders; the dotted line is the period before.'] },
      { target: 'insights.export', title: ['Excel', 'Excel'], body: ['Toutes les commandes de la période dans un fichier, pour la comptabilité.', 'Every order of the period in one file, for the books.'] },
    ],
    tips: [['Chaque graphique a un bouton « Tableau » pour voir les chiffres exacts.', 'Every chart has a “Table” button to see the exact numbers.'], ['« Copier le lien » partage cet écran avec les mêmes filtres.', '“Copy link” shares this screen with the same filters.']],
  },
  {
    match: '/money/fees',
    title: ['Plans de commission', 'Commission plans'],
    intro: ['Ce que chaque plateforme garde sur vos commandes. Ces taux servent à calculer le paiement attendu de chaque commande. Tout s’enregistre seul.', 'What each platform keeps from your orders. These rates are used to work out the expected payout of every order. Everything saves by itself.'],
    steps: [
      { target: 'fees.plan', title: ['Votre plan', 'Your plan'], body: ['Choisissez la grille qui correspond à votre entente, ou « Personnalisé » et entrez les taux de votre contrat.', 'Pick the rate card that matches your agreement, or “Custom” and enter your contract’s rates.'] },
      { target: 'fees.confirm', title: ['Vérifié ?', 'Checked?'], body: ['Activez « Conforme à mon contrat » une fois les taux comparés à votre contrat.', 'Turn on “Matches my contract” once the rates are checked against your contract.'] },
      { target: 'fees.stores', title: ['Un magasin avec son propre taux', 'A store with its own rate'], body: ['Un magasin avec une autre entente ? Ajoutez-le ici avec son propre taux.', 'A store on another deal? Add it here with its own rate.'] },
      { target: 'autosave.chip', title: ['Pas de bouton Enregistrer', 'No Save button'], body: ['Les changements s’enregistrent seuls, puis les commandes sont revérifiées. ↶ ou ⌘Z annule une erreur.', 'Changes save by themselves, then orders are re-checked. ↶ or ⌘Z undoes a mistake.'] },
    ],
    tips: [['Au Québec, les taxes sur frais sont de 14,975 % (TPS + TVQ), récupérables en CTI/RTI.', 'In Quebec, tax on fees is 14.975% (GST + QST), recoverable as input tax credits.'], ['Une case vide ou hors limites est signalée en rouge : rien n’est enregistré tant qu’elle n’est pas corrigée.', 'An empty or out-of-range box is flagged in red: nothing is saved until it is fixed.']],
  },
  {
    match: '/money/payouts',
    title: ['Paiements et dépôts', 'Payouts & deposits'],
    intro: ['Chaque paiement des plateformes à côté de ce qui est arrivé à la banque. Entrez le dépôt de votre relevé bancaire : les écarts deviennent des dossiers à réclamer.', 'Each platform payout next to what reached the bank. Enter the deposit from your bank statement: gaps become cases to claim.'],
    steps: [
      { target: 'payouts.gaps', title: ['Ce qui ne concorde pas', 'What does not match'], body: ['Le nombre de dépôts différents du relevé. Zéro, c’est parfait.', 'How many deposits differ from the statement. Zero is perfect.'] },
      { target: 'payouts.deposit', title: ['Entrer le dépôt', 'Enter the deposit'], body: ['Sur chaque ligne, entrez ce que la banque a reçu. Si vous fermez par erreur, ce que vous avez tapé est gardé.', 'On each row, enter what the bank received. If you close by mistake, what you typed is kept.'] },
      { target: 'payouts.csv', title: ['Pour le comptable', 'For your accountant'], body: ['Un fichier avec tous les paiements, frais et dépôts de la période.', 'One file with every payout, fee and deposit of the period.'] },
    ],
    tips: [['Les taxes sur les commissions sont récupérables (CTI / RTI) : donnez le CSV à votre comptable.', 'Tax on commissions is recoverable (ITC / ITR): give the CSV to your accountant.'], ['« Net seulement » : importez le rapport détaillé de la plateforme dans Relevés pour voir chaque frais.', '“Net only”: import the platform’s detailed report in Statements to see each fee.']],
  },
  {
    match: '/money/disputes',
    title: ['Litiges', 'Disputes'],
    intro: ['L’argent que les plateformes vous doivent : commandes absentes, payées en moins, frais d’erreur. Les dossiers s’ouvrent et se ferment seuls ; vous notez ce que vous avez contesté.', 'Money the platforms owe you: missing orders, short payments, error charges. Cases open and close by themselves; you record what you disputed.'],
    steps: [
      { target: 'disputes.tabs', title: ['Votre liste', 'Your list'], body: ['Commencez par « À faire », les plus gros montants en haut.', 'Start with “To do”, biggest amounts first.'] },
      { target: 'disputes.update', title: ['Noter ce que vous avez fait', 'Record what you did'], body: ['Statut, no de dossier de la plateforme, montant revenu. Si vous fermez par erreur, c’est gardé.', 'Status, platform case number, amount back. If you close by mistake, it is kept.'] },
      { target: 'disputes.how', title: ['Où contester', 'Where to dispute'], body: ['Les étapes pour chaque plateforme. Faites-le vite : le délai est limité.', 'The steps for each platform. Do it quickly: time is limited.'] },
    ],
    tips: [['« Payées mais absentes de Food Hub » n’est pas de l’argent perdu : vérifiez Magasins → Jumelage.', '“Paid orders not in Food Hub” is not money lost: check Stores → Mapping.']],
  },
  {
    match: '/money/tgtg',
    title: ['Too Good To Go', 'Too Good To Go'],
    intro: ['Too Good To Go ne transmet pas vos sacs du jour à Food Hub. Entrez-les ici à la fermeture (10 secondes) : ils comptent dans les ventes, les rapports et la vérification des paiements.', 'Too Good To Go does not send your daily bags to Food Hub. Enter them here at closing (10 seconds): they count in sales, reports and payout checks.'],
    steps: [
      { target: 'tgtg.day', title: ['La journée', 'The day'], body: ['Aujourd’hui est déjà choisi. Changez la date pour corriger un autre jour.', 'Today is already picked. Change the date to fix another day.'] },
      { target: 'tgtg.sold', title: ['Les sacs ramassés', 'Bags picked up'], body: ['Le chiffre de l’app TGTG Store. Le prix est retenu sur cette tablette.', 'The number from the TGTG Store app. The price is remembered on this tablet.'] },
      { target: 'tgtg.save', title: ['Enregistrer', 'Save'], body: ['Un toucher et c’est dans vos ventes. Rien n’est compté deux fois.', 'One tap and it is in your sales. Nothing is counted twice.'] },
      { target: 'tgtg.history', title: ['Les 60 derniers jours', 'The last 60 days'], body: ['Touchez une ligne pour la corriger.', 'Tap a row to fix it.'] },
    ],
    tips: [['Rien vendu ? Entrez 0 : la journée est notée et rien n’est compté dans les ventes.', 'Nothing sold? Enter 0: the day is logged and nothing is counted in sales.']],
  },
  {
    match: '/money',
    title: ['Argent', 'Money'],
    intro: ['Chaque commande comparée à votre plan de commission et à ce que les plateformes ont vraiment payé. Ce qui manque devient un litige à réclamer. Aucun litige n’est envoyé aux plateformes à votre place.', 'Every order checked against your commission plan and what the platforms really paid. What is missing becomes a dispute to claim. No dispute is sent to the platforms for you.'],
    steps: [
      { target: 'money.recover', title: ['Argent à récupérer', 'Money to recover'], body: ['Le gros chiffre : ce que les plateformes vous doivent encore pour la période.', 'The big number: what the platforms still owe you for the period.'] },
      { target: 'money.period', title: ['La période', 'The period'], body: ['Changez la période ou la succursale ; tout l’écran suit.', 'Change the period or location; the whole screen follows.'] },
      { target: 'money.diff', title: ['L’écart', 'The difference'], body: ['Payé moins attendu. Négatif : vous avez reçu moins que prévu.', 'Paid minus expected. Negative: you got less than expected.'] },
      { target: 'money.unknown', title: ['Payées mais inconnues', 'Paid but unknown'], body: ['Des commandes payées que TAKATAK n’a pas reçues : souvent un magasin pas encore relié.', 'Paid orders TAKATAK never received: often a store not linked yet.'] },
    ],
    tips: [['Sans relevé importé, rien ne peut être marqué absent ou payé en moins : « Importer un relevé » en haut.', 'Without an imported statement, nothing can be marked missing or paid less: “Import a statement” at the top.']],
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
    match: '/settings/security',
    title: ['NIP gérant', 'Manager PIN'],
    intro: ['Choisissez quelles actions demandent le NIP d’un gérant. Chaque changement s’enregistre seul, et le journal garde qui a approuvé quoi.', 'Choose which actions need a manager’s PIN. Every change saves by itself, and the log keeps who approved what.'],
    steps: [
      { target: 'security.rule', title: ['Une règle par action', 'One rule per action'], body: ['Libre, NIP gérant ou Toujours un NIP. La petite ligne grise dit qui peut le faire, et la valeur par défaut si vous l’avez changée.', 'Open, Manager PIN or Always PIN. The small grey line says who can do it, and the default if you changed it.'] },
      { target: 'security.strict', title: ['Tout protéger d’un geste', 'Protect everything in one tap'], body: ['Un geste protège tout ce qui coûte de l’argent. Vous changez d’idée ? « Annuler » dans les 6 secondes, ou la flèche ↶.', 'One tap protects everything that costs money. Changed your mind? “Undo” within 6 seconds, or the ↶ arrow.'] },
      { target: 'autosave.chip', title: ['Pas de bouton Enregistrer', 'No Save button'], body: ['Ici, « Enregistré » confirme chaque changement. Si un NIP est demandé et que vous annulez, rien n’est perdu : touchez « NIP annulé — Enregistrer » quand vous êtes prêt.', 'Here, “Saved” confirms each change. If a PIN is asked and you cancel, nothing is lost: tap “PIN cancelled — Save” when you are ready.'] },
      { target: 'security.team', title: ['Ces règles aussi sont protégées', 'These rules are protected too'], body: ['Sur « Toujours un NIP », changer ces règles demande un NIP. Créez le vôtre d’abord dans Mon profil.', 'On “Always PIN”, changing these rules asks for a PIN. Create yours first in My profile.'] },
    ],
    tips: [['Un gérant ou le propriétaire peut approuver avec son NIP ; le journal d’activité garde son nom.', 'A manager or the owner approves with their PIN; the activity log keeps their name.'], ['Les NIP de l’équipe se gèrent dans Réglages → Équipe ; le vôtre, dans Mon profil.', 'Team PINs are managed in Settings → Team; yours, in My profile.']],
  },
  {
    match: '/settings/alerts',
    title: ['Alertes et surveillance', 'Alerts & watchtower'],
    intro: ['Quand une commande attend ou qu’un magasin tombe hors ligne, la surveillance sonne, texte puis appelle. Réglez qui est prévenu et quand. Tout s’enregistre tout seul ; seul le propriétaire peut changer ces règles.', 'When an order waits or a store goes offline, the watchtower rings, texts, then calls. Choose who hears and when. Everything saves by itself; only the owner can change these rules.'],
    steps: [
      { target: 'alerts.watch', title: ['L’interrupteur principal', 'The main switch'], body: ['Gardez la surveillance active. Arrêtée, plus aucune alerte ne part.', 'Keep the watchtower on. When it is off, no alert goes out.'] },
      { target: 'alerts.steps', title: ['Les étapes', 'The steps'], body: ['Écran tout de suite, puis texto, appel et propriétaire : choisissez après combien de minutes.', 'Screen right away, then text, call and owner: choose after how many minutes.'] },
      { target: 'alerts.rules', title: ['Ce qui est surveillé', 'What is watched'], body: ['Choisissez ce qui sonne seulement à l’écran et ce qui texte et appelle.', 'Choose what only rings on screen and what texts and calls.'] },
      { target: 'autosave.chip', title: ['Enregistré tout seul', 'Saved by itself'], body: ['Pas de bouton Enregistrer. La flèche ↶ (ou ⌘Z) annule le dernier changement.', 'No Save button. The ↶ arrow (or ⌘Z) undoes the last change.'] },
    ],
    tips: [['Testez un texto et un appel avant le premier service.', 'Test a text and a call before your first service.'], ['Vos propres alertes (texto, appel, heures calmes) sont dans Mon profil.', 'Your own alerts (text, call, quiet hours) are in My profile.'], ['Le bip et le plein écran des nouvelles commandes se règlent par tablette, dans « Cet écran ».', 'The new-order beep and full-screen pop-up are set per tablet, under “This screen”.']],
  },
  {
    match: '/settings/team',
    title: ['Équipe et NIP', 'Team & PINs'],
    intro: ['Qui a accès, à quelles succursales, avec quel rôle et quel NIP. Chacun se connecte par courriel ou cellulaire ; le NIP sert aux tablettes.', 'Who has access, to which locations, with which role and PIN. Everyone signs in by email or cell; the PIN is for tablets.'],
    steps: [
      { target: 'team.add', title: ['Ajouter quelqu’un', 'Add someone'], body: ['Nom, rôle, succursales et un courriel ou un cellulaire. Une invitation peut partir avec le lien de connexion.', 'Name, role, locations and an email or cell. An invitation can go out with the sign-in link.'] },
      { target: 'team.search', title: ['Chaque personne', 'Each person'], body: ['Rôle, succursales, NIP et dernière connexion d’un coup d’œil. « Modifier » ouvre sa fiche.', 'Role, locations, PIN and last sign-in at a glance. “Edit” opens their card.'] },
      { target: 'team.show', title: ['Les retirés', 'Removed people'], body: ['Les personnes dont l’accès est coupé restent ici, avec leur historique. On peut leur redonner l’accès.', 'People whose access is off stay here, with their history. Their access can be turned back on.'] },
    ],
    tips: [['Fermé par erreur ? Rouvrez la fiche : ce que vous aviez changé revient (jamais le NIP).', 'Closed by mistake? Reopen the card: what you changed comes back (never the PIN).'], ['Un employé sans NIP ne peut pas déverrouiller une tablette de cuisine.', 'Staff without a PIN cannot unlock a kitchen tablet.']],
  },
  {
    match: '/settings/business',
    title: ['Entreprise', 'Business'],
    intro: ['Vos succursales et vos marques. Elles alimentent la grille des magasins, le branchement, les heures, l’équipe et les rapports.', 'Your locations and brands. They feed the store grid, store connections, hours, team and reports.'],
    steps: [
      { target: 'business.add', title: ['Les succursales', 'Locations'], body: ['Ajoutez ou modifiez une succursale : nom, adresse et téléphone de la cuisine.', 'Add or edit a location: name, address and kitchen phone.'] },
      { target: 'business.brands', title: ['Les marques', 'Brands'], body: ['Chaque marque cuisinée ici. « Désactiver » la cache des nouveaux écrans, avec 6 secondes pour annuler.', 'Every brand cooked here. “Deactivate” hides it from new screens, with 6 seconds to undo.'] },
      { target: 'business.brand', title: ['Nouvelle marque', 'New brand'], body: ['Tapez le nom et « Ajouter ». Reliez-la ensuite à ses magasins de livraison.', 'Type the name and tap “Add”. Then link it to its delivery stores.'] },
    ],
    tips: [['Le téléphone de la cuisine est appelé en premier quand une tablette s’éteint ou qu’une commande attend.', 'The kitchen phone is called first when a tablet goes off or an order waits.']],
  },
  {
    match: '/settings/devices',
    title: ['Tablettes de cuisine', 'Kitchen tablets'],
    intro: ['Chaque tablette de cuisine, en ligne ou non, avec l’état du son et de la batterie. Enregistrez une tablette sur place, modifiez-la ou retirez-la si elle est perdue.', 'Every kitchen tablet, online or not, with its sound and battery status. Enrol a tablet on the spot, edit it, or remove it if it is lost.'],
    steps: [
      { target: 'devices.enrol', title: ['Enregistrer la tablette', 'Enrol the tablet'], body: ['Ouvrez Food Hub sur la tablette, connectez-vous, puis touchez ici. Ensuite, l’équipe la déverrouille avec son NIP.', 'Open Food Hub on the tablet, sign in, then tap here. After that, staff unlock it with their PIN.'] },
      { target: 'devices.sound', title: ['Vérifier le son', 'Check the sound'], body: ['Sur la tablette, touchez « Tester le son » avant le service : vous devez entendre la sonnerie des commandes.', 'On the tablet, tap “Test sound” before service: you should hear the order ring.'] },
      { target: 'devices.edit', title: ['Nom et succursale', 'Name and location'], body: ['Donnez un nom clair (ex. « Passe — NDG ») pour savoir laquelle est hors ligne quand une alerte arrive.', 'Give it a clear name (e.g. “Pass — NDG”) so you know which one is offline when an alert comes in.'] },
      { target: 'devices.remove', title: ['Tablette perdue ?', 'Lost tablet?'], body: ['Retirez-la : elle est déconnectée tout de suite. Une nouvelle s’enregistre de la même façon.', 'Remove it: it is signed out at once. A new one enrols the same way.'] },
    ],
    tips: [['Gardez la tablette branchée, le volume au maximum et Food Hub ouvert : si elle s’éteint pendant le service, les gérants sont avertis.', 'Keep the tablet plugged in, the volume up and Food Hub open: if it turns off during service, managers are warned.']],
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
