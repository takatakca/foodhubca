# 2026-10-28 18:23 — Tools TAKATAK — Tableau de bord unique

**Commande :** Matt, 2026-10-28 18:22 — « prépare-moi les tools » au standard LUXE TAKATAK. **Base :** Robot Notepad API Clover (2026-10-28 17:45) + passe code/repos vérifiée le 2026-10-28 18:15 (9 apps poussées sur GitHub, 3 build-outs locaux dans `~/workspace/clover-apps-code/`). **Lecture des états :** ✅ PRÊT = existe et vérifié · 🟡 SCAFFOLD = squelette en place (repo, noms de variables, structure), logique métier à bâtir · 🔨 À BÂTIR = spécifié ici, pas encore commencé · ⛔ BLOQUÉ = dépend d'une décision ou d'un tiers. Aucun secret dans ce tableau : variables nommées, jamais valuées.

**★ Correction 2026-10-28 18:30 (Matt) : « Picture Register, c'est C4ISSE »** — Picture Register (J0H36VTJBSBBP) est le **module caisse-photo de C4ISSE** : ses tools vivent à la section 2.4 (C4ISSE), ses paliers sont ceux de C4ISSE, et le repo « PICTURE-REGISTER » est **annulé** (restent ON2GO-CLOVER et TAKATAK-APP à créer). Le brouillon portail reste en place, non soumis comme app distincte.

---

# 1. OUTILS PARTAGÉS — LES 4 COLONNES DU SYSTÈME UNIQUE

| # | Tool | Rôle | Base API | État |
|---|---|---|---|---|
| S1 | **Bus d'événements webhooks TAKATAK** | Un seul consommateur de webhooks par marchand, derrière un adaptateur (changements inventaire annoncés 2026), idempotent, qui re-lit l'objet en REST puis distribue les 12 types d'événements (`A C CA E I IC IG IM O M P SH`) aux apps abonnées | #60, L16 | 🟡 SCAFFOLD — modèle foodhubca en place dans les 9 repos poussés (endpoints `/webhooks/clover` par app) ; le consommateur unique consolidé + table de distribution restent à bâtir |
| S2 | **Couche OAuth v2 + rotation des jetons** | Flux d'autorisation PKCE/high-trust, stockage chiffré des jetons par marchand, rotation automatique des refresh tokens (obligatoire Amérique du Nord depuis 2025-03-31) | #2 | 🟡 SCAFFOLD — flux documenté dans les repos (variables `CLOVER_APP_ID`, `CLOVER_APP_SECRET`, `CLOVER_REDIRECT_URL` nommées seulement) ; rotation à implémenter avant toute installation réelle |
| S3 | **CDN d'images d'articles** | Photos d'items servies par notre CDN, clé = ID d'article Clover (l'API n'expose aucune image d'item) ; alimente T4CTILE, le module caisse-photo de C4ISSE, ON2GO et les sites | L4 | 🟡 PARTIEL — pack d'images officielles Canva déposé (168 exports, Drive PPP, dossier `18eXYO8o335TiL1LktCcO1sTSduow_jEf`) ; le service CDN + la table de correspondance ID→photo restent à bâtir |
| S4 | **Registre client unique (clé = téléphone)** | Identité maître du client ancrée dans Customers Clover ; points, cartes, conversations, appels et livraisons s'y rattachent ; cloisonnement strict par marque/marchand | #42 | 🟡 SCAFFOLD — modèle de données décrit dans les packages LOY4LTY/REW4RDS ; service central à bâtir |
| S5 | **Moteur de taxes Québec** | Deux taux Clover par item taxable (TPS 5 % + TVQ 9,975 %, sans cumul) + preuves au centime en sandbox avant tout lancement | #20, L9 | 🔨 À BÂTIR — preuves sandbox à produire (pratique marchand déjà vérifiée : TPS 5 % / TVQ 9,975 %) |
| S6 | **Gabarits de fiches Marketplace** | Fiche FR/EN, légaux (confidentialité + conditions), specs vidéo (voir le pack vidéos du 2026-10-28 18:23), couvertures premium 1080×216 | #5 | ✅ PRÊT — packages `~/workspace/clover-apps/` (10 familles) + `assets-premium/` ; alignement requis avant soumission : le téléphone de soutien des packages locaux doit passer à +1 450-999-4999 (déjà corrigé dans les copies GitHub) |
| S7 | **Pipeline médias IA** | Runway (plans vidéo) · ElevenLabs (voix FR/EN) · Suno (thème musical) · OpenArt (vignettes) · Twelve Labs (QC vidéo) · Revid AI (déclinaisons courtes) — comptes TAKATAK, sessions confirmées 2026-10-26 | Registre IA v4 (Drive) | 🟡 PRÊT À PRODUIRE — pack de production complet livré ce soir ; génération à lancer en session navigateur dédiée |
| S8 | **Adaptateur canaux externes (hub)** | Ingestion des plateformes sans connecteur natif (SkipTheDishes en premier) + cadence des commandes (hold-and-fire) vers des commandes atomiques Clover | #24, #65, L5, L6 | 🟡 PARTIEL — hub Food Hub existant (en révision) ; ingestion Skip à bâtir dans le hub |

---

# 2. TOOLS PAR APPLICATION

## 2.1 TAKATAK Food Hub — 629HFYHNVMZYR — ⛔ EN RÉVISION (on ne touche à rien)
| Tool | Détail | État |
|---|---|---|
| Webhooks | `https://foodhub.on2go.ca/api/foodhub/webhooks/clover` — abonnements App, Inventory, Orders ; code de vérification présent | ✅ EN PLACE (vérifié 2026-10-28 17:39) |
| Réception plateformes | Uber Eats / DoorDash / SkipTheDishes / Too Good To Go → commandes atomiques (#24) + types par canal (#9) | ✅ EN RÉVISION |
| Impression/KDS | Événements d'impression (#27), KDS natif alimenté (#29) | ✅ EN RÉVISION |
| Synchro menu/86 | Publication du menu maître + ruptures item et modificateur (#17, #21) | 🟡 Premium/VIP — après approbation |

## 2.2 TAKATAK Phone AI — 20FK28P20HJC6 — ⛔ EN RÉVISION (on ne touche à rien)
| Tool | Détail | État |
|---|---|---|
| Webhooks | `https://foodhub.on2go.ca/api/foodhub/webhooks/clover/phone` — abonnement App ; code de vérification présent | ✅ EN PLACE (vérifié 2026-10-28 17:39) |
| Hub téléphonique maison | Fournisseur voix → commande structurée → commande atomique Clover (contournement L1, aucune API téléphonie Clover) | ✅ EN RÉVISION |
| Lien de paiement | Iframe/Hosted Checkout fr-CA (#33) envoyé par texto ; charge Ecommerce (#31) | ✅ EN RÉVISION |

## 2.3 4CCOUNTING — VQTZE8C31D8MW — repo GitHub poussé (commit 0dd1d919)
| Tool | Détail | État |
|---|---|---|
| Extracteur de rapports | Orders/Payments paginés par plages de dates (règle 90 jours, #30, L17) | 🟡 SCAFFOLD repo — logique à bâtir |
| Ventilation TPS/TVQ | Rapport de fin de journée par taux (#20) | 🔨 À BÂTIR (dépend de S5) |
| Rapprochement versements | Écarts ventes vs versements + événements de caisse (#47, #67) | 🔨 À BÂTIR |
| Passif cartes-cadeaux | Flux REW4RDS → écritures de passif | 🔨 À BÂTIR (dépend de REW4RDS) |
| Webhooks | `P`, `O`, `CA` via le bus S1 | 🟡 SCAFFOLD |

## 2.4 C4ISSE — VDV7XAH5TPB78 — repo GitHub poussé (commit 845cfeda)
| Tool | Détail | État |
|---|---|---|
| App Android comptoir | Connecteurs SDK (#48) + Android Payments API (#49) | 🟡 SCAFFOLD — build natif Kotlin à produire (L20) |
| Recherche client téléphone | Customers (#42) au comptoir | 🟡 SCAFFOLD |
| Tenders maison | Carte-cadeau REW4RDS + compte client (#39) | 🔨 À BÂTIR |
| Contrôle gérant | NIP vérifié contre les dossiers employés (#45), journalisé (L12) | 🔨 À BÂTIR |
| Tiroir + impression | `openCashDrawer()` (#56), impression (#55) | 🟡 SCAFFOLD SDK |
| **Module caisse-photo** (ex-« Picture Register » `J0H36VTJBSBBP` — fusionné dans C4ISSE le 2026-10-28, correction de Matt : pas une app distincte) | Grille photo par catégorie : items + catégories (#12, #13) alimentés par le CDN S3 ; panier + paiement Android Payments (#49), impression (#55) — features des paliers Premium/VIP de C4ISSE | 🟡 SCAFFOLD — build-out local `~/workspace/clover-apps-code/picture-register/` (9 fichiers) conservé comme source du module |
| Module caisse-photo — synchro photo automatique | Webhook `I` via S1 : la photo suit l'item (borne T4CTILE, ON2GO, sites) — palier VIP de C4ISSE | 🔨 À BÂTIR |
| Module caisse-photo — mode formation | Photos + noms FR/EN affichés — palier VIP de C4ISSE | 🔨 À BÂTIR |

## 2.5 CH4T — RGE4PFGC9SR7C — repo GitHub poussé (commit 250e101f) — **SPEC ONLY**
| Tool | Détail | État |
|---|---|---|
| Fil de soutien par client | Client reconnu par téléphone (#42), dernière commande visible (#23) | 🟡 SCAFFOLD spec |
| Modèles de réponses humaines | Gabarits FR/EN approuvés, base de connaissances GitHub par client | 🔨 À BÂTIR |
| Notifications d'état | Webhooks `O` via S1 → message au client | 🔨 À BÂTIR |
| Réponses IA | **FERMÉES** — aucune activation sans l'exception de Pierre (décision consignée) | ⛔ BLOQUÉ par décision |

## 2.6 LOY4LTY — WX0Y6313JX1TY — repo GitHub poussé (commit 9be8c73e)
| Tool | Détail | État |
|---|---|---|
| Registre de points maison | Clé téléphone (#42), crédit après paiement confirmé (webhooks `P`/`O`) — contournement L2 | 🟡 SCAFFOLD — service à bâtir sur S4 |
| Échange en rabais | Rabais appliqué à la commande avant paiement (Write orders, #23) | 🟡 SCAFFOLD |
| Saisie pendant le paiement | `registerForCustomerProvidedData` sur l'appareil (#43) | 🔨 À BÂTIR |
| Transaction sandbox complétée | Pré-requis de finition PPP (fidélité de démonstration) | 🔨 À FAIRE en sandbox |
| Règles du programme | Défaut décidé : 1 point par dollar ; seuil/valeur/expiration configurables | ✅ DÉCIDÉ (package `loyalty/`) |

## 2.7 M4RKETING — EQRZ028619JRW — repo GitHub poussé (commit 71efdd7e)
| Tool | Détail | État |
|---|---|---|
| Gestion des rabais | Rabais personnalisés dans l'inventaire (#19) | 🟡 SCAFFOLD |
| Segments clients | Nouveaux/récents/inactifs depuis Customers (#42) | 🔨 À BÂTIR |
| Déclencheurs d'événements | Webhooks `C`/`O` via S1 (premier achat, inactivité, anniversaire) | 🔨 À BÂTIR |
| Mesure de campagnes | Commandes et paiements rattachés à l'offre (#23, #30) | 🔨 À BÂTIR |

## 2.8 ON2GO — N4NYCJCZ17FF4 — build-out local `~/workspace/clover-apps-code/on2go/` (15 fichiers) — repo à créer : **ON2GO-CLOVER**
| Tool | Détail | État |
|---|---|---|
| Générateur de fiche publique | Profil marchand (#8) + heures (#11) + articles publics (#12, #13) | 🟡 SCAFFOLD local complet |
| Synchro disponibilité | Articles épuisés retirés (#21, webhook `I` via S1) | 🔨 À BÂTIR |
| Commande directe | Lien Online Ordering natif (#28) ; parcours intégré Food Hub au VIP (#24) | 🟡 SCAFFOLD |
| Contrat public | Lecture seule, aucune donnée commande/client/paiement exposée | ✅ DÉCIDÉ (package `on2go/`) |

## 2.9 REW4RDS — 239362NZSVFSC — repo GitHub « REW4RD » poussé (commit 391287c2)
| Tool | Détail | État |
|---|---|---|
| Registre de cartes de groupe | Multi-succursales, règles Québec par défaut : **aucune expiration, aucuns frais** (contournement L14) | 🟡 SCAFFOLD — service à bâtir sur S4 |
| Vente au comptoir | Carte vendue comme ligne d'une commande Clover (#23), activation à la vente | 🟡 SCAFFOLD |
| Échange en tender | Tender personnalisé (#39), partiel accepté ; scan code/QR (#57) | 🔨 À BÂTIR |
| Vente web | Ecommerce : charge (#31) + iframe fr-CA (#33), la vente devient une commande Clover | 🔨 À BÂTIR |
| Option API Clover Gift Cards | Pour marchands inscrits aux plans Clover Gift Cards (#37) | 🔨 OPTION documentée |

## 2.10 ST4FF — E0BGTY752BZYE — repo GitHub poussé (commit aa69aaab)
| Tool | Détail | État |
|---|---|---|
| Synchro employés/rôles | Employees API (#45) | 🟡 SCAFFOLD |
| Pointeuse | Quarts Clover (#46) comme vérité de présence | 🟡 SCAFFOLD |
| Coût de main-d'œuvre | Quarts × ventes par quart (#23, #30) → flux 4CCOUNTING | 🔨 À BÂTIR |
| Messages d'équipe | Notifications sur les appareils (#58, sans Firebase — L20) | 🔨 À BÂTIR |
| Alertes | Webhooks `E` via S1 (retard, quart non fermé) | 🔨 À BÂTIR |

## 2.11 T4CTILE — SFH7X57N3B5FJ — repo GitHub poussé (commit 80b82635)
| Tool | Détail | État |
|---|---|---|
| Prototype borne | `~/workspace/kiosque-tactile/` (README + ARCHITECTURE) | ✅ PROTOTYPE en place |
| Mode kiosque | Plein écran `CustomerMode`, démarrage auto `BOOT_COMPLETED`, déverrouillage `Lockscreen` (#54) | 🟡 SCAFFOLD |
| Photos grand format | CDN S3, clé = ID d'article (L4) | 🟡 PARTIEL (dépend de S3) |
| Paiement borne | `KioskPayRequestIntentBuilder` sur le Mini associé (#49, #54) | 🟡 SCAFFOLD |
| Fidélité + carte-cadeau à la borne | Téléphone LOY4LTY (#42), scan REW4RDS (#57) | 🔨 À BÂTIR |

## 2.12 TAKATAK — F4TMP23FM7K5M — build-out local `~/workspace/clover-apps-code/takatak-app/` (15 fichiers) — repo à créer : **TAKATAK-APP**
| Tool | Détail | État |
|---|---|---|
| Connecteur Clover lecture | Merchant/Inventory/Orders/Payments en lecture vers l'espace de la marque | 🟡 SCAFFOLD local complet |
| Espaces par marque | Cloisonnement strict des données (règle du dashboard) | 🟡 SCAFFOLD |
| Plan de contrôle des apps | État des installations/abonnements via webhooks `A` (#60, #64) | 🔨 À BÂTIR |
| Alertes d'écarts | Commandes sans paiement, données périmées, compte non relié | 🔨 À BÂTIR |

## 2.13 TR4CKER — EB2EPCWEJBZ82 — repo GitHub poussé (commit f92ca067)
| Tool | Détail | État |
|---|---|---|
| Suivi livreur en direct | Position rattachée à la commande Clover (#23), statuts par webhooks `O` | 🟡 SCAFFOLD |
| Page post-livraison | « Ajoute un pourboire + avis » ; bon avis → Google, mauvais → interne (composant d'avis TAKATAK existant) | 🟡 SCAFFOLD |
| Pourboire après livraison | Lien Ecommerce « payer une commande » (#31, #36) | 🔨 À BÂTIR |
| Paiement à la porte (VIP) | REST Pay Display (#52) vers un Flex du magasin ; Clover Go seulement si le Canada est confirmé par écrit (L18) | ⛔ EN ATTENTE de confirmation DevRel |
| Ventilation pourboires | Flux automatique vers 4CCOUNTING | 🔨 À BÂTIR |

## 2.14 MEV.QUEBEC — aucun App ID production (rappel)
Package local complet (`~/workspace/clover-apps/mev-quebec/`), code SEV dans le dépôt takatakca/QCMEV.CA. **Étape 0 = décision de certification Revenu Québec** (Matt) ; ensuite seulement : créer l'app au portail ou rattacher à 4CCOUNTING/C4ISSE. Aucun usage fiscal avant certification. État : ⛔ DÉCISION À VENIR.

---

# 3. PROCHAINES ACTIONS TOOLS (ordre de valeur)

1. **S1 + S2** — consolider le bus de webhooks unique et la rotation OAuth v2 : tout le reste en dépend.
2. **S5** — preuves de taxes au centime en sandbox (débloque 4CCOUNTING et toute vente réelle).
3. **S3** — service CDN d'images branché sur le pack Canva officiel (débloque T4CTILE, le module caisse-photo de C4ISSE, ON2GO).
4. **Créer les 2 repos manquants** (ON2GO-CLOVER, TAKATAK-APP) — geste Pierre/Matt (le 403 de création est connu). Le repo PICTURE-REGISTER est annulé (correction du 2026-10-28 18:30 : Picture Register = module de C4ISSE).
5. **S7** — lancer la production des 12 films du pack vidéos (session navigateur dédiée).
6. **Transaction sandbox LOY4LTY complétée** (pré-requis de finition PPP) puis ouverture des ventes.

*Tableau vivant — à mettre à jour à chaque changement d'état, avec dépôt Drive + GitHub à l'instant (règle nº 1). Préparé le 2026-10-28 18:23, standard LUXE TAKATAK.*
