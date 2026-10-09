# Quadro Holding restaurant marketing and visibility plan

Owner's goal (2026-10-09): the strongest possible search visibility and order flow for every brand, managed from the
TAKATAK V1 back end. Built on: `PRESENCE.md`, `NAP.md`, `GBP_CHANGES.md`, `PLATFORMS.md`, `docs/TAKATAK_BRANDS_BRIDGE.md`.
Public facts only; private steps live in Drive "TAKATAK OPS (private)".

> **Pour le propriétaire (résumé).** On répare d'abord les bases (magasins DoorDash en ligne, une seule adresse et un seul
> horaire par cuisine, enseigne ou zone de service pour chaque marque). Ensuite Google, Apple, Bing, Yelp, TripAdvisor et
> Facebook, une marque à la fois, avec les textes déjà prêts. Puis une page de commande par marque (cueillette au prix du
> comptoir, puis les applications), Skip et Too Good To Go, les annuaires canadiens, les avis et les photos. La publicité
> Google seulement quand les magasins sont en ligne et que les commandes se mesurent.

## 1. Where we are (2026-10-09)

- 17 brands, 2 kitchens in the brand config: NDG (6280 Somerled) and Saint-Léonard (5839 Jean-Talon E). The old Hochelaga
  kitchen looks moved.
- DoorDash: every store switched to tablet on 2026-10-08. Most stores are inactive. 5 "not eligible" notices on
  2026-10-08. Poulet Express (Poulet Poulet, NDG) is still on the old POS.
- Google: 7 known profiles (cid) for 17 brands x 2 kitchens. A stale "PPP Pizzeria 24/7 Montréal Nord" listing is still
  copied around the web. No code can edit Google profiles yet (read-only connector).
- Own ordering: Food Hub's public directory feed is on `main`. ON2GO brand pages and the brand sites' store pages are
  built but not merged. No Clover pickup link is set yet. No Skip and no Too Good To Go stores.
- TAKATAK V1: workspaces per brand are planned (setup script ready, waiting for access and a plan per workspace). Social
  and Google connectors only read today.

## 2. Principles

1. **One truth per fact.** Name, address, hours, links are decided once (Drive 02 APPROVED_VALUES) and copied
   everywhere; Food Hub Settings → Hours is the hours source.
2. **Google's rules first.** Each brand at each kitchen is either a storefront (own sign + pickup for everyone, address
   shown) or a delivery brand (address hidden, service area). No duplicates, no keywords in names, never "24/7".
3. **Own orders first.** Every link points first to the brand's own pickup page (walk-in price, no commission), then to
   the apps.
4. **One agent per account, everything logged.** No two agents in the same Google, DoorDash or social account; every
   change written as before → after.
5. **Measure before paying.** Ads only when stores take orders and the order click is measured.

## 3. Roadmap

### Phase 0: foundations (owner decisions, this week)
- [ ] DoorDash: owner calls about the 5 "not eligible" notices; Gerardo confirms Poulet Express and the missing stores.
- [ ] Decide per kitchen: address (6280 vs 6284, 5837 vs 5839), Hochelaga closed or moved, hours.
- [ ] Decide per brand and kitchen: storefront (A) or delivery brand (B) (`NAP.md` §1).
- [ ] Decide the "Order online" target: Clover pickup page, ON2GO brand page or brand-site store page.
- [ ] Turn on Clover Online Ordering; merge the ordering pages (ON2GO, brand sites); deploy Food Hub `main`.

### Phase 1: the big six profiles (one brand at a time, `GBP_CHANGES.md`)
1. Google Business Profile: claim/verify, name, categories, description, links, attributes, photos, first post.
   Close or fix stale listings (Montréal-Nord, Hochelaga).
2. Apple Business Connect. 3. Bing Places (import from Google). 4. Yelp. 5. TripAdvisor.
6. Facebook Page + Instagram per brand (one order link).

### Phase 2: ordering everywhere
- One order hub page per brand: pickup at the counter price first, then Uber Eats, DoorDash, Skip, Too Good To Go.
- Join SkipTheDishes (no brand there today) and Too Good To Go (end-of-night bags).
- Google "Order online": set the preferred provider to our own page; remove unwanted auto-added providers.
- Optional: DoorDash Storefront for delivery from our own site; Uber Direct / DoorDash Drive for our own orders.

### Phase 3: citations (`PLATFORMS.md` D1)
- Yellow Pages network once (YellowPages.ca, PagesJaunes.ca, Canada411.ca, Canpages.ca), 411.ca, Foursquare, Data Axle,
  then Restaurant Guru, Restaurantji, BBB, Tourisme Montréal.

### Phase 4: content and reputation (weekly, ongoing)
- 1 Google post per brand per week (first 4 ready in `GBP_CHANGES.md`); new dish photos monthly.
- Reply to every review within 48 h (templates ready); ask every customer for a review the same way (QR on the bag,
  never only happy customers, never a reward).
- schema.org on every brand site: Restaurant, address, hours, menu, OrderAction, sameAs (Google cid, Yelp, TripAdvisor,
  Facebook, Instagram).

### Phase 5: paid (only after Phase 0-2)
- Google Ads per brand at a small daily budget (owner's $1/day plan to confirm), local radius around each kitchen,
  late-evening schedule, sending to the brand's order page; conversion = order click + Clover pickup order.
- Meta ads for the strongest 3 brands; Uber/DoorDash in-app promotions only when the store is live.

## 4. What the TAKATAK V1 back end covers today (and gaps)

| Need | In TAKATAK V1 today | Gap |
|---|---|---|
| One workspace per brand, admin over all | Clients, brands, locations, invitations, workspace switcher | Setup script ready (task 20); needs access + a plan per workspace |
| Google profile management | Read-only GBP connector | Write (hours, texts, photos, order link) not built; two GBP code paths to merge |
| Local listings dashboard | Pages exist, data is mock | Connect to real listings |
| Social posting | Connect + read (Facebook, Instagram, TikTok...) | Publishing not built |
| Google Ads | Connect + list accounts | Campaigns, reporting, conversions not built |
| Hours | Not in V1 | Stay in Food Hub (one source) |
| Brand facts on takatak.ca | `/ecosystem` page hidden by rule | Owner decision (bridge note §6) |

## 5. Measuring (monthly, per brand)

Google: profile views, calls, direction requests, order clicks · Orders by channel (own pickup vs each app) · Reviews:
count, average, reply rate · Listings: share with correct NAP · Ads: cost per order.

## 6. Owner decisions (all in one place)
Drive "TAKATAK OPS (private)" > 04 QUESTIONS FOR THE OWNER, plus `docs/TAKATAK_BRANDS_BRIDGE.md` §6.
