# Connexion avec Google / Sign in with Google

*(English below.)*

## Ce que ça fait

Sur la page de connexion, un grand bouton **« Continuer avec Google »** apparaît dès que `GOOGLE_OAUTH_CLIENT_ID` est
défini. La personne choisit son compte Google ; Google confirme son adresse courriel ; Food Hub la fait entrer **seulement
si cette adresse est déjà celle d’un membre actif de l’équipe** (Réglages → Équipe). Même session, mêmes rôles, même
journal d’activité que la connexion par code.

- Aucun compte n’est jamais créé par Google. Une adresse inconnue voit une page polie : « Ce compte Google n’est pas encore
  dans une équipe Food Hub : demandez à votre gérant de vous inviter. »
- Une adresse non vérifiée par Google (`email_verified` absent ou faux) est refusée.
- Tout se passe côté serveur : `state` + PKCE + `nonce` dans un cookie `httpOnly`, échange du code sur
  `oauth2.googleapis.com`, vérification du `id_token` (signature contre les clés publiques de Google, émetteur, audience,
  expiration, nonce). Le secret client ne quitte jamais le serveur.
- Mêmes limites que les autres connexions : une adresse IP qui multiplie les retours invalides est bloquée une minute,
  puis de plus en plus longtemps ; chaque refus est dans le journal (`Journal → connexions`), courriel masqué.
- La connexion par code (courriel / texto) et la connexion de secours du propriétaire restent là, inchangées.

## Créer le client OAuth (une fois, 10 minutes)

1. <https://console.cloud.google.com/> → créer (ou choisir) un projet, par exemple **TAKATAK Food Hub**.
2. **APIs et services → Écran de consentement OAuth** (« Google Auth Platform » dans la nouvelle console) :
   - Nom de l’application : **TAKATAK Food Hub** ; courriel d’assistance : l’adresse de l’entreprise.
   - Type d’utilisateurs : **Externe** (les gérants ne sont pas tous dans un même Google Workspace).
   - Domaines autorisés : `on2go.ca`. Liens « Règles de confidentialité » et « Conditions » :
     `https://foodhub.on2go.ca/legal/privacy` et `https://foodhub.on2go.ca/legal/terms`.
   - Portées (scopes) : seulement `openid`, `email`, `profile` (non sensibles : aucune vérification Google à passer).
   - Statut de publication : **En production** (sinon seuls les « utilisateurs test » listés peuvent entrer).
3. **APIs et services → Identifiants → Créer des identifiants → ID client OAuth** :
   - Type : **Application Web** ; nom : `Food Hub console`.
   - **Origines JavaScript autorisées** : `https://foodhub.on2go.ca`
   - **URI de redirection autorisés** : `https://foodhub.on2go.ca/api/auth/google/callback`
     (exactement ce chemin ; ajoutez une ligne par autre adresse publique, par exemple une adresse de test).
4. Google affiche l’**ID client** (`…apps.googleusercontent.com`) et le **code secret du client**. Copiez-les dans
   Coolify → application Food Hub → **Environment variables** :

   ```
   GOOGLE_OAUTH_CLIENT_ID=…apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=…
   ```

   Puis **Deploy** (ou Restart). Rien de tout cela ne va dans le dépôt : le dépôt est public.
5. Vérifier : ouvrir <https://foodhub.on2go.ca/login> → le bouton Google est là → entrer avec un compte Google dont
   l’adresse est déjà dans Réglages → Équipe → la console s’ouvre. Avec une autre adresse Gmail : la page « pas encore dans
   une équipe ».

`FOODHUB_PUBLIC_URL` doit être `https://foodhub.on2go.ca` (déjà le cas) : l’URI de redirection envoyé à Google en est
construit. Si elle change, mettez à jour l’URI dans la console Google.

## Pour entrer avec Google, un membre a besoin de…

…d’être dans **Réglages → Équipe** avec son adresse Google comme courriel (exactement la même, majuscules sans importance).
Un membre inscrit seulement par cellulaire doit d’abord recevoir son courriel dans sa fiche.

## Dépannage

| Symptôme | Cause / remède |
| --- | --- |
| Pas de bouton Google | `GOOGLE_OAUTH_CLIENT_ID` vide ou pas encore déployé. |
| Google : `redirect_uri_mismatch` | L’URI dans la console Google n’est pas exactement `https://foodhub.on2go.ca/api/auth/google/callback`. |
| Google : `access_blocked` / « application non vérifiée » | Écran de consentement encore en mode **Test** : passer en production, ou ajouter la personne aux utilisateurs test. |
| « La connexion Google n’a pas abouti » | Plus de 10 minutes entre le clic et le retour, cookies bloqués, lien ouvert dans un autre navigateur, ou retour annulé chez Google. Recommencer ; le détail est dans le journal des connexions. |
| « Trop d’essais » | Cette adresse IP a envoyé plusieurs retours invalides : attendre une minute. |
| « Ce compte Google n’est pas encore dans une équipe » | L’adresse n’est pas (ou plus) dans Réglages → Équipe, ou le membre est désactivé. |

---

# Sign in with Google (English)

## What it does

A big **“Continue with Google”** button appears on the sign-in page as soon as `GOOGLE_OAUTH_CLIENT_ID` is set. The
person picks a Google account; Google confirms the email address; Food Hub signs them in **only if that address already
belongs to an active team member** (Settings → Team). Same session, roles and activity log as the code sign-in.

- Nobody is ever created from a Google account. An unknown address sees a friendly page: “This Google account is not on a
  Food Hub team yet: ask your manager to invite you.”
- An address Google has not verified (`email_verified` missing or false) is refused.
- Everything runs server side: `state` + PKCE + `nonce` in an `httpOnly` cookie, code exchange at
  `oauth2.googleapis.com`, `id_token` verified (signature against Google’s public keys, issuer, audience, expiry, nonce).
  The client secret never leaves the server.
- Same limits as the other sign-ins: an address that keeps sending bad callbacks is locked for a minute, then longer;
  every refusal is logged (masked email).
- The code sign-in (email / text) and the owner recovery sign-in stay as they are.

## Create the OAuth client (once, 10 minutes)

1. <https://console.cloud.google.com/> → create (or pick) a project, e.g. **TAKATAK Food Hub**.
2. **APIs & Services → OAuth consent screen** (“Google Auth Platform” in the new console):
   - App name **TAKATAK Food Hub**; support email: the company address.
   - User type **External**. Authorized domain `on2go.ca`. Privacy policy `https://foodhub.on2go.ca/legal/privacy`,
     terms `https://foodhub.on2go.ca/legal/terms`.
   - Scopes: only `openid`, `email`, `profile` (non-sensitive: no Google verification needed).
   - Publishing status **In production** (otherwise only listed test users can sign in).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Type **Web application**; name `Food Hub console`.
   - **Authorized JavaScript origins**: `https://foodhub.on2go.ca`
   - **Authorized redirect URIs**: `https://foodhub.on2go.ca/api/auth/google/callback`
4. Copy the **Client ID** and **Client secret** into Coolify → Food Hub app → **Environment variables**:

   ```
   GOOGLE_OAUTH_CLIENT_ID=…apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=…
   ```

   Then **Deploy** (or Restart). Nothing of this goes into the repository: it is public.
5. Check: open <https://foodhub.on2go.ca/login> → the Google button is there → sign in with a Google account whose address
   is already in Settings → Team → the console opens. With another Gmail address: the “not on a team yet” page.

`FOODHUB_PUBLIC_URL` must be `https://foodhub.on2go.ca` (it already is): the redirect URI sent to Google is built from it.

## Where the code lives

- `lib/foodhub/identity/google.ts` — authorization URL, state cookie, JWKS cache, `id_token` checks, team lookup.
- `app/api/auth/google/start/route.ts`, `app/api/auth/google/callback/route.ts` — the two public routes (listed in `proxy.ts`).
- `app/login/login-view.tsx` — the button and the “not on a team yet” notice.
- `tests/google-signin.test.ts` — fake JWKS, state / PKCE / nonce mismatches, unknown email refused, known email signed in.
