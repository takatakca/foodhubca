# Courriels aux partenaires (prêts à envoyer) / Partner outreach emails

Ordre du propriétaire, 2026-10-29 : « Prépare la liste de tous les courriels prêts à envoyer pour dire qu'on veut
s'intégrer, qu'on veut être partenaires, et voir ce qu'ils disent. » Plan : [`INTEGRATION_PLATFORM.md`](INTEGRATION_PLATFORM.md).

## Comment s'en servir (lire avant d'envoyer)
1. **Le propriétaire envoie**, depuis l'adresse de l'entreprise. Un agent n'envoie rien, ne signe et n'accepte aucune
   licence, NDA ou condition.
2. Remplacer les crochets : `[Nom]`, `[Titre]`, `[Téléphone]`, `[Courriel]`, `[Raison sociale]`. Rien de personnel
   n'est écrit dans ce dépôt public.
3. **Chaque partenaire n'entend parler que de lui-même** : aucun courriel ne nomme une autre plateforme de livraison.
   Food Hub et Clover peuvent être nommés.
4. Plusieurs portes d'entrée sont des **formulaires web**, pas des adresses : copier le texte dans le formulaire.
   Les portes marquées *(à confirmer)* viennent d'une source secondaire : vérifier sur le site du partenaire avant.
5. Après l'envoi : noter la date et la réponse dans le tableau de la fin (ou demander à un agent de le faire) ; l'agent
   inscrit l'avancement dans `OUTREACH_PROGRESS` de `lib/foodhub/integrations/catalog.ts` (une entrée par courriel,
   par exemple `A3: 'sent'`, puis `'answered'`), sans toucher à l'état technique des lignes.

## Signature commune (à coller à la fin de chaque courriel)

```
[Nom] — [Titre]
TAKATAK Food Hub · [Raison sociale] · Montréal (Québec)
[Téléphone] · [Courriel] · https://foodhub.on2go.ca/hub
```

## Phrase de présentation commune (déjà incluse dans chaque courriel)
EN: *TAKATAK Food Hub is a Montréal-built order management hub for restaurants: delivery orders go straight into the
restaurant's register and kitchen printer, with one master menu, sold-out sync, store status and payout checks. It runs
in production in our own kitchens in Montréal and is submitted to the Clover App Market. Its database is hosted in
Montréal (Canada), and it is bilingual French / English.*

---

## A. Plateformes de livraison / Delivery marketplaces

### A1. Uber Eats — production et liste des partenaires d'intégration
- **Porte d'entrée :** gestionnaire de compte Uber Eats (affaires) + formulaire de support d'intégration sur
  developer.uber.com (Eats Marketplace) ; page « integration partners » d'Uber Eats (« Is your technology platform
  missing? »). Accès sur approbation écrite d'Uber.
- **En bref (FR) :** on a codé toute l'API Marketplace ; on demande la production pour tous nos magasins et l'inscription
  comme partenaire d'intégration au Canada.

**Subject:** Uber Eats Marketplace API — production access and integration partner listing (Canada) — TAKATAK Food Hub

> Hello Uber Eats Partnerships team,
>
> TAKATAK Food Hub is a Montréal-built order management hub for restaurants: delivery orders go straight into the
> restaurant's register and kitchen printer, with one master menu, sold-out sync, store status and payout checks. It runs
> in production in our own kitchens in Montréal and is submitted to the Clover App Market. Its database is hosted in
> Montréal (Canada).
>
> We have implemented the Uber Eats Marketplace APIs end to end (store provisioning, menus, item availability, orders,
> store status, prep time, reports and webhooks), with automated tests. We would like to:
> 1. obtain production access for all of our stores and for the restaurants that choose Food Hub;
> 2. be listed as an Uber Eats integration partner in Canada;
> 3. know the certification steps and any requirements we should meet first.
>
> Could you tell us who our contact is for this, and the next steps? We are glad to run a demo or a certification call
> at your convenience.
>
> Thank you,
> [signature]

### A2. DoorDash — revue de certification, production et programme « Preferred Integrations »
- **Porte d'entrée :** « Marketplace Integration Interest Form » (developer.doordash.com → Requesting access) et le
  gestionnaire technique (TAM) DoorDash. Notre bac à sable est déjà ouvert (organisation « FoodHub By Takatak »).
- **En bref (FR) :** bac à sable fait ; on demande la revue de certification, la production, et l'entrée au programme
  « Preferred Integrations ».

**Subject:** DoorDash Marketplace — certification review and production access (Canada) — TAKATAK Food Hub

> Hello DoorDash Integrations team,
>
> TAKATAK Food Hub is a Montréal-built order management hub for restaurants: delivery orders go straight into the
> restaurant's register and kitchen printer, with one master menu, sold-out sync, store status and payout checks. It runs
> in production in our own kitchens in Montréal and is submitted to the Clover App Market.
>
> DoorDash opened Marketplace sandbox access for our organization ("FoodHub By Takatak"), and our integration covers
> orders, menus, item availability (including availability polling), store status, Dasher status, adjustments and
> cancellations. We would like to:
> 1. schedule our certification review and move to production;
> 2. learn how to join the DoorDash Preferred Integrations Program;
> 3. confirm any requirements for onboarding restaurants in Canada (Québec first).
>
> Could you connect us with our technical account manager or the right team?
>
> Thank you,
> [signature]

### A3. SkipTheDishes — intégration directe JET Connect et livraison Skip
- **Porte d'entrée :** partners.skipthedishes.com → équipe de compte (« custom direct integration »).
- **En bref (FR) :** on a codé JET Connect selon leur spécification publiée ; on demande les accès (clé, liens des
  magasins, webhooks) et Skip Delivery pour nos commandes directes.

**Subject:** SkipTheDishes — direct POS integration (JET Connect) for TAKATAK Food Hub restaurants

> Hello SkipTheDishes Partner team,
>
> TAKATAK Food Hub is a Montréal-built order management hub for restaurants: orders go straight into the restaurant's
> register and kitchen printer, with one master menu, sold-out sync, store status and payout checks. It runs in
> production in our own kitchens in Montréal and is submitted to the Clover App Market.
>
> We have built our integration on the published JET Connect specification (orders, sent-to-POS status, menus, item
> availability, online / offline, driver and cancellation notifications). We would like to become a direct integration
> partner for SkipTheDishes restaurants and ask for:
> 1. JET Connect credentials and the linking of our restaurants to our store ids;
> 2. registration of our webhook addresses;
> 3. Skip Delivery (delivery as a service) access for orders placed on our restaurants' own websites.
>
> Could you tell us whether we qualify for a custom direct integration and what the next steps are?
>
> Thank you,
> [signature]

### A4. Too Good To Go — flux de commandes partenaire direct
- **Porte d'entrée :** formulaire « Get in touch » / demande d'affaires sur la page Platform de toogoodtogo.com.
- **En bref (FR) :** on veut recevoir les commandes de paniers directement dans Food Hub et la caisse.

**Subject:** Too Good To Go — direct partner order feed for TAKATAK Food Hub (Canada)

> Hello Too Good To Go Partnerships team,
>
> TAKATAK Food Hub is a Montréal-built order management hub for restaurants and food stores: orders go straight into
> the register and kitchen printer, with store status and payout checks. It runs in production in our own kitchens in
> Montréal and is submitted to the Clover App Market.
>
> Our restaurants sell Surprise Bags on Too Good To Go. We would like to receive those reservations directly in Food Hub
> (and the register), confirm pickups, and read bag counts, through an official partner feed or API. Do you offer a
> partner integration for order-management systems in Canada, and what would the steps be?
>
> Thank you,
> [signature]

### A5. Ritual — intégration des commandes
- **Porte d'entrée :** ritual.co/partners *(contact à confirmer sur leur page partenaires)*.

**Subject:** Ritual — order integration partnership with TAKATAK Food Hub (Canada)

> Hello Ritual Partnerships team,
>
> TAKATAK Food Hub is a Montréal-built order management hub for restaurants: orders go straight into the restaurant's
> register and kitchen printer, with one master menu, sold-out sync and store status. It runs in production in our own
> kitchens in Montréal and is submitted to the Clover App Market.
>
> We would like to bring Ritual orders into Food Hub for the restaurants that use it, with menu and availability sync.
> Do you offer an integration API or partner program for order-management systems, and who should we speak with?
>
> Thank you,
> [signature]

### A6. Fantuan — intégration des commandes
- **Porte d'entrée :** portail marchand Fantuan (merchant.fantuanorder.com) *(contact partenaires à confirmer)*.

**Subject:** Fantuan — order integration partnership with TAKATAK Food Hub (Canada)

> Hello Fantuan Partnerships team,
>
> TAKATAK Food Hub is a Montréal-built order management hub for restaurants: orders go straight into the restaurant's
> register and kitchen printer, with one master menu, sold-out sync and store status. It runs in production in our own
> kitchens in Montréal and is submitted to the Clover App Market.
>
> We would like to receive Fantuan orders in Food Hub for the restaurants that sell on Fantuan in Canada, with menu and
> availability sync. Do you offer a merchant or partner API, and who should we contact?
>
> Thank you,
> [signature]

### A7. HungryPanda — intégration des commandes
- **Porte d'entrée :** *à trouver* (page marchands ou partenaires de HungryPanda au Canada) : vérifier sur leur site.

**Subject:** HungryPanda — order integration partnership with TAKATAK Food Hub (Canada)

> Hello HungryPanda Partnerships team,
>
> TAKATAK Food Hub is a Montréal-built order management hub for restaurants: orders go straight into the restaurant's
> register and kitchen printer, with one master menu, sold-out sync and store status. It runs in production in our own
> kitchens in Montréal and is submitted to the Clover App Market.
>
> We would like to receive HungryPanda orders in Food Hub for the restaurants that sell on HungryPanda in Canada, with
> menu and availability sync. Do you offer a merchant or partner API, and who should we contact?
>
> Thank you,
> [signature]

---

## B. Livraison (livreurs) / Delivery fulfilment

### B1. Uber Direct — plusieurs marchands sous Food Hub
- **Porte d'entrée :** compte Uber Direct (libre-service, onglet Developer) + équipe commerciale Uber Direct.
- **En bref (FR) :** notre intégration Uber Direct est codée ; on demande l'API « Organizations » pour gérer les
  livraisons de plusieurs restaurants.

**Subject:** Uber Direct — platform access (Organizations API) for TAKATAK Food Hub restaurants in Canada

> Hello Uber Direct team,
>
> TAKATAK Food Hub is a Montréal-built order management hub for restaurants, with direct online ordering for each
> restaurant. Our Uber Direct integration (quotes, deliveries, tracking, webhooks) is built and tested. We would like to
> offer Uber Direct to every restaurant on Food Hub and ask about platform access (the Organizations API, billing per
> restaurant) and any partner program for Canada.
>
> Who would be the right contact?
>
> Thank you,
> [signature]

### B2. DoorDash Drive — Drive pour plateformes
- **Porte d'entrée :** developer.doordash.com (Drive) + équipe Drive partenariats.

**Subject:** DoorDash Drive — platform partnership for TAKATAK Food Hub restaurants in Canada

> Hello DoorDash Drive team,
>
> TAKATAK Food Hub is a Montréal-built order management hub for restaurants, with direct online ordering for each
> restaurant. Our DoorDash Drive integration (quotes, deliveries, Dasher status, address components) is built and
> tested. We would like to offer Drive to every restaurant on Food Hub: could you tell us about Drive for platforms
> (several merchants under one integration) and the steps for Canada?
>
> Thank you,
> [signature]

### B3. Trexity — livraison locale canadienne
- **Porte d'entrée :** équipe intégration Trexity (adresse indiquée dans leur centre d'aide : `merchant@trexity.com`).

**Subject:** Trexity — API integration with TAKATAK Food Hub (Montréal)

> Hello Trexity Integration team,
>
> TAKATAK Food Hub is a Montréal-built order management hub for restaurants, with direct online ordering for each
> restaurant. We would like to offer Trexity delivery to the restaurants on Food Hub (quotes, booking, tracking) through
> your developer API. Could you share API access for a platform partner and your coverage in Montréal and Québec?
>
> Thank you,
> [signature]

---

## C. Caisses / POS

### C1. Clover — niveau partenaire et question écrite sur les données
- **Porte d'entrée :** Clover Developer Relations (portail développeurs Clover / contact de revue de l'App Market).
- **En bref (FR) :** nous sommes déjà une app Clover ; on demande le niveau partenaire et une réponse écrite à la
  question de la tranche 9 d'ON2GO.

**Subject:** TAKATAK Food Hub (Clover App Market) — partner program and a written policy question

> Hello Clover Developer Relations,
>
> TAKATAK Food Hub (and TAKATAK Phone AI) were submitted to the Clover App Market on 2026-10-17. Food Hub brings
> delivery orders into Clover with an order type and a tender per channel, one master menu built from the Clover
> inventory, and sold-out sync from Clover.
>
> 1. We would like to join the Clover partner program at the right level for an order-management app in Canada.
> 2. A written question: may a merchant who installs our app have its Clover menu displayed on our consumer ordering
>    site (on2go.ca), and under which conditions of the developer terms?
>
> Thank you,
> [signature]

### C2. Square — partenaire d'application
- **Porte d'entrée :** Developer Dashboard → App Marketplace (soumission) ; page squareup.com/ca/en/partnerships
  (App Partner). Un employé de Square a écrit en 2026 que les nouveaux « App Partners » formels étaient en pause :
  demander l'état actuel.

**Subject:** Square App Marketplace — TAKATAK Food Hub (order management for restaurants, Canada)

> Hello Square App Partnerships team,
>
> TAKATAK Food Hub is a Montréal-built order management hub for restaurants: delivery and online orders go straight into
> the register and kitchen printer, with one master menu, sold-out sync, store status and payout checks. It runs in
> production today and is bilingual French / English, with its database hosted in Montréal (Canada).
>
> We are building our Square integration (Orders, Catalog, Inventory, webhooks) and plan to publish it on the Square App
> Marketplace in Canada. Could you tell us whether App Partner applications are open, and the review steps and
> requirements we should meet?
>
> Thank you,
> [signature]

### C3. Lightspeed (Restaurant K-Series) — programme partenaires (bilingue)
- **Porte d'entrée :** programme partenaires Lightspeed (demande d'adhésion ; accès API sur approbation)
  *(page de demande à confirmer sur lightspeedhq.com)*.

**Objet / Subject:** Partenariat d'intégration Lightspeed Restaurant — TAKATAK Food Hub (Montréal)

> Bonjour à l'équipe Partenaires de Lightspeed,
>
> TAKATAK Food Hub est une plateforme de gestion des commandes conçue à Montréal : les commandes de livraison et en
> ligne entrent directement dans la caisse et à l'imprimante de cuisine, avec un menu maître, la synchronisation des
> ruptures, l'état des magasins et la vérification des versements. Elle tourne en production dans nos cuisines à
> Montréal, en français et en anglais, avec sa base de données hébergée à Montréal.
>
> Nous souhaitons devenir partenaire d'intégration de Lightspeed Restaurant (K-Series) pour offrir Food Hub aux
> restaurants qui utilisent votre caisse. Pourriez-vous nous indiquer comment présenter notre demande, les exigences et
> les étapes pour obtenir les identifiants d'API ?
>
> *English: We would like to become a Lightspeed Restaurant (K-Series) integration partner to offer Food Hub to
> restaurants using your POS. Could you share how to apply, the requirements and the steps to obtain API credentials?*
>
> Merci / Thank you,
> [signature]

### C4. Toast — demande de partenaire d'intégration
- **Porte d'entrée :** pos.toasttab.com/partners/integration-partner-application (3 étapes : licence de la
  documentation → courriel → formulaire). Toast annonce des délais et priorise selon la demande des clients : indiquer
  les restaurants clients communs, s'il y en a.

**Subject:** Toast Partner Integrations — TAKATAK Food Hub (order management, Canada)

> Hello Toast Partner Integrations team,
>
> TAKATAK Food Hub is a Montréal-built order management hub for restaurants: delivery and online orders go straight into
> the POS and kitchen, with one master menu, sold-out sync, store status and payout checks, bilingual French / English
> with its database hosted in Montréal (Canada).
>
> We are applying to build a generally available integration so restaurants on Toast in Canada can use Food Hub. Our
> proposed integration: orders into Toast, menu and item availability from Toast, store status, and order status back to
> the channels. [Mutual customers, if any: …]
>
> Thank you,
> [signature]

### C5. TouchBistro — partenaire intégré
- **Porte d'entrée :** équipe « integrated partners » de TouchBistro (adresse vue dans un index tiers :
  `integratedpartners@touchbistro.com` *(à confirmer)*). Ne pas utiliser le programme d'affiliation (référencement
  seulement).

**Subject:** TouchBistro integration partnership — TAKATAK Food Hub (order management, Canada)

> Hello TouchBistro Partnerships team,
>
> TAKATAK Food Hub is a Montréal-built order management hub for restaurants: delivery and online orders go straight into
> the POS and kitchen, with one master menu, sold-out sync, store status and payout checks, bilingual French / English
> with its database hosted in Montréal (Canada).
>
> We would like to become a TouchBistro integration partner so Canadian restaurants on TouchBistro can use Food Hub.
> Could you share the partner requirements, the commercial terms and how to obtain API access?
>
> Thank you,
> [signature]

### C6. PayFacto (Maître'D, Veloce) — partenariat québécois (bilingue)
- **Porte d'entrée :** équipe partenaires de PayFacto *(contact à trouver sur payfacto.com)*.

**Objet / Subject:** Partenariat d'intégration Maître'D et Veloce — TAKATAK Food Hub (Montréal)

> Bonjour à l'équipe Partenaires de PayFacto,
>
> TAKATAK Food Hub est une plateforme de gestion des commandes conçue à Montréal : les commandes de livraison et en
> ligne entrent directement dans la caisse et à l'imprimante de cuisine, avec un menu maître, la synchronisation des
> ruptures et l'état des magasins, en français et en anglais, avec sa base de données hébergée à Montréal.
>
> Nous souhaitons intégrer Food Hub à Maître'D et à Veloce pour les restaurants québécois qui utilisent vos caisses.
> Offrez-vous une API ou un programme de partenaires d'intégration, et qui devrions-nous joindre ?
>
> *English: We would like to integrate Food Hub with Maître'D and Veloce for Québec restaurants. Do you offer an API or
> an integration partner program, and who should we contact?*
>
> Merci / Thank you,
> [signature]

### C7. Moneris — terminaux et paiement
- **Porte d'entrée :** Moneris Developer Portal → équipe Client Consulting (spécifications Moneris Go).

**Subject:** Moneris Go — integration partnership with TAKATAK Food Hub (Canada)

> Hello Moneris Client Consulting team,
>
> TAKATAK Food Hub is a Montréal-built order management hub for restaurants (delivery and online orders into the
> register and kitchen, menus, sold-out sync, payouts), bilingual French / English, with its database hosted in Montréal (Canada). We would like to
> integrate with Moneris Go for restaurants using Moneris terminals. Could you share the integration specifications
> (Cloud / App-to-App) and the partner onboarding steps?
>
> Thank you,
> [signature]

---

## Suivi des envois / Tracking (remplir après chaque envoi)

| # | Partenaire | Porte d'entrée | Envoyé le | Par | Réponse | Prochaine étape |
|---|---|---|---|---|---|---|
| A1 | Uber Eats | gestionnaire de compte + formulaire développeur | | propriétaire | | |
| A2 | DoorDash | formulaire Marketplace + TAM | | propriétaire | | |
| A3 | SkipTheDishes | partners.skipthedishes.com | | propriétaire | | |
| A4 | Too Good To Go | formulaire Platform | | propriétaire | | |
| A5 | Ritual | ritual.co/partners | | propriétaire | | |
| A6 | Fantuan | portail marchand | | propriétaire | | |
| A7 | HungryPanda | à trouver | | | | |
| B1 | Uber Direct | compte Direct + équipe commerciale | | propriétaire | | |
| B2 | DoorDash Drive | developer.doordash.com (Drive) | | propriétaire | | |
| B3 | Trexity | équipe intégration | | propriétaire | | |
| C1 | Clover | Developer Relations | | propriétaire | | |
| C2 | Square | Developer Dashboard + partenariats | | propriétaire | | |
| C3 | Lightspeed | programme partenaires | | propriétaire | | |
| C4 | Toast | formulaire en 3 étapes | | propriétaire | | |
| C5 | TouchBistro | integrated partners (à confirmer) | | propriétaire | | |
| C6 | PayFacto | à trouver | | propriétaire | | |
| C7 | Moneris | Client Consulting | | propriétaire | | |

— signé : Claude (busy-cannon, Claude Code cloud) @ cloud · 2026-10-30 00:20 (HE)
