# Client dashboard: a simple view for restaurant owners (task 40)

> **Pour le propriétaire.** La console garde toutes ses pages. Par défaut, chaque personne voit une **vue simple** :
> 6 entrées de menu, des mots clairs et une seule action par écran. Le choix de portée gagne un 3ᵉ niveau,
> **Plateforme** (Uber Eats, DoorDash, Skip, Too Good To Go), avec le nombre de magasins de chacune. L'Accueil, les
> Commandes, les Alertes et les Rapports suivent ce choix. Les alarmes de nouvelle commande, l'alarme d'annulation et
> l'écran cuisine ne suivent jamais une marque ni une plateforme. Un interrupteur **« Vue complète »**, dans le menu de
> l'avatar, redonne la console d'aujourd'hui, à l'identique, au propriétaire et aux gérants. Rien n'est envoyé aux
> plateformes. Rien ne touche aux webhooks, aux commandes, à Clover ni aux menus.

- **Task:** task 40 on the task board.
- **Branch:** `feature/client-dashboard-easy`, cut from `origin/main` 444e8f2. One PR.
- **Tiers:** P0 must ship, P1 should ship, P2 is cut first (§20). **Status: P0, P1 and P2 are built** (see §22).
- **Style reference:** notes on a large merchant portal, kept outside this repository. We copy patterns only: no other
  company's name, logo, colours or fonts.

---

## 0. How this design was chosen

Three proposals were scored out of 10 on four criteria (for risk, 10 = safest).

| Criterion | P1 "Easy mode, minimal nav" | P2 "Client view by role" | P3 "Scope-first easy mode" |
|---|---|---|---|
| Simple for an owner who is not technical | 8 | 7 | 8 |
| Fit for many brands × many platforms | 7 | 6 | **10** |
| Implementation risk (10 = safest) | 7 | 5 | 7 |
| Keeps every existing feature | 9 | 6 | 9 |
| **Total /40** | 31 | 24 | **34** |

P3 won: the view mode lives in a cookie (server and browser agree, nothing flashes), the switcher shows counts per
platform ("DoorDash (15)"), Home gets a "Par plateforme" card, Restaurants gets a flat store table, alerts are scoped
by the API rather than the pulse's top 5, and a person with a single location skips a level.

Taken from P1: `isEverything` next to an unchanged `isAllRestaurants`, `inScopeLoose`, the getting-started steps from
`onboardingSteps` on the server, a plain-language "not live yet" warning, `allConsolePages()` for search and tests, an
"Aide" button in the rail, phone cards for History, "Ventes et tendances" instead of "Analyses", the Activity tab in the
full view only.

Taken from P2: `lib/foodhub/owner-seed.ts` gated by tenant, the role label in the avatar menu, a kitchen tablet never
keeps a platform, the "Activer le son" empty-state action, bottom-sheet chips on phones, a 4-slot phone bar picked by
permission, CSV file names without a brand, the pre-push grep, the Watchtower run button in the full view only.

Rejected: a staff env var and a page gate (identity logic, dead ends), the mode in localStorage (flash), Restaurants
under Settings, a separate platform chip in the header, editing `globals.css`, the word "Boutique", a `platform` URL
parameter (the APIs and rows say `channel`), an "À traiter" stat card (the bell and To-do already say it).

## 1. Rules that stay locked

- **Git:** never touch `main`. The owner merges and deploys.
- **Public repo:** no private notes, real store ids, emails, phone numbers or keys. Test fixtures use generic names
  (Marque A, LOC_1).
- **UI-level only**, with two small additive read-only API options: `channels=` on the command center and `locations=` on
  incidents. Not touched: webhooks, order writes, Clover, menu publish, the menu lock and its test.
- **Safety:** the new-order pop-up, the cancellation alarm, the nav badges, the bell, the pulse poll and `/kitchen`
  follow the location only. `alarmLocations()` is unchanged.
- **Words:** no round-the-clock strings; brands are real restaurants (never called anything else); no protected store
  shown specially (CLAUDE.md §4); no company name in new client strings (`useProduct()` / `withProductName`).
- **Language:** Québec French first through `t(fr, en)`; the EN switch stays.

## 2. Words (one word per idea)

| Idea | FR | EN | Replaces |
|---|---|---|---|
| Everything the person can see | Tous les restaurants | All restaurants | (kept) |
| A physical address (`locationCode`) | Succursale | Location | "Cuisine" in scope labels and Home |
| A restaurant brand | Marque | Brand | — |
| Uber Eats, DoorDash, SkipTheDishes, Too Good To Go | Plateforme | Platform | Canal |
| One brand × one location × one platform | Magasin | Store | — |
| The kitchen tablet screen | Écran cuisine | Kitchen screen | (kept; the only "cuisine") |
| The sold-out board | Épuisés | Sold out | Ruptures (86) |
| Things that need someone | À faire | To do | À traiter (Home) |
| Analytics group | Rapports → "Ventes et tendances" | Reports → "Sales & trends" | Analyses |

Code names do not change: `kitchen` stays the URL parameter and the field name.

## 3. Simple view and full view

- `lib/ui/view-mode.ts` (pure): `ViewMode`, `VIEW_COOKIE = 'fh_view'`, `parseViewMode`, `canUseFullView`,
  `effectiveViewMode` (kitchen tablet or no `stores:map` → simple), `viewCookie`.
- `app/(console)/layout.tsx` reads the cookie on the server and passes `mode` to `ViewerProvider`.
- `components/shell/viewer.tsx`: `full`, `canFull`, `setFull(on)` (writes
  `fh_view=full|simple; path=/; max-age=31536000; samesite=lax` + `secure` on https, then `router.refresh()`).
- **Default is simple for everyone**, the owner included. Owners and managers can switch; operators, menu editors,
  analysts and kitchen tablets always get simple.
- **The mode only hides links.** Permissions, APIs and addresses do not change; every page opens by its address and
  through ⌘K. The full view is today's console: `NAV`, the top bar, the Home details and every tab.

## 4. Scope: succursale → marque → plateforme

### 4.1 Model (`lib/foodhub/scope.ts`, pure, tested)
- `CHANNEL_PARAM = 'channel'`; `Scope` gains an optional `channel` (written only when set).
- `ScopeCatalog` gains `channels?` and `stores?: StorePoint[]` (`{ brandName, locationCode, channel }`, counts only).
- `parseScope`, `withScopeQuery`, `sameScope`, `readRemembered` handle the platform; a remembered value without one
  reads as "every platform".
- `isAllRestaurants` unchanged (no location, no brand). New `isEverything` (nothing at all) decides whether the address
  wins in `resolveScope`, so a link with only `?channel=` wins.
- `validScope` drops an unknown platform, one outside `catalog.channels`, and one with 0 stores for the picked location
  and brand, so a page is never empty because of the platform.
- `resolveScope`: a kitchen tablet keeps its location and always loses the platform.
- `inScope`: a row on another platform is out; a row without a platform (store grid line) passes.
- New: `inScopeLoose` (a row that names no location, brand or platform passes: alerts), `scopeChannels`, `countStores`,
  `channelCounts`, `channelsOf`, `channelName`.
- `brandRows` with a platform keeps the lines that have a store there, with that cell only.

### 4.2 Catalog (`lib/foodhub/viewer.ts`, `lib/foodhub/owner-seed.ts`)
- `ownerSeedStores()` returns the owner's DoorDash list only on the owner's own tenant (`DEFAULT_TENANT_ID`), `[]` on any
  other merchant's instance. Used by the viewer catalog and the command center.
- `viewerCatalog` adds `channels` and `stores` (mapped stores of the person's locations, Too Good To Go included; on the
  owner's tenant, list stores not mapped yet count as DoorDash stores).

### 4.3 Provider (`components/live/pulse.tsx`)
- `?channel=` synced like `kitchen` and `brand`, remembered under the same key.
- `setSite(patch)` merges into the current scope, then validates: `{ kitchen, brand }` keeps the platform,
  `{ channel: undefined }` clears it. The context adds `channels`.
- The pulse poll and the alarms stay on `alarmLocations(site, deviceKitchen)`.

### 4.4 Scope switcher (`components/shell/scope-switcher.tsx`)
- Trigger: platform mark, brand mark or store icon; title + the scope in words ("3 succursales · 45 magasins",
  "12 marques · 36 magasins", "Succursale 1 · DoorDash"). At most `52vw` wide on phones. A kitchen tablet sees a fixed
  label.
- Panel (dialog, Esc and outside click close it; a bottom sheet below `sm`): search grouped by location, brand and
  platform; platform chips with counts ("Toutes (45) · Uber Eats (15) · …", a chip with 0 stores is disabled, the panel
  stays open, hidden with fewer than 2 platforms); "Tous les restaurants (N magasins)" (keeps the platform); locations
  with their brands (one location: the brands directly); "Tout réinitialiser".

### 4.5 Filter chips (`components/shell/scope-chips.tsx`)
- `ScopeChips`: Succursale (hidden with one location), Marque, Plateforme (hidden with one platform); they edit the
  console scope. Active chip dark with ×; lists show counts; an `extra` slot for the page's own chips; "Tout effacer".
- `FilterChip`: a dropdown `w-[min(16rem,calc(100vw-2rem))]` that opens to the left near the right edge; a bottom-sheet
  `Modal` below `sm`.

### 4.6 Report filters (`lib/ui/range.ts`, `components/ui/filter-bar.tsx`)
- `useFilters(preset, scope, brandScope, channelScope)`: the scope's platform wins over the page's `channels=`.
- `FilterBar` gains `showChannels` and hides its platform picker by itself when the scope has a platform. `MultiPick`
  gets the same dropdown width fix.

### 4.7 What follows the scope

| Screen or behaviour | Location | Brand | Platform |
|---|---|---|---|
| Home: numbers, En cours, À faire, lists | ✓ | ✓ | ✓ |
| Orders: Actives, Planifiées, Historique | ✓ | ✓ | ✓ |
| Alerts list (loose) | ✓ | ✓ | ✓ |
| Sales & trends, Reports | ✓ | ✓ | ✓ |
| Restaurants → Tous les magasins | ✓ | ✓ | ✓ |
| Restaurants → Statut et pauses, Menus | as before | as before | — |
| Money | ✓ (unchanged) | — | — |
| **New-order pop-up, cancellation alarm, bell, nav badges, pulse poll, `/kitchen`** | ✓ | **never** | **never** |
| Kitchen tablet | locked to its location | as before | **always cleared** |

## 5. Navigation and shell

`components/shell/nav.ts`: `NAV` unchanged (full view). New: `NAV_SIMPLE`, `KITCHEN`, `SOLD_OUT`, `navFor`, `mobileNav`,
`allConsolePages` (both menus, Alerts, the Settings pages and the tab pages, filtered by permission, locations and
features). The Settings pages moved to `components/shell/settings-pages.ts` (plain data, with groups).

Simple rail: **Accueil · Commandes** (Toutes les commandes, Écran cuisine, Commandes directes when the delivery or
phone feature is on) **· Menus · Restaurants · Rapports** (Ventes et tendances, Argent for all-locations people)
**· Réglages**; then Aide and Réduire. Operators and kitchen tablets get Écran cuisine as entry 2. Copilote shows in the
full view only.

Phone bar: simple = the first 4 allowed of Accueil, Commandes, Épuisés, Restaurants, Rapports; operator / tablet =
Commandes, Cuisine, Épuisés, Restaurants; full = today's bar. Then "Plus": the other entries and their sub-pages,
Alertes, Aide, the language and text-size row, and the "Vue complète" switch.

Top bar (simple): switcher, search, bell, sound, FR/EN, avatar; the text-size button moves into the avatar menu (the
full view and kitchen tablets keep it in the bar). Avatar menu: name + role in words, language, text size,
"Vue complète (outils avancés)" for owners and managers, Mon profil, Se déconnecter / Verrouiller la tablette.

Logo follows the product name (default keeps the TAKATAK / FOOD HUB lockup). Banners: offline, stale and offline-tablet
bars for everyone; for admins in the simple view, "Pas encore en direct : rien n'est envoyé aux plateformes" (no env
var named); the full view keeps today's text and the demo bar.

e2e HTML checks kept true: `/` links to `/orders` and `/insights`, `/insights` links to `/money`; an operator never
sees `/insights` or `/money`; a manager limited to some locations never sees `/money`; `/orders` links to `/direct`
only when the feature is on. Home adds no link to `/insights` or `/money`.

## 6. Home (`app/(console)/page.tsx`, `overview.tsx`)

`page.tsx` is an async server component: owners and managers get `onboardingSteps()`.

1. Header: business day, "Aujourd'hui", "Bonjour, {prénom}. {scope in words}". The green live pill; the full view keeps
   the safe-mode pill.
2. "Pour bien démarrer" (`components/home/getting-started.tsx`): "{done} étapes sur 3", one button per step
   (simple view: Demander le branchement, a small form that sends a support report to the team; full view: Brancher mes
   magasins / Importer mon menu / Installer la tablette), hidden when done or after "Masquer" (a small link brings it
   back while steps remain).
3. Four numbers (2×2 on phones and laptops, 4 from `xl`): Ventes (± vs yesterday; "Ventes (livraison)" / "Ventes ({plateforme})"
   when narrowed; "dont X $ en salle (Clover)"), Commandes, Préparation (moyenne), Magasins (ouverts → Tous les magasins); every card is a link (Ventes → Historique, Préparation → Commandes); whole dollars from 1 000 $ so the number fits a phone card, 4 columns only from xl.
4. "En cours" and "À faire" (scoped alerts, count in the header, "Filtré : …" when narrowed).
5. "Par plateforme" (`components/live/platform-summary.tsx`), shown when no platform is picked; a tap picks it; an
   "En salle (Clover)" line when in-store sales exist.
6. The scope's list: Vos succursales → the brands of a location → one brand's platforms (only the picked platform).
7. Expansion tiles (unchanged).
8. "Voir plus de chiffres": sales by hour and top brands for everyone ("Magasin non relié" for unlinked orders);
   connections, store health and the recovery-password tip in the full view only.

Command center (`lib/foodhub/command.ts`, route): `channelKeys` option. Orders, open orders and stores are narrowed; the
store grid is built from every platform of the scope, then keeps the lines with a store on the picked platform; Clover
in-store sales are left out; `channelScoped: true`. Required platforms: Uber Eats + DoorDash + Skip on the owner's
tenant; on another tenant only those it uses. **Without `channels=` the output is unchanged** (tested).

## 7. Orders (`app/(console)/orders/orders-view.tsx`)

Header "Commandes", "Toutes vos plateformes, en direct. · mis à jour il y a N s", one action: "Écran cuisine". Tabs
**Actives (n) · Planifiées (n) · Historique** in `?view=` (`live` still opens Actives; `?view=history` and `?open=` keep
working). Filter row: `ScopeChips` + status pills with counts. Actives: the 4 lanes at `xl`, one list (newest step
first, with its step) below `xl` or when one status is picked. Planifiées: a grid. Historique: period, scope chips,
status, search and "Exporter (CSV)" (`commandes-{from}-{to}.csv`); a table from `md`, cards on phones. A line to
"Commandes directes" only when the delivery or phone feature is on. `useBoardOrders({ allBrands: true })` (the kitchen
screen) still ignores brand and platform; `kitchen-view.tsx` is not edited.

## 8. Restaurants → Tous les magasins (`app/(console)/stores/list/`)

Flat table of every platform store of the scope: status (dot + word), brand, platform, location (+ address), store
number (full view only), "Gérer" (opens Statut et pauses on that brand). Filters: scope chips, status, brand search.
Count line "45 magasins · 40 ouverts · 3 en pause · 2 désactivés". Deactivated first, then paused, then the rest, A–Z.
Pages of 25. Cards on phones. Footer: simple view "Il manque un magasin ? Ouvrez l'aide, on le branche pour vous.";
full view "Brancher un magasin". Store tabs: Statut et pauses · Tous les magasins · Heures d'ouverture; the full view
adds Branchement des magasins and Uber Eats. `/stores/list` is in the e2e screen list (32 screens).

## 9. Settings

`SETTINGS_PAGES` gain a group. The hub shows sections: Vos restaurants (links), Votre entreprise, Pour vous, Services en
plus, Outils avancés (full view; in the simple view one card "Pour votre technicien ou notre équipe" with "Passer à la
vue complète"). `SettingsHead`: "← Réglages" and only its group's tabs; an advanced page opened by address still
renders.

## 10. Alerts, Menus, Reports

`useScopedIncidents()` (`components/live/scoped-incidents.ts`) fetches `/api/foodhub/incidents?locations=…` and filters
brand and platform loosely; Home and Alerts use it. Alerts: "Filtré : … · Voir toutes les alertes", the product name in
the subtitle, "Vérifier maintenant" in the full view only. Menus: "Épuisés". The 86 board starts on the scope's brand and
location. Sales & trends and Reports pass the platform; the Activity tab shows in the full view only; the uptime table
says "Sans horaire".

## 11–12. Hidden in the simple view; text fixes; empty states

Hidden, not deleted (every address, ⌘K and the full view still reach them): Copilote, the text-size button in the bar,
Écran cuisine as a top entry (except operators and tablets), the safe-mode env text and the demo bar, Home's
connections, store health and recovery tip, the four technician settings, the store-connection and Uber Eats tabs, the
store number column, the Activity tab and the Watchtower run button.

Text fixes: neutral Business intro; the DoorDash settings page names no store; alcohol placeholder "Restaurant Exemple
inc."; the company name becomes the product name in Restaurants, Hours and the 86 board.

Empty states: no location → "Ajoutez votre première succursale." (Ajouter); a location without a brand → "Aucune marque
n'est encore branchée ici." (Voir les magasins); Actives → "Aucune commande en cours…" (Activer le son / Ouvrir l'écran
cuisine) or "Aucune commande en cours pour {scope}." (Voir tous les restaurants et plateformes); lane texts; Planifiées;
Historique ("Voir les 7 derniers jours", "Effacer les filtres", a link to Alerts); "Tout roule. Rien à faire.";
"Aucune alerte pour {scope}."; "Aucun magasin branché pour l'instant."; "Aucun magasin pour ce choix." (Tout afficher).

## 13–14. Phones and look

Bottom bar and "Plus" sheet; the switcher and chips open as bottom sheets; status pills scroll sideways; History as
cards; touch targets of 44 px. Cards: `rounded-md border border-line bg-surface`, no shadow. Navy rail, brand blue as the
single accent, Manrope; green, amber and red for status only. `globals.css` is not edited.

## 15–16. Files and tests

New: `lib/ui/view-mode.ts`, `lib/foodhub/owner-seed.ts`, `components/shell/{scope-chips.tsx,settings-pages.ts,use-wide.ts}`,
`components/live/{scoped-incidents.ts,platform-summary.tsx}`, `components/home/getting-started.tsx`,
`app/(console)/stores/list/{page.tsx,stores-list.tsx}`, `tests/{view-mode,console-nav}.test.ts`.

Tests: `tests/scope.test.ts` (platform parse/write/round-trip, unknown and 0-store platforms dropped, `?channel=` alone
wins, remembered values, tablet clears the platform, alarms ignore brand and platform, `inScope` / `inScopeLoose`,
45 stores / DoorDash 15, `brandRows` with a platform; command center: Uber-only scope, unchanged output without a
platform, another tenant never sees the owner's list); `tests/view-mode.test.ts`; `tests/console-nav.test.ts` (6 groups,
`NAV` unchanged, menus by role, phone bar, every e2e screen in search, features, forbidden words).

Required runs: `npm run typecheck`, `npm run lint` (0 errors), `npm test`, `rm -rf .next && npx next build --webpack`,
`npm run verify:foodhub` (with `FOODHUB_E2E_MOCK_PORT` / `FOODHUB_E2E_APP_PORT` when 4799/4800 are busy), and the
pre-push grep of the diff for the round-the-clock strings and the words that call brands anything but real restaurants.

## 18. Out of scope (follow-ups)

Direct and phone orders as a platform choice inside Orders; Money by brand or platform; a server-side staff permission
for advanced pages (the view mode is UI only); self-serve store mapping; plain words inside mapping, channels, go-live,
the DoorDash API page, the menu editor and money pages; theme tokens and dark mode; per-brand permissions; ratings,
reviews, ads and promotions screens; any platform write path or new integration; renaming URL parameters.

## 19. Risk and rollback

The platform field is optional, `setSite` merges, the default command-center path is unchanged and deep-equal tested,
the mode is read on the server (no hydration mismatch), alarms and the kitchen screen are untouched. Conflicts: PR #52
(`fix/console-kitchen-a11y`) also edits `console-shell.tsx` (keep its `isKitchenRoute` line); `docs/PROGRESS.md` (keep
both entries). **Rollback:** revert the PR; until then any owner or manager can switch to "Vue complète".

## 21. Env, migration, deploy

No new env var, no database migration. New functional cookie `fh_view` (UI preference). The owner reviews, merges and
deploys.

Env check before merge (`FOODHUB_TENANT_ID`): the owner's DoorDash list from screenshots and the rule that Uber Eats,
DoorDash and Skip are all required apply only on the owner's own instance, checked by `isOwnerTenant()`
(`lib/foodhub/tenant.ts`, used by `lib/foodhub/owner-seed.ts` and `requiredChannels` in `lib/foodhub/command.ts`).

- Unset, blank or `takatak` (any case): the owner's instance. Everything as today. This is the expected production value.
- Another valid id (e.g. `resto-laval`): another merchant. The owner's DoorDash rows are hidden from the store grid, the
  scope picker and the counts, and only the platforms with at least one mapped store are required. No crash. If the
  owner's own production had such a value by mistake, his DoorDash rows from screenshots would disappear and the
  "not connected" alerts would only cover platforms with a mapped store.
- Set but invalid (e.g. `Client X`, `client_x`): fails closed since 2026-10-17. Treated as NOT the owner (before, it
  silently fell back to `takatak` and would have shown the owner's store list on another merchant's instance), with one
  clear `[foodhub] FOODHUB_TENANT_ID "..." is not a valid tenant id` console warning per value. `tenantId()` (health,
  usage events) is unchanged. Tests: `tests/tenant.test.ts`, `tests/scope.test.ts`.

## 22. Build status (2026-10-16)

All P0, P1 and P2 items above are built on the branch, which also carries `origin/main` 12ba64d (merged in; only
`docs/PROGRESS.md` needed a hand merge, both entries kept).

Review fixes (all majors and the minors), on top of f3ed70a:
- Home numbers fit a phone card (size follows the screen, whole dollars from 1 000 $, labels wrap, 4 columns only from
  `xl`); every card is a link. Contrast: lane empty texts, "mis à jour" and counts in ink-3, To-do badge dark on amber,
  paused note in ink-2 with an amber dot, "Vue complète" switch outlined when off.
- Get started: in the simple view the stores step is "Demander le branchement" (`components/home/connect-request.tsx`,
  platforms + note, sent as a support report); the same button on an empty Tous les magasins; "Masquer" can be undone.
- Restaurants → Statut et pauses follows the platform: "Tout mettre en pause sur DoorDash" pauses only the DoorDash stores
  (`storesOfLocation`, tested), the dialog and a note say so. Alerts: the `/alerts?i=` link from a text or chat always
  shows its alert whatever location the device remembers (`scopedAlerts`, tested); a location-only scope shows
  "Filtré" and "Voir toutes les alertes" clears it.
- Accessibility: filter chips use the disclosure pattern (labelled group, `aria-pressed`), 44 px clear / back / close
  targets, platform chips and status pills wrap on phones, the Plus sheet closes on Esc and moves the focus, the scope
  popover is not modal and gives the focus back, History rows open by keyboard and the search has a label.
- Words: Épuisés / Sold out everywhere on the sold-out page and its help; "Rapports détaillés" and "Journal d'activité"
  get their own titles; plain status names; "1 à 25 sur 45"; "commandes" not "cmd"; product name in Alerts; "Mes
  restaurants" the same in the button and the panel; simple-view banners in plain words (go-live link, temporary data,
  email not turned on).
- Data: Planifiées also lists open orders placed more than 48 h ahead (`openAlso=1`); History ignores old `?channels=`
  links; with a platform picked, locations and brands without a store there cannot be picked; a platform with orders
  but no linked store is a plain row; `missing:<platform>` alerts are counted before the platform trim (tested).

Checks on the branch after the review fixes:
- `npm run typecheck`: OK.
- `npm run lint`: 0 errors (1 old warning in `settings/devices/page.tsx`, a file this branch does not touch).
- `npm test`: 983 passed, 1 skipped, 1 failed of 985. The failure is `tests/tgtg-email.test.ts` (forged Too Good To Go
  sender case), which also fails on `origin/main` 12ba64d; this branch touches no Too Good To Go, mail or pipeline file.
- `rm -rf .next && npx next build --webpack`: OK.
- `npm run verify:foodhub` (ports 5991 / 5992): 554 passed, 0 failed, including "32 screens return 200" and the old
  bookmarks.
- Pre-push grep of the diff: no round-the-clock string and no word calling a brand anything but a real restaurant on an
  added line; no e-mail, phone number, store or merchant id, nothing from `private/`.

Not done: screenshots at 375 / 1440 px for the reviewer (the console needs a sign-in; take them with the owner's
session or the local demo).
