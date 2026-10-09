# NAP standard: one name, one address, one link per brand and kitchen

Every listing (Google, Apple, Bing, Yelp, TripAdvisor, 411, Pages Jaunes, Facebook, delivery apps, our own sites and
schema.org) must show **exactly the same name, address and website** for a brand and kitchen. Mismatches split ranking
signals and trigger Google suspensions. Status: **draft, waiting for owner decisions** (Drive "TAKATAK OPS (private)" >
04 QUESTIONS). Public facts only.

## 1. Google's rules for several brands in one kitchen (read first)

Summaries of Google's guidelines (2022 update, still described the same way in 2025):
- **Co-located brands with in-person pickup**: each brand needs **its own permanent signage** at the address, and shows the
  address only if it offers pickup to all customers.
- **Delivery-only brands**: eligible if they have **distinct branded packaging and a distinct website**; they must **hide
  the address** and list **service areas** instead.
- **Several brands at one address** go through **extra verification**.
- A kitchen may manage each brand's profile once the brand has authorized it.

Sources: [Search Engine Land, 2022](https://searchengineland.com/google-now-allows-virtual-food-brands-to-have-google-business-profiles-385012),
[Whitespark](https://whitespark.ca/blog/are-virtual-kitchens-eligible-for-a-google-business-profile/). Check Google's own
[guidelines page](https://support.google.com/business/answer/3038177) before applying (this session cannot open it).

What this means for us (owner decides per brand and kitchen):
- **A. Storefront brand** (sign on the building + pickup counter open to everyone): show the address, normal listing.
- **B. Delivery-and-pickup brand without its own sign**: hide the address, set service areas (NDG, Côte-des-Neiges,
  Hampstead, Westmount... / Saint-Léonard, Anjou, Montréal-Nord, Rosemont...), keep its own website and packaging.
- Never two visible listings with the same name at the same address. Never keywords in the name.
- Every brand already has its own website (brand config `domain`), which helps both A and B.

## 2. Kitchens (canonical address, pending owner confirmation)

| Kitchen | French (Canada Post style) | English | Open questions |
|---|---|---|---|
| NDG | 6280, avenue Somerled, Montréal (Québec) H3X 2B6 | 6280 Somerled Ave, Montreal, QC H3X 2B6 | Some DoorDash stores use **6284** Somerled: one address or two units? Use one everywhere unless 6284 is a real separate door with its own sign. |
| Saint-Léonard | 5839, rue Jean-Talon Est, Montréal (Québec) H1S 1M4 | 5839 Jean-Talon St E, Montreal, QC H1S 1M4 | Older data says **5837**. Pick one. |
| Montréal-Nord (old) | 6241, boulevard Léger, Montréal (Québec) H1G 6K8 | 6241 Léger Blvd, Montreal, QC H1G 6K8 | Found 2026-10-09 on an old Uber Eats store (closed since 2023). Source of the "Montréal-Nord" names. If closed: mark every listing there "permanently closed". |
| Hochelaga (old) | 3583, rue Sainte-Catherine Est, Montréal (Québec) H1W 2E6 | 3583 Sainte-Catherine St E, Montreal, QC H1W 2E6 | Looks **moved** to Saint-Léonard (Uber Eats slugs still say "hochelaga" on Saint-Léonard stores). If closed: mark old Google/Yelp/411 listings "permanently closed" or move them, never leave them open. |

Postal code and city stay exactly as above on every platform (Montréal with the accent in French, Montreal in English).

## 3. Names

- Use the brand name exactly as in the brand config (`PPP Pizzeria`, `OOEUF`, `Pi Pita`, `Gâteau Montréal`...). No
  neighbourhood, no keywords ("best pizza", "delivery", "24h") in the name. A neighbourhood descriptor is allowed only if
  it is on the sign.
- Delivery apps today use suffixes such as "(NOTRE-DAME-DE-GRÂCE)", "HOCHELAGA", "Montréal-Nord", "Express": align them
  later, one platform at a time, through each platform's own support.
- Spellings to settle with the owner (see `docs/TAKATAK_BRANDS_BRIDGE.md` §6): OOEUF vs O'Œufs, OCRÊPE vs O'Crêpe, Gâteau
  Montréal vs Gâteaux Montréal vs Viennoise, Nutrition Shake vs Nutri Shake, Mythos & Go vs Mythos 2 Go.

## 4. Phone, website, order link

- Phone: one public business line per brand when the brand phone lines (task 18) go live; until then the group line from
  the brand config. Never a person's mobile.
- Website: the brand's own domain (brand config `domain`), https, same URL on every platform.
- Order link: one per brand page (owner picks: Clover pickup page, ON2GO brand page or brand-site store page). Delivery
  apps link to their own store page. Po Poulet NDG (DoorDash 27982486) is never linked.

## 5. Hours

Not final. Owner said 16:00-03:00 every day; the brand config says NDG 16:30-03:15 and Saint-Léonard 09:00-23:00. One
source once decided: Food Hub Settings → Hours, which already pushes hours to the delivery apps. Never "24/7".
