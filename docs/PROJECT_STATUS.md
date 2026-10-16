# FOODHUB / ON2GO Hub — état vérifiable du projet

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
