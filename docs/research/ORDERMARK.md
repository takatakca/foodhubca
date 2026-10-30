# Ordermark (UrbanPiper) : tout ce qu'ils font, et ce qu'on en retient pour TAKATAK Food Hub

Recherche demandée par le propriétaire le 2026-10-29 (« une liste très détaillée, le complet de tout ce qu'Ordermark
fait », plugins et intégrations compris, et les autres caisses à intégrer). Sources : huit pages publiques lues le
2026-10-29 / 30 (liste en section 6) et les captures envoyées par le propriétaire. Seulement de l'information publique,
citée telle quelle ; ce qui n'a pas pu être lu ou confirmé est marqué **(à confirmer)**. La comparaison fonction par
fonction avec leur tableau de bord (Atlas) est déjà dans [`../ATLAS_PARITY.md`](../ATLAS_PARITY.md) : ce document ne la
répète pas.

> Règle des pages publiques : aucun nom de concurrent ni d'agrégateur sur `/hub` (tests `tests/public-hub*.test.ts`).
> Ce document reste interne au dépôt ; rien d'ici ne va sur la page publique sans passer par ces tests.

## 1. Qui est Ordermark aujourd'hui

| Fait | Ce qui est écrit |
|---|---|
| Rachat | 13 juin 2023 : « UrbanPiper is thrilled to announce the acquisition of Ordermark's U.S. business » (le titre dit « US and Canada »). Une bonne partie de l'équipe produit et technique d'Ordermark a suivi. |
| Une seule marque | Lettre ouverte du 20 novembre 2024 : « Ordermark by UrbanPiper » devient simplement « UrbanPiper » partout ; lancement officiel aux États-Unis. ordermark.com reste en ligne (« Ordermark has joined forces with UrbanPiper »). |
| Fondée | UrbanPiper, 2016 (bureaux annoncés : Bengaluru, Dubaï, Riyad, Londres). |
| Partenariat mis en avant | « UrbanPiper is now officially a DoorDash Preferred Integrations Partner! » |
| Taille annoncée | Chiffres qui ne concordent pas d'une page à l'autre : 40 000+ restaurants (ordermark.com), 27 000+ restaurants et 40 000+ marques (page Hub), 35 000+ emplacements (2023). Caisses : 250+ (ordermark.com) contre 350+ (lettre de 2024). Commandes : 750 millions au total, 300 millions par an (2023), « plus d'un million par jour ». |
| Prix | **Non publiés.** `/pricing` répond 404. FAQ : « Schedule a demo to get tailored options from our sales team. » Page Hub : le prix « depends on the scale of your business and your order volumes ». Aucun essai gratuit, frais d'installation ni durée de contrat affichés. |
| Mise en route | « Usually, it takes us 7 days to get Hub working on your system » (moins de 7 jours). Un spécialiste d'intégration expédie le matériel au besoin, installe et forme l'équipe. |
| Matériel | « Hub is a web based integration solution that can be added onto your existing POS system without additional hardware » ; sinon, appareils expédiés « pre-configured ». |
| Conformité affichée | ISO 27001:2013, AICPA SOC, RGPD (badges du pied de page, non vérifiés). |
| Support annoncé | Support « 24/7 » par téléphone (annoncé). La base de connaissances support.ordermark.com répondait 530 (hors ligne). |

## 2. La liste complète de ce qu'ils annoncent

### 2.1 Les huit fonctions de la page d'accueil (section « Product features »)

Les noms seuls figurent sur la page, à côté d'une capture du tableau de bord (ventes, nombre de commandes, nouveaux
clients, panier moyen, courbe des ventes par heure) :

1. **End-to-End Order Management** : « Manage orders from DoorDash, Uber Eats, Grubhub, and more-all in one dashboard. »
2. **On-Demand Store Pause** : pause d'un magasin sur les plateformes.
3. **Multi-Menu Management** : « One Menu, Everywhere » / « Sync your menu across all channels with just a few clicks ».
4. **Plug-and-Play POS Integration** : les commandes dans la caisse existante.
5. **Live Rider & Courier Alerts** : alertes sur le livreur.
6. **360° Analytics Comparison** : « 22+ ready reports across operations, stock, revenue, and more ».
7. **Instant Item & Modifier Snooze** : rupture d'un article ou d'une option.
8. **Scheduled Reporting** : rapports envoyés à heure fixe.

Aussi sur la page : plusieurs marques dans un seul portail (FAQ).

### 2.2 Les neuf tuiles du produit Hub (urbanpiper.com/us/hub)

| Tuile | Phrase de la page (quand il y en a une) |
|---|---|
| Order Management | « Manage all your online orders on one screen, directly from your POS. » |
| Menu Management | « Update all your online menus in real-time with just one click. » |
| Stock Management | « Update your stock across all outlets and channels in real-time to drive down cancellations. » |
| Store Toggle | (nom seul) |
| Advanced Analytics | « 360-degree analysis of your business » |
| Detailed Reporting | tableau de bord centralisé des données d'opération et de ventes |
| 99.99% Uptime | (nom seul, non vérifié) |
| Payment Reconciliation | (nom seul) |
| Multi-store Control | (nom seul) |

La FAQ ajoute des « built in automation features » (acceptation plus rapide des commandes).

### 2.3 Les autres produits

- **Orderline AI** : « Handle all customer calls, reservations and orders, with AI ».
  Chez nous : **TAKATAK Phone AI**, une application Clover distincte (assistant automatisé, faire le 0 pour une personne).
- **Meraki** : « Setup your own self-branded ordering websites and apps ».
  Chez nous : la vitrine **ON2GO.ca** (`/commander/<restaurant>`, voir [`../STOREFRONT.md`](../STOREFRONT.md)).
- Le blogue de 2023 parle aussi de « marketing automation » (rien de plus précis sur les pages lues).

### 2.4 Plateformes de livraison

- Anneau « Delivery Partners » d'ordermark.com : Uber Eats, Caviar, DoorDash, Seamless, Grubhub, EatStreet, Postmates.
- Graphique des revenus d'ordermark.com : DoorDash, Uber Eats, Skip, Grubhub.
- FAQ de la page Hub : Zomato, Swiggy, UberEats, Amazon Food « and more ». Blogue 2023 : Talabat, Deliveroo ; Ordermark
  était branché à « over 30 third-party delivery service providers ».
- Page des intégrations d'UrbanPiper, catégorie « Delivery platforms » (première page lue, tout « Live » sauf mention) :
  Careem ; Caviar (É.-U.) ; ChowNow (É.-U., Canada) ; Cowrks (à venir) ; Deliveroo ; DiDi Food ; Directoo ;
  DoorDash (É.-U., Canada, Australie) ; EatStreet (É.-U.) ; Enqueue ; Foodhub (É.-U., R.-U., Australie, Irlande,
  Canada) ; Foodora ; Foodzapp ; Gintaa ; Glovo ; Grubhub (É.-U.) ; HungerStation ; HungryPanda ; Instashop ; Isthara ;
  Jahez ; Just Eat ; Keeta ; Lieferando ; Mr Mandoob ; Mrsool ; Ninja ; Ninjacart (à venir). La page continue
  (« Load more ») **(page 2 non lue)**.

Pour un restaurant de Montréal, seules comptent **Uber Eats, DoorDash et SkipTheDishes** (et Too Good To Go lorsque le
compte offre un flux de commandes). Food Hub les relie **directement**, sans agrégateur entre le restaurant et la
plateforme.

### 2.5 Caisses et ERP

- Anneau « POS Partners » d'ordermark.com : **Toast, Square, TouchBistro, Lightspeed, Odoo, SumUp, Revel**.
- FAQ : « connects to 250+ POS systems (e.g., Lightspeed, Toast, TouchBistro) ».
- Page des intégrations d'UrbanPiper, catégorie « POS Systems », première page (65 entrées, par ordre alphabétique) :
  3sPOS ; Access POS ; All POS ; Amepos ; BestPOS / FnB 360 ; Billberry ; BIMPOS ; Biz1Book ; Blue Lotus 360 ;
  Bravery Kitchen ; Bridge / Explorex ; CaptainPad ; CCD App ; Cibo ; Ciferon ; CredoOne ; Crystal Mind POS ;
  CW Suite (É.-U.) ; Cyntra AI (É.-U.) ; Cypheron POS ; Datamate / Hotsoft Purple Key ; Derah ; Devourin ; Dgtera ;
  Digipos / Digitory ; Digirestro / Concourse ; Dineorder ; Dineplan ; Dinner Daddy (É.-U.) ; Dino POS ; Enstore ;
  Epos Now ; Eresto ; E-retail ; eZee Optimus ; Flipdish ; Flip Office ; Foaps ; Fodista ; ForkPOS ; G5POS ; Geidea ;
  Grafterr / ePOS Hybrid ; Habytet ; Hungerbox-POS ; HungerINC ; I-Dine / Innosolv ; Foodics ; JPOS / Sanguine ;
  Kuber POS (É.-U., Canada) ; Kurve ; Lightspeed (R.-U., É.-U., Irlande) ; LingaPOS (à venir) ; Loyverse (à venir) ;
  LS Retail ; Lucid ; Menew ; Oracle MICROS Symphony Gen 1, Gen 2 et RES 3700 ; Microsystems ; MyGenie ; Mymenu ;
  MyOrderBox ; Agilysys (É.-U., à venir). Toast, Square, TouchBistro, Odoo, SumUp et Revel sont sans doute sur les
  pages suivantes **(à confirmer)**.
- Commandes en ligne (catégorie « Online Ordering ») : App4 (R.-U.), Bitsila (Inde), ChatFood (Émirats, R.-U.), DCA.

### 2.6 Autres intégrations (« plugins »)

| Catégorie | Ce qui est nommé |
|---|---|
| Livreurs et exécution | Adloggs (Inde), Careem Box (Émirats), Nash (R.-U., É.-U.) ; « Live Rider & Courier Alerts ». |
| Paiements | « Payment Reconciliation » (nom seul) ; SumUp parmi les caisses. |
| ERP | Odoo. |
| Comptabilité, fidélité, Google, livraison en marque blanche | **Rien de nommé** sur les pages lues. |
| Avis | Badge G2 sur la page Hub (avis sur eux, pas un module d'avis). |

Le mode « caisse directe » contre « tablette » (article `pos-direct-users`) n'a pas pu être lu (erreur 530)
**(à confirmer)**.

## 3. Comment est faite leur page d'accueil, et ce qu'on a construit

Ordre des sections d'ordermark.com : en-tête (« Schedule a Call », « Get a Free Demo ») → héros « Ordermark has joined
forces with UrbanPiper » (photo de cuisine) → badge DoorDash → compteurs et grille de 26 logos de chaînes → « In the
News » (4 articles) → « Here's How Ordermark Evolved » (écran au centre relié aux logos des plateformes) → « No More
Tablet Hell » (maquette de tablette) → « One Menu, Everywhere » (icône au centre reliée aux plateformes) → quatre blocs
problème / solution → « Product features » (8 crochets + capture) → anneau des plateformes → anneau des caisses →
six témoignages avec photos → appel à une démo → FAQ (5) → « Want to know more? » → pied de page (badges ISO, SOC, RGPD).
**Aucune animation** n'a été observée dans la capture : leur effet « premium » vient des graphiques en étoile, des
maquettes et des logos.

| Section Ordermark | Ce qu'elle fait | Ce qu'on a construit sur `/hub` (sans copier) |
|---|---|---|
| Héros + badge + logos de chaînes | Confiance immédiate | Héros avec un appareil animé : une commande arrive, sonne, s'accepte, part vers Clover et la cuisine. Pas de faux badge ni de faux logo client. |
| Écran au centre relié aux plateformes | « Un seul cerveau » | Section « Un seul cerveau » : schéma SVG animé, trois plateformes → TAKATAK Food Hub → Clover et la cuisine, avec des points qui circulent sur les fils. |
| « No More Tablet Hell » | Le problème n°1 du restaurateur | Carte « Fini la jonglerie entre tablettes » : tablette avec les commandes qui glissent, triées par état. |
| « One Menu, Everywhere » | Le menu maître | Carte « Un menu, partout » : menu maître, un article passe en rupture, trois plateformes cochées. |
| 8 fonctions + capture | Ce que fait le produit | Explorateur cliquable : 8 onglets (Commandes, Cuisine, Menus, Ruptures, Magasins, Argent, Alertes, Équipe), sans JavaScript. |
| Anneaux de partenaires | Étendue des intégrations | Panneau « Branché sur ce que vous utilisez déjà » : chaque plateforme avec son vrai état (Disponible / Certification en cours), Clover, et « Vous utilisez une autre caisse ? Écrivez-nous ». |
| Compteurs | Chiffres-chocs | Bande de quatre faits prouvés par la fiche Clover (1 écran, quelques secondes pour une rupture, chaque paiement vérifié, français et anglais). |
| Témoignages | Preuve sociale | **Pas encore** : il faut de vraies citations de restaurants clients, avec leur accord écrit. |
| FAQ + démo | Lever les objections | FAQ existante + boutons Clover App Market. |

Règles tenues : seulement ce qui est livré aujourd'hui (la fiche du Clover App Market fait foi), aucun chiffre non
prouvé, aucun nom de concurrent, aucune animation qui ne s'arrête pas sous `prefers-reduced-motion`, aucun script de
page. Les commandes affichées sont fictives et marquées comme telles.

## 4. Intégrer d'autres caisses : le plan

### 4.1 Où on en est

Food Hub parle à **une** caisse : Clover (`lib/foodhub/pos/clover-*.ts`). Commande créée avec un type par plateforme,
payée avec un mode de paiement par plateforme à la sortie, impression en cuisine, inventaire importé, rupture Clover →
retirée partout. Le reste (plateformes, menus, argent, Watchtower) ne dépend pas de la caisse.

### 4.2 Le découpage à faire d'abord

Une interface `PosAdapter` (par exemple `lib/foodhub/pos/adapter.ts`) que Clover implémente en premier, sans changer
son comportement :

| Méthode | Clover aujourd'hui |
|---|---|
| `createOrder(order)` → id caisse | `clover-order.ts`, `clover-platform-orders.ts` |
| `markPaid(order, platform)` | mode de paiement par plateforme |
| `cancelOrder(order)` | retrait de la commande annulée |
| `importCatalog()` | import de l'inventaire, des catégories et des options |
| `stockEvents()` (webhook) | rupture → retirée partout (`clover-webhook-gate.ts`) |
| `printKitchen(order)` | imprimante de commandes Clover |
| `connect()` / `disconnect()` | `clover-oauth.ts` |

`verify:foodhub` passe par l'interface ; chaque nouvelle caisse ajoute son faux serveur dans le simulateur.

### 4.3 Quelles caisses, dans quel ordre (restaurants de Montréal)

Les accès aux API ci-dessous viennent de ce qu'on sait de ces éditeurs, **pas** des pages lues : tout est
**(à confirmer)** avant d'écrire du code.

| Ordre | Caisse | Pourquoi | Accès à l'API |
|---|---|---|---|
| 1 | **Square** | API ouverte (commandes, catalogue, inventaire, webhooks, OAuth) ; beaucoup de petits restaurants au Canada. | Compte développeur libre-service, puis l'App Marketplace de Square. |
| 2 | **Lightspeed Restaurant** | Éditeur montréalais, très présent dans les restaurants du Québec ; dans l'anneau d'Ordermark. | Programme de partenaires. |
| 3 | **TouchBistro** | Caisse de restaurant canadienne ; dans l'anneau d'Ordermark. | Programme de partenaires d'intégration. |
| 4 | **Toast** | Présent au Canada ; dans l'anneau d'Ordermark. | Partenaires approuvés seulement. |
| 5 | **Maître'D / Veloce** | Caisses québécoises répandues. | Entente directe ou intégrateur. |
| Sur demande | Revel, Epos Now, SumUp, Odoo, Loyverse | Peu présents au Québec. | Selon l'éditeur. |

Avant d'écrire le code d'une deuxième caisse, une décision du propriétaire : Food Hub est vendu et facturé par le
Clover App Market ; une autre caisse veut dire une autre facturation (Stripe ou la place de marché de cette caisse) et
sa propre fiche.

### 4.4 Ce qu'ils annoncent et que Food Hub n'a pas (encore)

- Plusieurs caisses (section 4).
- Options imbriquées / combos (voir `ATLAS_PARITY.md`, « Not built yet »). Les avis et notes existent déjà
  (`/insights/reviews`, [`../REVIEWS_HUB.md`](../REVIEWS_HUB.md)).
- Témoignages et logos de clients sur la page publique.
- Plateformes hors Canada : hors de notre marché.

Ce que Food Hub a et qu'ils n'annoncent pas sur ces pages : la Watchtower (surveillance et escalade jusqu'à l'appel), le
NIP de gérant pour l'argent et les annulations, le mur des écrans des plateformes qui sonne sur un seul appareil, la
vérification de chaque versement avec la décision laissée au restaurateur, une interface en français et en anglais, un
prix public (essai gratuit de 14 jours, puis 50 $ CA par mois par application, facturé par Clover).

## 5. À lire ensuite (pages nommées mais pas lues)

help.urbanpiper.com (base de connaissances), status.urbanpiper.com, la page 2 des intégrations, les pages Meraki et
Orderline AI, ordermark.com/news.

## 6. Sources lues

| Page | Résultat |
|---|---|
| ordermark.com | lue |
| ordermark.com/pricing | 404 |
| support.ordermark.com et l'article `pos-direct-users` | 530 (hors ligne) |
| urbanpiper.com/us/hub | lue |
| urbanpiper.com/integrations | première page lue |
| Blogue UrbanPiper, rachat d'Ordermark (13 juin 2023) | lu |
| Blogue UrbanPiper, lettre ouverte (20 novembre 2024) | lu |

— signé : Claude (busy-cannon, Claude Code cloud) @ cloud · 2026-10-29 21:25
