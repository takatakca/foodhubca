# FOODHUB / ON2GO Hub — état vérifiable du projet

## Reprise 2026-10-16 — navigation clavier des onglets (non publié)

Sur la branche `fix/console-tabs-keyboard-20261016` (créée à partir de `main` `12ba64d9f6941698118533d40d3f381ff709065c`), les onglets horizontaux de la console respectent maintenant le focus roving ARIA : seul l'onglet choisi est accessible avec Tab, flèche droite/gauche et Début/Fin sélectionnent et focalisent le bon onglet. Leurs événements `onChange` existants sont conservés, sans modification de données ni routes. Tests de navigation et cas invalides ajoutés dans `tests/tab-keyboard.test.ts`. CI, image Docker, revue navigateur et fusion propriétaire à contrôler ; aucune livraison de cette branche.
## Reprise 2026-10-16 — focus des fenêtres de la console (branche, non déployé)

`main` observé au SHA `12ba64d9f6941698118533d40d3f381ff709065c` (PR #57 fusionnée, CI et image réussies). Correctif indépendant sur `fix/overlay-keyboard-focus-20261016` : les dialogues et tiroirs portalisés partagent une pile de fenêtres active ; seul le dessus reçoit Échap et Tab, le focus reste dans la fenêtre, revient au déclencheur après fermeture, les zones de fond ne défilent pas en cas de fenêtres imbriquées. Les titres et sous-titres sont reliés aux attributs ARIA. Tests purs des règles d'empilement et du bouclage clavier ajoutés. Les validations GitHub de cette branche sont à contrôler sur son dernier commit. Aucune donnée marchande ni intégration modifiée ; **aucun déploiement effectué sur cette branche**. Les validations réelles Clover, Uber, DoorDash et Skip restent non certifiées : issue #46.
## Preuve de déploiement retrouvée — 2026-10-15 12:49 UTC

La [description actualisée de la PR #49](https://github.com/takatakca/foodhubca/pull/49) consigne une **publication native Coolify réussie** après la fusion : déploiement [aq1pgwnyhwlebyteeqyhrmlr](https://coolify.takatak.ca/project/ci7kj4c0vvthwhqpvebogolb/environment/theoc1ynrzvwglqhyowcikka/application/1ijktzayh4dbcnn37igo8ktv/deployment/aq1pgwnyhwlebyteeqyhrmlr), statut `Webhook / Success`, mise à jour glissante terminée à 12:47:48 UTC. SHA rapporté à `/api/release` : `027b602a12da39b1244e17b813bc51a7496a0217` (même que `main` relevé). Les contrôles HTTPS rapportent annuaire/CORS public OK, santé HTTP 200 + base OK, login 200, commandes anonymes 401. Docker : 807 tests unitaires réussis (2 ignorés) et 536 E2E simulés réussis ; rollback et médias conservés.

**Portée de la preuve :** ceci est le compte rendu GitHub du propriétaire / opérateur, non un nouvel accès direct au conteneur par cet agent. La certification de commandes, paiement, caisse, imprimante, Twilio et connecteurs live auprès des fournisseurs reste ouverte (issue #46). Les paragraphes historiques plus bas indiquant « déploiement non vérifié » décrivent l'état *avant* cette preuve et ne doivent pas supplanter ce relevé. Le réseau de cet agent est isolé du DNS externe et ne permet pas un nouveau contrôle HTTPS public.


## Mise à jour du 2026-10-15 — activation en cours

L'accès Coolify est rétabli et la source Food Hub est liée au GitHub App existant, avec livraison native sur push de `main`. Les anciennes lignes « bloqué accès / opt-in Actions » ci-dessous sont historiques. Le propriétaire a demandé cette activation ; le contrôleur Actions est désactivé pour éviter un double déploiement. Le Dockerfile applique tous les contrôles sur Contabo malgré le blocage de facturation Actions. Localement : audit/typecheck/lint/build réussis, 807 tests unitaires réussis (2 ignorés), E2E 536/0. Médias/configuration privée et image de rollback sauvegardés ; base, session et volume existants conservés. La publication n'est pas encore certifiée au moment de cette écriture : attendre le déploiement Webhook réussi et comparer `/api/release` au SHA complet de `main`.

Dernière actualisation : 2026-10-14 (UTC). Dépôt : `takatakca/foodhubca`, branche de publication `main`.
Source de vérité : les commits, exécutions Actions, PR et issue #46 de GitHub. Ce document **n'est pas une preuve de fonctionnement en production**.

## État confirmé

| Domaine | Résultat vérifié | Preuve / limite |
|---|---|---|
| Source | `main` = `bb353ccfa82a7ba5e3d7af488e0da6bf03746c09` | GitHub, 2026-10-14 |
| CI sur `main` | Réussie | [Exécution 38550600858](https://github.com/takatakca/foodhubca/actions/runs/38550600858) |
| Correctif annuaire `#48` | CI + image réussies, non fusionné | [CI 38608758328](https://github.com/takatakca/foodhubca/actions/runs/38608758328), [image 38608758793](https://github.com/takatakca/foodhubca/actions/runs/38608758793) |
| Vérificateur de publication | Code ajouté sur `agent/foodhub-deployment-verifier` ; PR et CI à suivre | `scripts/verify-live.mjs`, `tests/verify-live.test.mjs` |
| Livraison automatique | **Non activée**, dernière exécution ignorée | [Run 38609381840](https://github.com/takatakca/foodhubca/actions/runs/38609381840) |
| Domaine `foodhub.on2go.ca` | **Non vérifié depuis l'extérieur** | Dernier WORKLOG : 502/DNS à résoudre ; pas de preuve de SHA live ni de santé |
| Supabase/Clover/plateformes | Non certifiés pour un parcours réel de bout en bout | [Issue #46](https://github.com/takatakca/foodhubca/issues/46) |

## Application existante — à conserver

Next.js 16 / React 19 / TypeScript ; interface marchand et cuisine FR/EN, commandes et retransmissions, intégrations directes Uber Eats, DoorDash, Skip, TGTG, Clover, Watchtower, finance, annuaire public pour ON2GO et QMAPS, voix et livraison optionnelles. Voir `README.md` et `docs/ON2GO_HUB_ECOSYSTEM.md`. Le code et les tests automatisés ne prouvent pas que chaque fournisseur a approuvé ses accès ou que les commandes réelles aboutissent.

## Règles et limites connues

- L'instance Food Hub actuelle n'est pas un SaaS multi-tenant partagé dont l'isolation est entièrement certifiée. TAKATAK conserve l'identité et les comptes maîtres ; l'isolation par entreprise et les droits produits sont des exigences pour l'expansion.
- Po Poulet NDG, magasin DoorDash 27982486 : aucune action sortante ni lien.
- Ne jamais accepter une commande plateforme avant confirmation de la réception par Clover selon les règles actuelles ; pas de faux statut « envoyé ».
- Ne pas activer `LIVE_CONNECTORS_GLOBAL_ENABLED=true` tant que la checklist et les tests réels ne sont pas verts.
- Les PR #43 (finance), #45 (DoorDash Drive), #44 et #39 (journal) sont ouvertes ou non intégrées à la date d'inspection ; vérifier leur état avant de reprendre leur code.
- Aucun secret, numéro privé, paiement ou donnée client dans Git ou dans ces documents.

## Où reprendre

Lire `AGENTS.md`, `CLAUDE.md`, `docs/AGENT_HANDOFF.md` puis `docs/TASK_QUEUE.md`. Le détail des blocages de production est dans `docs/DEPLOYMENT.md` et l'issue #46. Les décisions à préserver sont dans `docs/DECISIONS.md` et `docs/LOCKED_DECISIONS.md`.

## Relevé complémentaire — 2026-10-15 (agent GitHub)

- `main` observé : `027b602a12da39b1244e17b813bc51a7496a0217`, CI [38735636016](https://github.com/takatakca/foodhubca/actions/runs/38735636016) réussie ; PR #49 fermée/fusionnée ; PR #48 et #50 encore ouvertes. Ces faits priment les SHA historiques des sections précédentes.
- Vérifications externes `foodhub.on2go.ca/api/release`, `/api/health` et `/api/public/directory` : aucune réponse utilisable ; l'environnement d'inspection ne résout aucun domaine externe (GitHub et Google échouent aussi), HTTP 000. **Ce résultat ne démontre pas une panne DNS propre au site**. Il n'existe toujours pas de preuve du SHA en production.
- La branche `fix/foodhub-production-proof-strict-sha` corrige le risque d'un faux PASS du vérificateur sans SHA attendu et ajoute un contrôle GitHub Actions manuel/périodique, strictement en lecture seule. Aucune mise en production automatique n'est demandée depuis cette branche.
