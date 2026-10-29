# REGISTRE TAKATAK — tout le travail depuis le jour 1

_Pour chaque agent (Claude, Codex, Cursor, Copilot) et pour le propriétaire. À lire **avant** de commencer, pour ne
jamais refaire deux fois le même travail. English summary in each section title._

— signé : Claude (busy-cannon, Claude Code cloud) · 2026-10-29 22:40 · session https://claude.ai/code/session_01YAyd8px5aDq9UaUdzjASk5

Ce registre a trois sources, toutes vérifiables :
1. **l'historique git complet** de chaque dépôt lisible ici (du premier commit à aujourd'hui), §3 ;
2. **la liste des dépôts publics `takatakca`**, §2 (les dépôts privés : seulement dans la version complète, sur Google Drive) ;
3. **les notes déjà écrites** : le dossier Google Drive « 00 — Opérations TAKATAK », le tableau
   [foodhubca#105](https://github.com/takatakca/foodhubca/issues/105) et les fichiers de reprise de chaque dépôt, §1.

Il ne contient aucun secret (dépôt public) : ni mot de passe, ni clé, ni jeton, ni numéro de dossier.

## 0. Les règles du propriétaire, à TOUJOURS suivre / Owner's standing orders (always)

**Avant de commencer**
1. Lire ce registre, le dossier Drive **« 00 — Opérations TAKATAK »** (fichier principal :
   « TAKATAK hosting (MochaHost → Coolify) — MAIN FILE »), puis les derniers commentaires du tableau
   [foodhubca#105](https://github.com/takatakca/foodhubca/issues/105), puis le `WORKLOG.md` /
   `docs/AGENT_HANDOFF.md` du dépôt visé.
2. Si un autre agent a une ligne CLAIM / UPDATE de moins de 24 h sur le même travail : **ne pas le refaire**. Continuer
   sa branche à partir de son « next step », ou prendre un autre travail.

**Pendant le travail (ordre du propriétaire, 2026-10-29)**
3. **Note instantanée à chaque étape, même au milieu du code** : une ligne CLAIM au départ, puis UPDATE à chaque étape
   (au moins toutes les 20 minutes et avant toute étape longue), PAUSED ou DONE à la fin. Format :
   `STATUT | agent: <nom> @ <où> | dépôt · branche → PR | travail | prochaine étape`. Ainsi, si un agent manque de
   crédits ou s'arrête, un autre reprend sans rien perdre et sans doublon.
4. **Tout le travail visible en tout temps** : pousser sa branche souvent (même en WIP), jamais de travail seulement en
   local.
5. **Signature partout** : chaque note, commentaire, fichier de reprise et note Drive finit par
   `— signé : <agent> (<session ou nom>) @ <où> · <AAAA-MM-JJ HH:MM>`. Les commits gardent leur ligne
   `Co-Authored-By`.
6. **Copilot** : quand il peut aider à résoudre un problème, l'activer (« Request review » de Copilot sur la PR, ou
   assigner Copilot à une issue). Une revue Claude automatique peut être sautée faute de crédits : Copilot la remplace.
7. **Fusionner** (ordre du 2026-10-29, ~22 h, « toi tu devrais merger automatiquement aussi ») : un agent fusionne
   lui-même **sa** PR quand les vérifications sont vertes (CI verte, ou le seul rouge est le blocage connu de
   facturation GitHub Actions et les vérifications locales du dépôt sont vertes). Jamais de commit direct sur `main`,
   jamais de force-push, jamais d'historique réécrit, jamais d'effacement de travail qu'on n'a pas fait. La PR d'un autre
   agent : la fusionner seulement si elle se fusionne proprement et que les vérifications passent sur le résultat ;
   sinon laisser une note sur la PR.
8. Notes dans **les deux** : GitHub (tableau #105 + fichiers du dépôt) **et** Google Drive « 00 — Opérations TAKATAK ».

**Règles dures (depuis toujours)**
- **Po Poulet NDG (DoorDash 27982486) n'est jamais touché** : pas de publication, pas de 86, pas de réponse, pas de
  demande de support.
- Dépôts publics : jamais de secret, de clé, de jeton, de valeur `.env`, de numéro de dossier, de donnée bancaire, de
  courriel ou de téléphone de personne.
- Chaque plateforme n'entend parler que d'elle-même (un message DoorDash ne nomme jamais Uber, Skip ou Too Good To Go).
- Personne (agent ou robot) ne tape un mot de passe, un code SMS / 2FA, un numéro de carte ou de banque : le propriétaire
  le fait.
- Un seul agent à la fois par compte (portail DoorDash, Uber Manager, chaque boîte Gmail, MochaHost, Coolify, Clover).
- Marque : `BRAND.md` (bleu électrique sur marine ; vert / ambre / rouge seulement pour un état).

## 1. Où sont les notes / Where the notes are

| Quoi | Où |
| --- | --- |
| Tableau des agents (CLAIM / UPDATE / DONE) | [foodhubca#105](https://github.com/takatakca/foodhubca/issues/105) |
| Notes du propriétaire et des agents | Google Drive → **« 00 — Opérations TAKATAK »** (fichier principal hébergement, notes KLEAN par site, DoorDash, Uber, écrans de commande, ON2GO) |
| Reprise d'un dépôt | `WORKLOG.md` (une ligne par travail, la plus récente en haut), `docs/AGENT_HANDOFF.md`, `docs/TASK_QUEUE.md`, `docs/PROJECT_STATUS.md`, `docs/OWNER_ACTIONS.md` |
| Food Hub | `CLAUDE.md` (règles), `docs/PROGRESS.md`, `docs/MASTER_PLAN.md`, `docs/ORDER_SCREENS_RESCUE.md`, `docs/PLATFORM_SCREENS_RELAY.md`, `docs/TAKATAK_SUITE.md` ; tâches du propriétaire : `private/TASKS.md` (sur son PC) |
| Version complète du registre (dépôts privés compris) | Google Drive « 00 — Opérations TAKATAK » → « 00 — REGISTRE TAKATAK — tout le travail depuis le jour 1 » |

## 4. Ce que cette session a fait, et comment / What this session did and how (2026-10-28 → 2026-10-29)

Session « Food Hub order manager integration » (busy-cannon), Claude Code dans le nuage, branche
`claude/busy-cannon-5spy86` dans chaque dépôt.

### 4.1 TAKATAK Suite : les 9 applications Clover (2026-10-28)
- **Quoi** : C4ISSE, T4CTILE, 4CCOUNTING, TR4CKER, ST4FF, M4RKETING, LOY4LTY, REW4RDS, CH4T. Chacune fonctionne seule ;
  ensemble elles parlent à travers Food Hub.
- **Comment** : un kit commun identique dans les 9 dépôts (`lib/core/`, `lib/clover/`, OAuth Clover, jetons scellés avec
  `TOKEN_ENCRYPTION_KEY`, webhooks signés, lien Food Hub), puis le code propre à chaque app dans `lib/domain/` et
  `components/Panel.tsx`. Cadre « premium » : menu latéral avec sous-menus, Mon compte (profil, forfait, actions
  autorisées, appareils, paiements, sécurité, journal), page Suite, Aide ; rôles Clover dans la session et actions
  autorisées vérifiées côté serveur avec journal. Marchand `RNVTBYMCKXEJ1` (On2GO.ca dormant) en lecture seule.
- **Où** : PR #1 dans chacun des 9 dépôts (branche `claude/busy-cannon-5spy86`). Côté Food Hub : bus d'événements et
  annuaire de la suite (`lib/foodhub/suite/*`, `GET /api/suite/v1/directory` signé, Réglages → Applications
  connectées), fusionnés dans foodhubca #102. Contrat : `docs/TAKATAK_SUITE.md` ; revue : `docs/TAKATAK_SUITE_PLAYBOOK.md`.
- **Reste** : fusionner les 9 PR #1 (vérifier d'abord qu'elles se fusionnent proprement avec ce qui a été ajouté sur
  `main` depuis, p. ex. « Picture Register » dans C4ISSE) ; l'inscription au Clover App Market est une étape du
  propriétaire (`DEPLOY.md` de chaque app).

### 4.2 Écrans de commande : les tablettes DoorDash / Uber Eats / Skip sur un serveur (2026-10-29)
- **Le problème** : les tablettes perdent le Wi-Fi ou leur connexion, la plateforme met le magasin en pause puis le
  désactive.
- **Quoi** : chaque compte de plateforme tourne dans son propre navigateur sur un serveur relais toujours allumé ; Food Hub
  les montre tous sur un **mur d'écrans** (1, 2, 4, 8, 12, 16, 20, 24 écrans, onglets, disposition libre, vue Liste),
  **un seul appareil sonne** quand une commande attend, la **Tour de guet** alerte (écran hors ligne, déconnecté, ou
  commande sans réponse). Le propriétaire se connecte lui-même une fois dans chaque écran ; aucun mot de passe n'est
  gardé ; les robots ne cliquent jamais une commande.
- **Comment, PR par PR (foodhubca, toutes fusionnées)** :
  - #102 — mur, sonnerie, heartbeat v2 (mode web/android, app, nombre en attente), règle `screen_waiting`, numéros de
    magasin par écran (Po Poulet NDG marqué « ne jamais agir ») ; contient #107, le kit relais de la voie B (autre agent).
  - #109 — `main` de nouveau vert (un test dépendait de l'heure) + sécurité : en-tête anti-clickjacking sur la console,
    écrans limités aux hôtes `FOODHUB_SCREENS_VIEW_HOSTS`.
  - #110 — passerelle : une seule adresse (`https://ecrans.on2go.ca/s01/` …) pour tous les écrans, mot de passe de vue
    demandé une fois, seul Food Hub peut les afficher.
  - #111 — **54 comptes** (18 DoorDash, 18 Uber Eats, 18 Skip), numéros s01–s99, « Commencer au numéro » pour plusieurs
    serveurs, vue **Liste**.
  - #112 — **le serveur relais en une commande** : `deploy/screens/setup.sh --screens 54 --domain ecrans.on2go.ca`
    (HTTPS automatique, ou une route dans le Traefik de Coolify).
- **Guides** : `docs/ORDER_SCREENS_RESCUE.md` (plan et voies), `docs/PLATFORM_SCREENS.md`,
  `docs/PLATFORM_SCREENS_RELAY.md` (FR/EN, section « Le plus simple : une seule commande »).
- **Reste (propriétaire)** : Deploy de Food Hub dans Coolify ; `FOODHUB_SCREENS_AGENT_TOKEN` et
  `FOODHUB_SCREENS_VIEW_HOSTS` dans Coolify ; lancer `setup.sh` sur le serveur relais ; DNS ; « Préparer les écrans » ;
  se connecter une fois dans chaque écran.

### 4.3 ON2GO.ca : « Mon compte » pour le client (2026-10-29)
- **Quoi** : l'espace client du site on2go.ca (commandes, restaurants enregistrés, récompenses, cartes-cadeaux,
  paiement, adresses, aide, préférences et confidentialité selon la Loi 25), aux couleurs TAKATAK.
- **Où** : dépôt privé ; détails, PR et contrat des routes dans la version complète du registre (Google Drive).
- **Reste, côté Food Hub** : l'agent « customer-identity » doit livrer `GET /api/foodhub/customers/me` et
  `GET /api/foodhub/customers/me/orders` (+ favoris, adresses, cartes-cadeaux, suppression du compte, déconnexion), avec
  CORS pour `https://on2go.ca`.

### 4.4 Notes laissées
Google Drive « 00 — Opérations TAKATAK » : notes 2026-10-29 04-55, 05-50, 15-05, 15-10, 21-00 et ce registre. Tableau
[foodhubca#105](https://github.com/takatakca/foodhubca/issues/105) : une ligne à chaque étape.

## 5. Ce qui reste ouvert, et quoi en faire / Open pull requests and what to do

État au 2026-10-29 22 h, vérifié avec git (fusion à blanc contre `main`). « Propre » = se fusionne sans conflit.

**foodhubca (22 PR ouvertes à 22 h ; 4 fusionnées depuis, 18 restantes)**

| PR | Sujet | État | À faire |
| --- | --- | --- | --- |
| #52 | accessibilité cuisine (thème sombre, cibles tactiles) | **fusionnée** 2026-10-29 (testée avec #48, #45, #106 : typecheck, 1663 tests, build, verify 578/0) | — |
| #48 | annuaire public ON2GO gardé pendant un arrêt de la base | **fusionnée** 2026-10-29 | — |
| #45 | DoorDash Drive : liste de validation du restaurant | **fusionnée** 2026-10-29 | — |
| #106 | règle du tableau des agents dans `AGENTS.md` / `CLAUDE.md` | **fusionnée** 2026-10-29 | — |
| #108 | brouillon Copilot (même règle) | aucun changement de fichier | fermer après #106 |
| #104 | limite 128 Kio des commandes du site web | conflit | rebaser sur `main`, retester, fusionner |
| #99, #100 | MEV : commandes vers Takatak MEV (QCMEV), app Clover MEV | conflit (gros, ~250–300 fichiers) | voir la session « QCMEV.CA » ; mettre à jour avec `main` |
| #97 | « Release 2026-10-23 » (11 PR testées ensemble) | conflit | vérifier ce qui est déjà dans `main`, fermer ce qui est remplacé |
| #88, #90, #91, #94 | console premium A4 / A1 / A2 / A3 (empilées) | conflit | mettre à jour A4 d'abord, puis A1, A2, A3 |
| #92 | Next.js 16.4.2 | **remplacée** (`main` a déjà 16.4.3) | fermer |
| #96 | outils de dev (vitest 4.1.12, vite 8.3.4) | conflit | refaire sur `main` si encore utile |
| #93, #95 | texto de suivi envoyé une seule fois + suites | conflit | mettre à jour avec `main`, retester (commandes) |
| #87 | API publique du formulaire on2go.ca (restaurant-leads) | conflit ; **attendue par on2go.ca** | mettre à jour avec `main` en priorité |
| #55 | squelettes de chargement accessibles | conflit | mettre à jour avec `main` |
| #98 | recherche : caisse visuelle Clover | conflit (docs) | mettre à jour, fusionner |
| #39, #44 | anciennes lignes de journal | conflit (docs) | fermer : remplacées par ce registre et `docs/PROGRESS.md` |

**Les 9 applications Clover** : PR #1 dans chaque dépôt (voir 4.1).
## 2. Index des dépôts publics takatakca (52) / Public repository index

_Les 9 dépôts privés sont dans la version complète du registre, dans Google Drive « 00 — Opérations TAKATAK » (jamais dans un dépôt public)._

| Dépôt | Visibilité | Dernier push | Historique détaillé ici |
| --- | --- | --- | --- |
| [foodhubca](https://github.com/takatakca/foodhubca) | public | 2026-10-29 | oui → §3 foodhubca |
| [takatak-v1](https://github.com/takatakca/takatak-v1) | public | 2026-10-29 | oui → §3 takatak-v1 |
| [droneair](https://github.com/takatakca/droneair) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [revers-canada-hope](https://github.com/takatakca/revers-canada-hope) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [BESOINAVOCAT.CA](https://github.com/takatakca/BESOINAVOCAT.CA) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [Alkao.ca](https://github.com/takatakca/Alkao.ca) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [EMPLOIDIRECT.CA](https://github.com/takatakca/EMPLOIDIRECT.CA) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [ACTIONAVOCAT.CA](https://github.com/takatakca/ACTIONAVOCAT.CA) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [CUBARESORT.CA](https://github.com/takatakca/CUBARESORT.CA) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [flexsca](https://github.com/takatakca/flexsca) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [RAMASSEDEBRIS.CA](https://github.com/takatakca/RAMASSEDEBRIS.CA) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [mimtcaapp](https://github.com/takatakca/mimtcaapp) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [LOCACTIF.CA](https://github.com/takatakca/LOCACTIF.CA) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [MIELAISSA.CA](https://github.com/takatakca/MIELAISSA.CA) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [rentautoca](https://github.com/takatakca/rentautoca) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [qmaps](https://github.com/takatakca/qmaps) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [takatakbackend](https://github.com/takatakca/takatakbackend) | public | 2026-10-29 | oui → §3 takatakbackend |
| [TAKATAK-APP](https://github.com/takatakca/TAKATAK-APP) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [ON2GO-CLOVER](https://github.com/takatakca/ON2GO-CLOVER) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [pppmtl](https://github.com/takatakca/pppmtl) | public | 2026-10-29 | oui → §3 pppmtl |
| [r2neet](https://github.com/takatakca/r2neet) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [ocarinaspa](https://github.com/takatakca/ocarinaspa) | public | 2026-10-29 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [CH4T](https://github.com/takatakca/CH4T) | public | 2026-10-29 | oui → §3 CH4T |
| [REW4RD](https://github.com/takatakca/REW4RD) | public | 2026-10-29 | oui → §3 REW4RD |
| [LOY4LTY](https://github.com/takatakca/LOY4LTY) | public | 2026-10-29 | oui → §3 LOY4LTY |
| [M4RKETING](https://github.com/takatakca/M4RKETING) | public | 2026-10-29 | oui → §3 M4RKETING |
| [ST4FF](https://github.com/takatakca/ST4FF) | public | 2026-10-29 | oui → §3 ST4FF |
| [TR4CKER](https://github.com/takatakca/TR4CKER) | public | 2026-10-29 | oui → §3 TR4CKER |
| [4CCOUNTING](https://github.com/takatakca/4CCOUNTING) | public | 2026-10-29 | oui → §3 4CCOUNTING |
| [T4CTILE](https://github.com/takatakca/T4CTILE) | public | 2026-10-29 | oui → §3 T4CTILE |
| [C4ISSE](https://github.com/takatakca/C4ISSE) | public | 2026-10-29 | oui → §3 C4ISSE |
| [QCMEV.CA](https://github.com/takatakca/QCMEV.CA) | public | 2026-10-29 | oui → §3 QCMEV.CA |
| [deli-aden-online](https://github.com/takatakca/deli-aden-online) | public | 2026-10-29 | oui → §3 deli-aden-online |
| [SEOTAKATAK](https://github.com/takatakca/SEOTAKATAK) | public | 2026-10-28 | oui → §3 SEOTAKATAK |
| [Facturations](https://github.com/takatakca/Facturations) | public | 2026-10-28 | oui → §3 Facturations |
| [festiiceca](https://github.com/takatakca/festiiceca) | public | 2026-10-28 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [ahmverdunca](https://github.com/takatakca/ahmverdunca) | public | 2026-10-27 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [isexy](https://github.com/takatakca/isexy) | public | 2026-10-27 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [assurance-6241](https://github.com/takatakca/assurance-6241) | public | 2026-10-26 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [TAKATAKREVIEW](https://github.com/takatakca/TAKATAKREVIEW) | public | 2026-10-24 | oui → §3 TAKATAKREVIEW |
| [takatak-doordash-operations](https://github.com/takatakca/takatak-doordash-operations) | public | 2026-10-21 | oui → §3 takatak-doordash-operations |
| [1lv-marketplace-hub](https://github.com/takatakca/1lv-marketplace-hub) | public | 2026-10-16 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [cubafoodca](https://github.com/takatakca/cubafoodca) | public | 2026-10-16 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [takatak-automate](https://github.com/takatakca/takatak-automate) | public | 2026-10-16 | oui → §3 takatak-automate |
| [ACADEMYTAKATAK](https://github.com/takatakca/ACADEMYTAKATAK) | public | 2026-10-16 | oui → §3 ACADEMYTAKATAK |
| [knowledgeAI](https://github.com/takatakca/knowledgeAI) | public | 2026-10-16 | oui → §3 knowledgeAI |
| [mimt](https://github.com/takatakca/mimt) | public | 2026-10-16 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [GLOBESECURE.CA](https://github.com/takatakca/GLOBESECURE.CA) | public | 2026-10-16 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [R2NETTEEMAIL](https://github.com/takatakca/R2NETTEEMAIL) | public | 2026-10-14 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [DOMINICFINANCE](https://github.com/takatakca/DOMINICFINANCE) | public | 2026-10-13 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [CCC-CANADIEN-CONNEXION-CUBA](https://github.com/takatakca/CCC-CANADIEN-CONNEXION-CUBA) | public | 2026-10-08 | non (voir son WORKLOG.md / docs/AGENT_HANDOFF.md) |
| [takatak](https://github.com/takatakca/takatak) | public | 2026-10-08 | oui → §3 takatak |

## 3. Historique détaillé, dépôt par dépôt (depuis le premier commit) / Full history per repository

_Source : `git log` de la branche principale (historique complet). « PR » = pull request fusionnée ; « signatures » = lignes Co-Authored-By des commits (qui a écrit le code)._

### 4ccounting

- **2 commits** du 2026-10-28 au 2026-10-28 0dd1d91 · 0 PR fusionnées · fichiers de reprise : `DEPLOY.md`
- Signatures (Co-Authored-By) : — · Auteurs git : TAKATAK MARKETING ×2

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-28 | 2 | 2026-10-28 — Agent code Clover — build-out initial 4CCOUNTING (README, fiche/docs, scaffold webhook/OAuth, DEPLOY) · Initial commit |

### academytakatak

- **235 commits** du 2026-10-15 au 2026-10-16 20dbc91 · 0 PR fusionnées · fichiers de reprise : `WORKLOG.md`, `docs/AGENT_HANDOFF.md`, `docs/TASK_QUEUE.md`, `docs/PROJECT_STATUS.md`, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md`, `AGENTS.md`
- Signatures (Co-Authored-By) : — · Auteurs git : takatakca ×235

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-16 | 78 | docs(academy): record passing 41-test CI and privacy release blockers [skip ci] · docs(academy): record passing 41-test CI and privacy release blockers [skip ci] · docs(academy): record passing 41-test CI and privacy rel |
| 2026-10-15 | 157 | test(academy): isolate self-review DB check from published-version uniqueness test · test(academy): prove concurrent exam replay is rejected by PostgreSQL; verify author-review separation · docs(academy): record one-time |

### c4isse

- **3 commits** du 2026-10-28 au 2026-10-28 9e7a48f · 0 PR fusionnées · fichiers de reprise : `DEPLOY.md`
- Signatures (Co-Authored-By) : — · Auteurs git : TAKATAK MARKETING ×3

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-28 | 3 | 2026-10-28 18:30 — Fusion Picture Register dans C4ISSE (correction Matt) : section module caisse-photo au README, docs/modules/picture-register.md, DEPLOY corrigé (ne pas soumettre J0H36VTJBSBBP comme app distincte) · 20 |

### ch4t

- **2 commits** du 2026-10-28 au 2026-10-28 250e101 · 0 PR fusionnées · fichiers de reprise : `DEPLOY.md`
- Signatures (Co-Authored-By) : — · Auteurs git : TAKATAK MARKETING ×2

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-28 | 2 | 2026-10-28 — Agent code Clover — build-out initial CH4T (README, fiche/docs, scaffold webhook/OAuth, DEPLOY) · Initial commit |

### deli-aden-online

- **422 commits** du 2025-01-01 au 2026-10-08 94ba19c · 0 PR fusionnées · fichiers de reprise : `WORKLOG.md`, `AGENTS.md`, `CLAUDE.md`
- Signatures (Co-Authored-By) : takatakca ×344, Claude Opus 5.5 ×2 · Auteurs git : gpt-engineer-app[bot] ×419, Claude ×2, Lovable ×1

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-08 | 2 | docs: GROUPE TAKATAK brand reference (BRAND.md) and brand rule in AGENTS.md · docs: work log rule for every agent (AGENTS.md, WORKLOG.md, stop reminder) |
| 2026-10-02 | 9 | Changes · Changes · Changes |
| 2026-09-08 | 7 | Changes · Changes · Changes |
| 2026-09-06 | 1 | Work in progress |
| 2026-09-01 | 2 | Changes · Work in progress |
| 2026-08-10 | 1 | Work in progress |
| 2026-08-09 | 18 | Changes · Changes · Changes |
| 2026-08-08 | 13 | Changes · Changes · Changes |
| 2026-08-07 | 15 | Changes · Changes · Changes |
| 2026-08-06 | 11 | Changes · Changes · Changes |
| 2026-08-04 | 28 | Changes · Changes · Changes |
| 2026-07-09 | 3 | Changes · Changes · Work in progress |
| 2026-07-05 | 25 | Changes · Changes · Changes |
| 2026-07-03 | 15 | Changes · Changes · Changes |
| 2026-07-02 | 32 | Changes · Changes · Changes |
| 2026-06-09 | 25 | Changes · Changes · Changes |
| 2026-06-08 | 13 | Changes · Changes · Changes |
| 2026-06-07 | 3 | Changes · Changes · Changes |
| 2026-06-06 | 1 | Work in progress |
| 2026-06-05 | 8 | Changes · Changes · Changes |
| 2026-06-03 | 31 | Changes · Changes · Changes |
| 2026-06-02 | 30 | Changes · Changes · Changes |
| 2026-06-01 | 19 | Changes · Changes · Changes |
| 2026-05-17 | 7 | Changes · Changes · Changes |
| 2026-05-16 | 12 | Changes · Changes · Changes |
| 2026-05-15 | 1 | Work in progress |
| 2026-05-14 | 22 | Changes · Changes · Changes |
| 2026-05-12 | 17 | Changes · Changes · Changes |
| 2026-05-11 | 9 | Changes · Changes · Changes |
| 2025-01-01 | 1 | template: tanstack_start_ts_2026-05-06 |

### facturations

- **732 commits** du 2026-09-20 au 2026-10-07 995d5cb · 21 PR fusionnées · fichiers de reprise : `AGENTS.md`
- Signatures (Co-Authored-By) : Claude Opus 5.5 ×3 · Auteurs git : takatakca ×729, Claude ×3

| Date | PR | Titre | Branche |
| --- | --- | --- | --- |
| 2026-10-07 | [#161](https://github.com/takatakca/facturations/pull/161) | Record verified Stripe payments, refunds and disputes for issued invoices | `feat/verified-stripe-payments` |
| 2026-09-30 | [#155](https://github.com/takatakca/facturations/pull/155) | release: merge integration v1 audited candidate |  |
| 2026-09-28 | [#118](https://github.com/takatakca/facturations/pull/118) | hardening(final): HEAD logiciel final — production readiness consolidée | `hardening/final-production-consolidation` |
| 2026-09-20 | [#33](https://github.com/takatakca/facturations/pull/33) | Connect revisioned workspaces to cookie-only CSRF-protected HTTP routes | `feature/cookie-workspace-routes` |
| 2026-09-20 | [#32](https://github.com/takatakca/facturations/pull/32) | Add staff-owned recoverable draft workspace foundation with immutable revisions | `feature/revision-safe-draft-workspaces` |
| 2026-09-20 | [#31](https://github.com/takatakca/facturations/pull/31) | Expose safe bilingual dashboard sign-out using existing revoked sessions | `fix/visible-bilingual-dashboard-logout` |
| 2026-09-20 | [#30](https://github.com/takatakca/facturations/pull/30) | Fix MFA login pool starvation by reusing its PostgreSQL transaction | `fix/mfa-single-db-connection` |
| 2026-09-20 | [#29](https://github.com/takatakca/facturations/pull/29) | Align Facturations setup instructions with audited current capabilities | `docs/accurate-staging-setup` |
| 2026-09-20 | [#28](https://github.com/takatakca/facturations/pull/28) | Fix dashboard customer names to match each saved draft snapshot | `fix/dashboard-snapshot-customer-name` |
| 2026-09-20 | [#26](https://github.com/takatakca/facturations/pull/26) | Add opt-in bilingual staff browser sign-in with MFA and secure session cookie |  |
| 2026-09-20 | [#24](https://github.com/takatakca/facturations/pull/24) | Add encrypted one-time staff TOTP verification with replay protection | `security/staff-totp-replay-protection` |
| 2026-09-20 | [#23](https://github.com/takatakca/facturations/pull/23) | Accept strict staff cookie on read-only dashboard without opening invoice APIs |  |
| 2026-09-20 | [#22](https://github.com/takatakca/facturations/pull/22) | Add PostgreSQL-backed tenant-scoped login attempt limiter |  |
| 2026-09-20 | [#21](https://github.com/takatakca/facturations/pull/21) | Implement minimal tenant-scoped revoke-all staff sessions with isolated tests |  |
| 2026-09-20 | [#20](https://github.com/takatakca/facturations/pull/20) | Build bilingual read-only HTML dashboard behind staff session authorization | `feature/read-only-dashboard-html` |
| 2026-09-20 | [#19](https://github.com/takatakca/facturations/pull/19) | Add owner-only, tenant-scoped internal approval history API | `feature/owner-approval-ledger-readonly` |
| 2026-09-20 | [#17](https://github.com/takatakca/facturations/pull/17) | Close staff privacy bypass in full draft detail endpoint | `fix/restrict-full-draft-detail-to-owner` |
| 2026-09-20 | [#16](https://github.com/takatakca/facturations/pull/16) | Add append-only internal owner approval for exact saved invoice drafts | `feature/draft-internal-owner-approval` |
| 2026-09-20 | [#13](https://github.com/takatakca/facturations/pull/13) | Add one-time staff invitation and activation foundation |  |
| 2026-09-20 | [#12](https://github.com/takatakca/facturations/pull/12) | Phase 4: isolated staff identity and revocable session foundation |  |
| 2026-09-20 | [#11](https://github.com/takatakca/facturations/pull/11) | Protect invoice draft snapshots and audit events at database level |  |

### foodhubca

- **694 commits** du 2026-10-02 au 2026-10-29 1465c93 · 84 PR fusionnées · fichiers de reprise : `WORKLOG.md`, `docs/AGENT_HANDOFF.md`, `docs/PROGRESS.md`, `docs/TASK_QUEUE.md`, `docs/PROJECT_STATUS.md`, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md`, `AGENTS.md`, `CLAUDE.md`
- Signatures (Co-Authored-By) : Claude Opus 5.5 ×359, Claude Fable 5.1 ×45, Cursor ×13, takatakca ×1 · Auteurs git : Claude ×434, takatakca ×243, TAKATAK MARKETING ×14, github-actions[bot] ×2, copilot-swe-agent[bot] ×1

| Date | PR | Titre | Branche |
| --- | --- | --- | --- |
| 2026-10-29 | [#45](https://github.com/takatakca/foodhubca/pull/45) | fix(delivery): match DoorDash Drive's restaurant validation checklist | `fix/drive-validation-checklist` |
| 2026-10-29 | [#48](https://github.com/takatakca/foodhubca/pull/48) | fix(foodhub): preserve ON2GO public directory during database stalls | `fix/public-directory-availability-20261014` |
| 2026-10-29 | [#52](https://github.com/takatakca/foodhubca/pull/52) | fix(ui): accessible kitchen dark theme, touch targets and route feedback | `fix/console-kitchen-a11y` |
| 2026-10-29 | [#106](https://github.com/takatakca/foodhubca/pull/106) | docs(agents): one live agent board — claim, update, pause, done (issue foodhubca#105) | `docs/agent-board-rule` |
| 2026-10-29 | [#112](https://github.com/takatakca/foodhubca/pull/112) | feat(screens): the relay host in one command — ./setup.sh, with HTTPS | `claude/busy-cannon-5spy86` |
| 2026-10-29 | [#111](https://github.com/takatakca/foodhubca/pull/111) | feat(screens): 54 accounts — 18 DoorDash, 18 Uber Eats, 18 Skip, one screen and one sign-in each | `claude/busy-cannon-5spy86` |
| 2026-10-29 | [#110](https://github.com/takatakca/foodhubca/pull/110) | feat(screens): one address for all 18 screens — relay gateway (ecrans.on2go.ca → 127.0.0.1:3100) | `claude/busy-cannon-5spy86` |
| 2026-10-29 | [#109](https://github.com/takatakca/foodhubca/pull/109) | fix: main CI green again (screens test no longer depends on the time of day) + security: anti-clickjacking, screens locked to the relay host | `claude/busy-cannon-5spy86` |
| 2026-10-29 | [#102](https://github.com/takatakca/foodhubca/pull/102) | Order screens: wall (18 screens, 1–24/tabs/custom, rings on one device) + relay kit (contains #107) + TAKATAK Suite bus and directory | `claude/busy-cannon-5spy86` |
| 2026-10-29 | [#107](https://github.com/takatakca/foodhubca/pull/107) | feat(screens): relay kit — N screens, Android mode, in-store PC | `feature/screens-relay-kit` |
| 2026-10-22 | [#89](https://github.com/takatakca/foodhubca/pull/89) | test(own-delivery): poll webhook side effects instead of a fixed 30 ms pause | `fix/own-delivery-test-wait` |
| 2026-10-22 | [#86](https://github.com/takatakca/foodhubca/pull/86) | feat(login): page de connexion plus simple + « Continuer avec Google » (OIDC, membres de l’équipe seulement) | `feature/login-google-signin` |
| 2026-10-22 | [#43](https://github.com/takatakca/foodhubca/pull/43) | fix(finance): importer fixes on the real exports — DoorDash historical columns, Uber tax split by rate, QST-only sales flag | `fix/finance-tax-split-doordash-hist` |
| 2026-10-22 | [#51](https://github.com/takatakca/foodhubca/pull/51) | fix(ops): fail closed on unpinned live release and add read-only production proof workflow | `fix/foodhub-production-proof-strict-sha` |
| 2026-10-22 | [#50](https://github.com/takatakca/foodhubca/pull/50) | fix(tenant): reject mismatched TAKATAK contract idempotency and integration headers | `fix/on2go-contract-header-validation` |
| 2026-10-22 | [#54](https://github.com/takatakca/foodhubca/pull/54) | fix(clover): create platform tenders without labelKey when Clover refuses it; show Clover's real answer | `fix/clover-tender-create` |
| 2026-10-22 | [#72](https://github.com/takatakca/foodhubca/pull/72) | feat(console): easy client dashboard — DoorDash-style simple view for multi-brand × multi-platform restaurants | `feature/client-dashboard-easy` |
| 2026-10-18 | [#85](https://github.com/takatakca/foodhubca/pull/85) | fix: do not fail health on a stale sync during startup | `fix/sync-startup-grace` |
| 2026-10-18 | [#84](https://github.com/takatakca/foodhubca/pull/84) | fix: name the failing health check and start Watchtower immediately | `fix/healthcheck-startup` |
| 2026-10-18 | [#83](https://github.com/takatakca/foodhubca/pull/83) | fix: pin the storefront checkout test to an open hour | `fix/storefront-checkout-clock` |
| 2026-10-18 | [#82](https://github.com/takatakca/foodhubca/pull/82) | fix: restore the phone fee text so Food Hub can build | `fix/legal-phone-fees-build` |
| 2026-10-17 | [#80](https://github.com/takatakca/foodhubca/pull/80) | SEO: public ON2GO.ca hub pages on foodhub.on2go.ca (replaces #70, now on main) | `feature/seo-hub-pages-main` |
| 2026-10-17 | [#79](https://github.com/takatakca/foodhubca/pull/79) | Legal: TAKATAK Phone AI named and priced in privacy and terms (re-land of #77) | `fix/legal-takatak-phone-ai` |
| 2026-10-17 | [#63](https://github.com/takatakca/foodhubca/pull/63) | fix(a11y): arrow, Home and End navigation for console tabs | `fix/console-tabs-keyboard-20261016` |
| 2026-10-17 | [#62](https://github.com/takatakca/foodhubca/pull/62) | fix(a11y): keyboard-safe nested modals and drawers | `fix/overlay-keyboard-focus-20261016` |
| 2026-10-17 | [#78](https://github.com/takatakca/foodhubca/pull/78) | Clover App Market badges on foodhub.on2go.ca (Food Hub + Phone AI), hidden until approval | `feature/clover-app-market-badges` |
| 2026-10-17 | [#76](https://github.com/takatakca/foodhubca/pull/76) | test(tgtg): forged-sender IMAP test really forges on CRLF checkouts | `fix/tgtg-forged-sender` |
| 2026-10-17 | [#75](https://github.com/takatakca/foodhubca/pull/75) | Commander direct (vitrine ON2GO) : page de commande sans commission par marque, cueillette d'abord, paiement Clover ou au comptoir / ON2GO Storefront: commissio | `feature/on2go-storefront` |
| 2026-10-17 | [#74](https://github.com/takatakca/foodhubca/pull/74) | Centre de disponibilité : réouverture prévue, calendrier « occupé », garde tablette éteinte, jours spéciaux, historique des statuts / Store availability center | `feature/store-availability-center` |
| 2026-10-17 | [#73](https://github.com/takatakca/foodhubca/pull/73) | Avis et notes : toutes les plateformes au même endroit, thèmes, réponses proposées jamais envoyées seules / Reviews hub | `feature/reviews-hub` |
| 2026-10-17 | [#71](https://github.com/takatakca/foodhubca/pull/71) | Outils de commande en cuisine : rupture depuis la commande, suivi du livreur, statut du magasin avec NIP, argent de la commande / Kitchen order tools | `feature/kitchen-order-tools` |
| 2026-10-17 | [#67](https://github.com/takatakca/foodhubca/pull/67) | Customer insights: new / occasional / frequent across every platform and direct orders, with privacy-safe anonymous ids | `feature/customer-insights` |
| 2026-10-17 | [#65](https://github.com/takatakca/foodhubca/pull/65) | Operations quality: 4 metrics with goals and a needs-attention list, for every platform at once | `feature/ops-quality-goals` |
| 2026-10-17 | [#64](https://github.com/takatakca/foodhubca/pull/64) | Sales mix: by item, hour, weekday, channel (platforms + direct) and fulfillment, with CSV/Excel export | `feature/sales-mix-report` |
| 2026-10-17 | [#69](https://github.com/takatakca/foodhubca/pull/69) | feat(billing): Clover subscription + trial status, extra-brand metered billing, add-brand price notice | `feature/clover-billing-extra-brands` |
| 2026-10-17 | [#61](https://github.com/takatakca/foodhubca/pull/61) | feat(clover): TAKATAK Phone, second Clover app (voice AI): own install, tokens, entitlement, per-minute billing | `feature/clover-voice-ai-app` |
| 2026-10-17 | [#68](https://github.com/takatakca/foodhubca/pull/68) | fix(phone): automated-assistant disclosure, transcription notice, press 0 for a person, card redaction | `fix/phone-ai-disclosure` |
| 2026-10-17 | [#66](https://github.com/takatakca/foodhubca/pull/66) | Legal pages complete for Clover review (privacy/terms/support + public /legal) | `fix/legal-pages-complete` |
| 2026-10-16 | [#57](https://github.com/takatakca/foodhubca/pull/57) | fix(stores): the 7 known Uber stores are in the Saint-Léonard kitchen, not NDG (task 39) | `fix/uber-store-kitchen-mapping` |
| 2026-10-16 | [#60](https://github.com/takatakca/foodhubca/pull/60) | Menu safety + per-brand dishes on shared menus (task 37) | `feature/menu-safety-brand-menus` |
| 2026-10-16 | [#58](https://github.com/takatakca/foodhubca/pull/58) | AI phone go-live: Québec FR/EN/ES voice, Clover payment link, upsell, review fixes (task 34) | `feature/ai-phone-quebec-paylink` |
| 2026-10-16 | [#59](https://github.com/takatakca/foodhubca/pull/59) | feat(tgtg): Too Good To Go order e-mails → Food Hub → Clover order + kitchen ticket (task 36) | `feature/tgtg-email-orders` |
| 2026-10-16 | [#56](https://github.com/takatakca/foodhubca/pull/56) | DoorDash sandbox-safe mode: sandbox webhooks on production with no effect on real operations (task 38) | `feature/doordash-sandbox-safe-mode` |
| 2026-10-15 | [#53](https://github.com/takatakca/foodhubca/pull/53) | feat(clover): owner test order on an API-token register — Clover proof while the app is a draft (task 33) | `feature/clover-admin-test-order` |
| 2026-10-15 | [#49](https://github.com/takatakca/foodhubca/pull/49) | Enable tested native Coolify production releases |  |
| 2026-10-14 | [#47](https://github.com/takatakca/foodhubca/pull/47) | Verify Food Hub Coolify live deployments | `ops/foodhub-coolify-live-proof` |
| 2026-10-11 | [#42](https://github.com/takatakca/foodhubca/pull/42) | Clover App Market listing refreshed: new console screenshots, blue brand cover and mark (task 31; after #40) | `docs/clover-listing-refresh` |
| 2026-10-10 | [#37](https://github.com/takatakca/foodhubca/pull/37) | fix(e2e): Watchtower step asks the cron again until it really runs | `fix/e2e-watchtower-flaky` |
| 2026-10-10 | [#33](https://github.com/takatakca/foodhubca/pull/33) | fix(expansion): kitchen phone check counts only kitchens that deliver | `fix/expansion-phone-check` |
| 2026-10-10 | [#40](https://github.com/takatakca/foodhubca/pull/40) | fix(build): main builds again — duplicate BRAND_ALIASES after #25/#38 (merge first) | `fix/main-build-brand-aliases` |
| 2026-10-10 | [#32](https://github.com/takatakca/foodhubca/pull/32) | docs(worklog): Uber Eats final + Extra loud alarm status | `docs/worklog-uber-session` |
| 2026-10-10 | [#24](https://github.com/takatakca/foodhubca/pull/24) | Work log: main session coordinator line | `docs/worklog-main-session` |
| 2026-10-10 | [#23](https://github.com/takatakca/foodhubca/pull/23) | docs: ON2GO Hub ecosystem blueprint (products, contracts, parity matrix, tenants, roadmap) | `docs/on2go-hub-ecosystem` |
| 2026-10-10 | [#34](https://github.com/takatakca/foodhubca/pull/34) | Own couriers: a third delivery fleet next to Drive / Uber Direct, with a courier page | `feature/own-fleet` |
| 2026-10-10 | [#25](https://github.com/takatakca/foodhubca/pull/25) | Finance A–Z report: platform, Clover and bank exports → P&L, commissions, disputes, payouts vs bank, money held | `feature/finance-a-to-z` |
| 2026-10-10 | [#36](https://github.com/takatakca/foodhubca/pull/36) | Tenant foundation: instance tenant id + TAKATAK control-plane contracts (no behaviour change) | `feature/tenant-context` |
| 2026-10-10 | [#35](https://github.com/takatakca/foodhubca/pull/35) | feat: every official Skip (JET Connect, Delivery-as-a-Service) and Too Good To Go (via Deliverect) API, coded and tested | `feature/skip-tgtg-api-coverage` |
| 2026-10-10 | [#38](https://github.com/takatakca/foodhubca/pull/38) | AI phone: never Po Poulet from NDG (owner lock); Saint-Léonard public address 5839 | `fix/ai-phone-po-poulet-5839` |
| 2026-10-09 | [#31](https://github.com/takatakca/foodhubca/pull/31) | fix(ci): verify GHCR pulls and prepare opt-in Coolify auto-deploy | `ops/ghcr-anonymous-pull-check` |
| 2026-10-09 | [#30](https://github.com/takatakca/foodhubca/pull/30) | feat: ON2GO phone menu | `feature/on2go-phone-ivr` |
| 2026-10-09 | [#29](https://github.com/takatakca/foodhubca/pull/29) | feat: DoorDash-style console scope switcher | `feature/console-store-switcher` |
| 2026-10-09 | [#28](https://github.com/takatakca/foodhubca/pull/28) | feat: DoorDash Marketplace and Drive API coverage | `feature/doordash-api-coverage` |
| 2026-10-09 | [#27](https://github.com/takatakca/foodhubca/pull/27) | ci: let Coolify pull the published Food Hub image | `ci/ghcr-readable` |
| 2026-10-09 | [#26](https://github.com/takatakca/foodhubca/pull/26) | fix: refuse a card-processor number as a Clover merchant ID | `fix/clover-merchant-id-check` |
| 2026-10-09 | [#22](https://github.com/takatakca/foodhubca/pull/22) | docs(expansion): deployed status + owner's 3 go-live steps for own-order delivery | `docs/expansion-golive` |
| 2026-10-09 | [#17](https://github.com/takatakca/foodhubca/pull/17) | AI phone: one line can serve brands from both kitchens | `feature/ai-phone-kitchens` |
| 2026-10-09 | [#20](https://github.com/takatakca/foodhubca/pull/20) | feat(ui): product name from FOODHUB_PRODUCT_NAME (Food Hub by default… | `feature/product-name` |
| 2026-10-09 | [#21](https://github.com/takatakca/foodhubca/pull/21) | Task 22: every Uber Eats Marketplace and Uber Direct API in Food Hub (61/61 endpoints, 17/17 webhooks) | `feature/uber-api-coverage` |
| 2026-10-09 | [#19](https://github.com/takatakca/foodhubca/pull/19) | CI: build the Food Hub Docker image on GitHub (GHCR) for 1-minute deploys | `ci/prebuilt-image` |
| 2026-10-09 | [#18](https://github.com/takatakca/foodhubca/pull/18) | Brand phone lines: one Twilio number per brand rings the main number (whisper, voicemail, texts by email) | `feature/brand-phone-lines` |
| 2026-10-09 | [#16](https://github.com/takatakca/foodhubca/pull/16) | Public directory feed for ON2GO.ca and QMAPS (GET /api/public/directory) | `feature/public-directory-api` |
| 2026-10-09 | [#14](https://github.com/takatakca/foodhubca/pull/14) | Task 3: "Extra loud" kitchen order alarm, on by default | `feat/kitchen-extra-loud` |
| 2026-10-09 | [#13](https://github.com/takatakca/foodhubca/pull/13) | Rules: main belongs to the owner; live task board moves to private/TASKS.md | `docs/git-workflow-owner-main` |
| 2026-10-09 | [#15](https://github.com/takatakca/foodhubca/pull/15) | Email through the company's own mail server (SMTP, e.g. MochaHost), Resend still supported | `feature/smtp-email` |
| 2026-10-09 | [#12](https://github.com/takatakca/foodhubca/pull/12) | Task 13: platform certification backlog (DoorDash, Uber Eats, DoorDash Drive) | `certification-backlog` |
| 2026-10-09 | [#11](https://github.com/takatakca/foodhubca/pull/11) | Task 12: pppmtl.com Clover website orders on the kitchen tablet (Clover Hosted Checkout) | `clover-website-menu` |
| 2026-10-08 | [#10](https://github.com/takatakca/foodhubca/pull/10) | Task 10: website orders through Clover shown on the Food Hub kitchen tablet (Clover keeps control) | `clover-website-orders` |
| 2026-10-08 | [#9](https://github.com/takatakca/foodhubca/pull/9) | Reconcile pr6 | `reconcile-pr6` |
| 2026-10-08 | [#8](https://github.com/takatakca/foodhubca/pull/8) | fix: SESSION_SECRET never generated at run time; webpack client build (task 9) | `fix/session-secret-stable` |
| 2026-10-07 | [#7](https://github.com/takatakca/foodhubca/pull/7) | Release/foodhub go live 2 | `release/foodhub-go-live-2` |
| 2026-10-06 | [#5](https://github.com/takatakca/foodhubca/pull/5) | Go live: Order Relay, one menu for all brands, DoorDash/Uber API fixes, deploy hardening |  |
| 2026-10-06 | [#4](https://github.com/takatakca/foodhubca/pull/4) | release: 1.5.9 — nothing typed is lost, help on every screen, promotions in Clover |  |
| 2026-10-06 | [#3](https://github.com/takatakca/foodhubca/pull/3) | release: 1.5.8 — go-live fixes + fluent console |  |
| 2026-10-05 | [#2](https://github.com/takatakca/foodhubca/pull/2) | release: 1.5.7 — RC10.7 console with the 1.4.0 finalization merged in |  |

### knowledgeai

- **188 commits** du 2026-10-05 au 2026-10-16 be98a20 · 2 PR fusionnées · fichiers de reprise : `WORKLOG.md`, `docs/AGENT_HANDOFF.md`, `docs/TASK_QUEUE.md`, `docs/PROJECT_STATUS.md`, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md`, `AGENTS.md`, `CLAUDE.md`
- Signatures (Co-Authored-By) : Claude Opus 5.5 ×12 · Auteurs git : takatakca ×150, github-actions[bot] ×26, Claude ×12

| Date | PR | Titre | Branche |
| --- | --- | --- | --- |
| 2026-10-09 | [#2](https://github.com/takatakca/knowledgeai/pull/2) | MIMT: link the mimtcaapp code repo, close the bootstrap log line | `claude/mimt-repo-link` |
| 2026-10-09 | [#1](https://github.com/takatakca/knowledgeai/pull/1) | MIMT: regulatory brief, cost-efficient stack and MVP plan | `claude/mimt-telecom-plan` |

### loy4lty

- **2 commits** du 2026-10-28 au 2026-10-28 9be8c73 · 0 PR fusionnées · fichiers de reprise : `DEPLOY.md`
- Signatures (Co-Authored-By) : — · Auteurs git : TAKATAK MARKETING ×2

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-28 | 2 | 2026-10-28 — Agent code Clover — build-out initial LOY4LTY (README, fiche/docs, scaffold webhook/OAuth, DEPLOY) · Initial commit |

### m4rketing

- **2 commits** du 2026-10-28 au 2026-10-28 71efdd7 · 0 PR fusionnées · fichiers de reprise : `DEPLOY.md`
- Signatures (Co-Authored-By) : — · Auteurs git : TAKATAK MARKETING ×2

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-28 | 2 | 2026-10-28 — Agent code Clover — build-out initial M4RKETING (README, fiche/docs, scaffold webhook/OAuth, DEPLOY) · Initial commit |

### pppmtl

- **793 commits** du 2026-08-07 au 2026-10-29 13a1fab · 9 PR fusionnées · fichiers de reprise : `WORKLOG.md`, `docs/AGENT_HANDOFF.md`, `docs/TASK_QUEUE.md`, `docs/PROJECT_STATUS.md`, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md`, `AGENTS.md`, `CLAUDE.md`
- Signatures (Co-Authored-By) : takatakca ×446, Claude Opus 5.5 ×32, Claude Opus 5.5 (1M context) ×3 · Auteurs git : gpt-engineer-app[bot] ×454, takatakca ×158, TAKATAK MARKETING ×140, Claude ×37, github-actions[bot] ×2, lovable ×1

| Date | PR | Titre | Branche |
| --- | --- | --- | --- |
| 2026-10-26 | [#12](https://github.com/takatakca/pppmtl/pull/12) | Simplification PPP — étapes 1 et 2 : étiquettes propres, groupes suggérés exclus, fiche en sections, menu en grille | `simplification-collections-fiche` |
| 2026-10-26 | [#11](https://github.com/takatakca/pppmtl/pull/11) | Liens DoorDash PPP : NDG 28040070 (6284) + Saint-Léonard 33598081 (5839) | `liens/doordash-ppp-2026-10-26` |
| 2026-10-26 | [#10](https://github.com/takatakca/pppmtl/pull/10) | Heures Saint-Léonard (5839) : 11 h – 23 h | `fix/heures-saint-leonard-11h-2026-10-26` |
| 2026-10-26 | [#8](https://github.com/takatakca/pppmtl/pull/8) | Contenu — données canoniques du propriétaire (5839 ouvert, 3583 en pause, guide Clover sans Lovable) | `contenu/donnees-canoniques-2026-10-26` |
| 2026-10-26 | [#9](https://github.com/takatakca/pppmtl/pull/9) | Back-end — .env.example et prérequis de branchement (Supabase TAKATAK, Postgres, Clover) | `backend/env-exemple-prerequis-2026-10-26` |
| 2026-10-14 | [#4](https://github.com/takatakca/pppmtl/pull/4) | Kitchen facts: NDG 16:00–03:00, Jean-Talon 10:00, Hochelaga for every brand | `fix/kitchen-facts-hochelaga` |
| 2026-10-10 | [#3](https://github.com/takatakca/pppmtl/pull/3) | fix(locations): Saint-Léonard public address is 5839 Rue Jean-Talon E | `fix/saint-leonard-5839` |
| 2026-10-09 | [#2](https://github.com/takatakca/pppmtl/pull/2) | Franchise brands on one app: store page per domain, all-restaurants view, one cart, Clover first, SEO + llms.txt | `feature/multi-brand` |
| 2026-10-09 | [#1](https://github.com/takatakca/pppmtl/pull/1) | pppmtl.com on the real Clover menu, paid with Clover Hosted Checkout (task 12) | `clover-direct` |

### qcmev.ca

- **18 commits** du 2026-10-23 au 2026-10-26 6d2eba4 · 0 PR fusionnées · fichiers de reprise : `AGENTS.md`
- Signatures (Co-Authored-By) : Claude Opus 5.5 ×7, Claude Sonnet 4.6 ×4 · Auteurs git : takatak ca ×7, Claude ×7, Takatak MEV ×4

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-26 | 2 | docs: update main handoff with final verified backend code and green CI · docs: point future agents to verified backend delivery branch and remaining blockers |
| 2026-10-24 | 15 | docs(rq): provide short-name download bundle after reported attachment error · docs(rq): add standard reading copy and record file-open validation · docs(rq): add electronic resolution signature fields and verified combi |
| 2026-10-23 | 1 | feat: complete Takatak MEV — Revenu Québec MEV-WEB SEV integration |

### rew4rd

- **2 commits** du 2026-10-28 au 2026-10-28 391287c · 0 PR fusionnées · fichiers de reprise : `DEPLOY.md`
- Signatures (Co-Authored-By) : — · Auteurs git : TAKATAK MARKETING ×2

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-28 | 2 | 2026-10-28 — Agent code Clover — build-out initial REW4RDS (README, fiche marketplace, légaux, scaffold webhook/OAuth, DEPLOY) · Initial commit |

### seotakatak

- **82 commits** du 2026-10-15 au 2026-10-28 0535037 · 0 PR fusionnées · fichiers de reprise : `WORKLOG.md`, `docs/AGENT_HANDOFF.md`, `docs/TASK_QUEUE.md`, `docs/PROJECT_STATUS.md`, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md`, `AGENTS.md`
- Signatures (Co-Authored-By) : — · Auteurs git : takatakca ×70, TAKATAK MARKETING ×12

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-28 | 11 | docs(handoff): capture final CI and precise Coolify failure for current Merchant backend · docs(handoff): record verified Merchant CI and exact Coolify release blocker · docs(merchant): hand off tested source/issue diagn |
| 2026-10-26 | 1 | docs: TAKATAK_FIELD_STATE + FREE_LISTINGS_CONNECTION_GUIDE (pack BLOC-08b) |
| 2026-10-16 | 46 | docs(handoff): record green shared PostgreSQL quota CI and approved migration 0005 release gate · fix(ci): consistently normalize PostgreSQL quota responses for concurrency assertions · test(postgres): verify shared impo |
| 2026-10-15 | 24 | docs(release): hand off verified schema readiness, API limits and pending production gate · fix(readiness): require approved schema columns before reporting database ready · security(api): implement scoped bounded reques |

### st4ff

- **2 commits** du 2026-10-28 au 2026-10-28 aa69aaa · 0 PR fusionnées · fichiers de reprise : `DEPLOY.md`
- Signatures (Co-Authored-By) : — · Auteurs git : TAKATAK MARKETING ×2

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-28 | 2 | 2026-10-28 — Agent code Clover — build-out initial ST4FF (README, fiche/docs, scaffold webhook/OAuth, DEPLOY) · Initial commit |

### t4ctile

- **2 commits** du 2026-10-28 au 2026-10-28 80b8263 · 0 PR fusionnées · fichiers de reprise : `DEPLOY.md`
- Signatures (Co-Authored-By) : — · Auteurs git : TAKATAK MARKETING ×2

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-28 | 2 | 2026-10-28 — Agent code Clover — build-out initial T4CTILE (README, fiche/docs, scaffold webhook/OAuth, DEPLOY) · Initial commit |

### takatak

- **86 commits** du 2025-05-25 au 2026-10-08 8fa20d1 · 0 PR fusionnées · fichiers de reprise : `WORKLOG.md`, `AGENTS.md`, `CLAUDE.md`
- Signatures (Co-Authored-By) : Claude Opus 5.5 ×2 · Auteurs git : Elitecrafttech ×82, Claude ×2, takatakca ×2

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-08 | 2 | docs: GROUPE TAKATAK brand reference (BRAND.md) and brand rule in AGENTS.md · docs: work log rule for every agent (AGENTS.md, WORKLOG.md, stop reminder) |
| 2025-11-23 | 1 | system |
| 2025-10-24 | 1 | homepg |
| 2025-10-02 | 1 | dashboard design & checkout page |
| 2025-09-24 | 2 | lnd · lnd |
| 2025-09-18 | 1 | temporary using email while testing |
| 2025-09-16 | 1 | createupmindsection |
| 2025-09-13 | 1 | nav |
| 2025-09-06 | 1 | set up |
| 2025-09-03 | 2 | ongoing · ongoing |
| 2025-09-02 | 3 | ongoing · ongoing · ongoing |
| 2025-09-01 | 3 | ongoing · ongoing · ongoing |
| 2025-08-18 | 4 | hosting · hosting · hosting |
| 2025-08-16 | 6 | domain complete · domain complete · domain complete |
| 2025-08-15 | 1 | domain |
| 2025-08-14 | 1 | domain |
| 2025-08-13 | 1 | domain |
| 2025-08-11 | 4 | md screen · md screen · md screen |
| 2025-08-10 | 3 | upm · domain · domain |
| 2025-08-09 | 3 | domain · dsn · domain |
| 2025-08-07 | 4 | domainsearch dac widget · domainsearch dac widget · domainsearch dac widget |
| 2025-07-19 | 1 | first dashboard |
| 2025-07-15 | 2 | adjst · adjst |
| 2025-07-10 | 3 | log ~ more · protected route · responsive mobile |
| 2025-07-09 | 1 | responsiveness |
| 2025-07-08 | 4 | signup sessionstorage · state · state |
| 2025-07-07 | 2 | bug fixed · hitting bug |
| 2025-07-04 | 2 | otp · otp |
| 2025-06-30 | 2 | apis · api |
| 2025-06-28 | 2 | otp · sign |
| 2025-06-27 | 7 | sign up · landing page desktop done · xl screen |
| 2025-06-26 | 2 | sections img adjut · other sections |
| 2025-06-25 | 1 | lnd page continu |
| 2025-06-23 | 1 | lnd page |
| 2025-06-03 | 1 | sumry |
| 2025-06-02 | 2 | week responsive · week responsive |
| 2025-06-01 | 1 | rmv |
| 2025-05-30 | 1 | tkat |
| 2025-05-28 | 2 | nex updt · nex upd |
| 2025-05-27 | 1 | takat |
| … | | 1 jours plus anciens : `git log` |

### takatak-automate

- **782 commits** du 2025-01-01 au 2026-10-16 17c3a5a · 0 PR fusionnées · fichiers de reprise : `WORKLOG.md`, `docs/AGENT_HANDOFF.md`, `docs/TASK_QUEUE.md`, `docs/PROJECT_STATUS.md`, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md`, `AGENTS.md`, `CLAUDE.md`
- Signatures (Co-Authored-By) : takatakca ×731, Claude Opus 5.5 ×2 · Auteurs git : gpt-engineer-app[bot] ×754, takatakca ×25, Claude ×2, Lovable ×1

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-16 | 9 | docs: preserve 2026-10-16 verified deployment and security work handoff · fix(services): validate canonical product keys and return actual persisted state · ci: run backend contract authorization regression tests |
| 2026-10-14 | 16 | docs(handoff): record passing Node SSR CI and stuck Render release · fix(start): migrate removed TanStack server function validator API and secure AI backend routing · ci: smoke test production Node SSR server and health |
| 2026-10-08 | 2 | docs: GROUPE TAKATAK brand reference (BRAND.md) and brand rule in AGENTS.md · docs: work log rule for every agent (AGENTS.md, WORKLOG.md, stop reminder) |
| 2026-09-07 | 6 | Changes · Changes · Changes |
| 2026-09-06 | 23 | Changes · Changes · Changes |
| 2026-09-01 | 10 | Changes · Changes · Changes |
| 2026-08-20 | 15 | Changes · Changes · Changes |
| 2026-08-12 | 9 | Changes · Changes · Changes |
| 2026-08-10 | 14 | Changes · Changes · Changes |
| 2026-08-09 | 8 | Changes · Changes · Changes |
| 2026-08-08 | 18 | Changes · Changes · Changes |
| 2026-08-07 | 13 | Changes · Changes · Changes |
| 2026-08-06 | 1 | Work in progress |
| 2026-08-05 | 10 | Changes · Changes · Changes |
| 2026-08-04 | 103 | Changes · Changes · Changes |
| 2026-07-09 | 12 | Changes · Changes · Changes |
| 2026-07-05 | 6 | Changes · Changes · Changes |
| 2026-07-03 | 11 | Changes · Changes · Changes |
| 2026-07-02 | 3 | Changes · Changes · Work in progress |
| 2026-06-22 | 125 | Changes · Changes · Changes |
| 2026-06-21 | 54 | Changes · Changes · Changes |
| 2026-06-09 | 20 | Changes · Changes · Changes |
| 2026-06-08 | 1 | Work in progress |
| 2026-06-07 | 1 | Update site info for publish |
| 2026-06-06 | 12 | Changes · Changes · Changes |
| 2026-06-05 | 13 | Changes · Changes · Changes |
| 2026-06-03 | 11 | Changes · Changes · Changes |
| 2026-06-02 | 7 | Changes · Changes · Changes |
| 2026-06-01 | 6 | Changes · Changes · Changes |
| 2026-05-30 | 5 | Changes · Changes · Changes |
| 2026-05-29 | 25 | Changes · Changes · Changes |
| 2026-05-27 | 19 | Changes · Changes · Changes |
| 2026-05-26 | 52 | Changes · Changes · Changes |
| 2026-05-19 | 43 | Changes · Changes · Changes |
| 2026-05-16 | 14 | Changes · Changes · Changes |
| 2026-05-15 | 10 | Changes · Changes · Changes |
| 2025-01-01 | 1 | template: tanstack_start_ts_2026-05-12 |

### takatak-doordash-operations

- **11 commits** du 2026-10-21 au 2026-10-21 2b43539 · 0 PR fusionnées · fichiers de reprise : `AGENTS.md`
- Signatures (Co-Authored-By) : — · Auteurs git : takatakca ×11

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-21 | 11 | Document manual appeals and report verification · Add empty business coverage schema · Add empty dispute reconciliation schema |

### takatak-v1

- **469 commits** du 2026-08-05 au 2026-10-29 e9b66c3 · 97 PR fusionnées · fichiers de reprise : `WORKLOG.md`, `docs/AGENT_HANDOFF.md`, `docs/TASK_QUEUE.md`, `docs/PROJECT_STATUS.md`, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md`, `AGENTS.md`, `CLAUDE.md`
- Signatures (Co-Authored-By) : Claude Opus 5.5 ×91, Cursor ×32, Claude ×16, takatakca ×12, Cursor Agent ×1 · Auteurs git : takatakca ×314, Claude ×104, Elitecrafttech ×37, TAKATAK MARKETING ×9, Cursor Agent ×3, LitCraftiQ ×2

| Date | PR | Titre | Branche |
| --- | --- | --- | --- |
| 2026-10-29 | [#230](https://github.com/takatakca/takatak-v1/pull/230) | docs: journal erreurs Claude bot GitHub par client (2026-10-29, KLEAN) | `klean/claude-bot-errors-journal-2026-10-29` |
| 2026-10-23 | [#224](https://github.com/takatakca/takatak-v1/pull/224) | Add fail-closed X API cost controls |  |
| 2026-10-22 | [#222](https://github.com/takatakca/takatak-v1/pull/222) | fix(website): make terms and privacy policies discoverable from homepage footer |  |
| 2026-10-22 | [#221](https://github.com/takatakca/takatak-v1/pull/221) | feat: enable Pinterest production OAuth connection |  |
| 2026-10-22 | [#219](https://github.com/takatakca/takatak-v1/pull/219) | feat(auth): publish the Supabase OAuth consent page | `cursor/oauth-consent-page-8c23` |
| 2026-10-19 | [#217](https://github.com/takatakca/takatak-v1/pull/217) | fix(social): use selected Meta Facebook Page for Instagram attach check |  |
| 2026-10-18 | [#216](https://github.com/takatakca/takatak-v1/pull/216) | fix(social): correctly parse positive brand testing allowance |  |
| 2026-10-18 | [#215](https://github.com/takatakca/takatak-v1/pull/215) | feat(social): allow env-scoped brand capacity for live workspace testing |  |
| 2026-10-18 | [#214](https://github.com/takatakca/takatak-v1/pull/214) | fix(auth): make Account Access email-only for passwordless OTP accounts |  |
| 2026-10-18 | [#213](https://github.com/takatakca/takatak-v1/pull/213) | fix(auth): email verification returns to real account settings route |  |
| 2026-10-18 | [#212](https://github.com/takatakca/takatak-v1/pull/212) | feat(auth): operator email recovery for existing phone-verified identities |  |
| 2026-10-18 | [#211](https://github.com/takatakca/takatak-v1/pull/211) | fix(auth): use same-origin API for registration SMS OTP |  |
| 2026-10-18 | [#210](https://github.com/takatakca/takatak-v1/pull/210) | fix(auth): never auto-confirm unverified email during session creation |  |
| 2026-10-18 | [#209](https://github.com/takatakca/takatak-v1/pull/209) | fix(auth): send SMS login requests through same-origin TAKATAK backend |  |
| 2026-10-18 | [#208](https://github.com/takatakca/takatak-v1/pull/208) | fix(ui): avoid unhandled rejection when tracked fetch fails |  |
| 2026-10-18 | [#207](https://github.com/takatakca/takatak-v1/pull/207) | fix(auth): allow recovery-email confirmation when profile already stores address |  |
| 2026-10-18 | [#206](https://github.com/takatakca/takatak-v1/pull/206) | chore(auth): remove temporary no-SMS registration banner after successful onboarding |  |
| 2026-10-18 | [#205](https://github.com/takatakca/takatak-v1/pull/205) | fix(auth): fetch canonical verified Supabase Auth user before profile sync |  |
| 2026-10-17 | [#204](https://github.com/takatakca/takatak-v1/pull/204) | fix(auth): complete phone registration without another paid SMS |  |
| 2026-10-17 | [#203](https://github.com/takatakca/takatak-v1/pull/203) | fix(auth): normalize Supabase verified international phone without + |  |
| 2026-10-17 | [#202](https://github.com/takatakca/takatak-v1/pull/202) | fix(auth): pinpoint profile sync failures and clarify recovery email fallback |  |
| 2026-10-16 | [#187](https://github.com/takatakca/takatak-v1/pull/187) | fix(auth): enforce CSRF and bounded JSON on invited-account setup | `fix/auth-origin-json-bounds-20261015` |
| 2026-10-16 | [#200](https://github.com/takatakca/takatak-v1/pull/200) | Approve the 17 pending migrations for production (direct takatak.ca release) | `claude/festive-newton-5i9rv7` |
| 2026-10-16 | [#192](https://github.com/takatakca/takatak-v1/pull/192) | AI Studio uses the key saved in Admin › AI provider keys (#155 → #137) | `claude/ai-studio-provider-keys` |
| 2026-10-16 | [#198](https://github.com/takatakca/takatak-v1/pull/198) | fix(coolify): reduce image size and avoid disk-filling chown layer |  |
| 2026-10-16 | [#197](https://github.com/takatakca/takatak-v1/pull/197) | fix(coolify): prevent Next.js build heap OOM |  |
| 2026-10-16 | [#136](https://github.com/takatakca/takatak-v1/pull/136) | QMAPS → TAKATAK: receive signed listing and review events (uses the Admin › QMAPS link, no database change) | `claude/qmaps-listings-reviews-sync` |
| 2026-10-16 | [#175](https://github.com/takatakca/takatak-v1/pull/175) | feat: expose the existing R2NETTE signed event receiver | `codex/expose-r2nette-sync-20261013` |
| 2026-10-16 | [#177](https://github.com/takatakca/takatak-v1/pull/177) | feat(ads): create campaign drafts in the TAKATAK dashboard | `feat/ads-dashboard-draft-creator-20261014` |
| 2026-10-16 | [#155](https://github.com/takatakca/takatak-v1/pull/155) | Admin › AI provider keys: an encrypted key per AI provider, with a real key test | `claude/ai-provider-keys` |
| 2026-10-16 | [#185](https://github.com/takatakca/takatak-v1/pull/185) | feat(cubafood): define safe TAKATAK master integration contract (#161) | `feat/cubafood-master-contract-20261015` |
| 2026-10-16 | [#183](https://github.com/takatakca/takatak-v1/pull/183) | feat: integrate TAKATAK Academy into V1 dashboard and central sign-in | `feat/academy-dashboard-bridge-20261015` |
| 2026-10-16 | [#182](https://github.com/takatakca/takatak-v1/pull/182) | feat: account-gated SEO free tools and SEOTAKATAK dashboard integration | `feat/seotakatak-free-tools-20261015` |
| 2026-10-16 | [#137](https://github.com/takatakca/takatak-v1/pull/137) | AI Studio: live draft generation with OpenAI or Claude (on top of the Growth Suite, no database change) | `claude/ai-studio-generation` |
| 2026-10-16 | [#188](https://github.com/takatakca/takatak-v1/pull/188) | fix(health): fail closed on unconfigured runtime readiness | `fix/strict-runtime-readiness-20261015` |
| 2026-10-15 | [#181](https://github.com/takatakca/takatak-v1/pull/181) | deploy: Coolify direct-production runtime for takatak.ca |  |
| 2026-10-13 | [#159](https://github.com/takatakca/takatak-v1/pull/159) | Staging: approve 17 pending migrations and add release control |  |
| 2026-10-12 | [#174](https://github.com/takatakca/takatak-v1/pull/174) | fix(auth): country-aware phone OTP and verified recovery email protection |  |
| 2026-10-11 | [#164](https://github.com/takatakca/takatak-v1/pull/164) | feat: validate promotion codes on the server |  |
| 2026-10-11 | [#172](https://github.com/takatakca/takatak-v1/pull/172) | fix: escape apostrophes that failed the QMAPS screen lint |  |
| 2026-10-11 | [#171](https://github.com/takatakca/takatak-v1/pull/171) | feat: link a QMAPS business to a client workspace and reply when QMAPS accepts |  |
| 2026-10-11 | [#170](https://github.com/takatakca/takatak-v1/pull/170) | feat: scan lead attachments before download |  |
| 2026-10-10 | [#162](https://github.com/takatakca/takatak-v1/pull/162) | feat: add REVERS product experience bridge | `feat/revers-experience-bridge` |
| 2026-10-10 | [#169](https://github.com/takatakca/takatak-v1/pull/169) | feat: export a client report and deliver it in the dashboard |  |
| 2026-10-10 | [#168](https://github.com/takatakca/takatak-v1/pull/168) | feat: keep SEO score history and a white-label PDF |  |
| 2026-10-10 | [#167](https://github.com/takatakca/takatak-v1/pull/167) | feat: send saved AI Studio drafts to social approval |  |
| 2026-10-10 | [#165](https://github.com/takatakca/takatak-v1/pull/165) | feat: read public prices from the product catalog |  |
| 2026-10-09 | [#143](https://github.com/takatakca/takatak-v1/pull/143) | docs(mimt): single MIMT runbook, with the product boundary page from #140 |  |
| 2026-10-09 | [#75](https://github.com/takatakca/takatak-v1/pull/75) | Document Cloud Agent local development setup |  |
| 2026-10-09 | [#95](https://github.com/takatakca/takatak-v1/pull/95) | Add the ALKAO — Billetterie menu (add-only, off by default, no database change) |  |
| 2026-10-09 | [#101](https://github.com/takatakca/takatak-v1/pull/101) | Add the TAKATAK → ALKAO sync (new files only, read-only, off by default) |  |
| 2026-10-09 | [#148](https://github.com/takatakca/takatak-v1/pull/148) | fix: phone-only TAKATAK identity | `fix/phone-first-master-auth` |
| 2026-10-09 | [#154](https://github.com/takatakca/takatak-v1/pull/154) | WORKLOG: MIMT on hold by the owner |  |
| 2026-10-09 | [#153](https://github.com/takatakca/takatak-v1/pull/153) | WORKLOG: VoIP shell merged; post-its for the MIMT repo and the MochaHost cleanup |  |
| 2026-10-09 | [#152](https://github.com/takatakca/takatak-v1/pull/152) | Dashboard: Business phone (VoIP) shell at /dashboard/voip |  |
| 2026-10-09 | [#151](https://github.com/takatakca/takatak-v1/pull/151) | Website: premium redesign, 9 core categories with a sales page each |  |
| 2026-10-09 | [#150](https://github.com/takatakca/takatak-v1/pull/150) | Website: shorter homepage (11 → 5 sections), ecosystem grid, /ecosystem "Our brands" page | `claude/homepage-redesign` |
| 2026-10-09 | [#144](https://github.com/takatakca/takatak-v1/pull/144) | Work log: "Needs a human" post-its and "Next up" priority queue | `claude/needs-human-board` |
| 2026-10-09 | [#147](https://github.com/takatakca/takatak-v1/pull/147) | fix: gate staging migration apply behind explicit approval | `fix/staging-migration-audit` |
| 2026-10-09 | [#146](https://github.com/takatakca/takatak-v1/pull/146) | Billing: a won takatak.ca order lead becomes a Facturations draft request (TK-027) | `claude/lead-order-billing` |
| 2026-10-09 | [#129](https://github.com/takatakca/takatak-v1/pull/129) | Client billing dashboard: summary, filters, remind / void / mark paid, sidebar entry | `claude/client-billing-dashboard` |
| 2026-10-08 | [#142](https://github.com/takatakca/takatak-v1/pull/142) | Website in the GROUPE TAKATAK brand blue (was green) |  |
| 2026-10-08 | [#132](https://github.com/takatakca/takatak-v1/pull/132) | Website: HTTPS redirect, canonical URLs, share image, structured data, shorter titles |  |
| 2026-10-08 | [#139](https://github.com/takatakca/takatak-v1/pull/139) | Fix: lead page works before the attachments migration is applied |  |
| 2026-10-08 | [#130](https://github.com/takatakca/takatak-v1/pull/130) | Work log rule for every agent + shared WORKLOG.md + stop reminder |  |
| 2026-10-08 | [#131](https://github.com/takatakca/takatak-v1/pull/131) | Fix: website colour classes render colourless on takatak.ca |  |
| 2026-10-08 | [#134](https://github.com/takatakca/takatak-v1/pull/134) | Website requests reach the dashboard: forms + checkout → Leads, alerts, file uploads, lead page |  |
| 2026-10-08 | [#133](https://github.com/takatakca/takatak-v1/pull/133) | Cleanup: remove 9 stray backup files, form-safe promo invite, unused import |  |
| 2026-10-07 | [#127](https://github.com/takatakca/takatak-v1/pull/127) | Keep relative symlinks when packing the production artifact |  |
| 2026-10-07 | [#125](https://github.com/takatakca/takatak-v1/pull/125) | fix(staging): approve reconciled billing migrations |  |
| 2026-10-07 | [#124](https://github.com/takatakca/takatak-v1/pull/124) | GROUPE TAKATAK billing release: gateway, Payer, client invoicing, ecosystem feed (one merge) | `claude/billing-release-1` |
| 2026-10-07 | [#108](https://github.com/takatakca/takatak-v1/pull/108) | Client dashboard: real invoice center (Stripe invoices from GROUPE TAKATAK) | `claude/client-invoice-center` |
| 2026-10-07 | [#123](https://github.com/takatakca/takatak-v1/pull/123) | Automatically validate each green TAKATAK main artifact |  |
| 2026-10-07 | [#122](https://github.com/takatakca/takatak-v1/pull/122) | Scope staging migration reconciliation to approved AHMV migrations |  |
| 2026-10-07 | [#120](https://github.com/takatakca/takatak-v1/pull/120) | Restore guarded TAKATAK production artifact promotion on current main |  |
| 2026-10-07 | [#119](https://github.com/takatakca/takatak-v1/pull/119) | AHMV: prioritize member contributions on current main |  |
| 2026-10-06 | [#116](https://github.com/takatakca/takatak-v1/pull/116) | Hotfix: unblock CI (package-lock) and show the real SMS sign-in error |  |
| 2026-10-05 | [#103](https://github.com/takatakca/takatak-v1/pull/103) | AHMV: align readiness and provision planned Team Feed |  |
| 2026-10-05 | [#102](https://github.com/takatakca/takatak-v1/pull/102) | AHMV: preserve official weekly schedule validity |  |
| 2026-10-05 | [#100](https://github.com/takatakca/takatak-v1/pull/100) | Ops: reconcile verified Supabase staging history into Prisma |  |
| 2026-10-05 | [#99](https://github.com/takatakca/takatak-v1/pull/99) | ADS: align AHMV placement routes on current main |  |
| 2026-10-05 | [#98](https://github.com/takatakca/takatak-v1/pull/98) | AHMV: add live operational readiness diagnostics |  |
| 2026-10-05 | [#96](https://github.com/takatakca/takatak-v1/pull/96) | AHMV: fix team feed with exact multi-team content tags |  |
| 2026-10-05 | [#94](https://github.com/takatakca/takatak-v1/pull/94) | AHMV: add exact public team directory seed |  |
| 2026-10-05 | [#93](https://github.com/takatakca/takatak-v1/pull/93) | ADS: fix canonical AHMV publisher domain |  |
| 2026-10-05 | [#92](https://github.com/takatakca/takatak-v1/pull/92) | Ops: gate TAKATAK staging release on current Prisma schema |  |
| 2026-10-05 | [#91](https://github.com/takatakca/takatak-v1/pull/91) | Ops: add isolated MochaHost staging release train |  |
| 2026-10-05 | [#90](https://github.com/takatakca/takatak-v1/pull/90) | Fix production migration history normalization |  |
| 2026-10-05 | [#89](https://github.com/takatakca/takatak-v1/pull/89) | Ops: guard and deploy approved AHMV production migration train |  |
| 2026-10-05 | [#88](https://github.com/takatakca/takatak-v1/pull/88) | AHMV: rebuild exact-team social feed bridge on current main |  |
| 2026-10-05 | [#87](https://github.com/takatakca/takatak-v1/pull/87) | AHMV: rebuild parent/family backend on current main |  |
| 2026-10-05 | [#86](https://github.com/takatakca/takatak-v1/pull/86) | TAKATAK ADS: rebuild proprietary local ad network on current main |  |
| 2026-10-05 | [#85](https://github.com/takatakca/takatak-v1/pull/85) | AHMV: rebuild detachable product catalog and entitlement gate |  |
| 2026-10-04 | [#84](https://github.com/takatakca/takatak-v1/pull/84) | Backend: add TAKATAK side AHMV managed-association control contract |  |
| 2026-10-04 | [#82](https://github.com/takatakca/takatak-v1/pull/82) | Add production smoke for AHMV content bridge |  |
| 2026-10-03 | [#31](https://github.com/takatakca/takatak-v1/pull/31) | Add identity-scoped AHMV hockey membership billing |  |
| 2026-09-18 | [#1](https://github.com/takatakca/takatak-v1/pull/1) | Complete Stripe Social billing and subscription lifecycle | `fix/stripe-billing-completion` |

### takatakbackend

- **311 commits** du 2025-06-21 au 2026-10-29 411a861 · 0 PR fusionnées · fichiers de reprise : `WORKLOG.md`, `docs/AGENT_HANDOFF.md`, `docs/TASK_QUEUE.md`, `docs/PROJECT_STATUS.md`, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md`, `AGENTS.md`, `CLAUDE.md`
- Signatures (Co-Authored-By) : Claude Opus 5.5 ×2 · Auteurs git : takatakca ×243, Elitecrafttech ×42, TAKATAK MARKETING ×11, elitecrafttech ×11, Claude ×2, ABDUL ×2

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-29 | 11 | docs(handoff): sync October 29 GitHub and Google Drive continuity and phone audit CI · docs(worklog): close canonical phone audit after passing CI · docs(audit): reconcile canonical phone collision safety and 2026-10-29  |
| 2026-10-16 | 46 | docs(handoff): preserve duplicate-phone OTP safety and real DB audit requirements · docs(worklog): close legacy phone identity hardening with verified CI and live audit gate · docs(readme): document privacy-preserving le |
| 2026-10-15 | 60 | docs(handoff): preserve billing accuracy, lease protection and exact release blockers · docs(worklog): close concurrent Upmind provisioning guard with live validation pending · docs(upmind): record MongoDB lease guard an |
| 2026-10-14 | 131 | docs(handoff): record Upmind linkage hardening, CI and production continuation · docs(worklog): finish legacy Upmind identity linkage and credential hardening · docs(legacy): record safe Upmind account association and te |
| 2026-10-08 | 2 | docs: GROUPE TAKATAK brand reference (BRAND.md) and brand rule in AGENTS.md · docs: work log rule for every agent (AGENTS.md, WORKLOG.md, stop reminder) |
| 2026-04-13 | 6 | check if there is user in render · check if there is user in render · check if there is user in render |
| 2025-10-24 | 3 | otp mail sendgrid · otp mail sendgrid · sendgrid email otp |
| 2025-10-23 | 1 | mimt |
| 2025-10-16 | 3 | alloworigin · ensureupmind to check if the client exist · remove verifyapikey for frontend |
| 2025-10-14 | 1 | bkend 2 bkend api key |
| 2025-10-10 | 2 | oAuth refresh tken issue · oAuth refresh tken issue |
| 2025-09-30 | 3 | OAuth2 · OAuth2 · OAuth2 |
| 2025-09-23 | 1 | dashb |
| 2025-09-18 | 8 | temporary using email while testing · temporary using email while testing · upmind password issue from takatak |
| 2025-09-17 | 2 | user & auth adjustment in handler · user & auth adjustment in handler |
| 2025-09-16 | 2 | user & auth adjustment in handler · createupmindsection |
| 2025-09-14 | 1 | createupmindsection |
| 2025-09-13 | 2 | new set up · new set up |
| 2025-09-11 | 1 | complete upmind task for creating users |
| 2025-09-09 | 1 | reg and verify otp bug fix |
| 2025-09-07 | 1 | rehandle all auth |
| 2025-09-06 | 1 | debuging |
| 2025-09-04 | 1 | upm |
| 2025-09-05 | 1 | ++ |
| 2025-09-03 | 1 | process |
| 2025-07-09 | 3 | dash · dash · dashboard |
| 2025-07-08 | 1 | regtokenexpire |
| 2025-07-06 | 2 | email bug · email bug |
| 2025-07-03 | 6 | + issue solved · + issue · + issue |
| 2025-06-21 | 4 | update in auth · MONGO URI · package start |

### takatakreview

_Dépôt vide (aucun commit sur la branche principale)._

### tr4cker

- **2 commits** du 2026-10-28 au 2026-10-28 f92ca06 · 0 PR fusionnées · fichiers de reprise : `DEPLOY.md`
- Signatures (Co-Authored-By) : — · Auteurs git : TAKATAK MARKETING ×2

| Jour | Commits | Exemples |
| --- | --- | --- |
| 2026-10-28 | 2 | 2026-10-28 — Agent code Clover — build-out initial TR4CKER (README, fiche/docs, scaffold webhook/OAuth, DEPLOY) · Initial commit |

