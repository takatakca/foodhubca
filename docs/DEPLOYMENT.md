# FOODHUB / ON2GO Hub — déploiement prouvable

## Interface d'onglets — changement non déployé du 2026-10-16

La branche `fix/console-tabs-keyboard-20261016` modifie uniquement la navigation clavier des onglets de la console et des tests unitaires ; aucun API, fournisseur, secret, base ou commande. Contrôler CI et image Docker avant revue et fusion propriétaire. Aucune publication Coolify n'a été déclenchée depuis cette branche. Ne pas considérer un build d'image ou une ancienne Action de déploiement `skipped` comme preuve de livraison ; comparer ensuite le SHA exact avec `/api/release`.


Environnement : Contabo VPS + Coolify, domaine canonique `https://foodhub.on2go.ca`, application Next.js sur port 3000. Depuis la reprise autorisée du 2026-10-15, la livraison retenue est le **GitHub App natif Coolify**, avec construction du `Dockerfile` sur Contabo. Le contrôleur Actions historique est désactivé pour éviter deux auteurs de production.
Lire aussi `docs/RELEASE_GHCR_COOLIFY.md` et [issue #46](https://github.com/takatakca/foodhubca/issues/46).

## 1. Préparer sans toucher aux commandes actives

1. Conserver l'instance qui traite actuellement les commandes ; relever la ressource Coolify, sa révision **réellement active**, ses domaines, volumes, log et politique de rollback, sans valeurs de secret.
2. Effectuer une sauvegarde de la base et des médias `/app/data/media` ; vérifier comment restaurer. Ne pas créer une seconde instance recevant les mêmes webhooks ou tâches planifiées.
3. Valider que l'image GitHub a été construite et publiée pour le SHA cible ; utiliser une image **épinglée** pour une preview sans connecteurs live. Le passage à `:main` auto-mutable n'est permis qu'après preview/rollback vérifiés.
4. Garder `SESSION_SECRET` stable et `LIVE_CONNECTORS_GLOBAL_ENABLED=false` pour la preview ; isoler sandbox et prod.

## 2. DNS, HTTPS, Coolify

- Dernier plan réseau noté dans `WORKLOG.md` : adresse IPv4 cible `31.220.96.134`, IPv6 `2605:a144:2362:1936::1`. **Ces valeurs historiques doivent être confirmées sur le serveur et la ressource Coolify avant toute modification DNS**. Vérifier les A/AAAA de `foodhub`, la configuration DNS pertinente de `www` et le certificat HTTPS.
- Le domaine de webhook `foodhub.on2go.ca` ne doit pas changer sans migration séquentielle de chaque fournisseur. `hub.on2go.ca` est une option de marque, pas un remplacement brutal des callbacks.
- Dans Coolify, vérifier service, conteneur, port 3000, volume média persistant, base Supabase Montréal, proxy, logs et réponse `/api/health` **200** (un 503 en production n'est pas une réussite).
- Tester ensuite `/api/release` et comparer le SHA complet à celui de l'image : HTTP 200 seul ne prouve pas la version.

## 3. GitHub → Coolify — contrôleur unique

Le propriétaire a explicitement demandé l'activation complète le 2026-10-15. Réutiliser l'application existante `1ijktzayh4dbcnn37igo8ktv`, dépôt `takatakca/foodhubca`, branche `main`, commit `HEAD`, Dockerfile `/Dockerfile`, port 3000. La source est maintenant liée au GitHub App déjà installé `g-r-o-u-p-e-t-a-k-a-t-a-k-github`, avec « Deploy on push (webhooks) » activé. Ne pas créer un deuxième consommateur de commandes.

Dans Advanced, garder les arguments gérés dans Dockerfile et `SOURCE_COMMIT` disponible pendant le build. Le Dockerfile refuse un SHA absent, exécute audit de production, typecheck/lint/tests unitaires, build, E2E simulé puis un démarrage de l'image finale après `npm prune`. Les commandes de test/build utilisent un environnement vidé : aucune clé de production ni commande réelle. Un échec empêche la publication. La facturation GitHub Actions est actuellement bloquée ; les mêmes contrôles s'exécutent sur Contabo. Les workflows CI/image restent utiles quand les runners sont disponibles, mais ne pilotent plus la production.

Le Docker HEALTHCHECK vérifie SHA, santé avec base `ok`, annuaire/CORS, login et refus des commandes anonymes. **Coolify 4.4.6 sur ce serveur remplace effectivement le HEALTHCHECK de l'image par celui de l'interface** : choisir « Container command » et `node /app/scripts/check-runtime.mjs`, intervalle 30 s, timeout 90 s, 3 essais, démarrage 60 s. Le contrôle HTTP générique a échoué le 2026-10-15 car `curl` et `wget` ne sont pas dans l'image. Le premier build Webhook `e7ce788a9432618ee93eb9ce3d6a6be7c64b3ca6` a réussi tous les contrôles (807 tests unitaires, 536 E2E et probe final) ; la commande Coolify explicite corrige ce blocage de readiness sans affaiblir les contrôles. Une réponse 503 est autorisée uniquement par le probe local isolé de construction, jamais en production. Une livraison n'est prouvée qu'après historique **Webhook / Success**, conteneur sain et vérificateur HTTPS au SHA de `main`.

Sauvegarde préalable sur le serveur, répertoire privé `/home/takatak/foodhub-deployment-backups/20261015-before-auto` : inspection de configuration privée et archive média validée. Image de rollback conservée sous `foodhub-rollback:20261015-before-auto`. Volume conservé : `1ijktzayh4dbcnn37igo8ktv-foodhub-media` → `/app/data/media`. Supabase et secrets de session restent existants ; aucune migration SQL ni nouvelle sauvegarde complète Supabase n'a été réalisée par cette reprise. Ne jamais afficher l'inspection privée ni la placer dans Git.

## 4. Vérification en lecture seule

Sur un checkout contenant le script :

```bash
npm ci
npm run verify:live -- --url https://foodhub.on2go.ca/ --sha FULL_40_CHARACTER_DEPLOYED_COMMIT_SHA
```

Le script vérifie le SHA Git de `/api/release`, l'annuaire public avec CORS ON2GO, `/api/health` = 200, `/login` = 200 et **401** sur `/api/foodhub/orders` sans authentification. Il retourne un code d'échec en cas de différence. Aucune clé n'est nécessaire et aucun POST ni action marchand n'est effectué. Comparer le SHA à l'image effectivement choisie, pas simplement au dernier commit de la branche locale.

La CI d'image accepte volontairement `/api/health` 503 lorsque la base est absente dans un conteneur de test ; **la production doit répondre 200**. Les tests simulés et `verify:live` ne remplacent pas un vrai test de commande.

## 5. Contrôles fonctionnels et rollback

Faire valider, avec une personne habilitée : sign-in OTP, PIN gérant/tablette, commandes webhook signées, anti-doublons et réessais Clover, caisse/imprimante/KDS, menus/86/horaires, annulations, gestion de panne, suivi des livraisons, numéro Twilio, rapport de rapprochement et fonctionnement FR/EN sur mobile. Un fournisseur à la fois, en sandbox d'abord.

Ne jamais activer l'acceptation automatisée si Clover n'a pas confirmé la réception. Maintenir les tablettes fournisseur de secours jusqu'à certification. En cas d'échec de release/health ou de traitement de commandes, restaurer **la version et les données réellement sauvegardées**, en assurant l'absence de doubles webhooks/cron. Inscrire timestamp + SHA + résultat PASS/FAIL/BLOCKED + preuve dans [issue #46](https://github.com/takatakca/foodhubca/issues/46).
