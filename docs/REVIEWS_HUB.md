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
*Confirmer l'import*. Max 5 MB per file. The same review imported twice is kept once (id = platform review id, else
platform + store + order + date + stars), and an import **never overwrites** the reply state already saved.

Brand and kitchen: the platform store id mapped under Stores → Mapping first, then the store name
(`lib/foodhub/brand-match.ts`: brand names and aliases, civic number or neighbourhood). A review with no brand found is
still kept and shown as *Marque inconnue*.

## Protected stores

Po Poulet NDG on DoorDash is never touched: the Reporting API never asks for it, `withoutProtectedRows` removes its rows
from the downloaded file, and the reviews hub drops it **again** at ingestion (`FORBIDDEN_STORE_IDS` + every store the
menu lock protects, also when a mapped store carries the protected DoorDash number). The same rule applies to a DoorDash
file imported by hand.

## Privacy

No personal data is kept:

- columns naming or reaching a person are never read: customer / reviewer name, e-mail, phone, address, profile, and
  every courier field (name, rating);
- e-mail and phone-like strings inside the review text are masked (`[courriel]`, `[téléphone]`) before saving;
- drafts are rejected if they contain an e-mail or a phone number, or name a courier.

## Themes

Plain French / English keyword buckets, accents and case ignored (`themes.ts`): froid / cold, retard / late, manquant /
missing, erreur / wrong order, portion, goût / taste, emballage / packaging, prix / price, accueil / friendly, rapide /
fast. The language of each review (fr / en) is detected the same simple way; Québec French is the default.

## Replies (drafts only)

1. *Proposer* (one review) or *Proposer pour les avis sans réponse* (at most 25, one after the other).
2. Claude (existing `askClaude`, `ANTHROPIC_API_KEY`) writes for the restaurant team of the brand, a real
   brick-and-mortar restaurant in Montréal, in the review's language, at most 600 characters, no emojis: thanks, the
   specific point, an invitation to contact the restaurant. Without the key, built-in FR / EN templates (by stars and
   main theme) are used.
3. **Guard** (`guardDraft`): a draft is thrown away and replaced by a template when it names another delivery platform
   (a DoorDash reply never names Uber Eats, Skip or Too Good To Go, and the reverse; Food Hub and Clover may be named),
   promises a refund, credit, discount or any compensation (the AI never approves money), says virtual / ghost /
   fantôme, 24 h or 24/7, contains personal data, names a courier, or is too long.
4. Read and edit the draft, *Copier*, paste it in **that platform's portal, for that store**, from the account's own
   e-mail. Then *Marquer comme répondu*.
5. DoorDash lets the restaurant answer for **7 days**: the card shows the days left (informational).

## API (signed in)

| Route | Permission | |
|---|---|---|
| `GET /api/foodhub/reviews` | `analytics:view` | Filters `brand, platform, kitchen, stars, unanswered, theme, from, to`; list + summary; only the person's kitchens. |
| `POST /api/foodhub/reviews/import[?dryRun=1]` | `menu:edit` | multipart `file` (+ `platform`, `mapping`, `brandName`, `locationCode`). |
| `GET/POST /api/foodhub/reviews/doordash` | `menu:edit` | `{ action: 'request', from, to }` / `{ action: 'ingest', reportId }`; all-kitchens people only. |
| `POST /api/foodhub/reviews/[id]` | `menu:edit` | `{ action: 'draft' \| 'replied' \| 'clear' }`. |
| `POST /api/foodhub/reviews/drafts` | `menu:edit` | batch drafts (max 25). |
