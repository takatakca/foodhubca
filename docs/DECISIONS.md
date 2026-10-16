# FOODHUB — décisions d'architecture et d'exploitation

## Décision UI locale — 2026-10-16

Les listes et tableaux doivent distinguer **chargement** et **aucune donnée**. On utilise des placeholders sémantiques et non interactifs, sans afficher de données simulées ni déclencher de chargements supplémentaires. Les animations sont sous `motion-safe`, afin de respecter la préférence du système. Implémentation isolée sur `fix/finance-table-loading-skeletons`, sans changement aux décisions d'architecture, à `main` ou aux intégrations.


Mise à jour : 2026-10-14. **Références normatives** : `CLAUDE.md`, `BRAND.md`, `docs/LOCKED_DECISIONS.md`, `docs/ON2GO_HUB_ECOSYSTEM.md`. En cas de divergence, les décisions explicites du propriétaire et les règles de sécurité des documents existants priment ; cette synthèse n'introduit pas d'approbations nouvelles.

| Sujet | Décision à conserver | Source |
|---|---|---|
| Source de vérité Git | `main` est réservé au propriétaire. Les agents développent sur branches/PR ; jamais de force-push ni de fusion autonome dans `main` | `CLAUDE.md` |
| Identité | TAKATAK reste maître des identités, comptes et droits produits ; ON2GO Hub conserve ses données opérationnelles de commande. Ne pas créer un deuxième CRM maître | `ON2GO_HUB_ECOSYSTEM.md` C3–C6 |
| Marchands | Modèle H4-a silo par marchand avant SaaS mutualisé H4-b avec isolation serveur/RLS testée ; ne jamais considérer la séparation des données acquise sans validation | `ON2GO_HUB_ECOSYSTEM.md` `4 |
| App client | ON2GO.ca (annuaire / PWA) est séparée de la console marchand Food Hub/ON2GO Hub ; ne pas mélanger leurs menus et droits | `ON2GO_HUB_ECOSYSTEM.md` |
| Données privées | Commandes et renseignements clients sur l'infrastructure prévue à Montréal ; seuls événements et agrégats autorisés et dépourvus de PII vers le plan de contrôle TAKATAK | `ON2GO_HUB_ECOSYSTEM.md` |
| Marque | GROUPE TAKATAK : bleu électrique sur marine, et aucun ancien logo « TK » doré ; nom affiché ON2GO Hub seulement par configuration | `BRAND.md` / `ON2GO_HUB_ECOSYSTEM.md` |
| Ordres et caisse | Intégrations directes sans UrbanPiper ; Clover reçoit la commande avant acceptation plateforme ; pas de doublons ni de faux états « envoyé » | `LOCKED_DECISIONS.md` |
| Actions IA | L'IA explique et propose, jamais ne rembourse, approuve, supprime, paie ou publie seule | `LOCKED_DECISIONS.md` |
| Magasin verrouillé | Po Poulet NDG (DoorDash 27982486) : ne jamais modifier, publier, faire un 86 ni exposer son lien | `CLAUDE.md` |
| Secrets | Uniquement variables sécurisées hébergeur/GitHub ; aucun secret ou donnée privée en dépôt public | `CLAUDE.md` |
| Livraison | Coolify/Contabo via GHCR, opt-in GitHub Actions et preuve du SHA live ; aucune déclaration « déployé » sur simple push ou build | `RELEASE_GHCR_COOLIFY.md` |
| Fournisseurs | Ne pas activer `LIVE_CONNECTORS_GLOBAL_ENABLED=true` sans approbation, checklist Go-live et essais réels | `LOCKED_DECISIONS.md` |
| Reprise | L'agent lit `AGENTS.md`, `AGENT_HANDOFF.md`, PR/CI puis prend la première tâche libre. Les fichiers privés restent hors Git | `AGENTS.md` / `CLAUDE.md` |

## Activation autorisée du 2026-10-15

La demande explicite du propriétaire autorise cette reprise à fusionner la PR #49 et terminer la livraison automatique de Food Hub. Pour cette activation, le GitHub App natif Coolify sur `main` remplace le contrôleur Actions/GHCR historique, car les runners GitHub sont bloqués par la facturation. Un seul contrôleur, tests isolés obligatoires dans Dockerfile, SHA exact et santé de production obligatoires. Cette autorisation ne lance aucun connecteur marchand et ne modifie pas les données Supabase, les secrets de session ou le volume média. Les règles historiques ci-dessus restent applicables aux travaux non autorisés.

## Décisions en attente

La mise en production intégrale, le lancement Clover App Market, l'ouverture aux nouveaux marchands, les permissions fournisseurs, le basculement `hub.on2go.ca` et le calendrier des paiements nécessitent des preuves et/ou une approbation du propriétaire. Ne pas les interpréter comme réalisées du seul fait que leur code est présent.
