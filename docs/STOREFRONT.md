# Commander direct (ON2GO storefront)

Une page de commande **sans commission** par marque, à `https://<FOODHUB_PUBLIC_URL>/commander/<adresse>`.
Français d’abord, anglais avec `?lang=en`. **Pour emporter seulement** dans cette version.
A commission-free ordering page per brand at `/commander/<slug>`. French first, English with `?lang=en`. Pickup only in v1.

## Ce que fait la page · What it does

- Menu de la marque à sa cuisine : ruptures (86) cachées, alcool jamais offert en ligne, catégories hors horaire
  grisées (« dès 7 h »), prix du restaurant (prix de base Food Hub + options).
- Ouvert / fermé à partir des heures de Food Hub (Réglages → Heures, congés compris, soirées après minuit gérées).
  « En pause » quand **tous** les magasins des plateformes de la marque à cette cuisine sont en pause. Les magasins
  « Ne pas toucher » et le magasin protégé du propriétaire ne comptent jamais.
- Panier vérifié et **recalculé sur le serveur** (les prix envoyés par le navigateur sont ignorés), choix min / max,
  Duo / Trio / Combo proposés une fois après l’ajout, jamais présélectionnés.
- La commande entre dans le pipeline existant des commandes directes comme une commande **site web** (`source
  'website'`, `sourceRef 'sf_…'`) : billet Clover et écran cuisine comme aujourd’hui.
- Paiement : en ligne par le lien Clover Hosted Checkout (`/p/<jeton>`, ouvert dans le navigateur : le lien, le rappel
  et l’expiration ne sont jamais textés ; une fois payée, la confirmation avec l’heure prévue est textée comme pour toute
  commande payée), ou au comptoir. Si le lien ne peut pas être créé, la commande retenue est annulée sans texto et le client choisit lui-même
  « payer au comptoir » (jamais de changement silencieux).
- Page de suivi `/commander/<adresse>/suivi/<jeton>` : numéro, état, marque, heure prévue. Aucune donnée personnelle.
  Valide 7 jours, seulement sous la page de la marque de la commande. Non indexée, mise à jour toutes les 15 s.
- SEO : titre, description, adresse canonique, alternatives fr / en, OpenGraph, JSON-LD (Restaurant + Menu +
  OrderAction), `/commander/sitemap.xml` (pages en ligne seulement).
- Garde-fous · Safeguards :
  - 5 commandes / 10 min par adresse IP, 3 / 30 min par téléphone (vérifié et réservé en une seule étape : des requêtes
    envoyées en même temps ne passent pas toutes) ;
  - téléphones du Canada et des États-Unis seulement (+1, indicatif réel ; jamais un numéro international, des Caraïbes
    ou 900) : la page texte ce numéro ;
  - paiement au comptoir : 25 articles au plus, total maximum par marque (150 $ taxes incluses par défaut, réglable),
    40 commandes / heure par page et 120 / heure pour tout le serveur ; au-delà, le client paie en ligne ;
  - dernière commande : refusée quand la cuisine ferme avant la fin du temps de préparation ;
  - un plat sans prix (0 $ ou vide) n’est pas affiché ;
  - même origine seulement (JSON obligatoire, `Origin` / `Sec-Fetch-Site` vérifiés), 32 Ko max (lu en flux), champ
    piège anti-robot.

## Étapes du propriétaire · Owner steps

1. **Heures** : Réglages → Heures. Sans heures, la page affiche « fermé » (jamais « toujours ouvert »).
2. **Paiement en ligne (facultatif)** : sur le serveur (Coolify), `CLOVER_ECOMM_PRIVATE_KEY` ou `CLOVER_ECOMM_KEYS`
   pour le marchand Clover de la cuisine, et `FOODHUB_PUBLIC_URL` en https (déjà en place). La ligne « Paiement en
   ligne prêt » de la page de réglages le confirme. Sans clé : paiement au comptoir seulement.
3. **Adresse IP réelle** : derrière le proxy de Coolify (Traefik), `FOODHUB_TRUST_PROXY=true` pour que la limite par
   adresse vise chaque client (sinon tous partagent une limite plus large ; les limites par téléphone, par page et par
   serveur s’appliquent toujours ; la page de réglages l’affiche).
   - En-tête lu : la **première** valeur de `X-Forwarded-For` (`lib/foodhub/session.ts` `clientIp`). Ce n’est sûr que
     si Traefik est le seul point d’entrée et **remplace** l’en-tête reçu du client (pas de `forwardedHeaders.insecure`,
     pas de `trustedIPs` ouverts à tous).
   - Si Cloudflare (proxy orange) est devant Traefik : la première valeur est l’adresse du client seulement si Traefik
     fait confiance aux adresses de Cloudflare (`forwardedHeaders.trustedIPs` = plages Cloudflare). Sinon, laissez
     `FOODHUB_TRUST_PROXY` éteint : la limite par adresse devient partagée, les autres garde-fous tiennent.
4. **Allumer** : ouvrez `/settings/storefront` (adresse directe). Interrupteur général, puis chaque marque : adresse
   (`/commander/pi-pita`…), cuisine de cueillette, paiement en ligne et / ou au comptoir. Enregistrez.
   `FOODHUB_FEATURE_STOREFRONT=on|off` sur le serveur l’emporte sur l’interrupteur.
5. **Google** (Profil d’entreprise de chaque marque → Modifier le profil) :
   - Site Web : `https://<public>/commander/<adresse>?src=google`
   - Lien du menu : la même adresse
   - Liens de commande → Commander à l’avance / Pour emporter : la même adresse, comme lien préféré
   - Search Console : soumettez `https://<public>/commander/sitemap.xml`
6. **Code QR** : section « Trousse de partage » : aperçu, numéro de table facultatif, téléchargement SVG. Le code
   mène à `/commander/<adresse>?src=qr` (`&table=12` pour une table).
7. **Bouton pour un site** : la trousse donne un lien HTML simple « Commander » à coller (pas de script, pas d’iframe).
8. **Suivi des sources** : « Commandes par source (7 derniers jours) » compte `google`, `instagram`, `facebook`,
   `site`, `qr`, `table-N` et `direct`, lus sur les commandes elles-mêmes (payées au comptoir ou payées en ligne ; les
   commandes retenues non payées ou annulées ne comptent pas).

## Pas dans la v1 · Not in v1 (follow-ups)

Livraison (devis des flottes), alcool, codes promo, widget intégrable. Un lien vers la page dans le menu des réglages
et dans l’annuaire public sera ajouté par les branches qui possèdent ces fichiers.

## Fichiers · Files

`lib/foodhub/storefront/*` (settings, catalog, cart, checkout, rate-limit, seo, qr, i18n), `app/commander/*`,
`app/api/storefront/*` (public), `app/api/foodhub/storefront/settings` (connecté), `app/(console)/settings/storefront`.
Ajouts : `proxy.ts` (une ligne publique), `delivery/paylink.ts` (`notify: 'none'`, `needSms: false`).
