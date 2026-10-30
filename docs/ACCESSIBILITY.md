# Accessibilité / Accessibility (`npm run verify:a11y`)

## En bref (français)

- **But :** le critère du MASTER PLAN, phase 3 : « Lighthouse accessibilité ≥ 95 ». Lighthouse utilise le moteur
  **axe-core** ; on le fait tourner nous-mêmes, sur les pages qui comptent, à chaque CI.
- **La commande :** `npm run verify:a11y` (après un build). Elle démarre l'application construite **en mémoire**, avec de
  faux services sur la machine (aucune plateforme, aucun Clover, aucun texto réel), se connecte comme propriétaire,
  puis ouvre chaque page avec Playwright + axe-core, **au format téléphone (375×812) et ordinateur (1280×800)**.
- **Pages vérifiées :** connexion, `/tablette`, une page de commande `/commander/<marque>` (marque de démonstration
  Pi Pita), la fenêtre de bienvenue (première connexion), l'accueil de la console, le tableau des commandes, la
  cuisine (`/kitchen`, thème sombre), Go-live, Réglages → Pilote automatique, et l'**alerte de nouvelle commande**
  (cuisine et tableau des commandes) avec une vraie commande DoorDash de test.
- **Règles :** WCAG 2.1, niveaux A et AA. **Toute violation « grave » ou « critique » fait échouer** la commande (et la
  CI) ; les violations « modérées » sont affichées sans faire échouer.
- **Mouvement réduit :** avec le réglage « réduire les animations » du système, aucune animation CSS ne doit encore
  tourner, **sauf l'alerte de nouvelle commande, qui doit continuer de sonner** (un halo doux, sans mouvement : c'est
  une alarme, pas une décoration).
- **Résultat aujourd'hui :** 22 analyses, **0 violation** (ni grave, ni modérée, ni mineure). Avant : des textes trop
  pâles (boutons de la cuisine, étiquettes des plateformes, pastilles ambre, petit texte de la page de connexion) et
  deux noms de boutons qui ne reprenaient pas le texte visible (logo, bouton de langue). Détails plus bas.
- **Ce qui n'a pas changé :** le dessin. Seules les couleurs de texte trop pâles ont été foncées (ou, dans la cuisine
  sombre, le texte des boutons vifs est passé en foncé). Le thème sombre de la cuisine reste sombre partout.

## English

### What it checks

`scripts/a11y-check.mjs`, run with `npm run verify:a11y`:

1. Starts the **built** app the way `scripts/foodhub-e2e.mjs` does: `next start`, memory mode
   (`FOODHUB_FORCE_MEMORY=true`), every platform, Clover, Twilio and Resend pointed at a local stand-in, the owner
   password. Nothing leaves the machine; the last line counts the calls the stand-in answered.
2. Seeds what the pages need: a small made-up menu for the demo brand **Pi Pita** (from the seed catalog), all-day
   hours, the brand's ordering page switched on, and one website order (so the boards are not empty).
3. Opens each page in Chromium (Playwright) at **phone 375×812** and **desktop 1280×800**, waits until data and entrance
   animations have settled, and runs **axe-core** with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`.

   | Page state | Path | Visitor |
   |---|---|---|
   | Sign-in | `/login` | anonymous |
   | Tablet app | `/tablette` | anonymous |
   | Ordering page | `/commander/pi-pita` | anonymous |
   | Welcome dialog (first sign-in) | `/` | owner, first visit |
   | Console overview | `/` | owner |
   | Orders board | `/orders` | owner |
   | Kitchen (dark theme) | `/kitchen` | owner (the check also asserts `theme-kitchen` is on `<html>`) |
   | Go-live | `/settings/go-live` | owner |
   | Settings → Autopilot | `/settings/autopilot` | owner |
   | New-order alert · kitchen | `/kitchen` | owner, after a test DoorDash order on a made-up store |
   | New-order alert · orders board | `/orders` | owner, same order |

4. **Fails (exit 1) on any `serious` or `critical` violation**, printing each rule, its help link and the elements it was
   found on. `moderate` ones are printed as notes and do not fail. A page that answers an HTTP error, lands somewhere
   else (a redirect to sign-in), misses the kitchen theme or misses its dialog also fails.
5. **Reduced motion:** a desktop context with `prefers-reduced-motion: reduce` opens every page again. Any CSS or script
   animation still running fails, except the new-order alert's ringing frame (`data-motion="alarm"`,
   `components/live/incoming.tsx`), which **must** still ring on the alert pages. CSS transitions are not counted.

The new-order alert is the one looping animation the plan allows (MASTER_PLAN Phase 3 guardrails). `app/globals.css`
shortens every animation to 1 ms under `prefers-reduced-motion` (and under the console's own "reduce motion" setting,
`html[data-motion='reduce']`), then gives `[data-motion='alarm']` its 1.4 s infinite ring back. It only animates a
`box-shadow` halo: no movement, well under three flashes a second.

### How to run it

```bash
npm ci
npx playwright install --only-shell chromium   # once per Playwright version (headless shell only)
rm -rf .next && npx next build --webpack        # or npm run build
npm run verify:a11y
```

Options (environment variables):

| Variable | Default | What |
|---|---|---|
| `FOODHUB_A11Y_MOCK_PORT` / `FOODHUB_A11Y_APP_PORT` | 4797 / 4798 (else `FOODHUB_E2E_MOCK_PORT` / `_APP_PORT`) | ports, when another check uses them |
| `FOODHUB_A11Y_PAGES` | all | only the page states whose name contains one of these words, e.g. `alert,kitchen` |
| `FOODHUB_A11Y_SCREENSHOTS` | off | a folder: a full-page screenshot of every scan |
| `FOODHUB_A11Y_BEST_PRACTICE` | off | `1`: also list axe best-practice findings (landmarks, heading order) as notes |

On Linux without the browser's system libraries: `npx playwright install --with-deps --only-shell chromium`.

### In CI

`.github/workflows/ci.yml`, job `verify`, after **Build**: reads the installed Playwright version, restores
`~/.cache/ms-playwright` from the cache (key `playwright-chromium-shell-<os>-<version>`), installs the headless shell
only when the cache missed (`--with-deps`), else only its system libraries, then runs `npm run verify:a11y` (8-minute
limit). **Food Hub verification** still runs when the accessibility step fails (both report different things). Pull
requests into `release/**` now run CI too (the owner's release branches collect several PRs before one review).

Dependencies (dev only, exact versions): `playwright` 1.64.1, `@axe-core/playwright` 4.14.0 (axe-core 4.14.0).

### Results (2026-10-30)

Violations = axe rules broken on the page (WCAG 2.1 A/AA); in brackets, the rule and how many elements broke it.
"Before" = the base branch `release/2026-10-30` (599be91) with this check; "after" = this branch. No critical, moderate
or minor violation before or after: every finding was **serious**.

| Page state | Phone before | Phone after | Desktop before | Desktop after |
|---|---|---|---|---|
| Sign-in | 1 (contrast ×1) | 0 | 1 (contrast ×1) | 0 |
| Tablet app | 0 | 0 | 0 | 0 |
| Ordering page | 0 | 0 | 0 | 0 |
| Welcome dialog | 1 (contrast ×1) | 0 | 2 (contrast ×1, label in name ×2) | 0 |
| Console overview | 1 (contrast ×1) | 0 | 2 (contrast ×1, label in name ×2) | 0 |
| Orders board | 0 | 0 | 1 (label in name ×2) | 0 |
| Kitchen (dark) | 1 (contrast ×1) | 0 | 2 (contrast ×1, label in name ×2) | 0 |
| Go-live | 1 (contrast ×6) | 0 | 2 (contrast ×6, label in name ×2) | 0 |
| Settings → Autopilot | 0 | 0 | 1 (label in name ×2) | 0 |
| New-order alert · kitchen | 1 (contrast ×7) | 0 | 2 (contrast ×7, label in name ×2) | 0 |
| New-order alert · orders board | 1 (contrast ×6) | 0 | 2 (contrast ×8, label in name ×2) | 0 |

Before: 16 of 22 scans failed. After: 22 of 22 pass with no violation at any level. Reduced motion: before, the
new-order alarm stopped ringing (the 1 ms rule also cut it); after, every page is still and the alarm rings.

### What was fixed

Contrast (WCAG 1.4.3, 4.5:1 for normal text):

- **Filled controls** (`components/ui/button.tsx` brand / go / danger, PIN pad OK, save chip "Retry", red bands and
  allergy notes on order cards, the new-order and cancellation pop-ups, kitchen lock banners, escalation steps): new
  tokens in `app/globals.css`, each pair ≥ 4.5:1: `--color-go-fill` / `--color-on-go`, `--color-stop-fill` /
  `--color-on-stop`, `--color-on-brand`, plus hover shades. On the white console the text stays white on a slightly
  deeper green / red; in the kitchen theme the fills stay bright and the text turns dark (white on them was 2.3–3.5:1).
  Status dots and bars keep `--color-go` / `--color-stop`.
- **Amber text** `--color-wait-2`: `#a87500` → `#8a6500` (3.7:1 → 4.9:1 on `--color-wait-soft`); the brand-kit status
  look-alike list follows (`lib/foodhub/brand-kit.ts`).
- **Platform tags** (`components/ui/badge.tsx`): `PLATFORM[...].on`, the text colour on each platform's colour: dark ink
  on Uber, DoorDash, Skip and Clover (white was 2.4–3.7:1), white kept on Too Good To Go and grey.
- **Count badges** in the rail, bottom bar and bell (`components/shell/console-shell.tsx`): dark text on amber and electric
  blue (`--color-on-bright`), `--color-on-stop` on red.
- **Sign-in footnote** (`app/login/login-view.tsx`): `text-ink-4` → `text-ink-3`.
- **"Refuser"** on the new-order pop-up and the cancellation pop-up's red line: `text-stop` → `text-stop-2`.

Names (WCAG 2.5.3 label in name, 4.1.2):

- Rail logo link: no `aria-label` when expanded (it reads its visible words); the letter mark is `aria-hidden`. Collapsed,
  only the letter shows, so the link keeps the product name as its label.
- Language button: its name starts with its visible text (`EN — Langue / Language`).
- New-order pop-up: `role="alertdialog"`, `aria-modal`, named by its title (`#fh-incoming-title`). Cancellation pop-up:
  named by its title (`#fh-cancel-title`), icon `aria-hidden`.

### Not covered

- Lighthouse itself (performance, SEO) and INP: INP needs the real kitchen tablet (MASTER_PLAN guardrails).
- Pages outside the list above; a cancellation alert is not triggered by the check.
- What axe cannot judge: reading order that makes sense, focus order in long flows, plain-language text. Check by hand
  with a keyboard and a screen reader (NVDA, VoiceOver) when a page changes a lot.
