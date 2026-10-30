# Mettre TAKATAK Food Hub en ligne sur ton serveur Contabo

Résultat : Food Hub tourne en continu sur ton serveur, en HTTPS, et redémarre tout seul. La surveillance
(« ta tablette est éteinte », commandes qui attendent) tourne même quand aucun écran n'est ouvert.

_Mis à jour le 2026-10-30. L'ancien zip `takatak-foodhub-rc10.zip` et le dossier `takatak-accounting-control-tower-final`
n'existent plus : le code vient du dépôt GitHub `takatakca/foodhubca`, branche `main`._

**Deux façons de l'installer :**
- **A. Coolify** (c'est ainsi que tourne `https://foodhub.on2go.ca` aujourd'hui) : Coolify, sur le serveur Contabo,
  construit `main` depuis GitHub avec le `Dockerfile` du dépôt (port 3000). Les clés sont des variables
  d'environnement dans Coolify. Le propriétaire fusionne dans `main`, puis lance le déploiement. Détails et contrôle de
  la version publiée : [DEPLOYMENT.md](DEPLOYMENT.md).
- **B. Le script VPS** (un serveur sans Coolify) : les étapes 2 et 3 ci-dessous, une seule commande.

Jamais les deux pour les mêmes magasins : **une seule** instance de Food Hub reçoit les webhooks et fait les tâches
planifiées, sinon une commande peut arriver deux fois dans Clover.

## 0. Sécurité d'abord
- Change les mots de passe Contabo et RealVNC. Prends-en deux différents, et active la double authentification si possible.
- Tes mots de passe et tes clés se tapent sur le serveur ou dans les portails, jamais dans un clavardage ni dans un courriel.

## 1. La base de données (déjà faite)
Les tables Food Hub (`fh_…`) sont installées dans ton projet Supabase **TAKATAK User Official Dashboard V1**.
- Elles sont à côté des tables du Dashboard, sans les toucher.
- Elles sont protégées : seul le serveur y a accès.

Il te manque une seule chose, la **clé service_role** :
- Où la trouver : Supabase → Project Settings → API → `service_role` → *Reveal*.
- Quand l'utiliser : copie-la seulement au moment où l'installateur la demande (étape 3), ou dans les variables de
  Coolify (façon A).

Ne lance jamais `prisma migrate dev` sur cette base de production. Le Dashboard verrait des tables qu'il ne
connaît pas. `prisma migrate deploy` ne pose aucun problème.

## 2. Une adresse pour Food Hub
- **Simple, sans rien faire :** l'installateur donne une adresse gratuite du type `https://123-45-67-89.sslip.io`.
- **Plus propre :** chez ton registraire de nom de domaine, crée un enregistrement **A** (par exemple `foodhub.takatak.ca`)
  qui pointe vers l'IP du serveur. La production actuelle utilise `foodhub.on2go.ca`.

L'adresse sert pour Uber, DoorDash, Clover et Skip. Si tu la changes plus tard, il faut la changer aussi dans chaque portail.

## 3. L'installation avec le script VPS (façon B)
1. Dans le terminal du serveur (SSH, ou la console Contabo / VNC), télécharge `main` depuis GitHub et lance
   l'installateur :
   ```bash
   cd /root
   apt-get update && apt-get install -y curl unzip
   curl -L -o foodhubca-main.zip https://github.com/takatakca/foodhubca/archive/refs/heads/main.zip
   unzip -o foodhubca-main.zip
   sudo bash foodhubca-main/deploy/install-vps.sh foodhub.takatak.ca
   ```
   Si tu n'as pas fait l'étape 2, enlève `foodhub.takatak.ca` : l'adresse sslip.io sera utilisée. Avec `git`, c'est
   pareil : `git clone https://github.com/takatakca/foodhubca.git`, puis `sudo bash foodhubca/deploy/install-vps.sh`.
   Si Coolify (ou un autre Traefik) tient déjà les ports 80 / 443 sur ce serveur, le script ajoute Food Hub à ce
   Traefik au lieu d'installer Caddy.
2. L'installateur copie l'application dans `/opt/takatak-foodhub` et pose les questions de `npm run setup`
   (Entrée = passer). Le minimum :
   - la clé Supabase `service_role` ;
   - **ton courriel de propriétaire** ;
   - un **mot de passe de secours**, que tu choisis et tapes toi-même ;
   - **le courriel d'envoi**, pour recevoir le code de connexion : soit une boîte courriel de ton domaine (SMTP :
     `SMTP_HOST` comme `mail.ton-domaine.ca`, `SMTP_USER` = l'adresse complète de la boîte, `SMTP_PASS`, port 465 ou 587),
     soit **Resend** (`RESEND_API_KEY`) ; dans les deux cas `AUTH_EMAIL_FROM`.

   Twilio (textos et appels), Clover, Uber, DoorDash et Skip peuvent être ajoutés plus tard : relance simplement
   `sudo bash /opt/takatak-foodhub/deploy/install-vps.sh foodhub.takatak.ca`. Les valeurs déjà enregistrées sont gardées.
3. À la fin, ouvre l'adresse affichée et clique sur **Créer le compte propriétaire**, puis entre le code reçu.

## 4. Brancher les plateformes (dans cet ordre)
L'écran **Réglages → Plateformes et Clover** affiche chaque adresse et chaque secret à donner.
- **Clover**, le plus rapide (le jour même) :
  - Clover → Account & Setup → API Tokens → crée un jeton avec Inventory (lecture), Orders, Payments et Merchant (lecture et écriture).
  - Mets ton Merchant ID et ce jeton dans l'installateur.
- **Uber Eats** :
  - Ton app sur developer.uber.com doit être approuvée par Uber pour les scopes `eats.order`, `eats.store`, `eats.store.status.write`, `eats.pos_provisioning` et `eats.report`.
  - Dans l'app, mets l'URL du webhook et l'URI de redirection affichées par l'installateur.
  - Mets le Client ID et le Client Secret dans l'installateur.
  - Ensuite : Magasins → Branchement → **Brancher Uber Eats**. Tes 7 magasins sont déjà connus (voir plus bas).
- **DoorDash** :
  - developer.doordash.com → accès Marketplace → Developer ID, Key ID et Signing Secret.
  - DoorDash te donne aussi le « provider type » quand l'intégration est approuvée.
  - Donne-leur l'URL du webhook et le secret.
- **SkipTheDishes** :
  - Demande à ton responsable Skip l'intégration **JET Connect** pour ton propre système de caisse.
  - Ils te donnent la clé API. Toi, tu leur donnes les 6 URL et les 2 secrets de l'écran Plateformes.
- **Too Good To Go** : pas d'API publique.
  - Les commandes peuvent arriver par **courriel** : Food Hub lit une boîte en lecture seule (`TGTG_IMAP_*`) et crée la
    commande dans Clover avec son ticket ([TGTG_EMAIL_ORDERS.md](TGTG_EMAIL_ORDERS.md)).
  - Sinon, les sacs du jour s'entrent dans Argent → Too Good To Go (10 secondes à la fermeture).
- **Un partenaire qui envoie ses commandes** (par exemple un flux Too Good To Go) : le **Relais de commandes Food Hub**.
  - Réglages → Plateformes et Clover → « Relais de commandes Food Hub » → *Afficher les secrets* → copie l'adresse et
    donne-la au partenaire. Format compatible UrbanPiper « Order Relay ».
  - Relie ses magasins dans Magasins sous l'identifiant `relay:<id>`. Ils reçoivent des commandes seulement : aucun menu,
    aucune rupture, aucune pause n'est envoyé à la plateforme pour eux ([ORDER_RELAY.md](ORDER_RELAY.md)).

Tant que `LIVE_CONNECTORS_GLOBAL_ENABLED=false`, les commandes arrivent et s'affichent, mais rien n'est renvoyé aux plateformes.
Active-le en dernier, quand Réglages → Mise en service est tout vert.

### Un seul menu pour plusieurs marques
Menus → **Menu partagé** : une marque suit le menu d'une autre (articles, prix, options, ruptures).
- Elle est publiée sous son propre nom, avec ses heures et ses magasins. Elle peut ne montrer que les plats choisis pour elle.
- Une rupture (86) touche les magasins de toutes les marques qui partagent ce menu.
- Pour modifier le menu, ouvre la marque d'origine. Au moment de publier, coche « Publier pour toutes les marques qui
  partagent ce menu ».
- Les majorations de prix appartiennent au menu partagé : une marque qui le suit n'a pas encore ses propres prix.

## 5. Tes 7 magasins Uber Eats
Ils sont chargés dans Food Hub. La marque est déjà trouvée pour chacun, et la succursale aussi : **les 7 sont à
Saint-Léonard** (5839 rue Jean-Talon E, H1S 1M4), d'après la fiche Uber de chaque magasin. Uber les nomme presque tous
« (Hochelaga) », mais ce ne sont **pas** des magasins NDG ni Hochelaga :

| Magasin Uber (nom sur Uber) | Marque Food Hub | Succursale | UUID |
|---|---|---|---|
| Pi pita (Hochelaga) | Pi Pita | SAINT_LEONARD | b6b36ca0-bc57-50d0-a184-1d28bf74771f |
| PPP Pizzeria (Hochelaga) | PPP Pizzeria | SAINT_LEONARD | 627d09f0-8fb4-57f2-8ec1-6a71984ad267 |
| Gâteaux Montreal (Hochelaga) | Gateau Montreal | SAINT_LEONARD | d4e00c50-971f-5eb4-afa2-d48231f98a48 |
| O'OEUFS Express (5839 Jean-Talon) | OOeuf | SAINT_LEONARD | c5585882-ab06-5a2f-bbc2-66fe5ec9179c |
| Nutri Shake (Hochelaga) | Nutrition Shake | SAINT_LEONARD | 8c0a69ee-1667-5aa7-a8e6-7fdb707095da |
| Bolon Café (Hochelaga) | Cafe Bolon | SAINT_LEONARD | 8179598e-a40f-509e-8b03-59ce49d57d77 |
| BIN MOLLE & BIN DURE (Hochelaga) | Bin molle & Bin Dure | SAINT_LEONARD | 7656b055-48d1-5f46-a6a7-2a0d23668c0b |

Dans **Magasins → Branchement → « Vos magasins Uber Eats à relier »**, la succursale Saint-Léonard est déjà choisie.
Dès que les clés Uber sont en place, l'adresse donnée par Uber la confirme. Si un de ces magasins est relié à une autre
succursale, la même page affiche un avertissement avec un bouton **Déplacer**.

Les magasins Uber de NDG (6280 Somerled) ont d'**autres** UUID. Ils sont notés pour référence dans
`data/actual/platform-stores-uber.json` (`ndg_not_mapped`), sans être reliés : relie-les avec **Brancher Uber Eats**.

## 6. Comment marche la tablette de cuisine
1. **Une seule fois :** sur la tablette, ouvre l'adresse de Food Hub et connecte-toi (gérant ou propriétaire).
   - Va dans Réglages → Tablettes → **Enregistrer cet écran**.
   - Donne-lui un nom (« Passe NDG ») et choisis sa succursale.
   - Dans le menu du navigateur, choisis *Ajouter à l'écran d'accueil* : elle s'ouvre en plein écran comme une app.
   - Une app Android avec impression des tickets (Bluetooth ou réseau) arrive avec la PR #130 : son guide sera
     `docs/KITCHEN_TABLET_APP.md` une fois la PR fusionnée.
2. **Chaque jour :** la tablette montre l'**écran NIP** (« Qui commence ? »). L'employé touche son nom et tape son NIP.
   - Il est connecté pour 14 heures, seulement sur cette tablette.
   - *Verrouiller* revient à l'écran NIP.
3. **Une nouvelle commande arrive :**
   - plein écran, bip qui se répète, compte à rebours avant l'annulation par la plateforme ;
   - un geste : *Accepter* (en choisissant le temps de préparation) ou *Refuser* (avec une raison — un NIP de gérant est demandé).
4. **Une commande est annulée par le client :** l'écran devient rouge jusqu'à « Compris — j'arrête ».
5. **La tablette s'éteint, perd le son ou le réseau pendant les heures d'ouverture :**
   - le téléphone de la cuisine sonne (Réglages → Entreprise), puis les gérants de garde reçoivent un texto, puis un appel.
6. **Tablette perdue ou volée :** Réglages → Tablettes → *Retirer*. Elle est déconnectée tout de suite.

Garde la tablette branchée, le volume au maximum et Food Hub ouvert. Touche l'écran une fois au début de la
journée pour autoriser le son, c'est une règle des navigateurs.

## 7. Mises à jour
- **Coolify (façon A)** : le propriétaire fusionne la PR dans `main`, puis lance le déploiement dans Coolify. Contrôle
  ensuite que `/api/release` montre le bon commit : `npm run verify:live -- --url https://foodhub.on2go.ca/ --sha <SHA>`
  ([DEPLOYMENT.md](DEPLOYMENT.md)).
- **Script VPS (façon B)** : télécharge `main` à nouveau et donne le zip au script de mise à jour.
  ```bash
  cd /root
  curl -L -o foodhubca-main.zip https://github.com/takatakca/foodhubca/archive/refs/heads/main.zip
  sudo bash /opt/takatak-foodhub/deploy/update-vps.sh /root/foodhubca-main.zip
  ```
  Tes clés et tes données sont gardées. Si la version contient un nouveau fichier SQL, colle
  `supabase/INSTALL_ALL.sql` dans Supabase (sans danger, plusieurs fois). Journal en direct :
  `journalctl -u takatak-foodhub -f`.
