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
> Plusieurs magasins d'une même marque (jour / nuit) sont voulus : on ne les signale jamais à DoorDash ; deux demandes
> séparées. En attendant : tablettes partout. Avant de relier Nutrition Shake à Clover, vérifier que le compte Clover choisi
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
4. **Several stores for one brand at one kitchen are intentional** (owner, 2026-10-10): day stores and night stores.
   Never ask DoorDash to merge, close or explain them. They go to DoorDash as **two separate requests**: one for the
   day stores, one for the night stores. The 6280 / "n-" stores can be activated by the owner, choosing Clover POS or
   DoorDash's tablet.
5. Old Hochelaga (3583 Ste-Catherine E) stores wait for the owner's decision (`docs/visibility/PLAN.md` §7).

## 3. The store list: two requests (owner labels day / night)

Every store is its own line; no store is merged into another. Grouped by address as DoorDash lists them; the owner
marks which group is day and which is night before sending.

### Request 1: stores at 6284 avenue Somerled (NDG) and 5839 rue Jean-Talon Est (Saint-Léonard)

| Brand | Store | Address in DoorDash | Note |
|---|---|---|---|
| Nutrition Shake | 27510307 | 6284 Somerled | Route A (Clover) in progress |
| Nutrition Shake | 33596565 | 5839 Jean-Talon | |
| Nutrition Shake | 34432851 | 5837 Jean-Talon | |
| Pi Pita | 27986352 | 6284 Somerled | "not eligible" notice: owner calls DoorDash |
| Pi Pita | 33598679 | 5839 Jean-Talon | |
| Pizza Inntime | 28519423 | 6284 Somerled | |
| Bin Molle & Bin Dure | 28108457 | 6284 Somerled | |
| Gâteau Montréal | 28114454 | 6284 Somerled | |
| Gâteau Montréal | 33521453 | 5839 Jean-Talon | |
| Taco Mexican | 30831008 | 6284 Somerled | |
| Taco Mexican | 33597179 | 5839 Jean-Talon | A POS request for this store is open on DoorDash's side |
| Mythos & Go | 32501513 | 6284 Somerled | Name check first (`PLAN.md` §7, item 14) |
| Café Bolon | 30831269 | 6284 Somerled | |
| Place Afrique | 32504033 | 6284 Somerled | Lowest priority |
| Poulet Poulet | 33598759 | 5839 Jean-Talon | Listed under the Po-Poulet business |

### Request 2: stores at 6280 avenue Somerled (NDG; the owner can activate these with Clover POS or the tablet)

| Brand | Store | Note |
|---|---|---|
| Nutrition Shake | 38993800 | |
| OOEUF | 41946357 | |
| Pi Pita | 41893249 | |
| Gâteau Montréal | 41889687 | |
| Taco Mexican | 41946481 | |
| Mythos & Go | 41946413 | Name check first |
| Café Bolon | 41946457 | |
| Place Afrique | 41946401 | Lowest priority |

### Stores to place in a request once the owner says which (not in DoorDash's 2026-10-08 list, or no address)

| Brand | Store | Note |
|---|---|---|
| OOEUF | 27870472 ("SUPREME"), 34525477 ("EXPRESS") | DoorDash shows no address |
| Poulet Poulet | 32501399 ("Poulet Express"), 28719392, 33597093 | 32501399 still on the old POS, paused by DoorDash |
| Po Poulet (Saint-Léonard) | 41950447 | "not eligible" notice first |
| PPP Pizzeria | 28040070 | |
| OCRÊPE | 27986646, 33596721 | |
| Les Pâtissières de ruelle | 27956368 (17 rue Perreault) | Not in our brand list: is it ours? |
| Hochelaga stores | 33597929, 33596799, 33598151, 33597315, 33600697, 33598853 | Hochelaga decision |

**Never in any request:** 27982486 (Po Poulet NDG, locked). **Ask the owner first:** 34494017, listed under the
Po-Poulet business at 6280 avenue Somerled.

## 4. CSV format for DoorDash's bulk tool

One file per request (day / night), one line per store the owner has confirmed:

```csv
doordash_store_id,merchant_supplied_id,store_name,brand,kitchen,street,city,province,postal_code
27510307,NDG-NUTRISHAKE-1,Nutrition Shake,Nutrition Shake,NDG,6284 avenue Somerled,Montréal,QC,H3X 2B6
```

`merchant_supplied_id` is the hub's own store code (kitchen + brand + store number, so day and night stores stay apart). The filled-in list, with DoorDash's business IDs,
is in the Drive sheet; send it only when DoorDash asks, from the account's own email or portal.

Sources: DoorDash, "Integrate DoorDash with Clover POS" (help.doordash.com/en-ca/merchants/article/integrate-doordash-with-your-clover-pos);
Clover, "DoorDash FAQs" (clover.com/en-US/help/doordash-frequent-questions); DoorDash developer docs, "Self-Serve
Integration Onboarding (SSIO)", "Store Onboarding Webhook" and "Onboard Stores in Bulk"
(developer.doordash.com/en-US/docs/marketplace/...). Check them again before acting: they change.
