# Roadmap: Clover picture register and kiosk

> **FR — En bref.** P0 : réponses écrites (Clover, Revenu Québec, concepteur de l'appli MEV), modèle de la Station
> Duo, fiche d'appli (brouillon J0H36VTJBSBBP créé le 2026-10-23), appareil de test sandbox, photos de tous les plats,
> taxe Clover parasite retirée, évaluation vie privée (Loi 25). P1 : la caisse photo du personnel sur vos restaurants
> (appli approuvée non publiée), au Québec seulement après la réponse MEV et le test A15. P2 : la borne en français
> (mode client sur Mini/Flex, puis grand écran relié à un Mini ou Flex). Aucun restaurant québécois dans une fiche ou
> une vente avant les réponses MEV/SRM, et rien pour un marchand extérieur avant l'isolation par marchand.
>
> **EN — In short.** P0: written answers (Clover, Revenu Québec, the MEV app vendor), Station Duo model, app record
> (draft J0H36VTJBSBBP created 2026-10-23), sandbox test device, photos for every dish, stray Clover tax removed,
> privacy impact assessment (Law 25). P1: the staff picture register in the owner's restaurants (approved, unpublished
> app), in Québec only after the MEV answer and check A15. P2: the French kiosk (customer mode on Mini/Flex, then a big
> screen paired with a Mini or Flex). No Québec restaurant in any listing or sale before the SRM answers, and nothing
> for an outside merchant before per-merchant isolation.

**Owner** = owner-only step (passwords, payments, Clover dashboard clicks, merges, deploys). Everything else is agent work on a
branch, never on `main`.

---

## P0 — Prerequisites (no app code)

| # | Step | Who | Done when |
|---|---|---|---|
| P0.1 | Owner reads [OWNER_DECISIONS.md](OWNER_DECISIONS.md) and answers decisions 1–11 (decision 2 done on 2026-10-23) | Owner | Answers written in the PR or `private/TASKS.md` |
| P0.2 | Check the Station Duo model: Settings → About (Duo 1 = Android 8.1 / API 27, Duo 2 = Android 10 / API 29); note whether a Duo 1 was upgraded to Android 10. Same for any Mini / Flex | Owner | Model and Android version noted (no serial numbers in git) |
| P0.3 | Send the Developer Relations questions (§ "DevRel questions" below) from the developer account's email | Owner (agent drafts) | Written answers saved in `private/` |
| P0.4 | Ask Revenu Québec (partner / product-developer service) whether the register is part of the SRS. Working assumption until a written answer: it is | Owner (agent drafts) | Written answer |
| P0.4b | Ask both certified MEV vendors (Pulsar informatique Inc for Clover MEV Connect; 15535743 Canada inc. for Clover MEV Web) the § "MEV vendor questions" below | Owner (agent drafts) | Written answers saved in `private/` |
| P0.5 | Québec lawyer reviews LEGAL_AND_MARKET.md §10 questions | Owner | Written opinion |
| P0.6 | App record: **done as a draft on 2026-10-23**: "TAKATAK Picture Register" / FR "Caisse en images TAKATAK", App ID J0H36VTJBSBBP, app type intentionally unset. Next: set the type (Android, Clover devices), country Canada, sandbox first, final English name per decision 8 | Owner | App type set; env name only in git |
| P0.7 | Get a sandbox-registered Clover test device (developer kit) or confirm with DevRel how to test before approval on the owner's hardware | Owner | Device boots in sandbox |
| P0.8 | Create the APK signing keystore; back it up off the VPS (two places) | Owner | Backup checked |
| P0.9 | Every dish sold in the owner's restaurants has its own photo ≥ 1200×800 and a French name (`menu verify` shows no `no_photo`) | Agent + owner (photos) | Menu check clean |
| P0.10 | Clover MEV app in place in each Québec restaurant (Clover MEV Connect or Clover MEV Web); note which one, since it sets the register's features (ARCHITECTURE §2b) | Owner | Confirmed per restaurant |
| P0.11 | Remove the stray "Sales Tax" rate (0.14975 %) in Clover → Setup → Taxes & Fees in each merchant (`docs/CLOVER_BACKEND_FINAL.md` §1); an agent then confirms every item carries only GST 5 % and QST 9.975 % | Owner, then agent check | Clover check lists no stray rate |
| P0.12 | Privacy impact assessment for the register under Law 25 s. 3.3 (data: employee ID or name, order lines, device ID, server location), signed off by the person named in `FOODHUB_PRIVACY_OFFICER`; plus an s. 17 assessment if the Food Hub server is outside Québec | Agent drafts, owner signs | Signed copy in `private/` |
| P0.13 | Budget and plan our own SRS certification (decision 6B) in case the answers to P0.4 / P0.4b require it | Owner | Budget noted |

### DevRel questions (draft content, to rewrite in the owner's voice before sending)

1. **SRM.** Can a restaurant app be listed for Canada outside Québec while SRM certification is pending, and how do we
   exclude Québec merchants? (We list it in its real restaurant category.)
2. **Receipts in Québec.** How does a PaymentConnector sale trigger the merchant's registered Fiscalization app, and how
   do we remove the "No receipt" choice for Québec merchants (the October 2024 Revenu Québec fiscalization features)?
3. **Photos.** Can our app get OLO menu permission to read item images, and what is the official image URL for
   `MenuItem.imageFilename`?
4. **targetSdk.** We plan minSdk 29 and targetSdk 29 for both the staff register and kiosk mode, fully tested on each
   Canadian device ROM. Please confirm.
5. **Semi-attended.** Is a counter self-order screen on a Mini or Flex, with staff in the room, "semi-attended" for
   Clover in Canada?
6. **Kiosk.** Will Clover Kiosk come to Québec in French, and can a third-party app run on it in Canada?
7. **Plans.** Which Canadian merchant plans can install an app that needs Orders read/write and Inventory read? (Two
   Clover pages disagree.)
8. **Testing.** How do we test an APK on a production device before approval (the owner's own merchants)?
9. **Register photos.** Does Clover's Register show item photos on current ROMs?
10. **Name.** Is "TAKATAK Picture Register" acceptable under the Deceptive Behavior policy (names close to Clover apps
    supplied with the device), given the app builds orders beside Clover's Register?
11. **Station Duo customer screen.** Is an order summary through the customer-facing platform enough for the "fill both
    screens" requirement, or can a merchant-screen-only staff app get a written exemption?
12. **Canadian payments.** Is `tipAdjustAuth()` (and `auth()` / `preAuth()`) unsupported for credit cards in Canada too,
    or only for Interac?

### MEV vendor questions (draft content, one message per vendor, in French first)

1. Does your certified version record orders created by another Clover app through OrderConnector, with no
   recertification on your side?
2. Which fields must such an order carry so your app reports it correctly: type of service, activity subsector (for
   example Bar), detailed item description, employee?
3. For a payment taken through Clover's PaymentConnector, does your app print the closing receipt with its QR code
   automatically, with no "no receipt" path?
4. Which register features must stay off with your version (for example cancel, split tender, coupon, item transfer)?

## P1 — MVP: staff picture register (owner's restaurants only)

Scope:

- Kotlin APK, minSdk 29, targetSdk 29 (tested on each Canadian device ROM in sandbox); Clover Android SDK + connector
  SDK; no Google Play Services.
- Layouts: Station Duo merchant screen (14" landscape), Mini (landscape), Flex (portrait). Station Duo customer screen:
  order summary through Clover's customer-facing platform, or a written DevRel exemption (DevRel question 11).
- Category bar in Clover `sortOrder`; tile grid with photo, French name (English toggle), price; `colorCode` tile when
  no photo; sold-out tiles greyed and not tappable.
- Item sheet: modifier groups with min / max / required; allergen tags; "ask staff about allergies" line.
- Duo / Trio / Combo step offered once per eligible item, drink always chosen, prices from the Clover modifier groups.
- Cart: quantities, remove, note; totals with Clover's own tax rates, **after P0.11**; a warning blocks "Send" when an
  item carries any tax rate other than GST or QST; a tax-exempt order path; cash totals rounded to the nearest 5¢
  (cards not rounded).
- Revenu Québec fields on every order as the merchant's MEV app needs them: type of service, activity subsector,
  detailed item description (format per the vendor's answer to P0.4b).
- Features limited to what the merchant's MEV product can record (ARCHITECTURE §2b). With Clover MEV Connect: counter
  service only, no cancel after "Send", no split tender, no coupon tender.
- "Send to kitchen": Clover order via OrderConnector + fire; "Pay": PaymentConnector (full payment only; tips in
  Clover's flow; for Québec merchants, no "No receipt" path).
- Employee: Clover's signed-in employee recorded on the order (covered by the P0.12 assessment).
- Offline: tiles and cart from local data; clear "Paiement par carte indisponible / Card payment unavailable" state.
- No in-app ads or cross-promotion of other TAKATAK apps (Food Hub, Phone AI, ON2GO).
- Server: 3rd app key `register`, routes, token store, webhook, per-app entitlement, picture-menu feed (see
  ARCHITECTURE.md §3). Owner's merchants never billed.
- Québec gate: in the owner's Québec restaurants, live orders only after the MEV vendor answers in writing and A15
  passes.

### Acceptance checks (P1)

| # | Check | How |
|---|---|---|
| A1 | Every tile price equals the price Clover charges for that item and its modifiers, and the tax on each order equals GST 5 % plus QST 9.975 % and nothing else | Order 10 random items with modifiers; compare the Clover order total and tax lines to the screen |
| A2 | An order from the app appears in Clover Orders with the right items, modifiers, upsell and employee | Clover Dashboard → Orders |
| A3 | The kitchen ticket prints on the right kitchen printer (labels) and shows on Clover KDS, once | Owner's real printers / KDS; webhook shows `printed=true` |
| A4 | Card payment runs only on Clover's secure screen; nothing card-related appears in app logs | Log review |
| A5 | Tip prompt (Clover's) computes on the pre-tax subtotal with no default choice | Payment on the test device with the merchant's tip settings |
| A6 | Every screen, button, error and toast exists in French and English, with the same features in both (Charter art. 52.1); French is default for customer-facing text | Language switch walkthrough + string file diff + feature list per language |
| A7 | Sold-out item in Clover → greyed tile within one minute | Mark an item out of stock in Clover |
| A8 | Internet off → tiles and cart still work, card payment state shown, no crash | Unplug network |
| A9 | Photo missing → colour tile with name; photo slow → placeholder, no blocked screen | Remove one photo |
| A10 | WCAG 2.2 AA for contrast (SC 1.4.3, ≥ 4.5:1), plus Clover's mandatory alt text on every photo tile, TalkBack reading tiles and prices, Android accessibility; targets ≥ 48 dp | Accessibility scanner + TalkBack pass |
| A11 | Duo / Trio / Combo offered once per eligible item, drink always chosen | Order each eligible dish |
| A12 | Lapsed entitlement (outside merchant) → app says so in FR/EN and stops new orders; owner's merchants never blocked | Mock billing states in tests |
| A13 | No crash in a full service (about 4 hours) on the Station Duo | Crash log empty |
| A14 | Food Hub checks still pass for the server changes: `npm run typecheck`, `npm run lint`, `npm test`, webpack build, `npm run verify:foodhub` | CI / local |
| A15 | Québec merchants, per MEV product: for cash, credit, Interac, a refund and a cancelled order (where the MEV product allows it), the merchant's MEV app prints the Revenu Québec closing receipt with its QR code automatically, the payment flow offers no "No receipt" choice, and the transaction shows in WEB-SRM | Real test in one owner restaurant after P0.4b, with the MEV vendor |
| A16 | Cash total rounds to the nearest 5¢ in the cart and in Clover; card totals are not rounded | Cash and card test orders |
| A17 | A tax-exempt order goes through with no tax lines and is recorded correctly by the MEV app | Test order flagged exempt |

## P2 — Customer self-order (kiosk)

### P2a — Kiosk mode on a Clover device (Mini 3, Flex, Station)

- Same APK, kiosk mode switched on by a manager PIN.
- Clover Kiosk rules: `CustomerMode`, staff exit, `BOOT_COMPLETED`, `Lockscreen` auto-unlock (Employee Read),
  `keepScreenOn`, idle / attract screen, drop customer mode and lock on unhandled error.
- Kiosk payment intent or PaymentConnector, `setAllowPartialPayments(false)`.
- French default, English one tap away; attract screen French markedly predominant (Charter art. 58); alcohol hidden
  (or held for staff ID check).
- Reach and height of the screen per CSA/ASC B651.2 (accessible self-service interactive devices; the 2022 edition is
  withdrawn, superseded by CSA/ASC B651.2:25, https://scc-ccn.ca/standardsdb/standards/4031775, read 2026-10-23), not
  the Kiosk guide's US ADA reference.
- Semi-attended: written in the listing, the video and the merchant onboarding.

### P2b — Big-screen French kiosk (semi-integration)

- Web kiosk page on a tablet or 24" screen, built from the storefront code; order via `atomic_order`; payment pushed to
  a paired Clover Mini or Flex (REST / Cloud Pay Display).
- Separate Remote App ID (RAID) approval with Clover. Its price is billed through the App Market payment system, like
  every paid tier.
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
| K8 | A15 passes for kiosk orders too (Québec merchants) |

## Gate before any outside merchant

- Per-merchant data isolation built and tested (ON2GO Hub H4 plan, `docs/ON2GO_HUB_ECOSYSTEM.md`).
- No Québec restaurant merchant in any listing or sale until Revenu Québec, the MEV vendor and Clover have answered in
  writing, and the lawyer's opinion is in.
- Public listing approved (not only the unpublished app).

## App Market submission checklist

- [ ] App record: draft J0H36VTJBSBBP exists (type intentionally unset). Set Android (Clover devices) type, Canada (and
      US if wanted); English name per decision 8 (no name confusingly similar to Clover apps supplied with the device);
      original icon (no McDonald's or Clover look-alike).
- [ ] Devices listed: only supported, non-Gen-1 devices tested in sandbox.
- [ ] Permissions, each with its reason: Orders read + write (create and fire orders), Inventory read (tiles), Merchant
      read (name, tax), Employees read (kiosk unlock, employee on order). Nothing else (no Customers permission).
- [ ] REST config: Site URL, Alternate Launch Path, OAuth response type (for the server side of the app).
- [ ] Webhook URL verified (App events; Orders if used).
- [ ] APK: triple-signed, same key as every later version, rollback APK with a higher versionCode, keystore backed up.
- [ ] Functional video (FR or EN with subtitles): open app → tiles → modifiers → Duo/Trio/Combo → send to kitchen →
      ticket prints → pay on Clover's screen → order in Clover; then offline state; then (P2) kiosk mode and staff exit.
- [ ] Legal: Clover-specific privacy policy and EULA (PIPEDA, Québec Law 25), privacy impact assessment done (P0.12),
      support contact (generic address, not a person's).
- [ ] Quick reference guide shipped with the app, bilingual, French first (Clover App Support policy; Charter art. 41
      for the merchant's staff training).
- [ ] No in-app advertising or promotions, including no cross-promotion of Food Hub, Phone AI or ON2GO.
- [ ] Every paid tier, P2b included, billed through the Clover App Market payment system.
- [ ] Tax-exempt order path (Clover Canadian readiness page) and check A17.
- [ ] Cash rounding to the nearest 5¢ shown in the cart and check A16.
- [ ] Station Duo: customer-screen plan (order summary through the customer-facing platform) or a written DevRel
      exemption.
- [ ] Bilingual listing text and screenshots (FR and EN), "semi-attended / personnel présent" wording for kiosk; no
      "works with Clover MEV" claim until A15 passes for that MEV product.
- [ ] Pricing: 14-day free trial, then CAD $50/month (or the owner's decision 7), set in the Clover dashboard.
- [ ] Listed in its real restaurant category; Québec merchants excluded until the SRM answers are in (DevRel question 1).
- [ ] "How to test" notes for the reviewer (sandbox merchant with sample menu and photos).
