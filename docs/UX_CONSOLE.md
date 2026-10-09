# Console Food Hub : niveau DoorDash Merchant (tâche 21)

Branche `feature/console-store-switcher`. Demande du propriétaire (2026-10-09) : simple pour les yeux, on ne montre
que ce qui sert ; une liste réunit toutes les marques d'une cuisine, un clic ouvre une marque seule ; tout se branche
sur un seul tableau de bord. Texte de l'interface en français d'abord (bouton EN comme aujourd'hui).

Captures avant / après : `OneDrive\00 MAT IMPORTANT\Food Hub - captures\` (`avant\`, `apres\`).

## 1. Ce qui gêne aujourd'hui (avant)

- **Trop d'entrées dans le menu** : Aperçu, Commandes, Cuisine, Magasins, Menus, Alertes, Analyses, Argent, Réglages
  (+ Nos commandes). Pas de groupes.
- **L'accueil fait trois écrans de haut** : ventes, état technique (base de données, webhooks, Watchtower…), alertes,
  plateformes, graphique par heure, cartes de succursales, puis une grille 18 marques × 5 succursales. Tout en même temps.
- **Le choix de succursale est caché** : une multi-sélection gardée dans le navigateur, pas dans le lien, et aucun choix
  par marque.
- **Magasins répète la marque** pour chaque plateforme (Po Poulet = 5 lignes à NDG) : aucune vue « une marque = une ligne ».
- **Couleur orange** et « T » orange : ce n'est pas l'identité GROUPE TAKATAK (`BRAND.md` : bleu électrique sur marine).
- Bruit dans la barre du haut : pastille de ventes, en plus des tuiles de l'accueil.

## 2. Une seule portée pour toute la console

Comme le choix de magasin de DoorDash Merchant : **Tous les restaurants → cuisine → marque**.

- Dans le lien : `?kitchen=NDG_MAIN&brand=Po%20Poulet`. Un lien partagé ouvre la même vue.
- Le dernier choix est retenu sur l'appareil ; si une page s'ouvre sans portée dans le lien, la console l'y remet.
  « Tous les restaurants » enlève la portée.
- Une marque seule (`?brand=Po%20Poulet`) = cette marque dans toutes ses cuisines (utile pour les menus).
- Logique pure et testée : `lib/foodhub/scope.ts`, `tests/scope.test.ts`.
- **Sécurité, jamais filtré par marque** : la fenêtre « nouvelle commande », l'alarme d'annulation et l'écran cuisine.
  Ils suivent seulement la cuisine. Un gérant qui regarde « Po Poulet » entend quand même une commande Pi Pita de sa
  cuisine.
- Une personne limitée à certaines cuisines ne voit que les siennes (le serveur filtre déjà, `scopeFilter`). Une tablette
  de cuisine reste sur sa cuisine.
- Le verrou Po Poulet NDG (DoorDash 27982486, `lib/foodhub/menu/lock.ts`) n'est pas touché : la portée ne fait que
  filtrer l'affichage, elle n'envoie rien aux plateformes.

Pages qui suivent la portée : Aujourd'hui, Commandes (en direct et historique), Menus (la marque choisie s'ouvre),
Restaurants (statut, heures, liens), Rapports et Analyses, Alertes (par cuisine).

## 3. Écrans : avant → après

| Écran | Avant | Après |
|---|---|---|
| Barre du haut | succursales cachées, pastille de ventes, 8 boutons | sélecteur de portée à gauche, recherche, cloche Alertes avec compteur, son, langue, profil |
| Menu de gauche | 10 entrées à plat, orange | **Aujourd'hui · Commandes · Écran cuisine · Menus · Restaurants · Rapports · Réglages**, marine + bleu |
| Accueil « Aujourd'hui » | 3 écrans de tout | 5 tuiles (Commandes, Ventes, Préparation moyenne, À traiter, Plateformes en ligne) → commandes en cours → alertes (5) → la liste des cuisines ou des marques de la portée. Le reste (graphique par heure, état technique, grille complète) derrière « Voir les détails » |
| Restaurants | une ligne par marque × plateforme | une carte par cuisine, **une ligne par marque** : logo, nom, ouvert / fermé, commandes et ventes du jour, points par plateforme. Un clic → la marque seule, avec ses plateformes et Pause / Rouvrir |
| Commandes, Menus, Heures, Rapports | filtres de succursale et de marque sur chaque page | suivent la portée ; il reste la période et la plateforme |

Règles de forme : couleurs `BRAND.md` (marine `#060D1F`, bleu `#1565D8` sur fond clair, bleu électrique `#1F8BFF` sur
marine) ; vert, rouge et ambre seulement pour les statuts ; cibles tactiles de 44 px au moins ; squelettes de chargement ;
états vides qui disent quoi faire ; erreurs en français simple. L'écran cuisine reste sombre et à fort contraste.

## 4. Laissé pour plus tard

- **Logos des marques** : aucun fichier dans les données. Un monogramme de couleur stable par marque en attendant
  (Phase 5 du `MASTER_PLAN.md`, « brand kits »).
- **NDG 6284** est une succursale à part dans les données (6284 Av Somerled). Si c'est la même cuisine que NDG (6280),
  la désactiver dans Réglages → Entreprise.
- **Saint-Léonard** : les données disent 5837 Rue Jean-Talon E (le propriétaire dit 5839). Rien changé ici ; corriger
  dans Réglages → Entreprise si 5839 est la bonne adresse.
