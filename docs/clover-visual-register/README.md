# Caisse photo Clover / Clover picture register — résumé d'une page / one-page summary

> Recherche et architecture seulement : aucun code, aucune variable d'environnement, aucun déploiement.
> Research and architecture only: no code, no env, no deploy. Everything was read on **2026-10-23**.
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

**Ce que vous avez vu existe déjà, mais surtout côté client (borne).** Clover Kiosk (Clover, États-Unis),
GRUBBRR (borne Samsung + terminal Clover), Self Checkout de LoyLap (sur Flex, Mini, Station Solo), Samsung
Ordering Kiosk et le mode borne de Clover Sport affichent tous un menu en photos. **Nous n'avons trouvé aucune
appli de caisse en photos pour le personnel.**

**Notre recommandation : faire les deux, dans cet ordre.**

1. **D'abord la caisse photo du personnel (P1).** C'est une **appli Android** (Kotlin) installée sur l'appareil
   Clover : l'écran marchand de votre Station Duo, puis Mini 3 et Flex 3/4.
   - Food Hub et Phone AI sont des applis web. Une appli web s'ouvre seulement depuis le tableau de bord
     marchand, jamais comme écran de caisse (FACT).
   - L'appli tourne **à côté** de la caisse Clover. Elle ne la remplace pas et ne la maquille pas.
   - Elle crée de **vraies commandes Clover** (articles, options, Duo/Trio/Combo) et les envoie en cuisine par
     Clover. Les rapports, les taxes et le reçu restent dans Clover.
   - Le paiement passe **seulement** par l'écran de paiement sécurisé de Clover (Payment Connector au Canada).
     Nous ne touchons jamais aux données de carte.
2. **Ensuite la borne libre-service en français (P2).**
   - Clover Kiosk « est offert en anglais seulement et n'est pas offert au Québec » (FACT, lu sur
     clover.com/ca/kiosk). Une borne **française d'abord** pour le Québec est donc un vrai créneau.
   - Deux façons : (a) mode client plein écran sur un Mini, Flex ou Station ; (b) un grand écran (tablette ou
     écran 24 po) relié à un Mini ou Flex qui prend le paiement (semi-intégration Clover, approbation séparée).
   - Clover n'autorise ses appareils qu'en usage **surveillé ou semi-surveillé** : un employé doit être dans la
     salle (FACT).

**Les photos.** L'API Clover ne donne pas d'adresse d'image officielle (FACT). Nos photos Food Hub (`/media`)
seront donc la source principale ; les photos Clover ne serviront qu'en appoint.

**Risques principaux.**

| Risque | Gravité | Ce qu'on fait |
|---|---|---|
| **MEV / SRM de Revenu Québec.** Clover exige la certification SRM pour les applis de restaurant au Canada. Une caisse qui produit la facture du client est probablement un SEV à certifier. | **Bloquant pour vendre au Québec** | L'appli crée seulement la commande ; la facture vient de Clover et de l'appli MEV certifiée du marchand (« Clover MEV Connect » ou « Clover MEV Web », toutes deux sur la liste de Revenu Québec). Réponse écrite de Clover et de Revenu Québec avant toute vente. |
| Photos Clover non officielles | Élevée | Nos propres photos d'abord. Demander l'accès « commande en ligne » à Clover. |
| Usage sans surveillance interdit | Élevée | Borne « au comptoir, personnel présent », écrit dans la fiche et la vidéo. |
| Un seul espace pour tous les marchands (console unique) | Élevée | Isolation par marchand avant tout marchand extérieur. |
| Brouillon « on2go » voulu par deux projets | Moyenne | Le laisser à l'appli ON2GO gratuite ; créer une nouvelle fiche Android pour la caisse photo (décision 2). |
| Délai d'approbation Clover | Moyenne | Vos restaurants d'abord (appli approuvée non publiée), visuel 100 % original (rien de McDonald's ni de Clover). |
| Pas de paiement carte hors ligne au Canada | Moyenne | Écran clair « paiement carte indisponible », la commande reste possible. |

**Décisions à prendre :** voir [OWNER_DECISIONS.md](OWNER_DECISIONS.md) (11 décisions, chacune avec l'option
recommandée). La première vérification concrète : **votre Station Duo est-elle une Duo 1 ou une Duo 2 ?**

**Liens avec les autres projets.** L'appli « TAKATAK » (fiches, réseaux sociaux, menus ; dépôt takatak-v1,
branche `docs/clover-takatak-app-research`) et l'appli ON2GO gratuite (dépôt on2goca, branche
`docs/on2go-free-clover-app`) sont étudiées en parallèle. La caisse photo **partage** la même banque de photos
et la même source de menu ; elle ne crée pas une deuxième chaîne de photos.

---

## EN — In short

**The idea.** A Clover app that turns the register screen into **pictures**: one big tile per dish, like a
fast-food ordering screen. Staff tap the photo instead of a text button.

**What the owner saw already exists, but mostly on the customer side (kiosks).** Clover Kiosk (first-party,
US), GRUBBRR (Samsung kiosk + Clover payment device), LoyLap Self Checkout (on Flex, Mini, Station Solo),
Samsung Ordering Kiosk and Clover Sport kiosk mode all show a photo menu. **We found no staff-side picture
register app.**

**Recommendation: build both, in this order.**

1. **Staff picture register first (P1).** An **Android app** (Kotlin) on the Clover device: the Station Duo
   merchant screen, then Mini 3 and Flex 3/4.
   - Food Hub and Phone AI are web apps. A web app opens only from the Merchant Dashboard, never as a register
     screen (FACT).
   - It runs **beside** Clover's Register. It does not replace or reskin it.
   - It writes **real Clover orders** (items, modifiers, Duo/Trio/Combo) and fires them to the kitchen through
     Clover. Reports, tax and the receipt stay in Clover.
   - Card payment goes **only** through Clover's secure payment screen (Payment Connector in Canada). We never
     touch card data.
2. **French-first self-order kiosk second (P2).**
   - Clover Kiosk "is available in English only and not offered in the province of Quebec" (FACT, read on
     clover.com/ca/kiosk). A French-first kiosk for Québec is a real gap.
   - Two ways: (a) full-screen customer mode on a Mini, Flex or Station; (b) a big screen (tablet or 24" screen)
     paired with a Mini or Flex that takes the payment (Clover semi-integration, a separate approval track).
   - Clover devices are certified only for **attended or semi-attended** use: staff must be in the room (FACT).

**Photos.** Clover's API gives no official image URL (FACT). Our own Food Hub photos (`/media`) will drive the
tiles; Clover photos are only an optional seed.

**Top risks.**

| Risk | Severity | What we do |
|---|---|---|
| **Revenu Québec SRM / WEB-SRM.** Clover requires SRM certification for Canadian restaurant apps. A register that produces the customer's bill is likely an SRS that needs certification. | **Blocker for Québec sales** | The app only builds the order; the bill comes from Clover and the merchant's certified MEV app ("Clover MEV Connect" or "Clover MEV Web", both on Revenu Québec's list). Written answers from Clover and Revenu Québec before any sale. |
| Unofficial Clover photo access | High | Our own photos first. Ask Clover for online-ordering (OLO) data permission. |
| Unattended use is banned | High | Position the kiosk as "counter self-order, staff present", in the listing and the video. |
| Single-tenant console | High | Per-merchant isolation before any outside merchant. |
| "on2go" draft wanted by two projects | Medium | Leave it to the free ON2GO app; create a new Android app record for the register (decision 2). |
| Clover approval delay | Medium | Owner's restaurants first (approved, unpublished app); 100 % original look (nothing from McDonald's or Clover). |
| No offline card payments in Canada | Medium | Clear "card payment unavailable" state; the order can still be built. |

**Decisions:** see [OWNER_DECISIONS.md](OWNER_DECISIONS.md) (11 decisions, each with a recommended option).
First concrete check: **is the owner's Station Duo a Duo 1 or a Duo 2?**

**Links to the parallel projects.** The "TAKATAK" app (listings, social, menus; repo takatak-v1, branch
`docs/clover-takatak-app-research`) and the free ON2GO app (repo on2goca, branch `docs/on2go-free-clover-app`)
are being researched in parallel. The picture register **shares** the same photo store and menu source; it does
not build a second photo pipeline.

> Not legal advice. Every legal point here is research to validate with a Québec lawyer
> (see [LEGAL_AND_MARKET.md](LEGAL_AND_MARKET.md)).
