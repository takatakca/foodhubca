# Caisse photo Clover / Clover picture register — résumé d'une page / one-page summary

> Recherche et architecture seulement : aucun code, aucune variable d'environnement, aucun déploiement.
> Research and architecture only: no code, no env, no deploy. Everything was read on **2026-10-23**, and a
> fact-check pass (PR #98 review) was applied the same day.
> Labels used in every file: **FACT** = read in a cited source; **INFERENCE** = our reasoning from facts;
> **UNCONFIRMED** = seen only in a search snippet or a page we could not open.

Files in this folder:

| File | What it holds |
|---|---|
| [RESEARCH_CLOVER_TECH.md](RESEARCH_CLOVER_TECH.md) | What Clover allows: app types, devices, SDK levels, images, orders, payment, kiosk rules, printing, approval |
| [LEGAL_AND_MARKET.md](LEGAL_AND_MARKET.md) | Québec rules (SRM/WEB-SRM, French, prices, photos, tips, alcohol), competitors and prices, questions for a lawyer |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Device app vs web, data flow, reuse of Food Hub code, diagram |
| [ROADMAP.md](ROADMAP.md) | P0 prerequisites, P1 MVP, P2 kiosk, acceptance checks, App Market checklist |
| [OWNER_DECISIONS.md](OWNER_DECISIONS.md) | Numbered decisions for Matthieu, one recommended option each |

---

## FR — En bref

**L'idée.** Une appli Clover qui transforme l'écran de caisse en **photos** : une grande tuile par plat, comme
un écran de restaurant-minute. On touche la photo au lieu d'un bouton texte.

**Ce que vous avez vu existe déjà, mais surtout côté client (borne).** Clover Kiosk (Clover ; vendu au Canada
sauf au Québec, en anglais seulement), GRUBBRR (borne Samsung + terminal Clover), Self Checkout de LoyLap (sur Flex,
Mini, Station Solo), Samsung Ordering Kiosk et le mode borne de Clover Sport affichent tous un menu en photos. **Dans
notre recherche du 2026-10-23, nous n'avons trouvé aucune appli de caisse en photos pour le personnel** (la doc
Clover cite pourtant « Menu with photos » comme type d'appli : d'autres peuvent exister).

**Notre recommandation : faire les deux, dans cet ordre.**

1. **D'abord la caisse photo du personnel (P1).** C'est une **appli Android** (Kotlin) installée sur l'appareil
   Clover : l'écran marchand de votre Station Duo, puis Mini 3 et Flex 3/4.
   - Food Hub et Phone AI sont des applis web. Une appli web s'ouvre depuis le tableau de bord marchand (FACT) ;
     elle ne peut donc pas servir d'écran de caisse (INFERENCE).
   - L'appli tourne **à côté** de la caisse Clover. Elle ne la remplace pas et ne la maquille pas.
   - Elle crée de **vraies commandes Clover** (articles, options, Duo/Trio/Combo) et les envoie en cuisine par
     Clover. Les rapports, les taxes et le reçu restent dans Clover.
   - Le paiement passe **seulement** par l'écran de paiement sécurisé de Clover (Payment Connector au Canada).
     Nous ne touchons jamais aux données de carte.
2. **Ensuite la borne libre-service en français (P2).**
   - Clover Kiosk est vendu au Canada, mais en anglais seulement et pas au Québec (FACT : note de
     clover.com/ca/kiosk, en anglais, traduite ici). Une borne **française d'abord** est donc un vrai créneau au
     Québec ; ailleurs au Canada, Clover Kiosk fait concurrence et le français reste notre atout.
   - Deux façons : (a) mode client plein écran sur un Mini, Flex ou Station ; (b) un grand écran (tablette ou
     écran 24 po) relié à un Mini ou Flex qui prend le paiement (semi-intégration Clover, approbation séparée).
   - Clover n'autorise ses appareils qu'en usage **surveillé ou semi-surveillé** (FACT). Pour nous, cela veut dire
     un employé dans la salle (INFERENCE : Clover renvoie à une FAQ PCI pour la définition).

**Les photos.** L'API Clover ne donne pas d'adresse d'image officielle (FACT). Nos photos Food Hub (`/media`)
seront donc la source principale ; les photos Clover ne serviront qu'en appoint.

**Risques principaux.**

| Risque | Gravité | Ce qu'on fait |
|---|---|---|
| **MEV / SRM de Revenu Québec.** Clover exige la certification SRM pour les applis de restaurant au Canada. Dans le scénario de Revenu Québec, l'employé saisit la commande dans le SEV certifié : une caisse qui prend la commande fait probablement partie du SEV. | **Bloquant pour le Québec** | Hypothèse : au Québec, la caisse fait partie du SEV tant que Revenu Québec n'a pas dit le contraire par écrit. Questions à Revenu Québec, à Clover et aux deux concepteurs MEV de tiers (Pulsar informatique Inc pour « Clover MEV Connect » ; 15535743 Canada inc. pour « Clover MEV Web »). Aucun restaurant québécois dans une fiche ou une vente avant leurs réponses ; budget prévu pour notre propre certification (décision 6). |
| Taxe Clover parasite « Sales Tax » (0,14975 %) sur presque tous les articles | Élevée | Le propriétaire la retire ; l'appli bloque l'envoi si un article porte une autre taxe que TPS / TVQ. |
| Photos Clover non officielles | Élevée | Nos propres photos d'abord. Demander l'accès « commande en ligne » à Clover. |
| Usage sans surveillance interdit | Élevée | Borne « au comptoir, personnel présent », écrit dans la fiche et la vidéo. |
| Un seul espace pour tous les marchands (console unique) | Élevée | Isolation par marchand avant tout marchand extérieur. |
| Nom anglais proche de « Register » (la caisse intégrée de Clover) | Moyenne | Les règles Clover interdisent les noms qui ressemblent aux applis Clover de l'appareil : changer le nom anglais avant la soumission, ou accord écrit de Clover (décision 8). |
| Délai d'approbation Clover | Moyenne | Vos restaurants d'abord (appli approuvée non publiée), visuel 100 % original (rien de McDonald's ni de Clover). |
| Pas de paiement carte hors ligne au Canada | Moyenne | Écran clair « paiement carte indisponible », la commande reste possible. |

**Décisions à prendre :** voir [OWNER_DECISIONS.md](OWNER_DECISIONS.md) (11 décisions, chacune avec l'option
recommandée). La première vérification concrète : **votre Station Duo est-elle une Duo 1 ou une Duo 2 ?**

**Fiches Clover (brouillons, état au 2026-10-23).** La caisse photo a son propre brouillon « TAKATAK Picture
Register » / « Caisse en images TAKATAK » (J0H36VTJBSBBP, type d'appli laissé vide exprès). Le brouillon
N4NYCJCZ17FF4 s'appelle maintenant « ON2GO » (accroches et avantages FR/EN enregistrés ; il garde le type Android
(Mobile) + REST et une ancienne permission Customers lecture + écriture que le propriétaire peut retirer). L'appli
TAKATAK (fiches, réseaux) est F4TMP23FM7K5M. Le conflit de brouillon est réglé (décision 2).

**Liens avec les autres projets.** L'appli « TAKATAK » (fiches, réseaux sociaux, menus ; dépôt takatak-v1,
branche `docs/clover-takatak-app-research`) et l'appli ON2GO gratuite (dépôt on2goca, branche
`docs/on2go-free-clover-app`) sont étudiées en parallèle. La caisse photo **partage** la même banque de photos
et la même source de menu ; elle ne crée pas une deuxième chaîne de photos.

---

## EN — In short

**The idea.** A Clover app that turns the register screen into **pictures**: one big tile per dish, like a
fast-food ordering screen. Staff tap the photo instead of a text button.

**What the owner saw already exists, but mostly on the customer side (kiosks).** Clover Kiosk (first-party;
sold in Canada except Québec, English only), GRUBBRR (Samsung kiosk + Clover payment device), LoyLap Self Checkout
(on Flex, Mini, Station Solo), Samsung Ordering Kiosk and Clover Sport kiosk mode all show a photo menu. **In our
search on 2026-10-23 we found no staff-side picture register app** (Clover's docs do list "Menu with photos" as an
app type, so others may exist).

**Recommendation: build both, in this order.**

1. **Staff picture register first (P1).** An **Android app** (Kotlin) on the Clover device: the Station Duo
   merchant screen, then Mini 3 and Flex 3/4.
   - Food Hub and Phone AI are web apps. A web app launches from the Merchant Dashboard (FACT), so it cannot be
     the register screen (INFERENCE).
   - It runs **beside** Clover's Register. It does not replace or reskin it.
   - It writes **real Clover orders** (items, modifiers, Duo/Trio/Combo) and fires them to the kitchen through
     Clover. Reports, tax and the receipt stay in Clover.
   - Card payment goes **only** through Clover's secure payment screen (Payment Connector in Canada). We never
     touch card data.
2. **French-first self-order kiosk second (P2).**
   - Clover Kiosk "is available in English only and not offered in the province of Quebec" (FACT, footnote on
     clover.com/ca/kiosk, which sells it elsewhere in Canada through "Contact sales"). A French-first kiosk is a real
     gap in Québec; outside Québec, Clover Kiosk competes directly and French is our edge.
   - Two ways: (a) full-screen customer mode on a Mini, Flex or Station; (b) a big screen (tablet or 24" screen)
     paired with a Mini or Flex that takes the payment (Clover semi-integration, a separate approval track).
   - Clover devices are certified only for **attended or semi-attended** use (FACT). We read that as staff in the
     room (INFERENCE: Clover points to a PCI FAQ for the definition).

**Photos.** Clover's API gives no official image URL (FACT). Our own Food Hub photos (`/media`) will drive the
tiles; Clover photos are only an optional seed.

**Top risks.**

| Risk | Severity | What we do |
|---|---|---|
| **Revenu Québec SRM / WEB-SRM.** Clover requires SRM certification for Canadian restaurant apps. In Revenu Québec's scenario the user enters the order in the certified SRS: a register that takes the order is probably part of the SRS. | **Blocker for Québec** | Assumption: in Québec, the register is part of the SRS until Revenu Québec says in writing that it is not. Questions to Revenu Québec, Clover and both third-party MEV vendors (Pulsar informatique Inc for "Clover MEV Connect"; 15535743 Canada inc. for "Clover MEV Web"). No Québec restaurant in any listing or sale before they answer; budget for our own certification (decision 6). |
| Stray Clover "Sales Tax" rate (0.14975 %) on almost every item | High | The owner removes it; the app blocks "Send" when an item carries a tax other than GST / QST. |
| Unofficial Clover photo access | High | Our own photos first. Ask Clover for online-ordering (OLO) data permission. |
| Unattended use is banned | High | Position the kiosk as "counter self-order, staff present", in the listing and the video. |
| Single-tenant console | High | Per-merchant isolation before any outside merchant. |
| English name close to "Register" (Clover's built-in register) | Medium | Clover's policies forbid names confusingly similar to Clover apps on the device: change the English name before submission, or get Clover's written OK (decision 8). |
| Clover approval delay | Medium | Owner's restaurants first (approved, unpublished app); 100 % original look (nothing from McDonald's or Clover). |
| No offline card payments in Canada | Medium | Clear "card payment unavailable" state; the order can still be built. |

**Decisions:** see [OWNER_DECISIONS.md](OWNER_DECISIONS.md) (11 decisions, each with a recommended option).
First concrete check: **is the owner's Station Duo a Duo 1 or a Duo 2?**

**Clover app records (drafts, status on 2026-10-23).** The register has its own draft "TAKATAK Picture Register" /
"Caisse en images TAKATAK" (J0H36VTJBSBBP, app type intentionally unset). Draft N4NYCJCZ17FF4 is now "ON2GO" (FR/EN
taglines and benefits saved; it keeps App type Android (Mobile) + REST and an earlier Read + Write Customers
permission the owner may remove). The TAKATAK app (listings, social) is F4TMP23FM7K5M. The draft conflict is settled
(decision 2).

**Links to the parallel projects.** The "TAKATAK" app (listings, social, menus; repo takatak-v1, branch
`docs/clover-takatak-app-research`) and the free ON2GO app (repo on2goca, branch `docs/on2go-free-clover-app`)
are being researched in parallel. The picture register **shares** the same photo store and menu source; it does
not build a second photo pipeline.

> Not legal advice. Every legal point here is research to validate with a Québec lawyer
> (see [LEGAL_AND_MARKET.md](LEGAL_AND_MARKET.md)).
