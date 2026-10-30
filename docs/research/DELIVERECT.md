# Deliverect au Canada : tout ce qu'ils branchent, comment on devient partenaire, et leurs prix

Recherche demandée par le propriétaire le 2026-10-29 (« deliverect.com/en-ca/integrations : je veux faire la même chose
au Canada »). Sources publiques lues le 2026-10-30 : le plan du site `https://www.deliverect.com/sitemap.xml` (toutes les
pages `/en-ca/integrations/…`), chacune des 131 pages d'intégration canadiennes (catégorie et pays « Supported in » lus
dans la page), l'accueil `/en-ca`, `/en-ca/pricing`, `/en-ca/dispatch` et le portail développeurs
`developers.deliverect.com`. Liste complète, une ligne par intégration :
[`deliverect-ca-integrations.csv`](deliverect-ca-integrations.csv). Plan d'action de TAKATAK :
[`../INTEGRATION_PLATFORM.md`](../INTEGRATION_PLATFORM.md).

> Document interne. La page publique `/hub` ne nomme aucun concurrent (tests `tests/public-hub*.test.ts`).

## 1. En chiffres

| Fait | Valeur (telle qu'écrite par eux, ou comptée par nous) |
|---|---|
| Pages d'intégration canadiennes (`/en-ca/integrations/…`) | **131 intégrations + 13 pages de catégories = 144** (compté dans le plan du site) |
| Intégrations qui disent « Supported in : Canada » | **131 / 131** |
| Seulement au Canada | Best POS, Cluster, Di Develop, GoLivro, Jeavensoft, Mealsy, OnShip, PikaPoint, Relayfy, Skip, Suppli, TechServe POS, Tutti Delivery, Veloce, Xperio |
| Autres langues (même plan du site) | `fr-ca` 142, `en-us` 203, `en-gb` 180, `en` (global) 617 pages |
| Ce qu'ils annoncent | « 1000+ integrations », « 500+ » sur la page des plateformes, « 1.5B+ orders processed », « 80K locations », « 65+ countries » (accueil) mais « 52 countries / 50,000 locations » (page prix) — chiffres qui ne concordent pas |
| Prix | **Non publiés** : « Book a 1-on-1 with our team to discuss pricing ». Le prix dépend du pays, de la taille, du nombre d'emplacements et des produits (Restaurants, Retail, Direct, Dispatch) |

## 2. Les 131 intégrations canadiennes, par catégorie (leurs catégories, leurs mots)

Une intégration peut être dans plusieurs catégories. « Foodhub » ci-dessous est une plateforme de commande britannique,
**pas** notre TAKATAK Food Hub.

| Catégorie | Nb | Intégrations |
|---|---|---|
| 3rd-party marketplace | 18 | Bbot, DizLog, DoorDash, FANTUAN Delivery, Foodhub, HungryPanda, Mealeo, OnShip, Prepitapp, Ritual, Skip, Smooth Commerce, Suppli, Table Service, TopServe, Tutti Delivery, Uber Eats, Ordering |
| POS systems | 57 | PAR Tech - Pixel Point, ABCPOS, Aloha Cloud, Apptology Inc, ArmPOS, Auphan, Best POS, Cashdrop, Caviar POS, Clover, Cluster, Comtech, Curbngo, DebittechPOS, DizLog, Easy POS, Epos Now, FocusPOS, Givex, Grubbrr, HantePay, Hippos, ICRTouch, Jeavensoft, Lightspeed, Limerr Technologies, LineSkip, Linga POS, LS Central by LS Retail, Maitre'D, Mealsy, MenuSifu, Micros RES 3700, Micros Simphony, NCC, NextGenKitchens, Nōwn, ParTech Brink, Plento, Profitek, QuickPOS, Ranger, Shiji Group, Silverware POS, Smarttab, Square POS, Starrtec Solutions, SwypePOS, TASK, TastyFuture, TechServe POS, Toast, TouchBistro, Veloce, Visual Touch POS, Xenial-Cloud, Xperio |
| 3rd-party dispatch | 9 | GoLivro, JET GO, LS Central by LS Retail, Shipday, DoorDash Drive, EVA, Tookan by Jungleworks, Uber Direct, Vromo |
| Online ordering | 36 | BiteBerry, Como, Crave Interactive Ltd, Di Develop, DizLog, Flipdish, Foodhub, Future Ordering, Limerr Technologies, LoungeUp by D-Edge, MenuDelite, MENUU, NextGenKitchens, Ordermonkey, Pattern, PikaPoint, Plento, Popmenu, Qikserve, Relayfy, Ritual, Rushable INC, Servy, SevenRooms, Smooth Commerce, Sociavore, Suppli, Swype2go, Table Service, Tablevibe, Techtris Development, TicknCook, Too Good To Go, unPLUG Dining, Ordering, Virnika |
| On-site ordering | 19 | ArmPOS, Bite Kiosk, Crave Interactive Ltd, Flipdish, Limerr Technologies, MenuDelite, My Digi Menu, Ordermonkey, Pattern, PYE, Qikserve, Relayfy, Ritual, Servy, SevenRooms, Sociavore, Table Service, TopServe, Ordering |
| Kiosk | 5 | Bite Kiosk, Future Ordering, Ordermonkey, PYE, Qikserve |
| Loyalty & CRM | 10 | Como, DizLog, DataCandy, eCard Systems, Leat, Spoonity, Thanx, Limerr Technologies, Ordermonkey, Pattern |
| Payment and Gift Cards | 4 | Adyen, Airwallex, FreedomPay, Stripe |
| KDS, inventory & reporting | 6 | ArmPOS, DizLog, Limerr Technologies, LS Central by LS Retail, OpenTable, RocketBox |
| AI voice ordering | 6 | Ask Arthur, ConverseNow, Sadie, SoundHound, Virnika, VOICEplug |
| AI integrations | 6 | Ask Arthur, n8n, Sadie, SoundHound, Virnika, VOICEplug |
| Social media | 3 | Facebook, Instagram, WhatsApp |
| Retail | 3 | PAR Tech - Pixel Point, DoorDash, Uber Eats |
Les pages de détail disent « reliable two-way integration » et « This integration requires a subscription to <partenaire>
and Deliverect » (lu sur SkipTheDishes, Clover, Lightspeed). Page Dispatch : 8 logos (Shipday, Relay, Stuart, DoorDash
Drive, Wolt, Uber Direct, Vromo, Tookan by Jungleworks) et « 40+ last-mile delivery partners » sur l'accueil.

## 3. Leurs produits (accueil `/en-ca`)

| Famille | Produit | Ce qu'ils disent |
|---|---|---|
| Commande directe (1ʳᵉ partie) | Commerce-API | suite d'API modulaire pour une commande en ligne sur mesure |
| | Deliverect Direct | site, app et QR de commande à la marque du restaurant, à partir de gabarits |
| Plateformes (3ᵉ partie) | Order Aggregation + Intelligent Menu Management | « 99.6% order injection rate » : chaque commande des plateformes dans la caisse |
| | Revenue Protection (Sentinel) | protéger et récupérer les revenus sur les plateformes |
| Livraison | Third-Party Delivery Partner Integration (Dispatch) | envoyer les commandes à 40+ partenaires de livraison |
| | In-House Fleet Management | gérer sa propre flotte (app livreur) |
| Traiteur | Deliverect Catering | plateforme traiteur à la marque |
| IA | Deliverect AI (agents) | « always-on digital workforce » |

## 4. Comment on devient partenaire chez eux (leur processus, pour s'en inspirer)

Source : `developers.deliverect.com/docs/become-an-integration-partner` (mis à jour 2026-08-12) et
`staging-and-production-environment` (2026-08-13).
1. Formulaire de demande de partenariat ; leur équipe Partenariats rappelle.
2. Courriel de bienvenue : **compte de test (staging)**, **identifiants d'API**, **document de certification**.
3. Tout le développement se fait en staging (un compte partenaire + un compte client avec deux emplacements de test).
4. **Certification** : « en moyenne deux appels » avec leur équipe ; toutes les exigences du document doivent être remplies.
5. Accès production **immédiatement après** la certification ; ils accompagnent le premier client réel.

Types de partenaires (titres de leurs schémas) : canal (plateforme ou app de commande), caisse restaurant, caisse
commerce de détail, répartition (dispatch), fidélité, écran de cuisine (KDS), paiement, CRM.

Concepts de leur API (à reproduire dans notre API partenaires, voir `../INTEGRATION_PLATFORM.md` §3.3) :
- **Inscription d'un magasin** : `register` (channelLinkId, locationId) → réponse avec des URL de rappel
  `statusUpdateURL`, `menuUpdateURL`, `snoozeUnsnoozeURL`, `busyModeURL`, `updatePrepTimeURL`, `courierUpdateURL`.
- **Commandes** : la plateforme envoie la commande, elle est injectée dans la caisse ; les états repartent par
  `statusUpdateURL` (annulation : 100 puis 110).
- **Menu** : `menuUpdateURL` (menu + disponibilités), rappel asynchrone de l'état de la publication.
- **Ruptures** : `snoozeUnsnoozeURL` ; **mode occupé** : `busyModeURL` ; **temps de préparation** : `updatePrepTimeURL`.
- **État du magasin** : `open`, `busy` (avec `preparationTimeDelay` en minutes), `paused`, `closed` ; types de service
  pickup, delivery, eatIn, curbside.
- Sécurité : jeton d'accès, signature HMAC des webhooks, liste d'IP, limites de débit.

Food Hub implémente déjà le côté « caisse » de cette API pour Too Good To Go (29/29 opérations sortantes,
`docs/TGTG_API_COVERAGE.md`) : on connaît leur modèle de l'intérieur.

## 5. Ce qu'on en retient pour TAKATAK
- Leur force est le **nombre de caisses** (57 au Canada) et un **processus partenaire en libre-service** (staging,
  document de certification, deux appels). C'est ce qu'il nous faut construire : `PosAdapter` + portail partenaires.
- Leur faiblesse pour un restaurant d'ici : **pas de prix publié**, un abonnement Deliverect **en plus** de chaque
  partenaire, et le support n'est pas montréalais. Notre réponse : prix public en dollars canadiens, tout compris par
  emplacement, en français et en anglais (`../INTEGRATION_PLATFORM.md` §4).
- Les intégrations « seulement au Canada » (Skip, Veloce, Best POS, GoLivro, Tutti Delivery…) montrent les partenaires
  locaux qui comptent ; Veloce et Maître'D (PayFacto, Québec) sont des cibles naturelles pour nous.

— signé : Claude (busy-cannon, Claude Code cloud) @ cloud · 2026-10-30 00:05 (HE)
