# Plateforme d'intégrations TAKATAK (Canada) — faire ce que fait Deliverect, à notre façon

> **Note de reprise (lire d'abord).** Ordre du propriétaire, 2026-10-29 23:30 : « Je suis au Canada et je veux faire la
> même chose qu'eux (deliverect.com/en-ca/integrations). Qu'est-ce qu'il me faut ? Démarre le projet, laisse toutes les
> notes d'abord. Prépare les courriels pour chaque partenaire. Un modèle d'affaires : on n'est pas Deliverect, on est à
> nous, mais on veut faire comme eux, à meilleur prix pour tout le monde. »
>
> - **Branche :** `docs/integration-platform-canada` (foodhubca). Tableau des agents : issue #105. Suivi : issue
>   « Plateforme d'intégrations (Canada) ». Drive : « 00 — Opérations TAKATAK » → « Plateforme d'intégrations — note
>   de reprise ».
> - **Fichiers :** ce plan ; [`research/DELIVERECT.md`](research/DELIVERECT.md) (inventaire de leurs intégrations) ;
>   [`PARTNER_OUTREACH.md`](PARTNER_OUTREACH.md) (un courriel prêt par partenaire) ; le code commence dans
>   `lib/foodhub/integrations/` (catalogue).
> - **Prochaine étape exacte :** voir la section 9 (cases à cocher). Chaque case dit qui la fait (agent ou propriétaire).
>   Suivi : issue #119. Quand un courriel part ou qu'un partenaire répond, l'inscrire dans `OUTREACH_PROGRESS`
>   (`lib/foodhub/integrations/catalog.ts`, une entrée par courriel).

## 1. Ce que Deliverect fait, en une phrase

Deliverect est un **intergiciel** (middleware) : il branche **chaque plateforme de livraison** (Uber Eats, DoorDash,
SkipTheDishes…) sur **chaque caisse** (Clover, Square, Lightspeed, Toast…), avec un menu maître, les ruptures, l'état
des magasins, la répartition des livreurs, un site de commande en ligne et des rapports. Il vit de **frais mensuels par
emplacement** payés par le restaurant, et de partenariats avec les plateformes et les caisses. Leur inventaire complet :
[`research/DELIVERECT.md`](research/DELIVERECT.md).

## 2. Ce que TAKATAK a déjà (Food Hub, en production)

| Brique Deliverect | Chez nous | Où | État |
|---|---|---|---|
| Commandes des plateformes dans la caisse | Uber Eats, DoorDash, SkipTheDishes, Too Good To Go → Clover | `lib/foodhub/adapters/*`, `lib/foodhub/pos/clover-*` | Uber Eats : 61/61 appels codés ; DoorDash : bac à sable ouvert, certification ; Skip : JET Connect demandé ; TGTG : flux partenaire |
| Menu maître publié partout, majoration par plateforme | oui | `lib/foodhub/menu/*` | en ligne |
| Ruptures (86) partout en quelques secondes | oui (depuis Clover) | `lib/foodhub/menu`, webhooks Clover | en ligne |
| Pause / mode occupé / temps de préparation | oui | adaptateurs `setStoreOnline` | en ligne |
| Répartition de livreurs (dispatch) | DoorDash Drive, Uber Direct, Skip Delivery | `lib/foodhub/delivery/*` | codé, derrière des interrupteurs |
| Site de commande directe (webshop) | vitrine ON2GO `/commander/<marque>` + paiement Clover | `lib/foodhub/storefront/*`, on2goca | en ligne (éteint par défaut par marque) |
| Rapports, rapprochement des versements | oui | `lib/foodhub/finance`, `recon`, `/insights/reports` | en ligne |
| Avis clients | oui | `/insights/reviews` | en ligne |
| Téléphone IA | TAKATAK Phone AI (app Clover séparée) | `lib/foodhub/phone` | soumis au Clover App Market |
| Surveillance + escalade (Watchtower) | **oui, au-delà de Deliverect** | `lib/foodhub/watch` | en ligne |

**Ce qui nous manque pour être « comme eux » :** (a) **d'autres caisses** que Clover ; (b) plus de **canaux** canadiens
(Ritual, Fantuan, etc.) ; (c) des **certifications officielles** (être listé « partenaire d'intégration » chez chaque
plateforme et chaque caisse) ; (d) un **portail partenaires** et une API publique pour que d'autres se branchent sur nous ;
(e) la **sécurité et la conformité** qu'exigent les grands partenaires (SOC 2, tests d'intrusion, assurance).

## 3. Ce qu'il te faut, concrètement (le « quoi faire »)

### 3.1 Entreprise et confiance (propriétaire)
1. **Une entité et une adresse d'affaires** (déjà : la société qui signe le Clover App Market) ; un **site partenaires**
   (`/hub` existe ; ajouter une page « Partenaires / Developers »).
2. **Assurance responsabilité civile + cyber** (les plateformes et caisses la demandent souvent avant la production).
3. **Sécurité** : politique écrite (accès, journalisation, incidents, sauvegardes), chiffrement des jetons (fait), puis
   **SOC 2 Type I** dans 6 à 12 mois (outils comme Vanta/Drata) ; test d'intrusion annuel. Loi 25 / LPRPDE : base de
   données à Montréal (fait) ; le serveur d'application et plusieurs fournisseurs traitent aux États-Unis (politique de
   confidentialité §5) : ne jamais écrire « les données restent au Canada » ; responsable de la protection des renseignements nommé, politique de confidentialité (fait).
4. **Contrats** : chaque programme partenaire a sa licence d'API / NDA à signer (le propriétaire signe, jamais un agent).

### 3.2 Accès aux API (une demande par partenaire — courriels prêts dans `PARTNER_OUTREACH.md`)

| Partenaire | Type | Porte d'entrée officielle | Ce qu'on demande | Accès |
|---|---|---|---|---|
| Uber Eats | plateforme | développeur Uber (formulaire d'intégration) + gestionnaire de compte Uber Eats | portées de production pour tous les magasins + liste « integration partners » Canada | approbation écrite d'Uber |
| DoorDash | plateforme | Marketplace Integration Interest Form + gestionnaire technique (TAM) | revue de certification → production ; programme « Preferred Integrations » | sur demande |
| SkipTheDishes | plateforme | partners.skipthedishes.com → équipe de compte (« custom direct integration ») | JET Connect (clé, liens magasins, webhooks), Skip Delivery (DaaS) | sur demande |
| Too Good To Go | plateforme | formulaire « Get in touch » (toogoodtogo.com, page Platform) | flux de commandes partenaire direct | sur demande |
| Ritual | plateforme | ritual.co/partners | intégration de commandes vers la caisse | à confirmer |
| Fantuan | plateforme | portail marchand (merchant.fantuanorder.com) | API marchand / intégration | à confirmer |
| Uber Direct | livreurs | compte Direct libre-service + équipe Uber Direct | API Organizations (plusieurs marchands sous nous) | libre-service, production après facturation |
| DoorDash Drive | livreurs | developer.doordash.com (Drive) | Drive pour plateformes (plusieurs marchands) | libre-service + revue |
| Trexity | livreurs (Canada) | équipe intégration Trexity (kb.trexity.com) | clé API marchands | sur demande |
| Clover | caisse (la nôtre) | Clover App Market / DevRel | niveau partenaire ; réponse écrite sur les données de marchands tiers (tranche 9 d'ON2GO) | déjà partenaire |
| Square | caisse | Developer Dashboard → App Marketplace + page partenariats | « App Partner » (pourrait être en pause : confirmer) | API ouverte, inscription App Marketplace |
| Lightspeed Restaurant (K) | caisse | programme partenaires Lightspeed (sur demande) | identifiants API K-Series | sur approbation |
| Toast | caisse | formulaire « Integration partner application » (3 étapes) | accès Partner Integrations | sur approbation, délai annoncé |
| TouchBistro | caisse | équipe « integrated partners » (adresse à confirmer) | clés API partenaire | négocié |
| PayFacto (Maître'D, Veloce) | caisses québécoises | équipe partenaires PayFacto | API de commandes en ligne | à confirmer |
| Moneris | paiement / terminaux | Moneris Developer Portal → Client Consulting | spécifications Go (Cloud / App-to-App) | sur demande |

### 3.3 Technique (agents)
1. **Contrat d'adaptateur caisse (`PosAdapter`)** comme celui des canaux (`ChannelAdapter` existe déjà) : créer la
   commande, la marquer payée, l'annuler, importer le catalogue, recevoir les ruptures, imprimer, connecter / déconnecter.
   Clover l'implémente en premier, **sans changer son comportement** (tests `verify:foodhub` 578/0 doivent rester verts).
2. **Catalogue d'intégrations** (`lib/foodhub/integrations/catalog.ts`) : chaque partenaire, son type, son état
   technique réel (en ligne / certification / codé / à demander), **séparément** l'avancement de son courriel (prêt /
   envoyé / répondu), et sa porte d'entrée. Il nourrit la console (Réglages →
   Plateformes), la page publique (seulement ce qui est **en ligne**, règle des pages publiques) et ce plan.
3. **Square d'abord** (API ouverte, bac à sable libre) pour prouver le contrat `PosAdapter` sur une 2ᵉ caisse.
4. **Portail partenaires + API publique** (plus tard) : clés par partenaire, webhooks signés (le bus `/api/suite/v1`
   existe déjà pour la TAKATAK Suite et sert de modèle).

## 4. Modèle d'affaires (le nôtre, pas celui de Deliverect)

**Principe :** même service, **prix public, simple, en dollars canadiens**, sans frais d'installation, sans contrat
annuel obligatoire, sans agrégateur entre le restaurant et ses plateformes. Nous gagnons sur le volume et sur les
modules, pas sur des frais cachés.

| Ligne de revenu | Qui paie | Prix (proposition, à approuver par le propriétaire) | Commentaire |
|---|---|---|---|
| **Food Hub** (toutes les plateformes, menus, ruptures, état des magasins, rapports, rapprochement) | restaurant | **50 $ CA / mois par emplacement**, essai 14 jours (déjà en vente sur Clover) | tout compris, pas de prix par plateforme |
| Marque supplémentaire (cuisine virtuelle) | restaurant | **+15 $ CA / plateforme / mois** (déjà en vente) | |
| Autre caisse que Clover | restaurant | même prix, facturé par Stripe (takatak-v1) ou par la place de marché de la caisse | après `PosAdapter` |
| Répartition de livreurs (Uber Direct, DoorDash Drive, Skip Delivery, Trexity) | restaurant | **coût du livreur + 0,50 $ par course** (proposition) | transparent, sans majoration cachée |
| Commande directe ON2GO (site + app) | restaurant | **0 % de commission** ; seulement les frais de carte Clover | l'argument principal contre les commissions des plateformes |
| Téléphone IA (TAKATAK Phone AI) | restaurant | 50 $ CA / mois + 0,25 $ / minute d'IA (déjà soumis) | |
| Apps de la TAKATAK Suite | restaurant | par app (Clover App Market) | |
| Revendeurs (ISO, intégrateurs, agences) | TAKATAK paie | **20 % récurrent** la 1ʳᵉ année (proposition) | |
| Partenariats caisses / plateformes | partenaire | partage de revenus ou référencement, **jamais** une commission prise au restaurant | à négocier un par un |

**Pourquoi c'est moins cher pour tout le monde :** un seul prix par emplacement (pas un prix par plateforme), aucune
installation payante (l'assistant de mise en route est dans la console), la commande directe sans commission, les
livreurs au coût, et l'équipe à Montréal en français et en anglais. Les prix de Deliverect et la comparaison chiffrée
sont dans [`research/DELIVERECT.md`](research/DELIVERECT.md) (section prix) ; on ne publie une comparaison que si leurs
prix sont publics et vérifiés à la date de publication.

**Phases de revenus :** (1) Québec, Clover, 3 grandes plateformes — en cours ; (2) Canada entier (taxes par province,
tranche 7 d'ON2GO), Square ; (3) Lightspeed, Toast, TouchBistro, PayFacto ; (4) revendeurs et API publique.

## 5. Règles qui ne bougent pas
- **Chaque plateforme n'entend parler que d'elle-même** : un courriel à DoorDash ne nomme ni Uber, ni Skip, ni TGTG, et
  l'inverse. Food Hub, Clover et UrbanPiper peuvent être nommés.
- Les courriels sont **envoyés par le propriétaire**, depuis l'adresse de l'entreprise ; un agent ne signe ni n'accepte
  aucune licence, NDA ou condition.
- Po Poulet NDG (DoorDash 27982486) n'est jamais touché, ni mentionné dans une demande.
- Page publique : seulement ce qui est **en ligne** (« Certification en cours » sinon), aucun nom de concurrent.
- Dépôt public : aucun secret, numéro de dossier, courriel ou téléphone de personne.

## 6. Risques
- Certaines plateformes réservent leur API aux partenaires approuvés : délais de semaines ou de mois.
- Square aurait mis en pause les nouveaux « App Partners » (réponse d'un employé sur leur forum, 2026) : à confirmer.
- Une 2ᵉ caisse veut dire une 2ᵉ facturation (hors Clover App Market) : décision du propriétaire.
- Les conditions Clover sur les données d'un marchand dans un autre marché (tranche 9 d'ON2GO) : réponse écrite à obtenir.

## 7. Qui fait quoi
| Propriétaire | Agents |
|---|---|
| Envoyer les courriels de `PARTNER_OUTREACH.md`, signer licences et NDA, choisir les prix, assurance, SOC 2 | Code (`PosAdapter`, catalogue, Square), docs, suivi des réponses dans le catalogue, tests |

## 8. English summary
Goal: a Canadian, TAKATAK-owned integration platform that does what Deliverect does (every delivery platform into every
POS, master menu, sold-out sync, store status, courier dispatch, direct ordering, reports), at a simple public price.
Food Hub already does most of it on Clover with Uber Eats, DoorDash, SkipTheDishes and Too Good To Go. Missing: more POS
(PosAdapter, Square first), more Canadian channels, official partner certifications, a partner portal/API, and SOC 2.
Outreach emails, one per partner and each naming only that partner, are in `PARTNER_OUTREACH.md`; the owner sends them.

## 9. Prochaines étapes (cocher en avançant, signer chaque ligne)
- [x] Plan, modèle d'affaires, liste des portes d'entrée (ce fichier) — busy-cannon, 2026-10-29
- [x] Inventaire Deliverect complet (131 intégrations canadiennes ; prix non publiés) → `research/DELIVERECT.md` — busy-cannon
- [x] 17 courriels prêts, un par partenaire → `PARTNER_OUTREACH.md` — busy-cannon
- [x] Catalogue `lib/foodhub/integrations/catalog.ts` + `tests/integrations-catalog.test.ts` (états réels, un courriel par ligne, règle « chaque plateforme n'entend parler que d'elle-même » vérifiée) — busy-cannon
- [ ] Afficher le catalogue dans la console (Réglages → Plateformes) — agent libre
- [ ] Propriétaire : approuver les prix de la section 4
- [ ] Propriétaire : envoyer les courriels ; noter chaque réponse dans le catalogue (agent)
- [ ] Contrat `PosAdapter` + Clover derrière, sans changement de comportement — agent libre
- [ ] Square (bac à sable) derrière `PosAdapter` — agent libre, après la décision de facturation
- [ ] Page publique « Partenaires / Developers » — agent libre

— signé : Claude (busy-cannon, Claude Code cloud) @ cloud · 2026-10-29 23:50 (HE)
