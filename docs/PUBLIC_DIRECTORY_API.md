# Public directory feed (ON2GO.ca, QMAPS, partners)

`GET /api/public/directory` returns the restaurant directory as JSON. No sign-in. Public facts only.

| What | Detail |
|---|---|
| Who reads it | ON2GO.ca (rebuilt by GitHub Actions on a schedule), QMAPS, partners |
| Cache | 5 min in the server, `Cache-Control: public, max-age=300, stale-while-revalidate=3600` |
| CORS | on2go.ca, www/preview.on2go.ca, qmaps.ca, www.qmaps.ca, localhost; more with `FOODHUB_PUBLIC_CORS_ORIGINS` |
| Code | `lib/foodhub/public-directory.ts`, route `app/api/public/directory/route.ts`, tests `tests/public-directory.test.ts` |
| Base data | `data/public/directory-seed.json` (17 brands, 2 kitchens, 10–12 dishes each), built by `scripts/public-directory/build-seed.mts` |

## What it contains

- `kitchens[]`: NDG (6280 Av Somerled, H3X 2B6) and Saint-Léonard (5839 Rue Jean-Talon E, H1S 1M4): address, map point,
  weekly hours, `openNow`, `openLate`, phone (only when `FOODHUB_PUBLIC_PHONE` is set), the brands cooked there.
- `brands[]`: name, other names, categories, cuisine, description and about text (FR + EN), official website (+ `live` when
  the site answers with the brand's own page), colour, `featured`, and per kitchen: hours, open now / late, order links.
- `order[]` per kitchen: Clover online ordering first (`FOODHUB_PUBLIC_CLOVER_ORDER_URL`), then the delivery apps' public store
  pages (Uber Eats, DoorDash), live ones first. `live: false` = the store exists but is not visible on the app today.
- `dishes[]`: Clover item id, name FR/EN, counter price (CAD), photo (Food Hub media when the master menu has one), `deal`
  (meals to share), `available`.
- `trending[]`: brand ids ranked by Food Hub orders over 7 days (3 orders minimum). A rank only, never a count.
- `source`: `live` when hours or the menu came from the database, `seed` otherwise.

Never in the feed: orders, customers, totals, payouts, merchant ids, tokens, store meta, staff notes. Po Poulet NDG (DoorDash)
is never linked (owner's order; the test checks the seed and every link).

## Where the values come from

| Value | Live source (wins) | Fallback |
|---|---|---|
| Hours | Settings → Hours (brand override, then location; holidays close the kitchen) | Uber Eats Manager hours of 2026-10-07 in the seed |
| Dish name, price, photo, availability | Master menu item with the same Clover id (`posItemRef`) | Clover export of 2026-10-07 in the seed |
| Order links | seed (`data/public/directory-seed.json`) | |

## Snapshot for a site that is not connected yet

Same function as the route, seed values only:

    PUBLIC_DIRECTORY_SNAPSHOT=../on2goca/data/directory.json npx vitest run tests/public-directory.test.ts

## Changing a brand

Edit the brand in the pppmtl multi-brand config, then rebuild the seed:

    PPPMTL_DIR=../pppmtl node --experimental-strip-types scripts/public-directory/build-seed.mts data/public/directory-seed.json
    npx vitest run tests/public-directory.test.ts
