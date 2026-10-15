# FOODHUB — file de tâches coordonnée

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

Avant de coder : vérifier `main`, PR, commits, `WORKLOG.md` et le tableau local s'il est accessible ; ne pas reprendre une tâche active sur une autre branche. Mettre à jour `docs/AGENT_HANDOFF.md` et `WORKLOG.md` avant de rendre la main. Pas de fusion automatique de `main` : `CLAUDE.md` réserve cette action au propriétaire.
