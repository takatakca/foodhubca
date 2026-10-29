# TAKATAK Suite playbook: how it is built, what it looks like, what to simplify next

_2026-10-29 · owner's question: "do I need to change the type of code? Make it all in one: each app works alone for any
franchise, and they always connect, because not everybody wants every service — the premium of the premium suite, with
menus and sub-menus (account → bank, profile, authorized actions…)". Contract between the apps: `docs/TAKATAK_SUITE.md`.
Inside each app: its `docs/SUITE_KIT.md`._

## 1. Short answer

**No change of code type is needed.** Food Hub and the nine Clover apps already run the same stack (Next.js 16, React 19,
TypeScript, PostgreSQL), the same brand (`BRAND.md`), the same Clover sign-in and the same signed link. What was missing
was one shared premium layer, the same in every app. It is now built:

| You asked for | Where it is |
|---|---|
| Each app works alone for any franchise | Each app has its own Clover App ID, plan, tokens and database; nothing in it needs Food Hub or another app |
| …and they always connect | Food Hub keeps the **suite directory** (which restaurant has which app). Every app shows the nine apps, opens the installed ones in one click (Clover's own sign-in) and links the others to the Clover App Market |
| Menus with sub-menus | Every app has the same side menu: its own screens (with sub-menus) · TAKATAK Suite · My account · Help |
| Account → bank, profile, authorized actions | My account → Profile · Plan and billing · Authorized actions · Devices · Payments and deposits · Security and data · Activity log |
| Secured | Clover roles checked by the server for each sensitive action, an activity log, sealed tokens, hashed device keys, no bank or card number anywhere |
| Tested | 30 kit and app tests in each app (the kit's own checks included), plus a browser walk-through of every screen against a fake Clover (§ 7) |

## 2. How it is built (one picture)

```
          Clover (sign-in, menu, orders, payments, employees, billing)
            ▲ OAuth v2 per app, tokens sealed              ▲ webhooks per app
            │                                              │
 ┌──────────┴───────────── each of the nine apps (same kit) ┴──────────────────────────┐
 │ KIT (identical): Clover link · store · session + role · authorized actions ·         │
 │ activity log · device keys · export · Shell (menus) · Account · Suite page · Help    │
 │ THE APP: lib/domain (logic + sections + actions + plans) · components/Panel.tsx      │
 └──────────┬────────────────────────────────────────────────────────────────────────────┘
            │ signed events (HMAC), never a customer name or phone
            ▼
 FOOD HUB: orders hub · suite bus (events in/out, retries) · suite directory · Settings → Connected apps
```

- **One app = one repo = one Clover app = one container = one database.** Removing one never stops the others.
- **The kit is the same file-for-file in the nine repos** (list in each `AGENTS.md`). A kit change goes to all nine at once.
- **An app plugs in by declaring** in `lib/domain/index.ts`: `sections` (its menu), `actions` (what needs a role),
  `deviceKinds` (registers, kiosks…), `tierFeatures` (what each plan adds). `components/Panel.tsx` draws its screens.

## 3. What each app shows (menu map)

The overview is the first screen; `›` marks a sub-menu; `(P)` Premium, `(V)` VIP; `[role]` the default lowest role to
see it. Every app also has **TAKATAK Suite**, **My account** (7 pages) and **Help**.

| App | Its own menu | Authorized actions (default lowest role) |
|---|---|---|
| **C4ISSE** register | Today (sales, taxes, tips, cash, refunds, by tender) · Register › Cash drawer (V), Picture Register (P), Clover menu, Register devices | sell (employee), drawer (employee), day report (employee), photos (manager) |
| **T4CTILE** kiosk | Overview (24 h orders, average order, ready, setup checklist) · Orders · Kiosks › Paired kiosks, Welcome screen | kiosk screen (manager) |
| **4CCOUNTING** books | Overview (7 days, chart) [manager] · Books › Sales journal (any period, tender columns, totals), GST and QST by month, Platforms, Exports | see books (manager), CSV export (manager, logged) |
| **TR4CKER** deliveries | In progress · New delivery · History (24 h / 7 days) · Reviews (P) | create/cancel deliveries (employee; also a dispatch station key), Google review link (manager) |
| **ST4FF** staff | Week (hours chart, cost, labour %, open shifts; any past week) [manager] · Team › Employees, Hourly wages [admin], Planned schedule (P) | see hours (manager), wages (admin — cost columns hidden from others), plan shifts (manager) |
| **M4RKETING** marketing | Segments (spend chart, what to do) · Discounts · Campaigns (P) · Audience (P) [admin] | discounts (manager), campaigns (manager), approve (admin), audience export (admin, logged) |
| **LOY4LTY** loyalty | Overview (members, points, value, activity) · At the counter › Member, Redeem points · Rules (P) · Devices | enroll/look up (employee), redeem (employee), rules (manager) |
| **REW4RDS** gift cards | Overview (liability, issued, redeemed, activity) · At the counter › Sell, Check a balance, Redeem, Reload · Devices | sell, redeem, reload (employee) |
| **CH4T** support | Open threads (notes, last Clover order) · New thread · Find a customer · Closed threads · Reply templates | threads (employee), look up (employee), templates (manager) |
| all nine | My account | change authorized actions (owner; never below admin), device keys (manager), data export (admin, logged) |

**Plans** (each app's `tierFeatures`, shown on its public page and in My account → Plan): only what works today is
listed; roadmap lines start with "Bientôt / Coming". Today most Premium and VIP extras of the READMEs are roadmap
(§ 6, item 6). Prices stay 50 / 100 / 150 $ a month, billed by Clover.

## 4. What it looks like

- Electric blue on deep navy (`BRAND.md`); green, amber and red only for status. App monogram (C4, T4, 4C, TR, S4, M4,
  L4, R4, CH) in a blue tile. French first, English one click away; every text exists in both.
- Desktop: fixed side menu (merchant name and plan at the top, sign-out at the bottom), sticky top bar (breadcrumbs,
  suite switcher, FR/EN, the person with their role). Screens are cards, stat tiles, bar charts drawn by the server
  (no chart library), tables with totals, tiles for hubs.
- Phone: the menu slides in from a button; stats two per row; tables scroll sideways.
- No JavaScript needed to move around (sub-menus are native `<details>`); forms use a small client component.
- A screen the plan does not include shows the plans and a "See the plans" button; a screen the role does not open
  shows who can, and where the owner changes it.

## 5. Security model (the parts a franchise owner asks about)

1. **Sign-in only through Clover.** No password in any TAKATAK app. The session names the merchant and the person, with
   their Clover role, signed for 7 days.
2. **Roles enforced on the server** for every sensitive action, with defaults per app and a per-restaurant override
   page. A device key counts as an employee. The activity log keeps who did what, allowed or refused, 180 days.
3. **Money never passes through an app.** No bank, transit or card number is asked or stored; payouts are Clover's. The
   "Payments and deposits" page says so and points to Clover.
4. **Secrets at rest:** Clover tokens AES-256-GCM sealed and deleted at uninstall; device keys and gift-card codes stored
   as hashes; tracking links sealed; the data export leaves all of them out.
5. **Between apps:** HMAC-signed calls, 5-minute window, one secret per app; no customer name, phone, email or address.
   An app can only announce itself in the directory.
6. **Law 25:** the marketing export only has customers who accepted marketing in Clover, is an admin action and is
   logged; each app can export or account for what it keeps (My account → Security and data).

## 6. What to improve or simplify next (in order)

1. **Merge and deploy** (owner): the 10 open pull requests, then Coolify. In each app's Clover dashboard tick
   **Employees: Read** (roles), then follow its `DEPLOY.md` § 5–6.
2. **Fewer moving parts in hosting.** Nine containers is right (each app is its own Clover listing), but use **one
   PostgreSQL server with one database per app** and **one scheduled task** that calls the nine `/api/cron` addresses.
3. **Kit as a package.** Today the kit is copied into nine repos and `tests/kit.test.ts` catches mistakes. Once merged,
   move it to one private package (`@takatak/suite-kit`) so a fix is one pull request instead of nine.
4. **One customer identity across apps.** LOY4LTY and REW4RDS key a customer as `sha256("<merchant>:<phone>")`; Food Hub
   uses `HMAC(salt, phone)`. Pick one (Food Hub's salted key is the safer) so loyalty, gift cards and support recognise
   the same person everywhere. Owner decision; then a small change in three repos.
5. **Food Hub console and suite apps look alike but are drawn differently** (Food Hub: Tailwind design system; apps:
   the kit's plain CSS). Same colours; when Food Hub's console is next redesigned, reuse the kit's menu pattern
   (My account sub-menus, role badge, activity log) so a manager moving between them sees one product.
6. **Roadmap, by value for the first franchises:** LOY4LTY at the T4CTILE kiosk · REW4RDS online sale (Clover
   Ecommerce) · 4CCOUNTING payouts vs sales · ST4FF payroll export and alerts · TR4CKER tips after delivery · CH4T
   sending (blocked until Pierre grants the exception) · C4ISSE and T4CTILE native Android parts (Android Studio).
7. **A "whole suite" offer.** Clover bills each app separately; a bundle price needs either one combined Clover app or
   a separate agreement. Owner decision.
8. **Check once live:** the Clover App Market link format (`www.clover.com/appmarket/apps/<App ID>`) on the public
   listings, and that each app opens in its own tab from the Clover dashboard (the session cookie is not sent inside
   another site's frame).

## 7. How it was checked (2026-10-29)

- Each app: `npm run typecheck`, `npm test` (kit tests: roles, authorized actions, refusals and the activity log, device
  keys acting as employees, unconfirmed roles, lock-out protection, export scrubbing, directory announce/read/cache,
  form result templates, the app's sections/actions/plans wiring; plus the app's own tests), `npm run build`.
- A browser walk-through (Playwright) of every screen of C4ISSE against a fake Clover and a fake Food Hub: all screens
  200 with no browser error, desktop and phone, a real form round trip (device key shown once → activity log). This
  found and fixed a bug from 2026-10-28: forms that formatted their own answer crashed the page on the server.
- Food Hub: `typecheck`, `lint`, `test` (directory: announce, read by another app, uninstall, refusal of an app speaking
  for another, unsigned read refused, unsafe address dropped), `next build --webpack`, `verify:foodhub`.
