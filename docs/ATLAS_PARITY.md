# TAKATAK Food Hub vs Atlas (UrbanPiper / Ordermark) — feature by feature

Atlas is UrbanPiper's restaurant dashboard (Ordermark is part of UrbanPiper). This is what
TAKATAK Food Hub does for each Atlas module, where to find it, and what is **not** built.
TAKATAK talks to the platforms **directly** — there is no aggregator and no monthly fee.

Legend: **Done** = built and covered by the end-to-end test (`npm run verify:foodhub`, 374 checks) ·
**Platform limit** = the platform's API does not allow it · **Not built** = missing today.

## Orders

| Atlas | TAKATAK | Where | Status |
|---|---|---|---|
| One order feed for every app | Uber Eats, DoorDash, SkipTheDishes, Too Good To Go in one list | Command Center, Order Board | Done |
| Auto-accept / manual accept | Per store; never accepts an order Clover did not receive | Stores → Auto-accept | Done |
| Reject with a reason | Standard reasons mapped to each platform's own codes | Reject button → reason dialog | Done |
| Order states (placed → acknowledged → food ready → dispatched → completed / cancelled) | New → Preparing → Ready → Picked up → Completed / Cancelled | Order Board (5 columns) | Done |
| Order details + timeline | Items, options, notes, totals, every step with time and who did it, event log | Orders → click an order | Done |
| Order history, filters, search, export | Date range, location, platform, brand, status, search by order # / customer / Clover id; CSV + Excel | Orders | Done |
| Print kitchen ticket (KOT) | Printed on the Clover printer automatically; reprint button; 80 mm browser ticket | Order → Reprint / Print ticket | Done |
| New-order alerts | Full-screen pop-up with beep loop until someone looks (also for auto-accepted orders), countdown to the platform deadline, accept with prep time or reject with a reason; red cancellation alarm on every screen; desktop notifications — set per screen | Every screen, Settings → Alerts | Done |
| Prep time / busy mode | Normal and busy minutes per location; busy toggle on the Command Center | Command Center → Kitchen, Stores | Done (DoorDash receives it; Uber/Skip: printed ready-by time) |
| Cancel after accepting | Uber Eats by API with reason; DoorDash/Skip in their portal/tablet (Food Hub updates when they confirm) | Order → Cancel… | Done for Uber · Platform limit for DoorDash/Skip |
| Courier / rider details | Skip driver status, DoorDash Dasher status (name, phone, car, arriving / at the store), Uber courier details when shared; picked up / delivered move the order forward | Order card, order page | Done |
| Scheduled (advance) orders | Accepted and sent to Clover at once, kitchen ticket printed at due time − prep time, own "Scheduled" lane | Order Board, Command Center | Done |
| POS order type + payment | Platform order type on every Clover order; paid with a platform tender when it leaves the kitchen; cancelled orders removed from the register | Clover | Done |
| Missing items after accepting | Skip: report the item by API (Skip adjusts the bill) · Uber/DoorDash: in their portal | Order → Report missing item | Done for Skip · Platform limit for Uber/DoorDash |
| Orders the platform routed elsewhere | Skip "failed order for backup flow" recorded and alerted | Command Center | Done |

## Menu

| Atlas | TAKATAK | Where | Status |
|---|---|---|---|
| Master catalogue per brand | Categories, items, option groups, base price + Uber / DoorDash / Skip prices | Menu Manager | Done |
| Import from POS | Clover inventory, categories and modifiers (keeps your platform prices, photos, tags) | Import from Clover | Done |
| Item details | Description, photo (URL), dietary tags, allergens, calories | Item → Edit | Done (photo by link — no upload/hosting) |
| Menu verification before publish | Errors block publishing; warnings and tips shown with a Fix link | Menu check | Done |
| Publish to chosen stores / platforms | Pick stores, publish now | Publish… | Done |
| Scheduled publish | Pick a date/time; cancel before it runs | Publish… → Schedule | Done |
| Publish status per store | Last publish time and result per platform/location | Publish status | Done |
| Timing groups (breakfast, lunch) | Category schedules, intersected with store hours | Categories → Schedule | Done |
| Copy a menu to another brand | Copies categories, items, options | Copy from brand… | Done |
| Item / option availability (86) | Per location or all locations, timed (comes back by itself), bulk select | 86 Board | Done |
| Menu in French + English | French names for items, categories, options; Uber Eats gets both languages, DoorDash / Skip English or French (your choice) | Menu Manager → Languages | Done |
| Inventory sync from POS | Out of stock in Clover → 86 everywhere, back by itself; Clover price changes flagged with one-click update | Menu Manager, 86 Board | Done |
| Combos / nested options | One level of options | — | Not built |
| Taxes & charges per platform | Each platform applies its own tax settings | — | Platform side |

## Stores

| Atlas | TAKATAK | Where | Status |
|---|---|---|---|
| Store on/off per platform, timed | Pause / resume one store, a cell, or a whole location; timed pauses re-open by themselves | Command Center matrix, Stores | Done |
| Store hours | Per location, several slots per day, overnight slots, brand exceptions | Store Hours | Done |
| Holiday hours | Closed days and special hours → Uber holiday hours, DoorDash special hours; Skip taken offline for the day | Store Hours → Holidays | Done |
| Store status monitoring | Open / closed (Z) / paused / deactivated (I) per brand × location × app, alerts | Command Center | Done |
| Locations & brands | Add / edit / deactivate | Brands & Locations | Done |

## Analytics

| Atlas | TAKATAK | Status |
|---|---|---|
| Revenue, orders, average order vs previous period | Any range, compared with the period just before | Done |
| By platform / brand / location | Bars + tables, share and change | Done |
| Lost orders & cancellations | Who cancelled (store / platform / customer), before/after accepting, reasons, lost revenue | Done |
| Item performance | Top items by revenue with quantity change; items in cancelled orders | Done |
| Busiest hours | Day × hour heatmap | Done |
| Operations | Time to accept, auto-accept rate, prep time, orders reaching Clover | Done |
| Store uptime during opening hours | From every status change Food Hub records | Done |
| New vs returning customers | Only when the platform shares a customer id | Partial |
| Ratings & reviews | — | Not built |
| Payouts & commissions | Expected payout per order (your commission plan + tax on fees), statements (Uber Reporting API, DoorDash / Skip / TGTG files), missing / short-paid / error charges / refunds, dispute cases, bank deposits, internal ledger with GST/QST | Done (statements from DoorDash, Skip, TGTG are imported by you) |

Every chart has a table view and CSV download; filters live in the link (Copy link).

## Reports (CSV / Excel, email now, daily / weekly / monthly schedules)

Order Transactions · Order Status Transitions · Item-wise Order Transactions · Option-wise Order
Transactions · Items Summary Across All Locations · Menu Snapshot Across All Locations · Store Action
Report — **Done** (`/insights/reports`; email through Resend).

## Users & control

| Atlas | TAKATAK | Status |
|---|---|---|
| Users, roles, permissions | Owner, Manager, Store operator, Menu editor, Analyst | Done |
| Location-limited users | A user sees and acts on their locations only (orders, stores, Command Center, reports) | Done |
| Activity log | Who paused, 86'd, published, changed hours/users, signed in, approved with a PIN — and the platform result | Done |
| Login | Passwordless: 6-digit code or one-tap link by email or SMS; kitchen tablets with staff PINs | Done |
| Manager approval | Staff need a manager PIN to reject, cancel, refund, pause, change a price or text a customer (configurable per action) | Done (beyond Atlas) |
| Single sign-on (Google / Microsoft) | — | Not built |

## Kitchen device

| Atlas | TAKATAK | Status |
|---|---|---|
| Tablet app for the kitchen | Installable app (Add to Home Screen): full screen, screen kept awake, offline warning, sound alerts, PIN screen | Done (web app — no app-store install) |
| "Your tablet is off" | Heartbeat every 30 s; off / muted during opening hours → the kitchen phone rings, managers are texted then called | Done |

## Watchtower (beyond Atlas)

| What | Status |
|---|---|
| Background supervisor: waiting / unseen / late orders, couriers waiting, Clover failures, stores offline or deactivated, tablets, cancellation spikes, sync, unreadable messages, refused actions, money to recover | Done |
| Escalation: screen → team chat → kitchen phone → SMS → call → owner + support line; quiet hours; *I'm on it* | Done |
| AI explanations + copilot (Claude, optional; rules without a key) — AI never approves or posts anything | Done |
| Text / call the customer from the order (when the platform shares a number) | Done |

## Not built yet

Combos / nested options · ratings & reviews · own-courier dispatch for phone orders (DoorDash Drive /
Uber Direct) · single sign-on (Google / Microsoft).

## Not in scope (Atlas add-ons)

Promotions / ads manager, loyalty, native app-store app. (Customer texts and a French / English interface are now built.)
