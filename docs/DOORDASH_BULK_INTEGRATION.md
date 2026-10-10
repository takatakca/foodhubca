# DoorDash: connecting every brand's store at once (2026-10-10)

The owner's question: one store has already been moved off the tablet, so do the same for every brand in one go and
give DoorDash the store IDs when they ask. How does DoorDash do this in bulk?

Public facts only. Business IDs, support case numbers and people's contacts are in the owner's Drive folder
"TAKATAK OPS (private)" (sheet "DoorDash integration list - ready to send"). Po Poulet NDG (DoorDash store 27982486) is
never included, in this file or in any list sent to DoorDash.

> **Pour le propriétaire (résumé).** Il y a deux façons de relier DoorDash à la caisse.
> 1. **Le lien Clover de DoorDash** (ce que DoorDash vient de proposer pour Nutrition Shake) : un magasin DoorDash par
>    compte Clover, et **un seul menu**, celui de la commande en ligne Clover, qui **remplace** le menu DoorDash. Avec
>    plusieurs marques sur une même caisse Clover, chaque marque recevrait le menu de toute la cuisine. Ça marche
>    seulement si chaque marque a son propre compte Clover avec son propre menu.
> 2. **Notre hub TAKATAK (Food Hub) comme intégration DoorDash** : un seul branchement pour tous les magasins, chaque
>    marque garde son menu, les commandes arrivent dans la caisse Clover de la cuisine. DoorDash l'active **en lot**
>    avec une liste de numéros de magasin (la liste est prête). Il faut d'abord que DoorDash approuve le hub (demande
>    envoyée à leur équipe d'ingénierie).
> En attendant : tablettes partout. Avant de relier Nutrition Shake à Clover, vérifier que le compte Clover choisi
> n'a **que** le menu Nutrition Shake.

## 1. What DoorDash offers (verified from DoorDash and Clover help pages, 2026-10-10)

### Route A: DoorDash's own Clover link (one store at a time)

- Started from the **Clover dashboard**: Online Ordering → DoorDash → Get started → pick the DoorDash store. Needs a
  Clover online menu. DoorDash then turns Clover on as the store's order protocol (DoorDash says usually within 24 h;
  others report several days). DoorDash support asked to keep the tablet on until their test order goes through.
- **One menu per integration:** the Clover online menu syncs to DoorDash in real time and is the store's DoorDash menu.
  Dayparted menus are not supported.
- **One Clover account per DoorDash store:** a store already linked to another Clover account cannot be linked again
  (Clover shows an "already linked" error).
- No DoorDash or Clover page says one Clover account can feed several DoorDash stores with **different** menus.
- **Bulk:** there is no bulk button. Each store is linked from its own Clover account; DoorDash can then switch the
  protocol for a list of store IDs.
- **Fit for us:** good for a brand that has its **own** Clover account and online menu. Wrong for brands that share one
  kitchen Clover: each brand's DoorDash menu would be replaced by the whole kitchen menu.

### Route B: our hub as a DoorDash integration partner (all stores, bulk)

DoorDash's partner tools (DoorDash developer docs) give three ways to put many stores on one integration:

| Way | How | Bulk? |
|---|---|---|
| Self-Serve Integration Onboarding (SSIO) | The owner logs in to DoorDash once from the hub (OAuth), sees every store, picks each one; DoorDash pulls the brand's menu from the hub and activates | One login, store by store in one screen |
| Store Onboarding Webhook | The hub sends one request per store | One store per request |
| **Bulk onboarding tool (CSV)** | DoorDash's Technical Account Manager uploads a CSV; the `doordash_store_id` column maps each line to the right store | **Yes, all stores at once** (DoorDash grants it as an exception) |

- Needs DoorDash to approve the hub as an integration partner first (requested; DoorDash Integration Support sent it to
  their Engineering & Integration team on 2026-10-09).
- Each brand keeps its own menu (the hub publishes per brand); orders go into the kitchen's Clover through the hub's
  Clover order relay, which already exists in Food Hub.
- Food Hub today has neither SSIO nor the Store Onboarding Webhook (`CERTIFICATION_BACKLOG.md` item 7 skipped it), so
  the CSV route with DoorDash's account manager is the fastest bulk path once approved.
- "Provide the ID if they ask": the CSV below is that list.

### Route C (fallback): a paid middleware

Clover App Market middlewares (for example Deliverect) route several brands into one Clover. Paid per location; the
owner already left UrbanPiper. Only if Route B is refused.

## 2. Recommendation

1. **Now:** every store stays on the tablet (switched on 2026-10-08).
2. **Nutrition Shake NDG (27510307), already in progress on Route A:** before clicking "Get started" in Clover, check
   that the Clover account used has **only Nutrition Shake's items** in its online menu. If that Clover account also
   sells other brands, stop: DoorDash would replace Nutrition Shake's DoorDash menu with the shared menu.
3. **All other brands:** do not link them one by one to the shared kitchen Clover. Wait for the hub approval (Route B),
   then ask DoorDash's account manager for the bulk CSV onboarding with the list below.
4. **Before any list goes to DoorDash:** the owner settles the duplicates (one store per brand per kitchen) and the old
   Hochelaga stores (`docs/visibility/PLAN.md` §7).

## 3. The store list (one store per brand per kitchen; owner confirms the lines marked ?)

Pattern taken from the owner's own request for Nutrition Shake: at NDG keep the older store and set its address to
6280 avenue Somerled; the newer 6280 store merges into it. The same pattern is proposed for every brand below.
Hochelaga (3583 Ste-Catherine E) stores wait for the owner's decision.

| Brand | Kitchen | Keep (send to DoorDash) | Merge into it / close | Note |
|---|---|---|---|---|
| Nutrition Shake | NDG | 27510307 | 38993800 (owner's request) | Route A pilot in progress |
| Nutrition Shake | Saint-Léonard | 33596565 | 34432851 (5837) ? | |
| OOEUF | NDG | 27870472 ? | 34525477 "Express", 41946357 (6280) ? | DoorDash lists 27870472 as "SUPREME" with no address |
| OOEUF | Hochelaga | - | 33597929 ? | Hochelaga decision |
| Pi Pita | NDG | 27986352 | 41893249 (6280) | |
| Pi Pita | Saint-Léonard | 33598679 | - | |
| Pizza Inntime | NDG | 28519423 | - | |
| Pizza Inntime | Hochelaga | - | 33596799 ? | Hochelaga decision |
| Bin Molle & Bin Dure | NDG | 28108457 | - | |
| Bin Molle & Bin Dure | Hochelaga | - | 33598151 ? | Hochelaga decision |
| Gâteau Montréal | NDG | 28114454 | 41889687 (6280) | |
| Gâteau Montréal | Saint-Léonard | 33521453 | - | |
| Taco Mexican | NDG | 30831008 | 41946481 (6280) | |
| Taco Mexican | Saint-Léonard | 33597179 | - | A POS request for this store is open on DoorDash's side |
| Mythos & Go | NDG | 32501513 | 41946413 (6280) | Name check first (`PLAN.md` §7, item 14) |
| Mythos & Go | Hochelaga | - | 33600697 ? | Hochelaga decision |
| Café Bolon | NDG | 30831269 | 41946457 (6280) | |
| Café Bolon | Hochelaga | - | 33598853 ? | Hochelaga decision |
| Place Afrique | NDG | 32504033 | 41946401 (6280) | Lowest priority |
| Place Afrique | Hochelaga | - | 33597315 ? | Hochelaga decision |
| Poulet Poulet | NDG | 32501399 ("Poulet Express") ? | 28719392 ? | Still on the old POS, paused by DoorDash |
| Poulet Poulet | Saint-Léonard | 33598759 or 33597093 ? | - | DoorDash lists 33598759 under the Po-Poulet business at 5839 |
| Po Poulet | Saint-Léonard | 41950447 ? | - | Not in DoorDash's list; "not eligible" notice first |
| PPP Pizzeria | NDG | 28040070 ? | - | Not in DoorDash's list |
| OCRÊPE | NDG / Saint-Léonard | 27986646 / 33596721 ? | - | Not in DoorDash's list |
| Les Pâtissières de ruelle | 17 rue Perreault | 27956368 ? | - | Not in our brand list: is it ours? |

**Not on any list:** 27982486 (Po Poulet NDG, locked). **Check before sending:** 34494017 sits under the Po-Poulet
business at 6280 avenue Somerled in DoorDash's list; it may be a second Po Poulet NDG store, so it stays out until the
owner says what it is.

## 4. CSV format for DoorDash's bulk tool

One line per store to integrate, only "Keep" stores the owner has confirmed:

```csv
doordash_store_id,merchant_supplied_id,store_name,brand,kitchen,street,city,province,postal_code
27510307,NDG-NUTRISHAKE,Nutrition Shake (NDG),Nutrition Shake,NDG,6280 avenue Somerled,Montréal,QC,H3X 2B6
```

`merchant_supplied_id` is the hub's own store code (kitchen + brand). The filled-in list, with DoorDash's business IDs,
is in the Drive sheet; send it only when DoorDash asks, from the account's own email or portal.

Sources: DoorDash, "Integrate DoorDash with Clover POS" (help.doordash.com/en-ca/merchants/article/integrate-doordash-with-your-clover-pos);
Clover, "DoorDash FAQs" (clover.com/en-US/help/doordash-frequent-questions); DoorDash developer docs, "Self-Serve
Integration Onboarding (SSIO)", "Store Onboarding Webhook" and "Onboard Stores in Bulk"
(developer.doordash.com/en-US/docs/marketplace/...). Check them again before acting: they change.
