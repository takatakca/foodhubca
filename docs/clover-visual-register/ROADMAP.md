# Roadmap: Clover picture register and kiosk

> **FR — En bref.** P0 : réponses écrites (Clover, Revenu Québec), modèle de la Station Duo, fiche d'appli Android,
> appareil de test sandbox, photos de tous les plats. P1 : la caisse photo du personnel sur vos restaurants (appli
> approuvée non publiée). P2 : la borne en français (mode client sur Mini/Flex, puis grand écran relié à un Mini ou
> Flex). Rien n'est vendu à un marchand extérieur avant l'isolation par marchand et la réponse MEV/SRM.
>
> **EN — In short.** P0: written answers (Clover, Revenu Québec), Station Duo model, Android app record, sandbox test
> device, photos for every dish. P1: the staff picture register in the owner's restaurants (approved, unpublished
> app). P2: the French kiosk (customer mode on Mini/Flex, then a big screen paired with a Mini or Flex). Nothing is
> sold to an outside merchant before per-merchant isolation and the SRM answer.

**Owner** = owner-only step (passwords, payments, Clover dashboard clicks, merges, deploys). Everything else is agent work on a
branch, never on `main`.

---

## P0 — Prerequisites (no app code)

| # | Step | Who | Done when |
|---|---|---|---|
| P0.1 | Owner reads [OWNER_DECISIONS.md](OWNER_DECISIONS.md) and answers decisions 1–11 | Owner | Answers written in the PR or `private/TASKS.md` |
| P0.2 | Check the Station Duo model: Settings → About (Duo 1 = Android 8.1 / API 27, Duo 2 = Android 10 / API 29); note whether a Duo 1 was upgraded to Android 10. Same for any Mini / Flex | Owner | Model and Android version noted (no serial numbers in git) |
| P0.3 | Send the Developer Relations questions (§ "DevRel questions" below) from the developer account's email | Owner (agent drafts) | Written answers saved in `private/` |
| P0.4 | Ask Revenu Québec (partner / product-developer service) whether an order-only app relying on the merchant's certified Clover MEV app is an SEV | Owner (agent drafts) | Written answer |
| P0.5 | Québec lawyer reviews LEGAL_AND_MARKET.md §10 questions | Owner | Written opinion |
| P0.6 | Create the app record: **new Android app** (or the "on2go" draft, per decision 2), country Canada, sandbox first | Owner | App ID noted (env name only in git) |
| P0.7 | Get a sandbox-registered Clover test device (developer kit) or confirm with DevRel how to test before approval on the owner's hardware | Owner | Device boots in sandbox |
| P0.8 | Create the APK signing keystore; back it up off the VPS (two places) | Owner | Backup checked |
| P0.9 | Every dish sold in the owner's restaurants has its own photo ≥ 1200×800 and a French name (`menu verify` shows no `no_photo`) | Agent + owner (photos) | Menu check clean |
| P0.10 | Clover MEV app in place in each Québec restaurant (Clover MEV Connect or Clover MEV Web) | Owner | Confirmed per restaurant |

### DevRel questions (draft content, to rewrite in the owner's voice before sending)

1. **SRM.** An Android app that builds Clover orders with OrderConnector and takes payment only through
   PaymentConnector, while Clover and the merchant's certified Clover MEV app produce the bill: does Clover's SRM
   requirement apply to it? Under which category can it be listed for Canada until then?
2. **Photos.** Can our app get OLO menu permission to read item images, and what is the official image URL for
   `MenuItem.imageFilename`?
3. **targetSdk.** The SDK page says targetSdk 25 or lower; the Kiosk quick start says target API 29. Which applies to a
   staff register app, and which to a kiosk-mode app on Mini / Flex / Station?
4. **Semi-attended.** Is a counter self-order screen on a Mini or Flex, with staff in the room, "semi-attended" for
   Clover in Canada?
5. **Kiosk in Canada.** Will Clover Kiosk hardware be offered in Canada and in Québec, in French? Can our app be enabled
   on it?
6. **Plans.** Which Canadian merchant plans can install an app that needs Orders read/write and Inventory read? (Two
   Clover pages disagree.)
7. **Testing.** How do we test an APK on a production device before approval (the owner's own merchants)?
8. **Register photos.** Does Clover's Register show item photos on current ROMs?

## P1 — MVP: staff picture register (owner's restaurants only)

Scope:

- Kotlin APK, minSdk 29, targetSdk per P0.3 answer; Clover Android SDK + connector SDK; no Google Play Services.
- Layouts: Station Duo merchant screen (14" landscape), Mini (landscape), Flex (portrait).
- Category bar in Clover `sortOrder`; tile grid with photo, French name (English toggle), price; `colorCode` tile when
  no photo; sold-out tiles greyed and not tappable.
- Item sheet: modifier groups with min / max / required; allergen tags; "ask staff about allergies" line.
- Duo / Trio / Combo step offered once per eligible item, drink always chosen, prices from the Clover modifier groups.
- Cart: quantities, remove, note; totals with Clover's own tax rates.
- "Send to kitchen": Clover order via OrderConnector + fire; "Pay": PaymentConnector (full payment only; tips in
  Clover's flow).
- Employee: Clover's signed-in employee recorded on the order.
- Offline: tiles and cart from local data; clear "Paiement par carte indisponible / Card payment unavailable" state.
- Server: 3rd app key `register`, routes, token store, webhook, per-app entitlement, picture-menu feed (see
  ARCHITECTURE.md §3). Owner's merchants never billed.

### Acceptance checks (P1)

| # | Check | How |
|---|---|---|
| A1 | Every tile price equals the price Clover charges for that item and its modifiers | Order 10 random items with modifiers; compare the Clover order total to the screen |
| A2 | An order from the app appears in Clover Orders with the right items, modifiers, upsell and employee | Clover Dashboard → Orders |
| A3 | The kitchen ticket prints on the right kitchen printer (labels) and shows on Clover KDS, once | Owner's real printers / KDS; webhook shows `printed=true` |
| A4 | Card payment runs only on Clover's secure screen; nothing card-related appears in app logs | Log review |
| A5 | Tip prompt (Clover's) computes on the pre-tax subtotal with no default choice | Payment on the test device with the merchant's tip settings |
| A6 | Every screen, button, error and toast exists in French and English; French is default for customer-facing text | Language switch walkthrough + string file diff |
| A7 | Sold-out item in Clover → greyed tile within one minute | Mark an item out of stock in Clover |
| A8 | Internet off → tiles and cart still work, card payment state shown, no crash | Unplug network |
| A9 | Photo missing → colour tile with name; photo slow → placeholder, no blocked screen | Remove one photo |
| A10 | WCAG A: contrast ≥ 4.5:1, every photo tile has alt text, TalkBack reads tiles and prices, targets ≥ 48 dp | Accessibility scanner + TalkBack pass |
| A11 | Duo / Trio / Combo offered once per eligible item, drink always chosen | Order each eligible dish |
| A12 | Lapsed entitlement (outside merchant) → app says so in FR/EN and stops new orders; owner's merchants never blocked | Mock billing states in tests |
| A13 | No crash in a full service (about 4 hours) on the Station Duo | Crash log empty |
| A14 | Food Hub checks still pass for the server changes: `npm run typecheck`, `npm run lint`, `npm test`, webpack build, `npm run verify:foodhub` | CI / local |

## P2 — Customer self-order (kiosk)

### P2a — Kiosk mode on a Clover device (Mini 3, Flex, Station)

- Same APK, kiosk mode switched on by a manager PIN.
- Clover Kiosk rules: `CustomerMode`, staff exit, `BOOT_COMPLETED`, `Lockscreen` auto-unlock (Employee Read),
  `keepScreenOn`, idle / attract screen, drop customer mode and lock on unhandled error.
- Kiosk payment intent or PaymentConnector, `setAllowPartialPayments(false)`.
- French default, English one tap away; alcohol hidden (or held for staff ID check).
- Semi-attended: written in the listing, the video and the merchant onboarding.

### P2b — Big-screen French kiosk (semi-integration)

- Web kiosk page on a tablet or 24" screen, built from the storefront code; order via `atomic_order`; payment pushed to
  a paired Clover Mini or Flex (REST / Cloud Pay Display).
- Separate Remote App ID (RAID) approval with Clover.
- Steady internet required; offline = "commandez au comptoir / order at the counter".

### Acceptance checks (P2, in addition to P1)

| # | Check |
|---|---|
| K1 | A customer cannot leave the app (home, back, notification shade) without the staff PIN |
| K2 | After the daily reboot the kiosk relaunches and unlocks by itself |
| K3 | An unhandled error leaves customer mode and locks the device |
| K4 | No partial payment possible; a declined card returns to the cart, not to a half-paid order |
| K5 | Idle 60 s → cart cleared, attract screen in French |
| K6 | Alcohol tiles never shown in kiosk mode (or the order is held for staff ID) |
| K7 | P2b: payment reaches the paired Mini / Flex and the Clover order closes as paid |

## Gate before any outside merchant

- Per-merchant data isolation built and tested (ON2GO Hub H4 plan, `docs/ON2GO_HUB_ECOSYSTEM.md`).
- Written SRM answer from Clover **and** Revenu Québec, and the lawyer's opinion.
- Public listing approved (not only the unpublished app).

## App Market submission checklist

- [ ] App record: Android (device) type, Canada (and US if wanted), name and original icon (no McDonald's or Clover
      look-alike).
- [ ] Devices listed: only supported, non-Gen-1 devices tested in sandbox.
- [ ] Permissions, each with its reason: Orders read + write (create and fire orders), Inventory read (tiles), Merchant
      read (name, tax), Employees read (kiosk unlock, employee on order). Nothing else.
- [ ] REST config: Site URL, Alternate Launch Path, OAuth response type (for the server side of the app).
- [ ] Webhook URL verified (App events; Orders if used).
- [ ] APK: triple-signed, same key as every later version, rollback APK with a higher versionCode, keystore backed up.
- [ ] Functional video (FR or EN with subtitles): open app → tiles → modifiers → Duo/Trio/Combo → send to kitchen →
      ticket prints → pay on Clover's screen → order in Clover; then offline state; then (P2) kiosk mode and staff exit.
- [ ] Legal: Clover-specific privacy policy and EULA (PIPEDA, Québec Law 25), support contact (generic address, not a
      person's).
- [ ] Bilingual listing text and screenshots (FR and EN), "semi-attended / personnel présent" wording for kiosk.
- [ ] Pricing: 14-day free trial, then CAD $50/month (or the owner's decision 7), set in the Clover dashboard.
- [ ] SRM answer in hand before choosing a restaurant vertical category for Canada.
- [ ] "How to test" notes for the reviewer (sandbox merchant with sample menu and photos).
