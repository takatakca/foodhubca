# ON2GO Hub Desktop

Client opérateur indépendant pour ouvrir la console Food Hub, passer aux commandes, à la cuisine ou aux réglages depuis le menu et reprendre après une perte réseau. La première cible retenue est Windows x64.

## Démarrer

```sh
npm ci
npm test
npm start
npm run package:windows
```

La commande produit un dossier portable dans `dist/ON2GO-Hub-win32-x64`. Décompresser le dossier entier avant d’ouvrir `ON2GO-Hub.exe`. Sur un poste Windows, valider le lancement, une connexion de test, les menus, la reprise réseau et la fermeture. Le paquet de développement est non signé.

La fenêtre conserve une session isolée et charge l’origine HTTPS Food Hub. Les principaux changements d’origine, fenêtres secondaires, WebViews ajoutées par la page et permissions navigateur sont bloqués. Le menu propose l’ouverture volontaire du site dans le navigateur système. Les parcours externes de connexion et d’installation marketplace exigent une validation avec leurs fournisseurs et une stratégie d’authentification desktop avant publication.

Les étapes de publication restent la signature, l’installateur ou format Store, la vérification sur Windows et les essais marchands délimités par le dossier de certification. Suivi dans [la liste maîtresse](https://github.com/takatakca/foodhubca/issues/155).
