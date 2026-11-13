# FOODHUB / ON2GO Hub — état vérifiable du projet

Dernière actualisation : **2026-11-13** (reprise TAKATAK — audit complet, 5 registres section par section).
Dépôt : `takatakca/foodhubca`, branche de publication `main`.
Source de vérité : les commits, PR, exécutions Actions et l'issue #46 de GitHub, plus les vérifications en direct du site.
Ce document **n'est pas une preuve de fonctionnement en production** : il distingue ce qui est vérifié en direct, ce qui n'est prouvé qu'en tests simulés, et ce qui reste bloqué chez les tiers.

## État confirmé (vérifié le 2026-11-13)

| Domaine | Résultat vérifié | Preuve / limite |
|---|---|---|
| Source | `main` = `d38ab8a` (fusion PR #145) ; avant elle, `14039c5` | GitHub, 2026-11-13 |
| Site en ligne | `foodhub.on2go.ca` répond ; `/api/health` = ok (database, sync, watchtower, recovery, inbox, clover, console) | GET directs, 2026-11-13 08:10 UTC |
| SHA servi | `14039c5` == `main` au moment du contrôle (02:28 EST) ; déploiement de `d38ab8a` déclenché à la fusion de la PR #145, à re-contrôler via `/api/release` | `/api/release` (no-store) |
| Livraison automatique | **Activée** : webhook natif Coolify au push de `main` (les anciennes lignes « non activée / DNS à résoudre » sont historiques et fausses) | Déploiements constatés 2026-10-15 → aujourd'hui |
| Tests | Suite locale complète : **2 086 réussis, 12 ignorés, 0 échec** (154 fichiers) ; typecheck propre | `npm test` + `npm run typecheck`, 2026-11-13 |
| CI sur PR #145 | Revue automatisée « Low Risk » ; état de fusion GitHub « clean » | PR #145 |
| PR anciennes | #43 (finance) et #45 (DoorDash Drive) : code **déjà dans `main`** ; #44 et #39 : PR de journal/docs figées depuis le 2026-10-10, ouvertes mais sans contenu à intégrer | `git log` vérifié une à une (audit 2026-11-13) |
| Bug « Mon compte » | Historique client vide au-delà de 500 commandes : **corrigé** (PR #145, balayage 500 → 2 000 → 10 000, test de régression) | `lib/foodhub/customers/me.ts`, `tests/customers-me.test.ts` |

## Application existante — à conserver

Next.js 16 / React 19 / TypeScript ; interface marchand et cuisine FR/EN, commandes et retransmissions, intégrations directes Uber Eats, DoorDash, Skip, TGTG, Clover, Watchtower, finance, annuaire public pour ON2GO et QMAPS, voix et livraison optionnelles. Voir `README.md` et `docs/ON2GO_HUB_ECOSYSTEM.md`. Le code et les tests automatisés ne prouvent pas que chaque fournisseur a approuvé ses accès ou que les commandes réelles aboutissent.

## Non certifié — les vrais blocages (inchangés, honnêtes)

- **Commandes réelles de bout en bout** : aucune plateforme n'a porté de trafic réel. Verrou global `LIVE_CONNECTORS_GLOBAL_ENABLED` toujours à `false` (règle : ne l'activer que checklist + tests réels verts). Certification : issue #46 (FH-006/FH-007).
- **Uber Eats** : accès production non accordé (scopes `eats.order`, `eats.store`, `eats.store.status.write`, `eats.pos_provisioning`) ; l'ancien intégrateur tient encore les magasins comme `order_manager`.
- **DoorDash** : intégration ouverte en sandbox seulement ; `DOORDASH_PROVIDER_TYPE` + identifiants production jamais émis.
- **SkipTheDishes** : 60/60 opérations JET Connect codées ; `SKIP_JET_API_KEY` jamais émise.
- **Clover** : apps en révision au Marketplace depuis le 2026-10-17 ; aucun marchand réel exercé. Facturation : mesurage 15 $/marque extra codé et testé mais **éteint par défaut** ; un abonnement Food Hub échu ne bloque rien.
- **Remboursement Clover par API** : absent — annulation après paiement = remboursement manuel dans l'app Clover (alerte dans Food Hub).
- **Kiosque / T4CTILE** : prototype HTML statique hors dépôt, fin de parcours simulée — à construire.
- **Fidélité / cartes-cadeaux** : adaptateurs en stub honnête (`connected: false`) — parcours absent.
- **18 écrans de commandes** (8 DoorDash, 6 Uber, 4 Skip) : aucune preuve qu'ils tournent sur le PC du propriétaire depuis les dry-runs du 2026-10-29 ; relais `ecrans.on2go.ca` à provisionner + connexions uniques = gestes du propriétaire.
- **Finance A–Z** : pipeline réel mais CLI hors ligne alimenté à la main ; la finance intégrée (recon) lit bien les commandes sauvegardées.

## Règles et limites connues

- L'instance Food Hub actuelle n'est pas un SaaS multi-tenant partagé dont l'isolation est entièrement certifiée. TAKATAK conserve l'identité et les comptes maîtres ; l'isolation par entreprise et les droits produits sont des exigences pour l'expansion.
- Po Poulet NDG, magasin DoorDash 27982486 : aucune action sortante ni lien.
- Ne jamais accepter une commande plateforme avant confirmation de la réception par Clover selon les règles actuelles ; pas de faux statut « envoyé ».
- Ne pas activer `LIVE_CONNECTORS_GLOBAL_ENABLED=true` tant que la checklist et les tests réels ne sont pas verts.
- Aucun secret, numéro privé, paiement ou donnée client dans Git ou dans ces documents.

## Où reprendre

Lire `AGENTS.md`, `CLAUDE.md`, `docs/AGENT_HANDOFF.md` puis `docs/TASK_QUEUE.md` (relève du 2026-11-13 en tête). Le détail des blocages de production est dans `docs/DEPLOYMENT.md` et l'issue #46. Les décisions à préserver sont dans `docs/DECISIONS.md` et `docs/LOCKED_DECISIONS.md`. L'audit complet du 2026-11-13 (5 registres + plan maître) vit dans le dossier de reprise TAKATAK « Food Hub » (Drive) et l'espace de travail de l'agence.


---

# Historique — états antérieurs conservés pour trace (supplantés par l’état du 2026-11-13 ci-dessus)

# FOODHUB / ON2GO Hub — état vérifiable du projet

## Reprise 2026-10-16 — navigation clavier des onglets (non publié)

Sur la branche `fix/console-tabs-keyboard-20261016` (créée à partir de `main` `12ba64d9f6941698118533d40d3f381ff709065c`), les onglets horizontaux de la console respectent maintenant le focus roving ARIA : seul l'onglet choisi est accessible avec Tab, flèche droite/gauche et Début/Fin sélectionnent et focalisent le bon onglet. Leurs événements `onChange` existants sont conservés, sans modification de données ni routes. Tests de navigation et cas invalides ajoutés dans `tests/tab-keyboard.test.ts`. CI, image Docker, revue navigateur et fusion propriétaire à contrôler ; aucune livraison de cette branche.
## Reprise 2026-10-16 — focus des fenêtres de la console (branche, non déployé)

`main` observé au SHA `12ba64d9f6941698118533d40d3f381ff709065c` (PR #57 fusionnée, CI et image réussies). Correctif indépendant sur `fix/overlay-keyboard-focus-20261016` : les dialogues et tiroirs portalisés partagent une pile de fenêtres active ; seul le dessus reçoit Échap et Tab, le focus reste dans la fenêtre, revient au déclencheur après fermeture, les zones de fond ne défilent pas en cas de fenêtres imbriquées. Les titres et sous-titres sont reliés aux attributs ARIA. Tests purs des règles d'empilement et du bouclage clavier ajoutés. Les validations GitHub de cette branche sont à contrôler sur son dernier commit. Aucune donnée marchande ni intégration modifiée ; **aucun déploiement effectué sur cette branche**. Les validations réelles Clover, Uber, DoorDash et Skip restent non certifiées : issue #46.
## Preuve de déploiement retrouvée — 2026-10-15 12:49 UTC

La [description actualisée de la PR #49](https://github.com/takatakca/foodhubca/pull/49) consigne une **publication native Coolify réussie** après la fusion : déploiement [aq1pgwnyhwlebyteeqyhrmlr](https://coolify.takatak.ca/project/ci7kj4c0vvthwhqpvebogolb/environment/theoc1ynrzvwglqhyowcikka/application/1ijktzayh4dbcnn37igo8ktv/deployment/aq1pgwnyhwlebyteeqyhrmlr), statut `Webhook / Success`, mise à jour glissante terminée à 12:47:48 UTC. SHA rapporté à `/api/release` : `027b602a12da39b1244e17b813bc51a7496a0217` (même que `main` relevé). Les contrôles HTTPS rapportent annuaire/CORS public OK, santé HTTP 200 + base OK, login 200, commandes anonymes 401. Docker : 807 tests unitaires réussis (2 ignorés) et 536 E2E simulés réussis ; rollback et médias conservés.

**Portée de la preuve :** ceci est le compte rendu GitHub du propriétaire / opérateur, non un nouvel accès direct au conteneur par cet agent. La certification de commandes, paiement, caisse, imprimante, Twilio et connecteurs live auprès des fournisseurs reste ouverte (issue #46). Les paragraphes historiques plus bas indiquant « déploiement non vérifié » décrivent l'état *avant* cette preuve et ne doivent pas supplanter ce relevé. Le réseau de cet agent est isolé du DNS externe et ne permet pas un nouveau contrôle HTTPS public.

## État au 2026-10-16 — contrôlé dans GitHub

`main` = `444e8f2e60dd73e5eaa90bc4e9f92d05489b38f3` (PR #53 Clover fusionnée). [CI 38845406916](https://github.com/takatakca/foodhubca/actions/runs/38845406916) et [image 38845406823](https://github.com/takatakca/foodhubca/actions/runs/38845406823) **success**. La preuve la plus récente du déploiement public consignée dans [PR #49](https://github.com/takatakca/foodhubca/pull/49) est le SHA `027b602a12da39b1244e17b813bc51a7496a0217` (2026-10-15). Aucune preuve externe nouvelle d'un conteneur exécutant `444e8f2` n'a pu être obtenue par cette session. Les jobs historiques Actions Coolify sont `skipped` ; la livraison native Coolify est documentée, non présumée réussite pour ce SHA.

La [PR #52](https://github.com/takatakca/foodhubca/pull/52) résout la Phase 3 P0 cuisine/chargement/motion sur une branche **non déployée** et désormais sans conflit après rapprochement avec la PR #53. Contrôler les résultats CI les plus récents avant de déclarer prêt. Les paiements, commandes et connecteurs réels Clover/plateformes restent à certifier par essais autorisés.


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
