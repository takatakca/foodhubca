# Google Business Profile target values (per brand)

Ready to paste, brand by brand, by the owner or a desktop agent with Claude in Chrome, **one Google account at a time**,
each change logged in Drive "TAKATAK OPS (private)" > 03 OPS_LOG (before -> after). Public facts only.
Text source: the owner's brand copy in pppmtl `feature/multi-brand` `src/config/brands.ts`.

Before applying, for every brand and kitchen:
1. Owner answers the NAP questions (`NAP.md` §2) and the **sign + pickup** question (`NAP.md` §1): type A (show address)
   or type B (hide address, service area).
2. Hours: NOT final. Leave the current Google hours until the owner confirms them (`NAP.md` §5). Never "24/7".
3. Categories below are proposals: pick the closest names Google's category picker offers.
4. Description: one per profile (Google allows one). French first for Montréal; the English text is for the website,
   Apple Maps, Yelp and TripAdvisor. Max 750 characters, no links, no prices, no promotions in it.
5. Attributes to set when true: Takeout, Delivery, No-contact delivery, Accepts debit / credit cards, Late-night food
   (only if the confirmed hours go past midnight). Dine-in: only if there is seating.
6. Links: Website = the brand domain. Menu = the brand site. Order online = the owner's choice (Clover pickup page, ON2GO
   brand page or the brand site's store page); set it as the preferred provider. Po Poulet NDG (DoorDash 27982486) is
   never linked.
7. Photos: logo, cover, 5+ dish photos per brand (the 168 dish photos keyed by Clover item id in pppmtl), storefront and
   sign photo for type A.
8. Never delete a profile without the owner: a duplicate or old location (e.g. Hochelaga, "Montréal-Nord") is marked
   "permanently closed" or merged through Google support.

## PPP Pizzeria

| Field | Value |
|---|---|
| Business name | PPP Pizzeria |
| Primary category (proposal) | Pizza restaurant |
| Additional categories (proposal) | Chicken restaurant, Fast food restaurant |
| Website | https://pppmtl.com |
| Menu link | https://pppmtl.com |
| Cuisine keywords (for posts, not the name) | Pizza, Poulet, Poutine / Pizza, Rotisserie chicken, Poutine |

Description FR (71 characters):
> Poulet, pizza et poutine de notre cuisine NDG, cueillette ou livraison.

Description EN (68 characters):
> Chicken, pizza and poutine from our NDG kitchen, pickup or delivery.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| NDG (6280 Somerled) | [cid 6093103527698124139](https://maps.google.com/?cid=6093103527698124139) | A or B: owner | todo |
| Saint-Léonard (5839 Jean-Talon E) | none recorded: search Google before creating one | A or B: owner | todo |

## OOEUF

| Field | Value |
|---|---|
| Business name | OOEUF |
| Primary category (proposal) | Fast food restaurant |
| Additional categories (proposal) | Hamburger restaurant, Hot dog restaurant |
| Website | https://ooeuf.ca |
| Menu link | https://ooeuf.ca |
| Cuisine keywords (for posts, not the name) | Casse-croûte, Burgers, Hot-dogs, Poutine / Snack bar, Burgers, Hot dogs, Poutine |

Description FR (549 characters):
> OOEUF, c’est le casse-croûte de quartier : burgers, hot-dogs Michigan, poutines et rondelles d’oignon, préparés dans nos cuisines de Notre-Dame-de-Grâce (NDG) et de Saint-Léonard, à Montréal. Le Big Matt, notre burger double, le cheeseburger, le Philly Burger et le Sloppy Joe sont servis avec garnitures et sauces au choix. Ajoutez un trio frites et breuvage, ou une poutine classique. La poutine classique ou bacon se commande du format mini au grand format. Hot-dogs Michigan, suprêmes ou toastés et rondelles d’oignon complètent le casse-croûte.

Description EN (472 characters):
> OOEUF is the neighbourhood snack bar: burgers, Michigan hot dogs, poutines and onion rings, made in our kitchens in Notre-Dame-de-Grâce (NDG) and Saint-Léonard, Montréal. The Big Matt, our double burger, the cheeseburger, the Philly Burger and the Sloppy Joe come with the toppings and sauces you choose. Add fries and a drink, or a classic poutine. Classic or bacon poutine comes in mini to large. Michigan, supreme or toasted hot dogs and onion rings round out the menu.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| NDG (6280 Somerled) | [cid 8027317480379740171](https://maps.google.com/?cid=8027317480379740171) | A or B: owner | todo |
| Saint-Léonard (5839 Jean-Talon E) | none recorded: search Google before creating one | A or B: owner | todo |

## Déjeuner Montréal

| Field | Value |
|---|---|
| Business name | Déjeuner Montréal |
| Primary category (proposal) | Fast food restaurant |
| Additional categories (proposal) | Hamburger restaurant, Snack bar |
| Website | https://dejeuner.ooeuf.ca |
| Menu link | https://dejeuner.ooeuf.ca |
| Cuisine keywords (for posts, not the name) | Casse-croûte, Trios, Poutine / Snack bar, Combos, Poutine |

Description FR (485 characters):
> Déjeuner Montréal sert les trios du casse-croûte : hamburgers, cheeseburgers, hot-dogs vapeur ou Michigan, frites et poutines garnies, préparés dans nos cuisines de Notre-Dame-de-Grâce (NDG) et de Saint-Léonard, à Montréal. Chaque trio vient avec frites et breuvage : deux hamburgers, un cheeseburger double avec rondelles d’oignon, deux hot-dogs vapeur, Michigan ou suprêmes. Côté poutines : hot-dog, italienne, steak ou toute garnie. Les frites se prennent nature, sauce ou Michigan.

Description EN (447 characters):
> Déjeuner Montréal serves snack-bar combos: hamburgers, cheeseburgers, steamed or Michigan hot dogs, fries and loaded poutines, made in our kitchens in Notre-Dame-de-Grâce (NDG) and Saint-Léonard, Montréal. Every combo comes with fries and a drink: two hamburgers, a double cheeseburger with onion rings, two steamed, Michigan or supreme hot dogs. For poutine: hot dog, Italian, steak or all-dressed. Fries come plain, with gravy or Michigan style.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| NDG (6280 Somerled) | none recorded: search Google before creating one | A or B: owner | todo |
| Saint-Léonard (5839 Jean-Talon E) | none recorded: search Google before creating one | A or B: owner | todo |

## Pi Pita

| Field | Value |
|---|---|
| Business name | Pi Pita |
| Primary category (proposal) | Lebanese restaurant |
| Additional categories (proposal) | Shawarma restaurant, Middle Eastern restaurant |
| Website | https://pipita.ca |
| Menu link | https://pipita.ca |
| Cuisine keywords (for posts, not the name) | Libanais, Shawarma, Shish taouk / Lebanese, Shawarma, Shish taouk |

Description FR (599 characters):
> Pi Pita sert la cuisine de rue libanaise : pitas et wraps shawarma, shish taouk et mixte, assiettes libanaises avec salade au choix, salades shish taouk et shawarma, et des options végétariennes, dans nos cuisines de Notre-Dame-de-Grâce (NDG) et de Saint-Léonard, à Montréal. Chaque pita ou wrap vient avec garnitures et sauces au choix. Ajoutez un trio frites et breuvage, ou une poutine classique. Les assiettes shish taouk, shawarma, mixte ou végétarienne se servent seules, avec un pita ou en duo, avec une salade maison, grecque ou César. Le shish taouk et le shawarma existent aussi en salade.

Description EN (545 characters):
> Pi Pita serves Lebanese street food: shawarma, shish taouk and mixed pitas and wraps, Lebanese plates with your choice of salad, shish taouk and shawarma salads, and vegetarian options, in our kitchens in Notre-Dame-de-Grâce (NDG) and Saint-Léonard, Montréal. Every pita or wrap comes with the toppings and sauces you choose. Add fries and a drink, or a classic poutine. Shish taouk, shawarma, mixed or vegetarian plates come on their own, with one pita or two, with a house, Greek or Caesar salad. Shish taouk and shawarma also come as a salad.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| NDG (6280 Somerled) | [cid 2408837339277880870](https://maps.google.com/?cid=2408837339277880870) | A or B: owner | todo |
| Saint-Léonard (5839 Jean-Talon E) | none recorded: search Google before creating one | A or B: owner | todo |

## Pita Libanais

| Field | Value |
|---|---|
| Business name | Pita Libanais |
| Primary category (proposal) | Lebanese restaurant |
| Additional categories (proposal) | Shawarma restaurant, Family restaurant |
| Website | https://pitalibanais.pppmtl.com |
| Menu link | https://pitalibanais.pppmtl.com |
| Cuisine keywords (for posts, not the name) | Libanais, Repas familiaux, Shish taouk / Lebanese, Family meals, Shish taouk |

Description FR (550 characters):
> Pita Libanais, ce sont les repas libanais à partager : quatre assiettes ou quatre pitas pour la famille, trios pour deux, et le shish taouk et le shawarma en sous-marin, en poutine ou sur pizza, dans nos cuisines de Notre-Dame-de-Grâce (NDG) et de Saint-Léonard, à Montréal. Pour la famille : quatre assiettes libanaises ou quatre pitas au choix, avec frites et boissons. Pour deux : deux pitas avec deux mini poutines, ou deux assiettes avec deux breuvages. Le shish taouk et le shawarma se prennent aussi en sous-marin, en poutine ou sur une pizza.

Description EN (464 characters):
> Pita Libanais is Lebanese food to share: four plates or four pitas for the family, combos for two, and shish taouk and shawarma as a sub, a poutine or a pizza, in our kitchens in Notre-Dame-de-Grâce (NDG) and Saint-Léonard, Montréal. For the family: four Lebanese plates or four pitas of your choice, with fries and drinks. For two: two pitas with two mini poutines, or two plates with two drinks. Shish taouk and shawarma also come as a sub, a poutine or a pizza.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| NDG (6280 Somerled) | none recorded: search Google before creating one | A or B: owner | todo |
| Saint-Léonard (5839 Jean-Talon E) | none recorded: search Google before creating one | A or B: owner | todo |

## Mythos & Go

| Field | Value |
|---|---|
| Business name | Mythos & Go |
| Primary category (proposal) | Greek restaurant |
| Additional categories (proposal) | Souvlaki restaurant, Fast food restaurant |
| Website | https://mythos.pppmtl.com |
| Menu link | https://mythos.pppmtl.com |
| Cuisine keywords (for posts, not the name) | Grec, Gyros, Souvlaki / Greek, Gyros, Souvlaki |

Description FR (512 characters):
> Mythos & Go sert la cuisine de rue grecque : pitas et assiettes gyros et souvlaki, brochettes, salade grecque, poutine, sous-marin et pizza gyros, dans nos cuisines de Notre-Dame-de-Grâce (NDG) et de Saint-Léonard, à Montréal. Les assiettes gyros, souvlaki porc ou souvlaki poulet viennent avec une salade maison, grecque ou César, seules ou avec pita. Pour deux : deux assiettes de deux brochettes, poulet ou porc. Le gyros se prend aussi en pita, en sous-marin, en poutine ou sur une pizza. Ajoutez de la feta.

Description EN (440 characters):
> Mythos & Go serves Greek street food: gyros and souvlaki pitas and plates, skewers, Greek salad, gyros poutine, sub and pizza, in our kitchens in Notre-Dame-de-Grâce (NDG) and Saint-Léonard, Montréal. Gyros, pork souvlaki or chicken souvlaki plates come with a house, Greek or Caesar salad, on their own or with pita. For two: two plates of two skewers, chicken or pork. Gyros also comes in a pita, a sub, a poutine or on a pizza. Add feta.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| NDG (6280 Somerled) | none recorded: search Google before creating one | A or B: owner | todo |
| Saint-Léonard (5839 Jean-Talon E) | none recorded: search Google before creating one | A or B: owner | todo |

## Nutrition Shake

| Field | Value |
|---|---|
| Business name | Nutrition Shake |
| Primary category (proposal) | Health food restaurant |
| Additional categories (proposal) | Salad shop, Vegetarian restaurant |
| Website | https://nutrishake.ca |
| Menu link | https://nutrishake.ca |
| Cuisine keywords (for posts, not the name) | Santé, Salades protéinées, Végétarien / Healthy, Protein salads, Vegetarian |

Description FR (584 characters):
> Nutrition Shake prépare des repas légers et protéinés : salades au poulet, au steak, au gyros, César et maison, le duo de salades protéinées, un sous-marin végétarien, des tacos aux haricots noirs, de l’eau et des boissons froides, dans nos cuisines de Notre-Dame-de-Grâce (NDG) et de Saint-Léonard, à Montréal. Salade au poulet, au steak, au gyros, César ou maison : de quoi manger frais, au dîner comme au souper. Le duo de salades protéinées se partage à deux. Côté végétarien : le sous-marin végétarien et les tacos aux haricots noirs. Pour boire : de l’eau ou une boisson froide.

Description EN (468 characters):
> Nutrition Shake makes light, protein-rich meals: chicken, steak, gyros, Caesar and house salads, the two protein salads deal, a vegetarian sub, black bean tacos, water and cold drinks, in our kitchens in Notre-Dame-de-Grâce (NDG) and Saint-Léonard, Montréal. Chicken, steak, gyros, Caesar or house salad: fresh food for lunch or dinner. The two protein salads deal is made to share. Vegetarian: the vegetarian sub and black bean tacos. To drink: water or a cold drink.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| NDG (6280 Somerled) | none recorded: search Google before creating one | A or B: owner | todo |
| Saint-Léonard (5839 Jean-Talon E) | [cid 17679975320192778617](https://maps.google.com/?cid=17679975320192778617) | A or B: owner | todo |

## Bin Molle & Bin Dure

| Field | Value |
|---|---|
| Business name | Bin Molle & Bin Dure |
| Primary category (proposal) | Ice cream shop |
| Additional categories (proposal) | Dessert shop |
| Website | https://bmbd.ca |
| Menu link | https://bmbd.ca |
| Cuisine keywords (for posts, not the name) | Crèmerie, Desserts / Ice cream shop, Desserts |

Description FR (568 characters):
> Bin Molle & Bin Dure, c’est le comptoir à desserts glacés du quartier : slush, gaufres, crêpes, cheesecakes Oreo et aux brisures de chocolat, et boissons gazeuses bien froides, préparés dans nos cuisines de Notre-Dame-de-Grâce (NDG) et de Saint-Léonard, à Montréal. Une slush bleue ou rouge, du petit au grand format, une gaufre ou une crêpe avec le coulis de votre choix : le dessert parfait après le souper. Pour fêter : cheesecake Oreo ou aux brisures de chocolat, à la pointe ou en gâteau complet. Et un root beer, un cream soda ou une boisson gazeuse bien froide.

Description EN (471 characters):
> Bin Molle & Bin Dure is the neighbourhood icy dessert counter: slush, waffles, crêpes, Oreo and chocolate chip cheesecakes, and ice-cold soft drinks, made in our kitchens in Notre-Dame-de-Grâce (NDG) and Saint-Léonard, Montréal. A blue or red slush, small to large, a waffle or a crêpe with the sauce you choose: the perfect dessert after dinner. To celebrate: Oreo or chocolate chip cheesecake, by the slice or whole. And an ice-cold root beer, cream soda or soft drink.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| NDG (6280 Somerled) | [cid 5723855720782944465](https://maps.google.com/?cid=5723855720782944465) | A or B: owner | todo |
| Saint-Léonard (5839 Jean-Talon E) | none recorded: search Google before creating one | A or B: owner | todo |

## OCRÊPE

| Field | Value |
|---|---|
| Business name | OCRÊPE |
| Primary category (proposal) | Creperie |
| Additional categories (proposal) | Dessert shop, Waffle house |
| Website | https://ocrepe.ca |
| Menu link | https://ocrepe.ca |
| Cuisine keywords (for posts, not the name) | Crêpes, Gaufres, Desserts / Crêpes, Waffles, Desserts |

Description FR (458 characters):
> OCRÊPE prépare des crêpes et des gaufres avec le coulis de votre choix, des gâteaux Nutella, Ferrero Rocher et Oréo, dans nos cuisines de Notre-Dame-de-Grâce (NDG) et de Saint-Léonard, à Montréal. Chaque crêpe et chaque gaufre vient avec un choix de coulis. Ajoutez des garnitures sucrées pour une collation ou un dessert à partager. Pour finir le repas : gâteau Nutella, Ferrero Rocher ou Oréo, cheesecake Oreo, une slush bien glacée ou une boisson gazeuse.

Description EN (395 characters):
> OCRÊPE makes crêpes and waffles with the sauce you choose, plus Nutella, Ferrero Rocher and Oreo cakes, in our kitchens in Notre-Dame-de-Grâce (NDG) and Saint-Léonard, Montréal. Every crêpe and every waffle comes with a choice of sauce. Add sweet toppings for a snack or a dessert to share. To finish the meal: Nutella, Ferrero Rocher or Oreo cake, Oreo cheesecake, an icy slush or a soft drink.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| NDG (6280 Somerled) | none recorded: search Google before creating one | A or B: owner | todo |
| Saint-Léonard (5839 Jean-Talon E) | none recorded: search Google before creating one | A or B: owner | todo |

## Gâteau Montréal

| Field | Value |
|---|---|
| Business name | Gâteau Montréal |
| Primary category (proposal) | Cake shop |
| Additional categories (proposal) | Pastry shop, Dessert shop |
| Website | https://viennoise.ca |
| Menu link | https://viennoise.ca |
| Cuisine keywords (for posts, not the name) | Pâtisserie, Gâteaux, Cheesecakes / Pastry, Cakes, Cheesecakes |

Description FR (518 characters):
> Gâteau Montréal (La Viennoise), c’est la pâtisserie du quartier : gâteaux Ferrero Rocher, red velvet, carotte, citron, Skor et cheesecakes, à la pointe ou entiers, préparés dans nos cuisines de Notre-Dame-de-Grâce (NDG) et de Saint-Léonard, à Montréal. Chaque gâteau se commande à la pointe ou entier, pour un anniversaire, un souper en famille ou une petite gâterie. Ajoutez un coulis ou des garnitures. Nos favoris : le Ferrero Rocher, le red velvet et le gâteau aux carottes. Côté cheesecake : pistache et amaretto.

Description EN (455 characters):
> Gâteau Montréal (La Viennoise) is the neighbourhood pastry shop: Ferrero Rocher, red velvet, carrot, lemon and Skor cakes and cheesecakes, by the slice or whole, made in our kitchens in Notre-Dame-de-Grâce (NDG) and Saint-Léonard, Montréal. Every cake comes by the slice or whole, for a birthday, a family dinner or a small treat. Add a sauce or toppings. Our favourites: Ferrero Rocher, red velvet and carrot cake. For cheesecake: pistachio and amaretto.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| NDG (6280 Somerled) | none recorded: search Google before creating one | A or B: owner | todo |
| Saint-Léonard (5839 Jean-Talon E) | none recorded: search Google before creating one | A or B: owner | todo |

## Taco Mexican

| Field | Value |
|---|---|
| Business name | Taco Mexican |
| Primary category (proposal) | Mexican restaurant |
| Additional categories (proposal) | Taco restaurant, Burrito restaurant |
| Website | https://tacomontreal.ca |
| Menu link | https://tacomontreal.ca |
| Cuisine keywords (for posts, not the name) | Mexicain, Tacos, Burritos, Nachos / Mexican, Tacos, Burritos, Nachos |

Description FR (446 characters):
> Taco Mexican prépare tacos, burritos, quesadillas et nachos au poulet, au steak, au bœuf ou aux haricots noirs, dans nos cuisines de Notre-Dame-de-Grâce (NDG) et de Saint-Léonard, à Montréal. Les tacos se commandent à l’unité ou en trio familial. Les burritos et les quesadillas viennent avec les garnitures de votre choix. Pour partager : nachos au bœuf, au poulet ou au fromage en sauce. Une version végétarienne aux haricots noirs est offerte.

Description EN (374 characters):
> Taco Mexican makes tacos, burritos, quesadillas and nachos with chicken, steak, beef or black beans, in our kitchens in Notre-Dame-de-Grâce (NDG) and Saint-Léonard, Montréal. Tacos come one at a time or as a family trio. Burritos and quesadillas come with the toppings you choose. To share: beef, chicken or cheese sauce nachos. A vegetarian black bean version is available.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| NDG (6280 Somerled) | none recorded: search Google before creating one | A or B: owner | todo |
| Saint-Léonard (5839 Jean-Talon E) | none recorded: search Google before creating one | A or B: owner | todo |

## Pizza Inntime

| Field | Value |
|---|---|
| Business name | Pizza Inntime |
| Primary category (proposal) | Pizza restaurant |
| Additional categories (proposal) | Pizza delivery, Pizza takeout |
| Website | https://inntime.ca |
| Menu link | https://inntime.ca |
| Cuisine keywords (for posts, not the name) | Pizzeria, Pizza / Pizzeria, Pizza |

Description FR (485 characters):
> Pizza Inntime sort du four des pizzas toute garnie, pepperonata, napolitaine, végétarienne, au poulet ou au bacon, et des combos pizza-poutine, dans nos cuisines de Notre-Dame-de-Grâce (NDG) et de Saint-Léonard, à Montréal. Nos classiques : toute garnie, pepperonata, napolitaine et végétarienne, au poulet ou au bacon. Le pain magique au fromage accompagne tout. Pour les soirées en groupe : deux pizzas moyennes ou deux larges, ou une pizza avec sa poutine, de la petite à la grande.

Description EN (428 characters):
> Pizza Inntime bakes all-dressed, pepperonata, Neapolitan, vegetarian, chicken and bacon pizzas, plus pizza-and-poutine deals, in our kitchens in Notre-Dame-de-Grâce (NDG) and Saint-Léonard, Montréal. Our classics: all-dressed, pepperonata, Neapolitan and vegetarian, chicken or bacon. Cheesy magic bread goes with everything. For a night with friends: two medium or two large pizzas, or a pizza with its poutine, small to large.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| NDG (6280 Somerled) | none recorded: search Google before creating one | A or B: owner | todo |
| Saint-Léonard (5839 Jean-Talon E) | none recorded: search Google before creating one | A or B: owner | todo |

## Pizza Algérie

| Field | Value |
|---|---|
| Business name | Pizza Algérie |
| Primary category (proposal) | Pizza restaurant |
| Additional categories (proposal) | Chicken wings restaurant, Pizza takeout |
| Website | https://pizzaalgerie.pppmtl.com |
| Menu link | https://pizzaalgerie.pppmtl.com |
| Cuisine keywords (for posts, not the name) | Pizza, Combos pizza / Pizza, Pizza combos |

Description FR (435 characters):
> Pizza Algérie, ce sont des combos pizza avec pilons frits, ailes ou sous-marin, la pizza Philly steak et le pain magique, préparés dans notre cuisine de Notre-Dame-de-Grâce (NDG), au 6280 avenue Somerled, à Montréal. Les combos : une pizza avec des pilons frits, des ailes ou un sous-marin, frites, salade, sauce et Pepsi, de la bambino à la large. Ou deux pizzas Deluxe moyennes. À la carte : la pizza Philly steak et le pain magique.

Description EN (382 characters):
> Pizza Algérie makes pizza combos with fried drumsticks, wings or a sub, the Philly steak pizza and magic bread, in our kitchen in Notre-Dame-de-Grâce (NDG), 6280 Somerled Avenue, Montréal. The combos: a pizza with fried drumsticks, wings or a sub, fries, salad, sauce and Pepsi, from bambino to large. Or two medium Deluxe pizzas. À la carte: the Philly steak pizza and magic bread.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| NDG (6280 Somerled) | none recorded: search Google before creating one | A or B: owner | todo |

## Po Poulet

| Field | Value |
|---|---|
| Business name | Po Poulet |
| Primary category (proposal) | Chicken restaurant |
| Additional categories (proposal) | Fried chicken takeaway, Chicken wings restaurant |
| Website | https://popoulet.ca |
| Menu link | https://popoulet.ca |
| Cuisine keywords (for posts, not the name) | Poulet frit, Ailes, Burgers poulet / Fried chicken, Wings, Chicken burgers |

Description FR (477 characters):
> Po Poulet, c’est le poulet frit croustillant à Saint-Léonard : poulet frit en 3, 4, 9 ou 15 morceaux avec frites, salade de chou et sauce, ailes et croquettes, et burgers au poulet, au 5839 rue Jean-Talon Est, à Montréal. Du repas solo de 3 morceaux au festin de 15 morceaux avec frites, sauces, salades de chou et Pepsi. Ailes ou croquettes : 6 ou 10 morceaux avec frites, sauce et Pepsi. Aussi : le burger poulet et les trios burgers poulet avec frites ou rondelles d’oignon.

Description EN (413 characters):
> Po Poulet is crispy fried chicken in Saint-Léonard: 3, 4, 9 or 15 pieces with fries, coleslaw and gravy, wings and nuggets, and chicken burgers, at 5839 Jean-Talon Street East, Montréal. From a 3-piece meal for one to a 15-piece feast with fries, gravy, coleslaw and Pepsi. Wings or nuggets: 6 or 10 pieces with fries, sauce and Pepsi. Also: the chicken burger and chicken burger combos with fries or onion rings.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| Saint-Léonard (5839 Jean-Talon E) | none recorded: search Google before creating one | A or B: owner | todo |

## Poulet Poulet

| Field | Value |
|---|---|
| Business name | Poulet Poulet |
| Primary category (proposal) | Chicken wings restaurant |
| Additional categories (proposal) | Chicken restaurant, Fast food restaurant |
| Website | https://pouletpoulet.popoulet.ca |
| Menu link | https://pouletpoulet.popoulet.ca |
| Cuisine keywords (for posts, not the name) | Ailes de poulet, Croquettes / Chicken wings, Nuggets |

Description FR (512 characters):
> Poulet Poulet, ce sont les ailes de poulet et les croquettes avec frites, sauce et Pepsi, de 6 à 25 morceaux, et les trios burger ou cheeseburger avec ailes, dans nos cuisines de Notre-Dame-de-Grâce (NDG) et de Saint-Léonard, à Montréal. Ailes ou croquettes, au choix : 6, 10, 15 ou 25 morceaux, avec frites, sauces et Pepsi. Une aile de plus ? Elle se commande à l’unité. Les trios : cheeseburger ou burger poulet avec 6 ailes et une boisson gazeuse. À côté : frites maison, poutine classique et salade de chou.

Description EN (466 characters):
> Poulet Poulet is chicken wings and nuggets with fries, sauce and Pepsi, from 6 to 25 pieces, plus burger or cheeseburger combos with wings, in our kitchens in Notre-Dame-de-Grâce (NDG) and Saint-Léonard, Montréal. Wings or nuggets, your choice: 6, 10, 15 or 25 pieces, with fries, sauces and Pepsi. One more wing? Order it by the piece. The combos: cheeseburger or chicken burger with 6 wings and a soft drink. On the side: house fries, classic poutine and coleslaw.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| NDG (6280 Somerled) | none recorded: search Google before creating one | A or B: owner | todo |
| Saint-Léonard (5839 Jean-Talon E) | none recorded: search Google before creating one | A or B: owner | todo |

## Café Bolon

| Field | Value |
|---|---|
| Business name | Café Bolon |
| Primary category (proposal) | Latin American restaurant |
| Additional categories (proposal) | Mexican restaurant, Fast food restaurant |
| Website | https://bolon.ca |
| Menu link | https://bolon.ca |
| Cuisine keywords (for posts, not the name) | Latino-américain, Empanadas, Nachos / Latin American, Empanadas, Nachos |

Description FR (494 characters):
> Café Bolon propose des bouchées d’inspiration latino-américaine : empanadas, quesadillas, nachos, burritos et tacos au bœuf, au steak ou aux haricots noirs, pita et poutine tacos, dans nos cuisines de Notre-Dame-de-Grâce (NDG) et de Saint-Léonard, à Montréal. Pour grignoter : empanadas, nachos au steak ou aux haricots noirs, quesadillas au bœuf ou aux haricots noirs, tacos au steak. Pour un repas : burrito aux haricots noirs, assiette ou pita de viande à tacos, sous-marin ou poutine tacos.

Description EN (411 characters):
> Café Bolon offers Latin American-inspired bites: empanadas, quesadillas, nachos, burritos and tacos with beef, steak or black beans, taco pita and taco poutine, in our kitchens in Notre-Dame-de-Grâce (NDG) and Saint-Léonard, Montréal. To snack: empanadas, steak or black bean nachos, beef or black bean quesadillas, steak tacos. For a meal: black bean burrito, taco meat plate or pita, taco sub or taco poutine.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| NDG (6280 Somerled) | [cid 13512885180808196559](https://maps.google.com/?cid=13512885180808196559) | A or B: owner | todo |
| Saint-Léonard (5839 Jean-Talon E) | [cid 9510640660342127576](https://maps.google.com/?cid=9510640660342127576) | A or B: owner | todo |

## Place Afrique

| Field | Value |
|---|---|
| Business name | Place Afrique |
| Primary category (proposal) | African restaurant |
| Additional categories (proposal) | Grill, Fast food restaurant |
| Website | https://placeafrique.bolon.ca |
| Menu link | https://placeafrique.bolon.ca |
| Cuisine keywords (for posts, not the name) | Grillades, Bouchées / Grill, Snacks |

Description FR (430 characters):
> Place Afrique propose samoussas, pâtés jamaïcains, empanadas et assiettes de brochettes et de souvlaki grillés, préparés dans nos cuisines de Notre-Dame-de-Grâce (NDG) et de Saint-Léonard, à Montréal. Pour grignoter : samoussas, pâté jamaïcain et empanadas. Pour un vrai repas : deux assiettes de deux brochettes, poulet ou porc, avec breuvages. À côté : pilon de poulet, salade de chou, frites maison et un ginger ale bien froid.

Description EN (381 characters):
> Place Afrique offers samosas, Jamaican patties, empanadas and grilled skewer and souvlaki plates, made in our kitchens in Notre-Dame-de-Grâce (NDG) and Saint-Léonard, Montréal. To snack: samosas, Jamaican patty and empanadas. For a real meal: two plates of two skewers, chicken or pork, with drinks. On the side: chicken drumstick, coleslaw, house fries and an ice-cold ginger ale.

| Kitchen | Known Google profile (cid) | Listing type | Status |
|---|---|---|---|
| NDG (6280 Somerled) | none recorded: search Google before creating one | A or B: owner | todo |
| Saint-Léonard (5839 Jean-Talon E) | none recorded: search Google before creating one | A or B: owner | todo |

