# Presence audit: where each brand can be found today

Public facts only. Source of truth for brands and kitchens: pppmtl branch `feature/multi-brand` `src/config/brands.ts`
(not merged yet). "off" = the store exists but is not live on the app today. Po Poulet NDG (DoorDash 27982486) is never
linked and is not listed here.

Kitchens in the brand config:

- **NDG**: 6280 Av Somerled, Montréal QC H3X 2B6 (config hours 16:30-03:15, NOT owner-approved)
- **Saint-Léonard**: 5839 Rue Jean-Talon E, Montréal QC H1S 1M4 (config hours 09:00-23:00, NOT owner-approved)

Known conflicts to settle (see Drive 04 QUESTIONS): a former Montréal-Nord kitchen (6241 Boul. Léger, H1G 6K8) still has listings; owner says 16:00-03:00; DoorDash's list shows some second-kitchen
stores at "5839 Rue Jean-Talon" while older data says 3583 Rue Sainte-Catherine E (Hochelaga), so the Hochelaga kitchen
looks moved to Saint-Léonard; Saint-Léonard is written 5837 in older Food Hub data.

## Per brand (from code, 2026-10-09)

| Brand | Website | Kitchen | Google Maps (cid) | Uber Eats | DoorDash | Skip | Too Good To Go | Yelp | TripAdvisor | 411 / Pages Jaunes | Facebook / Instagram |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PPP Pizzeria | pppmtl.com | NDG | [cid 6093103527698124139](https://maps.google.com/?cid=6093103527698124139) | - | - | none recorded | none recorded | ? | ? | ? | ? |
| PPP Pizzeria | pppmtl.com | Saint-Léonard | not recorded | [627d09f0](https://www.ubereats.com/ca/store/ppp-pizzeria-hochelaga/627d09f0-8fb4-57f2-8ec1-6a71984ad267) | - | none recorded | none recorded | ? | ? | ? | ? |
| OOEUF | ooeuf.ca | NDG | [cid 8027317480379740171](https://maps.google.com/?cid=8027317480379740171) | [6cbb374c](https://www.ubereats.com/ca/store/ooeufs-express-ndg/6cbb374c-c3a2-5951-b88c-11142bd5121a) | [34525477](https://www.doordash.com/store/34525477/) | none recorded | none recorded | ? | ? | ? | ? |
| OOEUF | ooeuf.ca | Saint-Léonard | not recorded | [c5585882](https://www.ubereats.com/ca/store/ooeufs-express/c5585882-ab06-5a2f-bbc2-66fe5ec9179c) (off) | [33597929](https://www.doordash.com/store/33597929/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Déjeuner Montréal | dejeuner.ooeuf.ca | NDG | not recorded | - | - | none recorded | none recorded | ? | ? | ? | ? |
| Déjeuner Montréal | dejeuner.ooeuf.ca | Saint-Léonard | not recorded | - | - | none recorded | none recorded | ? | ? | ? | ? |
| Pi Pita | pipita.ca | NDG | [cid 2408837339277880870](https://maps.google.com/?cid=2408837339277880870) | [c8390129](https://www.ubereats.com/ca/store/pi-pita-ndg/c8390129-1c18-5c51-800e-d9be32a865a3) | [27986352](https://www.doordash.com/store/27986352/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Pi Pita | pipita.ca | Saint-Léonard | not recorded | [b6b36ca0](https://www.ubereats.com/ca/store/pi-pita-hochelaga/b6b36ca0-bc57-50d0-a184-1d28bf74771f) (off) | [33598679](https://www.doordash.com/store/33598679/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Pita Libanais | pitalibanais.pppmtl.com | NDG | not recorded | [ad89eb6f](https://www.ubereats.com/ca/store/pita-libanais-montreal/ad89eb6f-9244-53fc-b6a7-cd0086e70b43) (off) | [28719391](https://www.doordash.com/store/28719391/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Pita Libanais | pitalibanais.pppmtl.com | Saint-Léonard | not recorded | [c6b9e38d](https://www.ubereats.com/ca/store/pita-libanais-hochelaga/c6b9e38d-15da-4771-9bcc-7cfa9f9abea9) (off) | - | none recorded | none recorded | ? | ? | ? | ? |
| Mythos & Go | mythos.pppmtl.com | NDG | not recorded | [f54cdb63](https://www.ubereats.com/ca/store/mythos-and-go-montreal/f54cdb63-78cb-5ea3-b967-1b58d18c83cf) (off) | [32501513](https://www.doordash.com/store/32501513/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Mythos & Go | mythos.pppmtl.com | Saint-Léonard | not recorded | [203c8294](https://www.ubereats.com/ca/store/mythos-and-go-montreal/203c8294-81e6-4fde-ad04-e7158a66f4b4) | - | none recorded | none recorded | ? | ? | ? | ? |
| Nutrition Shake | nutrishake.ca | NDG | not recorded | [58f2a0dd](https://www.ubereats.com/ca/store/nutri-shake-ndg/58f2a0dd-a9da-5a27-a130-d858a52e18f9) | [27510307](https://www.doordash.com/store/27510307/) | none recorded | none recorded | ? | ? | ? | ? |
| Nutrition Shake | nutrishake.ca | Saint-Léonard | [cid 17679975320192778617](https://maps.google.com/?cid=17679975320192778617) | [8c0a69ee](https://www.ubereats.com/ca/store/nutri-shake-hochelaga/8c0a69ee-1667-5aa7-a8e6-7fdb707095da) | [33596565](https://www.doordash.com/store/33596565/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Bin Molle & Bin Dure | bmbd.ca | NDG | [cid 5723855720782944465](https://maps.google.com/?cid=5723855720782944465) | [3ca49ac1](https://www.ubereats.com/ca/store/bin-molle-%26-bin-dure-ndg/3ca49ac1-fb4c-562d-b066-0389875f24eb) | [28108457](https://www.doordash.com/store/28108457/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Bin Molle & Bin Dure | bmbd.ca | Saint-Léonard | not recorded | [7656b055](https://www.ubereats.com/ca/store/bin-molle-%26-bin-dure-hochelaga/7656b055-48d1-5f46-a6a7-2a0d23668c0b) | [33598151](https://www.doordash.com/store/33598151/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| OCRÊPE | ocrepe.ca | NDG | not recorded | [f9c5fa6b](https://www.ubereats.com/ca/store/ocrepe-montreal/f9c5fa6b-8353-53f9-ac13-68596b3a21ae) (off) | [27986646](https://www.doordash.com/store/27986646/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| OCRÊPE | ocrepe.ca | Saint-Léonard | not recorded | - | [33596721](https://www.doordash.com/store/33596721/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Gâteau Montréal | viennoise.ca | NDG | not recorded | [c20d55f1](https://www.ubereats.com/ca/store/gateaux-montreal-ndg/c20d55f1-661a-56d6-b1db-bd792423b777) | [28114454](https://www.doordash.com/store/28114454/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Gâteau Montréal | viennoise.ca | Saint-Léonard | not recorded | [d4e00c50](https://www.ubereats.com/ca/store/gateaux-montreal-hochelaga/d4e00c50-971f-5eb4-afa2-d48231f98a48) | [33521453](https://www.doordash.com/store/33521453/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Taco Mexican | tacomontreal.ca | NDG | not recorded | [d2288211](https://www.ubereats.com/ca/store/taco-mexican-montreal/d2288211-7239-5e8e-97f1-df156c9ff71a) (off) | [30831008](https://www.doordash.com/store/30831008/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Taco Mexican | tacomontreal.ca | Saint-Léonard | not recorded | - | [33597179](https://www.doordash.com/store/33597179/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Pizza Inntime | inntime.ca | NDG | not recorded | [5d836bb5](https://www.ubereats.com/ca/store/pizza-inntime-montreal/5d836bb5-7e95-5c65-a28f-d0066818349e) (off) | [28519423](https://www.doordash.com/store/28519423/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Pizza Inntime | inntime.ca | Saint-Léonard | not recorded | - | - | none recorded | none recorded | ? | ? | ? | ? |
| Pizza Algérie | pizzaalgerie.pppmtl.com | NDG | not recorded | [baa21fb9](https://www.ubereats.com/ca/store/pizza-algerie-montreal/baa21fb9-e843-4667-895e-1fe7d3dbb0ce) | - | none recorded | none recorded | ? | ? | ? | ? |
| Po Poulet | popoulet.ca | Saint-Léonard | not recorded | - | [34494017](https://www.doordash.com/store/34494017/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Poulet Poulet | pouletpoulet.popoulet.ca | NDG | not recorded | - | [32501399](https://www.doordash.com/store/32501399/), [28719392](https://www.doordash.com/store/28719392/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Poulet Poulet | pouletpoulet.popoulet.ca | Saint-Léonard | not recorded | - | [33597093](https://www.doordash.com/store/33597093/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Café Bolon | bolon.ca | NDG | [cid 13512885180808196559](https://maps.google.com/?cid=13512885180808196559) | [8d911a03](https://www.ubereats.com/ca/store/bolon-cafe-ndg/8d911a03-247c-53a2-92da-593808f33592) | [30831269](https://www.doordash.com/store/30831269/) (off) | none recorded | none recorded | ? | ? | ? | ? |
| Café Bolon | bolon.ca | Saint-Léonard | [cid 9510640660342127576](https://maps.google.com/?cid=9510640660342127576) | [8179598e](https://www.ubereats.com/ca/store/bolon-cafe-hochelaga/8179598e-a40f-509e-8b03-59ce49d57d77) (off) | - | none recorded | none recorded | ? | ? | ? | ? |
| Place Afrique | placeafrique.bolon.ca | NDG | not recorded | - | - | none recorded | none recorded | ? | ? | ? | ? |
| Place Afrique | placeafrique.bolon.ca | Saint-Léonard | not recorded | - | - | none recorded | none recorded | ? | ? | ? | ? |

## Findings from web search (this session cannot open listing sites; only web search works)

- 2026-10-09 | Déjeuner Montréal | **Not on any platform and no public listing** (no Uber Eats, no DoorDash; website is a
  sub-address of OOEUF, `dejeuner.ooeuf.ca`). **Name vs menu:** in Québec French "déjeuner" means breakfast, but the menu
  (brand config) is a casse-croûte: burgers, steamed and Michigan hot dogs, poutines, no breakfast items. Customers who
  search "déjeuner" expect eggs and toast and will leave bad reviews. And OOEUF, under the same domain, is also a
  casse-croûte (burgers, Michigan hot dogs, poutine) whose Uber Eats store is named "O'OEUFS Déjeuner": two snack-bar
  brands with breakfast-sounding names would be confused (corrected 2026-10-09: OOEUF is not a breakfast menu). **Competitors:** for casse-croûte near NDG, Gibeau Orange Julep
  (open since 1930, Michigan hot dog, burgers, poutine); elsewhere, Paulo et Suzanne and Patati Patata are the reference
  names in guides. Owner decides: rename to a casse-croûte name (category "Snack bar" / "Hamburger restaurant"), or fold
  the casse-croûte menu into an existing brand. Sources: https://tastet.ca/listes/les-meilleurs-casse-croutes-du-quebec/ ,
  https://www.restomontreal.ca/article/meilleurs-casse-croute-de-montreal/2341/fr/

- 2026-10-09 | Place Afrique | **Not on any platform and no public listing** (no Uber Eats, no DoorDash, nothing in web
  search; website is a sub-address of Café Bolon, `placeafrique.bolon.ca`). **Name vs menu:** the menu (brand config) is
  samosas, Jamaican patties, empanadas, souvlaki and chicken or pork skewers: none of it is African, so the proposed Google
  category "African restaurant" would mislead customers and draw bad reviews. **Strong competitors next door:** Algrillades,
  an Algerian halal grill at **5872 Jean-Talon E, across the street from the Saint-Léonard kitchen**, Google 4.4 from 700+
  reviews; Belle Afrique (Saint-Léonard / Montréal-Nord, Togolese, went viral on TikTok in 2024); Afrique Weliah
  (Parc-Extension). **Recommendation:** lowest Google priority. Owner decides: (a) a real African menu before any Google
  profile, (b) a name that matches the current menu (category "Grill"), or (c) keep it off Google and off the apps for now.
  Sources: https://www.restomontreal.ca/resto/algrillades-montreal/13162/en/ ,
  https://www.themain.com/fr/montreal/restaurant/belle-afrique

- 2026-10-09 | Café Bolon | **Stale directory listing in Montréal-Nord:** RestoMontreal lists 'Bolon Cafe "24/7"
  Équatorien' in **Montréal-Nord** (the old kitchen, see NAP.md), Ecuadorian soups and brunch, hours 4 p.m. to 1 a.m.,
  **Google rating 2.3 from 4+ ratings** (RestoMontreal copies Google). So one Google profile for this brand still carries
  the old place, a round-the-clock name and a weak rating: the owner checks whether cid 13512885180808196559 or
  9510640660342127576 (table above) is that one, then fixes its name, address and hours in Google (RestoMontreal
  follows). **Menu vs listing:** the brand config sells Latin American empanadas and nachos (proposed category "Latin
  American restaurant"); the old listing says Ecuadorian soups. A bolón is an Ecuadorian dish: if the menu keeps
  Ecuadorian items, add "Ecuadorian restaurant" as a category (few in Montréal: less competition). **Uber Eats:** the
  Saint-Léonard row's link has the slug `bolon-cafe-hochelaga` (old Hochelaga kitchen): check its address. No
  `bolon.ca` page surfaces. Empanada competitors: Che Churros & Empanadas (4.8 on 1,500+ Uber ratings), Juanitos
  (Saint-Henri), La Picada (Lachine). Sources: https://www.restomontreal.ca/resto/bolon-cafe-24-7-equatorien-montreal/22023/en/ ,
  https://www.ubereats.com/ca-fr/store/che-churros-%26-empanadas/j4Z282pqSvaJLta6b8fC0A

- 2026-10-09 | Poulet Poulet | **No public listing surfaces** in web search under "Poulet Poulet" or its DoorDash name
  "Poulet Express". **Name problems:** three names for one brand (Poulet Poulet in the brand config, "Poulet Express" on
  DoorDash 32501399, and a website under the Po Poulet domain, `pouletpoulet.popoulet.ca`). Pick one name; the DoorDash
  display name is fixed through DoorDash support later. **Three DoorDash stores** (NDG 32501399 on but paused for POS
  cancellations, NDG 28719392 off, Saint-Léonard 33597093 off): all kept, several stores per brand are intentional
  (day and night stores, owner 2026-10-10); never raised with DoorDash.
  **Keep apart from Po Poulet NDG:** both are chicken brands at the NDG kitchen; nothing for Poulet Poulet may link to,
  copy from, or be merged with the Po Poulet NDG store (DoorDash 27982486). **Close competitors in NDG:** Freakin Poulet
  (6530 av. Somerled, on the same street), Chalet Bar-B-Q (NDG's well-known rotisserie, on all apps) and Poulet Rouge.
  Sources: https://www.ubereats.com/ca/store/freakin-poulet/SMOet6lAXkiNHXBZX1X0fQ ,
  https://tastet.ca/en/lists/restaurants-livraison-montreal/

- 2026-10-09 | Po Poulet (Saint-Léonard only; NDG store 27982486 is never touched) | **No public listing surfaces** in
  web search, and `popoulet.ca` is not indexed. **Two DoorDash store numbers** for Saint-Léonard: 34494017 (row above,
  off) and 41950447 (seen in DoorDash mail on 2026-10-08, not in DoorDash's own store list): both kept, several
  stores per brand are intentional (day and night, owner 2026-10-10); the owner says which one each link uses. DoorDash also sent a merchant-verification "not eligible"
  notice for "Po Poulet (ST LEONARD)" on 2026-10-08: the owner calls DoorDash; until then no order link to DoorDash for
  this brand. No Uber Eats store. **Local fried-chicken competitors** (Anjou–Saint-Léonard): BPF Poulet Frit
  (halal-certified, weak ratings: an opening for a well-reviewed rival), Rotisseries Au Coq, Poulet Rouge, La Poule en Feu.
  To win "poulet frit Saint-Léonard": category "Chicken restaurant" + "Fried chicken takeaway", real photos of the 3- to
  15-piece meals, and steady reviews. Sources: https://www.restomontreal.ca/resto/bpf-poulet-frit-montreal/18104/en/ ,
  https://www.restomontreal.ca/resto/rotisseries-au-coq-montreal/16822/en/

- 2026-10-09 | Pizza Algérie | **No public listing surfaces** in web search. Platforms: one Uber Eats store (NDG, on),
  no DoorDash. Website is a sub-address of another brand (`pizzaalgerie.pppmtl.com`), which gives it no local-search
  strength of its own. **Overlap:** this is the **third pizza brand out of the NDG kitchen** (with PPP Pizzeria and Pizza
  Inntime); see the Pizza Inntime note. **Opportunity:** a June 2026 roundup of Algerian restaurants in Montréal places the
  community mainly in Parc-Extension, Villeray–Saint-Michel, **Saint-Léonard** and Chomedey (Laval), not NDG; the
  Saint-Léonard kitchen fits this brand better, and it has no store there yet. Free targets once a profile exists: that
  roundup (zoomalgerie.com, ask to be listed) and, only if the menu is certified halal, the Zabihah halal directory.
  Sources: https://zoomalgerie.com/meilleurs-restaurants-algeriens-montreal/ ,
  https://www.ubereats.com/ca/store/pizza-algerie-montreal/baa21fb9-e843-4667-895e-1fe7d3dbb0ce

- 2026-10-09 | Pizza Inntime | **No public listing surfaces** in web search ("Pizza Inntime" and `inntime.ca` return
  nothing; the closest name is L'in-time, an unrelated Verdun restaurant). Platforms: one Uber Eats and one DoorDash store,
  NDG only, both off; **Saint-Léonard has no store anywhere**. **Close competitors on Somerled itself:** B&M Somerled
  (6200 av. Somerled, Greek/Italian with pizza, a block from the kitchen), Monkland Grille (6447 Somerled) and Welat Pizza
  (6509 Somerled). **Overlap risk:** PPP Pizzeria is a second pizza brand out of the same NDG kitchen; two pizza profiles
  at one address compete with each other and look like duplicates to Google. Owner decides: one pizza brand per kitchen on
  Google (the other stays on delivery apps only), or a clearly different menu and sign for each. Sources:
  https://www.ubereats.com/ca/store/b%26m-somerled/kldUd7JbR9WcMIddgzv9Ng ,
  https://www.restomontreal.ca/resto/welat-pizza-montreal/793/en/

- 2026-10-09 | Taco Mexican | **No public listing surfaces** in web search (Uber Eats and DoorDash pages exist but are not
  indexed; `tacomontreal.ca` is not indexed either). **Name risk:** "Taco Mexican" is generic and English word order in a
  French-first market; Google ranks it against every "tacos" search. **Close competitors:** in NDG, Chelas & Tacos
  (5966 av. de Monkland, a few blocks from the kitchen) and The French Tacos; on Jean-Talon, El Rey del Taco (232 Jean-Talon
  E, since 2009) and Mexico Restaurant (2474 Jean-Talon E). To rank, the Google profile needs a precise category
  ("Mexican restaurant" or "Taco restaurant"), real photos, the tacomontreal.ca site live with the menu, and reviews.
  **Ops note:** on 2026-10-09 a POS-integration request was opened with DoorDash for the Saint-Léonard Taco Mexican store
  by someone other than this session; the owner must confirm it (details in Drive "TAKATAK OPS (private)", 03 OPS_LOG
  addendum). Sources: https://www.ubereats.com/ca/store/chelas-%26-tacos/NI_9VDcjRAK5lc_X1y4MnQ ,
  https://tastet.ca/en/lists/the-best-tacos-in-montreal-our-suggestions/

- 2026-10-09 | Gâteau Montréal | **No public listing surfaces** in web search under "Gâteau Montréal" or "Gâteaux
  Montréal" (Uber Eats pages exist but are not indexed). **NAP problems:** (1) Uber Eats uses the plural "Gâteaux
  Montréal" vs "Gâteau Montréal" in the brand config: pick one; (2) the Uber link in the Saint-Léonard row has the slug
  `gateaux-montreal-hochelaga`, so it was created for the **old Hochelaga kitchen** (3583 Ste-Catherine E, see NAP.md),
  not Saint-Léonard: check its address before anything links to it; (3) the website `viennoise.ca` follows the config's second
  name "La Viennoise", not "Gâteau Montréal", and does not surface in search, while an unrelated West Island bakery, **Pâtisserie Suisse Viennoise**,
  does: customers searching "viennoise" find the other shop. **Name risk:** "Gâteau Montréal" is a generic phrase
  ("cake Montreal"); it competes with every cake search and with real cake shops (Mlles Gâteaux, Géraldine Gâteau, Gâteau
  Brisé, Bayard Gâteaux). Owner decides: keep the name with a matching domain, or a more distinctive name before the
  Google profile is verified. Sources: https://www.ubereats.com/ca/store/gateaux-montreal-ndg/c20d55f1-661a-56d6-b1db-bd792423b777 ,
  https://www.circulaire-en-ligne.ca/patisserie-suisse-viennoise

- 2026-10-09 | OCRÊPE | **The one Uber Eats store is in Saint-Léonard, not NDG.** Uber Eats "O'Crêpe (Montréal)",
  store f9c5fa6b (the link in the NDG row above), shows **5837 Rue Jean-Talon E**, 3.5 stars (30 ratings), categories
  crêpe, pastry, breakfast, halal, waffles, and **round-the-clock hours every day** (wrong: hours are not final, see
  NAP.md). **NAP problems:** (1) name spelled "O'Crêpe" on Uber vs "OCRÊPE" in the brand config: pick one spelling and use
  it everywhere; (2) street number 5837 vs 5839 (same open question as OOEUF); (3) the table row may be wrong: move this
  Uber link to the Saint-Léonard row once the owner confirms, and check whether NDG ever had its own Uber store.
  **No** Yelp, TripAdvisor or DoorDash web page and no ocrepe.ca page surface in web search (the domain may not be live
  yet). Several real crêperies nearby compete for "crêpes Jean-Talon" / "crêpes Saint-Léonard" (Crêpinos, Croustino in
  Anjou-Saint-Léonard; Crêpes MTL, Crêperie du Marché near Marché Jean-Talon): the Google profile needs the category
  "Creperie", photos and reviews to rank. Source:
  https://www.ubereats.com/ca/store/ocrepe-montreal/-cX6a4NTU_msE2hZazohrg

- 2026-10-09 | Bin Molle & Bin Dure | **Old Uber Eats store "Bin Molle Bin Dure" at 6241 Boulevard Léger, Montréal
  (Montréal-Nord), H1G 6K8**, closed on Uber Eats since 2023-04-13, with a mixed menu (crèmerie, pizza, rotisserie,
  breakfast, crêpes, pastries, Lebanese pitas). This looks like a **former Montréal-Nord kitchen** and explains the stale
  "PPP Pizzeria 24/7 Montréal Nord" listing and DoorDash's business name "Po-Poulet Montréal-Nord". **Action:** owner
  confirms the Montréal-Nord kitchen is closed; then every listing still at 6241 Boul. Léger (Google, Uber Eats, DoorDash
  names, Yelp, 411, Pages Jaunes, Wanderlog copies) is marked "permanently closed" or moved to the current kitchen, one
  platform at a time, logged in Drive. Source: https://www.ubereats.com/store/bin-molle-bin-dure/w8MCBYV6Wd2d3L-tFwc-wA

- 2026-10-09 | Nutrition Shake | Web search finds **no public listing** (a Google profile exists for Saint-Léonard, cid
  17679975320192778617, but it does not surface in general search: few reviews/links pointing to it). **Name vs menu:**
  the name promises shakes, but the menu (brand config) is protein salads, a vegetarian sub, black-bean tacos and cold
  drinks, no shakes. People searching "shake" will bounce. Recommendation: either add shakes/smoothies to the menu or
  lead every listing with "salades protéinées / protein salads". Nearby salad/sandwich reference in Saint-Léonard: Les
  Marchés Tau (6880 Jean-Talon E).

- 2026-10-09 | Mythos & Go | **No public listing found** for "Mythos & Go" or "Mythos 2 Go". **Name risk:** "Mythos"
  (Mythos Estiatorio, 5318 av du Parc) is a decades-old, well-known Greek restaurant in Montréal, featured in
  Tourisme Montréal's and Cult MTL's best-Greek lists. A Greek brand named "Mythos & Go" will be confused with it in
  search, and could raise a trademark complaint. Recommendation: owner checks the Canadian trademarks database (CIPO)
  and considers a distinct name before building Google/Yelp listings. Sources:
  https://www.mtl.org/en/experience/great-greek-restaurants ,
  https://cultmtl.com/2025/02/best-greek-restaurants-food-in-montreal-of-mtl-estiatorio-milos-marathon-souvlaki-marvens-christinas-cuisine-mythos

- 2026-10-09 | Pita Libanais | **No public listing found.** The name is generic ("Lebanese pita"): search engines treat it
  as a description, so it will be hard to rank and Google may question it as a keyword-style name. Recommendation:
  consider a distinctive name before building listings (owner decides), or list it only on the delivery apps and the
  ON2GO directory. Nearby Lebanese/Syrian reference competitor on Jean-Talon: Le Petit Alep (191 Jean-Talon E).

- 2026-10-09 | Pi Pita | Web search finds **no public listing** (Google, Yelp, TripAdvisor, directories) under "Pi Pita"
  in Montréal; it is invisible outside the delivery apps (and DoorDash sent it a "not eligible" notice on 2026-10-08).
  Name collision: **Pizza Pita** (pizzapita.com, 5345 Vézina, Côte-des-Neiges) is a nearby, better-known shawarma/pizza
  brand. Recommendation: keep "Pi Pita" but always pair it with "shawarma / libanais" words in titles and posts; build
  the Google + Apple + Yelp listings first so the name gets its own results. Source:
  https://mikecohen.ca/2020/10/pizza-pita-has-landed-now-located-on-vezina-at-decarie-square/?amp=1

- 2026-10-09 | OOEUF | Search finds **no Yelp, TripAdvisor or Restaurant Guru listing** under OOEUF or O'Oeufs: low
  visibility, all to create. An Uber Eats store **"O'OEUFS Déjeuner (St-Léonard)"** exists at **5837** Rue Jean-Talon E
  (shown unavailable), store id 2e747d04-74b0-45bc-87dc-224a73bd696d, which is **not** in the brand config (config has
  c5585882 for OOEUF Saint-Léonard and no link for Déjeuner Montréal): a third name variant and the 5837/5839 conflict
  again. Competitor with a confusingly close name 3 blocks away: **L'Oeufrier (NDG), 6544 Av Somerled** (breakfast).
  Recommendation: one spelling everywhere (owner decides OOEUF vs O'Oeufs), add "casse-croûte / burgers" words in
  descriptions so search does not mix it up with breakfast places. Sources:
  https://www.ubereats.com/ca/store/ooeufs-dejeuner-st-leonard/sV7cecZGVamX4viFGuef-A/974f6d2e-f65a-4823-b6e4-f8431b423c10/2e747d04-74b0-45bc-87dc-224a73bd696d ,
  https://atly.com/best/gluten-free/kid-friendly-canada-quebec-montreal-notre-dame-de-grace

- 2026-10-09 | PPP Pizzeria | A stale public listing "PPP Pizzeria 24/7 Montréal Nord" exists on Wanderlog (says open 24 hours,
  Montréal-Nord). Our rule is never "24/7" and the kitchens are NDG / Saint-Léonard: this listing should be corrected or
  closed at its source (most likely an old Google Business Profile: check in the Google account). Source:
  https://wanderlog.com/place/details/9407150/ppp-pizzeria-247-montréal-nord
- 2026-10-09 | DoorDash | "Poulet Express" (DoorDash 32501399) is the Poulet Poulet brand at the NDG kitchen in the brand
  config (store list name differs from the brand name: fix the DoorDash display name later, through DoorDash).

