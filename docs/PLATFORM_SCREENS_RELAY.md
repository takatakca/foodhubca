# Écrans de commande sur un serveur : le guide du propriétaire (30 minutes)

_Lane B de « Order screens rescue » (`docs/ORDER_SCREENS_RESCUE.md`). Ce que Food Hub en fait (le mur d'écrans qui
sonne, l'alerte « commandes en attente ») est dans `docs/PLATFORM_SCREENS.md`. Version anglaise plus bas._

## Le problème qu'on règle

Une tablette DoorDash ou Uber Eats perd le Wi-Fi ou sa connexion. Les commandes sonnent dans le vide, la plateforme
ferme le magasin (« Temporairement fermé » en pleine journée), puis le désactive.

## La solution en une phrase

Chaque écran de commande tourne sur un **ordinateur qui ne s'éteint jamais** (un petit serveur, ou le PC du magasin),
reste connecté, et Food Hub le surveille toutes les 20 secondes. Un seul appareil sonne quand une commande attend.

Trois façons, du plus simple au plus complet :

| Façon | Pour qui | Ce qu'il faut |
|---|---|---|
| **A. Serveur Linux avec Docker** (recommandé) | tous les magasins, tous les comptes | un petit serveur ou VPS (2 vCPU / 4 Go pour 3–4 écrans), câblé, toujours allumé |
| **B. Le vrai appareil Android** (l'app DoorDash / Uber du Play Store) | quand la plateforme n'offre que son app | la façon A, plus un serveur Linux **avec KVM** |
| **C. Le PC Windows du magasin** | un magasin, sans serveur | un PC Windows 10/11 qui reste allumé, Node 22 |

**Ce que ça ne fait jamais :** personne, ni un robot ni un agent, ne tape votre mot de passe ni un code SMS. **Vous
vous connectez vous-même, une fois, dans chaque écran.** L'écran reste connecté. Les robots ne cliquent jamais sur une
commande et ne lisent jamais son contenu : ils regardent seulement si l'écran est allumé, s'il est connecté, et le
nombre de commandes en attente (le chiffre dans le titre de la page, ou le nombre de notifications de l'app).

---

## Le plus rapide : les 18 écrans numérotés de Food Hub (s01–s18)

Le mur d'écrans de Food Hub (Magasins → Écrans des plateformes) et ce serveur utilisent **les mêmes numéros** :
rien à copier à la main.

1. **Jeton** : comme l'étape 1 plus bas (`FOODHUB_SCREENS_AGENT_TOKEN` dans Coolify, même valeur dans `.env` ici).
2. **Food Hub → Écrans des plateformes → Préparer les écrans** :
   - choisissez combien de DoorDash, Uber Eats et Skip (par défaut 8 / 6 / 4 = 18) et la succursale ;
   - mettez l'adresse du serveur, p. ex. `https://ecrans.on2go.ca/`.

   Food Hub crée s01 à s18, chacun à `https://ecrans.on2go.ca/s01/`… et prêt à ouvrir la page de connexion de son canal.
3. **Sur le serveur**, dans `deploy/screens/` :
   ```bash
   cp screens.18.example.json screens.json   # s01–s08 DoorDash, s09–s14 Uber Eats, s15–s18 Skip
   node generate.mjs
   cp .env.example .env && nano .env         # FOODHUB_URL, FOODHUB_ORIGIN, le jeton, un utilisateur/mot de passe pour VOIR les écrans
   docker compose up -d --build
   ```
   Aucune ligne `SCREEN_ID_…` à remplir : chaque écran utilise son numéro.
4. **Une seule adresse pour les 18 : la passerelle.** `docker compose` démarre aussi une **passerelle** sur
   `127.0.0.1:3100`. Elle envoie `/s01/` vers l'écran s01, …, `/s18/` vers s18 (chemin gardé). Elle demande une seule
   fois le mot de passe de VUE (`SCREENS_VIEW_USER` / `SCREENS_VIEW_PASSWORD`) et laisse seulement Food Hub
   (`FOODHUB_ORIGIN`) afficher les écrans. Dans **Coolify** (ou Cloudflare Tunnel), un seul domaine :
   `https://ecrans.on2go.ca` → `127.0.0.1:3100`. C'est tout.
5. **Pour que les écrans s'affichent DANS Food Hub** :
   - le serveur doit être sur un **sous-domaine du domaine de Food Hub** : Food Hub sur `foodhub.on2go.ca`, écrans sur
     `ecrans.on2go.ca`. Sinon, Safari et Chrome bloquent la connexion à l'intérieur du cadre ;
   - `FOODHUB_ORIGIN=https://foodhub.on2go.ca` dans `.env` (la passerelle s'occupe des en-têtes) ;
   - dans Food Hub (Coolify) : `FOODHUB_SCREENS_VIEW_HOSTS=ecrans.on2go.ca` (un écran ne peut alors montrer que ce
     serveur).
6. **Connectez-vous une fois dans chaque écran**, dans Food Hub. Pour changer le canal d'un écran (DoorDash / Uber Eats /
   Skip), choisissez-le sur sa tuile : l'écran ouvre la page de connexion du nouveau canal.

**Skip :** ses commandes en direct sont peut-être seulement dans l'app **Skip Partner** (le portail Web sert aux menus et
à l'historique). Si un écran Skip Web ne montre pas les commandes, faites-le en Android (façon B).

## A. Serveur Linux avec Docker (30 minutes)

### 1. Le jeton (5 min)
1. Sur le serveur : `openssl rand -hex 24` → copiez le résultat.
2. Dans Coolify → Food Hub → Environment Variables : ajoutez `FOODHUB_SCREENS_AGENT_TOKEN` = ce résultat, cochez
   **secret**, redéployez Food Hub.

### 2. Les écrans dans Food Hub (5 min)
Food Hub → **Magasins → Écrans des plateformes → Ajouter un écran**, une fois par compte de plateforme : plateforme,
nom, emplacement, et l'adresse https de l'écran (étape 5 ; vous pouvez la mettre après). Ouvrez chaque écran en
modification pour **copier son identifiant**.

### 3. La liste des écrans (5 min)
Sur le serveur, dans `deploy/screens/` :
```bash
cp screens.example.json screens.json
nano screens.json
```
Une ligne par écran : `id` (le même nom que dans `.env`, p. ex. `SCREEN_ID_UBER_1`), `platform` (`uber`, `doordash`,
`skip`), `name`, `startUrl` (l'adresse de la page des commandes), `mode` (`web`, ou `android` pour la façon B).

**Jamais** de nom d'utilisateur, de mot de passe ni de jeton dans ce fichier : le générateur refuse et s'arrête.

### 4. Générer et démarrer (5 min)
```bash
node generate.mjs                 # écrit docker-compose.yml et .env.example
cp .env.example .env && nano .env # FOODHUB_URL, le jeton de l'étape 1, un utilisateur/mot de passe pour VOIR les écrans, les identifiants de l'étape 2
docker compose up -d --build
```
Chaque écran = un navigateur Chromium avec sa propre mémoire (il reste connecté après un redémarrage) + un petit agent
qui parle à Food Hub.

### 5. Montrer les écrans dans Food Hub (5 min)
Chaque écran écoute sur `127.0.0.1:3101`, `3102`, … (dans l'ordre de la liste). Mettez-les derrière votre proxy https
(Coolify / Traefik / Cloudflare Tunnel), p. ex. `https://ecrans.votredomaine.ca/uber-1/` → `127.0.0.1:3101`, et
protégez-les (le mot de passe de `.env`, ou mieux Cloudflare Access). Mettez ces adresses dans Food Hub (étape 2).

### 6. Se connecter une fois dans chaque écran (5 min)
Ouvrez l'écran (dans Food Hub ou en plein écran), connectez-vous avec le courriel du compte, cochez « se souvenir de cet
appareil » si la plateforme le propose. En 20 s, le point vert et le titre de la page apparaissent dans Food Hub.

### Ajouter un écran plus tard
Ajoutez une ligne dans `screens.json`, `node generate.mjs`, ajoutez son identifiant dans `.env`,
`docker compose up -d --build`. Rien d'autre ne change.

---

## B. Le vrai appareil Android (l'app du Play Store)

Quand une plateforme n'offre que son application, l'écran est un **Android complet dans un conteneur**, avec le Play
Store. Il faut un serveur Linux **avec KVM** (la plupart des VPS « KVM » et tout serveur dédié ; pas un VPS « OpenVZ »).
Vérifiez : `ls /dev/kvm` doit exister.

1. **Une fois, construisez l'image Android avec Play Store** sur le serveur (les images Android publiques n'ont pas
   le Play Store). Avec les scripts officiels de Google, `github.com/google/android-emulator-container-scripts` :
   vous acceptez la licence du SDK Android, puis `emu-docker create <émulateur> <image système google_apis_playstore x86_64 33>`
   et `docker build -t foodhub/android-playstore:33 <dossier>`. Un autre nom d'image se passe avec
   `node generate.mjs --android-image <nom>`.
2. **Une clé adb** pour que l'agent parle à l'appareil : dans `deploy/screens/`, `adb keygen adbkey` (deux fichiers,
   ignorés par git ; ne les copiez nulle part).
3. Dans `screens.json`, la ligne de l'écran a `"mode": "android"` et `"package"` (le nom de l'app de commandes :
   DoorDash Order Manager, Uber Eats Order Manager, Skip Partner ; le générateur connaît déjà les trois).
4. `node generate.mjs`, puis `ADBKEY="$(cat adbkey)" docker compose --profile android up -d --build` (le profil
   `android` ne démarre que ces écrans ; les écrans web continuent comme avant). L'appareil garde ses données dans un
   volume nommé : les apps et la connexion survivent aux redémarrages.
5. Ouvrez la vue de l'écran (`127.0.0.1:6081`, `6082`, … derrière votre proxy), **vous-même** : ouvrez le Play Store,
   connectez-vous à un compte Google, installez l'app de la plateforme, ouvrez-la, connectez-vous au compte du
   magasin. Elle reste connectée.
6. L'agent Android ne fait que trois choses : vérifier que l'appareil répond, que l'app est devant, et **compter** ses
   notifications (le compte est fait sur l'appareil ; seul un chiffre en sort). « Recharger » depuis Food Hub remet
   l'app devant, rien d'autre. Il ne touche jamais l'écran.

Le Play Store, les comptes Google et les applications sont à vous ; aucun robot ne s'y connecte.

---

## C. Le PC Windows du magasin (sans serveur)

Un PC Windows qui reste allumé fait le même travail pour un magasin : un Chrome par écran, chacun avec sa mémoire, et
un agent par écran qui parle à Food Hub. Au démarrage de la session Windows, tout repart tout seul, et une fenêtre
fermée par erreur est rouverte en 30 s.

Le guide pas à pas est dans `deploy/screens/windows/README-WINDOWS.md`. En résumé :
1. Installez Node 22 (nodejs.org, LTS).
2. Copiez le dossier `deploy/screens/` sur le PC, remplissez `screens.json` et `.env` comme en A (étapes 3 et 4).
3. Dans PowerShell : `.\windows\Install-Screens.ps1` (une fois), puis `.\windows\Start-Screens.ps1`.
4. Connectez-vous une fois dans chaque fenêtre Chrome.
5. Pour voir les écrans depuis Food Hub, laissez les fenêtres visibles sur le PC, ou installez Apache Guacamole
   (bureau à distance → page web https).

---

## Quand ça ne marche pas

| Ce que vous voyez | Ce que ça veut dire | Quoi faire |
|---|---|---|
| Point gris « jamais vu » dans Food Hub | l'agent ne parle pas à Food Hub | `.env` : le jeton est-il le même que dans Coolify ? l'identifiant de l'écran est-il le bon ? `docker compose logs <écran>-agent` |
| « Connexion requise » | la plateforme a déconnecté le compte | ouvrez l'écran et reconnectez-vous vous-même |
| Rouge « erreur » plusieurs fois | la page plante | l'agent recharge seul ; sinon « Recharger » dans Food Hub ; sinon `docker compose restart <écran>` |
| « Hors ligne » depuis 2 min | le serveur ou le conteneur est arrêté | `docker compose ps`, puis `docker compose up -d` |
| L'écran Android montre le bureau | l'app s'est fermée | « Recharger » dans Food Hub la remet devant ; si elle redemande le compte, reconnectez-vous |

**Po Poulet NDG (DoorDash 27982486)** : si un écran DoorDash montre ce magasin, personne n'y touche depuis Food Hub.

---
---

# Order screens on a server: the owner's guide (30 minutes)

_Lane B of the "Order screens rescue" (`docs/ORDER_SCREENS_RESCUE.md`). What Food Hub does with the screens (the wall
that rings, the "orders waiting" alert) is in `docs/PLATFORM_SCREENS.md`._

## The problem

A DoorDash or Uber Eats tablet drops its Wi-Fi or its sign-in. Orders ring on nothing, the platform pauses the store
("Temporarily closed" during opening hours), then deactivates it.

## The answer in one sentence

Every order screen runs on a **computer that never turns off** (a small server, or the store's PC), stays signed in,
and Food Hub watches it every 20 seconds. One device rings when an order is waiting.

| Way | For whom | What it takes |
|---|---|---|
| **A. Linux server with Docker** (recommended) | every store, every account | a small server or VPS (2 vCPU / 4 GB for 3–4 screens), wired, always on |
| **B. The real Android app** (DoorDash / Uber from the Play Store) | when the platform only offers its app | way A, plus a Linux server **with KVM** |
| **C. The store's Windows PC** | one store, no server | a Windows 10/11 PC that stays on, Node 22 |

**What it never does:** nobody, no robot and no agent, types your password or an SMS code. **You sign in yourself,
once, inside each screen.** It stays signed in. Robots never click an order and never read its content: they only
check that the screen is up, signed in, and how many orders are waiting (the number in the page title, or the count of
the app's notifications).

## Fastest: Food Hub's 18 numbered screens (s01–s18)
Food Hub's screens wall and this host use the same numbers, so nothing is copied by hand.
1. **Token** as in step 1 below.
2. Food Hub → Platform screens → **Set up screens**: how many DoorDash / Uber Eats / Skip (default 8 / 6 / 4), the
   location, the host's address (e.g. `https://screens.on2go.ca/`). It creates s01–s18 at `…/s01/` … `…/s18/`.
3. On the host: `cp screens.18.example.json screens.json && node generate.mjs`, fill `.env` (no `SCREEN_ID_…` lines
   needed), `docker compose up -d --build`.
4. One address for all 18, the **gateway** (started by the same `docker compose`, `127.0.0.1:3100`): it sends `/s01/` to
   screen s01 … `/s18/` to s18 (path kept), asks the view password once, and lets only Food Hub (`FOODHUB_ORIGIN`) frame
   the screens. In Coolify (or Cloudflare Tunnel) one domain: `https://ecrans.on2go.ca` → `127.0.0.1:3100`.
5. To show them **inside** Food Hub: a **sub-domain of Food Hub's domain** (browsers block the view's sign-in cookie in
   a frame from another site), `FOODHUB_ORIGIN=https://foodhub.on2go.ca` in `.env`, and in Food Hub
   `FOODHUB_SCREENS_VIEW_HOSTS=ecrans.on2go.ca`.
6. Sign in once in each screen. Switch a screen's channel on its tile in Food Hub: it opens that platform's sign-in page.

**Skip:** live orders may only be in the Skip Partner app (the web portal is for menus and history); if a Skip web
screen shows no orders, run it in Android (B).

## A. Linux server with Docker
1. **Token:** `openssl rand -hex 24` → in Coolify → Food Hub → `FOODHUB_SCREENS_AGENT_TOKEN` (secret), redeploy.
2. **Screens in Food Hub:** Stores → Platform screens → Add a screen, once per platform account; edit each to copy its id.
3. **The list:** `cp screens.example.json screens.json`, one line per screen (`id`, `platform`, `name`, `startUrl`,
   `mode`). Never a user name, password or token in it: the generator refuses.
4. **Generate and start:** `node generate.mjs` → `cp .env.example .env` (fill it) → `docker compose up -d --build`.
5. **Show them in Food Hub:** each screen listens on `127.0.0.1:3101`, `3102`, …; put them behind your https proxy,
   protect them, and save those addresses in Food Hub.
6. **Sign in once in each screen.** The green dot appears within 20 s.

## B. The real Android app
Needs a Linux host **with KVM** (`ls /dev/kvm`). Once, build the Play Store image with Google's own scripts
(`github.com/google/android-emulator-container-scripts`: accept the Android SDK licence, `emu-docker create` with a
`google_apis_playstore` system image, `docker build -t foodhub/android-playstore:33`), and make an adb key
(`adb keygen adbkey`, git-ignored). In `screens.json` set `"mode": "android"` and `"package"` (the order apps: DoorDash
Order Manager, Uber Eats Order Manager, Skip Partner; the generator knows all three); `node generate.mjs`;
`ADBKEY="$(cat adbkey)" docker compose --profile android up -d --build`. The device keeps its data in a named volume.
Open the screen's view (`127.0.0.1:6081`, …) and, yourself: Play Store → Google account → install the platform app →
sign in to the store account. The Android agent only checks the device answers, the app is in front, and **counts** its
notifications (counted on the device; only a number comes out); "Reload" brings the app back to the front. It never
touches the screen.

## C. The store's Windows PC
One Chrome per screen with its own profile and an agent each, restarted at sign-in and watched every 30 s. Steps in
`deploy/screens/windows/README-WINDOWS.md`: install Node 22, copy `deploy/screens/`, fill `screens.json` and `.env`,
run `Install-Screens.ps1` then `Start-Screens.ps1`, sign in once in each Chrome window.

## When it does not work
| You see | It means | Do |
|---|---|---|
| Grey "never seen" | the agent does not reach Food Hub | same token as in Coolify? right screen id? `docker compose logs <screen>-agent` |
| "Sign-in required" | the platform signed the account out | open the screen and sign in yourself |
| Red "error" repeatedly | the page crashes | the agent reloads by itself; else "Reload" in Food Hub; else `docker compose restart <screen>` |
| "Offline" for 2 min | the server or container is down | `docker compose ps`, then `docker compose up -d` |
| Android screen shows the home screen | the app closed | "Reload" in Food Hub brings it back; if it asks for the account, sign in |

**Po Poulet NDG (DoorDash 27982486):** if a DoorDash screen shows that store, nobody acts on it from Food Hub.
