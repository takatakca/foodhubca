# Platform API research: what DoorDash, Uber Eats and SkipTheDishes need to approve TAKATAK Food Hub

_Task 11 · branch `api-research` · researched 2026-10-08 from **official sources only** (developer.doordash.com,
developer.uber.com, Just Eat Takeaway's published OpenAPI specification for JET Connect). Research only: no portal
logins, no forms, no messages. This repository is public: no ids, case numbers, emails or secrets below._

## Status / next step (handoff note)
- **Status (2026-10-08):** research done and written (sections 1–7). Docs only, no code changed.
- **Next step:** final proofread for public-repo hygiene (no ids, emails, phone numbers), then the owner opens the
  pull request from `api-research`. The developer backlog is section 6, which can become its own task.
- **Files to read:** this document; `lib/foodhub/adapters/doordash.ts`, `uber-eats.ts`, `skip.ts` for the tables.

Status labels in the tables: **done** (built on `main`), **partial** (built, but something the platform asks for is
missing), **missing** (to build), **owner** (not code: a signature, an application, a portal step).

---

## Pour le propriétaire : quoi faire pour être approuvé, plateforme par plateforme, dans l'ordre

### DoorDash (Marketplace : les commandes DoorDash dans Food Hub)
1. **Postuler maintenant.** Developer Portal → onglet *Integrations* → demande d'accès Marketplace, en tant
   qu'intégration **d'un seul marchand** (« direct-to-brand ») pour votre groupe de restaurants. DoorDash étudie les
   demandes **une fois par trimestre** et n'accepte qu'un petit nombre d'intégrations par an.
2. **Demander un « Enterprise Partner Manager » (EPM)** à votre contact DoorDash. Pour une intégration d'un seul
   marchand, c'est lui qui active vos magasins (le plus simple). Sans EPM, nous devons programmer le « Store Onboarding
   Webhook » (section 6).
3. **Bac à sable** (dès que l'accès est donné) : créer le fournisseur de test, la clé d'accès, jusqu'à 20 magasins de
   test, les abonnements webhook (Orders, Menu Status, Menu Request, Dasher Status) ; demander à DoorDash de brancher le
   webhook *Order Canceled* et de vous autoriser les **annulations par le marchand** (requises pour la certification).
4. **Certification** : les développeurs ferment les manques de la section 6, puis on enregistre une **vidéo d'écran par
   fonction exigée**. Vous cochez la liste *Get Started*, puis Support → Marketplace → *Credentials and Authentication* →
   « intégration prête à être certifiée ». Revue en direct avec le gestionnaire technique (TAM).
5. **Production et pilote** : environ **20 magasins** (jamais le magasin verrouillé), taux d'erreur **< 2 % pendant 14
   jours**, « graduation » à la fin du mois. Ensuite, toujours **< 1 %** de commandes en échec et **< 1 %**
   d'annulations par le marchand (moyenne 28 jours).
6. **DoorDash Drive** (livreurs pour vos propres commandes) est une demande séparée : postuler dans le portail, ajouter
   une carte de crédit au compte développeur, accepter les conditions Drive (+ avenant alcool si vous livrez de
   l'alcool), faire les livraisons de test au simulateur, puis une **démo en partage d'écran**.

### Uber Eats
1. **Signer la NDA et l'entente de licence API** d'Uber, et demander à votre gestionnaire de partenariat Uber Eats
   l'**approbation écrite** d'une intégration POS pour vos propres magasins.
2. **Bac à sable** : demander un **magasin de test** au support technique d'intégration Uber ; on teste avec l'app
   « Testing ».
3. Ouvrir un ticket de support pour la **vérification d'intégration** (test complet fait avec Uber).
4. **App de production** créée avec un **compte Uber de production séparé** (jamais les comptes de test). Envoyer son
   client_id dans un ticket pour faire **autoriser les scopes** (liste en section 2.2), puis cocher les scopes et régler
   l'URL du webhook principal.
5. **Pilote d'un magasin** : prévenir Uber au moins une semaine avant ; « Brancher Uber Eats » (cela **retire
   UrbanPiper** comme gestionnaire des commandes de ce magasin), publier le menu, activer. Il faut **3 jours à ≥ 98 %**
   de commandes injectées.
6. Déployer les autres magasins selon un calendrier fait avec Uber, en restant **≥ 99 %** (objectif 99,9 %).

### SkipTheDishes (Just Eat Takeaway, « JET Connect »)
1. Demander à Skip (portail restaurant ou gestionnaire de compte) l'**accès JET Connect pour votre propre POS**
   (Food Hub). La clé API n'est donnée qu'avec une **entente commerciale** ; le contact « Integration enquiries » est
   sur developers.just-eat.com.
2. Obtenir : la clé `X-Flyt-Api-Key` (test et production), le `posLocationId` de chaque restaurant, et faire
   enregistrer nos 6 adresses webhook + le secret HMAC. Demander si la nouvelle **API d'onboarding des partenaires**
   (2026) est ouverte au Canada.
3. Les magasins Skip encore chez UrbanPiper : l'onboarding de JET **refuse un restaurant déjà relié à un autre
   intégrateur** (« switching is not yet supported »). Skip doit donc déplacer chaque magasin (avec votre accord) après
   qu'UrbanPiper l'a libéré.
4. Une commande de test par magasin ; garder la tablette Skip comme secours (une commande refusée y est envoyée).

## For the owner: what to do to get approved, per platform, in order

### DoorDash (Marketplace: DoorDash orders in Food Hub)
1. **Apply now.** Developer Portal → *Integrations* tab → Marketplace access request, as a **single-merchant
   ("direct-to-brand")** integration for your restaurant group. DoorDash reviews applications **quarterly** and accepts
   only a limited number of integrations each year.
2. **Ask your DoorDash contact for an Enterprise Partner Manager (EPM).** For a single-merchant integration the EPM
   activates your stores (simplest path). Without one, we must build the Store Onboarding Webhook (section 6).
3. **Sandbox** (once access is granted): create the sandbox provider, an access key, up to 20 test stores and the
   webhook subscriptions (Orders, Menu Status, Menu Request, Dasher Status); ask DoorDash to wire the *Order Canceled*
   webhook and to **allowlist merchant cancellations** (needed for certification).
4. **Certification**: developers close the gaps in section 6, then we record **one screen video per required feature**.
   You tick the *Get Started* checklist, then Support → Marketplace → *Credentials and Authentication* → "integration
   ready to be certified". Live review with the Technical Account Manager (TAM).
5. **Production and pilot**: about **20 stores** (never the locked store), error rate **under 2% for 14 days**, then the
   monthly graduation. After that, always **under 1%** failed orders and **under 1%** merchant cancellations (28-day
   rolling).
6. **DoorDash Drive** (Dashers for your own orders) is a separate request: apply in the portal, attach a credit card to
   the developer account, accept the Drive terms (+ alcohol addendum if you deliver alcohol), run the simulator test
   deliveries, then a **screen-share demo**.

### Uber Eats
1. **Sign Uber's NDA and API licensing agreement**, and ask your Uber Eats partner manager for **written approval** of a
   POS integration for your own stores.
2. **Sandbox**: ask Uber's integration tech support for a **test store**; we test with the "Testing" app.
3. Open a support ticket for **integration verification** (an end-to-end test run with Uber).
4. **Production app** created under a **separate production Uber account** (never the test accounts). Send its
   client_id in a ticket to get the **scopes whitelisted** (list in section 2.2), then tick the scopes and set the
   Primary Webhook URL.
5. **Pilot one store**: tell Uber at least one week ahead; "Connect Uber Eats" (this **demotes UrbanPiper** as that
   store's order manager), publish the menu, switch orders on. It must run **3 days at ≥ 98%** order injection.
6. Roll out the other stores on a schedule agreed with Uber, staying **≥ 99%** (target 99.9%).

### SkipTheDishes (Just Eat Takeaway, "JET Connect")
1. Ask Skip (restaurant portal or account manager) for **JET Connect access for your own POS** (Food Hub). The API key
   is only issued under a **commercial agreement**; the "Integration enquiries" contact is on developers.just-eat.com.
2. Obtain: the `X-Flyt-Api-Key` (test and production), each restaurant's `posLocationId`, and have our 6 webhook URLs
   and the HMAC secret registered. Ask whether the new **Partner Onboarding API** (2026) is open in Canada.
3. Skip stores still on UrbanPiper: JET's onboarding **refuses a location live with another integrator** ("switching
   is not yet supported"). Skip has to move each store (with your consent) once UrbanPiper releases it.
4. One test order per store; keep the Skip tablet as the backup (a failed order goes there).

---

## 1. DoorDash

### 1.1 Which DoorDash programme fits us
- **Marketplace (limited access).** "Marketplace APIs are not yet generally available"; DoorDash supports "a limited
  number of integrations each year", "Participation is by approval only", applications are "reviewed quarterly"
  ([about](https://developer.doordash.com/en-US/docs/marketplace/overview/about_marketplace),
  [requesting access](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/requesting_access)).
- **Merchants may build their own integration**, though "this is less common"
  ([middleware vs merchants](https://developer.doordash.com/en-US/docs/marketplace/overview/middleware_vs_merchants)).
  DoorDash's own provider-naming guide covers merchants ("name the provider after the restaurant")
  ([create provider](https://developer.doordash.com/docs/marketplace/overview/getting_started/create_provider_getting_started)).
- **Onboarding flow depends on the integration type**
  ([setup SSIO](https://developer.doordash.com/en-US/docs/marketplace/how_to/setup_ssio)):
  - **SSIO** (Self-Serve Integration Onboarding, OAuth by the store's Business Admin) is **required for third-party
    platforms** (middleware such as UrbanPiper). Not required for us.
  - **SOW** (Store Onboarding Webhook) is for **single-merchant** integrations: that is us
    ([SOW](https://developer.doordash.com/en-US/docs/marketplace/overview/onboarding/sow)).
  - **Direct to Merchant (EPM)**: a single-brand / parent-group integration can have a DoorDash Enterprise Partner
    Manager submit store activations to DoorDash's Bulk Activation Tooling; Menu Pull is required; without an EPM, the
    integration must support SSIO or SOW
    ([EPM](https://developer.doordash.com/docs/marketplace/overview/onboarding/epm)).
- **Verdict for a small in-house integrator:** possible on paper (single-merchant SOW or EPM path), but gated by a
  quarterly review with few slots. The application is the critical path; build quality is not.

### 1.2 Approval path, step by step
1. Apply in the Developer Portal (*Integrations* tab).
2. Sandbox: create a sandbox provider (the `_sandbox` suffix is added), an access key (developer id, key id, signing
   secret), up to **20 test stores**, webhook subscriptions (one endpoint per environment)
   ([test store](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/create_test_store_getting_started),
   [webhooks](https://developer.doordash.com/docs/marketplace/how_to/create_webhook_subscription)).
3. Build every **required** feature ([general requirements](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/general_integration_requirements),
   [requirements (new)](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/integration_requirements_new)).
4. Certification: "Certification requires successful demonstration of every required feature", normally **screen
   recordings of each feature** reviewed asynchronously; SOW integrations add a **live end-to-end review with the TAM**.
5. Production access: tick the *Get Started* checklist, then Support → Integration **Marketplace** → Category
   **Credentials and Authentication** → "ready to be certified"
   ([production access](https://developer.doordash.com/docs/marketplace/how_to/production_access)). The production
   webhook can only be configured after production access.
6. Pilot about **20 stores**; "No additional stores past the 20 pilot locations can be onboarded until officially
   graduated". Graduation is monthly (last week), needs certification ≥ 2 weeks before, an error rate **< 2% for more
   than 14 days**, three surveys (functionality and contacts, onboarding and merchant content, error-decoding sheet),
   company logo and a signed IP consent; merchants outside US/Canada/Australia need TAM authorization
   ([graduation handbook](https://developer.doordash.com/en-US/docs/marketplace/faq/graduation_handbook)).
7. After graduation, the quality bar applies (section 1.4).

### 1.3 Technical rules that matter
- **Auth (JWT):** HS256, header `dd-ver: DD-JWT-V1`, payload `aud: "doordash"`, `iss` = developer id, `kid` = key id,
  `iat`, `exp` at most 30 min after `iat`; signing secret base64/base64url-decoded. Request headers:
  `Authorization: Bearer <JWT>`, `auth-version: v2`, **and `User-Agent: <ProviderType in CamelCase>/1.0`**. The
  `provider_type` is issued by DoorDash, snake_case in JSON bodies, CamelCase in the User-Agent
  ([JWTs](https://developer.doordash.com/en-US/docs/marketplace/how_to/JWTs),
  [FAQ](https://developer.doordash.com/en-US/docs/marketplace/faq/getting_started)).
- **Order webhook** `event.type = OrderCreate`: answer **200** (synchronous confirm, HTTP timeout "more than 1 minute",
  async preferred if > ~20 s) or **202** then `PATCH /api/v1/orders/{id}` within **3–8 minutes** or the order fails as
  a confirmation timeout. Body: `merchant_supplied_id`, `order_status` `success|fail`, optional `prep_time` (UTC;
  DoorDash recommends omitting it), `failure_reason` (required on fail) and item-level `errors[]`
  (`code`, `merchant_supplied_id`, `message`). Codes include `ITEM_OUT_OF_STOCK`, `STORE_CLOSED`, `POS_OFFLINE`,
  `CAPACITY_THROTTLING`, `STORE_HOURS_ISSUE`, `INVALID_ORDER`, `STALE_PICKUP_TIME`, `TIME_OUT`, `OTHER`
  ([order integration](https://developer.doordash.com/en-US/docs/marketplace/how_to/order_integration)).
  Order fields to use: `experience` (DoorDash / Caviar / Storefront), `fulfillment_type`, `merchant_tip_amount`,
  `is_tax_remitted_by_doordash`, `delivery_short_code`, `consumer.id` (64-bit).
- **Detailed error spec:** a raw failure reason with every confirmed cancellation; null, vague ("timeout") and "Other"
  reasons must stay **under 15%** over 28 days ([detailed error spec](https://developer.doordash.com/docs/marketplace/how_to/detailed_error_spec)).
- **Order ready:** `PATCH /api/v1/orders/{id}/events/order_ready_for_pickup` (`merchant_supplied_id`)
  ([API reference](https://developer.doordash.com/en-US/api/marketplace/)). The reference notes this events call uses
  its own token: confirm in the sandbox.
- **Cancellations:** DoorDash → merchant via the **Order Canceled** webhook (`external_order_id`, `client_order_id`,
  `store`, `is_asap`), configured by DoorDash on request; it carries no reason
  ([cancellation webhook](https://developer.doordash.com/docs/marketplace/how_to/order_cancellation_webhook)).
  Merchant → DoorDash: `PATCH /api/v1/orders/{id}/cancellation` with `cancel_reason` `ITEM_OUT_OF_STOCK | STORE_CLOSED
  | KITCHEN_BUSY | OTHER`, **allowlist required** (ask the TAM); `STORE_CLOSED` pauses the store 12 h, `KITCHEN_BUSY`
  15 min ([merchant cancellation](https://developer.doordash.com/docs/marketplace/how_to/merchant_order_cancellation)).
- **Dasher Status** (recommended, not certified): events such as `dasher_confirmed`, `arriving_at_store` (400 m, not
  configurable), `arrived_at_store`, `dasher_out_for_delivery`, `dropoff`
  ([Dasher status](https://developer.doordash.com/en-US/docs/marketplace/faq/dasher_status_webhook)).
- **Menus:** push `POST /api/v1/menus`, update `PATCH /api/v1/menus/{id}` (**full menu**, not a diff); processing is
  async (< 1 min average) and the **Menu Status** webhook echoes our `reference` (never empty). Pull: DoorDash calls
  `GET {our endpoint}/{location_id}[?ids=…]` and expects `{ store: { merchant_supplied_id, provider_type }, menus: [] }`.
  Limits: names 500 chars, descriptions 1000, ids 1024; 400 = fix, do not retry; **429 = retry after 1 minute**; 500 =
  exponential backoff; one job `IN_PROGRESS` per location ([menu integration](https://developer.doordash.com/en-US/docs/marketplace/how_to/menu_integration)).
  Certification also checks: menu deactivate/reactivate (`active`), regular and special hours, images
  (`original_image_url`), the alcohol flag, **dual pricing (delivery vs pickup price)**, one update per store per day,
  menu pull through the portal's ingest and update tools.
- **Availability:** items `PUT /api/v1/stores/{msid}/items/status`, options `…/item_options/status`; store
  `PUT /api/v1/stores/{msid}/status` with `is_active`, `reason` (`operational_issues`, …), `notes`, `end_time`
  (ISO with offset). **No end time = DoorDash reactivates after 14 days**; permanent deactivation by a POS is no longer
  supported; tell the TAM before sending temporary deactivations
  ([store and item status](https://developer.doordash.com/en-US/docs/marketplace/how_to/store_and_item_status)).
  New requirement: **automatic item availability polling** (`GET …/item/availability`, `…/item_option/availability`)
  reconciled against the webhooks.
- **Store onboarding (SOW):** we call `POST https://openapi.doordash.com/webhooks/stores/onboarding`, one per location,
  with `partner_store_id`, `partner_store_name`, `provider_type`, address fields, requestor name and email,
  `merchant_decision_maker_email` (optional `doordash_store_id`, recommended). DoorDash emails the Business Admin for
  consent, pulls the menu, runs QA and activates; statuses `INTEGRATION_REQUESTED → STORE_CONNECTED → MENU_REQUESTED →
  MENU_IMPORTED → MENU_AUDIT → MENU_QUALIFIED → INTEGRATION_ACTIVATED` (or `MENU_BLOCK`, `ACTIVATION_BLOCK`,
  `ABANDONED` + exclusion code). SLAs: our side ready **within 14 days**, menu issues fixed **within 48 business
  hours**. Exclusion codes to watch: **`VIRTUAL_BRAND_DETECTED`**, `SELF_DELIVERY_DETECTED`, `DUPLICATE_LOCATION_ID`,
  `STORE_HOURS_NOT_POPULATED_FAILURE`.
- **Test orders:** placed from the portal; validate in *Event Logs* (`ORDER_CREATE`, `ORDER_STATUS`,
  `ORDER_CANCELLED`, 2xx, zero retries); unconfirmed orders auto-cancel around 90 min
  ([validate test order](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/validate_test_order)).

### 1.4 Quality bar after go-live
- Order failure rate **< 1%** and merchant cancel rate **< 1%**, 28-day rolling; above 1% you have 6 weeks to recover,
  then onboarding is suspended (existing stores keep working); API access can be revoked
  ([preferred integrations](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/preferred_integrations_new)).
- Accept new fields without rejecting orders (e.g. int → bigint).

### 1.5 DoorDash Marketplace: requirement vs our code

| Requirement | Official link | Our status | File / what to build |
|---|---|---|---|
| Marketplace access application (quarterly review) | [requesting access](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/requesting_access) | owner | Apply as single-merchant; ask for an EPM |
| Sandbox provider, access key, ≤ 20 test stores | [test store](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/create_test_store_getting_started) | owner | Env `DOORDASH_DEVELOPER_ID`, `_KEY_ID`, `_SIGNING_SECRET`, `_PROVIDER_TYPE` already read |
| JWT (HS256, DD-JWT-V1, aud, iss, kid, exp ≤ 30 min, `auth-version: v2`) | [JWTs](https://developer.doordash.com/en-US/docs/marketplace/how_to/JWTs) | done | `doorDashJwt()` in `lib/foodhub/adapters/doordash.ts` (exp 5 min) |
| `User-Agent: <ProviderType>/1.0` on every call | [JWTs](https://developer.doordash.com/en-US/docs/marketplace/how_to/JWTs) | **missing** | Add to `headers()` in `doordash.ts`, derived from `DOORDASH_PROVIDER_TYPE` (snake_case → CamelCase) |
| Webhook subscriptions: Orders, Menu Status, Menu Request (required); Order Canceled, Dasher Status | [webhooks](https://developer.doordash.com/docs/marketplace/how_to/create_webhook_subscription) | done (code) / owner (portal) | `app/api/foodhub/webhooks/doordash/route.ts`, `…/doordash/[locationId]/route.ts`, `lib/foodhub/webhooks/doordash.ts` |
| Order webhook → 202, confirm by PATCH within 3–8 min | [order integration](https://developer.doordash.com/en-US/docs/marketplace/how_to/order_integration) | done | Route answers 202; `acceptOrder` after Clover has the order; deadline 3 min in `lib/foodhub/deadline.ts` |
| Reject with `failure_reason` + item-level `errors[]` and DoorDash codes | [order integration](https://developer.doordash.com/en-US/docs/marketplace/how_to/order_integration) | **partial** | `denyOrder` sends free text only: map Food Hub reasons to `ITEM_OUT_OF_STOCK`, `STORE_CLOSED`, `POS_OFFLINE`, `CAPACITY_THROTTLING`…, add `errors[]` with the item `merchant_supplied_id` |
| Detailed errors: Other/null < 15% | [detailed error spec](https://developer.doordash.com/docs/marketplace/how_to/detailed_error_spec) | **partial** | Same change; never send a generic "error" |
| Merchant tips on pickup orders (`merchant_tip_amount`) | [general requirements](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/general_integration_requirements) | **partial** | `parseDoorDashOrder` reads `tip_amount`/`tip`: also read `merchant_tip_amount` |
| Experience flag shown to staff (DoorDash / Caviar / Storefront) | same | **missing** | Parse `experience` into the order; show it on the ticket and kitchen screen |
| `fulfillment_type` (`dx_delivery`, `pickup`, `mx_fleet_delivery`) | [API reference](https://developer.doordash.com/en-US/api/marketplace/) | **partial** | Parser uses `is_pickup`: read `fulfillment_type` first |
| Tax remitted by DoorDash (`is_tax_remitted_by_doordash`) | [order integration](https://developer.doordash.com/en-US/docs/marketplace/how_to/order_integration) | **partial** | Store the flag; use it in money reconciliation (`lib/foodhub/recon/`) |
| Order ready signal | [API reference](https://developer.doordash.com/en-US/api/marketplace/) | done | `markReady` → `PATCH …/events/order_ready_for_pickup` (check the token note in sandbox) |
| Cancellation DoorDash → us | [cancellation webhook](https://developer.doordash.com/docs/marketplace/how_to/order_cancellation_webhook) | done (code) / owner | `classifyDoorDash` kind `cancel`; DoorDash must configure it on request |
| Cancellation us → DoorDash (allowlist) | [merchant cancellation](https://developer.doordash.com/docs/marketplace/how_to/merchant_order_cancellation) | done, gated | `cancelOrder` with `DOORDASH_MERCHANT_CANCEL=true` once allowlisted |
| Dasher Status (recommended) | [Dasher status](https://developer.doordash.com/en-US/docs/marketplace/faq/dasher_status_webhook) | done | `classifyDoorDash` kind `dasher` → courier status |
| Menu push POST / PATCH full menu, `reference`, Menu Status | [menu integration](https://developer.doordash.com/en-US/docs/marketplace/how_to/menu_integration) | done | `publishMenu`, `toDoorDashMenu` (`lib/foodhub/menu/translate.ts`), menu-status handling in `webhooks/doordash.ts` |
| Menu pull `GET …/{location_id}` → `{store, menus[]}` | same | done | `app/api/foodhub/webhooks/doordash/[locationId]/route.ts` (locked stores answer 409) |
| Menu deactivate / reactivate (`active` false/true) | [general requirements](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/general_integration_requirements) | **partial** | Menu `active` is always `true`: add a menu on/off per store |
| Regular + special hours, images, alcohol flag | same | done | `open_hours`, `special_hours`, `original_image_url`, `is_alcohol` in `translate.ts` |
| Dual pricing (delivery price vs pickup price) | same | **missing** | Add a pickup price per item/option and send both prices |
| ≥ 1 menu update per store per day | same | **partial** | Scheduler is one-shot (`lib/foodhub/menu/schedule.ts`): add a daily refresh job |
| Nutrition (recommended) | same | missing (optional) | Calories exist for Uber; add to the DoorDash item |
| Item / option 86 (≤ 40 per call) | [store and item status](https://developer.doordash.com/en-US/docs/marketplace/how_to/store_and_item_status) | done | `setItemAvailability` |
| Item availability polling + reconciliation | [requirements (new)](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/integration_requirements_new) | **missing** | Sync job: `GET …/item/availability` and `…/item_option/availability`, compare with Food Hub, fix drift, log it |
| Store pause / resume (`reason`, `notes`, `end_time`) | [store and item status](https://developer.doordash.com/en-US/docs/marketplace/how_to/store_and_item_status) | done | `setStoreOnline`; note: an untimed pause ends by itself after 14 days |
| Store details read | same | done | `fetchDoorDashStoreStatus` (`store_details`) |
| Integrated promos (ingest, display, accounting) | [requirements (new)](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/integration_requirements_new) | **partial** | `doorDashDiscount` ingests merchant-funded discounts; check co-funded/stacked shapes in sandbox |
| Store onboarding: SOW (or EPM) + onboarding status webhooks | [SOW](https://developer.doordash.com/en-US/docs/marketplace/overview/onboarding/sow), [EPM](https://developer.doordash.com/docs/marketplace/overview/onboarding/epm) | **missing** | Build "Request DoorDash activation" per store: `POST /webhooks/stores/onboarding`, show statuses and exclusion codes. Not needed if DoorDash assigns an EPM |
| Virtual brands: one location_id per brand | [general requirements](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/general_integration_requirements) | done (data) / **risk** | Each brand × location has its own `merchant_supplied_id`; `VIRTUAL_BRAND_DETECTED` exclusion exists: raise it with DoorDash before onboarding |
| 429 → retry after 1 min; 500 → backoff; 400 → no retry | [menu integration](https://developer.doordash.com/en-US/docs/marketplace/how_to/menu_integration) | **missing** | `callApi` (`lib/foodhub/config.ts`) has no retry policy: add one for DoorDash |
| Accept unknown fields / 64-bit ids | [general requirements](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/general_integration_requirements) | done | Parser ignores unknown fields; unknown shapes are kept under Unparsed payloads |
| Failure-reason spreadsheet + merchant help content | same | **missing** (docs) | Write the error table (string, meaning, owner, fix) and a short merchant guide (single-merchant integrations are exempt from the public help-article rule) |
| Screen recordings of each feature; live TAM review | same / [SOW](https://developer.doordash.com/en-US/docs/marketplace/overview/onboarding/sow) | owner + dev | Record in the sandbox once the gaps above are closed |
| Pilot ≈ 20 stores, < 2% errors for 14 days; then < 1% / < 1% | [graduation](https://developer.doordash.com/en-US/docs/marketplace/faq/graduation_handbook) | **partial** | Add a DoorDash failure-rate and merchant-cancel-rate tile (28-day) to analytics |

### 1.6 DoorDash Drive (own delivery)
Rules ([Drive requirements](https://developer.doordash.com/en-US/docs/drive/overview/integration_requirements),
[about Drive](https://developer.doordash.com/en-US/docs/drive/overview/about_drive),
[pricing](https://developer.doordash.com/en-US/docs/drive/overview/pricing_payment)): limited access, apply in the
portal; production needs a DoorDash review **and a live screen-share demo of an end-to-end test delivery**, and
"approval is not guaranteed". A credit card must be on the developer account before production (charged per delivery;
monthly invoicing on request).

| Requirement | Official link | Our status | File / what to build |
|---|---|---|---|
| Apply, accept the Technology License / Terms | [Drive requirements](https://developer.doordash.com/en-US/docs/drive/overview/integration_requirements) | owner | Portal |
| Credit card on the developer account | [pricing](https://developer.doordash.com/en-US/docs/drive/overview/pricing_payment) | owner | Portal |
| Test deliveries with the Delivery Simulator | same as above | done | `DOORDASH_DRIVE_ENV=sandbox` in `lib/foodhub/delivery/doordash-drive.ts` |
| Required fields: `external_delivery_id`, `dropoff_address`, `dropoff_address_components`, `dropoff_contact_given_name`, `dropoff_phone_number` | [Drive requirements](https://developer.doordash.com/en-US/docs/drive/overview/integration_requirements) | **partial** | `driveBody` sends all but `dropoff_address_components`: add them from the parsed address (`lib/foodhub/delivery/address.ts`) |
| More than one location: pickup business and store ids (not a raw pickup address) | same | **missing** | Create Drive businesses/stores per kitchen and send their external ids |
| Restaurants: `pickup_time` or `dropoff_time` (one) | same | done | `pickup_time` |
| Tips passed 100% to DoorDash | same / [pricing](https://developer.doordash.com/en-US/docs/drive/overview/pricing_payment) | done | `tip` |
| Show DoorDash's support id and pickup time to merchant and customer | same | **partial** | Shown in the direct-order drawer; add to the customer tracking message |
| Clear message when a quote/delivery is refused; cancellation workflow | same | done | quote/cancel in `doordash-drive.ts` |
| Block restricted items (tobacco, cannabis, weapons, explosives) | same | **missing** | Refuse a Drive quote when an item carries a restricted tag |
| Alcohol: `items`, `order_contains`, `return_to_pickup`, no contactless; licence, ID-check consent, alcohol addendum | same | done (code) / owner | Code sends the flags; owner signs the addendum and adds the consent text at checkout |
| Webhooks (Basic auth) | [about Drive](https://developer.doordash.com/en-US/docs/drive/overview/about_drive) | done | `app/api/foodhub/webhooks/doordash-drive/route.ts` |

---

## 2. Uber Eats

### 2.1 Approval path
- "Access to These APIs May Require Written Approval From Uber"; prerequisites: an **NDA and an API licensing
  agreement**, and the Uber Eats partner manager's agreement
  ([introduction](https://developer.uber.com/docs/eats/introduction),
  [getting started](https://developer.uber.com/docs/eats/guides/getting-started)).
- **Sandbox:** a *Testing* app ("Eats Marketplace" suite), hosts `sandbox-login.uber.com` and `test-api.uber.com`
  (never mixed with production hosts); scopes are automatic in sandbox only; **test stores are not self-serve**, they
  come from Integration Tech Support; sandbox data resets ([sandbox](https://developer.uber.com/docs/eats/guides/sandbox)).
- **Going live** ([going live](https://developer.uber.com/docs/eats/guides/going-live)):
  1. Tech support ticket → **integration verification** (joint end-to-end test).
  2. **Production app under a separate production Uber account** (never Uber's test accounts).
  3. Ticket with the app's client_id to **whitelist the Eats scopes**, then enable them in the dashboard and set the
     production webhook URL. Different webhook URLs need different production apps.
  4. Pilot store: tell the partner manager ≥ 1 week before; provision the store to the production app; upload the
     menu; switch order integration on.
  5. Expand only after the pilot ran **≥ 3 days at ≥ 98% injection success**.
- "Sandbox access does NOT guarantee production access"; every production app is reviewed.
- **Verdict for a small in-house integrator:** yes, Uber's provisioning API has fields "for integrators who are
  themselves the merchant" (`merchant_store_id` / `partner_store_id`), so a merchant-built integration is an expected
  case; the gate is the NDA/licence and the partner manager's written approval.

### 2.2 Scopes ([authentication](https://developer.uber.com/docs/eats/guides/authentication))

| Scope | Grant | For |
|---|---|---|
| `eats.store` | client_credentials | stores and menus |
| `eats.store.status.write` | client_credentials | pause / unpause without touching menu hours |
| `eats.order` | client_credentials | accept, deny, cancel; read v1 orders |
| `eats.store.orders.read` | client_credentials | read v2 orders (our missed-order check) |
| `eats.report` | client_credentials | reports |
| `eats.pos_provisioning` | authorization_code | link and unlink stores, list a merchant's stores |
| `eats.store.status.notification` | (whitelisted) | the `store.status.changed` webhook ([webhooks](https://developer.uber.com/docs/eats/guides/webhooks)) |

Tokens last 30 days; **100 client-credential token requests per hour**, and past 100 tokens the oldest is invalidated.
Uber mentions "new scope access policies for third party applications" (privacy; undated).

### 2.3 Linking a store, and what happens to UrbanPiper
- Flow ([activation flows](https://developer.uber.com/docs/eats/guides/integration-activation-flows),
  [POS provisioning](https://developer.uber.com/docs/eats/guides/pos-provision)): merchant logs in with
  `eats.pos_provisioning` → `GET /v1/eats/stores` (match by **location**, not by `external_store_id`) →
  `POST /v1/eats/stores/{store_id}/pos_data` with the merchant token → from then on our client_credentials token works
  for that store ("perpetual access"). `PATCH …/pos_data` (`integration_enabled`) pauses or resumes; `DELETE
  …/pos_data` removes the link. Uber sends `store.provisioned` / `store.deprovisioned`.
- **Order manager:** `is_order_manager: true` nominates our app to accept, deny and cancel. "As there can only be one
  order manager, if your app is eventually promoted, any existing order manager app will be demoted"
  ([POST pos_data](https://developer.uber.com/docs/eats/references/api/v1/post-eats-stores-storeid-posdata)).
  So linking a store to Food Hub **takes the order workflow away from UrbanPiper** for that store (UrbanPiper may keep
  read access). `pos_integration_enabled` is deprecated: do not send it. Never put personal data in
  `store_configuration_data`.

### 2.4 Orders, menus, store, reports
- Webhook `orders.notification` → read the order → `POST /v1/eats/orders/{id}/accept_pos_order` or `deny_pos_order`.
  **Auto-cancel after 11.5 minutes** without accept/deny; stores set up for robocalls get a **call after 90 seconds**
  ([webhooks](https://developer.uber.com/docs/eats/guides/webhooks),
  [order integration](https://developer.uber.com/docs/eats/guides/order-integration)). Cancel:
  `POST /v1/eats/orders/{id}/cancel`. Fulfilment issues: Resolve Order Fulfillment Issue +
  `order.fulfillment_issues.resolved`.
- Menu: `PUT /v2/eats/stores/{id}/menus` **replaces** the menu; `POST …/menus/items/{item_id}` for 86 / price; images
  JPG/PNG/WEBP, 320–6000 px, < 25 MB; in alcohol markets, `dish_info.classifications` (`alcoholic_items`,
  `can_serve_alone`) on every item; `store.menu_refresh_request` webhook
  ([menu integration](https://developer.uber.com/docs/eats/guides/menu-integration)).
- Store: `GET/POST /v1/eats/store/{id}/status`, holiday hours `…/stores/{id}/holiday-hours`
  ([store integration](https://developer.uber.com/docs/eats/guides/store-integration)).
- Quality standards ([quality and performance](https://developer.uber.com/docs/eats/quality-and-performance)):
  injection success target **99.9%**, below **99%** risks revoked access or disabled stores; required: full V2 Menu
  API incl. item tax categories and store tax area id, Retrieve/Set Store Status **and Update Store Prep Time**,
  explicit accept/deny/cancel with reasons, **reject when allergens or special instructions cannot reach the POS**,
  order notification and failure webhooks, tolerate new attributes.
- Webhooks: `X-Uber-Signature` = lowercase hex HMAC-SHA256 of the raw body (client secret); answer **200 with an empty
  body**; retries on 5xx/timeouts at 10 s, then 30 s, 60 s, 120 s… up to 7 sends; one Primary Webhook URL per app.

### 2.5 Uber Eats: requirement vs our code

| Requirement | Official link | Our status | File / what to build |
|---|---|---|---|
| NDA + API licensing agreement + partner-manager approval | [getting started](https://developer.uber.com/docs/eats/guides/getting-started) | owner | — |
| Sandbox app + test store from Integration Tech Support | [sandbox](https://developer.uber.com/docs/eats/guides/sandbox) | done (code) / owner | `UBER_ENV=sandbox` in `lib/foodhub/adapters/uber-eats.ts` |
| Integration verification ticket | [going live](https://developer.uber.com/docs/eats/guides/going-live) | owner | — |
| Production app on a separate production account; scope whitelist ticket | same | owner | Code falls back to `eats.order eats.store` while `eats.store.status.write` is not granted |
| Token cache (30 days, 100/h) | [authentication](https://developer.uber.com/docs/eats/guides/authentication) | done | `fetchClientToken` (memory + database) |
| Merchant OAuth (`eats.pos_provisioning`) | [activation flows](https://developer.uber.com/docs/eats/guides/integration-activation-flows) | **partial** | Uber's guide shows `login.uber.com/oauth/v2/authorize`; we default to `auth.uber.com/oauth/v2/authorize`. Test once in production; `UBER_LOGIN_URL` switches it without code |
| List stores, match by location | same | done | `listUberStorePages`, `suggestMapping` (`uber-provision.ts`) |
| `POST pos_data` (integrator ids, `is_order_manager`), no deprecated field | [POST pos_data](https://developer.uber.com/docs/eats/references/api/v1/post-eats-stores-storeid-posdata) | done | `uberPosDataBody`, `activateUberStores` |
| `PATCH pos_data` `integration_enabled` | [POS provisioning](https://developer.uber.com/docs/eats/guides/pos-provision) | done | `enableUberIntegration` |
| `DELETE pos_data` (clean unlink) | same | **missing** | Add "Disconnect from Uber" (merchant token) for offboarding a store |
| `store.provisioned` / `store.deprovisioned` | [webhooks](https://developer.uber.com/docs/eats/guides/webhooks) | done | `lib/foodhub/adapters/uber-events.ts` |
| Signature, 200 empty body, retries, event dedupe | same | done | `verifyWebhook` (signing key or client secret), `app/api/foodhub/webhooks/uber-eats/route.ts`, inbox keyed on `event_id` |
| Accept / deny within 11.5 min; robocall at 90 s | same | done / **watch** | Accept after Clover has the order; a slow Clover call past 90 s rings the store: keep Clover under a few seconds, alert above 60 s |
| Deny with reason codes | [order integration](https://developer.uber.com/docs/eats/guides/order-integration) | done | `denyOrder` with `DENY_CODES` |
| Reject if allergens / special instructions cannot reach the POS | [quality](https://developer.uber.com/docs/eats/quality-and-performance) | done (check) | Order and line notes go to the Clover ticket (`lib/foodhub/pos/clover-order.ts`); confirm allergen field mapping on a test order |
| Cancel accepted orders | [order integration](https://developer.uber.com/docs/eats/guides/order-integration) | done | `cancelOrder` |
| `orders.cancel` / `orders.failure`, `orders.customer_order_edit` | [webhooks](https://developer.uber.com/docs/eats/guides/webhooks), [change log](https://developer.uber.com/docs/eats/api-change-log) | done | `uber-events.ts` |
| Resolve Order Fulfillment Issue (recommended) | [order integration](https://developer.uber.com/docs/eats/guides/order-integration) | missing (optional) | Out-of-stock item → propose removal to the customer instead of cancelling |
| Missed-order check (`created-orders`) | same | done | `listUberCreatedOrders` |
| Menu PUT (V2), item update, images, `store.menu_refresh_request` | [menu integration](https://developer.uber.com/docs/eats/guides/menu-integration) | done | `publishMenu`, `toUberMenu`, `uber-events.ts` |
| Item tax categories + store tax area id | [quality](https://developer.uber.com/docs/eats/quality-and-performance) | **partial** | `tax_info` sent empty; ask Uber which tax fields Québec stores need |
| Alcohol classifications (`alcoholic_items`, `can_serve_alone`) | [menu integration](https://developer.uber.com/docs/eats/guides/menu-integration) | **missing** | Needed only if alcohol is sold on Uber: map the alcohol tag in `toUberMenu` |
| Store status get/set, `store.status.changed`, holiday hours | [store integration](https://developer.uber.com/docs/eats/guides/store-integration) | done | `setStoreOnline`, `fetchUberStoreStatus`, holiday hours in `publishMenu` |
| Update Store Prep Time (listed as required) | [quality](https://developer.uber.com/docs/eats/quality-and-performance) | **partial** | We send `pickup_time` on each accept; no store-level prep-time call. Its path is not in the public guides we could read: ask Uber during verification |
| Reports (`eats.report`) | [authentication](https://developer.uber.com/docs/eats/guides/authentication) | done | `requestUberReport`, report webhook |
| Pilot 3 days ≥ 98%; then ≥ 99% (target 99.9%) | [going live](https://developer.uber.com/docs/eats/guides/going-live), [quality](https://developer.uber.com/docs/eats/quality-and-performance) | **partial** | Add an "injection success, 7 days" tile per store |
| Newer Order API Suite (webhook version "1.0") | [change log](https://developer.uber.com/docs/eats/api-change-log) | not needed now | We use the documented "previous version" endpoints on purpose (`uberPosDataBody` leaves `webhooks_version` unset). Plan a migration only if Uber asks |

---

## 3. SkipTheDishes / Just Eat Takeaway (JET Connect)

### 3.1 What the official specification says
JET publishes one OpenAPI document for all its brands ([JET API spec](https://uk.api.just-eat.io/docs/openapi.yaml),
portal [developers.just-eat.com](https://developers.just-eat.com/)). It names **Skip The Dishes** explicitly: "The JET
Connect Platform API allows anyone with a Just Eat, Skip The Dishes, Menulog or Takeaway account to automatically
publish menus from their POS". The spec has a "JET Connect for Skip" group and lists "Integration enquiries" on
developers.just-eat.com as the contact. Access needs an integrator API key (`X-Flyt-Api-Key`) issued by JET.

| JET Connect operation | Direction | Rule |
|---|---|---|
| Receive Order (`POST` to our endpoint) | JET → us | Required fields: `id`, `third_party_order_reference`, `type`, `posLocationId`, `location`, `menu_reference`, `items`, `created_at`, `channel`, `payment_method`, `payment`, `promotions`, `extras`, `tender_type`, `total`. Answer **200** (taken), **202** (async), or non-2xx (sent to the tablet to be keyed by hand). Optional static source IP on request |
| `POST /order/{id}/sent-to-pos-success` / `-failed` | us → JET | After a 202, within **5 minutes**, or the order becomes "failed to inject"; send `transmissionId` when several transmissions exist |
| `X-JET-Connect-Hash` | JET → us | `HMAC-SHA256 t=<ms>,signature=<base64 HMAC-SHA256(secret, body)>`; optional `Authorization` = our API key |
| Cancel, Driver Status, Restaurant Temporarily Offline, Failed Order (backup flow) | JET → us | Notifications to our endpoints |
| `POST /menus` (with `callback_url`), `POST /item-availability` | us → JET | 202; visible "within less than 5 minutes"; menu callbacks per restaurant |
| `PUT /restaurants/{ref}/online` / `offline` | us → JET | Restaurant availability |
| `PUT /restaurants/{ref}/servicetimes` | us → JET | Opening times (the text names Just Eat / Menulog) |
| `POST /orders/{id}/modification` | us → JET | Out-of-stock / substituted items |
| **Partner Onboarding (new, 2026 examples):** `POST /partners/{market}/locations/onboard`, `PUT /partners/onboarding/{sessionId}/configuration`, `POST /partners/locations/{ref}/go-live`, onboarding notification webhook | both | Integrator claims a JET location with its API key. **409** when "it is already live on JET (switching is not yet supported), or it is already being onboarded by another integrator". Notifications signed `X-Webhook-Signature: sha256=<hex HMAC(timestamp + "\n" + body)>`, reject timestamps older than 5 min; best-effort, not retried. Market examples are UK, IE: Canada to confirm |

The same spec also documents a **Skip delivery-as-a-service** API (create, estimate, cancel deliveries; some features
"only available in the CA market"): a possible Canadian alternative to Drive for our own orders, not researched further.

**Verdict for a small in-house integrator:** possible but not self-serve: JET issues the key under a commercial
agreement, and the approval criteria are not published. The new onboarding API shows JET moving to integrator
self-service, but a store already live with another integrator cannot be switched through it yet.

### 3.2 Skip: requirement vs our code

| Requirement | Official link | Our status | File / what to build |
|---|---|---|---|
| JET Connect access + API key (commercial agreement) | [developers.just-eat.com](https://developers.just-eat.com/) | owner | Env `SKIP_JET_API_KEY` |
| Base URL `https://api.flytplatform.com`, header `X-Flyt-Api-Key` | [JET API spec](https://uk.api.just-eat.io/docs/openapi.yaml) | done | `lib/foodhub/adapters/skip.ts` |
| Receive Order → 202, then sent-to-pos-success / failed within 5 min | same | done | `app/api/foodhub/webhooks/skip/orders/route.ts`, `acceptOrder` / `denyOrder`; deadline 5 min in `deadline.ts` |
| `transmission_id` echo | same | done | `transmission()` in `skip.ts` |
| `X-JET-Connect-Hash` check (and optional API key) | same | done | `verifyJetHash`; checked against JET's own example (secret `key`, body `example` gives the documented hash) |
| Cancel / driver / temp-offline / failed-order notifications | same | done | `app/api/foodhub/webhooks/skip/{cancel,driver,offline,failed}/route.ts` |
| Menu ingest with callback, item availability | same | done | `publishMenu` (`toSkipMenu`), `setItemAvailability`, `…/skip/menu-status/route.ts` |
| Restaurant online / offline | same | done | `setStoreOnline` |
| Out-of-stock modification | same | done | `reportSkipMissingItems` |
| Service times | same | missing (low) | Add only if Skip confirms it applies in Canada; hours already ride with the menu availabilities |
| Partner Onboarding API + notification webhook | same | **missing** | Build when JET gives the key and confirms the Canadian market code: onboard, configuration, go-live, signed notification route |
| Merchant cancel / order ready | same | n/a | JET Connect has neither (adapter answers "blocked" / "skipped" honestly) |

---

## 4. How UrbanPiper-style integrators connect (and how a store moves to us)

| Platform | Integrator model | Moving a store from UrbanPiper to Food Hub |
|---|---|---|
| DoorDash | Certified middleware; must offer SSIO (OAuth by the store's Business Admin, warning that activation **breaks existing integrations**) | The store gets our `provider_type` through SOW, the EPM, or a POS integration request in the Merchant Portal; one POS provider per store at a time |
| Uber Eats | An app with `eats.pos_provisioning` that POSTs `pos_data` with `is_order_manager: true` (or Uber pre-integrates it) | Our "Connect Uber Eats" makes Food Hub the order manager; Uber **demotes** the previous one. No need to wait for UrbanPiper, but stop it first to avoid confusion on the tablet |
| Skip (JET) | Integrator API key; JET maps each restaurant to a `posLocationId`; now also the Partner Onboarding API | Self-onboarding returns **409** while the store is live with another integrator: UrbanPiper must release it, then Skip/JET re-points it to our key |

---

## 5. Recent changes (2025–2026)

- **DoorDash:** the integrations programme for 2027 has four tiers (Certified, Marketplace Preferred, OmniChannel
  Preferred, Platinum). Dates: OmniChannel specs published **2026-10-30**; Certified + Marketplace Preferred features
  and OmniChannel terms due **2027-04-01**; OmniChannel certified by **2027-10-01**. Quality: < 1% POS errors and < 1%
  merchant cancels on a rolling 28 days, 6 weeks to recover. New requirements: item-availability polling, integrated
  promos, detailed errors, cart validation. Onboarding was reorganised (SSIO for middleware, SOW for single merchants,
  EPM "soft launch" spec v1.0). The public release-notes page has no entry after February 2024; the changes live in
  the requirement pages ([preferred integrations](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/preferred_integrations_new),
  [requirements (new)](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/integration_requirements_new)).
- **Uber Eats** ([change log](https://developer.uber.com/docs/eats/api-change-log)): 2025-05-30 GetOrder payments fix;
  2025-07-15 promotion funding split in GetOrder; 2025-08-21 CancelOrder payload (`cancellation_reason` object);
  2025-10-22 `order_pickup_instructions` on AcceptOrder; 2026-01-07 `in_store_price` in menus; 2026-02-05 replacement
  recommendations (retail); 2026-04-17 ValidateItemFulfillment; **2026-07-02 `orders.customer_order_edit` webhook**
  (already handled). Plus "new scope access policies for third party applications" (undated).
- **JET Connect:** the **Partner Onboarding API** (examples dated May 2026) lets an integrator claim and activate
  locations itself; switching a live store between integrators is "not yet supported".

---

## 6. Gap list for developers, in priority order

| # | Platform | Build | Why |
|---|---|---|---|
| 1 | DoorDash | `User-Agent: <ProviderType>/1.0` header | Required on every call; cheap |
| 2 | DoorDash | Reject with DoorDash failure codes + item-level `errors[]` | Certification + < 15% "Other" rule |
| 3 | DoorDash | Parse `experience`, `fulfillment_type`, `merchant_tip_amount`, `is_tax_remitted_by_doordash`; show experience on the ticket | Certification items |
| 4 | DoorDash | Menu on/off (`active`), dual pricing (pickup price), daily menu refresh | Certification items |
| 5 | DoorDash | Item-availability polling + reconciliation job | New required item |
| 6 | DoorDash | Retry policy: 429 after 1 min, 500 backoff, 400 never | Documented behaviour |
| 7 | DoorDash | SOW sender + onboarding-status screen (skip if an EPM is assigned) | Store activation |
| 8 | DoorDash | Error-reason table + short merchant guide; failure-rate and cancel-rate tile | Graduation surveys, quality bar |
| 9 | Uber | Ask Uber for the store prep-time call and the Québec tax fields; add alcohol classifications if alcohol is sold on Uber | Quality standards |
| 10 | Uber | "Disconnect from Uber" (`DELETE pos_data`); injection-success tile; alert when an accept takes > 60 s | Offboarding, pilot metric, robocall at 90 s |
| 11 | Drive | `dropoff_address_components`, Drive business/store ids per kitchen, restricted-item block, support id in the customer message | Drive production review |
| 12 | Skip | Partner Onboarding API + signed notification route (once JET confirms Canada) | New JET onboarding |

None of these touch the locked store: its menu lock stays in force for every path (publish, 86, menu pull).

---

## 7. Sources (all official)

- DoorDash Marketplace: [about](https://developer.doordash.com/en-US/docs/marketplace/overview/about_marketplace) ·
  [requesting access](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/requesting_access) ·
  [middleware vs merchants](https://developer.doordash.com/en-US/docs/marketplace/overview/middleware_vs_merchants) ·
  [general requirements](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/general_integration_requirements) ·
  [requirements (new)](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/integration_requirements_new) ·
  [preferred integrations](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/preferred_integrations_new) ·
  [production access](https://developer.doordash.com/docs/marketplace/how_to/production_access) ·
  [graduation handbook](https://developer.doordash.com/en-US/docs/marketplace/faq/graduation_handbook) ·
  [SOW](https://developer.doordash.com/en-US/docs/marketplace/overview/onboarding/sow) ·
  [EPM](https://developer.doordash.com/docs/marketplace/overview/onboarding/epm) ·
  [SSIO](https://developer.doordash.com/en-US/docs/marketplace/how_to/setup_ssio) ·
  [JWTs](https://developer.doordash.com/en-US/docs/marketplace/how_to/JWTs) ·
  [order integration](https://developer.doordash.com/en-US/docs/marketplace/how_to/order_integration) ·
  [menu integration](https://developer.doordash.com/en-US/docs/marketplace/how_to/menu_integration) ·
  [store and item status](https://developer.doordash.com/en-US/docs/marketplace/how_to/store_and_item_status) ·
  [webhook subscriptions](https://developer.doordash.com/docs/marketplace/how_to/create_webhook_subscription) ·
  [cancellation webhook](https://developer.doordash.com/docs/marketplace/how_to/order_cancellation_webhook) ·
  [merchant cancellation](https://developer.doordash.com/docs/marketplace/how_to/merchant_order_cancellation) ·
  [detailed error spec](https://developer.doordash.com/docs/marketplace/how_to/detailed_error_spec) ·
  [Dasher status](https://developer.doordash.com/en-US/docs/marketplace/faq/dasher_status_webhook) ·
  [FAQ](https://developer.doordash.com/en-US/docs/marketplace/faq/getting_started) ·
  [create provider](https://developer.doordash.com/docs/marketplace/overview/getting_started/create_provider_getting_started) ·
  [test store](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/create_test_store_getting_started) ·
  [validate test order](https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/validate_test_order) ·
  [API reference](https://developer.doordash.com/en-US/api/marketplace/) ·
  [release notes](https://developer.doordash.com/en-US/docs/marketplace/overview/release_notes)
- DoorDash Drive: [about](https://developer.doordash.com/en-US/docs/drive/overview/about_drive) ·
  [integration requirements](https://developer.doordash.com/en-US/docs/drive/overview/integration_requirements) ·
  [pricing and payment](https://developer.doordash.com/en-US/docs/drive/overview/pricing_payment)
- Uber Eats: [introduction](https://developer.uber.com/docs/eats/introduction) ·
  [getting started](https://developer.uber.com/docs/eats/guides/getting-started) ·
  [sandbox](https://developer.uber.com/docs/eats/guides/sandbox) ·
  [authentication](https://developer.uber.com/docs/eats/guides/authentication) ·
  [webhooks](https://developer.uber.com/docs/eats/guides/webhooks) ·
  [activation flows](https://developer.uber.com/docs/eats/guides/integration-activation-flows) ·
  [POS provisioning](https://developer.uber.com/docs/eats/guides/pos-provision) ·
  [POST pos_data](https://developer.uber.com/docs/eats/references/api/v1/post-eats-stores-storeid-posdata) ·
  [order integration](https://developer.uber.com/docs/eats/guides/order-integration) ·
  [menu integration](https://developer.uber.com/docs/eats/guides/menu-integration) ·
  [store integration](https://developer.uber.com/docs/eats/guides/store-integration) ·
  [going live](https://developer.uber.com/docs/eats/guides/going-live) ·
  [quality and performance](https://developer.uber.com/docs/eats/quality-and-performance) ·
  [change log](https://developer.uber.com/docs/eats/api-change-log)
- Just Eat Takeaway / SkipTheDishes: [developers.just-eat.com](https://developers.just-eat.com/) ·
  [JET API OpenAPI spec (JET Connect operations)](https://uk.api.just-eat.io/docs/openapi.yaml)
