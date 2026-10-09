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
- [x] F2 done 2026-10-09 (all 17 brands, web search only: listing sites cannot be opened from this session; findings newest first in PRESENCE.md) | Per brand: which of those platforms it is on today (public URL) -> `PRESENCE.md`

## P3 Directories and citations (SEO)
- [x] D1 done 2026-10-09 (tiers, who feeds whom, Yellow Pages network, Apple/Foursquare/Yelp/TripAdvisor chain; 'verify' items) | List of directories and data aggregators that matter in Montréal/Canada (Apple Business Connect, Bing Places, Yelp, TripAdvisor, 411.ca, Canada411, Pages Jaunes/YellowPages.ca, Foursquare, Facebook, Instagram, TikTok, Restaurant Guru, Restaurantji, Waze...), how to claim each, and which feed others -> `PLATFORMS.md`
- [x] D2 done 2026-10-09 (all 17 brands via web search; direct checks of Yelp, 411, Pages Jaunes, TripAdvisor pages wait for network access, same as G1) | Per brand: listings found on those directories (public URL), NAP mismatches -> `PRESENCE.md`

## P4 The plan
- [x] M1 done 2026-10-09 (phased plan, principles, back-end coverage, KPIs) | `PLAN.md`: the group's restaurant marketing and visibility plan (channels by priority, NAP standard, one order hub per brand, review strategy, schema/SEO, photo plan, ads only after stores are back online, measurement, what TAKATAK V1 modules cover each part, owner decisions)
- [x] M2 done 2026-10-09 (`PLAN.md` §7: 17 ranked fixes in 5 groups) | Ranked cross-brand fix list from the F2/D2 findings (stale listings from old kitchens, name and address conflicts, duplicate store numbers, name-vs-menu problems, owner decisions), so the owner or a desktop session can apply fixes one account at a time -> `PLAN.md`

## P4b Ready-to-paste content (added 2026-10-09 after F2/D2; web search and brand config only)
- [x] T1 done 2026-10-09 (17 brands FR/EN + order-page pattern; lengths checked; names waiting for the owner are flagged) | SEO title (<= 60 chars) and meta description (<= 155 chars) FR/EN per brand site and order page, from the brand config and the F2/D2 findings (cuisine + neighbourhood words, no "24/7") -> `SEO_TITLES.md`
- [x] C1 done 2026-10-09 (17 brands x 5 profiles FR/EN, lengths checked; brands whose name waits for the owner are flagged: no accounts for them yet) | Short bios per brand FR/EN sized for each profile: Instagram 150, X 160, TikTok 80, Facebook intro 101, Yelp/Apple short text; one order link each -> `SOCIAL_BIOS.md`
- [x] S1 done 2026-10-09 (17 JSON-LD blocks, valid JSON; brand + one node per kitchen; hours, order URL and address numbers wait for the owner, as listed at the top of the file) | schema.org JSON-LD per brand (Restaurant/FoodEstablishment, address per kitchen, servesCuisine, menu, hasMap, sameAs, potentialAction OrderAction; hours left as a placeholder) -> `SCHEMA.md`
- [x] K1 done 2026-10-09 (dish terms FR/EN per brand, area lists per kitchen, negatives, 5 overlaps to settle; no volumes: Keyword Planner needs the Ads account) | Local search terms per brand x neighbourhood FR/EN (what people type, from the competitor findings) for posts, titles and later Google Ads -> `KEYWORDS.md`

## P4c Apply kits (added 2026-10-09; for the owner or a logged-in desktop session, one account at a time)
- [x] A1 done 2026-10-09 (prerequisites, order of work, 13 steps per profile with source file and check, logging, then Apple/Bing/Yelp/TripAdvisor) | Google Business Profile apply checklist, page after page: order of brands, each field with its source file, what to check after saving, what to log in Drive -> `GBP_APPLY.md`
- [x] H1 done 2026-10-09 (shared FR/EN copy + button matrix for 17 brands from PRESENCE.md; 8 live Uber Eats buttons, 1 live DoorDash button (Nutrition Shake NDG), the rest wait for owner checks) | Order hub page copy per brand FR/EN (pickup at the counter price first, then the apps that carry the brand, then Too Good To Go), never Po Poulet NDG's DoorDash store -> `ORDER_HUB.md`
- [x] Q1 done 2026-10-09 (rules per platform incl. Yelp "don't ask", review links, bag card FR/EN, other moments, replies) | Review kit: bag card / QR text FR/EN, how to get each profile's review link, rules (ask everyone, no reward, no gating) -> `REVIEWS.md`
- [x] P2 done 2026-10-09 (rules, sizes per place, file names, cover + 5 dishes per brand from the brand copy; OneDrive sorting waits for the Microsoft connector) | Photo shot list per brand (cover, logo, 5 dishes, kitchen, packaging), sizes per platform, file naming; OneDrive photos once the Microsoft connector is on -> `PHOTOS.md`
- [x] AD1 done 2026-10-09 (NOT launched: 5 gates, structure per kitchen, RSA text FR/EN for 8 first-wave brands, lengths checked, measuring) | Google Ads draft per brand (not to launch: owner waits until stores are back online): campaign type, radius per kitchen, schedule placeholder, budget placeholder, ad text FR/EN, conversion = order click -> `ADS_PLAN.md`

## P5 Recurring
- [ ] R1 | last check 2026-10-09 16:46 UTC (no new DoorDash mail since 15:45; still no answer from DoorDash support to the 2026-10-09 01:45 follow-up; the 13:48 POS-integration notice for one store is already flagged in Drive) | Every ~1 h: check the owner's Gmail for new DoorDash email (thread ref in Drive OPS_LOG); record in Drive, never reply without the owner.
- [x] R2 done 2026-10-09 | TAKATAK V1 setup script on takatak-v1 local branch `claude/provision-brand-workspaces` (not pushed: no write access; backup `docs/patches/takatak-v1-provision-brand-workspaces.patch`, 5 commits, `git am` on takatak-v1 origin/main b3282f3). Reviews done by this agent alone, one at a time: **security done 2026-10-09** (no token, link, key or connection string printed; emails masked; actor must be an active Platform Owner/Admin; never adopts a workspace it does not own; failed invitations revoked and audited; **fixed** fb21c82: on Supabase's shared pooler host, `--confirm-db` now needs `<host>/<project-ref>`, since a host alone cannot tell two projects apart; typecheck clean, lint 0 errors, policy tests pass). **Correctness done 2026-10-09** (create order workspace → brand → locations → invitations; a failure stops only that workspace; plan gates re-checked, never bypassed; read-back after each workspace; re-run is a no-op; no bug found; docs now say run one copy at a time and explain the admin's one-invitation-per-run rule; pure tests 19/19 and database tests 8/8 pass on a throwaway local Postgres). **Runs-outside-Next done 2026-10-09** (import graph: 30 app modules, no `next/*` import, only `server-only`, which the npm script stubs; new `--env-file` option; docs use the npm script for every step). Next (owner or a session with takatak-v1 write access): `git am` the patch on takatak-v1, push the branch, open the PR; then dry-run on staging, `--apply` only after the owner says yes. Brand-section note: done (`docs/TAKATAK_BRANDS_BRIDGE.md`).
