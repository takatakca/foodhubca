## 2026-11-26 — Paiement Clover après déplacement d’une liaison

La paire caisse et commande confirmée reste stable dans les événements et la lecture Suite. La note de facture Clover, quand elle est activée, utilise aussi la caisse confirmée si la liaison a changé. Le repli historique garde la liaison courante pour une commande sans caisse enregistrée. Deux tests reproduisent les destinations erronées avec des fournisseurs simulés. Sur `b59c904`, 133 tests ciblés, TypeScript et ESLint passent.

La cuisine enregistrée sur la commande peut marquer la remise au livreur et la commande terminée. Si la liaison actuelle désigne une autre cuisine, Food Hub affiche un paiement Clover en attente. Le contrôle intervient avant la recherche du type de paiement et l’envoi à Clover. Pour une commande déjà terminée, vérifier le paiement sur la commande de la caisse Clover d’origine et l’enregistrer dans Clover si nécessaire. Le contrôle compare les deux cuisines lorsqu’elles sont connues. La preuve marchande reste suivie dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46).

À la création ou au rattachement d’une commande Clover retrouvée, Food Hub enregistre la caisse confirmée avec l’identifiant de commande. Le règlement utilise cette caisse si la liaison change de caisse dans la même cuisine. Les anciennes commandes sans caisse enregistrée suivent la liaison actuelle ou la caisse par défaut configurée. Elles nécessitent une vérification sur la caisse d’origine après un remplacement. Les essais simulés couvrent le changement de caisse, la caisse OAuth approuvée, le rattachement et le contrôle de cuisine.

L’impression à l’arrivée, le déclenchement planifié et la réimpression utilisent aussi la caisse confirmée. Une caisse devenue inaccessible produit une erreur d’impression sur la commande. Les essais sur `cdde075` couvrent ces trois parcours avec des réponses Clover simulées, ainsi que la réimpression d’une commande historique. Les 193 tests ciblés, TypeScript et ESLint réussissent.

L’annulation et la relève vers la tablette Skip ferment la commande sur la caisse qui l’a confirmée. Si cette caisse diffère de la caisse configurée, Food Hub y vérifie l’identifiant et le titre avant de demander une modification. Lors d’un envoi concurrent, la copie excédentaire est retirée de la caisse qui l’a créée. Une même référence sur deux caisses distingue toujours deux copies lorsque les deux caisses sont confirmées. Les 117 tests ciblés utilisent des réponses Clover simulées.

Si l’annulation arrive pendant le premier envoi, Food Hub ferme la commande sur la caisse confirmée avant impression. L’arrêt s’applique aussi lorsque l’acceptation automatique est désactivée. Quand Clover renvoie un échec après l’annulation, la relève vers la tablette Skip est abandonnée. Les trois scénarios reproduisaient l’erreur avant correction. Sur `df03fc9`, les 136 tests ciblés, TypeScript et ESLint réussissent avec des fournisseurs simulés.

## 2026-11-26 — Alertes d’un écran réaffecté

Si un écran ou une tablette change de cuisine pendant un incident, Watchtower clôture l’incident dans la cuisine d’origine et ouvre l’alerte dans la cuisine qui reçoit l’appareil si le problème persiste. Les appels et l’historique suivent le périmètre de chaque incident. Le changement de cuisine d’une tablette exige une destination active et autorisée. La livraison aux téléphones et aux appareils réels reste suivie dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46).

Sur `cdde075`, les 148 essais ciblés couvrent les cinq scénarios simulés de réaffectation ainsi que les contrôles de plateforme du relais et des annulations Clover. TypeScript et ESLint réussissent.

Sur `a1e0841`, les 185 essais ciblés couvrent la réaffectation avec les contrôles de destination partagée et de simulation téléphonique de #173.

La répétition sur l’arbre de #175 `6d2ff10` a passé 224 essais ciblés. Un scénario simulé vérifie que le premier appel encore en attente dans l’ancienne cuisine est clos lors du déplacement et que la nouvelle cuisine reçoit un seul appel quand Twilio Voice devient disponible.

— signé : Codex @ cloud · 2026-11-26

## 2026-11-26 — Numéro de relève ajouté pendant un incident d’écran

Watchtower garde le premier appel en attente quand aucun numéro de relève ni de cuisine n’est disponible au premier palier. Si un numéro devient disponible pendant que l’incident reste ouvert, Watchtower peut demander l’appel au prochain passage. Une réservation en base limite cette demande à une fois par incident. La situation se vérifie dans Alertes et le journal des messages. Les essais sur les téléphones de relève restent suivis dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46).

Si le numéro est déjà configuré et que la configuration de Twilio Voice est incomplète, Watchtower consigne le report dans l’incident sans consommer la réservation du premier appel. Le premier passage suivant la configuration peut demander l’appel si l’incident est encore ouvert. Les tests de cron simulés couvrent un écran hors ligne et une commande en attente, ainsi que l’absence de renvoi après la première demande. Le lot local passe 142 tests ciblés, TypeScript et ESLint.

— signé : Codex @ cloud · 2026-11-26

## 2026-11-26 — Relances et impressions Clover après déplacement d’une liaison

Quand la cuisine de la liaison a changé depuis la réception, les relances et impressions Clover sont bloquées et signalées. Une commande planifiée arrivée à son heure de préparation est affichée avec l’erreur d’impression dans sa cuisine d’origine. Avant de relancer, vérifier la liaison et la commande dans la caisse appropriée. Une commande qui attend sa première liaison peut toujours être acheminée une fois la cuisine attribuée. La preuve de livraison en cuisine reste suivie dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46).

La reprise sur `2313f4f` a vérifié la première liaison d’une commande retenue, puis le déplacement de cette liaison après une réponse Clover incertaine. La relance conserve la première cuisine et attend la vérification de la liaison avant de contacter Clover.

La répétition sur l’arbre de #173 `ab73a76` a passé 208 essais ciblés. Ils couvrent la relance Clover après une réponse incertaine, la confirmation Skip après réception et les accès aux commandes et à la vitrine.

— signé : Codex @ cloud · 2026-11-26

## 2026-11-26 — Relève des écrans et confirmation Skip

Dans Réglages → Alertes, « Simuler la relève des écrans » vérifie les deux règles et le numéro commun enregistré, affiché masqué. La simulation reproduit la sélection du premier appel. L’indication de configuration Twilio est distincte. La réception sur un téléphone fait partie des essais marchands dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46).

L’acceptation automatique d’une commande Skip directe exige une référence Clover avant le succès JET. Lorsqu’une commande prévue en acceptation automatique ne parvient pas à Clover, Food Hub demande la relève vers la tablette et attend l’accusé Skip avant d’afficher le transfert.

La reprise sur `2313f4f` a passé 195 essais ciblés, dont la simulation des appels, l’accusé Skip et le maintien des commandes sans liaison au tableau.

Sur `4003e5b`, 201 essais ciblés ont couvert ces scénarios et les nouveaux contrôles d’impression Clover de #169.

Sur `cdde075`, 206 essais ciblés ont couvert ces parcours avec la validation des signaux du relais et de la caisse avant annulation Clover.

Sur `da2d047`, les 236 essais ciblés couvrent aussi l’association des sessions Skip et la conservation d’un résultat d’appel non confirmé à côté de la simulation.

— signé : Codex (automatisation) @ cloud · 2026-11-26

## 2026-11-26 — Réponse téléphonique et session d’intégration Skip

Watchtower affiche « Résultat de l’appel non confirmé » si la réponse Twilio ne contient pas de référence d’appel valide ou si la demande se termine avec un résultat réseau incertain. Les anciens messages au statut positif sans référence valide portent aussi cet avis. L’état fournisseur reste consultable pour un appel identifié, et la réception sur le téléphone est suivie dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46).

Une notification Skip conserve sa session fournisseur et sa progression. Les demandes de lancement restent en attente d’une association vérifiée. La configuration explicite demande la session et le code POS confirmés pour le même établissement.

Sur `4003e5b`, 194 essais ciblés ont validé les réponses Twilio et Skip simulées et l’impression Clover. Le lot Linux a ignoré les six essais natifs du relais Windows.

Sur `0edc9c8`, TypeScript et 237 essais ciblés ont validé ensemble les réponses Twilio et Skip simulées, l’attribution Uber et le relais web sous Chromium local. Les six essais natifs PowerShell nécessitent Windows.

— signé : Codex (automatisation) @ cloud · 2026-11-26

## 2026-11-26 — Changement de plateforme du relais et annulation Clover

Un écran déjà vu passe à indisponible quand sa plateforme change. Food Hub écarte l’état et le nombre de commandes d’un domaine marchand ou d’une application Android reconnus comme appartenant à une autre plateforme. Watchtower peut signaler l’écran indisponible, même si le relais continue d’envoyer les signaux de l’ancienne plateforme. Si la réponse d’ouverture se perd, la commande « Page de connexion » crée une nouvelle demande.

L’annulation suit la caisse explicite, puis la caisse configurée, puis l’unique caisse OAuth approuvée. Dans ce dernier cas, Clover doit renvoyer la référence et le titre attendus avant que Food Hub retire ou marque la commande. Le contrôle de réception réelle reste dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46).

La reprise sur `394ecff` a passé 185 essais ciblés, dont la vérification des signaux web et Android, des alertes Watchtower et des réponses Clover simulées.

La reprise sur `2313f4f` conserve les mêmes changements et les tests de préparation du relais de #168. TypeScript et 124 tests ciblés réussissent, dont les signaux de relais sous Chromium sur une plateforme simulée.

La reprise sur `4003e5b` conserve aussi l’impression Clover et le dossier de démarrage du relais Windows de #169. TypeScript, ESLint sur les fichiers TypeScript concernés et 181 tests ciblés réussissent. Les scénarios du relais web ont utilisé Chromium avec un serveur Food Hub simulé. Les six tests PowerShell exigent Windows.

— signé : Codex (automatisation) @ cloud · 2026-11-26

## 2026-11-26 — Attribution des commandes Uber et onglet du relais web

La checklist Uber direct demande un contrôle fournisseur enregistré pour le compte lié, avec Food Hub comme gestionnaire et les webhooks actifs. Une ancienne vérification sans compte identifié doit être refaite dans Restaurants → Liaisons. L’essai de réception en cuisine reste suivi dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46).

Le relais web reconnaît la page marchand et les pages de connexion prises en charge. Un onglet interne de Chrome ou une page sur un autre site déclenche un statut indisponible. Pour l’installation manuelle, utiliser la même adresse marchand pour Chrome et `SCREEN_START_URL`. La vérification sur le poste existant reste ouverte.

La reprise sur `394ecff` a passé 195 essais ciblés, dont la sélection des onglets dans Chromium local et les réponses OAuth simulées.

Après la fusion de #168 sur `2313f4f`, le contrôle conjoint de la checklist, du relais et d’Uber a passé 199 essais ciblés et la vérification TypeScript.

— signé : Codex (automatisation) @ cloud · 2026-11-26

## 2026-11-26 — Impression Clover et démarrage du relais Windows

L’impression de cuisine utilise la caisse résolue par la même règle que la création dans Clover. Le marchand explicite et le défaut configuré ont priorité, puis le compte OAuth unique approuvé. Le kit Windows conserve son dossier d’installation dans la tâche planifiée et dans le raccourci de démarrage. La relève du poste existant et les essais marchands restent suivis dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46).

— signé : Codex @ cloud · 2026-11-26

## 2026-11-26 — Vérifications du relais dans Mise en service

Les avis du relais et des appels utilisent les écrans du périmètre autorisé. Ils montrent l’état des signaux et le type de destination configuré, avec un lien vers les réglages concernés. Les preuves de réception réelle sont suivies dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46).

Le workflow « Verify Food Hub production release » conserve le message et le résumé d’un écart de SHA, tout en gardant un résultat en échec pour une publication encore à confirmer.

— signé : Codex @ cloud · 2026-11-26

## 2026-11-26 — Commandes sans liaison et caisse Clover partagée

Lorsque plusieurs cuisines ont des liaisons et qu’une seule caisse Clover est configurée, une commande sans liaison ni cuisine enregistrée reste au tableau sans être envoyée à la caisse. Ce contrôle s’applique à l’arrivée et aux relances. Confirmer la cuisine dans Restaurants → Liaisons, puis utiliser « Envoyer à Clover » sur la commande. Une relance vérifie aussi l’existence d’une commande Clover après une réponse incertaine. Les essais marchands en cuisine restent suivis dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46).

— signé : Codex @ cloud · 2026-11-26

## 2026-11-26 — Refus de portée Uber pendant la synchronisation

Quand le jeton OAuth Uber renvoie HTTP 400 `invalid_scope` après le parcours habituel de demande, la synchronisation signale ce refus pour Uber et laisse les autres vérifications de statut Uber en attente jusqu’au prochain passage. Le dernier état des magasins reste disponible. Les autres plateformes continuent leur vérification. La portée accordée à l’application en production et les essais marchands restent suivis dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46#issuecomment-7194255617).

— signé : Codex @ cloud · 2026-11-26

## 2026-11-26 — Vérifier un passage Watchtower en arrière-plan

Dans la réponse détaillée de `GET /api/health`, `checks.watchtower.lastBackgroundCompletion` donne l’heure et le déclencheur du dernier passage achevé par minuterie ou cron. Ce contrôle complète l’horodatage de démarrage. La réception réelle des commandes et des appels reste suivie dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46).

— signé : Codex @ cloud · 2026-11-26

## 2026-11-26 — Vérification de la caisse Clover par défaut

Mise en service affiche les liaisons autorisées qui utilisent la caisse Clover par défaut. L’avis renvoie vers Restaurants → Liaisons pour vérifier la caisse de chaque cuisine. Le contrôle des identifiants Clover et les essais de réception et d’impression restent suivis séparément dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46).

— signé : Codex @ cloud · 2026-11-26

## 2026-11-26 — Caisse de destination lors d’un déplacement Uber Eats

Dans Restaurants → Liaisons, « Déplacer » ouvre la liaison avec la cuisine proposée et demande le marchand Clover de destination. La sauvegarde et l’activation Uber exigent cette destination quand une liaison existante change de cuisine. Les identifiants de caisse restent à valider chez Clover avant de déplacer des magasins réels. Voir les preuves marchandes dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46#issuecomment-7185601085).

— signé : Codex @ cloud · 2026-11-26

## 2026-11-26 — Suivi des appels Watchtower

Dans Alertes → Messages envoyés, le propriétaire non limité à une cuisine peut vérifier auprès de Twilio l’état d’un appel Watchtower déjà demandé. La consultation utilise la référence enregistrée, affiche seulement l’état et ne déclenche aucun appel. L’état « Appel terminé » indique que la réponse humaine est encore à vérifier. Le relevé marchand en lecture seule et les preuves encore ouvertes sont consignés dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46#issuecomment-7185162194).

— signé : Codex @ cloud · 2026-11-26

## 2026-11-26 — Preuve d’acceptation Too Good To Go en simulation

Le contrôle simulé attend ensemble la création dans Clover, l’état accepté et l’événement qui confirme qu’aucune requête d’acceptation ne part vers Too Good To Go. Le script complet a réussi ses 644 contrôles. La validation des commandes et des appels chez les marchands reste suivie dans [l’issue #46](https://github.com/takatakca/foodhubca/issues/46).

— signé : Codex @ cloud · 2026-11-26

## 2026-11-21 — Navigation mobile de la vitrine

Les liens Produit et Intégrations sont visibles sur mobile en français et en anglais. La navigation prévoit des cibles tactiles de 44 px et les sections ont une marge de défilement sous l’en-tête fixe. Après fusion, vérifier les deux ancres à 375 px et le SHA servi sur `/api/release`.

— signé : Codex @ cloud · 2026-11-21

## 2026-11-21 — Vitrine Food Hub FR/EN

Branche `feat/public-landing-refresh`. La refonte cible `foodhub.on2go.ca/hub` et `/en/hub`. La version compilée a passé les quatre essais Chromium (375 et 1 440 px), avec vérification des métadonnées, des liens, des captures, de la FAQ, des en-têtes et de l’absence de cookies ou de requêtes tierces. Après fusion, comparer `/api/release` au SHA de `main` et refaire les contrôles publics.

— signé : Codex @ cloud · 2026-11-21

## 2026-11-04 — unified platform workspaces and existing-PC continuity

Validated implementation commit: `2adf4147ee545991b7ac3954f4df2f74de8eef7d`, branch `feature/unified-platform-workspaces`. Source is ready for review; main/deployment and the owner's PC were not modified. GitHub API access was denied; the public board was read through all HTML timeline pages (360 items,354 comments). Drive/other-chat history and live PC access are unavailable here.

Delivered: Food Hub/Uber/DoorDash/Skip workspace bar and familiar provider navigation; 54-account wall follows provider/location while alarms cover all authorized screens; finance reads follow provider and supported restaurant scope; late responses cannot replace a new workspace; known statement-provider mismatches reject before writes; generic mappings are per-provider and auto-reused only when unambiguous. Screen preparation proposes missing sessions only. Windows manifest capacity now99, matching hub/generator (previously 50, which rejected 54).

Validation: production build and typecheck passed; full lint passed with one pre-existing devices-page warning, changed-file lint clean; full unit run: 2,072 passed / 12 skipped; 644 simulated end-to-end checks passed; 15 browser acceptance checks passed (375px/1440px plus workspace WCAG checks),9/9 actual sibling suite source-contract pairs passed. Windows-native tests remain skipped on Linux. The broader offline integration audit has 22 compatibility passes and 8 separate wiring/configuration gaps; none is a claim of deployed connectivity.

**Resume the existing PC first.** The owner reports it was working. Public notes confirm a Windows scratch-install test and Chrome 142 / Windows 11 startup fix on October 29; they do not establish current real-account sessions. Read `kit.json`, run its existing `Status-Screens.ps1 -AsJson` without printing .env values, compare browser/agent status and fresh Food Hub heartbeats. Preserve `<id>/profile`, IDs, provider assignments and current startup configuration. Extend the existing manifest when needed; do not replace it with a factory 54-screen preset or reinstall blindly. Creating hub records does not start new PC sessions. Current PC runtime verification is the concrete remaining blocker for this workflow.

Guides: [UNIFIED_PLATFORM_WORKSPACES.md](UNIFIED_PLATFORM_WORKSPACES.md), [EXISTING_PC_RELAY.md](EXISTING_PC_RELAY.md), [PLATFORM_INTEGRATION_AUDIT.md](PLATFORM_INTEGRATION_AUDIT.md). Reproducible source and browser verifiers are under `scripts/`. Local logs/screenshots are retained in `/workspace/setup/logs` and `/workspace/platform-review`. Official provider approvals/live order acceptance, durable deployments, V1 merchant entitlement/usage wiring and remaining premium business features have their separate gates in the audit. No live order, financial posting or routing cutover was performed.

— signé : Codex (unified-platform-workspaces) @ Codex cloud · 2026-11-04

# FOODHUB — relève de l'agent (à lire dès l'ouverture)

## Reprise — 2026-10-18, sync au démarrage

- **Cause** : le contrôle de santé a répondu `database=ok,sync=down,watchtower=ok,recovery=ok,inbox=ok,clover=ok,console=ok`. Le site était resté sans conteneur environ une heure, donc `sync:at` avait plus de 20 min. Le nouveau processus ne lance la synchro qu’après 5 min, et Coolify vérifie dès 60 s.
- **Correctif** : pendant la première fenêtre de synchro de ce processus, un horodatage ancien est un avertissement (HTTP 200). La synchro part aussi tout de suite au démarrage. Après cette fenêtre, une synchro morte reste un échec.
- **Suite** : fusionner pour que Coolify reconstruise. Le déploiement en cours échouera encore tant que cette image n’est pas celle qui démarre.

## Reprise — 2026-10-18, santé du conteneur

- **Cause** : l’image `c64fcec` a démarré (Next prêt), puis `node /app/scripts/check-runtime.mjs` a vu `/api/health` en 503. Le message ne disait pas quel contrôle était `down`. Coolify a retiré le conteneur ; le site public répond « no available server ».
- **Correctif** : l’échec du contrôle de santé inclut les statuts publics (`database=…`). La clé `health:ping` est par processus (deux conteneurs ne s’écrasent plus). Le Watchtower part tout de suite, et en production un Watchtower pas encore passé est un avertissement pendant 3 min, pas un échec. Une base absente ou une console sans secret reste un échec.
- **Suite** : fusionner, laisser Coolify redéployer. Si le journal dit `database=down` ou `console=down`, les variables Runtime `SUPABASE_URL` (ou `NEXT_PUBLIC_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY`, et `SESSION_SECRET` ou `DASHBOARD_PASSWORD` manquent. Ne pas les effacer en ajoutant `CLOVER_PHONE_*`.

## Reprise — 2026-10-18, déploiement Coolify

- **Cause** : `main` `6381aec` ne compilait pas. Deux `phoneFeesText` étaient collées dans `lib/foodhub/legal.ts` ; la première n’était pas fermée. Coolify s’arrêtait au `tsc` du Dockerfile.
- **Correctif** : une seule fonction, le texte aligné sur le comptage des minutes (commande ou non, essai et abonnement inactif exclus). Tests juridiques ajustés. `npm run typecheck` et `tests/legal-pages.test.ts` (23) passent en local.
- **Suite** : Coolify doit reconstruire `main`. Le site déjà en ligne reste l’image précédente tant que ce déploiement n’est pas sain. Les variables `CLOVER_PHONE_*` se posent après, dans Coolify, puis un nouveau déploiement.



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
## Preuve de déploiement retrouvée — 2026-10-15 12:49 UTC

La [description actualisée de la PR #49](https://github.com/takatakca/foodhubca/pull/49) consigne une **publication native Coolify réussie** après la fusion : déploiement [aq1pgwnyhwlebyteeqyhrmlr](https://coolify.takatak.ca/project/ci7kj4c0vvthwhqpvebogolb/environment/theoc1ynrzvwglqhyowcikka/application/1ijktzayh4dbcnn37igo8ktv/deployment/aq1pgwnyhwlebyteeqyhrmlr), statut `Webhook / Success`, mise à jour glissante terminée à 12:47:48 UTC. SHA rapporté à `/api/release` : `027b602a12da39b1244e17b813bc51a7496a0217` (même que `main` relevé). Les contrôles HTTPS rapportent annuaire/CORS public OK, santé HTTP 200 + base OK, login 200, commandes anonymes 401. Docker : 807 tests unitaires réussis (2 ignorés) et 536 E2E simulés réussis ; rollback et médias conservés.

**Portée de la preuve :** ceci est le compte rendu GitHub du propriétaire / opérateur, non un nouvel accès direct au conteneur par cet agent. La certification de commandes, paiement, caisse, imprimante, Twilio et connecteurs live auprès des fournisseurs reste ouverte (issue #46). Les paragraphes historiques plus bas indiquant « déploiement non vérifié » décrivent l'état *avant* cette preuve et ne doivent pas supplanter ce relevé. Le réseau de cet agent est isolé du DNS externe et ne permet pas un nouveau contrôle HTTPS public.


## Reprise technique — 2026-10-15 (nouvelle branche, priorité sur les anciennes entrées)

- **État GitHub contrôlé** : `main` = `027b602a12da39b1244e17b813bc51a7496a0217`, [CI 38735636016](https://github.com/takatakca/foodhubca/actions/runs/38735636016) = success. PR #49 fermée/intégrée ; PR #48 et #50 toujours ouvertes. L'intégration Coolify native GitHub est documentée sur `main`, mais sa publication exacte n'est pas prouvée.
- **Dernière tâche terminée** : constat du SHA réel de `main`, revue de la CI et des documents de relève, tentatives d'accès externes ; Le réseau de l'agent ne résout **aucun** nom externe testé (GitHub, Google, ON2GO, Food Hub) : **le résultat est inconclusif sur le DNS du domaine public lui-même**. Déploiement = **non vérifié**.
- **Tâche en cours** : PR [#51](https://github.com/takatakca/foodhubca/pull/51) ouverte sur `fix/foodhub-production-proof-strict-sha` ; code poussée au SHA `1c1ac10f8597fff5df84d876682aa1730547edfb`, contrôles GitHub [CI 38775188501](https://github.com/takatakca/foodhubca/actions/runs/38775188501) et [image 38775188273](https://github.com/takatakca/foodhubca/actions/runs/38775188273) en cours au moment de ce relevé. La tête du branche après cette note doit être relue dans GitHub ; pas de succès global annoncé avant la fin des jobs.
- **Fichiers modifiés** : `scripts/verify-live.mjs`, `tests/verify-live.test.mjs`, `.github/workflows/verify-production.yml`, `docs/DEPLOYMENT.md`, `docs/PROJECT_STATUS.md`, `docs/TASK_QUEUE.md`, `docs/AGENT_HANDOFF.md`, `WORKLOG.md`.
- **Validation** : GitHub CI du `main` ci-dessus réussie ; CI de la nouvelle PR à consulter avant de déclarer ce correctif validé. Le script modifié ne fait aucun appel réseau tant qu'un SHA complet n'a pas été fourni.
- **Blocage de vérification** : environnement de l'agent privé de résolution DNS externe ; faire confirmer la résolution réelle et les routes `/api/release`, `/api/health` et `/api/foodhub/orders` depuis une machine publique ou Coolify, puis traiter DNS/Contabo/Coolify **seulement si** le test autoritatif constate une panne ; sans divulguer de secret. Les tests réels Clover/Uber/DoorDash/Skip restent à certifier. Ne pas ajouter de second consommateur d'ordres.
- **Prochaine action exacte** : lire l'état CI/PR de `fix/foodhub-production-proof-strict-sha` et corriger ses erreurs ; après fusion propriétaire, relancer la vérification en fournissant le SHA exact attendu et documenter PASS/FAIL dans l'issue #46. Ensuite poursuivre les tâches indépendantes de `docs/TASK_QUEUE.md`.

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
