# Brand kit: one colour and one logo per brand

> **En bref (FR).** Chaque marque peut avoir **sa couleur** (`#RRGGBB`) et **son logo** (adresse `https://` ou fichier
> téléversé dans Food Hub). On les règle dans **Réglages → Entreprise → Marques → Apparence**, avec un aperçu en direct
> (console blanche et écran cuisine sombre). La couleur apparaît comme une **bande** à gauche des cartes de commande,
> dans la fenêtre de nouvelle commande, dans l’en-tête du menu et sur les lignes de marque de l’accueil ; le logo
> remplace les deux lettres de la marque. Le texte posé sur la couleur est noir ou blanc, choisi pour un contraste d’au
> moins 4,5:1 (WCAG AA). Une couleur trop pâle sur fond blanc affiche un avertissement, tout comme une couleur proche
> du vert, du jaune ambré ou du rouge des statuts (une bande rouge ferait croire à une commande en retard). **Une marque
> sans couleur ni logo garde exactement son look actuel.** Utilisez votre vrai logo : jamais une image générée par IA.

MASTER_PLAN Phase 3 P1 ("a colour per brand, and an optional logo") and the start of the Phase 5 brand kits.

## Where to set it

Settings → Business → Brands → **Look** (button on each brand chip, owner only, `admin` permission).

- **Colour:** a colour picker or `#RRGGBB` typed by hand. Empty = no colour.
- **Logo:** an `https://` address, or **Upload a file** (PNG, JPG or WebP, 5 MB at most). An uploaded file goes to the
  media library (`lib/foodhub/media.ts`, `FOODHUB_MEDIA_DIR`) and is served by Food Hub at `/media/<name>`; the brand
  stores `/media/<name>`. Empty = no logo.
- **Preview:** a small order card on the white console and on the dark kitchen screen, the text colour chosen for the
  accent with its contrast ratio, and warnings:
  - too light on white (stripe under 3:1 against white, WCAG 1.4.11): "pick a darker shade";
  - too dark on the kitchen screen (under 3:1 against the kitchen card colour): informational, the name stays readable;
  - looks like a status colour (CIEDE2000 distance under 12 to the green, amber or red of `app/globals.css`, white
    console and kitchen theme): "the stripe could be read as a status". A warning, not a refusal: a real restaurant may
    have a red logo.

Turning a brand off or on keeps its colour and logo.

## Where it shows

| Surface | What changes when the brand has a kit |
|---|---|
| Order cards (live board, kitchen screen): platform, website (Clover Online Ordering) and own-delivery orders | 4 px stripe in the accent on the card's left edge; the logo beside the brand name; a late card with a stripe also gets a red ring, so "late" stays visible whatever the colour |
| New-order pop-up | stripe beside the brand name, and the brand mark (logo, or initials on the accent) |
| Menu header (Menus → editor) | stripe and brand mark beside the "Menus" title for the open brand |
| Overview brand rows | inset stripe on the row's left edge; the brand mark shows the logo or the accent |
| Every `BrandMark` (scope switcher, stores list…) | logo on white, or initials in the on-accent colour on the accent |

A brand without a colour and without a logo renders exactly as before: no `style` attribute, no extra class (tested).

## How it works

- **Stored** on the brand record (`lib/foodhub/catalog.ts` `BrandDef.accent`, `BrandDef.logo`) in the `catalog` key of
  `fh_kv`. No migration.
- **Validated on the server** (`lib/foodhub/brand-kit.ts`), in `saveBrand` before anything is written:
  - colour: `#RRGGBB` only (stored lower-case); names, `rgb()`, shorthand and anything else are refused;
  - logo: `https://` only, or a media library path `/media/<24 hex>.(jpg|png|webp)`; refused: `javascript:`, `data:`,
    `http:`, addresses with a user name or password, relative paths, spaces or quotes, more than 500 characters.
- **Checked again on the way out** (`brandKitsOf`, called by `viewerCatalog` in the console layout): a value edited by
  hand in the database never reaches the page.
- **CSS custom properties** `--brand-accent` and `--brand-on-accent` are set per element from the validated kit
  (`brandVars`, which re-checks `#rrggbb`). `--brand-on-accent` is black or white, whichever contrasts more with the
  accent; one of them always reaches at least 4.58:1.
- **Kitchen dark theme** (`html.theme-kitchen`): the accent is only a stripe, a border or a small badge
  (`.brand-stripe`, `.brand-stripe-inset` in `app/globals.css`), never a large background behind running text.
- Logos are shown with `<img referrerpolicy="no-referrer">` on a white tile; a logo that fails to load falls back to the
  initials.

## Guardrails kept

- Nothing new animates.
- JavaScript cost: one small pure module (`lib/foodhub/brand-kit.ts`) plus the editor dialog, loaded on the settings
  page only; well inside the Phase 3 budget of +25 KB gzipped.
- French and English everywhere.

## Tests

`tests/brand-kit.test.ts`: colour and logo validation (bad hex, `javascript:`, `data:`, `http:` refused, on the helpers
and through `POST /api/foodhub/catalog`), the contrast helper (AA reached for every accent), the default look unchanged
(BrandMark, platform, website and own-delivery order card markup), `--brand-accent` and the stripe on all three
kinds of order card, the red ring on a late card with a stripe, the status look-alike check (CIEDE2000 reference values,
the status colours read from `app/globals.css`), and the colour field's label and description wiring.
