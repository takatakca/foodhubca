# Clover App Market listing — TAKATAK Food Hub

Everything to paste into the Clover developer dashboard (App **629HFYHNVMZYR**) → **App Market Listing**.
French first, English second. Limits from Clover's listing page: tagline ≤ 255 characters, 3 to 5 benefits of
≤ 100 characters each, square icon (1:1, PNG), screenshots ≥ 320 px and ≤ 1920 × 1080, EULA URL, privacy policy
URL, support phone / email / website / hours, at least one functional and one vertical category.

> **Before you submit:** the privacy policy and terms pages are drafts (yellow banner). Have them reviewed, fill in
> `FOODHUB_SUPPORT_EMAIL` (and optionally `FOODHUB_SUPPORT_PHONE`, `FOODHUB_PRIVACY_OFFICER`) with `npm run setup`,
> then set `FOODHUB_LEGAL_APPROVED=true` so the banner disappears.

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

### Français

TAKATAK Food Hub réunit toutes vos plateformes de livraison sur un seul écran et les relie directement à votre
caisse Clover — sans agrégateur.

- **Commandes** : les commandes Uber Eats, DoorDash, SkipTheDishes et Too Good To Go arrivent avec une alerte
  sonore, s’acceptent en un geste, sont créées dans Clover (type de commande par plateforme) et s’impriment à la
  cuisine. Une fois sorties, elles sont enregistrées payées avec un mode de paiement par plateforme, pour que la
  fermeture de caisse soit juste.
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

Interface en français et en anglais. Les jetons Clover restent sur le serveur et se renouvellent seuls ; à la
désinstallation, ils sont supprimés.

### English

TAKATAK Food Hub brings all your delivery platforms onto one screen and connects them straight to your Clover
register — no aggregator.

- **Orders**: Uber Eats, DoorDash, SkipTheDishes and Too Good To Go orders arrive with a sound alert, are accepted in
  one tap, created in Clover (an order type per platform) and printed in the kitchen. Once they leave, they are
  recorded as paid with a tender per platform, so your Clover closeout is right.
- **Kitchen screen**: to cook, ready, courier arriving; allergies and notes in red; timers.
- **Menus**: import your Clover inventory, check it, then publish one master menu to every platform with hours,
  holidays, scheduled categories and a % markup per platform.
- **Sold out (86)**: an item out of stock in Clover is taken off every platform; back on sale everywhere in one click.
- **Stores**: pause or reopen a location on every platform, busy mode and prep time.
- **Money**: every platform payout is checked against your orders; fees, refunds, adjustments and missing money are
  flagged. Nothing is approved or posted automatically: you decide.
- **Team**: sign-in by code (email or text), roles, manager PIN for anything that touches money.

French and English interface. Clover tokens stay on the server and renew by themselves; they are deleted when the
app is uninstalled.

## Categories (Clover allows at most 3 functional categories)

- Functional: **Orders & Delivery**, **Items & Inventory**, **Kitchen Operations**.
- Vertical: **Full Service Restaurant**, **Quick Service Restaurant**.

## Status in the Clover dashboard (2026-10-05, 05:45)

- English (Default, US): icon, tagline, 4 benefits, description, EULA + privacy URLs, 8 EN screenshots — saved.
- French (Canada): tagline, 4 benefits, description, EULA + privacy URLs, 8 FR screenshots — saved.
- Still to do: categories (Clover signed out before they saved), the "English (Canada)" tab, Developer Support
  (phone + email are required — the owner chooses which public contact to show), optional cover image.
- Not submitted (owner's decision, after the server is live and the legal pages are reviewed).

## Legal and support URLs

Shown with a Copy button in Food Hub → Settings → Platforms & Clover → Clover app.

| Field | URL |
|-------|-----|
| Privacy policy | `https://31-220-96-134.sslip.io/legal/privacy` |
| End User License Agreement (terms) | `https://31-220-96-134.sslip.io/legal/terms` |
| Support website | `https://31-220-96-134.sslip.io/legal/support` |
| Support email / phone | the values of `FOODHUB_SUPPORT_EMAIL` / `FOODHUB_SUPPORT_PHONE` |
| Support hours | e.g. *Lun–ven 9 h – 17 h (HE) · Mon–Fri 9 am – 5 pm ET* |

When `foodhub.takatak.ca` has its DNS record, replace `31-220-96-134.sslip.io` everywhere (Clover Site URL too).

## Icon and screenshots

Folder `takatak-clover-listing` (owner's Downloads):

| File | What it shows |
|------|---------------|
| `icon-512.png` | App icon, 512 × 512, 1:1 |
| `cover-1080x216.png` | Optional cover image (Clover: permanent once uploaded — only replaceable) |
| `01-new-order-fr/en.png` | A new order popping up (accept, prep time, allergy) |
| `02-command-center-fr/en.png` | Today: sales, orders, stores online, alerts, per-platform totals |
| `03-orders-fr/en.png` | Orders board (new, preparing, ready, picked up) |
| `04-kitchen-fr/en.png` | Kitchen screen |
| `05-menu-fr/en.png` | Menu editor with per-platform prices and markup |
| `06-stores-fr/en.png` | Store status and pauses on every platform |
| `07-money-fr/en.png` | "Where is my money?" — payouts vs orders |
| `08-clover-settings-fr/en.png` | Clover connection settings |

Screenshots are 1920 × 1080 from the built-in demo (simulated platforms, sample data).

## Pricing and distribution

Food Hub is built for the TAKATAK restaurants. A merchant that installs the app from Clover is **not** connected
automatically: unless it is one of your own merchants (`CLOVER_MERCHANT_ID`, `CLOVER_MERCHANT_TOKENS`,
`CLOVER_ALLOWED_MERCHANTS`, or a store mapped to it), it shows as **Pending** in Settings → Platforms & Clover and
nothing is sent to it until you click **Approve**. Suggested pricing: **Free**. If Clover lets you limit
distribution to your own merchants, prefer that.

## Permissions (reasons already entered in the dashboard)

| Permission | Why |
|------------|-----|
| Merchant — read | Merchant name, address and hours to match each Clover location with its delivery stores. |
| Inventory — read / write | Import items, categories and modifiers into the master menu; follow stock to take sold-out items off the platforms. |
| Orders — read / write | Create each delivery order in Clover (with its order type) and print it in the kitchen; read in-store sales for daily totals. |
| Payments — read / write | Record platform orders as paid with an "Uber Eats" / "DoorDash" / "SkipTheDishes" / "Too Good To Go" tender so the closeout is right. |

## Webhooks (after the server is running)

- URL: `https://31-220-96-134.sslip.io/api/foodhub/webhooks/clover`
- Events: **Inventory** and **App** (install / uninstall).
- Clover sends a verification code: it appears in Food Hub → Settings → Platforms & Clover; paste it back in Clover.
- Copy Clover's auth code into `CLOVER_WEBHOOK_AUTH` with `npm run setup`.

## Test before submitting

1. Sandbox: create the same app on `sandbox.dev.clover.com`, set `CLOVER_BASE_URL=https://apisandbox.dev.clover.com`,
   install it on a test merchant and open it — the Food Hub welcome page should say "pending", then "connected"
   after you approve it.
2. Production: from Clover, open the app on On2GO.CA (YJ4W50YPJQSQ1) — it is trusted (`CLOVER_MERCHANT_ID`), so the
   welcome page says "connected" right away.
3. Send a test DoorDash/Uber/Skip order (simulated or real) and check it appears in Clover and prints.
