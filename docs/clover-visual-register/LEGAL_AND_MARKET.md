# Legal and market: picture register and kiosk (Québec / Canada)

> [!WARNING]
> **Ceci n'est pas un avis juridique — à valider avec un avocat du Québec.**
> **This is not legal advice — validate it with a Québec lawyer.**
> It is research notes from public pages read on 2026-10-23. LégisQuébec and Revenu Québec refuse fetch tools (403)
> but were read in a browser on 2026-10-23; the RACJ site was in maintenance. The questions for the lawyer are in §10.
> Fact-check pass (PR #98 review) applied on 2026-10-23.

> **FR — En bref.** Le gros risque est la **facturation obligatoire (MEV / SRM) de Revenu Québec** : un
> restaurant doit remettre une facture produite par un SEV certifié. Deux applis MEV **de tiers** pour Clover sont
> certifiées (« Clover MEV Connect », Pulsar informatique Inc ; « Clover MEV Web », 15535743 Canada inc.). Dans le
> scénario de Revenu Québec, l'employé **saisit la commande dans le SEV** : on suppose donc que notre caisse fait
> partie du SEV tant que Revenu Québec n'a pas dit le contraire par écrit. Aucun restaurant québécois dans une fiche
> ou une vente avant les réponses de Revenu Québec, du concepteur MEV et de Clover ; on prévoit le budget d'une
> certification. Ensuite : tout en français d'abord, avec les mêmes fonctions qu'en anglais (Charte), prix affiché =
> prix payé (et aucune taxe Clover parasite), photos fidèles au plat, pourboire calculé avant taxes, pas d'alcool sans
> vérification d'âge à la borne, évaluation des facteurs relatifs à la vie privée (Loi 25). Côté marché : les bornes
> sur Clover coûtent environ 95–99 $/mois (devise non confirmée), Square Kiosk 70 $ CA/mois par appareil ; aucune
> n'annonce le français ni la certification MEV. Notre 50 $ CA/mois est **par marchand** : la comparaison n'est pas à
> l'identique.
>
> **EN — In short.** The big risk is **Revenu Québec mandatory billing (SRM / WEB-SRM)**: a restaurant must hand the
> customer a bill produced by a certified SRS. Two **third-party** MEV apps for Clover are certified ("Clover MEV
> Connect", Pulsar informatique Inc; "Clover MEV Web", 15535743 Canada inc.). In Revenu Québec's scenario the user
> **enters the order in the SRS**, so we assume our register is part of the SRS until Revenu Québec says in writing that
> it is not. No Québec restaurant in any listing or sale before Revenu Québec, the MEV vendor and Clover have answered;
> budget for certification. Then: French first everywhere with the same features as English (Charter), displayed price
> = charged price (and no stray Clover tax), photos true to the dish, tips computed before tax, no alcohol at the kiosk
> without an age check, a privacy impact assessment (Law 25). Market: kiosks on Clover cost about $95–99/month
> (currency unconfirmed), Square Kiosk CAD $70/month per device; none advertises French or SRM certification. Our CAD
> $50/month is **per merchant**: not a like-for-like comparison.

Labels: **FACT**, **INFERENCE**, **UNCONFIRMED** (same meaning as in README.md).

---

## 1. Revenu Québec mandatory billing (SRM / WEB-SRM): the biggest risk

- **FACT (archived).** Revenu Québec press release (2024-11-15): restaurants still on SRMs had until 2025-06-01 to
  obtain at least one SRS certified by Revenu Québec and compatible with WEB-SRM, with a possible 3-month extension.
  The deadline has passed. The URL now redirects to the RQ news index (checked in a browser 2026-10-23), so this point
  comes from the earlier research pass. Archived source:
  https://www.revenuquebec.ca/en/press-room/news/details/2024-11-15/shift-to-web-srm-in-the-restaurant-sector
- **FACT (live source).** Restaurant operators subject to the measures must send their transaction data with a
  certified SRS designed to communicate with WEB-SRM and give every customer a bill produced with that SRS.
  Source: https://www.revenuquebec.ca/en/businesses/sector-specific-measures/mandatory-billing/mandatory-billing-restaurant-sector/
  (read in a browser 2026-10-23).
- **FACT.** Revenu Québec's counter-service scenario: the user enters the order in the SRS and gives the price, then
  enters the payment method in the SRS to finalize; RQ replies with the transaction number and the user gives the
  closing receipt. Merely asking customers whether they want a bill does not meet the rule: the operator must make sure
  the customer receives it. Source: https://www.revenuquebec.ca/en/businesses/sector-specific-measures/mandatory-billing/mandatory-billing-restaurant-sector/mandatory-billing-information-specific-to-the-restaurant-sector/restaurant-sector-giving-customers-bills/
  (read in a browser 2026-10-23).
- **FACT.** Every transaction must carry a type of service (counter, table, delivery by the operator, order using a
  digital platform) and an activity subsector for each item (for example Bar when the establishment serves alcohol
  under a bar permit), plus a detailed description of each item.
  Source: https://www.revenuquebec.ca/en/businesses/sector-specific-measures/mandatory-billing/mandatory-billing-restaurant-sector/mandatory-billing-information-specific-to-the-restaurant-sector/
  (read in a browser 2026-10-23).
- **FACT.** An SRS built to talk to WEB-SRM must be certified, and its developer must be a registered Revenu Québec
  partner. A new certification number is needed for each later version that introduces uncertified changes; the only
  exception is adding or removing a payment method.
  Source: https://www.revenuquebec.ca/en/partners/product-developers/fields-of-activity/developers-mandatory-billing-cloud-solution/certified-srss-designed-to-communicate-with-the-web-srm/
  (read in a browser 2026-10-23, section "Certification of a new version of a certified SRS").
- **FACT (read in a browser).** Revenu Québec's list of SEVs certified for MEV-WEB, restaurant sector, has 84 products,
  including:

  | Product | Holder (third party, not Clover) | Certified | Platform | Scope (FACT, RQ detail page) |
  |---|---|---|---|---|
  | Clover MEV Connect v1.2.1 | Pulsar informatique Inc | 2025-12-05 | Android | Counter service only (no table service, no operator delivery, no digital-platform orders). Not available: cancel a transaction, mixed payment, coupon, transfer / split / group items. Available: tip entry, item notes, Bar / Restaurant / food-truck subsectors. Paper receipts only |
  | Clover MEV Web v1.0.33 | 15535743 Canada inc. | 2025-09-05 | Android | Counter, table, operator delivery and digital-platform orders; cancel and transfer / split available. Not available: mixed payment, coupon. Paper receipts only |
  | BIBORNE | (kiosk vendor) | — | — | Kiosk certified as an SEV in its own right |
  | Kiosk 360 | (kiosk vendor) | 2025-04-09 | Windows | Counter service |
  | WinVision PosKiosk | (kiosk vendor) | — | — | Kiosk certified as an SEV |

  Sources: https://www.revenuquebec.ca/fr/partenaires/produits-autorises/systemes-denregistrement-des-ventes-certifies/sev-compatibles-avec-le-mev-web-restauration/ ;
  https://www.revenuquebec.ca/fr/partenaires/produits-autorises/systemes-denregistrement-des-ventes-certifies/sev-compatibles-avec-le-mev-web-restauration/details/clover-mev-connect/121/ ;
  https://www.revenuquebec.ca/fr/partenaires/produits-autorises/systemes-denregistrement-des-ventes-certifies/sev-compatibles-avec-le-mev-web-restauration/details/clover-mev-web-/1033/
  (all read in a browser 2026-10-23; the detail paths need `/details/`, without it RQ shows "Page introuvable").
- **FACT.** Clover's Canadian readiness page requires each app in the hospitality, full-service or quick-service
  restaurant sectors to be certified under Revenu Québec's SRM mandate (updated 2026-03-24).
  Source: https://docs.clover.com/dev/docs/international-app-market-readiness (read 2026-10-23).
- **FACT.** Clover's October 2024 entry "Added capabilities to meet fiscalization requirements from Revenu Québec"
  (Canada tag) added custom payment receipts, hiding text / email receipts in Orders, Fiscalization app support and
  payment flows without text / email receipts. Source: https://docs.clover.com/dev/docs/whats-new-2024 (read
  2026-10-23).
- **FACT.** Clover's standard Payment Connector receipt screen offers "No receipt", Print, Email and Text message
  (screenshot on https://docs.clover.com/docs/take-a-payment-with-payment-connector, read 2026-10-23).
- **FACT.** Clover may deny an app that offers services not compliant with regional laws.
  Source: https://docs.clover.com/docs/developer-app-approval (updated 2026-07-15, read 2026-10-23).
- **INFERENCE.**
  - A Québec Clover restaurant already needs a certified SRS; on Clover, the two listed are third-party MEV apps.
  - RQ puts order entry inside the certified SRS. An outside app that takes the order is probably part of the SRS, or
    changes it, and RQ asks for a new certification number for uncertified changes. **Working assumption: for Québec
    restaurants, the register is part of the SRS until Revenu Québec says in writing that it is not.** "The app only
    builds the order" is the weaker legal reading, not a safe default.
  - P0 question to both certified vendors (Pulsar informatique Inc for Clover MEV Connect; 15535743 Canada inc. for
    Clover MEV Web): does your certified version record orders created by another app through OrderConnector, with no
    recertification? Which fields must such an order carry?
  - The register must never let a Québec sale end with "No receipt": the MEV app must print the closing receipt with
    its QR code automatically (ROADMAP A15), using Clover's RQ fiscalization features.
  - The register may only use features the merchant's certified MEV product can record (ARCHITECTURE §2b). With MEV
    Connect: counter service only, no cancel after "Send", no split tender, no coupon tender.
  - A kiosk or register that **prints its own bill** is itself an SEV needing certification, as BIBORNE and Kiosk 360
    did. Our own certification (OWNER_DECISIONS 6B) is the likely path for Québec: budget for it now.
  - Keep Québec restaurant merchants out of any listing or sale until Revenu Québec, the MEV vendor and Clover have
    answered.
  - The repo's SRM notes (`docs/CLOVER_MARKETPLACE_LAUNCH.md` §5, `docs/CLOVER_MULTI_APP.md`) were written for Food
    Hub and do not yet mention these two Clover MEV products; they should be updated when the owner acts on this.

## 2. French language (Charter of the French language / Bill 96)

- **FACT** (LégisQuébec, C-11, read in a browser 2026-10-23):
  - Art. 50.2: a business must respect the consumer's right to be informed and served in French; a business that
    offers goods or services to a public other than consumers (our merchants) must inform and serve it in French.
  - Art. 51: inscriptions on a product and accompanying documents must be in French: "Cette règle s'applique également
    aux menus et aux cartes des vins". Another language may not prevail over French or be more easily accessible.
  - Art. 52.1: all software must be available in French unless no French version exists. Other languages are allowed
    only if the French version is offered on terms at least as favourable (price aside) and has **at least equivalent
    technical features**: the French and English builds need full feature parity.
  - Art. 57: invoices and receipts are written in French.
  - Art. 58: public signs and commercial advertising are in French; they may be bilingual if French is **markedly
    predominant**.
  - Art. 41, para. 1 (4°)(c): an employer's training documents for its staff are in French.
  - Art. 177: the OQLF can order anyone offering non-compliant software (art. 52.1) to comply, and the same applies to
    any establishment operator presenting non-compliant menus.
  - Art. 205: breaching an OQLF order under art. 177 is an offence: $700–$7,000 for a natural person, $3,000–$30,000
    otherwise. Art. 207: doubled for a first repeat, tripled after. Art. 208.0.1: each day counts as a separate offence.
  Source: https://www.legisquebec.gouv.qc.ca/fr/document/lc/C-11 (read in a browser 2026-10-23). The OQLF overview
  remains useful background: https://www.oqlf.gouv.qc.ca/francisation/droits_linguistiques/droits/langue-du-commerce-et-des-affaires.html
- **FACT.** Clover, for Québec merchants: "every merchant and customer-facing screen and prompt must be available in
  French and English". Source: https://docs.clover.com/dev/docs/international-app-market-readiness (read 2026-10-23).
- **INFERENCE.**
  - Every tile, category, modifier, upsell, error and receipt line exists in French, and the French build has the same
    features as the English one (art. 52.1). French is the default on customer screens; English is no easier to reach.
  - The merchant's French item names (`nameFr`) are **required** data for this app, not optional.
  - Our quick reference guide and staff training material are in French first, so the merchant can meet art. 41.
  - The kiosk attract screen is a public sign: French markedly predominant (art. 58).
  - Listing, onboarding and support for merchants in French (art. 50.2, second paragraph).
  - French-first is both the legal floor and our edge where Clover Kiosk is not offered (Québec).

## 3. Displayed price = charged price

- **FACT.** CPA art. 224 c): no merchant may charge more than the advertised price; the advertised price must include
  every amount the consumer pays, except Québec sales tax (QST) and the federal GST.
  Source: https://www.legisquebec.gouv.qc.ca/fr/document/lc/P-40.1 (read in a browser 2026-10-23). The OPC explains
  the same all-inclusive rule: https://www.opc.gouv.qc.ca/commercant/pratique-commerce/prix-rabais/tout-inclus ;
  https://www.opc.gouv.qc.ca/en/consumer/topic/illegal-practice/prohibited/all-inclusive-price (read 2026-10-23).
- **FACT.** Competition Act s. 52(1.3) and s. 74.01(1.1) (drip pricing): a price that cannot be paid because of fixed
  mandatory fees is false or misleading, except charges imposed by federal or provincial law such as sales tax.
  Penalties for the criminal offence are in s. 52(5): on summary conviction a fine up to $200,000 and / or up to one
  year in prison; on indictment a fine at the court's discretion and / or up to 14 years. The civil track (s. 74.01) can
  lead to administrative monetary penalties under s. 74.1 (for a corporation, up to the greater of $10,000,000 or three
  times the benefit, on a first order).
  Sources: https://laws-lois.justice.gc.ca/eng/acts/C-34/section-52.html ;
  https://laws-lois.justice.gc.ca/eng/acts/C-34/section-74.01.html ;
  https://laws-lois.justice.gc.ca/eng/acts/C-34/section-74.1.html ;
  https://competition-bureau.canada.ca/en/deceptive-marketing-practices/drip-pricing (read 2026-10-23).
- **FACT.** The Price Accuracy Policy ($15 threshold) applies to merchants exempt from item-by-item price tagging and
  covers self-checkouts; restaurants are not mentioned.
  Source: https://www.opc.gouv.qc.ca/commercant/pratique-commerce/prix-rabais/politique (read 2026-10-23).
- **FACT (repo).** The owner's Clover merchant has a stray default tax "Sales Tax" of 0.14975 % on 214 of 216 items, on
  top of GST 5 % and QST 9.975 % (`lib/foodhub/finance/defaults.ts`, id `clover_stray_rate`, VERIFIED 2026-10-07);
  `docs/CLOVER_BACKEND_FINAL.md` (§1, Taxes row) says to remove it in Clover → Setup → Taxes & Fees.
- **INFERENCE.**
  - The price on each tile is exactly the Clover item price charged, and modifier prices are shown before selection.
  - No hidden kiosk, service or packaging fee: build it into the item price. Taxes may be added on the review screen.
  - A register that trusts Clover's tax rates as they are would add the stray "Sales Tax" to every staff order: more
    than the advertised price plus GST / QST (art. 224 c), labelled as a tax no law requires. So: the owner removes it
    in each merchant (ROADMAP P0.11), and the app warns and blocks "Send" when an item carries any tax rate other than
    GST or QST (tax-exempt orders excepted).
  - The storefront page hard-codes a 14.975 % display tax in `app/commander/[slug]/order-client.tsx`; the register uses
    Clover's own tax rates instead, once they are clean.

## 4. Food photo accuracy

- **FACT.** CPA art. 231.1 (added in 2017): in an ad for a specific good or service that discloses its price, a
  merchant may not show an illustration that is not faithful to it. Art. 219 is the general ban on false or misleading
  representations. Source: https://www.legisquebec.gouv.qc.ca/fr/document/lc/P-40.1 (read in a browser 2026-10-23).
  The OPC lists the same prohibited practice:
  https://www.opc.gouv.qc.ca/commercant/pratique-commerce/publicite-loi/pratiques-interdites/ (read 2026-10-23).
- **FACT.** The Competition Bureau says ss. 52 / 74.01 cover in-store ads and illustrations, judged by the "general
  impression". Source: https://competition-bureau.canada.ca/en/deceptive-marketing-practices/types-deceptive-marketing-practices/misleading-representations-and-deceptive-marketing-practices
  (read 2026-10-23).
- **INFERENCE.** Each tile shows the actual dish and portion sold, not a stock or upgraded version. A photo with fries or
  a drink must match what the price includes, which matters for Duo / Trio / Combo tiles. Prefer the restaurant's own
  photos (Food Hub `/media`).

## 5. Tips at the payment screen (Québec Bill 72)

- **FACT.** Since 2025-05-07, tip suggestions must be calculated on the bill **before taxes**, presented neutrally and
  uniformly, with a visible custom-amount option; an OPC file flags a pre-selected $2 tip as non-compliant.
  Sources: https://www.quebec.ca/nouvelles/actualites/details/des-pourboires-calcules-avant-les-taxes-et-des-prix-plus-clairs-a-lepicerie-62679 ;
  https://cdn.opc.gouv.qc.ca/media/documents/a-propos/AccesInformation/2025/344002602_Document2.pdf (read 2026-10-23).
- **FACT.** CPA art. 225.1: a merchant may not propose a tip of a predetermined amount unless the proposal meets the
  regulation's requirements (confirmed on https://www.legisquebec.gouv.qc.ca/fr/document/lc/P-40.1, read in a browser
  2026-10-23). The regulation's section number (91.8.1 in OPC documents) was not checked on LégisQuébec.
- **INFERENCE.** Simplest path: our app shows **no** tip prompt of its own and leaves tipping to Clover's payment flow.
  We then verify that Clover's tip screen, as the merchant configures it, computes on the pre-tax subtotal with no
  default choice (an onboarding check, see ROADMAP.md A5).

## 6. Alcohol on a self-order screen

- **FACT** (Loi sur les infractions en matière de boissons alcooliques, I-8.1, current text read in a browser
  2026-10-23):
  - Art. 103.1: a holder of a permit under the liquor permits Act or the SAQ Act may not sell or serve alcohol to a
    minor, nor let a minor drink it in the establishment.
  - Art. 103.5: anyone may be required to prove they are of age to buy alcohol.
  - Art. 103.7: proof by passport, copy of birth certificate, driver's licence or identity card.
  Source: https://www.legisquebec.gouv.qc.ca/fr/document/lc/I-8.1
- **FACT (earlier pass).** A RACJ notice (2012) recommends asking for ID from anyone who appears under 25; INSPQ notes
  Bill 170 lets restaurants serve alcohol without a meal. The RACJ site was in maintenance on 2026-10-23.
  Sources: https://www.racj.gouv.qc.ca/communications/communiques-aux-titulaires/detail/interdiction-de-vendre-de-lalcool-aux-mineurs.html
  (via search) ; https://www.inspq.qc.ca/node/11399 (read 2026-10-23).
- **INFERENCE.** A kiosk cannot check ID. In kiosk mode, alcohol tiles are hidden by default, or the order is held for a
  staff ID check before payment or release. The staff register has no extra issue (staff already check).

## 7. Allergens and calories

- **FACT.** Québec.ca says that, for unpackaged food (restaurants), allergen information **should** be available to
  customers at all times or given to them (a recommendation: "devraient"); mandatory labelling applies to prepackaged
  food. Source: https://www.quebec.ca/sante/alimentation/allergies-alimentaires/gestion-allergies-alimentaires-industrie-commercants
  (read 2026-10-23).
- **Not researched in this pass:** calorie display on menus in Québec.
- **INFERENCE.** Show the menu's existing allergen tags (`MenuItem` tags / allergens in `lib/foodhub/types.ts`) on the
  item sheet, plus a "ask staff about allergies / demandez au personnel" line. Never claim "allergen-free". Lawyer
  question 8 stays open.

## 8. Privacy, accessibility, branding

- **FACT.** Clover requires the EULA and privacy policy to follow PIPEDA for Canada
  (https://docs.clover.com/dev/docs/international-app-market-readiness, read 2026-10-23). Clover's design requirements
  say apps must follow WCAG, with a 4.5:1 contrast ratio, alt text and TalkBack on merchant- and customer-facing screens
  (https://docs.clover.com/dev/docs/app-design-requirements, updated 2026-03-24, read 2026-10-23). The 4.5:1 ratio is
  WCAG Success Criterion 1.4.3, **Level AA** (https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html, read
  2026-10-23).
- **FACT.** Law 25 (Act respecting the protection of personal information in the private sector, P-39.1): s. 3.3 requires
  a privacy impact assessment for any project to acquire, develop or overhaul an information system that collects, uses,
  communicates, keeps or destroys personal information, consulting the person in charge of privacy (named under s. 3.1)
  from the start of the project; s. 17 requires an assessment before personal information is communicated outside
  Québec. Source: https://www.legisquebec.gouv.qc.ca/fr/document/lc/P-39.1 (read in a browser 2026-10-23).
- **FACT** (Clover App Market Developer Program Policies, last updated 2025-01-01, read in a browser 2026-10-23,
  https://www.clover.com/app-market-policies):
  - Data Policies: an app may only collect the minimum user data reasonably required to operate.
  - Deceptive Behavior: no names or icons confusingly similar to existing products or to Clover apps supplied with the
    device; no simulating functionality or warnings of other Clover apps.
  - App Support and Usage: a "quick reference guide" ships with the app.
  - Advertisement Policy: no advertising or promotions inside the app.
  - App Purchase Policies: paid apps and in-app paid features use the App Market payment system.
  - Spam and Placement: app descriptions must not be misleading.
- **FACT.** Clover denies apps that impersonate a Clover or another developer's app
  (https://docs.clover.com/docs/developer-app-approval, read 2026-10-23).
- **INFERENCE.**
  - The register records the signed-in Clover employee on each order and reads Employees: employee identity is
    personal information. Wording: "no customer personal data; employee identifiers only, as Clover already stores
    them".
  - Before P1: a short privacy impact assessment for the register (data: employee ID or name, order lines, device ID,
    server location), signed off by the person named in `FOODHUB_PRIVACY_OFFICER`, plus an s. 17 assessment if the
    Food Hub server is outside Québec (ROADMAP P0.12). A privacy policy alone does not meet these duties.
  - Privacy policy and EULA cover PIPEDA and Law 25 (as the Phone AI package already plans in
    `docs/CLOVER_MULTI_APP.md`).
  - Branding: "McDonald's-style" is a description of the idea only: no McDonald's name, colours, golden-arch shapes,
    fonts or screen layout copied, and no Clover look-alike icon. Original TAKATAK design. The English name should not
    lean on "Register", the name of Clover's built-in app (OWNER_DECISIONS 8).
  - No in-app promotion of other TAKATAK apps (Food Hub, Phone AI, ON2GO).

## 9. Market

### Competitors and public prices (read 2026-10-23)

| Product | Price (FACT, as published) | Hardware | French / Québec | Source |
|---|---|---|---|---|
| Clover Kiosk (US; also sold in Canada outside Québec) | US: $34.95/month per device + about $2,499–3,499 hardware (Clover US pages, resellers); Canada: "Contact sales", no public price | 24" + payment screen | English only; not offered in Québec | https://get.clover.com/kiosk ; https://www.clover.com/deals/kiosk/ ; https://www.clover.com/ca/kiosk |
| Samsung Kiosk App by Grubbrr | $99.00/month per kiosk ("Special Introductory Price") | Samsung kiosk + Clover Flex | Not stated | https://www.clover.com/appmarket/apps/6EV0BD632JZC0 |
| Self Checkout by LoyLap (Facilipay Pro) | $95/month per location after a 30-day free trial | Existing Flex, Mini or Station Solo | Not stated | https://www.clover.com/appmarket/apps/8M1B7YV28R3BT |
| Square Kiosk (Canada, launched 2024-11-07) | CAD $70/month per active device + processing; stand $249 (iPad not included); 30-day trial | iPad | In Québec, Square's SRM guide points food merchants to a third-party WEB-SRM-certified POS (Master Your Rush) while keeping Square for payments | https://squareup.com/ca/en/press/square-kiosk-in-canada ; https://squareup.com/ca/en/point-of-sale/restaurants/kiosk-software ; https://squareup.com/ca/guides/sales-recording-module-quebec |
| Lightspeed Kiosk | AUD $40/month per kiosk (Australian page); no Canadian price public | iPad | Not confirmed | https://www.lightspeedhq.com/au/pos/restaurant/pricing-o/ |
| Toast (Canada) | POS plans CA$120 and CA$220/month; no kiosk price public | Toast | Not confirmed | https://pos.toasttab.com/ca/restaurant-pos/cafe-bakery |

The two App Market prices were read inside a signed-in Clover dashboard ("Test Merchant"); currency and market (US or
Canada) are UNCONFIRMED. Clover Kiosk hardware is described from clover.com/ca/kiosk (24" order screen, 8" payment
screen, built-in printer).

### Positioning (INFERENCE)

- **Staff picture register:** we found no competitor in our search on 2026-10-23. Clover's own docs list "Menu with
  photos" as a known quick-service app type (https://docs.clover.com/docs/merchant-needs, updated 2026-03-24), so others
  may exist. Selling point: faster training and fewer wrong items for new staff, the Duo / Trio / Combo upsell on every
  order, in French and English, on the Clover device the merchant already owns.
- **French-first kiosk:** Clover's own kiosk is not offered in Québec and is English only; outside Québec it is sold and
  competes directly. The Clover-ecosystem kiosk apps do not advertise French or SRM. Our edge: French by default, no new
  payment processor.
- **"Works with the merchant's certified Clover MEV app"** is an internal target, **never listing copy**, until ROADMAP
  A15 passes for each MEV product: a public performance claim needs "an adequate and proper test" beforehand
  (Competition Act s. 74.01(1)(b), https://laws-lois.justice.gc.ca/eng/acts/C-34/section-74.01.html, read 2026-10-23),
  and Clover forbids misleading descriptions.
- **Price:** the owner's pattern (14-day trial, then CAD $50/month per merchant, billed by Clover) is not directly
  comparable to per-device (Square, CAD) or per-kiosk / per-location prices (Clover kiosk apps, currency unconfirmed).
  Compare like for like (per merchant, CAD) before saying "cheaper" anywhere public. Square Kiosk alone is not a Québec
  restaurant comparator (it needs a WEB-SRM partner POS there). The hardware is the merchant's existing Clover device.

## 10. Questions for a Québec lawyer

1. Revenu Québec's scenario puts order entry in the SRS. If our app takes the order, writes it to Clover and calls
   Clover's payment flow, and the merchant's certified MEV app produces the bill, is our app part of the SRS, or a
   change to it that needs recertification? Does the answer change for a self-order kiosk?
2. If it is part of the SRS, what does partner registration and certification involve, how long does it take, and can
   we ship to non-restaurant or non-Québec merchants first?
3. Which Charter articles apply to the app itself (software, art. 52.1, including feature parity) versus the merchant's
   menu (art. 51)? Who is liable if a merchant leaves French item names empty: the merchant, us, or both? Can the app
   refuse to show a tile without a French name?
4. Is "French default, English one tap away" enough for art. 51's "not more easily accessible" rule on a kiosk, and
   for art. 58 on the attract screen?
5. Tip prompts: if Clover's payment screen shows the tip, are we in scope of art. 225.1 and its regulation at all? What
   must our onboarding tell merchants?
6. Photos: what wording in our EULA / merchant terms puts the duty of photo accuracy on the merchant, and is that
   enough under CPA art. 231.1?
7. Alcohol at a kiosk: is "hide alcohol" or "hold for staff ID check before payment" sufficient for the permit holder
   under art. 103.1 and the permit conditions?
8. Allergens: what must a self-order screen show for unpackaged food in Québec?
9. Privacy: what must the privacy policy, EULA and the Law 25 privacy impact assessments (s. 3.3, s. 17) cover for an
   app that holds menu data, order lines and employee identifiers but no card data?
10. Trade dress: is a large-photo-tile grid generic, or are there McDonald's (or other) kiosk design rights we must
    stay away from?
