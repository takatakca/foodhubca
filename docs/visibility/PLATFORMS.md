# Platforms: everywhere a Quadro Holding brand can take orders or be found

Public facts only. Researched 2026-10-09 with web search (this session cannot open the sites themselves); items marked
**verify** need a check on the platform's own page before anyone signs up. Rule: each platform hears only about itself
(our customer-facing pages may list them all; our messages to a platform never name another).

## F1. Food ordering platforms and aggregators (Montréal / Canada)

### A. Marketplaces (the app's customers order; the app delivers or the customer picks up)

| Platform | What it is | Our status (see `PRESENCE.md`) | How to join / connect | Notes |
|---|---|---|---|---|
| Uber Eats | Biggest delivery app in Montréal | Most brands, both kitchens (several off) | Uber Eats Manager; Food Hub has the Uber API (task 22, PR #21) | Food Hub pushes menus/hours |
| DoorDash | Large in Montréal since 2018 | Most brands; all on tablet since 2026-10-08 | Merchant Portal; Food Hub DoorDash API waits for Marketplace approval | 5 "not eligible" notices 2026-10-08 (owner calls DoorDash) |
| SkipTheDishes | Canadian app (Just Eat Takeaway) | **No Skip links recorded anywhere** | Skip partner signup; Food Hub has a Skip adapter | In 2021 Skip voluntarily lowered Québec commissions to 15% (Global News) |
| Fantuan | Delivery app strong with Asian restaurants, established in Montréal | Not on it | Merchant signup (**verify**) | Fits less with our menus; optional |
| HungryPanda | Delivery app for Asian diaspora, hiring in Montréal | Not on it | Merchant signup (**verify**) | Optional |
| Ritual | Order-ahead pickup app (announced Montréal 2019) | Not on it | **verify it still runs in Montréal** | Pickup only, good for office lunches |
| Too Good To Go | Surplus "surprise bags" at a discount, active in Montréal since 2021 | Not on it | Store signup in the TGTG partner app | End-of-night leftovers; adds a new customer channel; shows on our hub page, not as Google "Order online" |

### B. Our own ordering (no marketplace commission; card fees only)

| Option | What it is | Fit | Notes |
|---|---|---|---|
| **Clover Online Ordering** | Clover's own pickup page, orders go straight to the Clover register and kitchen | **Best fit**: we already run Clover; Food Hub mirrors the orders (`docs/CLOVER_WEBSITE_ORDERS.md`) | Owner turns it on in the Clover dashboard; Clover's local DoorDash delivery is U.S. only |
| DoorDash Storefront | DoorDash's commission-free ordering page for our website + Google | Good second option for delivery from our own site | DoorDash says its Google ordering integration is free with 0% commission (**verify terms**) |
| Uber Eats direct web ordering | Uber's ordering on our website with Uber couriers | Optional | Announced for Québec at a reduced 7.5% fee during the pandemic (**dated, verify**) |
| UEAT | Québec online-ordering company, exclusive partner of the Association Restauration Québec (~5,600 members) | Option if Clover's page is not enough | Pricing not public (**ask UEAT / ARQ**) |

### C. Order buttons on discovery sites (send people to A or B)

| Where | How | Notes |
|---|---|---|
| Google Search & Maps | Business Profile > Food ordering: add providers or custom links, pick a **preferred** provider | Canada supported. DoorDash/other providers may appear automatically; keep only the ones we want |
| Apple Maps | Apple Business Connect: action links (Order, Menu, Website) | **verify** link types for Canada |
| Bing / Microsoft | Bing Places for Business: website + menu links | Can import from Google |
| Facebook / Instagram | Page action button (Order food / link), link in bio | One link: the brand's order page |
| Yelp, TripAdvisor | Website and menu links on the claimed listing | Their own ordering features are mostly U.S.; we link out |
| ON2GO.ca, QMAPS | Our own directories, fed by Food Hub's `/api/public/directory` | ON2GO brand pages already show Clover first, then the apps |

### D. Delivery fleets for our own orders

| Option | Notes |
|---|---|
| Uber Direct | Food Hub has Uber Direct options (Settings > Delivery, task 22) |
| DoorDash Drive | Separate DoorDash product; Food Hub has `DOORDASH_DRIVE_*` settings |

### E. One tablet for all apps (order consolidation)

| Option | Notes |
|---|---|
| **Food Hub (ours)** | Our own hub; avoid paying for a second one |
| Deliverect | Clover App Market app (setup fee + subscription by order volume) |
| Cuboh | Canadian, Clover integration; acquired by ChowNow in March 2024 |
| Otter | Aimed at larger multi-location groups |
| UrbanPiper | **Cancelled**: never reconnect (it caused the DoorDash POS outages) |

### Commission context (Québec)
No permanent cap found. Bill 87 (2021) capped delivery-app commissions at 20% only while dining rooms were closed and
ended with the health emergency; Québec solidaire proposed a permanent 20% cap in 2023 (not law as far as found).
Ontario caps at 20%, British Columbia at 15%. Own ordering (B) avoids marketplace commission entirely.

Sources: [MobileSyrup (DoorDash Montréal launch)](https://mobilesyrup.com/?p=655460) ·
[Cities Insider (Québec City delivery)](https://citiesinsider.com/country/canada/quebec-city/takeout-and-delivery-services/en) ·
[Wmtips (delivery services in Canada)](https://www.wmtips.com/technologies/food-delivery/country/ca/) ·
[UEAT and ARQ](https://ueat.io/fr/larq-sassocie-avec-ueat-pour-simplifier-la-vie-des-restaurateurs-du-quebec) ·
[Uber Eats Québec measures](https://www.uber.com/fr-CA/newsroom/uber-eats-lance-de-nouvelles-mesures-pour-soutenir-lindustrie-de-la-restauration-au-quebec) ·
[Clover blog (Deliverect, Cuboh)](https://blog.clover.com/ca/?p=830) ·
[Cuboh](https://cuboh.com/integrations/clover-connect) ·
[Global News (Skip lowers Québec fees)](https://globalnews.ca/news/7576227/quebec-skipthedishes-fees-lowered) ·
[Global News (Bill 87)](https://globalnews.ca/news/7690990/quebec-tables-bill-cap-fees-third-party-delivery-apps-restaurants) ·
[CTV (Québec solidaire 20% cap)](https://montreal.ctvnews.ca/quebec-solidaire-wants-to-cap-restaurant-delivery-fees-at-20-percent-1.6289993) ·
[Cult MTL (Too Good To Go in Montréal)](https://cultmtl.com/2021/11/anti-food-waste-app-too-good-to-go-launches-in-montreal/) ·
[Google: manage online ordering](https://support.google.com/business/answer/10842217) ·
[DoorDash: storefront on your website](https://help.doordash.com/en-ca/merchants/article/activate-storefront-on-your-website)
