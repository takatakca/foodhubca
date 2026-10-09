# pppmtl.com: the real Clover menu, paid on Clover, shown on the Food Hub tablet (task 12)

> **Pour le propriétaire (FR)**
> - pppmtl.com garde sa mise en page. Chaque produit affiché est le vrai produit Clover : vrai prix, vraies options
>   (« en trio », sauces, extras…), vraie photo.
> - Le client choisit ses options, ajoute au panier, puis paie sur la page sécurisée de Clover (Clover Hosted
>   Checkout). Le site ne voit jamais la carte.
> - La commande payée arrive dans votre caisse Clover avec le titre « 🌐 Site web · PPP-… · Prénom », s'imprime une
>   seule fois, et apparaît sur la tablette cuisine Food Hub (« Site web »).
> - Le code du site est dans le dépôt **takatakca/pppmtl**, branche `clover-direct`. Vos étapes (clés Clover, adresse
>   du webhook, hébergement) : `docs/integrations/clover.md` dans ce dépôt-là.

> **For the owner (EN)**
> - pppmtl.com keeps its layout. Every item it shows is the real Clover item: real price, real options, real photo.
> - The customer picks the options, adds to the cart and pays on Clover's secure page (Clover Hosted Checkout).
> - The paid order lands in Clover titled "🌐 Site web · PPP-… · first name", prints once, and shows on the Food Hub
>   kitchen tablet. Steps (Clover keys, webhook address, hosting): `docs/integrations/clover.md` in **takatakca/pppmtl**.

## Why this design (official Clover sources)
- **Clover Online Ordering cannot take a cart or an item from another site**: no per-item link, no cart API, and its
  pages refuse to be framed (task 10, `docs/CLOVER_WEBSITE_ORDERS.md`). So the site keeps its cart and pays with
  **Clover Hosted Checkout** ([docs](https://docs.clover.com/dev/docs/hosted-checkout-api), North America incl. Canada).
- Hosted Checkout does not use the Clover inventory and has no modifier field: each cart line is one Clover line,
  options in the line note, item id in `itemRefUuid`, Québec taxes per line.
- Hosted Checkout orders carry **no online-ordering order type**, and Clover documents no automatic print for them.
  So once Clover's webhook says APPROVED, the site titles the Clover order **"🌐 Site web · …"** and prints it once
  (`print_event`). An order already titled is never printed again.

## Food Hub's part (this branch, `clover-website-menu`, on top of task 10)
- The task-10 mirror (`lib/foodhub/pos/clover-website-orders.ts`) now also treats a Clover order whose **title or note
  starts with "Site web" / "Website"** as a website order (`isSiteWebMarked`). Platform orders and Food Hub's own
  tickets (`🌐 W-1043 · …`) keep their kind.
- The kitchen card shows it paid, with the customer's first name (from the title when Clover has no customer), and
  the event "paid on the brand's site with Clover Hosted Checkout; the site printed it in Clover".
- **Food Hub still sends nothing to Clover and prints nothing** for these orders: no double ticket.
- It arrives through the Clover Orders webhook (UPDATE after the site titles the order; an untitled order is never
  cached as "not a website order") or the 30-second poller.
- Tests: `tests/clover-website-orders.test.ts` (recognition), `scripts/foodhub-e2e.mjs` section 44 (`HCO-WEB-1`).

The public menu feed / embed widget / Food Hub cart first planned for task 12 were **not built**: the owner chose to
keep pppmtl.com's own pages and pay on Clover.

## Works once
1. Food Hub production has its database (task 1) and tasks 9 → 10 → 12 are merged and deployed (Food Hub's Clover app
   has the **Orders** webhook event, task 10 §4 step 6; `FOODHUB_CLOVER_WEBSITE_BRAND=PPP Pizzeria`).
2. pppmtl runs on a server (Lovable hosting or Coolify), with the Clover variables of `docs/integrations/clover.md`.

## Handoff (status, next step)
- Status: code done and tested on both branches; nothing deployed; no Clover setting changed.
- Next step (owner): pppmtl `docs/integrations/clover.md` §5 (Ecommerce key, Hosted Checkout webhook, REST token),
  choose the host (§4), then one real test order + refund. Decision: the REST token for "title + print" (Clover
  documents dashboard tokens for testing; if refused, move that step to Food Hub, which holds the OAuth token).
- Files: this note, `lib/foodhub/pos/clover-website-orders.ts` (`isSiteWebMarked`), pppmtl
  `src/lib/integration/providers/clover/webhook.ts`.
