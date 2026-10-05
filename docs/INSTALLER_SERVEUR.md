# Mettre TAKATAK Food Hub en ligne sur ton serveur Contabo

Résultat : Food Hub tourne 24 h/24 sur ton serveur, en HTTPS, et redémarre tout seul. La surveillance
(« ta tablette est éteinte », commandes qui attendent) tourne même quand aucun écran n'est ouvert.

## 0. Sécurité d'abord
- Change les mots de passe Contabo et RealVNC. Prends-en deux différents, et active la double authentification si possible.
- Tes mots de passe et tes clés se tapent sur le serveur ou dans les portails, jamais dans un clavardage ni dans un courriel.

## 1. La base de données (déjà faite)
Les tables Food Hub (`fh_…`) sont installées dans ton projet Supabase **TAKATAK User Official Dashboard V1**.
- Elles sont à côté des tables du Dashboard, sans les toucher.
- Elles sont protégées : seul le serveur y a accès.

Il te manque une seule chose, la **clé service_role** :
- Où la trouver : Supabase → Project Settings → API → `service_role` → *Reveal*.
- Quand l'utiliser : copie-la seulement au moment où l'installateur la demande (étape 3).

Ne lance jamais `prisma migrate dev` sur cette base de production. Le Dashboard verrait des tables qu'il ne
connaît pas. `prisma migrate deploy` ne pose aucun problème.

## 2. Une adresse pour Food Hub
- **Simple, sans rien faire :** l'installateur donne une adresse gratuite du type `https://123-45-67-89.sslip.io`.
- **Plus propre :** chez ton registraire de nom de domaine, crée un enregistrement **A** `foodhub.takatak.ca` qui pointe vers l'IP du serveur.

L'adresse sert pour Uber, DoorDash, Clover et Skip. Si tu la changes plus tard, il faut la changer aussi dans chaque portail.

## 3. L'installation (une commande)
1. Mets le fichier `takatak-foodhub-rc10.zip` sur le serveur. Deux façons :
   - avec WinSCP ou FileZilla : glisse-le dans `/root` ;
   - ou depuis ton ordinateur : `scp takatak-foodhub-rc10.zip root@IP-DU-SERVEUR:/root/`
2. Dans le terminal du serveur (SSH, ou la console Contabo / VNC) :
   ```bash
   cd /root
   unzip -o takatak-foodhub-rc10.zip
   sudo bash takatak-accounting-control-tower-final/deploy/install-vps.sh foodhub.takatak.ca
   ```
   Si tu n'as pas fait l'étape 2, enlève `foodhub.takatak.ca` : l'adresse sslip.io sera utilisée.
3. L'installateur pose les questions de `npm run setup` (Entrée = passer). Le minimum :
   - la clé Supabase `service_role` ;
   - **ton courriel de propriétaire** ;
   - un **mot de passe de secours**, que tu choisis et tapes toi-même ;
   - **Resend**, pour recevoir le code de connexion par courriel.

   Twilio (textos et appels), Clover, Uber, DoorDash et Skip peuvent être ajoutés plus tard : relance simplement
   `sudo bash /opt/takatak-foodhub/deploy/install-vps.sh foodhub.takatak.ca`. Les valeurs déjà enregistrées sont gardées.
4. À la fin, ouvre l'adresse affichée et clique sur **Créer le compte propriétaire**, puis entre le code reçu.

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
- **Too Good To Go** : pas d'API publique. Les sacs du jour s'entrent dans Argent → Too Good To Go (10 secondes à la fermeture).

Tant que `LIVE_CONNECTORS_GLOBAL_ENABLED=false`, les commandes arrivent et s'affichent, mais rien n'est renvoyé aux plateformes.
Active-le en dernier, quand Réglages → Mise en service est tout vert.

## 5. Tes 7 magasins Uber Eats
Ils sont chargés dans Food Hub. La marque est déjà trouvée pour chacun :

| Magasin Uber | Marque Food Hub | UUID |
|---|---|---|
| Pi Pita | Pi Pita | b6b36ca0-bc57-50d0-a184-1d28bf74771f |
| PPP Pizzeria | PPP Pizzeria | 627d09f0-8fb4-57f2-8ec1-6a71984ad267 |
| Gateaux Montréal | Gateau Montreal | d4e00c50-971f-5eb4-afa2-d48231f98a48 |
| O'Oeufs Montréal | OOeuf | c5585882-ab06-5a2f-bbc2-66fe5ec9179c |
| Nutri Shake | Nutrition Shake | 8c0a69ee-1667-5aa7-a8e6-7fdb707095da |
| Bolon Café | Cafe Bolon | 8179598e-a40f-509e-8b03-59ce49d57d77 |
| BIN MOLLE BIN DURE | Bin molle & Bin Dure | 7656b055-48d1-5f46-a6a7-2a0d23668c0b |

La succursale de chacun n'est pas encore connue. Deux façons de la régler :
- dès que les clés Uber sont en place, l'adresse donnée par Uber la choisit toute seule ;
- sinon, choisis-la toi-même dans **Magasins → Branchement → « Vos magasins Uber Eats à relier »**.

## 6. Comment marche la tablette de cuisine
1. **Une seule fois :** sur la tablette, ouvre l'adresse de Food Hub et connecte-toi (gérant ou propriétaire).
   - Va dans Réglages → Tablettes → **Enregistrer cet écran**.
   - Donne-lui un nom (« Passe NDG ») et choisis sa succursale.
   - Dans le menu du navigateur, choisis *Ajouter à l'écran d'accueil* : elle s'ouvre en plein écran comme une app.
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
```bash
sudo bash /opt/takatak-foodhub/deploy/update-vps.sh /root/takatak-foodhub-rc11.zip
```
Tes clés et tes données sont gardées. Journal en direct : `journalctl -u takatak-foodhub -f`.
