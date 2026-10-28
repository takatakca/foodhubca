# Food project: who does what, and how the repos talk without stepping on each other

_2026-10-28 · owner's question: "how do all these repos work together on one dashboard, without conflicts?" · scope:
the food project only. Builds on `docs/ON2GO_HUB_ECOSYSTEM.md` (contracts C1–C10) and `docs/MASTER_PLAN.md` § 6._

## 1. The answer in five rules

1. **One dashboard for the restaurants: Food Hub (ON2GO Hub, `foodhubca`).** Orders, kitchen screen, menus, 86,
   hours, platform screens, alarms, money checks. No other repo shows or changes live orders.
2. **One owner per kind of data.** Each repo keeps its own database. Nobody writes into another repo's database:
   they call each other's API (signed) or read a public feed.
3. **One way in for each order.** Every order enters Food Hub by exactly one path (platform API, Clover, or the
   Order Relay). Never two paths for the same store, or the order arrives twice (locked rule).
4. **One login authority: TAKATAK V1.** Company accounts, team members, plans and Stripe subscriptions live in
   `takatak-v1`. Other apps open from V1 with a short sign-in hand-off (like the Academy bridge). Food Hub keeps its own
   kitchen PINs and tablets (they must work when the internet to V1 is down).
5. **Different money, different system.** Restaurant sales receipts for Revenu Québec = QCMEV. Business invoices =
   Facturations (Wave). App subscriptions = Clover billing (Clover apps) and Stripe in V1 (TAKATAK services). Payout
   checks = Food Hub Money. They never post into each other.

## 2. Each repo's job (food project)

| Repo | Job in the food project | Owns (source of truth) | Talks to |
|---|---|---|---|
| **foodhubca** (Food Hub / ON2GO Hub) | The restaurant dashboard. | Orders, menus, stores, hours, kitchen tablets, platform screens, incidents, payout reconciliation | Clover, Uber/DoorDash/Skip/TGTG, QCMEV (sales receipts), ON2GO.ca (public feed), V1 (later: sign-in, usage) |
| **QCMEV.CA** (Takatak MEV) | Revenu Québec SRS/MEV: signs every restaurant sale. | Fiscal transactions, certificates, offline queue | Receives sales from Food Hub (PRs QCMEV #4 / Food Hub #100, open) |
| **pppmtl** (pppmtl.com + franchise storefronts) | Customers order on the brand sites. | Its storefront pages and cart only | Pays by **Clover Hosted Checkout**; the order lands in Clover, and Food Hub reads it from Clover. pppmtl never posts orders to Food Hub directly (that would be a second path). Menu: should read Food Hub's menu (one menu everywhere). |
| **deli-aden-online** | Deli Aden's own ordering site (separate restaurant, own Stripe + Supabase). | Its own orders and customers | Its `server-takatak.cjs` sends events out. Proposed: point it at Food Hub's **Order Relay** (one channel key, e.g. `relay:deli-aden`) so its orders show on the same dashboard and kitchen screen. Owner decision. |
| **takatak-v1** (TAKATAK Dashboard V1) | The company control tower: client accounts, members, plans, Stripe, analytics. | Identity, tenants, entitlements, subscriptions | Launches Food Hub / Academy / SEO with a sign-in hand-off; receives usage counts (no customer data) |
| **Facturations** | Staff B2B invoicing with Wave (not deployed). | Business invoices | Nothing in the food flow. Keep apart from MEV receipts. |
| **SEOTAKATAK** | SEO engine inside V1 (Search Console, briefs). | SEO sites, queries, briefs | Reads public pages of pppmtl / ON2GO.ca; tenant from V1 |
| **knowledgeAI** | Shared notes for all agents (decisions, contracts). | Documentation | Read by every agent; never by the apps at run time |
| **ACADEMYTAKATAK** | Training (staff / clients). | Courses, progress | Sign-in from V1. Not in the order flow. |
| **takatak-doordash-operations** | Empty templates for DoorDash support and reconciliation. | Templates only | Real cases stay private |
| **takatak-automate** | Marketplace of TAKATAK agency services (websites, SEO packages). | Service orders (not food orders) | V1. Not in the food flow; its "orders" are service purchases, never restaurant orders. |
| **takatakbackend** | Legacy Express / MongoDB API, being retired. | — | **Out of the food project.** Build nothing new on it. |
| **takatak** | Empty Next.js starter. | — | Out. |
| **TAKATAKREVIEW** | Empty repository. | — | Out (Food Hub already has the Reviews hub). |
| **Clover Marketplace apps** (the repos with a "4" in their name) | Not visible to Claude yet. Known Clover apps in code: TAKATAK Food Hub and TAKATAK Phone AI, both inside `foodhubca` (`docs/CLOVER_MULTI_APP.md`). | — | Rule for any other Clover app: it uses **Food Hub's** API for menus/orders and its own OAuth token per merchant, never Food Hub's database. |

## 3. How information moves (one direction each, so nothing fights)

```
 Uber · DoorDash · Skip · TGTG ──API / webhooks──► FOOD HUB ◄──reads Clover orders── CLOVER ◄── pppmtl checkout
 Platform screens (relay host) ──status only─────►   │  ▲                                  ▲
 Deli Aden (proposed) ──────────Order Relay──────────┘  │ menus, 86, accept, print         │ Clover apps (#4 repos)
                                                       ▼                                   
                         QCMEV ◄── each sale (signed receipt)
                         ON2GO.ca ◄── public feed (brands, hours, links)
                         TAKATAK V1 ◄── usage counts; V1 ──sign-in hand-off──► Food Hub / Academy / SEO
```

## 4. What stops conflicts

- **Store ownership list** (in Food Hub → Stores → mapping): each platform store id has one path (`direct`, `via
  Clover` = `FOODHUB_VIA_CLOVER`, or `relay:<id>`). A path already taken is refused.
- **Signed calls only**: each link has its own secret (relay token, screen agent token, QCMEV key, V1 hand-off key),
  set in Coolify, never in git. Revoking one link never breaks the others.
- **Webhook address frozen**: `foodhub.on2go.ca` stays the address registered with the platforms.
- **Agents**: one repo, one branch, one task, claimed first (each repo's `AGENTS.md` / `WORKLOG.md`); only the owner
  merges to `main`. Cross-repo changes go through a written contract in the receiving repo, then both sides.
- **Po Poulet NDG (DoorDash 27982486)** is never touched by any repo.

## 5. Next steps, in order (each is one branch, one PR)

1. Merge what is open: Food Hub platform screens (this branch), MEV link (Food Hub #100 + QCMEV #4).
2. Give Claude access to the Clover "#4" repos, then add each to the table above with its contract.
3. Owner decision on Deli Aden → Order Relay; then a small change in `deli-aden-online` (point its relay at Food Hub).
4. pppmtl reads its menu from Food Hub's public menu feed (one menu, no copy).
5. V1 → Food Hub sign-in hand-off (same pattern as `takatak-v1/docs/TAKATAK_ACADEMY_BRIDGE.md`) and a Food Hub tile in V1.
