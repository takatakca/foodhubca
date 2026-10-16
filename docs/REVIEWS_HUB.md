# Avis et notes / Reviews hub

Page: **`/insights/reviews`** (direct URL; the Insights tab is added separately: `{ href: '/insights/reviews', label: t('Avis', 'Reviews') }`
in `app/(console)/insights/insights-tabs.tsx`).

The customer reviews of every brand and every kitchen in one place: average rating, number of reviews, 1–5 star
breakdown, 7 / 30 / 90-day trend, reviews waiting for a reply, themes, and reply drafts. **Food Hub never posts a reply on
any platform.** A person copies the draft into the platform's own portal, store by store, then taps *Marquer comme
répondu*.

Code: `lib/foodhub/reviews/` (model, themes, stores, doordash-feedback, import, summary, drafts, query), API under
`app/api/foodhub/reviews/`, page `app/(console)/insights/reviews/`. Stored in the existing documents collection
(`fh_docs`, collections `reviews` and `review_imports`): **no migration**. No new dependency.

## Sources

| Platform | How the reviews come in | What to export |
|---|---|---|
| DoorDash | **Avis DoorDash** card: choose dates → *Demander le rapport* → wait (up to ~5 min) → *Importer les avis*. Uses the existing Reporting API code (`requestDoorDashReport`, report type `CONSUMER_FEEDBACK`): its credentials, sandbox refusal and protected-store guards apply. | Nothing to export by hand. Needs the Reports integration key (`DOORDASH_REPORTS_DEVELOPER_ID` / `_KEY_ID` / `_SIGNING_SECRET`) or the Marketplace key. |
| Uber Eats | **Importer des avis** card (CSV / XLSX). | Uber Eats Manager → Customers / Ratings and reviews → export. Columns such as *Order UUID, Store, Rating, Comment, Date* are recognized. |
| SkipTheDishes | Same card. | Restaurant portal → reviews / ratings export (*Order Number, Restaurant, Rating, Comment, Date*). |
| Too Good To Go | Same card. | TGTG store portal → ratings export (*Store, Rating, Comment, Pickup date*). |
| Google | Same card: Business Profile CSV, or the **Google Takeout** JSON. | Takeout → Google Business Profile → the location's `reviews.json` (stars as `FIVE`…`ONE`, existing owner replies count as answered); a Maps `Reviews.json` (GeoJSON) also works. |
| Anything else | Same card, platform *Autre*: when the columns are not recognized, choose which column holds the date, the stars, the comment, the store / brand and the order. | — |

Every import shows a **preview first** (first 20 rows, new / already there / skipped), and saves only after
*Confirmer l'import*. Max 5 MB per file (a bigger body is refused before it is read). The same review imported twice
is kept once (id = platform review id, else platform + store + order + date + stars, plus a hash of the text when there
is no order id either, so two same-day reviews with the same stars stay two reviews; identical star-only rows of one
file are numbered), and an import **never overwrites** the reply state already saved. Changing the platform after a
preview clears the preview.

Column guesses: a store id column is preferred to a store name column (both are read); "Order Date", "Order Total" or
"Order Rating" are never the order; the overall rating is preferred and food / packaging / item / courier sub-ratings
are never the stars.

Brand and kitchen: the platform store id mapped under Stores → Mapping first, then the store name
(`lib/foodhub/brand-match.ts`: brand names and aliases, civic number or neighbourhood). A review with no brand found is
still kept and shown as *Marque inconnue*.

## Protected stores

Po Poulet NDG on DoorDash is never touched: the Reporting API never asks for it, `withoutProtectedRows` removes its rows
from the downloaded file, and the reviews hub drops it **again** at ingestion (`FORBIDDEN_STORE_IDS` + every store the
menu lock protects by id, also when a mapped store carries the protected DoorDash number). At ingestion the rule does not
trust the detected platform nor the mapped columns:

- a row with the protected store number in **any** column is dropped, whatever the file name or platform;
- the store reference and the store name are both checked; an unknown-platform file's ids are looked up on every
  platform's mapping;
- a DoorDash or *Autre / Other* row known only by name (or by the brand / kitchen chosen for the whole file) is dropped
  when it can be the protected store: same brand, and the same kitchen or no kitchen found. The brand and kitchen come
  from the protected store's Stores → Mapping entry, else from the built-in menu-lock label (Po Poulet, NDG kitchens).
  Google reviews of the restaurant itself are not DoorDash data and are kept (choose *Google* as the platform).

The preview shows how many rows of a protected store were left out.

## Privacy

No personal data is kept:

- columns naming or reaching a person are never read: customer / reviewer name, e-mail, phone, address, profile,
  customer / consumer / eater / user ids (also written `customer_id`, `consumerId`), and every courier field (name,
  rating); Google Takeout records go through `stripPersonal` before anything is read;
- e-mail and phone-like strings inside the review text are masked (`[courriel]`, `[téléphone]`) before saving;
- drafts are rejected if they contain an e-mail, a phone number, a link, a person's name (a greeting with a name, or a
  name taken from the review) or name a courier.

## Themes

Plain French / English keyword buckets, accents and case ignored (`themes.ts`): froid / cold, retard / late, manquant /
missing, erreur / wrong order, portion, goût / taste, emballage / packaging, prix / price, accueil / friendly, rapide /
fast. The language of each review (fr / en) is detected the same simple way; Québec French is the default.

## Replies (drafts only)

1. *Proposer* (one review) or *Proposer pour les avis sans réponse* (at most 25, one after the other).
2. Claude (existing `askClaude`, `ANTHROPIC_API_KEY`) writes for the restaurant team of the brand, a real
   brick-and-mortar restaurant in Montréal, in the review's language, at most 600 characters, no emojis: thanks, the
   specific point, an invitation to contact the restaurant. The review text is sent between `<review>` tags as
   untrusted customer data, never instructions. Without the key, built-in FR / EN templates (by stars and main theme)
   are used.
3. **Guard** (`guardDraft`): a draft is thrown away and replaced by a template when it names another delivery platform
   (a DoorDash reply never names Uber Eats, Skip or Too Good To Go, and the reverse; Food Hub and Clover may be named),
   promises a refund, credit, discount or any compensation, in money or in kind (replaced or re-sent order, "sur nous" /
   "on us"; the AI never approves money), says virtual / ghost / fantôme, 24 h, 24/7, "jour et nuit" or
   "vingt-quatre heures", contains a link or personal data (a name too), names a courier, or is too long.
4. Read and edit the draft. The edited text is **saved** (on leaving the box, and before *Copier* or *Marquer comme
   répondu*) through the same guard: a draft that breaks a rule is refused with the reason, and nothing is copied.
   *Copier*, paste it in **that platform's portal, for that store**, from the account's own e-mail. Then *Marquer comme
   répondu*.
5. DoorDash lets the restaurant answer for **7 days**: the card shows the days left (informational).

## API (signed in)

| Route | Permission | |
|---|---|---|
| `GET /api/foodhub/reviews` | `analytics:view` | Filters `brand, platform, kitchen, stars, unanswered, theme, from, to`; list + summary; only the person's kitchens. |
| `POST /api/foodhub/reviews/import[?dryRun=1]` | `menu:edit` | multipart `file` (+ `platform`, `mapping`, `brandName`, `locationCode`). |
| `GET/POST /api/foodhub/reviews/doordash` | `menu:edit` | `{ action: 'request', from, to }` / `{ action: 'ingest', reportId }`; list, request and import: all-kitchens people only. |
| `POST /api/foodhub/reviews/[id]` | `menu:edit` | `{ action: 'draft' \| 'replied' \| 'clear' }`, or `{ action: 'save', draft }` (guarded, 422 with `reasons` / `reasonsFr` when refused). |
| `POST /api/foodhub/reviews/drafts` | `menu:edit` | batch drafts (max 25). |

Refusals and messages carry a French text next to the English one (`errorFr` / `messageFr`); the console shows the
French one first.
