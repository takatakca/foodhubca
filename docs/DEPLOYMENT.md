# FOODHUB / ON2GO Hub — déploiement prouvable

Environnement visé **documenté, pas automatiquement présumé actif** : Contabo VPS + Coolify, image `ghcr.io/takatakca/foodhubca`, domaine canonique des webhooks `https://foodhub.on2go.ca`, application Next.js sur port 3000.
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

## 3. GitHub Actions — activation sécurisée

`.github/workflows/image.yml` construit/publie les images. `.github/workflows/coolify-deploy.yml` n'effectue le déploiement qu'après la publication réussie d'une image sur `main`, avec l'opt-in explicitement activé.

Variables du dépôt (`Settings → Secrets and variables → Actions → Variables`) :
- `FOODHUB_COOLIFY_AUTODEPLOY_ENABLED=true` (uniquement après validation de la bascule)
- `FOODHUB_COOLIFY_RESOURCE_UUID=1ijktzayh4dbcnn37igo8ktv` (identifiant documenté : **confirmer dans Coolify**)
- `FOODHUB_HTTPS_URL=https://foodhub.on2go.ca/`

Secrets (UI GitHub uniquement, jamais fichiers/PR/chat) :
- `FOODHUB_COOLIFY_DEPLOY_WEBHOOK`
- `FOODHUB_COOLIFY_DEPLOY_TOKEN`

Le webhook doit pointer sur la ressource attendue de `https://coolify.takatak.ca/api/v1/deploy`, autorisée via token au minimum de privilèges. **Une réponse acceptée par Coolify = demande en file ; pas une preuve d'application live**. Ne pas activer l'opt-in tant que le propriétaire n'a pas approuvé le cutover.

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
