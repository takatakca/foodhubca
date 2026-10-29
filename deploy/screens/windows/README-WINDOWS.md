# Écrans de commande sur le PC Windows du magasin (façon C)

_Lane B de « Order screens rescue ». Les trois façons (serveur Docker, appareil Android, PC Windows) sont comparées
dans `docs/PLATFORM_SCREENS_RELAY.md`. English version below._

## Ce que ça fait

Le PC du magasin (Windows 10 ou 11, qui reste allumé) fait tourner **un Chrome par écran de commande** (Uber Eats,
DoorDash, Skip…), chacun avec **sa propre mémoire** (vous vous connectez une fois, il reste connecté) et **son propre
petit agent** qui dit à Food Hub, toutes les 20 secondes, si l'écran est allumé, encore connecté, et combien de
commandes attendent (le chiffre dans le titre de la page). Au démarrage de la session Windows, tout repart tout seul.
Une fenêtre fermée par erreur est rouverte en 30 secondes. Un agent qui plante est relancé.

**Ce que ça ne fait jamais :** aucun script ne demande, ne garde, n'affiche ni ne tape un mot de passe ou un code SMS.
Vous vous connectez vous-même, une fois, dans chaque fenêtre Chrome. Les agents ne cliquent jamais sur une commande et
ne lisent jamais son contenu. Le jeton Food Hub est lu dans `.env` et passé à l'agent seulement : jamais dans un
fichier de configuration, un journal ou à l'écran. Aucun droit administrateur n'est nécessaire.

Les quatre scripts (dossier `deploy\screens\windows\`) :

| Script | Rôle |
|---|---|
| `Install-Screens.ps1` | une fois : lit `screens.json`, crée un profil Chrome et un port par écran, écrit une configuration par écran (sans secret), installe les paquets de l'agent, enregistre la tâche planifiée « FoodHub Screens » (au démarrage de votre session) |
| `Start-Screens.ps1` | démarre chaque Chrome et chaque agent, puis surveille toutes les 30 s (c'est ce que la tâche planifiée lance) |
| `Status-Screens.ps1` | montre chaque écran : pid de Chrome, pid de l'agent, port, dernière ligne du journal |
| `Stop-Screens.ps1` | arrête tout (les connexions sont gardées) ; `-Unregister` enlève aussi la tâche planifiée |

Fichiers sur le PC : `%LOCALAPPDATA%\FoodHubScreens\<id>\profile` (la mémoire de Chrome), `…\<id>\screen.json` (la
configuration, sans secret), `…\logs\<id>.log` (le journal, tourné à 5 Mo), `…\kit.json` (où sont les scripts).

## Les 10 étapes (environ 20 minutes)

1. **Node 22.** Installez la version LTS depuis nodejs.org (suivant, suivant, terminer). Chrome ou Edge est déjà là.
2. **Le jeton.** Dans Coolify, la variable `FOODHUB_SCREENS_AGENT_TOKEN` de Food Hub (24 caractères ou plus,
   `openssl rand -hex 24`). Redéployez Food Hub. (Une fois pour tous les magasins.)
3. **Les écrans dans Food Hub.** Stores → Platform screens → « Set up screens » (ou « Add a screen » un par un) :
   un écran par compte de plateforme de ce magasin. Notez l'identifiant de chaque écran (`s01`, `s02`… ou l'identifiant
   long dans « modifier »).
4. **Copiez le dossier** `deploy\screens\` du dépôt sur le PC, par exemple dans `C:\FoodHub\screens\`.
5. **La liste.** Copiez `screens.example.json` en `screens.json` et remplissez-la : une ligne par écran, avec `id`
   (l'identifiant de l'étape 3, ou un nom comme `SCREEN_ID_UBER_1` si vous préférez mettre l'identifiant dans `.env`),
   `platform` (`uber`, `doordash` ou `skip`), `name`, `startUrl` (la page des commandes) et `mode: "web"`.
   **Jamais** de nom d'utilisateur, de mot de passe, de jeton ni de code dans ce fichier : le script refuse et s'arrête.
   Les lignes `"mode": "android"` sont ignorées ici (elles sont pour la façon B).
6. **Le fichier `.env`.** Copiez `.env.example` en `.env` (dans `deploy\screens\` ou dans `windows\`) et remplissez
   `FOODHUB_URL` et `FOODHUB_SCREENS_AGENT_TOKEN` (le même jeton qu'à l'étape 2). Si vos `id` sont des noms
   (`SCREEN_ID_UBER_1`), ajoutez une ligne `SCREEN_ID_UBER_1=<identifiant Food Hub>` par écran ; avec des identifiants
   `s01`… directement dans la liste, rien d'autre à ajouter. Les lignes `SCREENS_VIEW_*` ne servent pas sur Windows.
7. **Installez.** Ouvrez PowerShell (pas en administrateur), allez dans le dossier et lancez :
   ```powershell
   cd C:\FoodHub\screens\windows
   powershell -ExecutionPolicy Bypass -File .\Install-Screens.ps1
   ```
   Il affiche ce qu'il fait : chaque écran avec son port (9222, 9223…) et sa fenêtre, puis « start at sign-in ».
   Pour vérifier avant : ajoutez `-DryRun` (rien n'est écrit).
8. **Démarrez.** `powershell -ExecutionPolicy Bypass -File .\Start-Screens.ps1` : une fenêtre Chrome par écran
   s'ouvre, chacune à sa place sur le moniteur. La prochaine fois, la tâche planifiée le fera toute seule à l'ouverture
   de votre session Windows (20 secondes après).
9. **Connectez-vous une fois dans chaque fenêtre** (voir ci-dessous). Dans Food Hub, le point de l'écran devient vert
   dans les 20 secondes et son titre apparaît.
10. **Vérifiez** avec `.\Status-Screens.ps1` : chaque ligne montre le pid de Chrome, le pid de l'agent et le port
    (un `!` après le port = Chrome ne répond pas encore). Réglez le PC pour qu'il **ne se mette jamais en veille**
    (Paramètres → Système → Alimentation : « Jamais » sur secteur) et pour **ouvrir votre session automatiquement**
    après un redémarrage (ou gardez-le allumé). Fini.

## Se connecter une fois dans chaque fenêtre Chrome

Chaque fenêtre est un Chrome normal, avec sa propre mémoire : ce que vous faites dans l'une ne touche pas les autres.
1. Dans la fenêtre, la page de connexion de la plateforme s'affiche. Entrez **vous-même** le courriel du compte, le mot
   de passe, et le code SMS si la plateforme en demande un. Cochez « se souvenir de cet appareil » quand c'est offert.
2. Vérifiez que la page des commandes est bien celle de l'onglet (Uber Eats Orders, DoorDash Order Manager, Skip).
   Si la plateforme vous a envoyé ailleurs après la connexion, allez sur la page des commandes : elle est mémorisée.
3. Ne fermez pas la fenêtre. (Si vous la fermez, elle est rouverte en 30 s, encore connectée.)
4. Au prochain redémarrage, la fenêtre revient connectée : la mémoire est dans `%LOCALAPPDATA%\FoodHubScreens\<id>\profile`.

## Montrer les écrans dans Food Hub

Deux façons :
- **Simple :** laissez le PC allumé, les fenêtres visibles, sur le moniteur du comptoir. C'est le mur d'écrans. Food
  Hub montre leur état (vert, « connexion requise », hors ligne) et le nombre de commandes en attente, et fait sonner
  l'appareil choisi (Stores → Platform screens → « Ring on this device »).
- **À distance (bureau dans une page web) :** installez Apache Guacamole sur un serveur (ou sur le PC), connectez-le
  au bureau du PC par RDP, et mettez l'adresse https de Guacamole comme adresse de vue de l'écran dans Food Hub (Stores →
  Platform screens → modifier). Protégez cette adresse (utilisateur et mot de passe de Guacamole, ou Cloudflare
  Access). Jamais de nom d'utilisateur ni de mot de passe dans l'adresse : Food Hub la refuse.

## Quand ça ne marche pas

| Ce que vous voyez | Quoi faire |
|---|---|
| **Une fenêtre montre la page de connexion de la plateforme** (Food Hub dit « connexion requise ») | La plateforme a déconnecté le compte (ça arrive toutes les quelques semaines, ou après un changement de mot de passe). Allez devant le PC, connectez-vous **vous-même** dans cette fenêtre comme à l'étape 9. Rien d'autre à faire : l'agent voit la page des commandes et redevient vert dans les 20 s. |
| Point gris « jamais vu » dans Food Hub | `.\Status-Screens.ps1` : l'agent est-il « down » ? Regardez `%LOCALAPPDATA%\FoodHubScreens\logs\<id>.log`. « .env is missing … » : remplissez `.env` (le même jeton que dans Coolify), l'agent repart tout seul dans les 30 s. « Food Hub answered 401 » : le jeton n'est pas le même. « does not know screen » : l'identifiant n'est pas celui de Food Hub. |
| Port avec `!` dans Status, Chrome « down » | Chrome n'a pas démarré : regardez le journal ; un autre programme utilise-t-il le port ? Relancez avec `-PortBase 9300` dans `Install-Screens.ps1`. |
| La fenêtre revient sans arrêt (toutes les 30 s) | C'est voulu : le chien de garde rouvre une fenêtre fermée. Pour arrêter : `.\Stop-Screens.ps1`. |
| Rien ne démarre à l'ouverture de session | Planificateur de tâches → « FoodHub Screens » : est-elle là ? Sinon `.\Install-Screens.ps1` encore ; si le Planificateur refuse, le script met un raccourci dans le dossier Démarrage de votre session. |
| Trop d'onglets dans une fenêtre | Fermez les onglets en trop ; la session est gardée. (La page de départ n'est ouverte qu'au tout premier démarrage du profil ; ensuite Chrome reprend la session précédente.) |
| Le PC se met en veille | Paramètres → Système → Alimentation et mise en veille → Jamais (sur secteur). |

**Po Poulet NDG (DoorDash 27982486) :** si un écran DoorDash montre ce magasin, personne n'y touche depuis Food Hub.

---
---

# Order screens on the store's Windows PC (way C)

_Lane B of "Order screens rescue". The three ways (Docker server, Android device, Windows PC) are compared in
`docs/PLATFORM_SCREENS_RELAY.md`._

## What it does

The store's PC (Windows 10 or 11, always on) runs **one Chrome per order screen** (Uber Eats, DoorDash, Skip…), each
with **its own profile** (sign in once, it stays signed in) and **its own small agent** that tells Food Hub every 20 s
whether the screen is up, still signed in, and how many orders wait (the number in the page title). At Windows
sign-in everything restarts by itself. A window closed by mistake is reopened within 30 s. A crashed agent is restarted.

**What it never does:** no script asks for, keeps, prints or types a platform password or an SMS code. You sign in
yourself, once, inside each Chrome window. The agents never click an order and never read its content. The Food Hub
token is read from `.env` and handed to the agent only: never written to a config file, a log or the console. No admin
rights are needed.

The four scripts (folder `deploy\screens\windows\`):

| Script | Role |
|---|---|
| `Install-Screens.ps1` | once: reads `screens.json`, creates one Chrome profile and one port per screen, writes a per-screen config (no secret), installs the agent's packages, registers the Scheduled Task "FoodHub Screens" (at sign-in of your session) |
| `Start-Screens.ps1` | starts every Chrome and every agent, then watches every 30 s (what the Scheduled Task runs) |
| `Status-Screens.ps1` | shows each screen: Chrome pid, agent pid, port, last log line |
| `Stop-Screens.ps1` | stops everything (sign-ins are kept); `-Unregister` also removes the Scheduled Task |

Files on the PC: `%LOCALAPPDATA%\FoodHubScreens\<id>\profile` (Chrome's memory), `…\<id>\screen.json` (the config,
no secret), `…\logs\<id>.log` (the log, rotated at 5 MB), `…\kit.json` (where the scripts are).

## The 10 steps (about 20 minutes)

1. **Node 22.** Install the LTS from nodejs.org (next, next, finish). Chrome or Edge is already there.
2. **The token.** In Coolify, Food Hub's `FOODHUB_SCREENS_AGENT_TOKEN` (24+ characters, `openssl rand -hex 24`).
   Redeploy Food Hub. (Once for every store.)
3. **The screens in Food Hub.** Stores → Platform screens → "Set up screens" (or "Add a screen" one by one): one screen
   per platform account of this store. Note each screen's id (`s01`, `s02`… or the long id under "edit").
4. **Copy the folder** `deploy\screens\` from the repository to the PC, e.g. into `C:\FoodHub\screens\`.
5. **The list.** Copy `screens.example.json` to `screens.json` and fill it: one line per screen with `id` (the id from
   step 3, or a name like `SCREEN_ID_UBER_1` if you prefer to put the id in `.env`), `platform` (`uber`, `doordash` or
   `skip`), `name`, `startUrl` (the orders page) and `mode: "web"`. **Never** a user name, password, token or code in
   this file: the script refuses it and stops. `"mode": "android"` lines are skipped here (they are for way B).
6. **The `.env` file.** Copy `.env.example` to `.env` (in `deploy\screens\` or in `windows\`) and fill `FOODHUB_URL`
   and `FOODHUB_SCREENS_AGENT_TOKEN` (the same token as in step 2). If your `id`s are names (`SCREEN_ID_UBER_1`), add
   one `SCREEN_ID_UBER_1=<Food Hub id>` line per screen; with `s01`… ids directly in the list, nothing else to add.
   The `SCREENS_VIEW_*` lines are not used on Windows.
7. **Install.** Open PowerShell (not as administrator), go to the folder and run:
   ```powershell
   cd C:\FoodHub\screens\windows
   powershell -ExecutionPolicy Bypass -File .\Install-Screens.ps1
   ```
   It prints what it does: each screen with its port (9222, 9223…) and window, then "start at sign-in". To check
   first: add `-DryRun` (nothing is written).
8. **Start.** `powershell -ExecutionPolicy Bypass -File .\Start-Screens.ps1`: one Chrome window per screen opens, each
   in its own place on the monitor. Next time the Scheduled Task does it by itself when your Windows session opens
   (20 s later).
9. **Sign in once in each window** (below). In Food Hub the screen's dot turns green within 20 s and its title shows.
10. **Check** with `.\Status-Screens.ps1`: each line shows the Chrome pid, the agent pid and the port (a `!` after the
    port = Chrome does not answer yet). Set the PC to **never sleep** (Settings → System → Power: "Never" when plugged
    in) and to **sign in automatically** after a restart (or keep it on). Done.

## Signing in once inside each Chrome window

Each window is a normal Chrome with its own memory: what you do in one does not touch the others.
1. The window shows the platform's sign-in page. Enter the account's email, the password and the SMS code if the
   platform asks, **yourself**. Tick "remember this device" when offered.
2. Check the tab shows the orders page (Uber Eats Orders, DoorDash Order Manager, Skip). If the platform sent you
   elsewhere after sign-in, go to the orders page: it is remembered.
3. Do not close the window. (If you do, it is reopened within 30 s, still signed in.)
4. After the next restart the window comes back signed in: the memory is in `%LOCALAPPDATA%\FoodHubScreens\<id>\profile`.

## Showing the screens in Food Hub

Two ways:
- **Simple:** leave the PC on with the windows visible on the counter's monitor. That is the screens wall. Food Hub
  shows their state (green, "sign-in required", offline) and the waiting count, and rings the chosen device (Stores →
  Platform screens → "Ring on this device").
- **Remote (desktop in a web page):** install Apache Guacamole on a server (or on the PC), connect it to the PC's desktop
  over RDP, and put Guacamole's https address as the screen's view address in Food Hub (Stores → Platform screens →
  edit). Protect that address (Guacamole user and password, or Cloudflare Access). Never a user name or password in the
  address: Food Hub refuses it.

## When it does not work

| You see | Do |
|---|---|
| **A window shows the platform's sign-in page** (Food Hub says "sign-in required") | The platform signed the account out (every few weeks, or after a password change). Go to the PC and sign in **yourself** in that window as in step 9. Nothing else: the agent sees the orders page and turns green within 20 s. |
| Grey "never seen" in Food Hub | `.\Status-Screens.ps1`: is the agent "down"? Read `%LOCALAPPDATA%\FoodHubScreens\logs\<id>.log`. ".env is missing …": fill `.env` (same token as in Coolify); the agent starts by itself within 30 s. "Food Hub answered 401": the token differs. "does not know screen": the id is not Food Hub's. |
| Port with `!` in Status, Chrome "down" | Chrome did not start: read the log; does another program use the port? Reinstall with `-PortBase 9300`. |
| The window keeps coming back (every 30 s) | By design: the watchdog reopens a closed window. To stop: `.\Stop-Screens.ps1`. |
| Nothing starts at sign-in | Task Scheduler → "FoodHub Screens": is it there? Else run `.\Install-Screens.ps1` again; if the Task Scheduler refuses, the script puts a shortcut in your session's Startup folder. |
| Too many tabs in a window | Close the extra tabs; the session is kept. (The start page is opened only on the profile's very first start; later Chrome restores the previous session.) |
| The PC goes to sleep | Settings → System → Power & sleep → Never (plugged in). |

**Po Poulet NDG (DoorDash 27982486):** if a DoorDash screen shows that store, nobody acts on it from Food Hub.
