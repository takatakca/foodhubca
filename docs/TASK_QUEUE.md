## 2026-11-04 — continued platform implementation / integration checks running

Current source extends the earlier review with server-priced checkout/recovery, scoped Orders filters, authorized organization views, signed customer balances and durable V1 reporting. Financial uncertainty and account-switching regressions passed the final coordinated gates: 2,272 unit/22 skipped, production build/typecheck, 644 simulated E2E, 25 PostgreSQL crash checks and 13 cross-repository PostgreSQL browser checks. The last includes distinct simultaneous orders through two actual server processes. See [current acceptance status](RESTAURANT_PLATFORM_DELIVERY.md); do not treat old source-gap lists or the first public-site milestone as current completion. Source review is independent from production acceptance, which requires applied network access and actual provider/PC verification.

— signé : Codex @ Codex cloud · 2026-11-04

## 2026-11-04 — restaurant experience review and live acceptance

Five separately pushed agent branches: [progress index](agent-progress/README.md). Source/media and local checks are complete for this slice; production and the remaining source gaps are explicit in [delivery/acceptance](RESTAURANT_PLATFORM_DELIVERY.md). Next: connect legitimate Drive/Coolify access, apply saved network domains, verify native deployment/release, deploy backend before ON2GO, and certify controlled real provider/Clover/PC flows.

## 2026-11-04 — FH-PLATFORM-WORKSPACES / REVIEW

Source commit `2adf4147ee545991b7ac3954f4df2f74de8eef7d` on `feature/unified-platform-workspaces`: provider workspace navigation, scoped 54-tablet wall and finance, existing-session-aware preparation, Windows 99-slot capacity, safe statement provider/mapping checks. Verified: 2,072 unit tests passed (12 skipped), 644 simulated E2E checks, 15 browser checks, production build, and 9/9 sibling suite contracts. Owner reviews the branch; runtime next step is read-only status of the already-reported PC installation, preserving its existing profiles/IDs/configuration. See [EXISTING_PC_RELAY.md](EXISTING_PC_RELAY.md). Live PC/Drive unavailable in this cloud; do not restart from a new-host installation assumption.

— signé : Codex @ Codex cloud · 2026-11-04

# FOODHUB — file de tâches coordonnée

## 2026-10-16 — suite UX clavier, tâche indépendante

- **FH-014 / interface** : améliorer l'accessibilité des `Tabs` horizontaux via ArrowLeft/ArrowRight, Home/End et `tabIndex` roving. Branche `fix/console-tabs-keyboard-20261016` ; code et tests créés, CI/revue navigateur nécessaires, fusion uniquement par propriétaire. Distinct de [PR #62](https://github.com/takatakca/foodhubca/pull/62) qui sécurise modales/tiroirs.

**16 octobre 2026 : FH-016 — REVIEW / branche `fix/console-kitchen-a11y`, PR #52.** Phase 3 P0 interface cuisine : tokens sombres pour les dialogues portalisés/écran NIP, thème avant premier rendu, contraste, zone tactile 48px, réduction des animations OS, erreur/chargement au niveau de la console. Code et tests poussés ; attendre la CI de la dernière tête puis révision/fusion réservées au propriétaire. Reprise après fusion PR #53 : `main` `444e8f2e60dd73e5eaa90bc4e9f92d05489b38f3`. Les dossiers FH-006/FH-007 de commandes réelles restent **non certifiés**.


**État de mise en ligne 2026-10-15** : [PR #49](https://github.com/takatakca/foodhubca/pull/49) indique une publication Coolify native **Success**, SHA live `027b602a12da39b1244e17b813bc51a7496a0217` confirmé en HTTP et conteneur sain à 12:49 UTC. FH-002/003/004/005 : preuve de publication consignée, non une nouvelle vérification par cet agent ; la dernière condition de certification **réelle** des commandes / fournisseurs (FH-006/FH-007) demeure bloquante. PR #51 renforce la vérification de dérive de version et ajoute un contrôle automatisé opt-in.


**2026-10-15, nouvelle tâche FH-015 (branche `fix/foodhub-production-proof-strict-sha`)** : rendre impossible un PASS de `verify:live` sans SHA attendu ; ajouter un workflow GitHub Actions opt-in pour surveiller le SHA et les endpoints publics. [PR #51](https://github.com/takatakca/foodhubca/pull/51) ouverte ; CI de la tête de branche en cours, fusion/publication propriétaire à valider. La configuration Coolify native sur `main` est distincte, aucune action prod ici.

**Reprise autorisée 2026-10-15** : FH-002 à FH-005 sont prises sur la PR #49 pour terminer la livraison native GitHub App → Coolify et prouver le SHA public. Accès/source/backup/santé configurés ; tests locaux réussis (807 unitaires, 536 E2E). La livraison finale reste à constater après fusion. Aucun changement aux intégrations réelles FH-006/FH-007. Le tableau du 2026-10-14 ci-dessous conserve son contexte historique.

Mise à jour : 2026-10-14. Ce tableau public est une relève Git ; il **ne remplace pas** `private/TASKS.md` (tableau local git-ignoré) ni les branches actives des autres agents, conformément à `CLAUDE.md`.
Statuts : DONE = preuve GitHub ; REVIEW = branche/PR à valider ; BLOCKED = intervention externe ; NEXT = travail exécutable sans dépendance ; NOT CERTIFIED = manque la preuve live.

| Priorité | ID | Statut | Tâche et condition d'acceptation | Responsable / suite |
|---|---|---|---|---|
| P0 | FH-001 | REVIEW | PR #48 : sécurité de la route annuaire + lecture DB bornée ; CI et image vertes | Propriétaire : fusionner après révision |
| P0 | FH-002 | REVIEW | Vérificateur `npm run verify:live` avec tests, documentation et PR ; refuser un SHA erroné ou un endpoint commandes public | Branche `agent/foodhub-deployment-verifier` |
| P0 | FH-003 | BLOCKED | DNS A/AAAA de `foodhub.on2go.ca` vers le bon serveur, HTTPS valide ; GET /api/release et /api/health accessibles | Opérateur DNS/Contabo/Coolify ; capture et résultat horodatés |
| P0 | FH-004 | BLOCKED | Autoriser le déploiement contrôlé après preview épinglée, sauvegarde et rollback ; configurer les variables/secrets GitHub Actions dans l'UI | Propriétaire infrastructure ; voir `DEPLOYMENT.md` |
| P0 | FH-005 | NOT CERTIFIED | Déployer un SHA précis, `/api/release` = SHA attendu, `/api/health` 200, annuaire 200+CORS, login 200, commandes sans session 401 | Relancer `npm run verify:live -- --url https://foodhub.on2go.ca/ --sha SHA40` |
| P0 | FH-006 | BLOCKED | Preuve Clover OAuth / commandes avec vraie sandbox et parcours réception → cuisine ; pas de ticket doublé | Accès Clover, propriétaire ; issue #46 |
| P0 | FH-007 | BLOCKED | Tests des commandes, annulations et erreurs avec Uber, DoorDash et Skip, une plateforme à la fois ; laisser les tablettes de secours | Approbations/clé plateformes et cuisines |
| P1 | FH-008 | REVIEW | PR #45 : valider correctifs Drive sans conflit ni action réelle non approuvée | Agent DoorDash/owner sur sa PR existante |
| P1 | FH-009 | REVIEW | PR #43 : vérifier les exports historiques et taxes GST/QST, préserver les fichiers privés | Agent finance/owner sur sa PR existante |
| P1 | FH-010 | NEXT | Surveiller l'issue #46 et enregistrer PASS/FAIL/BLOCKED par intégration + SHA + preuve | Agent de relève, sans inventer les accès |
| P1 | FH-011 | BLOCKED | Publication Clover App Market : statut de révision, permission/branding/logos, OAuth deux marchands | Propriétaire du portail Clover |
| P2 | FH-012 | NEXT | Contrats ON2GO Hub ↔ TAKATAK : C3 SSO, C4 droits, C5 événements d'usage, C6 agrégats, tests d'isolation | Nouvelle branche après inspection `docs/ON2GO_HUB_ECOSYSTEM.md` et des PR |
| P2 | FH-013 | BLOCKED | ON2GO.ca et QMAPS : consommation vérifiée du feed public, vrai lien de commande, déploiement du dépôt `on2goca` | Dépôt distinct, issue #46 (secrets SSH distincts) |
| P2 | FH-014 | NEXT | Revoir les fonctions marketing, fidélité, PWA, livraison maison et UX restantes sans recréer les branches existantes | Document `docs/ON2GO_HUB_ECOSYSTEM.md`, phases H2–H6 |

## Discipline

Avant de coder : vérifier `main`, PR, commits, `WORKLOG.md` et le tableau local s'il est accessible ; ne pas reprendre une tâche active sur une autre branche. Mettre à jour `docs/AGENT_HANDOFF.md` et `WORKLOG.md` avant de rendre la main. Fusion : depuis le 2026-10-29, chaque agent fusionne sa propre PR quand les vérifications sont vertes (`CLAUDE.md`, ordres du propriétaire) ; jamais de push direct sur `main`. Une fusion peut mettre en ligne (déploiement Coolify au push, `docs/DEPLOYMENT.md` §3) : vérifications complètes d'abord. Lire `docs/REGISTRE_TAKATAK.md` avant de commencer.
