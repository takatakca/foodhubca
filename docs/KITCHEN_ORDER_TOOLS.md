# Outils de commande en cuisine / Kitchen order tools

Ce que la tablette de cuisine Food Hub fait maintenant depuis une commande, sans ouvrir une autre page. Tout est dans de
nouveaux fichiers ; deux lignes seulement les branchent à l'écran existant.

What the Food Hub kitchen tablet now does from an order, without opening another page. Everything lives in new files;
only two lines wire them into the existing screen.

## 1. Rupture depuis la commande / 86 from an order line

- Sous les articles de la commande : « Rupture depuis la commande ». Chaque ligne et chaque option a un bouton **Rupture**.
- Choix : **Jusqu'à la fermeture** (minutes jusqu'à la fermeture de cette marque ici, d'après Réglages → Heures, fériés et
  nuits après minuit compris), **4 h**, **Aujourd'hui** (= jusqu'à la fermeture ; sans heures saisies, jusqu'à minuit),
  **Indéfiniment** (jusqu'à ce qu'on le remette).
- Envoi par la route existante `POST /api/foodhub/availability` `{ brand, itemRefs: [ref], available: false, minutes, locationCode }`.
  Le NIP gérant est demandé quand la règle « item.86 » le veut (Réglages → Sécurité) ; NIP annulé = rien d'envoyé, rien d'affiché.
- Le message dit la vérité, compté sur le statut de chaque magasin (`lib/foodhub/order-tools/outcome.ts`) : changés = `done`
  ou `queued` ; **non envoyés** = `skipped` (menu verrouillé, « Ne pas toucher », pas un plat de la marque), listés un par
  un ; refusés = `blocked` ou erreur. Un magasin sauté n'est jamais compté comme « en rupture ».
- Une ligne introuvable dans le menu n'a pas de bouton Rupture : « Introuvable dans le menu : utilisez Ruptures (86) » et un
  bouton de 48 px vers `/menu/86`. Chaque bouton Rupture porte le nom de l'article pour les lecteurs d'écran.
- Correspondance (`lib/foodhub/order-tools/line-refs.ts`) : identifiant du marchand (= ref du menu) → identifiant Clover →
  nom normalisé (minuscules, sans accents, sans mots de format « petite / grande / large… »). Un nom ne compte que s'il
  désigne un seul article : jamais de rupture au hasard. Les options sont cherchées dans les groupes de l'article.

API (read-only): `GET /api/foodhub/order-tools/<orderId>/line-refs` — permission `view`, kitchen scope (404 for an order of
another kitchen, the same answer as an unknown order, so order ids of other kitchens cannot be probed). Returns `{ brand, locationCode, hasMenu, closesInMin, lines: [{ index, name, itemRef?, match, modifierRefs }] }`.

## 2. Suivi du livreur / Courier watch

`lib/foodhub/order-tools/courier-watch.ts` lit `timeline.courier` (assigned / arriving / at_store / picked_up, `etaAt`,
`updatedAt`) avec `readyAt`, `readyTarget` et `dispatchedAt` :

| État | Affichage |
|---|---|
| assigned | « Livreur assigné, arrive vers HH:MM » |
| arriving (ETA ≤ 5 min) | surligné « Livreur arrive dans ~N min » + **un seul** son discret par commande |
| waiting (au comptoir, commande pas prête) | rouge « Livreur attend depuis mm:ss » |
| here (au comptoir, commande prête) | vert « remettez la commande » |
| gone | « Parti à HH:MM », « prévu HH:MM / réel HH:MM » |

Le son passe par `lib/ui/sound` (`playSound('soft')`), une fois par commande, jamais en boucle, et se tait quand le son de
cet écran est coupé (Réglages → Alertes → Cet écran).

**Limite :** le suivi vit dans la fiche de la commande. Le son ne joue que si cette commande est ouverte à l'écran au moment
où le livreur passe sous 5 min ; aucune fiche ouverte = aucun son. Ouvrir une commande dont l'heure d'arrivée du livreur est
déjà passée ne sonne pas (la commande est notée « déjà sonnée »). Un son au niveau du tableau de cuisine demanderait de
toucher `kitchen-view.tsx` : hors de cette branche.

Le minuteur « attend depuis » part de la **première** arrivée du livreur au comptoir : le premier événement `courier`
`at_store` de la commande, ou la première fois que l'écran l'a vu au comptoir — pas `courier.updatedAt`, qui bouge à chaque
mise à jour de la plateforme. Les lecteurs d'écran entendent le changement d'état une fois, jamais le minuteur qui défile.

## 3. Statut du magasin depuis la cuisine / Kitchen store status

Bouton dans l'en-tête de la cuisine, à côté du bouton Occupé (qui reste) : « Ouvert · Normal 15 min », « Occupé · 25 min »
ou « En pause jusqu'à HH:MM (N/M) ». La feuille :

- **Temps de préparation** : Normal / Occupé, minutes occupé ±5 → route existante `POST /api/foodhub/prep`.
- **Pause** : 15 min, 30 min, 1 h, jusqu'à la fermeture ; plateformes (seulement celles de cette cuisine) ; marques
  (toutes cochées au départ) ; raison → nouvelle route `POST /api/foodhub/order-tools/kitchen/status`
  `{ locationCode, storeIds, online: false, minutes, reason }`. Le NIP gérant passe par la règle existante « store.pause ».
- **Tout rouvrir** → la même route, `online: true`, pour les pauses de la cuisine seulement : un magasin fermé pour un
  **férié** (pause automatique `Holiday closure` / `meta.holidayPause` du jour) ou **fermé par la plateforme** (désactivation
  DoorDash, hors des heures du menu : `platformStatus.state` `deactivated` / `closed`) reste fermé, avec la raison affichée.
- **Verrouillés, affichés mais jamais envoyés** : le magasin DoorDash protégé de Po Poulet NDG (constante
  `FORBIDDEN_STORE_IDS` ou le verrou de menu intégré, par son identifiant de branchement ou son numéro DoorDash) et tout
  magasin marqué « Ne pas toucher ». Les magasins relais (`relay:`) sont cachés.
- **Refus côté serveur.** La route refait le tri sur le serveur (`splitKitchenRequest`) avant d'appeler la logique
  existante `setStoresOnline` : magasin protégé, « Ne pas toucher », d'une autre cuisine, relais ou inconnu, et pour une
  réouverture les fériés et fermetures de plateforme, ne sont jamais envoyés et reviennent dans `notSent`. Une tablette
  pas à jour ou une requête faite à la main ne peut donc pas mettre en pause le magasin protégé. Permission
  `stores:toggle`, scope cuisine, même règle de NIP. Le message compte les magasins vraiment changés (`done` / `queued`).

Liste des magasins : route existante `GET /api/foodhub/stores`. Nouvelle route en lecture seule
`GET /api/foodhub/order-tools/kitchen?locationCode=` (permission `view`, scope cuisine) : minutes jusqu'à la fermeture par
marque et identifiants protégés. Logique pure testée : `lib/foodhub/order-tools/kitchen-status.ts`.

La route existante `POST /api/foodhub/stores/status` (page Magasins) n'est pas modifiée par cette branche.

## 4. Argent de la commande (lecture seule) / Order money (read-only)

Bouton « Voir l'argent de cette commande » (caché sans la permission `analytics:view`) : attendu (net), payé, écart, frais
d'erreur, ajustements, remboursements, promotions, date de versement, cas de litige, lien vers `/money/disputes`.

- `lib/foodhub/order-tools/order-money.ts` : `reconcile()` sur jour −1 / jour +1, la plateforme et la cuisine de la commande,
  filtré sur la commande, plus `listCases()` filtré sur la commande. Cache mémoire de 60 s par commande. `not_yet` tant
  qu'aucun relevé ne couvre la commande.
- `GET /api/foodhub/order-tools/<orderId>/money` : `analytics:view` + scope cuisine.
- **Aucune soumission, aucune approbation** : c'est le propriétaire qui soumet les litiges dans le portail de chaque plateforme.

## Branchements / Wiring

- `components/live/order-drawer.tsx` : 1 import + `<OrderTools order={order} />` juste après la carte des articles.
- `app/(console)/kitchen/kitchen-view.tsx` : 1 import + `{here && <KitchenStatus locationCode={here} />}` dans les actions de l'en-tête.

Composants : `components/live/order-tools/{index,quick-86,courier-watch,kitchen-status,order-money}.tsx`. Jetons du thème
seulement (compatibles avec le thème cuisine sombre), cibles tactiles de 48 px, français d'abord.

## Tests

`tests/order-tools-line-refs.test.ts`, `order-tools-courier.test.ts`, `order-tools-kitchen-status.test.ts`,
`order-tools-money.test.ts`, `order-tools-outcome.test.ts`, `order-tools-api.test.ts` — dépôt mémoire, moteur de rapprochement simulé, `fetch` espionné :
aucun appel de plateforme ni de Clover.
