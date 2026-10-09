# Visibility work queue (one agent at a time, nonstop loop)

Owner's goal (2026-10-09): maximum search visibility for every Quadro Holding restaurant brand. Google first, then every
food-ordering platform / aggregator and every directory (411, Yelp, TripAdvisor, Pages Jaunes...), all linked together,
written up as the group's restaurant marketing plan for the TAKATAK V1 back end.

Rules for the agent working this queue
- **One agent at a time** (owner's order: parallel agents used up the account's limits). No workflows, no fan-out.
- Public facts only in this folder (public repo): no emails, people's phone numbers, logins, case numbers, merchant ids.
  Private notes go to the owner's Drive folder "TAKATAK OPS (private)".
- Never log in, never type a password, never change a live listing from here. Research and prepare; the owner (or a
  desktop session with Claude in Chrome) applies changes, one account at a time, logged in the Drive OPS_LOG.
- Po Poulet NDG on DoorDash (store 27982486) is never linked anywhere.
- Never write "24/7". Hours are not final (see Drive 02 APPROVED_VALUES).
- Blocked on an item? Write why in its line, move to the next item. Push after every item.

Status: `todo` / `doing` / `done` / `blocked: reason`. Newest work at the top of each file it touches.

## P1 Google (prepare everything so it can be applied page after page)
- [ ] G1 doing (table from code done 2026-10-09; live checks blocked: this cloud session's network reaches no listing site, only web search; owner can allow more domains in Network access or a desktop session can check) | Google Maps inventory per brand x kitchen: listing found? name, address, category, website, order link, rating, review count, open/closed flag -> `PRESENCE.md`
- [x] G2 done 2026-10-09 (draft, waits for owner decisions on 6280/6284, 5837/5839, Hochelaga, names, hours; includes Google's multi-brand eligibility rules) | Standard NAP (name, address) per kitchen and naming rule per brand -> `NAP.md`
- [x] G3 done 2026-10-09 (17 brands: name, proposed categories, FR/EN description <= 750 chars from the owner's brand copy, links, known profiles; hours and A/B listing type wait for the owner) | Google Business Profile target values per brand (title, primary + extra categories, FR/EN description <= 750 chars, website, menu link, order link candidates, attributes: takeout, delivery, late night) -> `GBP_CHANGES.md`
- [x] G4 done 2026-10-09 (4 posts per brand from the owner's copy; post 4 waits for hours; review-reply templates FR/EN with policy rules) | Google posts plan (first 4 posts per brand) and review-reply templates FR/EN -> `GBP_CHANGES.md`

## P2 Food ordering platforms and aggregators (Montréal / Canada)
- [x] F1 done 2026-10-09 (marketplaces, own ordering, order buttons, delivery fleets, consolidation, Québec commission context; 'verify' items need the platform's own page) | List every platform that can take or route food orders (delivery apps, pickup apps, surplus food, Google/Apple/Meta order buttons, storefronts, own-delivery fleets) with how to join or connect, fees model if public, and whether Food Hub/Clover can integrate -> `PLATFORMS.md`
- [ ] F2 doing (done: PPP Pizzeria, OOEUF, Pi Pita, Pita Libanais, Mythos & Go, Nutrition Shake, Bin Molle & Bin Dure, OCRÊPE, Gâteau Montréal, Taco Mexican, Pizza Inntime, Pizza Algérie, Po Poulet (Saint-Léonard); next: Poulet Poulet, then Café Bolon, Place Afrique, Déjeuner Montréal) | Per brand: which of those platforms it is on today (public URL) -> `PRESENCE.md`

## P3 Directories and citations (SEO)
- [x] D1 done 2026-10-09 (tiers, who feeds whom, Yellow Pages network, Apple/Foursquare/Yelp/TripAdvisor chain; 'verify' items) | List of directories and data aggregators that matter in Montréal/Canada (Apple Business Connect, Bing Places, Yelp, TripAdvisor, 411.ca, Canada411, Pages Jaunes/YellowPages.ca, Foursquare, Facebook, Instagram, TikTok, Restaurant Guru, Restaurantji, Waze...), how to claim each, and which feed others -> `PLATFORMS.md`
- [ ] D2 doing (same brand order as F2) | Per brand: listings found on those directories (public URL), NAP mismatches -> `PRESENCE.md`

## P4 The plan
- [x] M1 done 2026-10-09 (phased plan, principles, back-end coverage, KPIs) | `PLAN.md`: the group's restaurant marketing and visibility plan (channels by priority, NAP standard, one order hub per brand, review strategy, schema/SEO, photo plan, ads only after stores are back online, measurement, what TAKATAK V1 modules cover each part, owner decisions)

## P5 Recurring
- [ ] R1 | last check 2026-10-09 15:45 UTC (new DoorDash POS-integration case for one store, opened outside this session: flagged to the owner in Drive) | Every ~1 h: check the owner's Gmail for new DoorDash email (thread ref in Drive OPS_LOG); record in Drive, never reply without the owner.
- [ ] R2 | TAKATAK V1 setup script: written and checked (typecheck clean, lint 0 errors, 18/18 + 8/8 tests, secrets clean) on takatak-v1 local branch `claude/provision-brand-workspaces` (a39e9a1, not pushed: no write access). Backup: `docs/patches/takatak-v1-provision-brand-workspaces.patch` (`git am` it on takatak-v1 origin/main b3282f3). Still to do, one reviewer at a time, when the Google items are done: security, correctness, runs-outside-Next reviews + fixes (resume the workflow script `takatak-provision-script`). Brand-section note: done (`docs/TAKATAK_BRANDS_BRIDGE.md`).
