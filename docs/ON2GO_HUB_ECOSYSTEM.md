# ON2GO Hub — l'écosystème, du haut vers le bas

_Branche `docs/on2go-hub-ecosystem` · 2026-10-09 · plan d'architecte (aucun code ici). Copie courte dans knowledgeAI :
`projects/ON2GO-HUB.md`._

Ce document met tout l'écosystème en ordre : chaque produit, ce qu'il fait, comment il parle aux autres, ce qui existe
déjà, ce qui est sur une branche, ce qui manque, et dans quel ordre on le construit. Les règles de `docs/MASTER_PLAN.md`
§ 6 (règles verrouillées) et de `CLAUDE.md` § 4 s'appliquent partout.

---

## 0. En une minute

- **Food Hub devient ON2GO Hub.** C'est la même plateforme : vous l'utilisez pour vos ~18 marques dans 2 cuisines
  (NDG, 6280 av. Somerled · Saint-Léonard, 5839 rue Jean-Talon E.), et on l'offre ensuite à d'autres restaurants, puis à
  des **commerces de détail**.
- **Tout ce que DoorDash, Uber Eats et Skip donnent aux marchands, ON2GO Hub le donne aussi** — et en plus : un seul écran
  pour toutes les plateformes, Clover au centre, le téléphone IA, nos propres livreurs, notre propre appli client.
- **Nos canaux directs passent en premier** : lien de commande Clover partout, site de chaque marque, appli client ON2GO,
  téléphone IA, livraison par DoorDash Drive / Uber Direct, puis **nos propres livreurs**.
- **Pas de base de données partagée entre produits.** Chaque produit garde sa base ; ils se parlent par des contrats
  (API signées, flux publics). Le tableau de bord TAKATAK (takatak-v1) tient les comptes marchands, la facturation et
  l'analytique ; il reste en Europe, les données de commandes restent à Montréal.
- **Ordre de construction** : téléphone IA multi-cuisines (fait, branche) → nom du produit configurable → livreurs
  maison (3ᵉ flotte) → identité marchand (tenant) → appli client PWA → parité marketing (promos, fidélité, avis) →
  multi-marchands payant → commerce de détail.

---

## 1. Le nom : Food Hub → ON2GO Hub

| Quoi | Décision |
|---|---|
| Nom du produit pour les marchands | **ON2GO Hub** (« par GROUPE TAKATAK »). Couleurs et logo : `BRAND.md` (marine + bleu électrique). |
| Nom pour les clients | **ON2GO** : l'annuaire on2go.ca et l'appli client. Les marques restent les marques (Po Poulet, Pi Pita…). |
| Interface | Le nom affiché vient d'une variable serveur (`FOODHUB_PRODUCT_NAME`, défaut « Food Hub »). Rien ne change tant que vous ne la mettez pas à « ON2GO Hub » dans Coolify. **Fusionné** (PR #20). |
| Domaines | Nouveau domaine principal prévu : `hub.on2go.ca`. **`foodhub.on2go.ca` continue de marcher pour toujours** : c'est l'adresse enregistrée chez Uber, DoorDash, Skip, Clover et Twilio pour les webhooks. Les deux domaines pointent sur la même app Coolify. `FOODHUB_PUBLIC_URL` reste `foodhub.on2go.ca` tant que chaque plateforme n'a pas été déplacée, une à une. |
| Clover App Market | La fiche Clover garde « Food Hub » jusqu'à une révision Clover planifiée : changer le nom ou la Site URL après approbation renvoie en révision (`docs/CLOVER_MARKETPLACE_LAUNCH.md`). |
| Code | Les variables `FOODHUB_*`, les tables `fh_*` et les routes `/api/foodhub/*` gardent leur nom : ce sont des noms internes, les renommer casserait les webhooks et les déploiements. |

---

## 2. Les produits et comment ils se parlent

```
                         ┌──────────────── TAKATAK Dashboard V1 (takatak-v1, Supabase eu-west-1) ───────────────┐
                         │  comptes marchands (tenants) · membres · forfaits & facturation Stripe · analytique   │
                         └──────▲──────────────────────────────▲─────────────────────────────▲─────────────────┘
                     C4 droits  │ C5 événements d'usage         │ C3 lancement (SSO)          │ C6 agrégats
                                │ (sans données client)        │                             │
 ┌──────────────┐  C1 flux public  ┌────────────────────────────┴─────────────────────────────┴──────┐
 │  ON2GO.ca    │◄─────────────────│                     ON2GO Hub (foodhubca)                       │
 │  annuaire    │                  │  console marchand · écran cuisine · menus · 86 · heures · argent │
 └──────┬───────┘                  │  Watchtower · rapports · Copilot · Order Relay · répartition    │
        │ C7 lieux + QR            └──┬──────────┬───────────┬────────────┬────────────┬─────────────┘
 ┌──────▼───────┐                     │          │           │            │            │
 │   QMAPS      │        C8 commandes │   Clover │  C2 cmd   │ C9 appli   │ C10 voix   │ API officielles
 │ lieux, QR,   │        des sites    │   (POS)  │  directes │ livreur    │ Twilio     │
 │ cartes       │   ┌─────────────────┘          │           │            │            ▼
 └──────────────┘   │                 ┌──────────▼──┐   ┌────▼──────┐ ┌───▼────────┐ ┌──────────────────────────┐
 ┌──────────────────▼─┐               │ Clover      │   │ Appli     │ │ Téléphone  │ │ Uber Eats · DoorDash ·   │
 │ Sites des marques  │──── lien ────►│ caisse,     │   │ livreur + │ │ IA + menu  │ │ Skip · Too Good To Go    │
 │ (pppmtl, 17 marques│  Clover en    │ imprimante, │   │ dispatch  │ │ vocal (IVR)│ │ Flottes : DoorDash Drive,│
 │  un seul code)     │  premier      │ commande en │   └───────────┘ └────────────┘ │ Uber Direct, Skip DaaS   │
 │ + appli client PWA │               │ ligne       │                                └──────────────────────────┘
 └────────────────────┘               └─────────────┘
```

| Produit | Rôle | Dépôt / branche | État |
|---|---|---|---|
| **ON2GO Hub — console marchand** | Un écran pour toutes les plateformes et toutes les marques : commandes, menus partagés, 86 partout, heures, pauses, argent (rapprochement, versements, litiges), Watchtower, rapports, Copilot. | `foodhubca` (main) ; sélecteur de portée tout / cuisine / marque fusionné (PR #29) | En production (une seule entreprise). |
| **Écran cuisine (tablette)** | Billets à préparer, alarmes (dont « Extra fort »), mode occupé, bandeau livreurs, commandes Clover en ligne, **nos commandes directes (téléphone IA, site, saisie)**. | `foodhubca` (alarme « Extra fort » fusionnée, PR #14) ; commandes directes sur la tablette fusionnées (PR #17) | En production. |
| **Clover (POS)** | Caisse et imprimante de chaque cuisine ; source de vérité des commandes Clover en ligne ; app Clover App Market multi-marchands (OAuth par marchand). | `foodhubca` `lib/foodhub/pos/*` (commandes du site par Clover : PR #10, #11 fusionnées) | En production ; fiche App Market à soumettre. |
| **Plateformes** | Uber Eats, DoorDash, Skip (JET Connect), Too Good To Go (flux entrant). Menus, 86, heures, commandes, annulations, rapports. | `foodhubca` ; couverture complète : Uber fusionnée (PR #21), certification fusionnée (PR #12) ; `feature/doordash-api-coverage`, `feature/skip-tgtg-api-coverage` en cours | En production (approbations en cours). |
| **Flottes de livraison** | Pour **nos** commandes : DoorDash Drive (1ʳᵉ), Uber Direct (comparaison), Skip DaaS (prévu), **nos livreurs** (3ᵉ flotte). | `foodhubca` `lib/foodhub/delivery/*` ; nos livreurs : `feature/own-fleet` | Drive / Uber Direct en bac à sable ; nos livreurs sur branche. |
| **Appli livreur + répartition** | Page mobile du livreur (lien personnel, sans mot de passe) : course assignée, ramassage, livraison, appel du client. Tableau de répartition dans la console. | `foodhubca` `feature/own-fleet` (squelette) | Squelette. |
| **Téléphone IA + menu vocal** | Un agent IA prend la commande au téléphone (menu en direct, total confirmé, billet Clover, texto). Une ligne peut servir les marques de **plusieurs cuisines** ; un menu vocal (IVR) oriente les autres appels. | `foodhubca` `lib/foodhub/phone/*` ; multi-cuisines (PR #17), renvoi des numéros de marque (PR #18) et menu vocal (PR #30) fusionnés | Code prêt ; à allumer (§ 8). |
| **Sites des marques** | Un seul code pour 17 marques (domaine → marque), panier partagé, **lien Clover en premier**, llms.txt, schema. | `pppmtl` `feature/multi-brand` | Branche poussée. |
| **Appli client ON2GO** | PWA d'abord (sur la base pppmtl multi-marques), puis applis natives. Compte client TAKATAK, suivi de commande, fidélité. | `pppmtl` (à venir) | Plan (§ 6). |
| **ON2GO.ca (annuaire)** | Découverte locale (ouvert tard, en vedette, tendances, offres), FR/EN, liens de commande Clover d'abord. | `on2goca` `feature/on2go-directory` ; flux : `foodhubca` `GET /api/public/directory` (fusionné, PR #16) | Branches poussées. |
| **QMAPS** | Lieux, codes QR, cartes et heatmaps ; avis et fiches d'entreprises du Québec. | `qmaps` | Séparé ; importe les « places » d'ON2GO. |
| **TAKATAK Dashboard V1** | Plan de contrôle : comptes marchands, membres et rôles, forfaits et facturation (Stripe), droits (entitlements), identité maîtresse, analytique. | `takatak-v1` (Supabase eu-west-1, y reste) | En production pour d'autres produits ; pas encore relié à ON2GO Hub. |

### 2.1 Les contrats (aucune base partagée)

| # | Contrat | Sens | Authentification | Où |
|---|---|---|---|---|
| C1 | **Flux public de l'annuaire** `GET /api/public/directory` (marques, cuisines, heures, liens de commande, plats, tendance en rang) | Hub → ON2GO.ca, QMAPS | Public, lecture seule, CORS limité | main (PR #16) |
| C2 | **Commandes directes** `POST /api/foodhub/webhooks/website-order` | Sites, appli client → Hub | Bearer `FOODHUB_WEBSITE_ORDER_SECRET` | main |
| C3 | **Lancement / SSO** : code à usage unique (90 s) émis par TAKATAK, échangé côté serveur contre une session de 10 min (modèle `experience_launch_codes` d'AHMV) | TAKATAK → Hub | Clé de service propre à ON2GO Hub | À faire (phase H4) |
| C4 | **Droits du marchand** (forfait, options, limites) | Hub lit TAKATAK, cache 5 min | Clé de service ON2GO Hub (jamais une clé partagée) | À faire (H4) |
| C5 | **Événements d'usage** `order.created/paid/fulfilled`, `merchant.*` sur `/api/v1/events` avec `Idempotency-Key` = id d'événement | Hub → TAKATAK | Même clé ; corps ≤ 100 Ko | À faire (H4) |
| C6 | **Agrégats d'analytique** (ventes par jour, marque, plateforme ; **aucune donnée personnelle**) | Hub → TAKATAK | Signature HMAC + horodatage (modèle des intégrations rentauto) | À faire (H4) |
| C7 | **Lieux + QR** (le fichier `directory.json` d'ON2GO, liens QR avec UTM) | ON2GO.ca → QMAPS | Fichier public | `feature/on2go-directory` |
| C8 | **Commandes Clover en ligne** (webhook Clover) miroir sur l'écran cuisine | Clover → Hub | Signature Clover | main |
| C9 | **Appli livreur** `GET/POST /api/courier/*` | Livreur → Hub | Jeton personnel signé (lien) | `feature/own-fleet` |
| C10 | **Voix** `POST /api/foodhub/webhooks/voice` (+ `/turn`, `/wait`, `/dial-done`, `/status`) | Twilio → Hub | Signature `X-Twilio-Signature` | main |
| C11 | **Plateformes** (API officielles seulement) | Hub ↔ Uber, DoorDash, Skip, TGTG | Clés de chaque plateforme | main + branches de couverture |

**Règle de résidence** : les commandes, clients et adresses restent dans la base de Montréal (Supabase ca-central-1,
projet takatak-foodhub). Vers TAKATAK (Irlande) ne partent que des identifiants de marchand et des agrégats sans
donnée personnelle (Loi 25).

---

## 3. Matrice de parité marchand

Ce que les grandes plateformes de livraison offrent à leurs restaurants et commerces, et où en est ON2GO Hub.
**A** = on l'a (main) · **B** = sur une branche · **M** = manque. La colonne « plateformes » donne des exemples connus ;
on ne promet aucune fonction d'une plateforme qu'on n'a pas vérifiée dans sa documentation.

| Capacité marchand | Chez les plateformes (exemples) | ON2GO Hub | Où |
|---|---|---|---|
| **Vitrine en ligne sans commission** | Site de commande direct offert par certaines plateformes (ex. DoorDash Storefront) | **A** Clover en ligne (pppmtl.com) · **B** 17 sites, un seul code | `pppmtl` `clover-direct`, `feature/multi-brand` |
| Annuaire / découverte | La place de marché elle-même | **A** flux public · **B** site ON2GO.ca | `on2goca` `feature/on2go-directory`, main |
| **Tablette de commandes** | Tablette ou appli de commandes de chaque plateforme | **A** écran cuisine unique, toutes plateformes, alarme extra-forte, commandes directes (téléphone IA, site, saisie) | main |
| Intégrations POS | Intégrations caisse (Clover, Square, Toast…) | **A** Clover (injection, impression, 86, ventes) · **M** Square, Lightspeed, Toast | main |
| **Outils de menu** | Gestion du menu, photos, options, horaires de catégories | **A** un menu partagé par toutes les marques, majoration par plateforme, horaires, publication planifiée · **M** combos et options imbriquées, studio photo | main |
| Rupture de stock (86) | Désactiver un article | **A** un 86 part sur toutes les plateformes, retour automatique, 86 Clover | main |
| Heures, fêtes, pauses | Heures spéciales, pause du magasin | **A** partout d'un coup, réouverture automatique | main |
| Temps de préparation / mode occupé | Réglage du temps de prép. | **A** (dont la synchro Uber du temps de prép.) | main |
| Multi-magasins / multi-marques | Gestion d'entreprise multi-établissements | **A** marques × cuisines, sélecteur tout / cuisine / marque | main |
| **Promotions** | Rabais, livraison gratuite, 1 acheté = 1 offert | **A** promotions Uber (créer, lister, révoquer) · **M** nos promos (site, appli, téléphone), promos DoorDash / Skip | main |
| **Publicité** | Annonces commanditées dans l'appli | **M** places « en vedette » sur ON2GO.ca vendues aux marchands ; TAKATAK Ads (`qmaps_targeting`) ; plan Google/Meta 1 $/jour par marque (privé) | takatak-v1, `on2goca` |
| **Fidélité / abonnement client** | Programmes de fidélité, abonnements livraison | **M** compte client TAKATAK + points ; plus tard abonnement ON2GO | pppmtl (dépôt client prévu « TAKATAK »), takatak-v1 |
| **Avis et notes** | Voir et répondre aux avis | **A** rapports d'avis Uber (feedback clients et articles) · **M** réponses aux avis, avis ON2GO / QMAPS reliés | main, `qmaps` |
| **Analytique et rapports** | Tableau de ventes, produits, erreurs | **A** 7 rapports (CSV/Excel, envoi planifié), analytique, journal · **B** 9 types de rapports Uber, API Reporting DoorDash | main, branches de couverture |
| Versements et relevés | Versements hebdo, relevés | **A** rapprochement, versements, relevés importés, grand livre approuvé · **M** nos propres versements aux marchands (phase H4, via un fournisseur de paiement) | main |
| Erreurs de commande, litiges | Contester une retenue | **A** litiges · **B** ajustements DoorDash / Uber | main, branches de couverture |
| **Livraison à la demande pour vos propres commandes** | DoorDash Drive, Uber Direct, Skip (livraison comme service) | **A** Drive + Uber Direct (bac à sable, comparaison de prix) · **B** Skip DaaS (prévu), **nos livreurs** | main, `feature/skip-tgtg-api-coverage`, `feature/own-fleet` |
| Livreurs du restaurant | Livraison par le personnel du restaurant | **B** 3ᵉ flotte « nos livreurs » + page mobile du livreur | `feature/own-fleet` |
| Commandes planifiées, pour emporter | Oui | **A** | main |
| Commandes de groupe / traiteur | Commandes de groupe, traiteur | **M** | — |
| **Épicerie / commerce de détail** | Catalogues épicerie, dépanneur, codes-barres, vente au poids | **B** catalogue, codes-barres, poids, stock par lieu, charges utiles DoorDash Retail / Uber épicerie prêtes (non envoyées) | main (`lib/foodhub/retail`) |
| Alcool | Avenant alcool, vérification d'âge | **A** moteur de règles RACJ (permis, heures, 18+) · approbations plateformes à demander | main |
| **Commande par téléphone** | (peu offert par les plateformes) | **A** agent IA, une ligne pour plusieurs cuisines, menu vocal | main |
| Appli client marque blanche | (rare) | **M** PWA ON2GO puis natif (§ 6) | pppmtl |
| Codes QR en salle / sur place | QR de commande | **B** QR QMAPS → lien Clover avec UTM | `qmaps`, `on2goca` |
| **Inscription marchand libre-service** | Inscription en ligne, import du menu | **A** assistant Clover App Market (3 étapes) · **M** inscription ON2GO Hub hors Clover (phase H4) | main |
| Équipe, rôles, NIP | Comptes employés | **A** rôles, lieux, NIP gérant, tablettes à NIP | main |
| Support marchand | Centre d'aide, clavardage | **A** Watchtower (incidents escaladés), Copilot · **M** billets de support pour marchands externes | main |
| API partenaires | API d'intégration | **A** Order Relay (format UrbanPiper), flux public | main |

**Ce qu'ON2GO Hub fait que les plateformes ne font pas** : un seul menu et un seul 86 pour toutes les plateformes ;
Clover au centre (aucune commande acceptée sans Clover) ; un écran cuisine pour tout ; un agent IA au téléphone ;
le choix de la flotte la moins chère par livraison ; les commandes directes sans commission en premier partout.

---

## 4. Modèle multi-marchands (tenants)

### 4.1 Aujourd'hui

- Une seule entreprise (vos marques). Les tables `fh_*` n'ont pas de colonne marchand. L'app Clover gère déjà
  plusieurs marchands Clover (OAuth par marchand), mais ils partagent la même instance.
- takatak-v1 sait isoler des comptes : `Client` (le compte), `ClientMembership` (rôles), portée vérifiée côté serveur
  (`resolveDataScope`), RLS en seconde défense, catalogue de produits et forfaits en données (`product_catalog`,
  `product_plans`, `product_entitlements`), Stripe avec webhooks idempotents.

### 4.2 Décision

| Étape | Comment | Pourquoi |
|---|---|---|
| **H4-a : un silo par marchand** | Chaque marchand (ou groupe) a sa propre app ON2GO Hub : même image Docker (`ci/prebuilt-image`), sa propre app Coolify, sa propre base. TAKATAK crée le compte, le forfait et les clés ; un script provisionne l'app. | Zéro risque de fuite entre marchands dès le premier jour ; aucun changement aux 500 lignes du dépôt de données ; facile à vendre « clé en main ». |
| **H4-b : multi-marchands partagé** | Colonne `tenant_id` (défaut = votre compte) sur chaque table `fh_*`, portée lue d'un contexte de requête (jamais d'un paramètre client), RLS en seconde défense, tests d'isolation comme `qa:tenant-isolation` de takatak-v1. | Pour les petits marchands (coût par marchand faible), et pour les marchands Clover App Market déjà sur l'instance commune. |

**Fondation posée maintenant** : un identifiant de marchand pour toute l'instance (`FOODHUB_TENANT_ID`, défaut
`takatak`), lu à un seul endroit, exposé dans `/api/health` et joint aux événements C5. Le jour du H4-b, ce même
identifiant devient la valeur par défaut de la colonne `tenant_id` : aucune donnée existante ne bouge.

### 4.3 Contrats avec takatak-v1 (sans coupler les bases)

- **TAKATAK possède** : le compte marchand (`Client`), ses membres, le produit `on2go_hub` et ses forfaits dans le
  catalogue (ex. Essentiel / Pro / Groupe), Stripe, l'identité maîtresse (`master_merchants`, `source_merchants`).
- **ON2GO Hub possède** : les commandes, menus, magasins, livreurs, appels, clients finaux, argent des plateformes.
- **Lecture des droits (C4)** : ON2GO Hub lit les droits de son marchand (forfait, nombre de marques, options : téléphone
  IA, livreurs, retail…) et les garde en cache. **Un problème de facturation ne bloque jamais une commande** (règle
  verrouillée : aucune commande perdue) ; il bloque seulement l'ajout de fonctions.
- **Événements (C5)** : comptes de commandes et d'appels pour la facturation à l'usage, sans nom, téléphone ni adresse.
- **Lancement (C3)** : depuis le tableau de bord TAKATAK, « Ouvrir ON2GO Hub » → code à usage unique → session ON2GO Hub.
  L'identité n'est pas l'autorisation : ON2GO Hub garde ses propres rôles et NIP.

---

## 5. Livreurs maison et répartition

- **3ᵉ flotte** « nos livreurs » à côté de DoorDash Drive et Uber Direct, avec le même contrat (`CourierFleet` :
  devis, réservation, statut, annulation). La répartition automatique choisit déjà la flotte la moins chère ; nos
  livreurs ont un coût interne fixe par course (réglable), donc ils passent en premier quand un livreur est en service.
- **Livreurs** : nom, téléphone, cuisines desservies, en service oui/non. Pas de mot de passe : chaque livreur reçoit
  un **lien personnel signé** (révocable) qui ouvre sa page mobile.
- **Page du livreur** (`/courier`) : courses assignées, adresse de ramassage, adresse du client (lien carte), boutons
  « Arrivé à la cuisine », « Ramassée », « Livrée », « Problème ». Chaque bouton fait avancer la livraison par le même
  chemin que les webhooks Drive/Uber : la commande, le bandeau cuisine et le texto de suivi suivent tout seuls.
- **Règles gardées** : un livreur n'encaisse jamais (commande payée d'abord) ; alcool seulement si les règles le
  permettent (pièce d'identité 18+) ; rien n'est « livré » sans le geste du livreur.
- **Plus tard (H2)** : quarts de travail, paie par course, preuve de livraison (photo), position en direct, carte
  (QMAPS), répartition par zone, appli native.

---

## 6. Appli client ON2GO (PWA d'abord)

- **Base** : pppmtl `feature/multi-brand` (TanStack Start, un code pour 17 marques, panier partagé, Clover Hosted
  Checkout, `manifest.webmanifest` déjà présent, interface mobile d'abord).
- **Étapes** :
  1. **PWA par domaine** : manifeste généré par marque (nom, couleurs, icône), service worker (menu et panier hors
     ligne, pas les prix ni le paiement), « Ajouter à l'écran d'accueil ».
  2. **Commandes persistantes** : chaque commande payée part dans ON2GO Hub par C2 (aujourd'hui elles sont en mémoire
     côté pppmtl), avec le suivi (`/commande/<id>`) lu depuis ON2GO Hub.
  3. **Compte client TAKATAK** (identité maîtresse, code par texto) : historique, adresses, fidélité.
  4. **Livraison** : choix pour emporter / livraison ; la livraison passe par la répartition d'ON2GO Hub (nos
     livreurs, puis Drive / Uber Direct).
  5. **ON2GO multi-restaurants** : la même appli sur on2go.ca liste tous les restaurants de l'annuaire (les vôtres, puis
     les marchands ON2GO Hub).
  6. **Natif** : emballage Capacitor (iOS/Android) quand la PWA est stable ; notifications push.
- **Règles** : lien Clover en premier ; chaque plateforme n'entend parler que d'elle-même ; aucune note ni avis inventé.

---

## 7. Feuille de route

Chaque phase se termine par des **vérifications d'acceptation** ; une phase est finie seulement quand elles passent toutes.

### H0 — Fondations (maintenant)

1. Téléphone IA : une ligne pour les marques de plusieurs cuisines, invite figée, commandes directes sur la tablette
   — **fusionné** (PR #17).
2. Nom du produit configurable — **fusionné** (PR #20).
3. Livreurs maison : 3ᵉ flotte + page livreur (`feature/own-fleet`).
4. Identifiant de marchand de l'instance (`feature/tenant-context`).

**Acceptation** : avec les variables par défaut, la console est identique à aujourd'hui ; avec
`FOODHUB_PRODUCT_NAME=ON2GO Hub`, le nom change partout dans l'interface ; un appel test sur une ligne à deux cuisines
crée un billet Clover dans la bonne cuisine et la commande apparaît sur la tablette de cette cuisine ; une course test
assignée à un livreur maison va de « assignée » à « livrée » depuis son téléphone.

### H1 — Nos canaux directs en vrai

1. Allumer le téléphone IA (§ 8) sur la ligne principale, puis les numéros des marques.
2. DoorDash Drive en production, Uber Direct en comparaison.
3. Sites des marques en ligne (pppmtl multi-marques), commandes persistées dans ON2GO Hub (C2).
4. ON2GO.ca en ligne avec le flux public.

**Acceptation** : une vraie commande par canal (téléphone IA, site, Clover en ligne) va jusqu'au billet Clover, à la
tablette et, en livraison, jusqu'au livreur, avec le texto de suivi.

### H2 — Nos livreurs

Quarts, paie par course, preuve de livraison, position en direct, répartition par zone, carte des courses.

**Acceptation** : une soirée complète d'une cuisine livrée par nos livreurs, chaque course tracée de bout en bout,
aucune course sans livreur pendant plus de 5 minutes sans alerte.

### H3 — Parité marketing

Promotions maison (site, appli, téléphone) et plateformes ; fidélité (compte client) ; réponses aux avis ; places
« en vedette » sur ON2GO.ca ; rapports par marque et par canal.

**Acceptation** : une promo créée une fois s'applique sur le site, l'appli et le téléphone, et apparaît dans les
rapports ; un client accumule des points sur deux marques.

### H4 — Multi-marchands et facturation

H4-a silos par marchand, contrats C3–C6 avec takatak-v1, forfaits ON2GO Hub dans le catalogue, inscription en
libre-service ; puis H4-b `tenant_id` partagé.

**Acceptation** : un marchand test créé dans TAKATAK obtient son ON2GO Hub sans intervention ; il ne voit jamais une
donnée d'un autre ; un retard de paiement ne bloque aucune commande ; les événements d'usage arrivent une seule fois
(idempotence).

### H5 — Commerce de détail

Catalogue, codes-barres, vente au poids, stock (déjà là) → envoi DoorDash Retail / Uber épicerie après approbation ;
caisse de détail (Clover d'abord) ; Haste-Mart comme vitrine de liquidation.

**Acceptation** : un commerce test publie 200 articles avec codes-barres sur une plateforme approuvée ; un article en
rupture dans Clover disparaît partout.

### H6 — Applis natives

PWA → applis iOS/Android (client et livreur), notifications push.

---

## 8. Téléphone IA : état et liste d'allumage

**Le chemin, vérifié dans le code** : appel → Twilio `POST /api/foodhub/webhooks/voice` (signature vérifiée) →
accueil en français, « For English, press 2 » → chaque phrase → Claude (outils qui vérifient tout : menu en direct,
86, choix obligatoires, heures, zone de livraison, alcool, total confirmé) → `place_order` → commande directe →
**billet Clover** (commande atomique, imprimée) → texto de confirmation → **tablette de la cuisine**.

**Corrigé et fusionné (PR #17)** :
- Une commande téléphonique pour emporter n'apparaissait pas sur la tablette Food Hub (seulement à l'imprimante
  Clover) : elle y apparaît maintenant, avec Vu / Prête / Remise au client et un bip.
- L'invite système de l'agent changeait pendant l'appel quand le menu changeait ; avec Claude Opus 5.5, un compte
  Anthropic créé après le 31 août 2026 reçoit alors une erreur et l'appel part à un humain. L'invite est maintenant
  figée pour tout l'appel.
- Une ligne peut servir les marques de **plusieurs cuisines** : l'agent demande quel restaurant, puis prend la commande
  dans le menu de cette cuisine ; le billet Clover et le transfert vont à cette cuisine.

**Pour allumer** (le propriétaire, dans l'ordre) :
1. Déployer `main` (Coolify) : le multi-cuisines (PR #17) et le menu vocal (PR #30) y sont.
2. Coolify → variables : `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (le numéro qui
   envoie les textos de confirmation), `FOODHUB_PUBLIC_URL=https://foodhub.on2go.ca` (la signature Twilio est vérifiée
   avec cette adresse), `FOODHUB_IVR_NUMBER` (le numéro principal, pour le menu vocal), `FOODHUB_IVR_HANDOFF_NUMBER`
   (le téléphone du gérant), `FOODHUB_VOICEMAIL_EMAIL`. Facultatif : `FOODHUB_FEATURE_PHONE=on` (sinon l'interrupteur
   de la console).
3. Clover branché (jeton du marchand ou marchand connecté) : sinon la commande reste dans ON2GO Hub seulement.
4. Twilio → Phone Numbers → le numéro principal → Voice Configuration :
   - **A call comes in** : Webhook, `https://foodhub.on2go.ca/api/foodhub/webhooks/ivr`, **HTTP POST** (le menu vocal
     répond, l'IA d'abord ; « passer une commande » donne l'appel à l'agent de commande, même appel) ;
   - **Call status changes** : `https://foodhub.on2go.ca/api/foodhub/webhooks/ivr/status`, **HTTP POST** ;
   - un numéro qui doit aller **directement** à l'agent de commande (sans menu) : `…/api/foodhub/webhooks/voice` et
     `…/api/foodhub/webhooks/voice/status` ;
   - **Primary handler fails** (secours si le serveur ne répond pas) : un **TwiML Bin** qui fait sonner une personne
     (`<Dial>` le téléphone du gérant). Pas une adresse d'ON2GO Hub : si le serveur est en panne, toutes ses adresses le
     sont aussi. Le modèle est dans les notes privées du téléphone (`private/phone/`).
   - **TWILIO_FROM** : le numéro principal lui-même (s'il reçoit les textos), **jamais** le numéro des textos de
     vérification TAKATAK.
5. Console → Réglages → Expansion → allumer « Commandes par téléphone (IA) » → Téléphone IA → Ajouter une ligne :
   numéro Twilio complet (+1…), nom dit au téléphone (ex. « les restaurants TAKATAK »), **Cuisine 1 = NDG** avec ses
   marques, « Ajouter une cuisine sur ce numéro » → **Cuisine 2 = Saint-Léonard** avec ses marques, transfert = le
   téléphone du gérant (vide = téléphone de la cuisine), livraison non au début. **Po Poulet seulement sous
   Saint-Léonard** : les lignes de marque refusent déjà Po Poulet à NDG (règle du propriétaire) ; à confirmer pour l'IA.
   Puis **Menu téléphonique** : allumé, ligne de commande = cette ligne, vérifier l'accueil et les liens.
6. Commandes directes → Appels → **Essayer l'agent** jusqu'à ce que ce soit bon ; puis appeler le numéro soi-même.
7. **Numéros des marques** : chaque numéro de marque peut aller à l'IA — même webhook `/api/foodhub/webhooks/voice`,
   et une ligne par numéro dans la console (sa marque, sa cuisine). Le renvoi vers un numéro principal
   (`/api/foodhub/voice/incoming`, fusionné PR #18 : chuchotement, message vocal par courriel) reste le **secours** :
   pour les numéros qu'on ne confie pas à l'IA, ou si on éteint l'IA. Sans clé IA ou interrupteur éteint, la ligne IA
   transfère d'elle-même au numéro de transfert : aucun appel perdu.

---

## 9. Ordre de construction (pourquoi)

1. **Téléphone IA d'abord** : il rapporte des commandes sans commission dès qu'il est allumé, le code existait déjà, il
   manquait la tablette et le multi-cuisines.
2. **Nom configurable ensuite** : petit, sans risque, et il débloque tout le matériel de vente « ON2GO Hub ».
3. **Livreurs maison** : la demande du propriétaire (« mes propres livreurs ») ; le module de livraison avait déjà un
   contrat de flotte, une 3ᵉ flotte s'y branche sans toucher aux deux autres.
4. **Identifiant de marchand** : prépare le multi-marchands sans toucher aux données ; le vrai découpage attend les
   contrats avec takatak-v1 (H4).
5. **Appli client** : elle réutilise pppmtl multi-marques ; elle a besoin des commandes persistées (C2) et du compte
   client, donc elle vient après les fondations.

---

## 10. Où lire ensuite

- `docs/MASTER_PLAN.md` (règles verrouillées § 6), `docs/EXPANSION_FEATURES.md` (livraison, retail, alcool, téléphone).
- `docs/PUBLIC_DIRECTORY_API.md`, `docs/UX_CONSOLE.md`.
- takatak-v1 : `docs/TAKATAK_V1_TENANT_ISOLATION_AUDIT.md`, `docs/TAKATAK_ADS_FOUNDATION.md`.
- knowledgeAI : `projects/ON2GO-HUB.md`, `ON2GO.md`, `FOODHUB.md`, `TAKATAK-CORE.md`, `QMAPS.md`, `RESTAURANT-NETWORK.md`,
  `HASTE-MART.md`.
