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
personne ne la vend encore. La borne a plus de règles (semi-surveillée, mode client, alcool, approbation séparée
pour un grand écran) et elle réutilise tout le travail de la caisse.
**EN — Why A.** The register runs on your Station Duo's merchant screen with no special permission, and nobody sells
one yet. The kiosk has more rules (semi-attended, customer mode, alcohol, a separate approval for a big screen) and it
reuses all the register work.

## 2. Quelle fiche d'appli Clover ? / Which Clover app record?

- **A (recommandé / recommended).** Créer une **nouvelle fiche Android** (Canada) pour la caisse photo, et **laisser
  le brouillon « on2go » (N4NYCJCZ17FF4) à l'appli ON2GO gratuite** (tâche 65, dépôt on2goca). / Create a **new
  Android app record** (Canada) for the register, and **leave the "on2go" draft (N4NYCJCZ17FF4) to the free ON2GO
  app** (task 65, on2goca repo).
- B. Prendre le brouillon « on2go » pour la caisse photo et créer une nouvelle fiche web pour l'appli ON2GO gratuite.
  / Use the "on2go" draft for the register and create a new web app record for the free ON2GO app.

**FR — Pourquoi A.** Un brouillon ne peut pas être deux applis. Le nom « on2go » et son site on2go.ca vont avec
l'appli ON2GO gratuite, qui le réclame déjà. Le type et le pays d'une appli sont fixés à la création, et l'historique
du brouillon est inconnu : une fiche neuve « Android, Canada » est plus propre pour la caisse.
**EN — Why A.** One draft cannot be two apps. The "on2go" name and its on2go.ca site fit the free ON2GO app, which
already claims it. An app's type and country are set at creation and the draft's history is unknown: a fresh
"Android, Canada" record is cleaner for the register.

## 3. Comment la construire ? / How to build it?

- **A (recommandé / recommended).** Appli **Android native en Kotlin** avec le SDK Clover. / **Native Android app in
  Kotlin** with the Clover SDK.
- B. Une coquille Android qui affiche une page web Food Hub (WebView). / An Android shell showing a Food Hub web page
  (WebView).

**FR — Pourquoi A.** Commandes, paiement, impression et menu passent de toute façon par le SDK Clover natif. Clover
préfère Kotlin/Java. L'appli native continue d'afficher les tuiles et de bâtir la commande quand Internet tombe.
**EN — Why A.** Orders, payment, printing and menu go through Clover's native SDK anyway. Clover prefers Kotlin/Java.
A native app keeps showing tiles and building the order when the internet drops.

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

- **A (recommandé / recommended).** L'appli **crée seulement la commande** ; Clover et l'appli MEV certifiée de
  chaque restaurant (« Clover MEV Connect » ou « Clover MEV Web ») produisent la facture. **Aucune vente à un autre
  marchand avant les réponses écrites** de Clover et de Revenu Québec, et l'avis d'un avocat. Pilote dans vos
  restaurants seulement après avoir vérifié que la facture d'une commande de la caisse photo sort bien par votre
  appli MEV. / The app **only creates the order**; Clover and each restaurant's certified MEV app ("Clover MEV
  Connect" or "Clover MEV Web") produce the bill. **No sale to another merchant before written answers** from Clover
  and Revenu Québec, and a lawyer's opinion. Pilot in your restaurants only after checking that the bill for a picture
  register order does come out of your MEV app.
- B. Faire certifier notre appli comme SEV dès le départ (devenir partenaire de Revenu Québec). / Get our app
  certified as an SEV from the start (become a Revenu Québec partner).

**FR — Pourquoi A.** C'est le seul vrai bloqueur. La certification coûte du temps et doit être refaite à chaque
nouvelle fonction ; on ne la paie que si les réponses disent qu'elle est obligatoire.
**EN — Why A.** This is the only real blocker. Certification costs time and must be redone for each new feature; we
pay for it only if the answers say it is required.

## 7. Prix / Price

- **A (recommandé / recommended).** **Appli séparée : 14 jours d'essai, puis 50 $ CA/mois**, facturée par Clover
  (même modèle que Food Hub et Phone AI). Le mode borne sur appareil Clover (P2a) est inclus. La borne grand écran
  (P2b) aura son prix plus tard. Vos restaurants ne paient jamais. / **Separate app: 14-day trial, then CAD
  $50/month**, billed by Clover (same model as Food Hub and Phone AI). Kiosk mode on a Clover device (P2a) is included.
  The big-screen kiosk (P2b) is priced later. Your restaurants never pay.
- B. Option de Food Hub (+15 $ comme une marque de plus). / A Food Hub add-on (+$15 like an extra brand).

**FR — Pourquoi A.** Le marché est plus cher : environ 95–99 $/mois pour les bornes sur Clover, 70 $ CA/mois par
appareil pour Square au Canada. 50 $ reste bas et simple, et un marchand peut la prendre sans Food Hub.
**EN — Why A.** The market is pricier: about $95–99/month for kiosks on Clover, CAD $70/month per device for Square in
Canada. $50 stays low and simple, and a merchant can take it without Food Hub.

## 8. Nom de l'appli / App name

- **A (recommandé / recommended).** « **TAKATAK Caisse Photo** » (fiche anglaise : « TAKATAK Picture Register »).
  Visuel 100 % original. / "**TAKATAK Caisse Photo**" (English listing: "TAKATAK Picture Register"). 100 % original
  look.
- B. Un autre nom de votre choix. / Another name of your choice.

**FR — Pourquoi A.** Clair en français, dans la famille TAKATAK. Clover refuse les applis qui imitent une appli
Clover ou d'un autre développeur : jamais « McDonald's », ni leurs couleurs, ni un logo qui ressemble à Clover.
**EN — Why A.** Clear in French, in the TAKATAK family. Clover rejects apps that imitate a Clover or another developer's
app: never "McDonald's", their colours, or a Clover-like logo.

## 9. Quelle borne pour le Québec ? / Which kiosk for Québec?

- **A (recommandé / recommended).** **D'abord le mode borne sur un Clover Mini 3 ou Flex** (P2a), au comptoir avec
  le personnel présent ; **ensuite un grand écran** relié à un Mini ou Flex qui prend le paiement (P2b). On n'attend
  pas Clover Kiosk. / **First, kiosk mode on a Clover Mini 3 or Flex** (P2a), at the counter with staff present;
  **then a big screen** paired with a Mini or Flex that takes the payment (P2b). We do not wait for Clover Kiosk.
- B. Attendre que Clover vende Clover Kiosk au Québec. / Wait for Clover to sell Clover Kiosk in Québec.

**FR — Pourquoi A.** Clover écrit que Clover Kiosk est « en anglais seulement » et « pas offert au Québec ». C'est
justement notre créneau. Clover n'autorise pas l'usage sans surveillance : un employé reste dans la salle.
**EN — Why A.** Clover says Clover Kiosk is "English only" and "not offered" in Québec. That is exactly our gap. Clover
does not allow unattended use: a staff member stays in the room.

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
3. Envoyer les questions à Clover Developer Relations et à Revenu Québec (brouillons dans ROADMAP.md, à réécrire
   avec votre voix). / Send the questions to Clover Developer Relations and Revenu Québec (drafts in ROADMAP.md, to
   rewrite in your voice).
4. Consulter un avocat du Québec (questions dans LEGAL_AND_MARKET.md §10). / See a Québec lawyer (questions in
   LEGAL_AND_MARKET.md §10).
5. Créer la fiche d'appli dans le tableau de bord développeur Clover et la clé de signature. / Create the app record in
   the Clover developer dashboard and the signing key.
6. Fusionner cette PR. / Merge this PR.
