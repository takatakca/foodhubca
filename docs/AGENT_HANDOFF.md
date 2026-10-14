# FOODHUB — relève de l'agent (à lire dès l'ouverture)

Date du relevé : **2026-10-14**. Aucun accès aux fichiers locaux git-ignorés `private/TASKS.md` / `private/CLAIMS.md` depuis la connexion GitHub : les ouvrir dans le vrai checkout si disponibles.

## Dernière tâche terminée

- Correctif annuaire public + exemption exacte des routes : PR [#48](https://github.com/takatakca/foodhubca/pull/48), branche `fix/public-directory-availability-20261014`, CI + build image réussis au SHA `91bff1c601b950c111b6956ade81c93313c8d99b` ; **non fusionnée**.
- Développement suivant : vérificateur de publication en lecture seule ajouté au SHA `7b97a3aa511f6bfb57b9fce61e9523d983064378` sur `agent/foodhub-deployment-verifier`. Ses tests doivent être confirmés par la CI de la PR.

## Tâche actuellement en cours

Finaliser la branche `agent/foodhub-deployment-verifier`, faire vérifier la CI, ouvrir/inspecter la PR, puis obtenir une preuve de déploiement public du SHA choisi. La mise en ligne reste bloquée par DNS / accès Coolify / opt-in du workflow ; **ne pas prétendre que le push a déployé le site**.

## Fichiers modifiés dans cette reprise

`scripts/verify-live.mjs`, `tests/verify-live.test.mjs`, `package.json` ; `docs/PROJECT_STATUS.md`, `docs/TASK_QUEUE.md`, `docs/AGENT_HANDOFF.md`, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md` ; liens dans `docs/README.md`, règles de relève dans `AGENTS.md` et suivi dans `WORKLOG.md` / `docs/PROGRESS.md`.

## Git

- `main` observé : `bb353ccfa82a7ba5e3d7af488e0da6bf03746c09`.
- Dernier commit de code poussé pour ce lot : `7b97a3aa511f6bfb57b9fce61e9523d983064378`.
- Branche du lot : `agent/foodhub-deployment-verifier` ; consulter sa tête GitHub pour le SHA de documentation suivant.
- La fusion et la publication sont réservées au propriétaire conformément à `CLAUDE.md`. Ne jamais forcer `main`.

## Commandes / vérifications

- API GitHub : dépôt, tête `main`, branches, PR #48 et #43/#45/#44/#39, issue #46, derniers workflow runs.
- [CI #48](https://github.com/takatakca/foodhubca/actions/runs/38608758328) : `success` ; [Image #48](https://github.com/takatakca/foodhubca/actions/runs/38608758793) : `success`.
- Nouvelle vérification proposée : `npm run check`, `npm run build`, `npm run verify:foodhub` ; test ciblé `npx vitest run tests/verify-live.test.mjs`. **Non exécutés localement dans cette reprise** ; lire la CI de la nouvelle PR avant de les dire réussis.
- Vérification réelle, quand DNS/Coolify prêts : `npm run verify:live -- --url https://foodhub.on2go.ca/ --sha FULL_40_CHAR_SHA`.

## Problèmes et statut du déploiement

- Déploiement de `main` non prouvé. Dernières actions « Deploy Food Hub to Coolify » : `skipped` ; opt-in `FOODHUB_COOLIFY_AUTODEPLOY_ENABLED` non activé dans les preuves.
- `foodhub.on2go.ca` était inaccessible / 502 selon le dernier WORKLOG ; la tentative publique du présent relevé n'a pas démontré de réponse valide pour `/api/release` ou `/api/health`. Vérifier directement depuis un réseau externe.
- Aucune certification de commandes réelles Clover/plateformes, aucun cutover, aucun test financier réel réalisés ici.
- Ne pas activer les connecteurs live sans preuves et approbation de l'exploitant.

## Accès nécessaires (sans secret)

Droits GitHub pour PR, propriétaire DNS, Coolify (ressource FOOD HUB et logs), accès sécurisé aux variables GitHub Actions, accès administrateur Clover/Uber/DoorDash/Skip et aux environnements d'essai, Supabase Montréal pour lecture sanitaire/restauration. **Ne jamais coller les valeurs d'identifiants dans Git, un ticket ou un chat.**

## Prochaine action exacte

1. Vérifier les exécutions CI + image de la PR `agent/foodhub-deployment-verifier` et corriger tout échec sur **cette branche**.
2. Après approbation/fusion propriétaire, réparer DNS/HTTPS et activer le pipeline Coolify selon `docs/DEPLOYMENT.md`, sans double consommateur webhooks.
3. Exécuter `verify:live` avec le SHA de `main` effectivement déployé et coller uniquement le résultat PASS/FAIL, URL et SHA dans l'issue #46 ; entreprendre ensuite la première tâche NEXT de `TASK_QUEUE.md` non attribuée.
