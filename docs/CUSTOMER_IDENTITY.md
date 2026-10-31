# Comptes clients des sites des marques / Customer identity for the brand websites

*(English below.)*

## Ce que ça fait

Food Hub est **le seul registre des clients** des sites des marques TAKATAK (pppmtl.com en premier). Le site ne garde
aucune base de clients : il demande à Food Hub de texter un code au cellulaire, Food Hub vérifie le code, **crée le
compte la première fois** (un compte = un cellulaire vérifié) et remet au site un jeton signé que le site garde dans un
cookie `httpOnly`. Avec ce jeton, le site lit et modifie le compte : profil, adresses, favoris, dernières commandes
passées sur le site, et — plus tard — points de fidélité (LOY4LTY) et cartes-cadeaux (REW4RDS), qui utiliseront la même
clé : le cellulaire vérifié.

- **Aucun mot de passe.** Le code texto est la seule preuve ; il vaut 10 minutes, 5 essais, puis il faut en redemander un.
- **Les codes ne sont jamais écrits dans un journal, jamais renvoyés par une API, jamais gardés en clair** (empreinte
  HMAC avec le secret de session, ou gardés par Twilio Verify). La boîte d’envoi des messages ne garde pas le texte.
- **Limites** : 3 demandes de code par numéro par 10 minutes (survit à un redémarrage), 60 par site par minute, et une
  minute de blocage après 5 codes faux (même garde que la console).
- **Vie privée (Loi 25)** : on garde seulement cellulaire, nom, courriel, langue, consentement infolettre, adresses et
  favoris. Chaque création, vérification et suppression est dans le journal (cellulaire masqué). Le client peut
  **supprimer son compte** : la fiche est anonymisée (cellulaire, nom, courriel, adresses, favoris, consentement
  effacés ; l’identifiant et les dates restent pour l’historique des commandes), et tous ses jetons cessent de marcher.
- **Réglages → Clients** (lecture seule) : nombre de comptes, les 20 derniers (numéro masqué), si l’envoi de codes est
  prêt, et le journal. Le client gère lui-même son compte sur le site.

## Variables d’environnement

| Variable | Rôle |
| --- | --- |
| `FOODHUB_WEBSITE_ORDER_SECRET` | Déjà là : le secret serveur-à-serveur du site (commandes). Les routes clients l’exigent en `Authorization: Bearer` (401 sinon). Le navigateur ne le voit jamais. |
| `TWILIO_VERIFY_SERVICE_SID` | Optionnel : un service Twilio Verify (`VA…`). Twilio fabrique, texte et vérifie le code avec `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`. Vide = Food Hub texte son propre code à 6 chiffres par `TWILIO_FROM` ou le service de messagerie. |
| `TWILIO_VERIFY_ACCOUNT_SID` / `TWILIO_VERIFY_AUTH_TOKEN` | Optionnels : le compte Twilio qui possède le service Verify, quand ce n'est pas le compte avec lequel Food Hub texte (ex. le compte du numéro unique des marques). Vides = `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`. |
| `FOODHUB_CUSTOMER_TENANTS` | Sites autorisés (slugs, virgules). Vide = `pppmtl`. Nom affiché dans le texto : `pppmtl` → « PPP Pizzeria ». |
| `SESSION_SECRET` | Déjà là : signe les jetons clients (même clé HMAC que les cookies de la console). |
| `FOODHUB_LOYALTY_URL`, `FOODHUB_GIFTCARDS_URL` | Futurs LOY4LTY / REW4RDS : lus seulement pour l’afficher dans la console. Rien n’est appelé ; l’API répond « pas branché ». |

## Comment pppmtl l’appelle (contrat du 2026-10-29, § A)

Toujours `Authorization: Bearer <FOODHUB_WEBSITE_ORDER_SECRET>` depuis le serveur du site ; les erreurs sont du JSON
`{ ok:false, error }` avec le bon statut (401 jeton client invalide ou expiré, 403 mauvais site, 429 trop de demandes
avec `retryAfterS` et `Retry-After`).

1. `POST /api/foodhub/customers/verify/start` `{ tenant: "pppmtl", phone: "514 555 1234" | "+15145551234", lang?: "fr"|"en" }`
   → `200 { ok:true, expiresInS: 600, channel: "sms" }` · `429 { retryAfterS }` · `422` numéro invalide · `403` site inconnu · `503` texto impossible.
   Texto envoyé : « Votre code PPP Pizzeria : 123456 (valide 10 min). Ne le partagez pas. » — jamais de lien.
2. `POST /api/foodhub/customers/verify/check` `{ tenant, phone, code }`
   → `200 { ok:true, token, expiresAt, customer: { id, phone (E.164), name?, email?, lang, marketingConsent, createdAt, verifiedAt }, created }`.
   Mauvais code → `401 { attemptsLeft }` ; au 5ᵉ, ou expiré → `410` (redemander un code).
3. `GET /api/foodhub/customers/me` en-têtes Bearer + `X-Customer-Token` (et, si le site veut, `X-Customer-Tenant` : un jeton d’un
   autre site est alors refusé 403) → `{ ok, customer, addresses, favourites, loyalty, giftCards, orders }`.
   `orders` = les commandes **site web** de ce cellulaire, plus récentes d’abord, 20 au plus : `{ id, number, at, total, status, brand, fulfillment }`.
   `loyalty` / `giftCards` répondent aujourd’hui `{ connected:false, reason: "LOY4LTY not connected yet" }` / `"REW4RDS not connected yet"`.
4. `PATCH /api/foodhub/customers/me` `{ name?, email?, lang?, marketingConsent? }` → `{ ok, customer }` (`null` efface nom ou courriel ; `422` si invalide).
5. `PUT /api/foodhub/customers/me/addresses` `{ addresses: [{ label?, street, unit?, city, province?, postalCode, instructions? }] }` (5 max, code postal canadien) → `{ ok, addresses }`.
6. `PUT /api/foodhub/customers/me/favourites` `{ favourites: ["<ref>"] }` (50 max) → `{ ok, favourites }`.
7. `POST /api/foodhub/customers/me/logout` → `{ ok }` : tous les jetons du client sont annulés.
8. `DELETE /api/foodhub/customers/me` → `{ ok, deleted: true }` : fiche anonymisée (Loi 25).

Jeton : `cust.<id client>.<site>.<expiration unix>.<version>.<hmac-sha256 base64url>`, 30 jours, signé avec le secret de
session. La version est comparée à la fiche à chaque appel : déconnexion ou suppression = tous les jetons morts.
Côté commande, `lib/foodhub/customers/token.ts › resolveCustomerToken(token, { tenant })` rend la fiche du client vivante
derrière un jeton (c’est ce que l’entrée des commandes du site utilise pour lier la commande au compte).

## Étapes pour le propriétaire

1. Rien à faire pour un premier essai : les clés Twilio déjà en production suffisent (Food Hub texte son propre code).
2. Pour passer par Twilio Verify (modèles de texto approuvés, codes gérés par Twilio) : créer un service Verify dans
   Twilio, mettre son SID dans `TWILIO_VERIFY_SERVICE_SID` du service Food Hub (Coolify), déployer.
3. Un nouveau site de marque : ajouter son slug à `FOODHUB_CUSTOMER_TENANTS` (ex. `pppmtl,gateau`) et son nom
   d’affichage dans `CUSTOMER_TENANT_NAMES` (`lib/foodhub/customers/types.ts`), déployer.

---

## What it does (English)

Food Hub is **the only customer store** of the TAKATAK brand websites (pppmtl.com first). The website keeps no
customer database: it asks Food Hub to text a code to the cell number, Food Hub checks it, **creates the account the
first time** (one account = one verified cell number) and hands the site a signed token the site keeps in an
`httpOnly` cookie. With that token the site reads and updates the account: profile, addresses, favourites, the recent
website orders, and — later — loyalty points (LOY4LTY) and gift cards (REW4RDS), which will key on the same verified
number.

- **No password.** The texted code is the only proof: 10 minutes, 5 tries, then ask for a new one.
- **Codes are never logged, never returned by any API, never stored in clear** (HMAC with the session secret, or held
  by Twilio Verify). The message outbox keeps no preview of them.
- **Limits**: 3 code requests per number per 10 minutes (survives a restart), 60 per website per minute, one minute
  locked after 5 wrong codes (the console's own guard).
- **Privacy (Québec Law 25)**: only cell, name, e-mail, language, newsletter consent, addresses and favourites are
  kept. Every creation, verification and deletion goes to the activity log (number masked). A customer can **delete
  their account**: the record is anonymised (cell, name, e-mail, addresses, favourites, consent removed; the id and
  dates stay for order history) and every token stops working.
- **Settings → Customers** (read-only): count, the last 20 (number masked), whether codes can be texted, the log.
  Customers manage their own account on the website.

## Environment variables

| Variable | Role |
| --- | --- |
| `FOODHUB_WEBSITE_ORDER_SECRET` | Already there: the website's server-to-server secret (orders). Every customer route requires it as `Authorization: Bearer` (401 otherwise). The browser never sees it. |
| `TWILIO_VERIFY_SERVICE_SID` | Optional: a Twilio Verify service (`VA…`). Twilio makes, texts and checks the code with `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`. Empty = Food Hub texts its own 6-digit code through `TWILIO_FROM` or the messaging service. |
| `TWILIO_VERIFY_ACCOUNT_SID` / `TWILIO_VERIFY_AUTH_TOKEN` | Optional: the Twilio account that owns the Verify service when it is not the account Food Hub texts from (e.g. the brands' single-number account). Empty = `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`. |
| `FOODHUB_CUSTOMER_TENANTS` | Allowed websites (slugs, comma-separated). Empty = `pppmtl`. Display name in the text: `pppmtl` → "PPP Pizzeria". |
| `SESSION_SECRET` | Already there: signs the customer tokens (the same HMAC key as the console cookies). |
| `FOODHUB_LOYALTY_URL`, `FOODHUB_GIFTCARDS_URL` | Future LOY4LTY / REW4RDS: read only to show it in the console. Nothing is called; the API answers "not connected yet". |

## How pppmtl calls it (contract of 2026-10-29, § A)

Always `Authorization: Bearer <FOODHUB_WEBSITE_ORDER_SECRET>` from the website's server; errors are JSON
`{ ok:false, error }` with the right status (401 bad or expired customer token, 403 wrong website, 429 too many requests
with `retryAfterS` and a `Retry-After` header).

1. `POST /api/foodhub/customers/verify/start` `{ tenant: "pppmtl", phone: "514 555 1234" | "+15145551234", lang?: "fr"|"en" }`
   → `200 { ok:true, expiresInS: 600, channel: "sms" }` · `429 { retryAfterS }` · `422` bad number · `403` unknown website · `503` cannot text.
   Text sent: "Your PPP Pizzeria code: 123456 (valid 10 min). Do not share it." — never a link.
2. `POST /api/foodhub/customers/verify/check` `{ tenant, phone, code }`
   → `200 { ok:true, token, expiresAt, customer: { id, phone (E.164), name?, email?, lang, marketingConsent, createdAt, verifiedAt }, created }`.
   Wrong code → `401 { attemptsLeft }`; the 5th wrong one, or an expired code → `410` (start again).
3. `GET /api/foodhub/customers/me` headers Bearer + `X-Customer-Token` (optionally `X-Customer-Tenant`: a token of another
   website is then refused 403) → `{ ok, customer, addresses, favourites, loyalty, giftCards, orders }`.
   `orders` = that number's **website** orders, newest first, at most 20: `{ id, number, at, total, status, brand, fulfillment }`.
   `loyalty` / `giftCards` answer today `{ connected:false, reason: "LOY4LTY not connected yet" }` / `"REW4RDS not connected yet"`.
4. `PATCH /api/foodhub/customers/me` `{ name?, email?, lang?, marketingConsent? }` → `{ ok, customer }` (`null` clears name or e-mail; `422` when invalid).
5. `PUT /api/foodhub/customers/me/addresses` `{ addresses: [{ label?, street, unit?, city, province?, postalCode, instructions? }] }` (max 5, Canadian postal code) → `{ ok, addresses }`.
6. `PUT /api/foodhub/customers/me/favourites` `{ favourites: ["<ref>"] }` (max 50) → `{ ok, favourites }`.
7. `POST /api/foodhub/customers/me/logout` → `{ ok }`: every token of that customer is void.
8. `DELETE /api/foodhub/customers/me` → `{ ok, deleted: true }`: record anonymised (Law 25).

Token: `cust.<customerId>.<tenant>.<expUnix>.<tokenVersion>.<hmac-sha256 base64url>`, 30 days, signed with the session
secret. The version is compared with the record on every call: logout or delete = every token dead. On the order side,
`lib/foodhub/customers/token.ts › resolveCustomerToken(token, { tenant })` returns the live customer behind a token
(what the website-order intake uses to link an order to the account).

## Code map

- `lib/foodhub/customers/types.ts` — `MasterCustomer`, public projection, allowed websites and their display names.
- `lib/foodhub/customers/store.ts` — fh_docs collection `customers` (phone index hashed), race-free creation
  (in-process lock + atomic `claimKv`), logout bump, anonymisation.
- `lib/foodhub/customers/verify.ts` — the two providers, texts, limits, start / check / complete.
- `lib/foodhub/customers/token.ts` — sign / verify / resolve the customer token.
- `lib/foodhub/customers/profile.ts` — validation of profile, addresses, favourites.
- `lib/foodhub/customers/me.ts` — the `/me` projection (adapters + website orders).
- `lib/foodhub/customers/adapters.ts` — LOY4LTY / REW4RDS stubs (truthful `connected:false`).
- `app/api/foodhub/customers/**` — the routes; `app/api/foodhub/customers/admin` + `app/(console)/settings/customers` — the console screen.
- `tests/customer-identity.test.ts`.

## ON2GO : connexion par TAKATAK · ON2GO: sign-in through TAKATAK (2026-10-30)

on2go.ca est un site statique : il n'a pas de serveur pour garder le secret des sites de marque. Il connecte ses clients
par le pont de takatak-v1 (contrat C3, takatak-v1 `docs/ON2GO_MASTER_API.md`) :

1. Le client, connecté sur TAKATAK, ouvre « ON2GO » : takatak-v1 l'envoie sur on2go.ca avec un code à usage unique
   (`?code=`, 90 s).
2. on2go.ca envoie `POST /api/public/on2go/session` `{ "code" }` à Food Hub (CORS : sites ON2GO seulement ; public dans
   `proxy.ts` ; 10 essais / 10 min par IP).
3. Food Hub échange le code chez takatak-v1 avec `TAKATAK_ON2GO_SERVICE_TOKEN`, reçoit l'identité (téléphone vérifié),
   crée ou retrouve le client **sur ce téléphone** (le même dossier que la connexion par texto), garde
   `takatakIdentityId`, et répond `{ ok, token, expiresAt, customer, created }` : un jeton client signé pour la marque
   `on2go` (toujours permise).

Refus : code mal formé 400 ; code expiré ou déjà utilisé 401 ; compte TAKATAK sans cellulaire vérifié 409 ; trop
d'essais 429 ; TAKATAK injoignable ou non configuré 503. Variables : `TAKATAK_CONTROL_PLANE_URL` (https, déjà utilisée),
`TAKATAK_ON2GO_SERVICE_TOKEN`. Code : `lib/foodhub/customers/takatak-bridge.ts`, route
`app/api/public/on2go/session/route.ts`, tests `tests/takatak-bridge.test.ts`.

### API du navigateur d'on2go.ca · on2go.ca browser API (2026-10-30)

on2go.ca n'a pas le secret des sites de marque ; ces routes le remplacent par : CORS et préalable pour les sites ON2GO
seulement, marque fixée à `on2go` (jamais lue dans la requête), jeton client dans `Authorization: Bearer cust.…` accepté
seulement s'il a été signé pour `on2go`, fenêtres par IP en plus des limites par téléphone (`lib/foodhub/customers/on2go-public.ts`).

| Route | Corps / en-tête | Réponse |
|---|---|---|
| `POST /api/public/on2go/verify/start` | `{ phone, lang? }` | `{ ok, expiresInS, channel }` · 422 · 429 `{ retryAfterS }` (6 / 10 min par IP) |
| `POST /api/public/on2go/verify/check` | `{ phone, code }` | `{ ok, token, expiresAt, customer, created }` · 401 `{ attemptsLeft }` · 410 · 429 (20 / 10 min par IP) |
| `POST /api/public/on2go/session` | `{ code }` (lancement TAKATAK) | même réponse que `verify/check` |
| `GET /api/public/on2go/me` | `Authorization: Bearer <jeton on2go>` | profil, adresses, favoris, fidélité, cartes-cadeaux, commandes |
| `PATCH /api/public/on2go/me` | `{ name?, email?, lang?, marketingConsent? }` | `{ ok, customer }` |
| `DELETE /api/public/on2go/me` | — | Loi 25 : dossier anonymisé, tous les jetons annulés |
| `POST /api/public/on2go/logout` | — | `{ ok }` : tous les jetons du client annulés |

Un jeton d'un autre site de marque (pppmtl…) est refusé (403). Tests : `tests/on2go-public-customers.test.ts`.

on2go.ca has no server to hold the website secret, so it signs customers in through takatak-v1's launch bridge: the
browser posts the one-time code to `POST /api/public/on2go/session`; Food Hub exchanges it with its service token,
keys the customer on the verified phone, and returns a signed `on2go` customer token. The browser API above (texted code, TAKATAK session, account,
logout, delete) accepts only `on2go` customer tokens, CORS for the ON2GO sites only.
