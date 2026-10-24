# Décisions du propriétaire / Owner decisions — caisse photo Clover / Clover picture register

> Pour Matthieu. Chaque décision : la question, les options, **l'option recommandée**, pourquoi. Répondez par le
> numéro et la lettre (ex. « 1A, 2A, 3A… ») dans la PR ou dans `private/TASKS.md`.
> For Matthieu. Each decision: the question, the options, **the recommended option**, why. Answer with the number and
> letter (e.g. "1A, 2A, 3A…") in the PR or in `private/TASKS.md`.
>
> Ceci n'est pas un avis juridique. / This is not legal advice.

---

## 1. Quoi construire, et dans quel ordre ? / What to build, in what order?

- **A (recommandé / recommended).** Les deux : **d'abord la caisse photo du personnel** sur vos appareils Clover,
  **ensuite la borne libre-service en français**. / Both: **staff picture register first** on your Clover devices,
  **then the French self-order kiosk**.
- B. La borne d'abord. / Kiosk first.
- C. La caisse photo seulement. / Register only.

**FR — Pourquoi A.** La caisse photo tourne sur l'écran marchand de votre Station Duo sans permission spéciale, et
nous n'en avons trouvé aucune dans notre recherche du 2026-10-23 (la doc Clover cite pourtant « Menu with photos »
comme type d'appli de restauration rapide : d'autres peuvent exister). La borne a plus de règles (semi-surveillée,
mode client, alcool, approbation séparée pour un grand écran) et elle réutilise tout le travail de la caisse.
**EN — Why A.** The register runs on your Station Duo's merchant screen with no special permission, and we found none
in our search on 2026-10-23 (Clover's docs do list "Menu with photos" as a quick-service app type,
https://docs.clover.com/docs/merchant-needs, so others may exist). The kiosk has more rules (semi-attended, customer
mode, alcohol, a separate approval for a big screen) and it reuses all the register work.

## 2. Quelle fiche d'appli Clover ? / Which Clover app record?

> **Décidé le 2026-10-23 : A.** Le propriétaire a créé le brouillon « TAKATAK Picture Register » / « Caisse en
> images TAKATAK » (App ID J0H36VTJBSBBP, type d'appli laissé vide exprès) et renommé N4NYCJCZ17FF4 en « ON2GO »
> (accroches et avantages FR/EN enregistrés ; ce brouillon garde le type Android (Mobile) + REST et une ancienne
> permission Customers lecture + écriture que le propriétaire peut retirer). TAKATAK (fiches, réseaux) =
> F4TMP23FM7K5M.
> **Decided on 2026-10-23: A.** The owner created the draft "TAKATAK Picture Register" / "Caisse en images TAKATAK"
> (App ID J0H36VTJBSBBP, app type intentionally unset) and renamed N4NYCJCZ17FF4 to "ON2GO" (FR/EN taglines and
> benefits saved; that draft keeps App type Android (Mobile) + REST and an earlier Read + Write Customers permission the
> owner may remove). TAKATAK (listings, social) = F4TMP23FM7K5M.

- **A (recommandé / recommended).** Créer une **nouvelle fiche Android** (Canada) pour la caisse photo, et **laisser
  le brouillon « on2go » (N4NYCJCZ17FF4) à l'appli ON2GO gratuite** (tâche 65, dépôt on2goca). / Create a **new
  Android app record** (Canada) for the register, and **leave the "on2go" draft (N4NYCJCZ17FF4) to the free ON2GO
  app** (task 65, on2goca repo).
- B. Prendre le brouillon « on2go » pour la caisse photo et créer une nouvelle fiche web pour l'appli ON2GO gratuite.
  / Use the "on2go" draft for the register and create a new web app record for the free ON2GO app.

**FR — Pourquoi A.** Un brouillon ne peut pas être deux applis. Le nom « on2go » et son site on2go.ca vont avec
l'appli ON2GO gratuite, qui le réclame déjà. L'historique du brouillon est inconnu : une fiche neuve est plus propre
pour la caisse. (La page Clover des réglages d'appli permet de choisir plusieurs types ; le type n'est donc pas une
raison.)
**EN — Why A.** One draft cannot be two apps. The "on2go" name and its on2go.ca site fit the free ON2GO app, which
already claims it. The draft's history is unknown: a fresh record is cleaner for the register. (Clover's App Settings
page lets you select several app types, so the type is not the reason.)

## 3. Comment la construire ? / How to build it?

- **A (recommandé / recommended).** Appli **Android native en Kotlin** avec le SDK Clover. / **Native Android app in
  Kotlin** with the Clover SDK.
- B. Une coquille Android qui affiche une page web (WebView), **seulement** avec les fichiers web inclus dans l'APK,
  sans JavaScript chargé à distance et sans pont JS vers les connecteurs de commande, de paiement ou d'impression. /
  An Android shell showing a web page (WebView), **only** with the web files bundled in the APK, no remote JavaScript
  and no JS bridge to the order, payment or printer connectors.

**FR — Pourquoi A.** Commandes, paiement, impression et menu passent de toute façon par le SDK Clover natif. Clover
préfère Kotlin/Java. L'appli native continue d'afficher les tuiles et de bâtir la commande quand Internet tombe. Les
règles Clover interdisent à une appli de lancer d'autre code exécutable ou de débloquer des fonctions hors de l'App
Market : une page Food Hub chargée à distance qui appelle le paiement serait probablement refusée.
**EN — Why A.** Orders, payment, printing and menu go through Clover's native SDK anyway. Clover prefers Kotlin/Java.
A native app keeps showing tiles and building the order when the internet drops. Clover's Functionality Policies
forbid an app launching other executable code or unlocking features outside the App Market
(https://www.clover.com/app-market-policies, read 2026-10-23): a remote Food Hub page calling payment would likely be
rejected.

## 4. Sur quels appareils au départ ? / Which devices first?

- **A (recommandé / recommended).** L'**écran marchand de la Station Duo**, puis **Mini 3** et **Flex 3/4**.
  Jamais les appareils de 1ʳᵉ génération. / The **Station Duo merchant screen**, then **Mini 3** and **Flex 3/4**.
  Never Gen-1 devices.
- B. Station Duo seulement. / Station Duo only.

**FR — Pourquoi A.** Mêmes réglages Android (API 29) pour Duo 2, Mini 3 et Flex 3. **À faire tout de suite :**
regardez dans Réglages → À propos si votre Station Duo est une Duo 1 (Android 8.1) ou une Duo 2 (Android 10). Une
Duo 1 restée en Android 8.1 ne pourra pas recevoir l'appli telle que prévue.
**EN — Why A.** Same Android level (API 29) for Duo 2, Mini 3 and Flex 3. **Do now:** check Settings → About to see if
your Station Duo is a Duo 1 (Android 8.1) or a Duo 2 (Android 10). A Duo 1 still on Android 8.1 cannot take the app as
planned.

## 5. D'où viennent les photos ? / Where do the photos come from?

- **A (recommandé / recommended).** **Nos photos Food Hub** (`/media`, au moins 1200×800, vos vrais plats) d'abord ;
  les photos Clover seulement en appoint ; une tuile de couleur si aucune photo. / **Our Food Hub photos** (`/media`,
  at least 1200×800, your real dishes) first; Clover photos only as a fallback; a colour tile when there is none.
- B. Seulement les photos Clover. / Clover photos only.

**FR — Pourquoi A.** L'API Clover ne donne pas d'adresse officielle pour les images. La loi demande aussi que la
photo montre le vrai plat vendu. La même banque de photos sert l'appli TAKATAK (fiches et réseaux) : une seule source.
**EN — Why A.** Clover's API gives no official image URL. The law also requires the photo to show the real dish sold.
The same photo store serves the TAKATAK app (listings and social): one source.

## 6. Facturation MEV / SRM de Revenu Québec / Revenu Québec SRM billing

- **A (recommandé / recommended).** **Hypothèse prudente.** Pour les restaurants du Québec, on suppose que la caisse
  fait partie du SEV tant que Revenu Québec n'a pas dit par écrit le contraire. On pose d'abord la question à Revenu
  Québec et aux deux concepteurs MEV (Pulsar informatique Inc pour « Clover MEV Connect » ; 15535743 Canada inc. pour
  « Clover MEV Web ») : leur version certifiée enregistre-t-elle, sans nouvelle certification, une commande créée par
  une autre appli avec OrderConnector ? La caisse n'offre que ce que l'appli MEV du restaurant sait enregistrer.
  **Aucun restaurant québécois dans une fiche ou une vente** avant les réponses de Revenu Québec, du concepteur et de
  Clover, et l'avis d'un avocat. Dans vos restaurants : vraies commandes seulement après la réponse écrite du
  concepteur et le test A15 (reçu de fermeture avec code QR, sans choix « pas de reçu »). On prévoit dès maintenant le
  budget de B, le chemin probable pour le Québec. / **Cautious assumption.** For Québec restaurants, we assume the
  register is part of the SRS until Revenu Québec says in writing that it is not. First ask Revenu Québec and both MEV
  vendors (Pulsar informatique Inc for "Clover MEV Connect"; 15535743 Canada inc. for "Clover MEV Web"): does your
  certified version record an order created by another app through OrderConnector, with no recertification? The
  register offers only what the restaurant's MEV app can record. **No Québec restaurant in any listing or sale** before
  Revenu Québec, the vendor and Clover have answered, and a lawyer's opinion. In your restaurants: live orders only
  after the vendor's written answer and check A15 (closing receipt with QR code, no "no receipt" choice). Budget now for
  B, the likely path for Québec.
- B. Faire certifier notre appli comme SEV (devenir partenaire de Revenu Québec). / Get our app certified as an SEV
  (become a Revenu Québec partner).

**FR — Pourquoi A.** C'est le seul vrai bloqueur. Dans le scénario « service au comptoir » de Revenu Québec, l'employé
saisit la commande dans le SEV ; une appli qui prend la commande fait donc probablement partie du SEV. Revenu Québec
exige un nouveau numéro de certification pour toute version avec des changements non certifiés (sauf l'ajout ou le
retrait d'un mode de paiement), et Clover peut refuser une appli non conforme aux lois régionales. « L'appli crée
seulement la commande » est donc la lecture la plus faible, pas un choix sûr. A ne retarde la dépense de B que le temps
d'obtenir les réponses.
**EN — Why A.** This is the only real blocker. In Revenu Québec's counter-service scenario the user enters the order in
the SRS, so an app that takes the order is probably part of the SRS. Revenu Québec requires a new certification number
for any version with uncertified changes (except adding or removing a payment method), and Clover may deny an app that
does not comply with regional laws. "The app only builds the order" is the weaker reading, not a safe default. A only
delays spending on B until the answers are in.

## 7. Prix / Price

- **A (recommandé / recommended).** **Appli séparée : 14 jours d'essai, puis 50 $ CA/mois**, facturée par Clover
  (même modèle que Food Hub et Phone AI). Le mode borne sur appareil Clover (P2a) est inclus. La borne grand écran
  (P2b) aura son prix plus tard, facturé lui aussi par Clover (règle d'achat de l'App Market). Vos restaurants ne
  paient jamais. / **Separate app: 14-day trial, then CAD $50/month**, billed by Clover (same model as Food Hub and
  Phone AI). Kiosk mode on a Clover device (P2a) is included. The big-screen kiosk (P2b) is priced later, also billed
  through Clover (App Market purchase policy). Your restaurants never pay.
- B. Option de Food Hub (+15 $ comme une marque de plus). / A Food Hub add-on (+$15 like an extra brand).

**FR — Pourquoi A.** Repères publics : environ 95–99 $/mois par borne ou par emplacement pour les bornes sur Clover
(devise non confirmée), 70 $ CA/mois par appareil pour Square au Canada. Notre 50 $ CA est par marchand : ce n'est pas
une comparaison à l'identique, donc pas de « moins cher que le marché » en public. 50 $ reste simple, et un marchand
peut la prendre sans Food Hub.
**EN — Why A.** Public reference points: about $95–99/month per kiosk or per location for kiosks on Clover (currency
unconfirmed), CAD $70/month per device for Square in Canada. Our CAD $50 is per merchant: not a like-for-like
comparison, so no public "below the market" claim. $50 stays simple, and a merchant can take it without Food Hub.

## 8. Nom de l'appli / App name

> **État au 2026-10-23 / Status on 2026-10-23.** Le brouillon J0H36VTJBSBBP s'appelle « Caisse en images TAKATAK »
> (FR) et « TAKATAK Picture Register » (EN). / Draft J0H36VTJBSBBP is named "Caisse en images TAKATAK" (FR) and
> "TAKATAK Picture Register" (EN).

- **A (recommandé / recommended).** Garder « **Caisse en images TAKATAK** » en français ; **avant la soumission**,
  choisir un nom anglais qui ne s'appuie pas sur « Register », par exemple « TAKATAK Photo Menu POS ». Visuel 100 %
  original. / Keep "**Caisse en images TAKATAK**" in French; **before submission**, pick an English name that does not
  lean on "Register", for example "TAKATAK Photo Menu POS". 100 % original look.
- B. Garder « TAKATAK Picture Register » seulement si Clover Developer Relations le confirme par écrit (question
  DevRel 10). / Keep "TAKATAK Picture Register" only if Clover Developer Relations confirms it in writing (DevRel
  question 10).

**FR — Pourquoi A.** Les règles Clover (« Deceptive Behavior ») interdisent les noms ou icônes qui ressemblent à s'y
méprendre aux applis Clover livrées avec l'appareil, et « Register » est le nom de la caisse intégrée de Clover, qui
fait le même travail. Clover refuse aussi les applis qui imitent une appli Clover ou d'un autre développeur : jamais
« McDonald's », ni leurs couleurs, ni un logo qui ressemble à Clover. Un nom de brouillon se change avant la soumission.
**EN — Why A.** Clover's Deceptive Behavior policy forbids names or icons confusingly similar to the Clover apps supplied
with the device (https://www.clover.com/app-market-policies, last updated 2025-01-01, read 2026-10-23), and "Register"
is the name of Clover's built-in register app, which does the same job. Clover also rejects apps that imitate a Clover
or another developer's app: never "McDonald's", their colours, or a Clover-like logo. A draft's name can be changed
before submission.

## 9. Quelle borne pour le Québec ? / Which kiosk for Québec?

- **A (recommandé / recommended).** **D'abord le mode borne sur un Clover Mini 3 ou Flex** (P2a), au comptoir avec
  le personnel présent ; **ensuite un grand écran** relié à un Mini ou Flex qui prend le paiement (P2b). On n'attend
  pas Clover Kiosk. / **First, kiosk mode on a Clover Mini 3 or Flex** (P2a), at the counter with staff present;
  **then a big screen** paired with a Mini or Flex that takes the payment (P2b). We do not wait for Clover Kiosk.
- B. Attendre que Clover vende Clover Kiosk au Québec. / Wait for Clover to sell Clover Kiosk in Québec.

**FR — Pourquoi A.** Selon clover.com/ca/kiosk (note en anglais, traduite ici), Clover Kiosk est vendu au Canada en
anglais seulement et n'est pas offert au Québec. C'est justement notre créneau au Québec ; ailleurs au Canada, Clover
Kiosk nous fait concurrence et le français reste notre atout. Clover n'autorise pas l'usage sans surveillance : pour
nous, un employé reste dans la salle.
**EN — Why A.** clover.com/ca/kiosk says Clover Kiosk "is available in English only and not offered in the province of
Quebec", and sells it elsewhere in Canada ("Contact sales"). That is exactly our gap in Québec; outside Québec, Clover
Kiosk competes directly and French is our edge. Clover does not allow unattended use: for us, a staff member stays in
the room.

## 10. Alcool à la borne / Alcohol at the kiosk

- **A (recommandé / recommended).** **Cacher l'alcool en mode borne.** Il reste vendu à la caisse par le personnel.
  / **Hide alcohol in kiosk mode.** Staff still sell it at the register.
- B. Le montrer, mais retenir la commande jusqu'à ce qu'un employé vérifie la carte d'identité. / Show it, but hold the
  order until a staff member checks ID.

**FR — Pourquoi A.** Une borne ne peut pas vérifier l'âge. Vendre de l'alcool à un mineur est interdit. A est simple
et sans risque ; B pourra venir plus tard si l'avocat le valide.
**EN — Why A.** A kiosk cannot check age. Selling alcohol to a minor is prohibited. A is simple and safe; B can come
later if the lawyer approves it.

## 11. Où ranger le code de l'appli ? / Where does the app code live?

- **A (recommandé / recommended).** Un **nouveau dépôt** (ex. `takatakca/clover-picture-register`) pour l'APK ; les
  ajouts serveur restent dans foodhubca. La clé de signature n'est jamais dans git et elle est sauvegardée hors du
  VPS. / A **new repo** (e.g. `takatakca/clover-picture-register`) for the APK; server changes stay in foodhubca. The
  signing key is never in git and is backed up off the VPS.
- B. Un dossier `android/` dans foodhubca. / An `android/` folder in foodhubca.

**FR — Pourquoi A.** L'appli Android a ses propres outils et versions ; elle ne doit pas ralentir ni casser les
vérifications de Food Hub. Ce dépôt-ci est public.
**EN — Why A.** The Android app has its own tools and releases; it must not slow down or break Food Hub's checks. This
repo is public.

---

## Ce que vous seul pouvez faire / What only you can do

1. Répondre aux décisions 1 à 11. / Answer decisions 1 to 11.
2. Vérifier le modèle de la Station Duo (décision 4). / Check the Station Duo model (decision 4).
3. Envoyer les questions à Clover Developer Relations, à Revenu Québec et aux deux concepteurs MEV (brouillons dans
   ROADMAP.md, à réécrire avec votre voix). / Send the questions to Clover Developer Relations, Revenu Québec and both
   MEV vendors (drafts in ROADMAP.md, to rewrite in your voice).
4. Consulter un avocat du Québec (questions dans LEGAL_AND_MARKET.md §10). / See a Québec lawyer (questions in
   LEGAL_AND_MARKET.md §10).
5. Fiche d'appli : brouillon créé le 2026-10-23 (J0H36VTJBSBBP). Reste : choisir le type d'appli et le nom anglais
   (décision 8), créer la clé de signature. / App record: draft created on 2026-10-23 (J0H36VTJBSBBP). Left: set the
   app type and the English name (decision 8), create the signing key.
6. Retirer la taxe « Sales Tax » (0,14975 %) dans Clover → Setup → Taxes & Fees, pour chaque marchand
   (ROADMAP P0.11). / Remove the "Sales Tax" rate (0.14975 %) in Clover → Setup → Taxes & Fees, in each merchant
   (ROADMAP P0.11).
7. Signer l'évaluation des facteurs relatifs à la vie privée (Loi 25) préparée par un agent (ROADMAP P0.12). / Sign the
   Law 25 privacy impact assessment an agent drafts (ROADMAP P0.12).
8. Fusionner cette PR. / Merge this PR.
