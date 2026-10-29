# Clover technical research: picture register and kiosk

> **FR — En bref.** La caisse photo doit être une appli **Android** sur l'appareil Clover (pas une appli web).
> Elle tourne à côté de la caisse Clover, crée de vraies commandes Clover et laisse Clover prendre le paiement
> (Payment Connector au Canada). L'API Clover ne donne pas d'adresse officielle pour les photos. Une borne
> client doit suivre les règles « Clover Kiosk » et rester semi-surveillée. Pas de paiement carte hors ligne au
> Canada. Tout a été lu le 2026-10-23.
>
> **EN — In short.** The picture register must be an **Android** app on the Clover device (not a web app). It
> runs beside Clover's Register, writes real Clover orders and lets Clover take the payment (Payment Connector
> in Canada). Clover's API gives no official image URL. A customer kiosk must follow Clover's Kiosk rules and stay
> semi-attended. No offline card payments in Canada. Everything was read on 2026-10-23.

Labels: **FACT** (read in the cited source), **INFERENCE** (our reasoning), **UNCONFIRMED** (search snippet only, or a
page we could not open). `community.clover.com` returned NXDOMAIN on 2026-10-23, so every forum point below comes
from search-index snippets only and must be re-checked with Clover Developer Relations.

---

## 1. App type: where a picture screen can run

- **FACT.** Clover's App Settings page says an Android app runs on Clover devices, while a Web app (REST client) is
  launched from the Merchant Dashboard: "Select Clover devices only if you want your Android app to run on the
  Clover device." Several app types can be selected, and the page is used to edit an existing app's settings; it does
  not say the type is locked at creation. Source: https://docs.clover.com/dev/docs/app-settings (updated 2026-03-24,
  read 2026-10-23).
- **UNCONFIRMED.** A Clover community answer (snippet only) said an Android app that wraps a WebView is still an
  Android app.
- **FACT (repo).** TAKATAK Food Hub (629HFYHNVMZYR) and TAKATAK Phone AI (20FK28P20HJC6) are web apps, both
  PENDING review since 2026-10-17. `docs/CLOVER_MULTI_APP.md` (owner step 2) said to keep the older "on2go" draft
  (N4NYCJCZ17FF4) "for a future ON2GO device app", and that an app's type and billing country are set at creation; the
  Clover page above does not support the type part.
- **FACT (owner, 2026-10-23).** The owner created a new draft "TAKATAK Picture Register" / FR "Caisse en images
  TAKATAK" (App ID J0H36VTJBSBBP), with the app type intentionally unset. He renamed N4NYCJCZ17FF4 to "ON2GO" and saved
  its FR/EN taglines and benefits; it still has App type Android (Mobile) + REST and an earlier Read + Write Customers
  permission he may remove. The TAKATAK app (listings, social) is F4TMP23FM7K5M.
- **INFERENCE.** The picture register must be an Android APK on the device. Food Hub and Phone AI launch from the
  Merchant Dashboard, so they cannot be this screen. An Android shell around a WebView could reuse web tile code, but
  payment, printer and inventory calls still go through native Clover SDK connectors (limits in §15).

## 2. Clover Android platform

- **FACT.** Clover devices run a customized Android with **no Google Mobile Services and no Play Store**: no
  Firebase, no `com.google.android.gms`. Java and Kotlin are preferred; Flutter and React Native "may work" but are
  discouraged. Permissions are granted at install time. Clover recommends supporting English, French, German,
  Spanish and Dutch. Source: https://docs.clover.com/docs/clover-development-basics-android (read 2026-10-23).
- **FACT.** "Clover devices are not Google Play certified and do not come with Google Play Services."
  Source: https://docs.clover.com/dev/docs/clover-devices (read 2026-10-23).
- **INFERENCE.** Kotlin. No FCM push, no ML Kit: use Clover webhooks, our own polling or a socket. French and English
  from day one.

## 3. SDK levels and devices

| Device | Android / API (FACT) | Screen use (FACT, design requirements) | For us |
|---|---|---|---|
| Station Duo (original, "Duo 1") | 8.1 (API 27), upgradable to 10; 14" + 7" | Landscape; fill both screens | Only if the owner's unit is a Duo 1; check whether it was upgraded to Android 10 |
| Station Duo 2 | AOSP 10 (API 29); 14" FHD merchant + 8" customer | Landscape; apps launch on the merchant display | **Main P1 target** |
| Station Solo | AOSP 10 (API 29) | Landscape | P1 |
| Mini 3 | AOSP 10 (API 29) | Landscape | P1; P2 kiosk candidate |
| Flex 3 | AOSP 10 (API 29) | **Portrait** | P1 (portrait grid) |
| Flex 4, Flex Pocket, Compact | Android 13 (API 33) | Flex: portrait | P1 if available in Canada |
| Gen-1 (Station C010, Mobile C020/C021, Mini C030/C031, Flex C041/C042) | End-of-App-Update | — | **Never list as supported** |

- **FACT.** Clover recommends a targetSdkVersion of 25 or lower, but "higher versions are supported if thoroughly
  tested". minSdkVersion by device: 17 runs on any Clover device; 29 for Flex 3, Mini 3, Station Duo 2 and Station
  Solo; 33 for Flex 4, Flex Pocket and Compact (page updated 2026-05-08).
  Source: https://docs.clover.com/docs/setting-android-sdk-versions (read 2026-10-23).
- **FACT.** Gen-1 devices reached End-of-App-Update on 2026-05-15: no new apps, no APK updates. The announcement says
  the cutoff was extended from March 30 to May 15, 2026, for North America (United States and Canada); the devices
  page still carries the old March 30 title. Gen-1 is out.
  Sources: https://docs.clover.com/docs/announcement-end-of-app-update-gen-1-devices ;
  https://docs.clover.com/dev/docs/clover-devices (read 2026-10-23).
- **FACT.** Device list: Station Duo 2, Station Solo, Mini 3 and Flex 3 run AOSP 10 (API 29); the original Station
  Duo runs 8.1, upgradable to 10; Flex 4, Flex Pocket and Compact run Android 13. Design requirements: Station Duo
  landscape and must fill both merchant and customer screens; Mini landscape; Flex portrait. WCAG, 4.5:1 contrast,
  alt text and TalkBack on merchant- and customer-facing screens.
  Sources: https://docs.clover.com/dev/docs/clover-devices ; https://docs.clover.com/dev/docs/app-design-requirements
  (read 2026-10-23).
- **FACT.** The Clover Kiosk quick start lists Android 10 (API 29) as the target SDK, with clover-android-sdk
  (https://docs.clover.com/dev/docs/developer-quick-start-clover-kiosk-integration, updated 2026-05-27, read
  2026-10-23). This is no conflict with the SDK page, which allows higher targets when thoroughly tested.
- **INFERENCE.** minSdk 29 and targetSdk 29 for both modes (staff register and kiosk), fully tested on each Canadian
  device ROM in sandbox; a targetSdk of 25 below a minSdk of 29 makes no sense. Compile against a current SDK. DevRel
  question 4 only asks for confirmation. Before coding, confirm whether the owner's Station Duo is a Duo 1 or a Duo 2.

## 4. Station Duo: merchant screen vs customer screen

- **FACT.** On Station Duo 2, "Apps launch on the merchant-facing display" (14" FHD). The 8" customer screen can only
  be reached through custom tenders or the customer-facing platform (Pay Display). Activities on the customer
  screen cannot take focus, so the Android keyboard does not work and toasts do not show. Payment starts through
  the Clover API and shows on the customer screen. Station Duo 1 is API 27 with a 14" and a 7" display.
  Sources: https://docs.clover.com/docs/build-apps-for-station-duo-2 ;
  https://docs.clover.com/docs/building-apps-for-station-pro (read 2026-10-23).
- **INFERENCE.** The staff picture register fits the Duo's merchant screen with no special permission. Clover's design
  requirements still say content fills both screens on a Station Duo (§3): plan an order summary on the customer screen
  through the customer-facing platform, or ask DevRel for a written exemption (DevRel question 11). A customer
  self-order screen on the Duo's small customer display is constrained and not its intended use: it is **not** the
  kiosk plan.

## 5. Replacing or reskinning Clover's Register

- **FACT.** No official Clover document says a third-party app may replace or reskin Register. App approval forbids
  apps that "impersonate a Clover or another developer's app".
  Source: https://docs.clover.com/docs/developer-app-approval (read 2026-10-23).
- **FACT.** Clover's Developer Program Policies, "Deceptive Behavior": an app must not have names or icons confusingly
  similar to existing products or to the Clover apps supplied with the device, and must not simulate functionality or
  warnings of Clover's operating system or other Clover apps. "Functionality Policies": an app may not install or
  launch other executable code, nor unlock features through any channel other than the App Market.
  Source: https://www.clover.com/app-market-policies (last updated 2025-01-01, read in a browser 2026-10-23).
- **UNCONFIRMED.** A community answer (snippet) said a custom Android home app needs the user to set it as default
  home, and doubted Clover would allow it without a special merchant relationship.
- **FACT.** Clover's own Kiosk guide launches the app on `BOOT_COMPLETED`.
  Source: https://docs.clover.com/dev/docs/developer-quick-start-clover-kiosk-integration (read 2026-10-23).
- **INFERENCE.** The picture register is a normal app the staff opens, next to Register, writing real Clover orders.
  It does not try to become the launcher, and it does not copy Clover's or McDonald's look or branding. Its English
  name should not lean on "Register" (the built-in app's name): "TAKATAK Picture Register" could be read as a version
  of Clover's Register (OWNER_DECISIONS 8, DevRel question 10).

## 6. Item images

- **FACT.** The GET item schema has **no** `image` or `imageUrl` field. The nested MenuItem object has
  `imageFilename`, "File name of the image associated with the menu item": a file name, not a URL. The documented
  `expand` values (tags, categories, taxRates, modifierGroups, itemStock, options) do not include menuItem.
  Source: https://docs.clover.com/dev/reference/inventorygetitem (read 2026-10-23).
- **FACT.** The Inventory FAQ says online-ordering (OLO) fields such as Description are not in the standard response,
  and "Access to OLO-specific data requires specialized permissions."
  Source: https://docs.clover.com/dev/docs/inventory-faqs (read 2026-10-23).
- **FACT.** No 2025–2026 changelog entry adds image upload or image URLs.
  Source: https://docs.clover.com/dev/changelog/clover-api-updates-march-2026 (read 2026-10-23).
- **UNCONFIRMED.** Older community posts (snippets) quote Clover staff saying product images are not exposed to third
  parties by API.
- **UNCONFIRMED (snippet; JS page not opened).** Clover Help "Add individual restaurant items": item pictures are added
  in the Dashboard under customer-facing platforms, JPG/JPEG/PNG, max 10.0 MB, minimum 1024×768 px.
  Source: https://www.clover.com/en-US/help/add-individual-restaurant-items (snippet, 2026-10-23).
- **FACT.** DoorDash's help page says that if a Clover menu includes photos, DoorDash pulls eligible images, and only
  new photo URLs sync. GRUBBRR says its Clover Kiosk app ingests the Clover menu including photos.
  Sources: https://help.doordash.com/en-ca/merchants/article/integrate-doordash-with-your-clover-pos ;
  https://clov.grubbrr.com/how-it-works/ (read 2026-10-23).
- **FACT (repo).** `lib/foodhub/menu/clover-import.ts` (`parseCloverMenuItem`, `CLOVER_STATIC =
  https://cloverstatic.com/menu-assets/items/`) reads photos only from a chosen Clover menu (`/menus/{id}/items`, an
  undocumented endpoint read defensively). `lib/foodhub/media.ts` accepts jpg/png/webp up to 5 MB and warns below
  1200×800.
- **INFERENCE.** Approved partners do read Clover menu photos, so a sanctioned path exists, probably behind OLO
  permission. Our own photo store (Food Hub `/media`) is the source of truth; Clover photos are an optional seed that
  fails soft. Keep 1200×800 or larger (above Clover's 1024×768 minimum). Ask DevRel for OLO menu permission and the
  official image URL pattern.

## 7. Building orders from a custom UI

- **FACT.** The Order Connector tutorial creates an order, then adds line items from InventoryConnector (fixed,
  per-unit and variable price), modifiers and discounts. It needs read/write orders and read inventory.
  Source: https://docs.clover.com/docs/using-order-connector (read 2026-10-23).
- **FACT.** Since March 2026 an order is capped at 2,500 line items and bulk inventory updates at 2,500 items.
  Source: https://docs.clover.com/dev/changelog/clover-api-updates-march-2026 (read 2026-10-23).
- **FACT.** SDK v306 adds `OrderConnector.fireLineItems()` to send line items to the printer.
  Source: https://docs.clover.com/docs/v306-release-notes (read 2026-10-23).
- **INFERENCE.** The register writes ordinary Clover orders with Clover items and modifier groups. Our Duo / Trio /
  Combo upsell groups (Clover modifier groups) map directly onto them; reporting, tax and receipts stay in Clover.

## 8. Taking payment (Canada)

- **FACT.** Payment Connector "provides a complete interface to Clover payment flow functions". It replaces the
  `ACTION_SECURE_PAY` and `STATION_PAY` intents and is available in North America, Europe and Latin America. The
  newer Android Payments API is listed for the **United States only**. The sample uses clover-android-sdk and
  clover-android-connector-sdk 262.2, needs a Remote App ID, and waits for `onDeviceConnected`.
  Sources: https://docs.clover.com/docs/using-payment-connector ;
  https://docs.clover.com/docs/take-a-payment-with-payment-connector (read 2026-10-23).
- **FACT.** Canada: both pages list `auth()`, `preAuth()` and `tipAdjustAuth()` as not supported, under intros that
  tie the Canadian limits to Interac (the Canada-merchants page says the methods differ "in part" because devices
  process Interac). Neither row says whether the limit also covers credit cards. Interac refunds need the card
  inserted; Canadian integrations need SDK 2.0 or higher.
  Sources: https://docs.clover.com/docs/region-specific-features (updated 2026-07-10) ;
  https://docs.clover.com/dev/docs/canadian-merchants (updated 2026-03-24, read 2026-10-23).
- **INFERENCE.** Payment Connector in Canada, not the Android Payments API. Interac: no auth, pre-auth or tip adjust;
  credit: to confirm with DevRel (question 12). Tips at sale time is our design choice either way. Clover's secure
  payment screen takes the money; full payment only.

## 9. PCI scope

- **FACT.** Semi-integration basics: cardholder data encryption and transmission are "handled entirely inside the
  Clover ecosystem". Clover's PCI guidance: the NFC hardware connects only to the secure processor. PCI SSC's FAQ:
  PTS-approved devices do not by themselves guarantee compliance or reduce the merchant's scope.
  Sources: https://docs.clover.com/docs/clover-development-basics-semi ;
  https://docs.clover.com/docs/pci-security-guidance-for-app-developers ;
  https://www.pcisecuritystandards.org/faq/articles/Frequently_Asked_Question/how-should-payment-terminals-be-considered-during-a-pci-dss-assessment
  (read 2026-10-23).
- **INFERENCE.** If our app never reads, logs or stores card data and only calls Clover's payment flow, it adds little
  PCI scope. The merchant's own PCI obligations do not change. This is not a PCI assessment.

## 10. Kiosk rules

- **FACT.** "Clover devices are only certified for use in attended and semi-attended environments, as defined in the"
  PCI PTS POI Evaluation FAQ. Integrations that use a Clover device unattended are neither allowed nor approved.
  Clover does not define "semi-attended" itself; it points to that PCI FAQ.
  Source: https://docs.clover.com/docs/semi-integration-process (read 2026-10-23).
- **CONFLICT.** Clover's Kiosk semi-integration announcement (updated 2026-06-17) lists "unattended kiosks" as an ideal
  use. Source: https://docs.clover.com/dev/docs/announcing-clover-kiosk-for-semi-integration-in-us (read 2026-10-23).
  LoyLap's "Self Checkout" listing also says it turns a Flex, Mini or Station Solo into an "unmanned" self-ordering
  kiosk (https://www.clover.com/appmarket/apps/8M1B7YV28R3BT, read 2026-10-23).
- **FACT.** Clover Kiosk hardware: 23.8" customer display (portrait, 1080×1920) with an 8" Clover Mini that runs
  Android. Kiosk app rules:
  - `CustomerMode`: full screen, nav and status bars hidden, the customer cannot exit, secure exit for staff;
  - launch on `BOOT_COMPLETED` after the daily reboot; auto-unlock with the `Lockscreen` class (needs Employee Read);
  - `keepScreenOn`; pay with `KioskPayRequestIntentBuilder` and `setAllowPartialPayments(false)`;
  - touch targets at least 48 dp; WCAG Level A minimum before App Market release, AA recommended; ADA compliance
    (US law) is the integrator's responsibility;
  - a Station Duo can be used for testing without special setup; real Kiosk hardware needs Developer Relations to
    enable the app.
  Source: https://docs.clover.com/dev/docs/developer-quick-start-clover-kiosk-integration (updated 2026-05-27, read
  2026-10-23).
- **FACT.** The 4.5:1 contrast ratio that Clover's design requirements make mandatory is WCAG Success Criterion 1.4.3,
  Level **AA** (https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html, read 2026-10-23), so the real target
  is AA for contrast, not "A, AA aimed". The Canadian standard for self-service kiosks is CSA/ASC B651.2 (the 2022
  edition is withdrawn and superseded by CSA/ASC B651.2:25; https://scc-ccn.ca/standardsdb/standards/4031775, read in a
  browser 2026-10-23); INFERENCE: it is voluntary unless a law or contract references it.
- **FACT.** The US page lists $2,499 + $34.95/month per device and says the Kiosk pulls menu and prices from the Clover
  POS. Source: https://get.clover.com/kiosk (read 2026-10-23).
- **FACT (stale on this point).** Clover's developer device table (updated 2026-03-24) marks Clover Kiosk as US only.
  Source: https://docs.clover.com/docs/clover-devices (read 2026-10-23).
- **FACT (read in a browser; WebFetch was blocked).** clover.com/ca/kiosk sells Clover Kiosk in Canada ("Contact
  sales"), with this footnote: "*Clover Kiosk is available in English only and not offered in the province of
  Quebec." Source: https://www.clover.com/ca/kiosk (read 2026-10-23). This closes the earlier "unconfirmed" flag and
  shows the device table above is out of date.
- **INFERENCE.** Our kiosk mode meets these exact rules even on a Mini, Flex or Station and stays semi-attended (for us:
  staff in the room). The test bench is a sandbox-registered device (a sandbox Station Duo works with no special setup);
  the owner's production Station Duo only receives approved APKs (§14). Clover Kiosk hardware is not offered in
  Québec, so a Québec kiosk runs on Mini 3, Flex or Station hardware, or on a big non-Clover screen (§11). Outside
  Québec, Clover Kiosk competes directly; French is our edge there.

## 11. Big screen kiosk: semi-integration

- **FACT.** REST Pay Display lets a POS take payments on a Clover device "through the cloud or a local network
  connection" without an embedded SDK. It supports Flex, Mini and Compact; the page header lists US, Canada and
  Europe. Cloud Pay Display needs steady fast internet and OAuth; remote-pay-cloud needs the device present.
  Semi-integrated apps get a Remote App ID (RAID) and go through Application, Education, Development, Approval and
  Maintenance phases.
  Sources: https://docs.clover.com/docs/rest-pay-intro ; https://docs.clover.com/docs/pay-display-apps ;
  https://docs.clover.com/dev/docs/payments-semi-integration-faqs ;
  https://docs.clover.com/docs/semi-integration-process (read 2026-10-23).
- **INFERENCE.** A big French screen (tablet or 24" Android/web screen) paired with a Clover Mini or Flex for payment
  works as a semi-integration. This is how GRUBBRR's Samsung kiosk works. It is a separate approval track (RAID) from
  the on-device APK.

## 12. Offline

- **FACT.** "Canadian merchants cannot use their Clover devices to process any payments in offline mode." Pay Display
  offline is US-only over a local connection.
  Sources: https://docs.clover.com/docs/region-specific-features (updated 2026-07-10) ;
  https://docs.clover.com/docs/handling-offline-payments ; https://docs.clover.com/docs/pay-display-apps
  (read 2026-10-23).
- **UNCONFIRMED.** Community answers (snippets): data already synced to the device can be read through the Android SDK
  while offline.
- **INFERENCE.** Offline in Canada: tiles and order building from local data, with an honest "card payment unavailable"
  state. Photos cached on the device.

## 13. Kitchen printing

- **FACT.** REST `POST /v3/merchants/{mId}/print_event` prints to the firing device's order printer and falls back to
  the onboard printer; needs write orders. Line items get `printed=true`, which webhooks can confirm. "Once a job is
  printed, the job is discarded and cannot be replayed."
  Source: https://docs.clover.com/docs/printing-orders-rest-api (read 2026-10-23).
- **UNCONFIRMED.** On device, community answers (snippets) use `PrinterConnector.getPrinters(Category.ORDER)` and
  `PrintJobsConnector.print()`, plus `OrderConnector.fire()` / `fireLineItems()`. Community reports describe
  print_event jobs that never print and KDS orders that only show after a re-fire.
- **FACT (repo).** `lib/foodhub/pos/clover-order.ts` already prints with print_event (`printKitchenTicket`,
  `printCloverOrderOn`, `CLOVER_PRINT_DEVICES` per kitchen).
- **INFERENCE.** The on-device app fires through the SDK so Clover's own printer and label routing applies. Test Clover
  KDS and the kitchen printer early on the owner's hardware.

## 14. APK release and approval

- **FACT.** "every APK must undergo a review and be triple-signed". All versions use the same key. Clover recommends a
  rollback copy with a higher versionCode. The app is approved first, then the APK. Sandbox APKs are auto-approved.
  Unpublished apps appear only to merchant accounts linked to the developer account. Review covers a functional video,
  the reason for each permission, REST config, webhooks and legal documents. Denial reasons include frequent crashes,
  integrating another payment processor, and impersonating a Clover app.
  Sources: https://docs.clover.com/docs/submitting-an-apk-for-approval ;
  https://docs.clover.com/docs/developer-app-approval ; https://docs.clover.com/docs/managing-app-releases
  (read 2026-10-23).
- **INFERENCE.** The owner's restaurants can run an approved but unpublished picture register before any public
  listing. Back up the signing keystore off the VPS. Expect a longer first review (Food Hub PENDING since 2026-10-17).
  Testing before approval needs a sandbox-registered Clover device (developer kit): to confirm with DevRel, because
  the owner's production Station Duo should only receive approved APKs.

## 15. Device WebView (hybrid option)

- **FACT.** Clover's Q4 2025 ROM update moved Android WebView to 140.0.7339.52. ROMs roll out to sandbox first, then to
  production over several weeks. Source: https://docs.clover.com/docs/clover-android-rom-updates-2025 (read 2026-10-23).
- **INFERENCE.** A Kotlin shell plus web tile UI is workable **only** with web assets bundled inside the APK, no remote
  JavaScript, and no JS bridge to OrderConnector, PaymentConnector or printer connectors from content loaded over the
  network: Clover's Functionality Policies (§5) forbid launching other executable code and unlocking features outside
  the App Market, and a remote page that can call payment is a security risk. Test on each Canadian device ROM in
  sandbox.

## 16. Canadian App Market

- **FACT.** For Québec merchants, "every merchant and customer-facing screen and prompt must be available in French and
  English". Each Canadian hospitality, full-service or quick-service restaurant app must be certified under Revenu
  Québec's SRM mandate. Apps must allow tax-exempt transactions; receipts need the GST number; cash rounds to the
  nearest 5¢ (cards are not rounded); the EULA and privacy policy must follow PIPEDA.
  Source: https://docs.clover.com/dev/docs/international-app-market-readiness (updated 2026-03-24, read 2026-10-23).
- **CONFLICT.** That page says Canadian merchants have only Payments Plus and Register Lite plans; the Canada-merchants
  page lists Payments Plus, Register Lite, Register, Counter Service and Table Service Restaurant (both updated
  2026-03-24). Source: https://docs.clover.com/dev/docs/canadian-merchants (read 2026-10-23).
- **FACT.** Clover's October 2024 entry, tagged Canada, is titled "Added capabilities to meet fiscalization
  requirements from Revenu Québec": custom payment receipts, hiding text / email receipts in Orders, Fiscalization app
  support, and payment flows without text / email receipts. Source: https://docs.clover.com/dev/docs/whats-new-2024
  (read 2026-10-23).
- **FACT.** The standard Payment Connector receipt screen offers "No receipt", Print, Email and Text message
  (screenshot on https://docs.clover.com/docs/take-a-payment-with-payment-connector, read 2026-10-23).
- **INFERENCE.** Both the register and the kiosk are fully bilingual (French default for customers). SRM matters far
  more here than for Food Hub, because a register is where the order enters the SRS and the customer's bill is made
  (see LEGAL_AND_MARKET.md §1). For Québec merchants the design must use those fiscalization features so that no sale
  ends with "No receipt" (ROADMAP A15, DevRel question 2). The register also needs a tax-exempt order path and 5¢ cash
  rounding (ROADMAP A16, A17).

## 17. Existing picture-tile ordering on Clover

| Product | What (FACT / vendor claim) | Source (read 2026-10-23) |
|---|---|---|
| Clover Kiosk (first-party) | 23.8" + Mini; photo menu from the Clover POS; US, and Canada except Québec (English only) | https://get.clover.com/kiosk ; https://www.clover.com/ca/kiosk |
| GRUBBRR "Clover Kiosk App" / "Samsung Kiosk App by Grubbrr" | Samsung kiosk + Clover payment device; ingests Clover menu photos and prices; high-res images and upsell; $99/month per kiosk (introductory) | https://clov.grubbrr.com/how-it-works/ ; https://www.clover.com/appmarket/apps/6EV0BD632JZC0 |
| LoyLap "Self Checkout" (Facilipay) | Turns a Flex, Mini or Station Solo into a self-order kiosk ("Product Selector: browse and tap to order on screen"); $95/month per location after a 30-day trial | https://www.clover.com/appmarket/apps/8M1B7YV28R3BT |
| Samsung Ordering Kiosk | In Clover's April 2023 App Market roundup; orders go to Clover "like any other terminal"; images managed in Nanonation Commandpoint | https://blog.clover.com/new-and-notable-in-the-clover-app-market-april-2023 ; https://content.nanonation.net/Support/Clover/Guides/Clover_Software_Setup_Guide_Current.pdf |
| Applova | Kiosk app; US/Canada; English only per TrustRadius | https://www.trustradius.com/products/applova/details |
| Apptizer | Mobile and kiosk order-ahead (2018) | No URL kept in the research handoff: re-find before quoting |
| Clover Sport (formerly Bypass) | Venues; "switch your Clover register to kiosk mode" | https://sport.clover.com/ |
| Clover Dining | Free table-management app (floor maps, orders, send-to-kitchen); photos not confirmed | https://uk.clover.com/apps/clover-dining/ (snippet) |

App Market prices were read inside a signed-in Clover dashboard session ("Test Merchant"); whether they reflect the US
or the Canadian market, and the currency, is UNCONFIRMED.

- **FACT.** Clover's own merchant-needs page lists "Menu with photos" (visual identification of items) as an app type
  for quick-service restaurants. Source: https://docs.clover.com/docs/merchant-needs (updated 2026-03-24, read
  2026-10-23).
- **INFERENCE.** What the owner saw was most likely Clover Kiosk, GRUBBRR / Samsung kiosks, LoyLap Self Checkout or
  Clover Sport kiosk mode. Kiosks are crowded and English-first. We found no bilingual **staff** picture register in our
  search on 2026-10-23, but the merchant-needs page shows the category is known, so others may exist. A French-first
  kiosk is open in Québec (Clover Kiosk is not offered there); outside Québec it competes with Clover Kiosk.
- **OPEN.** Does Clover's own Register show item photos on current ROMs? No official evidence either way.

## 18. Evidence limits

- community.clover.com: NXDOMAIN on 2026-10-23 (forum points = snippets only).
- Revenu Québec pages (certified-SRS list and detail pages, restaurant-sector pages, developer certification page):
  403 to fetch tools, read in a browser (see LEGAL_AND_MARKET.md §1).
- LégisQuébec: 403 to fetch tools, read in a browser on 2026-10-23 (C-11, P-40.1, I-8.1, P-39.1).
- www.clover.com/app-market-policies and www.clover.com/ca/kiosk render with JavaScript: read in a browser. Several
  clover.com help pages were seen only as snippets.
