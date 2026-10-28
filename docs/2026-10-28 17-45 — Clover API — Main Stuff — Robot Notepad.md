# 2026-10-28 17:45 — Clover API — Main Stuff — Robot Notepad

**Base de données maître des API Clover de TAKATAK** — construite en lisant la documentation développeur Clover (docs.clover.com) au complet, une API à la fois, et en extrayant tout ce qui peut servir, de près ou de loin, à nos applications. Étude et documentation seulement : aucun changement au portail, aucun code modifié, **aucun secret dans ce document**.

**Compte développeur :** 9KJ25ATT15TTW · **Sources principales :** docs.clover.com (pages citées par entrée) + audit plateforme interne du 2026-10-25/26 (`~/workspace/research_notes/clover-dev-plateforme-audit-pos-20261026-0203/report.md`) + packages de soumission `~/workspace/clover-apps/`.

**Doctrine des paliers (Matt, 2026-10-28) — appliquée partout dans la section 2 :**
- **Base — 50 $/mois** : le nécessaire, l'essentiel pour que l'app fasse son travail.
- **Premium — 100 $/mois** : un peu plus d'avantages et de fonctions.
- **VIP — 150 $/mois** : le full kit — tout ce que Clover offre qui fite la catégorie de l'app.
- Chaque app a SES propres Base/Premium/VIP. À la fin, toutes les apps se connectent en **un seul grand système Clover connecté** (section 3).

---

# 1. INVENTAIRE COMPLET DES API ET CAPACITÉS CLOVER

Chaque entrée : nom · ce que ça fait · permission(s) requise(s) · source. Les permissions suivent le modèle Clover : Read/Write par catégorie de données (Customers, Employees, Inventory, Merchant, Orders, Payments) + permission Ecommerce pour le card-not-present.

## 1A. Plateforme, authentification, accès

| # | API / capacité | Ce que ça fait | Permissions | Source |
|---|---|---|---|---|
| 1 | **REST API v3 (noyau)** | API REST JSON sur `api.clover.com` (prod Amérique du Nord) : marchands, inventaire, commandes, paiements, clients, employés. C'est le dos de presque tout. | Read/Write par catégorie selon l'endpoint | https://docs.clover.com/dev/docs/clover-rest-api-index |
| 2 | **OAuth 2.0 — jetons expirants (v2)** | Flux d'autorisation quand un marchand installe une app : code d'autorisation + PKCE (apps « low-trust ») ou flux « high-trust » ; jetons d'accès + de rafraîchissement qui expirent. **Obligatoire en Amérique du Nord depuis le 31 mars 2025** — il faut implémenter la rotation du refresh token dès le jour 1. | Aucune (c'est le mécanisme d'accès) | https://docs.clover.com/dev/docs/oauth-flow-for-low-trust-apps-pkce · https://docs.clover.com/dev/docs/expiring-tokens-required-in-all-regions |
| 3 | **Jetons API (API tokens)** | En sandbox : jetons de test propres à un marchand pour appeler le REST sans OAuth. En production : jetons API marchand (usage limité, pas un substitut à OAuth pour les apps publiques). | Aucune (émis par le marchand/dev) | https://docs.clover.com/dev/docs/clover-rest-api-index |
| 4 | **Modèle de permissions d'app** | Chaque app déclare ses Read/Write par catégorie, avec justification obligatoire examinée par DevRel à l'approbation. Le plan Clover du marchand (ex. Payments Plus) peut bloquer certaines catégories (pas d'Items/Orders). Changer une permission après installation = désinstaller/réinstaller. | — | https://docs.clover.com/dev/docs/gdp-set-app-permissions |
| 5 | **Types d'apps et approbation** | Apps Android natives, apps web (REST, Site URL, CORS), apps semi-intégrées, apps privées (lien direct, non listées), apps de paiement. Revue d'approbation : vidéo + description, permissions, APK, config REST, webhooks, légaux (politique de confidentialité + conditions exigées). **Les apps privées ne sont PAS facturables via la facturation App Market** (prix discuté à la revue initiale) et doivent utiliser OAuth + Alternate Launch Path. | — | https://docs.clover.com/dev/docs/gdp-create-new-app · https://docs.clover.com/dev/docs/gdp-work-with-private-apps · https://docs.clover.com/dev/docs/developer-app-approval-archive |
| 6 | **Environnements et URL de base** | Sandbox `apisandbox.dev.clover.com` / prod NA `api.clover.com`, EU `api.eu.clover.com`, LA `api.la.clover.com`. Une app sandbox doit être **recréée** en production (les permissions ne suivent pas). Global Developer Dashboard = compte unique avec bascule sandbox/production. | — | https://docs.clover.com/dev/docs/clover-environments · https://docs.clover.com/dev/docs/basic-app-configuration |
| 7 | **Mécanique REST (filtres, tri, pagination, expansion)** | Filtres `field=value`, tri, pagination par limite/offset, champs extensibles (`expand=`), associations d'objets, timestamps Unix en millisecondes, limites de débit par app/marchand. C'est la grammaire commune de tous nos appels. | Selon l'endpoint | https://docs.clover.com/dev/docs/clover-rest-api-index |

## 1B. Marchand

| # | API / capacité | Ce que ça fait | Permissions | Source |
|---|---|---|---|---|
| 8 | **Profil marchand, propriétés, adresse** | Lire/mettre à jour les infos du marchand : nom, adresse, courriel de soutien, propriétés (dont les réglages qui pilotent les autres surfaces). | Read merchant / Write merchant | https://docs.clover.com/dev/docs/gdp-set-app-permissions |
| 9 | **Types de commande (Order Types)** | Classifications marchand : sur place, ramassage, livraison, en ligne… avec taxable, défaut/caché, montants min/max, rayon de livraison max, heures, catégories filtrées. Chaque canal de nos apps devrait avoir son type. | Read merchant / Write merchant (ex. supprimer un type = Write merchant) | https://docs.clover.com/dev/docs/working-with-orders · https://docs.clover.com/dev/reference/merchantupdateordertype |
| 10 | **Suggestions de pourboire (Tip Suggestions)** | Lire les suggestions de pourboire configurées du marchand (montants/% affichés à l'écran de paiement). | Read merchant | https://docs.clover.com/dev/docs/gdp-set-app-permissions |
| 11 | **Heures d'ouverture / heures de service** | Heures du marchand par type de service ; les changements émettent des événements webhook `SH`. Alimente les fiches publiques (On2GO) et les règles d'acceptation (Food Hub, Phone AI). | Read merchant | https://docs.clover.com/dev/docs/webhooks |

## 1C. Inventaire (le menu)

| # | API / capacité | Ce que ça fait | Permissions | Source |
|---|---|---|---|---|
| 12 | **Items** | CRUD complet des articles : prix (centimes), prix par type, SKU/UPC, coût, `taxRates`, `categories`, `modifierGroups`, `itemStock`, `options`, restrictions d'âge. Lecture + écriture — c'est le menu maître de toutes nos apps. | Read inventory / Write inventory | https://docs.clover.com/dev/reference/inventorycreateitem · https://docs.clover.com/dev/docs/working-with-inventory |
| 13 | **Catégories** | CRUD des catégories et de leur contenu (nombre d'articles, association items↔catégories). | Read inventory / Write inventory | https://docs.clover.com/dev/docs/gdp-set-app-permissions |
| 14 | **Groupes d'articles (Item Groups)** | Regrouper des variantes d'un même produit (grandeurs/formats) sous un groupe avec attributs partagés. | Read inventory / Write inventory | https://docs.clover.com/dev/docs/working-with-inventory |
| 15 | **Attributs et options** | Attributs (ex. grandeur, cuisson) et leurs options, rattachés aux groupes d'articles — la mécanique « variantes » du menu. | Read inventory / Write inventory | https://docs.clover.com/dev/reference/inventorycreateitem |
| 16 | **Groupes de modificateurs** | CRUD des groupes d'options (min/max, requis/optionnel) rattachés aux items. | Read inventory / Write inventory | https://docs.clover.com/dev/docs/gdp-set-app-permissions |
| 17 | **Modificateurs + disponibilité** | CRUD des modificateurs individuels ; un drapeau booléen `available` permet de retirer un modificateur de la vente (mécanique « 86 » au niveau modificateur). Aucun compteur de stock (voir Lacunes). | Read inventory / Write inventory | https://docs.clover.com/dev/docs/manage-item-modifiers-availability |
| 18 | **Étiquettes (Tags)** | Étiquettes libres sur les items pour regroupements transversaux (ex. « vedette », « épicé ») utilisables par nos propres écrans. | Read inventory / Write inventory | https://docs.clover.com/dev/reference/inventorycreateitem |
| 19 | **Rabais d'inventaire (Discounts)** | Rabais personnalisés définis au niveau du marchand/inventaire, lisibles par l'API et applicables aux commandes. | Read inventory / Write inventory | https://docs.clover.com/dev/docs/gdp-set-app-permissions |
| 20 | **Taux de taxe (Tax Rates)** | Taux arbitraires par item (tableau `taxRates`) ; le marchand configure ses taux dans Setup > Taxes & Fees. Aucun moteur fiscal canadien (voir Lacunes) : notre modèle = TPS 5 % + TVQ 9,975 % en deux taux distincts. | Read inventory / Write inventory | https://docs.clover.com/dev/docs/ecommerce-accepting-payments (modèle de taxes) |
| 21 | **Stock d'articles (Item Stock)** | Compteur de stock sur les **items** (pas sur les modificateurs) : lecture/écriture du `stockCount` via `itemStock`. Base de nos alertes de rupture au niveau article. | Read inventory / Write inventory | https://docs.clover.com/dev/reference/inventorycreateitem · https://docs.clover.com/dev/docs/working-with-inventory |
| 22 | **Import / mise à jour en masse (Bulk)** | Import d'inventaire en lot et mises à jour groupées (avec des limites serveur annoncées en 2026 pour les lignes et les bulk updates). Sert au clonage de menus entre succursales. | Write inventory | https://docs.clover.com/dev/docs/working-with-inventory |

## 1D. Commandes

| # | API / capacité | Ce que ça fait | Permissions | Source |
|---|---|---|---|---|
| 23 | **Commandes (Orders)** | CRUD des commandes : états ouvert/fermé/annulé, lecture avec expansions (clients, lignes, paiements). La commande Clover est notre **commande de référence unique** pour tous les canaux. | Read orders / Write orders | https://docs.clover.com/dev/docs/working-with-orders |
| 24 | **Commandes atomiques (Atomic Orders)** | Un seul appel construit le panier complet (lignes, modificateurs, rabais, frais de service, items ad hoc ou hors Clover) et calcule totaux et taxes en temps réel ; supporte en magasin et en ligne. LE chemin pour injecter une commande externe (téléphone, plateforme) proprement. | Write orders | https://docs.clover.com/dev/docs/create-an-atomic-order |
| 25 | **Lignes de commande (Line Items)** | Ajouter/modifier/retirer des lignes, modificateurs par ligne, rabais par ligne, référence `printGroup` pour le routage d'impression. | Read orders / Write orders | https://docs.clover.com/dev/docs/working-with-orders |
| 26 | **Frais de service multiples (MSC)** | Jusqu'à **3 frais de service** configurés par le marchand, applicables/retirés par les apps. **Les apps ne peuvent pas les créer** ; pas de frais basés sur un tarif ni taxables dans la version initiale. | Write orders (appliquer) ; création = marchand seulement | https://docs.clover.com/dev/docs/msc-overview |
| 27 | **Événements d'impression (Print Events)** | `POST /v3/merchants/{mId}/print_event` avec l'UUID de commande : imprime le reçu/commande selon les options du marchand. Groupes d'impression et étiquettes d'imprimantes = configuration marchand/appareil. | Write orders | https://docs.clover.com/dev/changelog/clover-platform-api-updates-july-2021 · https://docs.clover.com/dev/docs/working-with-orders |
| 28 | **Clover Online Ordering (natif)** | Canal de commande en ligne de Clover (Canada confirmé, sans commission ni abonnement additionnel selon la page Canada, avec un plan Counter/Table Service admissible) : les commandes entrent comme des commandes Clover et partent en cuisine. | Natif (pas une permission d'app) ; visible via Read orders + webhooks | Page Clover Online Ordering Canada, résumée dans l'audit interne 2026-10-25, §6 |
| 29 | **Affichage cuisine (Clover KDS, natif)** | KDS de Clover : reçoit les commandes du POS et de la commande en ligne, routage par article, mode expo, rapports de temps de préparation. **Aucune API KDS publique** : on l'alimente en créant des commandes correctes (groupes d'impression/types). | Natif ; alimenté via Write orders | Audit interne 2026-10-25, §3 (description du produit KDS) |

## 1E. Paiements — REST et Ecommerce

| # | API / capacité | Ce que ça fait | Permissions | Source |
|---|---|---|---|---|
| 30 | **Paiements v3 (lecture/écriture de dossiers)** | Lire les paiements d'une commande ou d'un marchand, remboursements, crédits, annulations liées. ⚠️ Règle : sans filtre de dates, `GetPayments` est restreint à une fenêtre de **90 jours** — nos rapports doivent paginer par plages de dates. | Read payments / Write payments | https://docs.clover.com/dev/docs/gdp-set-app-permissions · https://docs.clover.com/dev/changelog/clover-api-updates-february-2025 |
| 31 | **Ecommerce — Charges** | Créer une charge carte (card-not-present), autoriser puis capturer (`capture`), payer une commande. Base URL service : `scl.clover.com` (prod). | Ecommerce (permission d'app Ecommerce + clés ou OAuth) | https://docs.clover.com/dev/docs/ecommerce-api-tutorials · https://docs.clover.com/dev/docs/ecomm-check-and-use-gift-card-balance |
| 32 | **Tokenisation (Tokenization Service)** | Transformer un numéro de carte en jeton `clv_…` réutilisable, via l'iframe hébergé ou les clés PAKMS (publique/privée). Service : `token.clover.com` (prod). Aucun numéro de carte ne touche nos serveurs. | Ecommerce (clé publique pour tokeniser) | https://docs.clover.com/dev/docs/ecommerce-api-tutorials · https://docs.clover.com/dev/docs/create-a-gift-card-token (même service de jetons) |
| 33 | **Iframe hébergé / Hosted Checkout** | Champ de carte hébergé par Clover (iframe) et pages de paiement hébergées ; locales supportées : `en-US`, `en-CA`, **`fr-CA`** — critique pour le Québec. | Ecommerce | https://docs.clover.com/dev/docs/using-the-clover-hosted-iframe |
| 34 | **Ecommerce — Customers (cartes au dossier)** | Créer des clients Ecommerce avec cartes tokenisées pour paiements futurs (card on file, avec consentement du titulaire). ⚠️ Interac ne peut pas être « vaulté » au Canada (voir Lacunes). | Ecommerce | https://docs.clover.com/dev/docs/ecommerce-api-tutorials |
| 35 | **Ecommerce — Refunds** | Rembourser des charges complétées (total ou partiel selon le flux). | Ecommerce | https://docs.clover.com/dev/docs/ecommerce-api-tutorials |
| 36 | **Ecommerce — Orders (payer une commande)** | Créer/récupérer des commandes Ecommerce et les payer, pourboire inclus (« pay for an order » charge le total et peut inclure le pourboire). | Ecommerce | https://docs.clover.com/dev/docs/ecommerce-api-tutorials · https://docs.clover.com/dev/docs/create-an-atomic-order |
| 37 | **API Cartes-cadeaux (Gift Card API, Ecommerce)** | Activer (physique ou virtuelle), consulter le solde, échanger (partiel accepté), recharger, « cash out », rembourser/annuler une transaction cadeau ; multi-verrouillage (pré-autorisation d'un montant) ; les cartes Clover n'expirent pas et sont rechargeables. Exige que le marchand soit inscrit aux plans Clover Gift Cards. | Ecommerce | https://docs.clover.com/dev/docs/gift-card-api · https://docs.clover.com/dev/docs/ecomm-activate-a-gift-card · https://docs.clover.com/dev/docs/ecomm-redeem-gift-card |
| 38 | **Pourboires (surfaces)** | Suggestions du marchand (#10), `TipOptions` dans les constructeurs de paiement Android/REST Pay (pourboire à l'écran, avant autorisation), pourboire dans le « pay for an order » Ecommerce. ⚠️ `tipAdjustAuth()` (ajustement après autorisation) **non supporté pour Interac**. | Read merchant (suggestions) ; flux de paiement | Audit interne 2026-10-25, §4 · https://docs.clover.com/dev/docs/region-specific-features |
| 39 | **Modes de paiement personnalisés (Custom Tenders)** | Créer des tenders maison (ex. « carte-cadeau maison », « compte client ») utilisables à la caisse ; paiements partiels possibles selon le plan (les plans type Payments Plus/Mini = paiement complet seulement via tender personnalisé). | Write payments (flux tender) | https://docs.clover.com/dev/docs/creating-custom-tender-apps |
| 40 | **Surtaxes, débit NIP, EBT (configurations)** | Support des surcharges, du débit avec NIP et de l'EBT (ce dernier exige un entitlement configuré par DevRel en sandbox et en production). Niche, mais documenté — utile si un client le demande. | Configuration + flux de paiement | https://docs.clover.com/dev/docs/faqs |
| 41 | **Interac (Canada) — règles du flux** | Interac supporté, CAD seulement. **Non supportés : auth/pré-auth, `tipAdjustAuth()`, vault de carte, paiements hors ligne ; remboursement/annulation = carte insérée ; fermeture de lot manuelle non supportée (automatique).** Ce sont des règles de plateforme à encoder dans nos apps, pas une API. | — | https://docs.clover.com/dev/docs/region-specific-features |

## 1F. Clients

| # | API / capacité | Ce que ça fait | Permissions | Source |
|---|---|---|---|---|
| 42 | **Customers API v3** | CRUD des clients du marchand : nom, courriels, téléphones, adresses, métadonnées ; relier un client à ses commandes. **La clé téléphone de notre système maître vit ici.** | Read customers / Write customers | https://docs.clover.com/dev/docs/gdp-set-app-permissions |
| 43 | **Données fournies par le client pendant le paiement** | Pendant un paiement Remote Pay, l'appareil peut demander au client des données (ex. numéro de téléphone pour la fidélité) via `registerForCustomerProvidedData` — le seul « crochet fidélité » natif côté paiement. | Flux Remote Pay (pas une permission REST) | Audit interne 2026-10-25, §4/§8 |
| 44 | **Clover Rewards / Promos (natif, sans API)** | Programme de points/coups de poing natif de Clover avec recherche par téléphone à la caisse. **Aucun endpoint développeur pour les soldes de points** (voir Lacunes) : nos apps ne voient que le rabais résultant sur la commande. | Natif | Audit interne 2026-10-25, §8 · https://docs.clover.com/dev/docs/gdp-set-app-permissions |

## 1G. Employés et caisse (cash)

| # | API / capacité | Ce que ça fait | Permissions | Source |
|---|---|---|---|---|
| 45 | **Employés et rôles** | CRUD des employés, rôles et droits ; savoir qui a créé une commande/un paiement. Base de nos contrôles d'autorisation (le NIP gérant se vérifie contre ces dossiers — voir Lacunes). | Read employees / Write employees | https://docs.clover.com/dev/docs/gdp-set-app-permissions |
| 46 | **Quarts de travail (Shifts)** | Lire/créer les quarts d'un employé (`/employees/{empId}/shifts`) — données de présence brutes pour la paie et les coûts de main-d'œuvre. C'est un « shifts » d'horloge simple, pas un planificateur d'horaires complet. | Read employees / Write employees | https://docs.clover.com/dev/docs/gdp-set-app-permissions |
| 47 | **Événements de caisse (Cash Events)** | Journal des événements d'argent comptant (ouvertures, retraits, ajouts) par employé ou par appareil ; les événements émettent aussi des webhooks `CA`. | Read merchant (événements via webhooks `CA`) ; lecture REST du journal | https://docs.clover.com/dev/docs/webhooks |

## 1H. Appareils et SDK Android / Remote Pay

| # | API / capacité | Ce que ça fait | Permissions | Source |
|---|---|---|---|---|
| 48 | **Connecteurs Android SDK** | Sur l'appareil : `OrderConnector`, `InventoryConnector`, `CustomerConnector`, `MerchantConnector`, `EmployeeConnector`… — accès local complet (commandes, inventaire, clients) pour les apps natives Station/Flex/Mini/Kiosk. Les apps Android obtiennent leur jeton via le SDK. | Permissions d'app (déclarées) | https://docs.clover.com/dev/docs/gdp-set-app-permissions |
| 49 | **Android Payments API** | API par intents (constructeurs) pour paiements, pré-autorisations et renversements (void/refund) depuis une app sur l'appareil. **Destinée à remplacer `PaymentConnector`** et supporte plus de configurations. | Permissions d'app + flux paiement | https://docs.clover.com/dev/docs/clover-development-basics-semi |
| 50 | **PaymentConnector (hérité)** | Interface Java historique pour vendre, rembourser et autres fonctions de paiement depuis une app POS sur l'appareil. Toujours supportée ; les nouveaux builds devraient viser #49. | Permissions d'app | https://docs.clover.com/dev/docs/clover-development-basics-semi |
| 51 | **Remote Pay SDKs / CloverConnector** | SDK externes (Android, iOS, JavaScript, .NET) pour piloter un appareil Clover depuis un POS externe : paiements, reçus personnalisés, activités sur l'appareil. Chaque intégration passe un **Remote App ID (RAID)**. | OAuth marchand (Merchant Read minimum selon le flux) | https://docs.clover.com/dev/docs/clover-development-basics-semi · https://docs.clover.com/dev/docs/faqs |
| 52 | **REST Pay Display API** | API REST/WebSocket pour semi-intégrés : un POS quelconque (HTTP) fait payer un Flex/Mini/Compact via l'app **REST Pay Display** (réseau local) ou **Cloud Pay Display** (nuage Clover) ; il existe aussi Secure Network Pay Display et USB Pay Display. Compatible jetons Clover + Ecommerce (omni-canal), approbation simplifiée, **sans limite de débit** (synchrone). Tokenisation à l'appareil : `POST /connect/v2/card/tokens` (consentement du client affiché). ⚠️ Les apps semi-intégrées ne sont pas sur le App Market public. | OAuth marchand ; Merchant Read minimum pour l'app web associée | https://docs.clover.com/dev/docs/rest-pay-intro · https://docs.clover.com/dev/docs/pay-display-apps · https://docs.clover.com/dev/docs/card-on-file-compliance-for-rest-pay-display |
| 53 | **Clover Go SDK** | Intégration iOS/Android avec les lecteurs Clover Go (mobile, paiements présents et saisie manuelle). ⚠️ La documentation trouvée est intitulée « United States » — disponibilité Canada **non confirmée** (voir Lacunes). | Permissions d'app | https://docs.clover.com/dev/docs/clover-go-sdk |
| 54 | **Mode kiosque (Clover Kiosk)** | Sur le Kiosk : notre app contrôle l'écran de commande 23,8″, un Mini 8″ roule les paiements ; plein écran obligatoire via `CustomerMode`, déverrouillage sécurisé via `Lockscreen` (exige Employee Read), démarrage automatique après redémarrage nocturne (`BOOT_COMPLETED`), `keepScreenOn`, paiements via `KioskPayRequestIntentBuilder`. **Paiements partiels non supportés nativement au kiosque.** Tests sur matériel réel = coordination avec Clover (sandbox et production). | Employee Read (déverrouillage) + permissions d'app | https://docs.clover.com/dev/docs/clover-development-basics-android |
| 55 | **Imprimantes (périphériques)** | Impression de reçus et de billets de cuisine depuis les apps (connecteurs d'impression Android, événements d'impression REST #27) ; routage par groupes d'impression configurés chez le marchand. | Write orders (événements) / SDK | https://docs.clover.com/dev/docs/working-with-orders |
| 56 | **Tiroir-caisse** | Ouverture du tiroir via Remote Pay (`openCashDrawer()`) et les API périphériques Android. Le calcul de la monnaie à rendre n'existe pas en API (voir Lacunes) — c'est l'arithmétique de notre UI. | SDK / Remote Pay | Audit interne 2026-10-25, §4 |
| 57 | **Lecture de codes-barres** | Caméra des appareils (Flex : caméra 5 MP avec décodage 1D/2D) et périphériques de scan ; sert au scan de cartes-cadeaux, coupons QR et SKU à la caisse/borne. | SDK appareil | https://docs.clover.com/dev/docs/available-now-clover-flex-4-for-us-merchants |
| 58 | **Notifications et affichage sur l'appareil** | Messages/notifications poussés aux appareils Clover par nos apps Android (alertes cuisine, statut), et écrans clients pilotés pendant le paiement (données client #43). | SDK Android | Audit interne 2026-10-25, §4 (surface Loyalty/notifications Remote Pay) |
| 59 | **Apps WebView + Alternate Launch Path** | Une app web peut être enveloppée en WebView Android ; le jeton d'accès s'obtient du SDK Clover. L'Alternate Launch Path est exigé pour les apps privées. Contrainte plateforme : **aucun Google Mobile Services / Play Store sur les appareils** (pas de Firebase) ; Java/Kotlin recommandés, français parmi les langues recommandées. | Permissions d'app | https://docs.clover.com/dev/docs/oauth-for-web-views-non-clover-devices · https://docs.clover.com/dev/docs/clover-development-basics-android |

## 1I. Webhooks

| # | API / capacité | Ce que ça fait | Permissions | Source |
|---|---|---|---|---|
| 60 | **Webhooks (plateforme)** | URL configurée par app dans App Settings ; Clover POSTe des **notifications d'événements** (type + ID d'objet + marchand + horodatage) — pas les objets complets : on va chercher l'objet en REST après l'événement. Poignée de main de vérification à la configuration. Retirés à la désinstallation, à re-souscrire à la réinstallation. ⚠️ Veille : changements annoncés en 2026 aux webhooks d'inventaire — consommer derrière un adaptateur. | Read de la catégorie de l'événement (voir tableau) | https://docs.clover.com/dev/docs/webhooks · https://docs.clover.com/dev/docs/gdp-create-new-app |

**Types d'événements webhook (12) :**

| Clé | Type | Déclencheur | Permission |
|---|---|---|---|
| `A` | Apps | App installée, désinstallée, ou abonnement modifié | Read merchant |
| `C` | Customers | Client créé, modifié ou supprimé | Read customers |
| `CA` | Cash adjustments | Événement du journal de caisse | Read merchant |
| `E` | Employees | Employé créé, modifié ou supprimé | Read employees |
| `I` | Inventory | Article créé, modifié ou supprimé | Read inventory |
| `IC` | Inventory category | Catégorie créée, modifiée ou supprimée | Read inventory |
| `IG` | Inventory modifier group | Groupe de modificateurs créé, modifié ou supprimé | Read inventory |
| `IM` | Inventory modifier | Modificateur créé, modifié ou supprimé | Read inventory |
| `O` | Orders | Commande créée, modifiée ou supprimée | Read orders |
| `M` | Merchants | Propriété du marchand modifiée ou nouveau marchand ajouté | Read merchant |
| `P` | Payments | Paiement créé ou mis à jour | Read payments |
| `SH` | Service hour | Heure de service créée, modifiée ou supprimée | Read merchant |

Source du tableau : https://docs.clover.com/dev/docs/webhooks

## 1J. App Market et facturation développeur

| # | API / capacité | Ce que ça fait | Permissions | Source |
|---|---|---|---|---|
| 61 | **Paliers d'abonnement (Subscription Tiers)** | Prix mensuel par pays/devise par palier (nom + description + prix ; 0,00 = gratuit). C'est LE mécanisme qui porte nos Base/Premium/VIP **pour les apps publiques**. | — | https://docs.clover.com/dev/docs/gdp-set-up-pricing-tiers |
| 62 | **Paliers mesurés (Metered Tiers)** | Prix par événement/action (nom de l'événement + prix par pays) — ex. par commande injectée, par minute d'appel, par carte activée. Combinable avec l'abonnement. | — | https://docs.clover.com/dev/docs/gdp-set-up-pricing-tiers |
| 63 | **Règles de facturation App Market** | Tous les frais d'une app publique doivent être perçus via l'App Market (abonnement récurrent, par action, combinaison, ou gratuit). **Le développeur reçoit 70 % du revenu net d'abonnement.** L'accord développeur contient une partie dédiée aux termes App Market **Canada**. Rappel : apps privées = pas de facturation App Market (#5). | — | https://docs.clover.com/dev/docs/home · https://sandbox.dev.clover.com/developer-agreement |
| 64 | **Mesures d'installation et de revenus** | Le tableau développeur offre des mesures d'installation et de revenus prêtes à l'emploi ; les événements webhook `A` donnent en plus le signal brut (install/désinstall/changement d'abonnement) dans nos propres systèmes. | Read merchant (événements `A`) | https://docs.clover.com/dev/docs/webhooks |

## 1K. Canaux et surfaces natives utiles

| # | API / capacité | Ce que ça fait | Permissions | Source |
|---|---|---|---|---|
| 65 | **Agrégateurs de livraison (route partenaire)** | Aucun connecteur natif Uber Eats/DoorDash dans Clover : les commandes tierces entrent via des partenaires App Market (ItsaCheckmate/Chowly, Deliverect, Cuboh…) qui écrivent des commandes Clover — donc visibles via Orders API + webhooks. **SkipTheDishes : aucun connecteur natif ni partenaire Clover confirmé** (voir Lacunes). | Read orders (pour voir les commandes injectées) | Audit interne 2026-10-25, §6 |
| 66 | **Terminal virtuel (natif)** | Surface web de Clover pour paiements saisis au clavier — le chemin de paiement d'un centre d'appels humain qui n'écrit pas de code de paiement (utilisé sous notre hub téléphonique). | Natif marchand | Audit interne 2026-10-25, §7 |
| 67 | **Rapports et règlement (natif + REST)** | Il n'existe pas d'API « reporting » générale : les rapports se construisent en tirant Orders/Payments en REST (fenêtre 90 jours, #30). L'app Rapports native reste la surface du marchand. Au Canada, la fermeture de lot est **automatique** (manuelle non supportée). | Read orders / Read payments | Audit interne 2026-10-25, §4 · https://docs.clover.com/dev/docs/region-specific-features |

**Total de l'inventaire : 67 entrées API/capacités + 12 types d'événements webhook.**

---

# 2. MAPPING PAR APPLICATION + PALIERS (Base 50 $ · Premium 100 $ · VIP 150 $)

Lecture : pour chaque app — son travail réel (d'après son package de soumission local quand il existe), son jumeau sandbox, puis ses trois paliers construits **uniquement** à partir de l'inventaire de la section 1 (les chiffres renvoient aux entrées #). Prix = par mois, facturés via les paliers d'abonnement App Market (#61), événements mesurés possibles via #62 là où c'est noté.

## 2.1 TAKATAK Food Hub — 629HFYHNVMZYR — **EN RÉVISION (mapping seulement, on ne touche à rien)**
**Travail :** système d'exploitation de commandes multi-plateformes : Uber Eats, DoorDash, SkipTheDishes, Too Good To Go → commandes Clover imprimées en cuisine ; menu maître Clover publié vers les plateformes ; synchro des ruptures (86), pauses, heures, états ; rapprochement paiements/versements. (Package : `food-hub/`.)
**Jumeaux sandbox :** Food Hub DAMMKBC3F5T3R · MONTRÉAL FOOD HUB AF6CWMT2GPD2J · ON2GO FOOD HUB 9M7ANK3H73XV4.
**Permissions cœur :** Orders R/W, Inventory R/W, Payments R, Customers R/W, Merchant R, Employees R.

- **Base 50 $** — le nécessaire : réception des commandes des plateformes connectées comme commandes Clover (#23, #24, #65) avec type de commande par canal (#9) ; impression cuisine (#27) et KDS natif alimenté (#29) ; menu maître lu depuis l'inventaire (#12–#17) ; webhooks commandes/paiements (#60, `O`/`P`) pour le suivi d'état.
- **Premium 100 $** — plus d'avantages : publication du menu maître vers les plateformes et synchro bidirectionnelle des ruptures au niveau item **et** modificateur (#17, #21, webhooks `I`/`IM`) ; pauses de magasin et heures synchronisées (#11, `SH`) ; état de préparation et historique des statuts ; rapprochement de base paiements/versements (#30, #67).
- **VIP 150 $** — full kit : tout Premium + multi-marques et multi-succursales sur un même dos d'événements (#60 toutes clés) ; Watchtower d'exceptions (commande sans paiement, écart de versement) bâti sur #30/#67 par plages de dates ; throttling/acceptation intelligente dans notre hub (contournement de la Lacune L6) ; frais de service par canal (#26) ; alimentation directe de 4CCOUNTING et TR4CKER (section 4) ; événements mesurés possibles par commande injectée (#62) en option.

## 2.2 TAKATAK Phone AI — 20FK28P20HJC6 — **EN RÉVISION (mapping seulement)**
**Travail :** assistant téléphonique IA (FR québécois/EN/ES) qui répond, prend la commande sur le menu en direct, confirme le total, crée la commande dans Clover, imprime en cuisine, envoie un lien de paiement par texto. (Package : `voice/` — « TAKATAK Voice ».)
**Jumeau sandbox :** Voice 743YNWB6ZHVMC.
**Permissions cœur :** Inventory R, Orders R/W, Customers R/W, Merchant R, Payments R ; Ecommerce pour le lien de paiement.
**Fait plateforme :** Clover n'a **aucune API téléphonie** (Lacune L1) — l'IA vocale vit chez nous/le fournisseur voix ; Clover reçoit la commande finie.

- **Base 50 $** — le nécessaire : commandes téléphoniques injectées en commandes atomiques (#24) avec type « Téléphone » (#9) ; menu lu en direct (#12–#17) donc jamais de prix périmé ; impression cuisine (#27) ; lien de paiement hébergé fr-CA (#33) ou charge Ecommerce (#31) ; client créé/retrouvé par téléphone (#42).
- **Premium 100 $** — plus : upsells configurés (Duo/Trio/Combo lus dans les modificateurs, #16) ; détection des articles épuisés en temps réel (#17, #21, webhooks `I`) ; routage IVR + messagerie vocale ; historique d'appels rattaché au client (#42) ; pourboire au paiement par lien (#38).
- **VIP 150 $** — full kit : tout Premium + connaissances complètes du marchand (heures #11, zone de livraison via types de commande #9, règles d'alcool par restrictions d'âge sur items #12) ; transfert humain avec contexte ; centre d'appels humain sur Terminal virtuel (#66) en débordement ; minutes mesurées au palier #62 si on facture à l'usage ; alimentation LOY4LTY (points sur commandes téléphone, section 4).

## 2.3 4CCOUNTING by TAKATAK — VQTZE8C31D8MW — brouillon
**Travail :** comptabilité du marchand Clover : ventes, taxes TPS/TVQ, pourboires, modes de paiement, passif cartes-cadeaux (REW4RDS), coûts de main-d'œuvre (ST4FF) — exports et rapprochements prêts pour le comptable. Alimenté par REW4RDS et ST4FF d'après leurs packages.
**Permissions cœur :** Orders R, Payments R, Merchant R, Employees R, Inventory R.

- **Base 50 $** — le nécessaire : rapport de fin de journée depuis Orders/Payments (#23, #30 — pagination par plages à cause de la règle 90 jours) ventilé par taux de taxe (#20 : TPS 5 % / TVQ 9,975 % séparés) ; modes de paiement et pourboires (#38) ; export CSV.
- **Premium 100 $** — plus : rapprochement versements vs ventes avec écarts signalés (#67) ; passif cartes-cadeaux REW4RDS intégré ; coûts de main-d'œuvre depuis les quarts ST4FF (#46) ; multi-succursales consolidé ; événements de caisse (#47) dans le rapprochement.
- **VIP 150 $** — full kit : tout Premium + capture fiscale complète style MEV (chaque vente reconstituée : articles, taxes, pourboire, tender, appareil, opérateur — flux vers MEV.QUEBEC, voir 2.15) ; écritures prêtes à importer (modèles comptables) ; alertes d'anomalies en continu via webhooks `P`/`O`/`CA` (#60) ; historique illimité reconstruit par plages de dates.

## 2.4 C4ISSE by TAKATAK — VDV7XAH5TPB78 — brouillon
**Travail :** notre couche caisse (register) qui **coexiste** avec le Register Clover (le remplacer est impossible — Lacune L8) : écran de vente rapide pour le comptoir, bâti sur le SDK Android et les connecteurs sur appareil.
**Permissions cœur :** Orders R/W, Inventory R, Payments W (flux), Customers R/W, Employees R, Merchant R.

- **Base 50 $** — le nécessaire : vente au comptoir via connecteurs Android (#48) et Android Payments API (#49) ; panier sur le vrai menu (#12–#17) ; tenders natifs + comptant, ouverture du tiroir (#56) ; impression des reçus (#55).
- **Premium 100 $** — plus : photos d'articles depuis notre CDN (contournement L4 — c'est la matière de Picture Register, 2.13) ; recherche client par téléphone et rattachement (#42) ; rabais et frais de service (#19, #26) ; modes de paiement personnalisés (#39 : carte-cadeau maison REW4RDS, compte client).
- **VIP 150 $** — full kit : tout Premium + contrôle gérant maison (NIP vérifié contre #45, journalisé — contournement L12) ; tenue de caisse complète (événements #47, fermeture auto Canada #67) ; mode hors-ligne **de consultation seulement** (les paiements hors ligne sont interdits au Canada, #41) ; écrans clients pilotés (#58) avec saisie fidélité (#43).

## 2.5 CH4T by TAKATAK — RGE4PFGC9SR7C — brouillon
**Travail :** messagerie et soutien client de la suite (spec seulement à ce stade : soutien WhatsApp en spec, réponses IA fermées tant que Pierre n'accorde pas d'exception — décision consignée). Côté Clover : le contexte client/commande dans la conversation.
**Permissions cœur :** Customers R, Orders R, Merchant R.

- **Base 50 $** — le nécessaire : fil de soutien par client reconnu par téléphone (#42) ; voir la dernière commande du client dans la conversation (#23) ; réponses modèles humaines (aucune automatisation IA tant que l'exception n'est pas accordée).
- **Premium 100 $** — plus : historique complet des commandes du client (#23, #30) ; notifications d'état de commande au client alimentées par webhooks `O` (#60) ; transfert ticket vers un humain avec contexte complet.
- **VIP 150 $** — full kit : tout Premium + branchement TR4CKER (lien de suivi en direct dans le fil) et LOY4LTY/REW4RDS (solde points et carte-cadeau visibles, #42 + registre maison) ; si Matt/Pierre ouvrent l'exception : réponses IA avec garde-fous (jamais de prix/menu inventé — base GitHub seulement).

## 2.6 LOY4LTY by TAKATAK — WX0Y6313JX1TY — brouillon
**Travail :** fidélité par numéro de téléphone : inscription automatique à la première utilisation, points crédités après paiement confirmé, échange = rabais sur la commande ; règles configurables (défaut décidé : **1 point par dollar**). (Package : `loyalty/` — « TAKATAK Fidélité ».)
**Jumeau sandbox :** Fidélité X41V082SRCG4G.
**Permissions cœur :** Customers R/W, Orders R/W (rabais d'échange), Payments R, Merchant R.
**Fait plateforme :** aucun API de points (Lacune L2) — le registre de points vit chez nous, clé = téléphone.

- **Base 50 $** — le nécessaire : inscription par téléphone (#42) ; accumulation automatique sur paiement confirmé (webhooks `P`/`O`, #60) ; solde consultable par téléphone ; échange en rabais appliqué à la commande avant paiement (#23 Write orders — exactement le cas d'usage que Clover documente pour les apps de fidélité).
- **Premium 100 $** — plus : saisie du téléphone **pendant** le paiement à l'appareil (#43) et à la borne (T4CTILE) ; règles avancées (seuil, valeur du point, expiration optionnelle) ; rapports membres/points émis/échangés (#67) ; solde partagé entre succursales.
- **VIP 150 $** — full kit : tout Premium + campagnes de points (double points, bonus par catégorie via #13/#18) pilotées avec M4RKETING ; reconnaissance du même client sur tous les canaux (comptoir, borne, téléphone IA, en ligne) via le dos d'événements commun ; paliers de membres ; arrimage REW4RDS (points ↔ cartes-cadeaux, même client unique).

## 2.7 M4RKETING by TAKATAK — EQRZ028619JRW — brouillon
**Travail :** marketing du marchand branché sur ses vraies données Clover : promotions, campagnes clients, offres par segment. (Pas de package local dédié ; construit sur Customers/Inventory/Discounts.)
**Permissions cœur :** Customers R/W, Inventory R/W (rabais), Orders R, Merchant R.

- **Base 50 $** — le nécessaire : rabais personnalisés créés et gérés dans l'inventaire (#19) ; segments clients simples depuis #42 (nouveaux/récents/inactifs) ; offres affichées à la caisse et à la borne via nos propres écrans (#48, #58).
- **Premium 100 $** — plus : campagnes déclenchées par événements (webhooks `C`/`O`, #60 : premier achat, inactivité, anniversaire de première visite) ; promotions par catégorie/étiquette (#13, #18) ; mesure des campagnes par les commandes (#23, #30).
- **VIP 150 $** — full kit : tout Premium + moteur d'offres complet arrimé à LOY4LTY (points bonus) et REW4RDS (cartes promo) ; vitrine publique synchronisée via On2GO (plats et tendances publiques seulement — aucune donnée client) ; brouillons assistés par IA soumis à approbation humaine (règle du package TAKATAK) ; multi-marques sans mélanger les données (cloisonnement par espace, comme le dashboard).

## 2.8 ON2GO — N4NYCJCZ17FF4 — brouillon
**Travail :** annuaire public de restaurants + porte d'entrée de commande directe **sans commission de plateforme** : fiche publique (nom, cuisines, heures, lien de commande), plats publics, recherche par marque/cuisine/établissement. Contrat public documenté : lecture seule, aucune donnée de commande/client/paiement exposée. (Package : `on2go/`.)
**Jumeau sandbox :** On2GO TE77CFFZC9394.
**Permissions cœur :** Merchant R, Inventory R (articles publics seulement).

- **Base 50 $** — le nécessaire : fiche publique alimentée par le profil marchand (#8) et les heures (#11) ; articles, catégories et prix publics lus dans l'inventaire (#12, #13) ; lien direct vers la commande du restaurant (Online Ordering natif #28 ou page Food Hub).
- **Premium 100 $** — plus : disponibilité synchronisée (articles épuisés retirés de la fiche via #21 et webhooks `I`) ; plats vedettes par étiquettes (#18) ; tendances de classement publiques (agrégats sans données clients).
- **VIP 150 $** — full kit : tout Premium + commande directe complète branchée Food Hub (le client commande sans quitter le parcours, la commande devient une commande Clover #24) ; multi-succursales et multi-marques dans l'annuaire ; arrimage M4RKETING (offres publiques) et LOY4LTY (le client se reconnaît par téléphone au checkout).

## 2.9 REW4RDS by TAKATAK — 239362NZSVFSC — brouillon
**Travail :** cartes-cadeaux complètes : vente à la caisse et sur le site du marchand (la vente web devient une vraie commande Clover), échange comme mode de paiement (partiel accepté), recharges, registre au niveau du **groupe** (une carte s'échange dans toutes les succursales participantes), rapports de passif pour 4CCOUNTING. **Loi du Québec : aucune expiration, aucuns frais d'inactivité** — appliqués par défaut. (Package : `rew4rd/`.)
**Jumeau sandbox :** package REW4RD (préparé 2026-10-26 ; l'app production porte le nom REW4RDS).
**Permissions cœur :** Orders R/W, Payments R/W (tender), Customers R/W, Merchant R ; Ecommerce pour la vente web.
**Choix d'architecture (package) :** registre maison chez TAKATAK (groupe + loi QC) ; l'API Cartes-cadeaux Clover (#37) reste une option par marchand inscrit aux plans Clover Gift Cards — voir Lacune L14.

- **Base 50 $** — le nécessaire : vente de cartes (physiques et numériques, code + QR) depuis une commande Clover (#23) ; activation au moment de la vente ; échange partiel comme tender personnalisé (#39) à la caisse ; solde par code/QR (#57 scan).
- **Premium 100 $** — plus : vente sur le site du marchand via Ecommerce (charge #31 + iframe #33, la vente devient une commande Clover) ; échange à la borne et au checkout web ; recharges partout ; solde aussi par téléphone (#42, même client que LOY4LTY).
- **VIP 150 $** — full kit : tout Premium + registre de groupe multi-succursales complet ; rapports de passif en continu vers 4CCOUNTING (cartes vendues, échangées, soldes dus) ; option d'arrimage à l'API Cartes-cadeaux Clover (#37 : activation/solde/échange/reload/cash-out, multi-verrouillage) pour les marchands qui préfèrent le programme Clover ; cartes promo pilotées par M4RKETING.

## 2.10 ST4FF by TAKATAK — E0BGTY752BZYE — brouillon
**Travail :** horaires d'employés, pointeuse sur le Clover, coûts de main-d'œuvre et messages d'équipe — le personnel au même endroit que les ventes. (Package : `st4ff/`.)
**Permissions cœur :** Employees R/W, Merchant R, Orders R, Payments R.
**Fait plateforme :** l'API donne employés, rôles et **quarts** (#45, #46) — la planification riche (échanges de quarts, disponibilités) vit dans notre couche ; la vérité de présence vient des quarts Clover.

- **Base 50 $** — le nécessaire : liste d'employés et rôles synchronisés (#45) ; pointeuse alimentée par les quarts Clover (#46) ; heures travaillées par employé et par période.
- **Premium 100 $** — plus : horaires planifiés comparés au réel (quarts #46) ; coût de main-d'œuvre rapproché des ventes par quart (#23, #30) ; messages d'équipe sur les appareils (#58).
- **VIP 150 $** — full kit : tout Premium + règles avancées (heures supp, pauses) dans notre moteur ; export paie et flux coûts vers 4CCOUNTING ; alertes (retard, quart non fermé, employé modifié — webhooks `E`, #60) ; multi-succursales avec rôles par emplacement.

## 2.11 T4CTILE by TAKATAK — SFH7X57N3B5FJ — brouillon
**Travail :** interface de commande tactile style grande chaîne + borne libre-service du marchand : menu en photos plein écran, gros boutons, branchée sur le vrai menu Clover, paiement sur l'appareil. (Packages : `commande-tactile/` et `borne-libre-service/` ; prototype `~/workspace/kiosque-tactile/`.)
**Jumeaux sandbox :** Commande tactile 5YD2CHATX3Q18 · Borne libre-service 3EWA1H7WF0ZET.
**Permissions cœur :** Inventory R, Orders R/W, Merchant R, Employees R (déverrouillage kiosque), Customers R/W (fidélité à la borne).

- **Base 50 $** — le nécessaire : parcours borne complet sur le Kiosk (plein écran `CustomerMode` #54, démarrage auto) ; menu lu en direct (#12–#17, taxes #20) ; commande créée dans Clover (#23) et imprimée en cuisine (#27) ; paiement sur l'appareil associé (#49/#54, `KioskPayRequestIntentBuilder`) ; bilingue FR/EN.
- **Premium 100 $** — plus : photos grand format depuis notre CDN clé par ID d'article (contournement L4) ; extras et upsells toujours visibles dans l'ordre du marchand ; fidélité par téléphone à la borne (LOY4LTY, #42) ; retour auto à l'accueil, écran d'attente promotionnel (#58).
- **VIP 150 $** — full kit : tout Premium + vente suggestive pilotée par M4RKETING (offres du moment, étiquettes #18) ; paiement par carte-cadeau REW4RDS scannée (#57) ; accessibilité et thèmes par marque ; statistiques de parcours (abandons, panier moyen) vers le dashboard TAKATAK ; mode tactile comptoir (écrans tactiles non-Kiosk) inclus.

## 2.12 TAKATAK — F4TMP23FM7K5M — brouillon
**Travail :** tableau de bord d'agence et de gestion de marques : un espace distinct par client/marque ; le connecteur Clover (lecture) relie chaque établissement au bon espace et y apporte ventes, commandes, articles et écarts. (Package : `takatak/`.)
**Jumeau sandbox :** TAKATAK P8JGS60SV1R7W.
**Permissions cœur :** Merchant R, Inventory R, Orders R, Payments R (tout en lecture dans le périmètre du package).

- **Base 50 $** — le nécessaire : connexion d'un établissement Clover à son espace ; indicateurs de ventes/commandes en lecture (#23, #30) ; état de l'inventaire (#12) ; alertes « compte non relié / données périmées ».
- **Premium 100 $** — plus : vue portefeuille multi-établissements sans fusion des données (chaque marque dans son espace) ; écarts à vérifier (commandes sans paiement, ruptures fréquentes) ; suivi des actifs numériques reliés à la marque (Pages, profils, comptes).
- **VIP 150 $** — full kit : tout Premium + le plan de contrôle complet de la suite : état de toutes les apps TAKATAK installées (webhooks `A`, #64), facturation et usage consolidés, indicateurs sociaux/publicitaires en lecture quand le client active ces modules, brouillons IA approuvés par un humain ; c'est l'écran où le « système unique » de la section 4 devient visible.

## 2.13 TAKATAK Picture Register — J0H36VTJBSBBP — brouillon
**Travail :** caisse visuelle : le registre du comptoir avec **photos des articles** en grand — pensée pour la vitesse et la formation du personnel (on touche la photo, pas un code). Sœur de C4ISSE (2.4) : C4ISSE = couche caisse complète ; Picture Register = l'interface photo d'abord.
**Permissions cœur :** Inventory R, Orders R/W, Payments W (flux), Employees R.

- **Base 50 $** — le nécessaire : grille photo des items par catégorie (#12, #13) alimentée par notre CDN (contournement L4) ; ajout au panier en un toucher ; paiement via Android Payments API (#49) ; impression (#55).
- **Premium 100 $** — plus : photos de modificateurs et variantes (attributs/options #15) ; recherche et SKU/scan (#57) ; rabais rapides (#19) ; verrouillage par employé (#45).
- **VIP 150 $** — full kit : tout Premium + synchronisation photo automatique quand un item est créé/modifié (webhooks `I`, #60 — la photo suit l'item partout : borne T4CTILE, On2GO, sites) ; mode formation (photos + noms FR/EN affichés) ; arrimage complet C4ISSE (même panier, deux interfaces).

## 2.14 TR4CKER by TAKATAK — EB2EPCWEJBZ82 — brouillon
**Travail :** suivi de livraison en direct de nos propres livraisons : position du livreur, suivi des pourboires, page client « ajoute un pourboire + avis » après livraison (bon avis → Google ; mauvais → interne), paiement NFC à la porte (le téléphone devient un Clover de poche via la suite). (Spec : Drive/PPP + issue nº 17 du dépôt pppmtl.)
**Permissions cœur :** Orders R/W, Payments R/W, Customers R, Merchant R.

- **Base 50 $** — le nécessaire : suivi en direct du livreur rattaché à la commande Clover (#23) ; page de suivi client ; statuts synchronisés par webhooks `O` (#60).
- **Premium 100 $** — plus : suivi des pourboires (pourboire à la commande et après livraison via lien Ecommerce #31/#36) ; page post-livraison « pourboire + avis » (routage bon/mauvais avis) ; notifications client via CH4T.
- **VIP 150 $** — full kit : tout Premium + paiement à la porte (téléphone du livreur comme terminal : flux semi-intégré/REST Pay #52 ou lecteur Go #53 — Canada à confirmer pour Go) ; ventilation comptable automatique des pourboires et frais vers 4CCOUNTING ; preuves de livraison (photo/signature dans notre couche) rattachées à la commande.

## 2.15 Note — MEV.QUEBEC by TAKATAK (package local, pas d'ID d'app dans la liste de mission)
**Travail :** compagnon québécois de facturation obligatoire : capture les ventes Clover (commandes + paiements, lecture seule) et alimente le chemin d'enregistrement certifié (SEV ↔ MEV-WEB de Revenu Québec) ; rapports fiscaux et tableau de rapprochement ventes vs factures. **Aucun usage fiscal avant certification Revenu Québec** — la certification est l'étape 0 (deux produits Clover sont déjà certifiés par des tiers : « Clover MEV Connect » et « Clover MEV Web »). (Package : `mev-quebec/` ; SEV maison : dépôt takatakca/QCMEV.CA.)
**Paliers (même doctrine, à activer seulement après la décision de certification de Matt) :** Base 50 $ = capture des ventes (#23, #30) + rapports TPS/TVQ de fin de journée (#20) ; Premium 100 $ = + rapprochement ventes/factures avec écarts visibles + numéros de transaction et QR portés au flux du reçu (#27) ; VIP 150 $ = + branchement complet au SEV certifié (le nôtre si certifié, ou partenaire certifié), mode hors-ligne avec file d'attente, rapports réglementaires complets. MEV.QUEBEC se nourrit de 4CCOUNTING et nourrit le même dos d'événements (section 4).

## 2.16 Correspondance sandbox → production (récapitulatif)

| Sandbox (brouillon) | ID sandbox | Production |
|---|---|---|
| Fidélité | X41V082SRCG4G | LOY4LTY WX0Y6313JX1TY |
| Commande tactile | 5YD2CHATX3Q18 | T4CTILE SFH7X57N3B5FJ |
| Borne libre-service | 3EWA1H7WF0ZET | T4CTILE SFH7X57N3B5FJ (même famille kiosque) |
| Voice | 743YNWB6ZHVMC | Phone AI 20FK28P20HJC6 |
| Food Hub (+ MONTRÉAL FOOD HUB, ON2GO FOOD HUB) | DAMMKBC3F5T3R · AF6CWMT2GPD2J · 9M7ANK3H73XV4 | Food Hub 629HFYHNVMZYR |
| On2GO | TE77CFFZC9394 | ON2GO N4NYCJCZ17FF4 |
| TAKATAK | P8JGS60SV1R7W | TAKATAK F4TMP23FM7K5M |
| (packages locaux sans jumeau sandbox nommé : st4ff, rew4rd, mev-quebec) | — | ST4FF E0BGTY752BZYE · REW4RDS 239362NZSVFSC · MEV (à créer/décider) |
| (sans prédécesseur sandbox connu) | — | 4CCOUNTING, C4ISSE, CH4T, M4RKETING, Picture Register, TR4CKER |

**Rappel mécanique :** une app sandbox doit être recréée en production (#6) — la correspondance ci-dessus est fonctionnelle, pas un transfert automatique.

# 3. UN SEUL GRAND SYSTÈME CLOVER CONNECTÉ

Les 14 apps ne sont pas 14 produits isolés : ce sont 14 visages du **même système**, branchés sur quatre colonnes partagées. C'est exactement la vision du système maître unique : un client, un dos de données, des accès par groupe/app.

## 3.1 Colonne 1 — La commande unique (Orders backplane)
Toute commande, d'où qu'elle vienne, devient **une commande Clover** (#23/#24) avec son type (#9) : comptoir (C4ISSE, Picture Register), borne (T4CTILE), téléphone (Phone AI), plateformes (Food Hub), en ligne (On2GO/Online Ordering). Ensuite tout le monde lit la même vérité : la cuisine imprime/KDS (#27/#29), TR4CKER suit la livraison, CH4T informe le client, 4CCOUNTING comptabilise, LOY4LTY crédite, MEV capture, le dashboard TAKATAK affiche. Un seul format, zéro ressaisie.

## 3.2 Colonne 2 — Le bus d'événements (Webhooks)
Un seul consommateur de webhooks (#60) par marchand, derrière un **adaptateur** (à cause des changements annoncés aux webhooks d'inventaire), qui distribue les 12 types d'événements aux apps concernées :

| Événement | Consommateurs dans la suite |
|---|---|
| `O` Orders | Food Hub (états), TR4CKER (livraison), CH4T (avis au client), LOY4LTY (gain), 4CCOUNTING, TAKATAK (écarts) |
| `P` Payments | LOY4LTY (crédit après paiement confirmé), 4CCOUNTING, Food Hub (rapprochement), TR4CKER (pourboires) |
| `C` Customers | LOY4LTY, CH4T, M4RKETING (segments), REW4RDS (cartes liées) |
| `I`/`IC`/`IG`/`IM` Inventory | Food Hub (synchro plateformes), T4CTILE/Picture Register (photos et 86), Phone AI (menu en direct), On2GO (fiche publique) |
| `E` Employees | ST4FF (horaires), C4ISSE (autorisations) |
| `CA` Cash | 4CCOUNTING (rapprochement de caisse), TAKATAK (alertes) |
| `A` Apps | TAKATAK (plan de contrôle : installations, abonnements) |
| `M`/`SH` Merchant/Service hour | On2GO (fiche et heures), Food Hub (pauses/heures), Phone AI (heures d'acceptation) |

## 3.3 Colonne 3 — Le client unique par téléphone
L'identifiant maître du client est son **numéro de téléphone**, ancré dans Customers (#42) : LOY4LTY y rattache ses points (registre maison), REW4RDS ses cartes, CH4T ses conversations, Phone AI ses appels, M4RKETING ses segments, TR4CKER ses livraisons. Un client reconnu une fois est reconnu partout — comptoir, borne, téléphone, web — sans jamais mélanger les données entre marchands/marques (cloisonnement par espace, règle du dashboard TAKATAK).

## 3.4 Colonne 4 — L'argent unique (Payments)
Un seul vocabulaire d'argent : paiements sur appareil (#49/#50), semi-intégré (#51/#52), en ligne (#31–#36), cartes-cadeaux (#37 ou registre REW4RDS), tenders maison (#39). Les pourboires (#38) suivent les mêmes règles partout (à l'écran, avant autorisation — jamais d'ajustement après coup sur Interac). 4CCOUNTING voit tout ; ST4FF y rattache le coût humain ; MEV.QUEBEC y puise la matière fiscale.

## 3.5 Ce que ça donne, concrètement
- **Le menu ne se saisit qu'une fois** (inventaire Clover) et paraît partout : caisse, borne, téléphone IA, plateformes, annuaire, sites.
- **Une rupture (86) se propage partout** en secondes au lieu de vivre sur une tablette oubliée.
- **Le client est une seule personne** pour la fidélité, les cartes-cadeaux, le soutien et la livraison.
- **Le propriétaire voit un seul système** dans TAKATAK : ventes, personnel, comptabilité, marketing, soutien — chaque app reste vendable séparément (Base/Premium/VIP), mais installées ensemble elles se renforcent : c'est le « major système Clover connecté ».

---

# 4. LACUNES — CE QUE CLOVER N'OFFRE PAS (et notre contournement)

Source principale : audit plateforme interne du 2026-10-25/26 (`research_notes/clover-dev-plateforme-audit-pos-20261026-0203/report.md`), recoupé avec docs.clover.com.

| # | Lacune | Détail vérifié | Contournement en place / décidé |
|---|---|---|---|
| L1 | **Aucune API téléphonie** | Ni appels, ni IVR, ni enregistrement dans la doc développeur Clover. | Hub téléphonique maison : le fournisseur voix poste une commande structurée à NOTRE hub ; le hub valide, prixe avec la même logique taxes, crée la commande atomique (#24), déclenche impression/KDS, renvoie l'ID Clover et l'heure promise. Variante humaine : web POS léger + Terminal virtuel (#66). C'est l'architecture de Phone AI. |
| L2 | **Aucun API de points de fidélité** | Rewards/Promos natifs existent à la caisse, mais aucun endpoint de solde/points ; seul crochet = données client pendant le paiement (#43). | Registre de points maison clé par téléphone (#42), alimenté par webhooks `O`/`P` ; échange = rabais appliqué à la commande avant paiement (Write orders). On possède les données et le bilinguisme. C'est l'architecture de LOY4LTY (package Fidélité). |
| L3 | **Modificateurs sans compteur** | Les modificateurs n'ont qu'un booléen `available` ; Clover a répondu « Not at this time » à la demande de stock sur modificateurs (UserVoice, 2025). | Compteurs dans notre backend, décrémentés sur événements de commande ; à zéro, on bascule `available` à faux via l'API (#17). Ou modéliser l'ingrédient compté comme un item réel. Éventuel, pas transactionnel — à assumer. |
| L4 | **Aucune image d'article via l'API** | Aucun champ image dans l'API Inventaire ; les images vivent dans les vues en ligne de Clover, pas dans l'API. | CDN maison clé par ID d'article Clover (le modèle des kiosques du marché, ex. GRUBBRR). Alimente T4CTILE, Picture Register, On2GO et les sites. |
| L5 | **Pas d'agrégation de livraison native ; SkipTheDishes absent** | Aucun connecteur natif Uber/DoorDash ; pour Skip : demande marchande toujours « request » sur UserVoice (sept. 2025), aucun partenaire Clover confirmé pour Skip au Canada. | Uber/DoorDash via partenaires App Market (#65) ou notre hub ; **Skip : notre hub ingère Skip (API partenaire/agrégateur) et crée lui-même la commande Clover** — on devient l'agrégateur de ce canal. Ne jamais présumer qu'une liste de canaux US implique le Canada/Skip. |
| L6 | **Aucun API de cadence (coursing/throttling/hold-and-fire)** | Rien pour retarder, cadencer ou « tirer » les commandes. | Machine à états dans notre hub (reçu → retenu → tiré) ; on ne crée/imprime la commande Clover (ou on n'appelle `print_event`, #27) qu'au moment du tir. Même garde entre le webhook agrégateur et la création de commande pour la cadence de préparation. |
| L7 | **Aucune API KDS** | Le KDS Clover est natif, sans API publique trouvée. | On l'alimente indirectement : commandes Clover correctes avec bons groupes d'impression et types de commande (#25, #9). |
| L8 | **Impossible de remplacer le Register** | Aucun moyen documenté de désinstaller/désactiver le Register ou de devenir le lanceur par défaut. | Coexistence assumée : nos apps sont les surfaces lancées (au kiosque, `CustomerMode` + démarrage auto en font la seule surface client) ; Register/Orders/Payments restent comme repli et surface d'administration. |
| L9 | **Aucun moteur de taxes Québec** | Le modèle Clover = taux arbitraires par item ; rien n'implémente TPS/TVQ ni la règle de non-cumul (TVQ calculée sur le prix avant TPS ; combiné 14,975 %). | Deux taux Clover (TPS 5,000 % + TVQ 9,975 %) sur les items taxables et **preuves au centime en sandbox** que les deux s'appliquent à la base avant taxe, sans cumul, avec ventilation TPS/TVQ et numéros d'inscription au reçu. Si un test échoue : moteur de taxes maison, montants explicites, reçu conforme imprimé par notre app. (Déjà la pratique du groupe : TPS 5 % / TVQ 9,975 % vérifiés côté marchand.) |
| L10 | **Interac Canada : restrictions dures** | Pas d'auth/pré-auth, pas de `tipAdjustAuth()`, pas de vault, **pas de paiements hors ligne du tout au Canada**, remboursements avec carte insérée, CAD seulement, fermeture de lot automatique. | Concevoir pourboire-à-l'écran (avant autorisation), aucun onglet de bar sur débit, aucune promesse hors-ligne, cartes au dossier = cartes de crédit seulement. Encodé dans C4ISSE/Phone AI/TR4CKER. |
| L11 | **Aucun calcul de monnaie à rendre** | Aucune API « change due ». | Arithmétique dans notre UI de caisse ; tiroir ouvert via #56. |
| L12 | **Aucun composant « NIP gérant » prêt à l'emploi** | Les contournements (voids/rabais) vivent dans les apps Clover elles-mêmes. | Notre UI demande le code du gérant, vérifié contre les dossiers employés (#45) via notre backend, et journalise l'ID de l'employé autorisant sur l'action. Ne jamais stocker de NIP en clair. |
| L13 | **Frais de service : création réservée au marchand** | Les apps peuvent appliquer/retirer les frais configurés (max 3) mais pas les créer ; pas de frais tarifaires/taxables dans la version initiale de MSC. | Le marchand configure ses frais une fois dans Clover ; nos apps les appliquent (#26). Les frais « par canal » de Food Hub VIP passent par cette configuration, pas par création dynamique. |
| L14 | **Cartes-cadeaux : le programme Clover ≠ notre registre de groupe** | L'API Cartes-cadeaux (#37) existe côté Ecommerce, mais elle est liée au programme Clover Gift Cards du marchand (inscription aux plans Clover, règles du programme) ; elle ne donne ni un registre **multi-succursales de groupe** à notre main, ni nos règles Québec par défaut (aucune expiration/frais — la loi, déjà notre défaut). | Registre maison REW4RDS (groupe, Loi 25 + règles QC, passif vers 4CCOUNTING) ; #37 gardé comme option par marchand qui préfère le programme Clover. |
| L15 | **Apps privées non facturables via App Market** | « Private apps are not billable using the App Market billing process » — le prix se discute à la revue initiale. | Nos paliers 50/100/150 $ supposent des apps **publiques** facturées par paliers d'abonnement (#61). Toute app déployée en privé pour un seul groupe doit avoir son prix réglé à la revue — ne pas promettre la facturation App Market en privé. |
| L16 | **Webhooks = notifications, pas des objets** | Les payloads donnent type + ID + marchand ; il faut aller chercher l'objet en REST. Changements annoncés (2026) aux webhooks d'inventaire. | Consommateur unique derrière un adaptateur (section 3.2) ; idempotence et re-lecture systématique de l'objet après événement. |
| L17 | **Fenêtre de 90 jours sur les paiements** | Sans filtre de dates, `GetPayments` se limite à 90 jours (changement févr. 2025). | Tous les rapports (4CCOUNTING, TAKATAK) paginent par plages de dates explicites ; l'historique long se reconstruit par tranches. |
| L18 | **Clover Go : Canada non confirmé** | La page du SDK Go trouvée est intitulée « United States ». | Ne pas vendre le paiement à la porte sur Go tant que DevRel ne confirme pas le Canada par écrit ; repli = REST Pay Display (#52) vers un Flex du magasin. Concerne TR4CKER VIP. |
| L19 | **Semi-intégré hors App Market public** | Les apps POS externes en REST Pay Display « ne sont pas disponibles sur le App Market public ». | Le semi-intégré sert nos déploiements privés/connus ; il ne porte pas une fiche publique ni les paliers #61. |
| L20 | **Appareils sans Google Mobile Services** | Pas de Play Store, pas de Firebase/gms sur les appareils Clover ; Flutter/React Native « non recommandés » ; Java/Kotlin préférés. | Notifications et services d'arrière-plan maison (pas de FCM) ; builds natifs Kotlin/Java pour les surfaces appareil ; le français fait partie des langues recommandées par Clover — nos apps sont FR d'abord. |

---

# 5. RÈGLES DE RÉUTILISATION (pour les prochains projets)

1. **Avant de bâtir une fonction, cherche son entrée dans la section 1.** Si elle n'y est pas, vérifie la section 4 : c'est peut-être une lacune connue avec contournement déjà décidé.
2. **Permissions minimales, justifiées une par une** (#4) : chaque permission demandée en trop complique la revue et rétrécit le parc de marchands admissibles.
3. **OAuth v2 + rotation des refresh tokens dès le jour 1** (#2) — non négociable en Amérique du Nord.
4. **Sandbox ≠ production** : recréer l'app, revérifier les permissions (#6).
5. **Taxes Québec** : deux taux, preuves au centime en sandbox, avant tout lancement (L9).
6. **Interac d'abord dans les flux de paiement canadiens** (L10) : pourboire à l'écran, jamais d'ajustement après autorisation, jamais de hors-ligne.
7. **Le téléphone est la clé client** (section 3.3) ; l'ID d'article Clover est la clé des images (L4) ; la commande Clover est la seule vérité d'une vente (section 3.1).
8. **Prix des apps publiques = paliers d'abonnement App Market** (#61) Base 50 / Premium 100 / VIP 150 $ ; le mesuré (#62) est un supplément d'usage, pas un remplacement. Apps privées : voir L15.

*Fin du notepad — étude du 2026-10-28. Aucun secret, aucun jeton, aucune valeur d'identifiant marchand dans ce document (seuls des ID d'apps déjà consignés dans nos dossiers internes y figurent, car ils structurent le mapping).*
