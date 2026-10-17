# FOODHUB — relève de l'agent (à lire dès l'ouverture)

## Reprise prioritaire — 2026-10-16, navigation clavier des onglets

- **Dépôt et branche** : `takatakca/foodhubca`, `fix/console-tabs-keyboard-20261016` depuis `main` `12ba64d9f6941698118533d40d3f381ff709065c`; `main` appartient au propriétaire (`CLAUDE.md`).
- **Dernière tâche codée** : helper `lib/ui/tab-keyboard.ts`, adaptation de `components/ui/tabs.tsx` pour ArrowLeft/ArrowRight (bouclage), Home/End, focus et `tabIndex` roving ; cinq tests de navigation dans `tests/tab-keyboard.test.ts`. Dernier commit de code : `ce44c583c666efc64581bd394b6e1a373186da2e`; le SHA de HEAD après docs se lit directement sur GitHub.
- **Tâche en cours** : contrôler la [PR #63](https://github.com/takatakca/foodhubca/pull/63), audit/typecheck/lint/tests/build/E2E simulés et image Docker ; ajuster si échec, faire revue clavier dans navigateur. La PR #62 (modales/tiroirs) est indépendante, pas fusionnée ici.
- **Fichiers modifiés** : `lib/ui/tab-keyboard.ts`, `components/ui/tabs.tsx`, `tests/tab-keyboard.test.ts`, `WORKLOG.md`, `docs/AGENT_HANDOFF.md`, `docs/PROJECT_STATUS.md`, `docs/TASK_QUEUE.md`, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`.
- **Vérifications réalisées** : lecture du dépôt, des règles `AGENTS.md`/`CLAUDE.md`, WORKLOG, PR, CI, plan UX et code Tabs ; commits poussés via GitHub. Aucun test navigateur ni commande réelle, aucun test local : résultats CI à consulter.
- **Blocages connus** : `private/TASKS.md` local non accessible via GitHub ; validations commerçantes réelles Clover/Uber/DoorDash/Skip et preuves publiques du déploiement au nouveau SHA requièrent opérateur. Les PR simultanées peuvent nécessiter un rapprochement documentaire avant fusion.
- **Déploiement** : aucun depuis cette branche ; Contabo/Coolify auto par GitHub App natif, pas Actions ancien contrôleur. Dernière preuve publique de SHA enregistrée pour `027b602a12da39b1244e17b813bc51a7496a0217` dans PR #49 ; la version actuelle de `main` n'a pas été prouvée par ce relevé.
- **Accès nécessaires** : droits GitHub pour PR et CI ; validation navigateur/tablette ; opérateur Coolify et comptes externes seulement pour autres tâches, jamais partager de secrets.
- **Prochaine action exacte** : vérifier les deux workflows de la PR #63 sur son dernier HEAD et corriger l'échec éventuel, puis propriétaire revoit/fusionne. Après publication, utiliser `npm run verify:live -- --url https://foodhub.on2go.ca/ --sha SHA40` depuis un réseau approprié pour confirmer la version en production.
## Relève prioritaire — 2026-10-16 (la suite ancienne est historique)

- **Dépôt/source** : `takatakca/foodhubca`, `main` `12ba64d9f6941698118533d40d3f381ff709065c`, propriétaire seul autorisé à fusionner `main` (`CLAUDE.md`).
- **Dernière tâche développée** : accessibilité clavier des modales/tiroirs de la console. Branche `fix/overlay-keyboard-focus-20261016`. Dernier commit de code observé `bcbf9e8f0008200c2e77f93ad6270383b5751b53` (protège aussi la fenêtre supérieure si une fenêtre inférieure se démonte hors ordre), consulter HEAD GitHub pour le SHA final après cette documentation.
- **En cours** : revue/CI/image de la [PR #62](https://github.com/takatakca/foodhubca/pull/62) ouverte, puis essai clavier sur vrai navigateur et tablette. Aucun conflit visé avec les PR en cours.
- **Fichiers modifiés** : `components/ui/overlay.tsx`, `lib/ui/overlay-focus.ts`, `tests/overlay-focus.test.ts`, `WORKLOG.md`, et les cinq documents `docs/{PROJECT_STATUS,TASK_QUEUE,AGENT_HANDOFF,DEPLOYMENT,DECISIONS}.md` ; `docs/PROGRESS.md` si présent.
- **Effet technique** : les dialogues ont un panneau focalisable, un titre/sous-titre ARIA, une première cible clavier ; le navigateur ne traverse plus l'arrière-plan avec Tab ; Échap affecte uniquement le dialogue du haut ; le focus initial est restauré et le body retrouve son overflow précédent après le dernier dialogue.
- **Vérifications** : lecture via GitHub de `AGENTS.md`, `CLAUDE.md`, `WORKLOG.md`, documents de relève, PR/issues et CI, inspection du code `overlay.tsx` et plan Phase 3, commits/branches via API GitHub. Tests `tests/overlay-focus.test.ts` créés ; attendre résultats typecheck/lint/unit/build et image dans Actions. Aucun essai navigateur réel, aucune opération de commandes.
- **Blocages** : tableau privé local `private/TASKS.md` non accessible depuis l'intégration GitHub ; certification Clover et plateformes, dont vrais paiements, reste propriétaire/opérateurs, issue #46.
- **Déploiement** : Coolify natif GitHub App sur Contabo, non contrôlé par Actions. Ancienne preuve opérateur du SHA `027b602a12da39b1244e17b813bc51a7496a0217` (PR #49). La présence en production du nouveau `main` n'est pas prouvée par cette session. **La branche de ce correctif n'est pas déployée**.
- **Accès requis** : GitHub branche/PR accessibles ; pour confirmer production, réseau externe et accès autorisé Coolify ; pour les commandes certifiées, comptes des plateformes et approbation propriétaire, sans publier de secrets.
- **Prochaine action exacte** : contrôler CI + image de la PR #62 sur son HEAD, corriger toute erreur puis soumettre au propriétaire ; tester ensuite Tab / Shift+Tab / Échap / focus rendu aux boutons dans un navigateur. Après fusion et livraison Coolify, comparer `/api/release` au SHA `main` exact via `npm run verify:live -- --url https://foodhub.on2go.ca/ --sha SHA40` et vérifier santé.

## Reprise du 2026-10-16 — PRIORITÉ (agent GitHub, PR #52)

**Dernière tâche réalisée** : correctifs d'interface cuisine sur la branche `fix/console-kitchen-a11y` ([PR #52](https://github.com/takatakca/foodhubca/pull/52), toujours brouillon au moment de cette écriture) ; rapprochement non destructif avec le nouveau `main` intégrant la PR #53 Clover. Dernier SHA de code/rapprochement poussé avant cette mise à jour de relève : `87e22d8da9feb137dc5e3623744166ae0d813db3`. Pour le SHA final incluant cette documentation, lire la tête actuelle de la branche dans GitHub.

**Tâche en cours** : vérifier la CI et la construction image Docker de la PR #52 après le rapprochement ; corriger les erreurs éventuelles ; effectuer une validation visuelle sur tablette puis laisser le propriétaire fusionner. `main` contrôlé = `444e8f2e60dd73e5eaa90bc4e9f92d05489b38f3` ([CI main](https://github.com/takatakca/foodhubca/actions/runs/38845406916) et [image](https://github.com/takatakca/foodhubca/actions/runs/38845406823) réussies).

**Code modifié** : `components/shell/console-shell.tsx`, `components/ui/route-theme.tsx`, `lib/ui/kitchen-theme.ts`, `lib/ui/display.tsx`, `app/layout.tsx`, `app/globals.css`, `app/(console)/loading.tsx`, `app/(console)/error.tsx`, `tests/kitchen-theme.test.ts`, `tests/display-kitchen-boot.test.ts` et `WORKLOG.md`. Thème sombre avant premier affichage puis maintenu durant les transitions de pages (dont /kitchen/lock), dialogues portalisés, réduction de mouvements OS, NIP shake, commandes tactiles min. 48 px, écran chargement/erreur bilingue. Aucun serveur, commande réelle, API, secret, base ou intégration marchand modifié.

**Vérifications** : GitHub REST : `main`, PR #51/#52, PR #53 fusionnée, comparaison des arbres, PR #52 sans conflit après commit de rapprochement. [CI PR #52](https://github.com/takatakca/foodhubca/actions/runs/38852377905) et [image PR #52](https://github.com/takatakca/foodhubca/actions/runs/38852377889) démarrées après rapprochement ; **ne pas déclarer PASS tant que le dernier SHA n'est pas vert**. Tests locaux non exécutés : environnement de travail utilise l'API GitHub, sans clone local. Les 2 tests unitaires nouveaux couvrent le routage et le thème avant le premier rendu.

**Production** : La [PR #49 fusionnée](https://github.com/takatakca/foodhubca/pull/49) documente une publication Coolify réussie du 2026-10-15 au SHA `027b602a12da39b1244e17b813bc51a7496a0217`. Un SHA `main` plus récent est maintenant présent ; les GET externes `/api/release`, `/api/health`, `/api/public/directory` n'ont pu être confirmés par l'outil externe de ce relevé. **Pas de nouvelle preuve de déploiement sur le dernier `main`**, ni de certification de commandes réelles. Les workflows GitHub Actions Coolify historiques sont `skipped` car le contrôleur natif Coolify est le chemin retenu.

**Blocages / accès** : révision/merge réservés au propriétaire (`CLAUDE.md`) ; opérateur Coolify/Contabo et réseau HTTPS fonctionnel pour constater le SHA ; responsables Clover et plateformes pour les tests sandbox puis réels et l'impression cuisine. Ne pas divulguer de clés ni toucher à Po Poulet NDG DoorDash store 27982486.

**Prochaine action exacte** : consulter la CI et l'image de la **tête courante de la PR #52** (les commits de documentation peuvent relancer les jobs). En cas d'échec, lire les logs de l'étape et corriger sur `fix/console-kitchen-a11y` ; sinon marquer la PR prête à réviser, laisser le propriétaire fusionner. Puis constater le SHA de production via `npm run verify:live -- --url https://foodhub.on2go.ca/ --sha FULL_SHA` et documenter dans l'issue #46. Ensuite passer aux intégrations commerciales non certifiées.


## Reprise actuelle — 2026-10-15 (prioritaire sur le relevé historique ci-dessous)

Demande explicite du propriétaire : terminer GitHub → production Coolify et les contrôles de santé de Food Hub. PR #49 fusionnée en `e7ce788a9432618ee93eb9ce3d6a6be7c64b3ca6`, aucune autre PR fusionnée. Source native Coolify liée au GitHub App existant ; auto-push activé ; arguments Docker gérés par le fichier et `SOURCE_COMMIT` disponible au build. Santé activée en **Container command** : `node /app/scripts/check-runtime.mjs`, intervalle 30 s, timeout 90 s, 3 essais, démarrage 60 s. La version Coolify 4.4.6 installée substitue le check de l'interface à celui de l'image : ne pas utiliser HTTP, car l'image n'embarque pas curl/wget.

Sauvegardes média/configuration privée et image de rollback conservées sur Contabo ; détails non secrets dans `DEPLOYMENT.md`. Même volume et même Supabase/session ; pas de SQL, pas de nouvel accès ni activation de fournisseur. Contrôleur Actions historique désactivé : les contrôles de publication sont obligatoires dans le Dockerfile sur Contabo.

Validation locale : audit production 0 vulnérabilité, typecheck, lint sans erreur (1 avertissement existant), 807 tests réussis / 2 ignorés, build réussi et E2E **536 réussis / 0 échec**. Les tests `.mjs` du vérificateur sont désormais réellement inclus dans Vitest. La preuve Docker/production reste à obtenir après fusion : attendre **Webhook / Success**, puis vérifier le SHA exact de `main` avec `verify:live`, la santé et le volume conservé. Ne jamais annoncer la publication sur la seule base de ce relevé.

Le build Webhook `nyf14yjdr5heghjgcoznlvfg` a passé tous les contrôles sur Contabo, dont E2E 536/0 et probe final, puis rencontré le contrôle HTTP générique sans curl/wget. Le réglage CMD explicite ci-dessus corrige la configuration pour la prochaine livraison native. Vérifier le résultat final dans l'historique Coolify et la description de PR #49, puis comparer le SHA de `main` avec `verify:live`. Les lignes du 2026-10-14 ci-dessous sont historiques et ne décrivent plus la configuration active.

Date du relevé : **2026-10-14**. Aucun accès aux fichiers locaux git-ignorés `private/TASKS.md` / `private/CLAIMS.md` depuis la connexion GitHub : les ouvrir dans le vrai checkout si disponibles.

## Dernière tâche terminée

- Correctif annuaire public + exemption exacte des routes : PR [#48](https://github.com/takatakca/foodhubca/pull/48), branche `fix/public-directory-availability-20261014`, CI + build image réussis au SHA `91bff1c601b950c111b6956ade81c93313c8d99b` ; **non fusionnée**.
- Développement suivant : vérificateur de publication en lecture seule ajouté au SHA `7b97a3aa511f6bfb57b9fce61e9523d983064378` sur `agent/foodhub-deployment-verifier`. Ses tests doivent être confirmés par la CI de la PR.

## Tâche actuellement en cours

PR #49 ouverte sur `agent/foodhub-deployment-verifier`. Vérifier les builds CI/E2E encore en cours puis obtenir une preuve de déploiement public du SHA choisi. La mise en ligne reste bloquée par DNS / accès Coolify / opt-in du workflow ; **ne pas prétendre que le push a déployé le site**.

## Fichiers modifiés dans cette reprise

`scripts/verify-live.mjs`, `tests/verify-live.test.mjs`, `package.json` ; `docs/PROJECT_STATUS.md`, `docs/TASK_QUEUE.md`, `docs/AGENT_HANDOFF.md`, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md` ; liens dans `docs/README.md`, règles de relève dans `AGENTS.md` et suivi dans `WORKLOG.md` / `docs/PROGRESS.md`.

## Git

- `main` observé : `bb353ccfa82a7ba5e3d7af488e0da6bf03746c09`.
- Dernier commit de code poussé pour ce lot : `7b97a3aa511f6bfb57b9fce61e9523d983064378`.
- Branche du lot : `agent/foodhub-deployment-verifier` ; dernier commit de documentation précédant cette mise à jour : `71992f3f95a37ba6ac63f3c2187020c01d58e91d`. Le dernier commit poussé est toujours `refs/heads/agent/foodhub-deployment-verifier` (consulter GitHub : un fichier versionné ne peut pas contenir son propre SHA de façon fiable). PR [#49](https://github.com/takatakca/foodhubca/pull/49).
- La fusion et la publication sont réservées au propriétaire conformément à `CLAUDE.md`. Ne jamais forcer `main`.

## Commandes / vérifications

- API GitHub : dépôt, tête `main`, branches, PR #48 et #43/#45/#44/#39, issue #46, derniers workflow runs.
- [CI #48](https://github.com/takatakca/foodhubca/actions/runs/38608758328) : `success` ; [Image #48](https://github.com/takatakca/foodhubca/actions/runs/38608758793) : `success`.
- CI de PR #49 : [exécution 38613543386](https://github.com/takatakca/foodhubca/actions/runs/38613543386) — audit dépendances, typecheck, lint et tests unitaires réussis à la dernière consultation ; build et E2E encore en cours. [Image 38613543650](https://github.com/takatakca/foodhubca/actions/runs/38613543650) en construction. Aucun test local exécuté : vérifier l'état final des runs avant de les déclarer tous verts.
- Vérification réelle, quand DNS/Coolify prêts : `npm run verify:live -- --url https://foodhub.on2go.ca/ --sha FULL_40_CHAR_SHA`.

## Problèmes et statut du déploiement

- Déploiement de `main` non prouvé. Dernières actions « Deploy Food Hub to Coolify » : `skipped` ; opt-in `FOODHUB_COOLIFY_AUTODEPLOY_ENABLED` non activé dans les preuves.
- `foodhub.on2go.ca` était inaccessible / 502 selon le dernier WORKLOG ; la tentative publique du présent relevé n'a pas démontré de réponse valide pour `/api/release` ou `/api/health`. Vérifier directement depuis un réseau externe.
- Aucune certification de commandes réelles Clover/plateformes, aucun cutover, aucun test financier réel réalisés ici.
- Ne pas activer les connecteurs live sans preuves et approbation de l'exploitant.

## Accès nécessaires (sans secret)

Droits GitHub pour PR, propriétaire DNS, Coolify (ressource FOOD HUB et logs), accès sécurisé aux variables GitHub Actions, accès administrateur Clover/Uber/DoorDash/Skip et aux environnements d'essai, Supabase Montréal pour lecture sanitaire/restauration. **Ne jamais coller les valeurs d'identifiants dans Git, un ticket ou un chat.**

## Travail indépendant ouvert pendant cette relève

- [PR #50](https://github.com/takatakca/foodhubca/pull/50) : validation renforcée des en-têtes `X-Integration-Id` et `Idempotency-Key` du contrat C5 (tests de falsification) ; branche `fix/on2go-contract-header-validation`, dernier commit d'état documenté `075935cca8e43cb78f6af425f21463a16fb04ada`. La PR est distincte des PR #48 et #49 et n'active aucune intégration. Contrôler sa CI avant fusion.

## Prochaine action exacte

1. Vérifier les exécutions CI + image de la [PR #49](https://github.com/takatakca/foodhubca/pull/49) et corriger tout échec sur cette branche, sans reprendre les tâches déjà attribuées aux PR #43/#45/#48.
2. Après approbation/fusion propriétaire, réparer DNS/HTTPS et activer le pipeline Coolify selon `docs/DEPLOYMENT.md`, sans double consommateur webhooks.
3. Exécuter `verify:live` avec le SHA de `main` effectivement déployé et coller uniquement le résultat PASS/FAIL, URL et SHA dans l'issue #46 ; entreprendre ensuite la première tâche NEXT de `TASK_QUEUE.md` non attribuée.
