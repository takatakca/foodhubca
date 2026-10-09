# Clover App Market listing — TAKATAK Food Hub

Everything to paste into the Clover developer dashboard → your app → **App Market Listing**, **Overview** and
**Permissions**. French first, English second.

- The same text is in Food Hub → **Settings → Clover app**, with a Copy button on every field and the addresses
  already built for your domain. The code copy lives in `lib/foodhub/clover-listing.ts`; a test keeps this page and
  the code word for word in step.
- The full requirement list, what is done and what is left: [`CLOVER_MARKETPLACE_LAUNCH.md`](CLOVER_MARKETPLACE_LAUNCH.md).

Clover's limits:
- tagline ≤ 255 characters;
- 3 to 5 benefits, ≤ 100 characters each;
- square PNG icon (1:1; cannot be deleted once uploaded);
- screenshots at least 320 px (480 px recommended), at most 1920 × 1080;
- optional cover image 1080 × 216;
- EULA URL and privacy policy URL;
- support phone, email, website and hours;
- at least 1 functional category (at most 3) and at least 1 vertical category;
- "Clover" may not appear in the app name, website name or support email domain.

> **Before you submit:**
> 1. Have the privacy policy and terms pages reviewed (they show a yellow "draft" banner).
> 2. Fill in `FOODHUB_SUPPORT_EMAIL` and `FOODHUB_SUPPORT_PHONE` with `npm run setup` (optionally also
>    `FOODHUB_SUPPORT_HOURS` and `FOODHUB_PRIVACY_OFFICER`).
> 3. Set `FOODHUB_LEGAL_APPROVED=true`. The banner then disappears.

## Name

**TAKATAK Food Hub**

## Tagline

- **FR** — Uber Eats, DoorDash, SkipTheDishes et Too Good To Go directement dans votre caisse Clover : un seul écran, des menus et des ruptures synchronisés, des paiements vérifiés.
- **EN** — Uber Eats, DoorDash, SkipTheDishes and Too Good To Go straight into your Clover register: one screen, synced menus and sold-out items, verified payouts.

## Benefits (3 to 5, ≤ 100 characters each)

| # | Français | English |
|---|----------|---------|
| 1 | Chaque commande de livraison arrive dans Clover et à l’imprimante, sans jongler entre tablettes. | Every delivery order lands in Clover and on the kitchen printer — no more juggling tablets. |
| 2 | Un menu maître publié sur Uber Eats, DoorDash et Skip, avec majoration par plateforme. | One master menu published to Uber Eats, DoorDash and Skip, with a markup per platform. |
| 3 | Rupture dans Clover = article retiré de toutes les plateformes en quelques secondes. | Out of stock in Clover = item off every platform within seconds. |
| 4 | Chaque paiement des plateformes comparé aux commandes : l’argent manquant est signalé. | Every platform payout checked against your orders: missing money is flagged. |
| 5 | Alerte dès qu’un magasin se met hors ligne ou qu’une commande attend une réponse. | An alert as soon as a store goes offline or an order is waiting for an answer. |

## Description

Clover reads the first sentences for search, and the description must state any setup, app or hardware requirement
(the "Ce qu'il faut / Requirements" paragraph).

### Français

TAKATAK Food Hub réunit toutes vos plateformes de livraison sur un seul écran et les relie directement à votre
caisse Clover — sans agrégateur.

- **Commandes** :
  - les commandes Uber Eats, DoorDash et SkipTheDishes (et Too Good To Go lorsque votre compte offre un flux de
    commandes) arrivent avec une alerte sonore et s’acceptent en un geste ;
  - elles sont créées dans Clover avec un type de commande par plateforme et s’impriment à la cuisine ;
  - une fois sorties, elles sont enregistrées payées avec un mode de paiement par plateforme, pour que la fermeture
    de caisse soit juste.
- **Écran de cuisine** : à préparer, prêtes, livreur en route ; allergies et notes en rouge ; minuteries.
- **Menus** : importez votre inventaire Clover, vérifiez-le, puis publiez un menu maître sur chaque plateforme avec
  les heures, les jours fériés, les catégories à horaire et une majoration en % par plateforme.
- **Ruptures (86)** : un article en rupture dans Clover est retiré de toutes les plateformes ; remis en vente
  partout d’un clic.
- **Magasins** : mettez en pause ou rouvrez une succursale sur toutes les plateformes, mode occupé et temps de
  préparation.
- **Argent** : chaque paiement des plateformes est comparé aux commandes ; frais, remboursements, ajustements et
  argent manquant sont signalés. Rien n’est approuvé ni comptabilisé automatiquement : vous décidez.
- **Équipe** : connexion par code (courriel ou texto), rôles, NIP de gérant pour tout ce qui touche l’argent.

**Ce qu’il faut :**
- un forfait Clover qui comprend l’inventaire et les commandes ;
- un appareil Clover avec une imprimante de commandes ;
- vos propres comptes marchands Uber Eats, DoorDash ou SkipTheDishes ;
- un compte TAKATAK Food Hub : chaque nouveau restaurant est approuvé par notre équipe avant que des commandes
  soient envoyées à sa caisse.

Interface en français et en anglais. Food Hub ne traite aucun paiement par carte. Les jetons Clover restent sur notre
serveur et se renouvellent seuls ; ils sont supprimés à la désinstallation.

### English

TAKATAK Food Hub brings all your delivery platforms onto one screen and connects them straight to your Clover
register — no aggregator.

- **Orders**:
  - Uber Eats, DoorDash and SkipTheDishes orders (and Too Good To Go when your account offers an order feed) arrive
    with a sound alert and are accepted in one tap;
  - they are created in Clover with an order type per platform and printed in the kitchen;
  - once they leave, they are recorded as paid with a tender per platform, so your Clover closeout is right.
- **Kitchen screen**: to cook, ready, courier arriving; allergies and notes in red; timers.
- **Menus**: import your Clover inventory, check it, then publish one master menu to every platform with hours,
  holidays, scheduled categories and a % markup per platform.
- **Sold out (86)**: an item out of stock in Clover is taken off every platform; back on sale everywhere in one click.
- **Stores**: pause or reopen a location on every platform, busy mode and prep time.
- **Money**: every platform payout is checked against your orders; fees, refunds, adjustments and missing money are
  flagged. Nothing is approved or posted automatically: you decide.
- **Team**: sign-in by code (email or text), roles, manager PIN for anything that touches money.

**Requirements:**
- a Clover plan that includes Inventory and Orders;
- a Clover device with an order printer;
- your own Uber Eats, DoorDash or SkipTheDishes merchant accounts;
- a TAKATAK Food Hub account: each new restaurant is approved by our team before any order is sent to its register.

French and English interface. Food Hub never processes card payments. Clover tokens stay on our server and renew by
themselves; they are deleted when the app is uninstalled.

## Functional description (Overview → required for review)

Copy it from **Settings → Clover app**: there the support email is already filled in, and it is shown in French and
English. In short:

**What it does:**
- orders are created in Clover with the atomic order API and a platform order type;
- the kitchen ticket is printed with `print_event`;
- the order is recorded as paid with a platform tender at pickup;
- the Clover inventory is imported into one master menu;
- sold-out items follow the Inventory webhook;
- uninstalling deletes the tokens (App webhook).

**How to test:**
1. Install the app and open it from the Clover dashboard. The welcome page is pre-filled from the merchant's data.
2. Our team approves the reviewer's test merchant. Reviewers write to the support email; the owner is alerted at once.
3. Press **Send a test order**: a TEST order is created in Clover (OPEN), printed, and paid with Clover's own total,
   tax included (PAID).
4. Uninstall the app.

Plus the **functional video URL** (YouTube or Vimeo, unlisted). The shot list is in
[`CLOVER_MARKETPLACE_LAUNCH.md`](CLOVER_MARKETPLACE_LAUNCH.md#functional-video-script).

## Categories

- **Functional** (at most 3): **Orders & Delivery**, **Items & Inventory**, **Kitchen Operations**. Pick the closest
  names in Clover's list.
- **Vertical:** **Quick Service Restaurant**, **Full Service Restaurant**.

> **Canada:** Clover's international readiness page says hospitality, full-service and quick-service restaurant apps
> must be certified under Revenu Québec's sales recording module (SRM) mandate. Ask Clover Developer Relations whether
> that applies to Food Hub before choosing the restaurant categories for Canada. Food Hub does not bill customers: it
> records platform orders that the platforms already billed. Details: `CLOVER_MARKETPLACE_LAUNCH.md` §5.

## Languages and regions

- Subscription countries: **Canada** and **United States**.
- Listing tabs:
  - **Français (Canada)**: the French texts.
  - **English (Canada)** and **English (US)**: the English texts.
- The app itself is in French and English everywhere, including the welcome page and the legal pages. Clover requires
  both for Québec merchants.

## Legal and support URLs

Shown with a Copy button in Food Hub → **Settings → Clover app**. Every URL is built from `FOODHUB_PUBLIC_URL`; replace
`https://YOUR-DOMAIN` with your own domain (live: `https://foodhub.on2go.ca`).

| Field | URL |
|-------|-----|
| Privacy policy | `https://YOUR-DOMAIN/legal/privacy` |
| End User License Agreement (terms) | `https://YOUR-DOMAIN/legal/terms` |
| Support website (FAQ, contact, legal links) | `https://YOUR-DOMAIN/legal/support` |
| Support email / phone | the values of `FOODHUB_SUPPORT_EMAIL` / `FOODHUB_SUPPORT_PHONE`. Clover requires both. |
| Support hours | `FOODHUB_SUPPORT_HOURS`, default *Lun–ven 9 h – 17 h (HE) · Mon–Fri 9 am – 5 pm ET* |

## Icon, cover and screenshots

Ready-made files, generated from the built-in demo (simulated platforms, sample data — no real customer, no secret):
[`docs/clover-listing/`](clover-listing/).

| File | Use |
|------|-----|
| `icon-512.png` | App icon, 512 × 512 (same as `public/icons/icon-512.png`) |
| `cover-1080x216.png` | Optional cover image. It cannot be deleted once uploaded, only replaced. |
| `fr/*.png`, `en/*.png` | Screenshots, 1920 × 1080, one set per language |

The screenshot files, the same in both languages:

| File | What it shows |
|------|---------------|
| `01-welcome-connected.png` | The welcome page after opening the app from Clover: connected, register check, 3 set-up steps |
| `01b-welcome-pending.png` | The same page for a new merchant waiting for approval |
| `01c-welcome-test-order.png` | "Send a test order": created, printed, paid in Clover |
| `02-new-order.png` | A new order popping up |
| `03-command-center.png` | Today: sales, orders, stores online, alerts, totals per platform |
| `04-orders.png` | Orders board |
| `05-kitchen.png` | Kitchen screen |
| `06-menu.png` | Menu editor |
| `07-stores.png` | Store status and pauses on every platform |
| `08-money.png` | "Where is my money?" — payouts vs orders |
| `09-clover-app-settings.png` | Settings → Clover app (submission checklist) |

Clover shows the screenshots in the order you upload them. Suggested order: 01, 02, 03, 05, 01c, 06, 07, 08, 04.
The pending page and the settings page are useful for the reviewer, less for merchants.

## Pricing and distribution

- **Pricing:** free (0.00) in Canada and the United States. Every app needs a subscription plan in Clover, even a free
  one. Clover may follow up about monetizing.
- **No fees outside Clover:** any future fee must go through Clover's billing.
- **Who can use it:** a merchant that installs the app is **not** connected automatically. Unless it is one of your
  own merchants, it shows as **Pending** in Settings → Platforms & Clover, and nothing is sent to it until you click
  **Approve**. Your own merchants are recognised by:
  - `CLOVER_MERCHANT_ID`;
  - `CLOVER_MERCHANT_TOKENS`;
  - `CLOVER_ALLOWED_MERCHANTS`;
  - a store mapped to that merchant.
- **When a merchant is pending:** you get a team-chat message and an email right away.
- **Alternative — a private app:** Clover lets you choose the app type "Private app". It is not listed publicly and
  is installed by link. It still goes through approval and cannot be billed through the App Market. See
  `CLOVER_MARKETPLACE_LAUNCH.md` §3 for which one to choose.

## Permissions (paste each reason in the dashboard)

Least privilege: each permission below is used by the code, and Clover checks the reason against what the app does.

| Permission | Access | Why (English — the French text is in Settings → Clover app) |
|------------|--------|---------------------------------------------------------------|
| Merchant | Read + Write | Read: merchant name and address to match each Clover location with its delivery stores; App webhook events. Write: create one tender per delivery platform ("Uber Eats", "DoorDash"…) used to record platform payments. |
| Inventory | Read + Write | Read: import items, categories and modifier groups into the master menu; follow stock to take sold-out items off the platforms. Write: add a kitchen printer label to items that would not print, only when the owner asks. |
| Orders | Read + Write | Write: create each delivery order in Clover with its platform order type and print the kitchen ticket; remove an order the platform cancelled before it was paid. Read: daily totals and orders that platforms create through Clover’s own integrations. |
| Payments | Read + Write | Write: record each platform order as paid with the platform’s tender when it leaves the kitchen, so the closeout is right (no card is ever processed). Read: match payments and refunds for the payout check. |

## Webhooks (after the server is running on its domain)

1. In Clover, set the webhook URL to `https://YOUR-DOMAIN/api/foodhub/webhooks/clover`.
2. Subscribe to these events:
   - **Inventory** (sold-out items);
   - **App** (install, uninstall, subscription change).
3. Clover sends a verification code. It appears in Food Hub → Settings → Platforms & Clover; paste it back in Clover.
4. Copy Clover's auth code into `CLOVER_WEBHOOK_AUTH` with `npm run setup`.

## Test before submitting

1. **Sandbox:**
   - Create the same app on `sandbox.dev.clover.com` and set `CLOVER_BASE_URL=https://apisandbox.dev.clover.com`.
   - Install it on a test merchant and open it.
   - The welcome page says "Request received", with the register check. You get the chat/email alert.
   - Approve the merchant. The page then says "connected"; press **Send a test order**.
2. **Production:**
   - From Clover, open the app on your own merchant. It is trusted, so the welcome page says "connected" right away.
   - Press **Send a test order**: the ticket prints, and the order closes as paid with the "Uber Eats" tender.
3. Send a simulated or real DoorDash/Uber/Skip order and check that it appears in Clover and prints.
