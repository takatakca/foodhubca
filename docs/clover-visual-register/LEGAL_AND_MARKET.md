# Legal and market: picture register and kiosk (Québec / Canada)

> [!WARNING]
> **Ceci n'est pas un avis juridique — à valider avec un avocat du Québec.**
> **This is not legal advice — validate it with a Québec lawyer.**
> It is research notes from public pages read on 2026-10-23. Some official pages (LégisQuébec, RACJ) could not be
> opened; those points are marked UNCONFIRMED. The questions for the lawyer are in §10.

> **FR — En bref.** Le gros risque est la **facturation obligatoire (MEV / SRM) de Revenu Québec** : un
> restaurant doit remettre une facture produite par un SEV certifié. Deux applis Clover sont déjà certifiées
> (« Clover MEV Connect » et « Clover MEV Web »). Notre caisse photo doit seulement créer la commande et laisser
> Clover et l'appli MEV du marchand produire la facture ; il faut le faire confirmer par écrit. Ensuite : tout en
> français d'abord (Charte), prix affiché = prix payé, photos fidèles au plat, pourboire calculé avant taxes, pas
> d'alcool sans vérification d'âge à la borne. Côté marché : les bornes sur Clover coûtent environ 95–99 $/mois,
> Square Kiosk 70 $ CA/mois par appareil ; aucune n'annonce le français ni la certification MEV. 50 $ CA/mois est
> sous le marché.
>
> **EN — In short.** The big risk is **Revenu Québec mandatory billing (SRM / WEB-SRM)**: a restaurant must hand the
> customer a bill produced by a certified SRS. Two Clover apps are already certified ("Clover MEV Connect" and
> "Clover MEV Web"). Our picture register should only create the order and let Clover plus the merchant's MEV app
> produce the bill; that must be confirmed in writing. Then: French first everywhere (Charter), displayed price =
> charged price, photos true to the dish, tips computed before tax, no alcohol at the kiosk without an age check.
> Market: kiosks on Clover cost about $95–99/month, Square Kiosk CAD $70/month per device; none advertises French
> or SRM certification. CAD $50/month is below the market.

Labels: **FACT**, **INFERENCE**, **UNCONFIRMED** (same meaning as in README.md).

---

## 1. Revenu Québec mandatory billing (SRM / WEB-SRM): the biggest risk

- **FACT.** Revenu Québec press release (2024-11-15): restaurants still on SRMs had until 2025-06-01 to obtain at least
  one SRS certified by Revenu Québec and compatible with WEB-SRM, with a possible 3-month extension.
  Source: https://www.revenuquebec.ca/en/press-room/news/details/2024-11-15/shift-to-web-srm-in-the-restaurant-sector
  (read 2026-10-23).
- **FACT.** Restaurant operators must send transaction data through a certified SRS and give each customer a bill
  produced by it. A new version with new features needs new certification, except when only payment methods change.
  Source: https://www.revenuquebec.ca/en/businesses/sector-specific-measures/mandatory-billing/mandatory-billing-restaurant-sector/
  (read 2026-10-23).
- **FACT.** An SRS built to talk to WEB-SRM must be certified, and its developer must be a registered Revenu Québec
  partner. Source: https://www.revenuquebec.ca/en/partners/product-developers/fields-of-activity/developers-mandatory-billing-cloud-solution/certified-srss-designed-to-communicate-with-the-web-srm/
  (snippet, 2026-10-23).
- **FACT (read in a browser).** Revenu Québec's list of SEVs certified for MEV-WEB, restaurant sector, has 84 products,
  including:

  | Product | Holder | Certified | Platform | Scope (FACT) |
  |---|---|---|---|---|
  | Clover MEV Connect v1.2.1 | Pulsar informatique Inc | 2025-12-05 | Android | Counter service only; no table service, no digital-platform orders; tip entry available |
  | Clover MEV Web v1.0.33 | 15535743 Canada inc. | 2025-09-05 | Android | Counter, table, operator delivery and digital-platform orders |
  | BIBORNE | (kiosk vendor) | — | — | Kiosk certified as an SEV in its own right |
  | Kiosk 360 | (kiosk vendor) | 2025-04-09 | Windows | Counter service |
  | WinVision PosKiosk | (kiosk vendor) | — | — | Kiosk certified as an SEV |

  Source: https://www.revenuquebec.ca/fr/partenaires/produits-autorises/systemes-denregistrement-des-ventes-certifies/sev-compatibles-avec-le-mev-web-restauration/
  (and its detail pages `/clover-mev-connect/121/` and `/clover-mev-web-/1033/`), read in a browser 2026-10-23.
- **FACT.** Clover's Canadian readiness page: every app in hospitality, FSR or QSR sectors "must be certified with
  Revenue Quebec's SRM mandate". Source: https://docs.clover.com/dev/docs/international-app-market-readiness
  (read 2026-10-23).
- **FACT.** Clover added fiscalization support (custom payment receipts, Fiscalization app support) to its payment SDK
  in October 2024. Source: https://docs.clover.com/dev/docs/whats-new-2024 (read 2026-10-23).
- **INFERENCE.**
  - A Québec Clover restaurant already needs one of the two certified Clover MEV apps.
  - If our register or kiosk **only creates Clover orders and hands payment to Clover**, it may be able to rely on the
    merchant's certified MEV app for the bill. This is **unconfirmed**.
  - A kiosk or register that **prints its own bill** would itself be an SEV needing certification, as BIBORNE and
    Kiosk 360 did. We do not do that.
  - The repo's SRM notes (`docs/CLOVER_MARKETPLACE_LAUNCH.md` §5, `docs/CLOVER_MULTI_APP.md`) were written for Food
    Hub and do not yet mention these two Clover MEV products; they should be updated when the owner acts on this.
  - Get written answers from Clover Developer Relations **and** Revenu Québec before any Québec sale. Budget for
    certification if they say it is required.

## 2. French language (Charter of the French language / Bill 96)

- **FACT** (OQLF presentation of the Charter as amended, June 2022; LégisQuébec returned 403):
  - Art. 51: inscriptions on a product must be in French; "Cette règle s'applique également aux menus et aux cartes des
    vins". Other languages may not prevail over French or be more easily accessible.
  - Art. 52.1: all software must be available in French unless no French version exists.
  - Art. 50.2: consumers' right to be informed and served in French.
  - Art. 57: invoices and receipts in French.
  - Art. 177: the OQLF can issue orders against anyone offering non-compliant software and against any establishment
    operator presenting non-compliant menus.
  Sources: https://www.oqlf.gouv.qc.ca/rdiprp/demandes/AI2223-167_documents/AI2223_167_presentation.pdf ;
  https://www.oqlf.gouv.qc.ca/francisation/droits_linguistiques/droits/langue-du-commerce-et-des-affaires.html
  (read 2026-10-23).
- **FACT.** Clover, for Québec merchants: "every merchant and customer-facing screen and prompt must be available in
  French and English". Source: https://docs.clover.com/dev/docs/international-app-market-readiness (read 2026-10-23).
- **UNCONFIRMED.** Law-firm summaries say OQLF fines run $3,000–$30,000 per offence.
  Source: https://www.mccarthy.ca/fr/references/blogues/consumer-markets-perspectives/exigences-de-francais-du-projet-de-loi-96-et-du-1er-juin-2025-idees-recues
  (read 2026-10-23).
- **INFERENCE.** Every tile, category, modifier, upsell, error and receipt line exists in French. French is the default
  on customer screens; English is no easier to reach than French. The merchant's French item names (`nameFr`) are
  **required** data for this app, not optional. French-first is both the legal floor and our edge over Clover Kiosk
  (English only).

## 3. Displayed price = charged price

- **FACT.** The OPC says any advertised price must be all-inclusive; only GST/QST (and a few listed levies or deposits)
  may be added at payment; charging more than the advertised price is prohibited.
  Sources: https://www.opc.gouv.qc.ca/commercant/pratique-commerce/prix-rabais/tout-inclus ;
  https://www.opc.gouv.qc.ca/en/consumer/topic/illegal-practice/prohibited/all-inclusive-price (read 2026-10-23).
- **FACT.** Competition Act s. 74.01(1.1) (drip pricing): a price not attainable because of fixed mandatory fees is
  false or misleading, except government charges such as sales tax. Criminal s. 52(1.3) fines go up to $200,000 on
  summary conviction.
  Sources: https://competition-bureau.canada.ca/en/deceptive-marketing-practices/drip-pricing ;
  https://laws-lois.justice.gc.ca/eng/acts/C-34/section-74.01.html ;
  https://competition-bureau.canada.ca/en/deceptive-marketing-practices/types-deceptive-marketing-practices/penalties-and-remedies-non-compliance
  (read 2026-10-23).
- **FACT.** The Price Accuracy Policy ($15 threshold) applies to merchants exempt from item-by-item price tagging and
  covers self-checkouts; restaurants are not mentioned.
  Source: https://www.opc.gouv.qc.ca/commercant/pratique-commerce/prix-rabais/politique (read 2026-10-23).
- **INFERENCE.** The price on each tile is exactly the Clover item price charged, and modifier prices are shown before
  selection. No hidden kiosk, service or packaging fee: build it into the item price. Taxes may be added on the review
  screen. (Note: the storefront page hard-codes a 14.975 % display tax in `app/commander/[slug]/order-client.tsx`; the
  register must use Clover's own tax rates instead.)

## 4. Food photo accuracy

- **FACT.** The OPC lists as prohibited showing an illustration that is not faithful to the good or service whose price
  is advertised (CPA art. 219 family). The Competition Bureau says ss. 52 / 74.01 cover in-store ads and illustrations,
  judged by the "general impression".
  Sources: https://www.opc.gouv.qc.ca/commercant/pratique-commerce/publicite-loi/pratiques-interdites/ ;
  https://competition-bureau.canada.ca/en/deceptive-marketing-practices/types-deceptive-marketing-practices/misleading-representations-and-deceptive-marketing-practices
  (read 2026-10-23).
- **INFERENCE.** Each tile shows the actual dish and portion sold, not a stock or upgraded version. A photo with fries or
  a drink must match what the price includes, which matters for Duo / Trio / Combo tiles. Prefer the restaurant's own
  photos (Food Hub `/media`).

## 5. Tips at the payment screen (Québec Bill 72)

- **FACT.** Since 2025-05-07, tip suggestions must be calculated on the bill **before taxes**, presented neutrally and
  uniformly, with a visible custom-amount option. OPC documents cite CPA art. 225.1 and Regulation s. 91.8.1 (numbering
  not confirmed on LégisQuébec); an OPC file flags a pre-selected $2 tip as non-compliant.
  Sources: https://www.quebec.ca/nouvelles/actualites/details/des-pourboires-calcules-avant-les-taxes-et-des-prix-plus-clairs-a-lepicerie-62679 ;
  https://cdn.opc.gouv.qc.ca/media/documents/a-propos/AccesInformation/2025/344002602_Document2.pdf (read 2026-10-23).
- **INFERENCE.** Simplest path: our app shows **no** tip prompt of its own and leaves tipping to Clover's payment flow.
  We then verify that Clover's tip screen, as the merchant configures it, computes on the pre-tax subtotal with no
  default choice (an onboarding check, see ROADMAP.md).

## 6. Alcohol on a self-order screen

- **FACT.** Selling or serving alcohol to anyone under 18 is prohibited in any establishment (Loi sur les infractions en
  matière de boissons alcooliques, art. 103.1). Art. 103.5 lets a person be required to prove majority; art. 103.7
  lists acceptable proof (from a 2002 version found via search; current text not confirmed). A RACJ notice (2012)
  recommends asking for ID from anyone who appears under 25. INSPQ notes Bill 170 lets restaurants serve alcohol
  without a meal. The RACJ site was in maintenance on 2026-10-23.
  Sources: https://www.legisquebec.gouv.qc.ca/fr/ShowDoc/cs/I-8.1 (via search) ;
  https://www.racj.gouv.qc.ca/communications/communiques-aux-titulaires/detail/interdiction-de-vendre-de-lalcool-aux-mineurs.html
  (via search) ; https://www.inspq.qc.ca/node/11399 (read 2026-10-23).
- **INFERENCE.** A kiosk cannot check ID. In kiosk mode, alcohol tiles are hidden by default, or the order is held for a
  staff ID check before payment or release. The staff register has no extra issue (staff already check).

## 7. Allergens and calories

- **PARTIAL (research note cut off in the handoff; source URL lost).** Federal allergen labelling rules apply to
  prepackaged food. For unpackaged food (restaurants), a Québec.ca / MAPAQ page says establishments have a duty to
  inform customers about allergens. Re-find and re-read that page before relying on it.
- **Not researched in this pass:** calorie display on menus in Québec.
- **INFERENCE.** Show the menu's existing allergen tags (`MenuItem` tags / allergens in `lib/foodhub/types.ts`) on the
  item sheet, plus a "ask staff about allergies / demandez au personnel" line. Never claim "allergen-free".

## 8. Privacy, accessibility, branding

- **FACT.** Clover requires the EULA and privacy policy to follow PIPEDA for Canada
  (https://docs.clover.com/dev/docs/international-app-market-readiness, read 2026-10-23). Clover's design requirements
  require WCAG, 4.5:1 contrast, alt text and TalkBack on merchant- and customer-facing screens
  (https://docs.clover.com/dev/docs/app-design-requirements, read 2026-10-23).
- **FACT.** Clover denies apps that impersonate a Clover or another developer's app
  (https://docs.clover.com/docs/developer-app-approval, read 2026-10-23).
- **INFERENCE.** Privacy policy and EULA cover PIPEDA and Québec's Law 25 (as the Phone AI package already plans in
  `docs/CLOVER_MULTI_APP.md`). The register collects no customer personal data by default. "McDonald's-style" is a
  description of the idea only: no McDonald's name, colours, golden-arch shapes, fonts or screen layout copied, and no
  Clover look-alike icon. Original TAKATAK design.

## 9. Market

### Competitors and public prices (read 2026-10-23)

| Product | Price (FACT, as published) | Hardware | French / Québec | Source |
|---|---|---|---|---|
| Clover Kiosk (US) | $34.95/month per device + about $2,499–3,499 hardware (Clover US pages, resellers) | 23.8" + Mini | English only; not offered in Québec | https://get.clover.com/kiosk ; https://www.clover.com/deals/kiosk/ ; https://www.clover.com/ca/kiosk |
| Samsung Kiosk App by Grubbrr | $99.00/month per kiosk ("Special Introductory Price") | Samsung kiosk + Clover Flex | Not stated | https://www.clover.com/appmarket/apps/6EV0BD632JZC0 |
| Self Checkout by LoyLap (Facilipay Pro) | $95/month per location after a 30-day free trial | Existing Flex, Mini or Station Solo | Not stated | https://www.clover.com/appmarket/apps/8M1B7YV28R3BT |
| Square Kiosk (Canada, launched 2024-11-07) | CAD $70/month per active device + processing; stand $249 (iPad not included); 30-day trial | iPad | Not confirmed | https://squareup.com/ca/en/press/square-kiosk-in-canada ; https://squareup.com/ca/en/point-of-sale/restaurants/kiosk-software |
| Lightspeed Kiosk | AUD $40/month per kiosk (Australian page); no Canadian price public | iPad | Not confirmed | https://www.lightspeedhq.com/au/pos/restaurant/pricing-o/ |
| Toast (Canada) | POS plans CA$120 and CA$220/month; no kiosk price public | Toast | Not confirmed | https://pos.toasttab.com/ca/restaurant-pos/cafe-bakery |

The two App Market prices were read inside a signed-in Clover dashboard ("Test Merchant"); currency and market (US or
Canada) are UNCONFIRMED.

### Positioning (INFERENCE)

- **Staff picture register:** we found no competitor. Selling point: faster training and fewer wrong items for new
  staff, the Duo / Trio / Combo upsell on every order, in French and English, on the Clover device the merchant already
  owns.
- **French-first kiosk for Québec:** Clover's own kiosk is not offered in Québec; the Clover-ecosystem kiosk apps do not
  advertise French or SRM. Our edge: French by default, works with the merchant's certified Clover MEV app, no new
  payment processor.
- **Price:** the owner's pattern (14-day trial, then CAD $50/month, billed by Clover) sits below Square (CAD $70 per
  device) and the Clover kiosk apps (about $95–99), and above Clover's US kiosk subscription. The hardware is the
  merchant's existing Clover device.

## 10. Questions for a Québec lawyer

1. If our app only builds the order and calls Clover's payment flow, and the bill comes from the merchant's certified
   Clover MEV app, is our app an "SEV" under the mandatory billing rules? Does the answer change for a self-order
   kiosk?
2. If it is an SEV, what does partner registration and certification involve, how long does it take, and can we ship
   to non-restaurant or non-Québec merchants first?
3. Which Charter articles apply to the app itself (software, art. 52.1) versus the merchant's menu (art. 51)? Who is
   liable if a merchant leaves French item names empty: the merchant, us, or both? Can the app refuse to show a tile
   without a French name?
4. Is "French default, English one tap away" enough for art. 51's "not more easily accessible" rule on a kiosk?
5. Tip prompts: if Clover's payment screen shows the tip, are we in scope of the Bill 72 rules at all? What must our
   onboarding tell merchants?
6. Photos: what wording in our EULA / merchant terms puts the duty of photo accuracy on the merchant, and is that
   enough under CPA art. 219?
7. Alcohol at a kiosk: is "hide alcohol" or "hold for staff ID check before payment" sufficient under art. 103.1 and
   the merchant's permit conditions?
8. Allergens: what must a self-order screen show for unpackaged food in Québec?
9. Privacy: what must the privacy policy and EULA say under PIPEDA and Law 25 for an app that holds menu data and
   order lines but no card data?
10. Trade dress: is a large-photo-tile grid generic, or are there McDonald's (or other) kiosk design rights we must
    stay away from?
