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
  Clover device." One app record can have several types.
  Source: https://docs.clover.com/dev/docs/app-settings (read 2026-10-23).
- **UNCONFIRMED.** A Clover community answer (snippet only) said an Android app that wraps a WebView is still an
  Android app.
- **FACT (repo).** TAKATAK Food Hub (629HFYHNVMZYR) and TAKATAK Phone AI (20FK28P20HJC6) are web apps, both
  PENDING review since 2026-10-17. The empty draft "on2go" (N4NYCJCZ17FF4) is type "Android & Web", site
  https://on2go.ca/. `docs/CLOVER_MULTI_APP.md` (owner step 2) says to keep that draft "for a future ON2GO device
  app", and an app's type and billing country are set at creation.
- **INFERENCE.** The picture register must be an Android APK on the device. Food Hub and Phone AI cannot be this
  screen. An Android shell around a WebView could reuse web tile code, but payment, printer and inventory calls
  still go through native Clover SDK connectors.

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

- **FACT.** Clover recommends "a targetSdkVersion of 25 or lower". minSdkVersion by device: 17 runs on any Clover
  device; 29 for Flex 3, Mini 3, Station Duo 2 and Station Solo; 33 for Flex 4, Flex Pocket and Compact (page
  updated 2026-05-08). Source: https://docs.clover.com/docs/setting-android-sdk-versions (read 2026-10-23).
- **FACT.** Gen-1 devices reached End-of-App-Update on 2026-05-15: no new apps, no APK updates.
  Source: https://docs.clover.com/docs/announcement-end-of-app-update-gen-1-devices (read 2026-10-23).
  **CONFLICT:** another Clover page gives 2026-03-30 for US Gen-1 dates
  (https://docs.clover.com/dev/docs/clover-devices). Either way, Gen-1 is out.
- **FACT.** Device list: Station Duo 2, Station Solo, Mini 3 and Flex 3 run AOSP 10 (API 29); the original Station
  Duo runs 8.1, upgradable to 10; Flex 4, Flex Pocket and Compact run Android 13. Design requirements: Station Duo
  landscape and must fill both merchant and customer screens; Mini landscape; Flex portrait. WCAG, 4.5:1 contrast,
  alt text and TalkBack on merchant- and customer-facing screens.
  Sources: https://docs.clover.com/dev/docs/clover-devices ; https://docs.clover.com/dev/docs/app-design-requirements
  (read 2026-10-23).
- **CONFLICT (to ask DevRel).** The general SDK page says targetSdk 25 or lower, but the Clover Kiosk quick start says
  kiosk apps must target Android 10 (API 29) with clover-android-sdk
  (https://docs.clover.com/dev/docs/developer-quick-start-clover-kiosk-integration).
- **INFERENCE.** minSdk 29. targetSdk: follow the page that matches the mode (25 for the staff register per the SDK
  page, 29 for kiosk per the quick start) until DevRel answers; compile against a current SDK. Before coding,
  confirm whether the owner's Station Duo is a Duo 1 or a Duo 2.

## 4. Station Duo: merchant screen vs customer screen

- **FACT.** On Station Duo 2, "Apps launch on the merchant-facing display" (14" FHD). The 8" customer screen can only
  be reached through custom tenders or the customer-facing platform (Pay Display). Activities on the customer
  screen cannot take focus, so the Android keyboard does not work and toasts do not show. Payment starts through
  the Clover API and shows on the customer screen. Station Duo 1 is API 27 with a 14" and a 7" display.
  Sources: https://docs.clover.com/docs/build-apps-for-station-duo-2 ;
  https://docs.clover.com/docs/building-apps-for-station-pro (read 2026-10-23).
- **INFERENCE.** The staff picture register fits the Duo's merchant screen with no special permission. A customer
  self-order screen on the Duo's small customer display is constrained and not its intended use: it is **not** the
  kiosk plan.

## 5. Replacing or reskinning Clover's Register

- **FACT.** No official Clover document says a third-party app may replace or reskin Register. App approval forbids
  apps that "impersonate a Clover or another developer's app".
  Source: https://docs.clover.com/docs/developer-app-approval (read 2026-10-23).
- **UNCONFIRMED.** A community answer (snippet) said a custom Android home app needs the user to set it as default
  home, and doubted Clover would allow it without a special merchant relationship.
- **FACT.** Clover's own Kiosk guide launches the app on `BOOT_COMPLETED`.
  Source: https://docs.clover.com/dev/docs/developer-quick-start-clover-kiosk-integration (read 2026-10-23).
- **INFERENCE.** The picture register is a normal app the staff opens, next to Register, writing real Clover orders.
  It does not try to become the launcher, and it does not copy Clover's or McDonald's look or branding.

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
- **FACT.** Canada: `auth`, `preAuth` and `tipAdjustAuth` are not supported; Interac refunds need the card inserted;
  Canadian integrations need SDK 2.0 or higher.
  Sources: https://docs.clover.com/docs/region-specific-features (updated 2026-07-10) ;
  https://docs.clover.com/dev/docs/canadian-merchants (read 2026-10-23).
- **INFERENCE.** Payment Connector in Canada, not the Android Payments API. Tips at sale time (no tip adjust). Clover's
  secure payment screen takes the money; full payment only.

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
  - touch targets at least 48 dp; WCAG Level A minimum before App Market release, AA recommended;
  - a Station Duo can be used for testing without special setup; real Kiosk hardware needs Developer Relations to
    enable the app.
  Source: https://docs.clover.com/dev/docs/developer-quick-start-clover-kiosk-integration (read 2026-10-23).
- **FACT.** The US page lists $2,499 + $34.95/month per device and says the Kiosk pulls menu and prices from the Clover
  POS. Source: https://get.clover.com/kiosk (read 2026-10-23).
- **FACT.** Clover's device table (updated 2026-03-24) marks Clover Kiosk as US only.
  Source: https://docs.clover.com/docs/clover-devices (read 2026-10-23).
- **FACT (read in a browser; WebFetch was blocked).** clover.com/ca/kiosk footnote: "*Clover Kiosk is available in
  English only and not offered in the province of Quebec." Source: https://www.clover.com/ca/kiosk (read 2026-10-23).
  This closes the earlier "unconfirmed" flag.
- **INFERENCE.** Our kiosk mode meets these exact rules even on a Mini, Flex or Station, stays semi-attended (staff in
  the room), and treats the owner's Station Duo as the official test bench. Clover Kiosk hardware itself cannot be
  sold in Québec, so a Québec kiosk runs on Mini 3, Flex or Station hardware, or on a big non-Clover screen (§11).

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
- **INFERENCE.** A Kotlin shell plus web tile UI is workable; test on each Canadian device ROM in sandbox.

## 16. Canadian App Market

- **FACT.** For Québec merchants, "every merchant and customer-facing screen and prompt must be available in French and
  English". Each Canadian hospitality, full-service or quick-service restaurant app must be certified under Revenu
  Québec's SRM mandate. Receipts need the GST number, cash rounds to 5¢, and the EULA and privacy policy must follow
  PIPEDA. Source: https://docs.clover.com/dev/docs/international-app-market-readiness (read 2026-10-23).
- **CONFLICT.** That page says Canadian merchants have only Payments Plus and Register Lite plans; the Canada-merchants
  page lists Payments Plus, Register Lite, Register, Counter Service and Table Service Restaurant (both updated
  2026-03-24). Source: https://docs.clover.com/dev/docs/canadian-merchants (read 2026-10-23).
- **FACT.** Clover added fiscalization support (custom payment receipts, Fiscalization app support) to its payment SDK
  in October 2024. Source: https://docs.clover.com/dev/docs/whats-new-2024 (read 2026-10-23).
- **INFERENCE.** Both the register and the kiosk are fully bilingual (French default for customers). SRM matters far
  more here than for Food Hub, because a register is where the customer's bill is made (see LEGAL_AND_MARKET.md §1).

## 17. Existing picture-tile ordering on Clover

| Product | What (FACT / vendor claim) | Source (read 2026-10-23) |
|---|---|---|
| Clover Kiosk (first-party) | 23.8" + Mini; photo menu from the Clover POS; US; Canada page says English only, not in Québec | https://get.clover.com/kiosk ; https://www.clover.com/ca/kiosk |
| GRUBBRR "Clover Kiosk App" / "Samsung Kiosk App by Grubbrr" | Samsung kiosk + Clover payment device; ingests Clover menu photos and prices; high-res images and upsell; $99/month per kiosk (introductory) | https://clov.grubbrr.com/how-it-works/ ; https://www.clover.com/appmarket/apps/6EV0BD632JZC0 |
| LoyLap "Self Checkout" (Facilipay) | Turns a Flex, Mini or Station Solo into a self-order kiosk ("Product Selector: browse and tap to order on screen"); $95/month per location after a 30-day trial | https://www.clover.com/appmarket/apps/8M1B7YV28R3BT |
| Samsung Ordering Kiosk | In Clover's April 2023 App Market roundup; orders go to Clover "like any other terminal"; images managed in Nanonation Commandpoint | https://blog.clover.com/new-and-notable-in-the-clover-app-market-april-2023 ; https://content.nanonation.net/Support/Clover/Guides/Clover_Software_Setup_Guide_Current.pdf |
| Applova | Kiosk app; US/Canada; English only per TrustRadius | https://www.trustradius.com/products/applova/details |
| Apptizer | Mobile and kiosk order-ahead (2018) | No URL kept in the research handoff: re-find before quoting |
| Clover Sport (formerly Bypass) | Venues; "switch your Clover register to kiosk mode" | https://sport.clover.com/ |
| Clover Dining | Free table-management app (floor maps, orders, send-to-kitchen); photos not confirmed | https://uk.clover.com/apps/clover-dining/ (snippet) |

App Market prices were read inside a signed-in Clover dashboard session ("Test Merchant"); whether they reflect the US
or the Canadian market, and the currency, is UNCONFIRMED.

- **INFERENCE.** What the owner saw was most likely Clover Kiosk, GRUBBRR / Samsung kiosks, LoyLap Self Checkout or
  Clover Sport kiosk mode. Kiosks are crowded and English-first. A bilingual **staff** picture register is an empty
  niche, and a French-first kiosk for Québec is open.
- **OPEN.** Does Clover's own Register show item photos on current ROMs? No official evidence either way.

## 18. Evidence limits

- community.clover.com: NXDOMAIN on 2026-10-23 (forum points = snippets only).
- Revenu Québec certified-SRS list: returned 403 to fetch tools, but was read in a browser (see LEGAL_AND_MARKET.md §1).
- LégisQuébec returned 403; several clover.com help pages are JavaScript-rendered and were seen only as snippets.
