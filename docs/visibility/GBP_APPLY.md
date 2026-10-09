# Google Business Profile apply checklist, page after page (A1, 2026-10-09)

This is for the person who applies the changes: the owner, or a desktop session with Claude in Chrome after the owner
logs in. Cloud sessions never log in. **One Google account at a time, one profile at a time.** Every value comes from a
file in this folder, so nothing is typed from memory.

> **Pour le propriétaire.** Une fiche Google à la fois. Avant : réserver le compte dans Drive (01 CLAIMS). Pendant :
> copier les valeurs des fichiers indiqués. Après : noter « avant → après » dans Drive (03 OPS_LOG). Jamais « 24/7 »,
> jamais la fiche DoorDash de Po Poulet NDG.

## 0. Before the first profile (once)

- [ ] Owner decisions from `PLAN.md` §7 are written in Drive "TAKATAK OPS (private)" > 02 APPROVED_VALUES:
      address number per kitchen (6280/6284, 5837/5839), hours, storefront (A) or delivery brand (B) per brand and
      kitchen, the name of each brand, the "Order online" target.
- [ ] Old kitchens settled: Montréal-Nord and Hochelaga closed or moved (`PLAN.md` §7, items 1 and 2).
- [ ] Read `NAP.md` §1: Google's rules for several brands in one kitchen. A brand without its own sign and counter
      pickup for everyone is a **delivery brand (B)**: address hidden, service area only.
- [ ] Claim the Google account in Drive 01 CLAIMS (`account | agent | time | doing what | status`).

## 1. Order of work

1. **Fix the 7 profiles that already exist** (they carry today's reviews; never create a second one beside them):
   PPP Pizzeria NDG, OOEUF NDG, Pi Pita NDG, Bin Molle & Bin Dure NDG, Café Bolon NDG, Café Bolon Saint-Léonard,
   Nutrition Shake Saint-Léonard. First check which address, name, hours and rating each shows. If one is the old
   Montréal-Nord or Hochelaga listing, fix it in place (address, or "permanently closed") before anything else.
2. **New profiles**, in this order: OOEUF Saint-Léonard, OCRÊPE, Po Poulet Saint-Léonard (only after DoorDash clears
   its notice; Saint-Léonard only), Pi Pita Saint-Léonard.
3. **Then the brands whose name the owner has settled** (`PLAN.md` §7, group D). Place Afrique last, or never.
4. **Never:** a profile, post, link or photo that points to Po Poulet NDG on DoorDash (store 27982486).

## 2. One profile, step by step

Search for the brand on Google Maps first. If a profile already exists, request ownership; **never create a
duplicate**.

| Step | Field | Value from | Check after saving |
|---|---|---|---|
| 1 | Business name | `GBP_CHANGES.md` (the brand's real sign name, no keywords, no area) | Name shows exactly as written |
| 2 | Primary category | `GBP_CHANGES.md` "Primary category" | Category shows under the name |
| 3 | Additional categories | `GBP_CHANGES.md`, at most the ones listed | No category the menu does not serve |
| 4 | Address or service area | 02 APPROVED_VALUES + `NAP.md` §2. Type A: kitchen address. Type B: hide the address, service area = the areas in `KEYWORDS.md` for that kitchen | Pin on the right building; B shows no street |
| 5 | Hours | 02 APPROVED_VALUES (Food Hub Settings → Hours). Skip while not approved. Never "24/7" | Same hours as Food Hub and the apps |
| 6 | Website | The brand site from `GBP_CHANGES.md` | Opens the right brand |
| 7 | Menu link | `GBP_CHANGES.md` "Menu link" | Opens the menu |
| 8 | Order online | The order target the owner picked (Phase 0); remove providers that do not carry this brand | Only working links, own page first |
| 9 | Description FR (EN if the profile allows a second language) | `GBP_CHANGES.md` description, <= 750 characters | No phone, no link, no "24/7" |
| 10 | Attributes | Takeout, delivery; "late night" only once hours are approved | Matches what the kitchen really does |
| 11 | Logo and cover photo | `PHOTOS.md` (when ready) | Real food from this brand only |
| 12 | First post | `GBP_CHANGES.md` posts 1 to 3 (post 4 waits for hours) | Post is live |
| 13 | Verification | Follow Google's prompt (often a short video of the sign, kitchen and proof of management). The owner does it | Status "Verified" |

Google can take several days to review edits and may show "pending". Do not re-submit the same edit; check again the
next day.

## 3. After each profile

- [ ] Write one line per field changed in Drive 03 OPS_LOG: `date | brand | kitchen | field | before → after`.
- [ ] Update the brand's row in `PRESENCE.md` (Google column: cid link) on the working branch.
- [ ] Set the brand site's `hasMap` in `SCHEMA.md` to the profile's cid.
- [ ] Reply to every existing review with the templates in `GBP_CHANGES.md` (one by one, never copy-paste the same
      reply to all).
- [ ] Release the account in Drive 01 CLAIMS when stopping.

## 4. Then the other maps, same values

Apple Business Connect, then Bing Places (can import from Google), then Yelp and TripAdvisor (`PLATFORMS.md` D1). Use
the short text in `SOCIAL_BIOS.md` where the field is short. Same name, address and hours everywhere.
