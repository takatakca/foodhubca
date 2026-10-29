# Food Hub: progress log and task board

## 2026-10-29 (22 h) — Registre de tout le travail + ordres permanents du propriétaire (`claude/busy-cannon-5spy86`)

- `docs/REGISTRE_TAKATAK.md` : les dépôts publics `takatakca`, l'historique complet (PR fusionnées, signatures) de ceux
  qui sont lisibles ici depuis leur premier commit, ce que la session busy-cannon a fait et comment, et les PR encore
  ouvertes avec quoi en faire. La version complète (dépôts privés compris) est seulement dans Google Drive
  « 00 — Opérations TAKATAK ».
- `CLAUDE.md` + gabarit de PR : ordres du propriétaire du 2026-10-29 (notes instantanées signées, travail toujours
  poussé, chaque agent fusionne sa PR quand les vérifications sont vertes, Copilot quand il aide, notes GitHub + Drive).
- Fusionnées après une fusion à blanc testée (typecheck, 1663 tests, build, verify 578/0) : #106, #52, #48, #45.

— signé : Claude (busy-cannon, Claude Code cloud) · 2026-10-29 22:55

## 2026-10-29 — Order screens rescue, lane A: one device rings for every platform screen (`claude/busy-cannon-5spy86`)

- Problem: DoorDash / Uber Eats tablets drop their Wi-Fi or sign-in; the platforms pause, then deactivate the stores. Plan and lanes: `docs/ORDER_SCREENS_RESCUE.md` (lane A Food Hub side, lane B relay kit by a second agent, lane C the owner's portal steps; agents coordinate on board #105).
- **Screens wall** (Stores → Platform screens): 1, 2, 4, 8, 12 or 16 screens at a time (pages beyond), tabs, or a custom board (drag anywhere, resize from the corner, arrow keys); drag a title bar onto another to swap; double-click to make big; full screen; saved per device (`lib/ui/screens-layout.ts`). **Set up screens** creates `s01`… (so many DoorDash / Uber Eats / Skip), each sent to its platform's sign-in page by the new `open` command (allowed hosts only); switching a tile's channel does the same. Orders → Clover strip above the wall.
- Stores → Platform screens → **Ring on this device**: the screens wall rings while orders wait on any online screen and when a screen drops, stays awake, refreshes every 10 s (`lib/ui/screens-ring.ts`).
- Watchtower **`screen_waiting`**: orders unanswered on a screen past the "order waiting" delay during opening hours → critical incident (beep → SMS → call → owner).
- Heartbeat v2 (`mode` web|android, `app`, `waiting`), `waitingSince`, store numbers per screen with protected stores (Po Poulet NDG 27982486) marked "never act". Tests: `tests/platform-screens.test.ts`.

## 2026-10-29 — TAKATAK Suite premium: directory, one frame for the nine apps (`claude/busy-cannon-5spy86`)

- Food Hub keeps the suite directory (`lib/foodhub/suite/directory.ts`): each app announces `<app>.installed` (with its https address) or `<app>.uninstalled` per Clover merchant through `/api/suite/v1/events`; any connected app reads `GET /api/suite/v1/directory?merchant=` (signed) for its Suite page and app switcher. Settings → Connected apps shows how many restaurants have each app.
- The nine app repos (PR #1 each) got the same premium frame: side menu with sub-menus, My account (Profile, Plan and billing, Authorized actions, Devices, Payments and deposits, Security and data, Activity log), TAKATAK Suite page, Help; Clover roles in the session, authorized actions checked on the server with an activity log; a crash in yesterday's forms fixed (found by a browser walk-through).
- Review of the whole suite and what to simplify next: `docs/TAKATAK_SUITE_PLAYBOOK.md`. Tests: `tests/takatak-suite.test.ts` (directory).
- Security: CI's production audit started failing on new advisories (next 16.0.0–16.4.0 critical RCE, zod < 4.6.6 high), on `main` too. Upgraded next / eslint-config-next to 16.4.3 and zod to 4.6.7; `npm audit --omit=dev --audit-level=high` passes (2 moderate nodemailer findings left: the only fix is a forced `mailparser` major change, owner decision).

## 2026-10-28 — TAKATAK Suite: Food Hub side of the nine Clover apps (`claude/busy-cannon-5spy86`)

- The nine Clover App Market repos with a "4" (C4ISSE, T4CTILE, 4CCOUNTING, TR4CKER, ST4FF, M4RKETING, LOY4LTY, REW4RD, CH4T) exist but are empty. Contract for building them as one SaaS of independent apps: `docs/TAKATAK_SUITE.md`.
- Food Hub side built: `lib/foodhub/suite/*` (registry from `FOODHUB_SUITE_<APP>_URL` / `_SECRET`, HMAC signatures both ways, order change watch → outbox → signed delivery with backoff, app → app events), routes `/api/suite/v1/{ping,orders,events}` (public in proxy, signed per app), Settings → Connected apps. Reads orders only; no customer name/phone/email/address leaves Food Hub; optional one-way `customerKey` (`FOODHUB_SUITE_CUSTOMER_SALT`). Off until an app is connected.
- Tests `tests/takatak-suite.test.ts`.

## 2026-10-28 — Platform screens: Uber Eats / DoorDash order screens inside Food Hub (`claude/busy-cannon-5spy86`)

- Stores → « Écrans des plateformes / Platform screens »: each platform account runs in an always-on Chromium on a screen relay host (`deploy/screens/`), shown live in Food Hub with status, waiting count from the page title, Reload and full screen. The owner signs in once inside each screen; Food Hub never stores or types a platform password.
- Relay agent heartbeat `POST /api/foodhub/screens/heartbeat` (public, Bearer `FOODHUB_SCREENS_AGENT_TOKEN`, off until set); blank / crashed pages reloaded by the agent; Watchtower rule `screen_down` (offline, signed out or crashed during opening hours). The agent never clicks or reads orders (platform terms): orders keep entering through the integrations and the Order Relay.
- Guide `docs/PLATFORM_SCREENS.md`; tests `tests/platform-screens.test.ts`.

## 2026-10-21 — Simpler sign-in page + « Continuer avec Google » (`feature/login-google-signin`)

- One calm sign-in screen: Food Hub mark, big « Continuer avec Google / Continue with Google » (only when `GOOGLE_OAUTH_CLIENT_ID` is set), the code-by-email/text sign-in as the second option, the owner recovery behind a small link; FR first, EN; 44 px targets; first run, code and recovery steps kept.
- Google Sign-In server side (`lib/foodhub/identity/google.ts`): `/api/auth/google/start` (OAuth 2.0 URL, scope openid email profile, state + PKCE S256 + nonce in an httpOnly Secure SameSite=Lax cookie, 10 min) and `/api/auth/google/callback` (code exchange at oauth2.googleapis.com, id_token verified against Google JWKS with a one-hour cache: RS256 signature, iss, aud, exp, nonce, email_verified). Signs in only an active team member whose email is already known, through the same `sessionCookieFor` as the code sign-in (session kind `google`); otherwise the friendly « pas encore dans une équipe » notice. Never creates anyone; per-address throttle and activity log like the other sign-ins.
- Tests `tests/google-signin.test.ts` (fake JWKS; bad signature / issuer / audience / expiry / nonce / alg none; state, cookie and nonce mismatches; unknown, deactivated and unverified emails refused; known email signed in; lock after repeated failures). Owner guide `docs/GOOGLE_SIGNIN.md` + `.env.example` lines.
## 2026-10-17 — Client dashboard (PR #72) brought up to main 6381aec

- `feature/client-dashboard-easy` merged with `origin/main` (#61 to #80). Conflicts: `components/ui/overlay.tsx` (main's
  focus trap and dialog stack kept; the PR's 44 px Modal close and the light-sheet hooks `useEscape` / `useDialogFocus`
  for the phone's "Plus" sheet added back, quiet while a Modal or Drawer is open) and this file (both entries kept).
- Main's own merge of #80 left a broken `lib/foodhub/legal.ts` (two `phoneFeesText`, typecheck and build fail) and stale
  expectations in `tests/legal-pages.test.ts`: both restored to #79's version (4e592e0).
- `FOODHUB_TENANT_ID`: new `isOwnerTenant()` fails closed on a set-but-invalid value (console warning, no crash, owner's
  store list hidden). See `docs/CLIENT_DASHBOARD.md` § 21.
- Checks: typecheck OK, lint 0 errors, 1531 tests passed + 1 skipped, webpack build OK, verify:foodhub 567/0.

## 2026-10-17 — ON2GO.ca hub pages on main (replaces PR #70, `feature/seo-hub-pages-main`)

- PR #70 (`feature/seo-hub-landing`, based on the old `fix/legal-pages-complete`) merged onto main as a new branch: /hub + /en/hub pages, JSON-LD, robots.txt, sitemap.xml, llms.txt, share images, favicon; #77 legal wording (it only reached the legal branch) comes along. Conflicts only in WORKLOG.md and this file (both sides kept).
- Owner's SEO decisions of 2026-10-17: hub name ON2GO.ca; both apps submitted, so "under review by Clover" by default (`FOODHUB_APP_MARKET_STATUS=soon` to go back) and no "planned" price; one statement "14-day free trial, then CAD $50/month per app" + Food Hub extra brand CAD $15 per platform per month + Phone AI CAD $0.25 per AI minute (`lib/foodhub/pricing.ts`, Food Hub numbers re-exported from `pos/clover-pricing.ts`, phone checked against `PHONE_PRICE`); AI phone page = TAKATAK Phone AI (automated assistant, press 0, how minutes are counted); legal pages name TAKATAK Phone AI; email only from `FOODHUB_SUPPORT_EMAIL`; no hours on these pages.
- Fits main: #78 badges on the hub pages (and `NEXT_PUBLIC_CLOVER_APPS_LIVE=foodhub` links the listing / publishes the Offer); #75 storefront `/commander/<slug>` and its sitemap stay indexable (no X-Robots-Tag), tracking pages stay noindex, robots.txt lists both sitemaps.
- Also fixed two merge leftovers already on origin/main: duplicate imports in `lib/foodhub/phone/voice.ts` (main failed typecheck / build and 6 phone test files) and the doubled token sentence in `lib/foodhub/clover-listing.ts`.
- Checks: typecheck OK, lint 0 errors, 1500 tests (1 skipped; 1 storefront-checkout failure also on origin/main), webpack build OK, verify:foodhub 567/0, built app on :4941: 12 hub pages 200 signed out with one parseable JSON-LD graph each, robots / sitemap / llms.txt OK.
## 2026-10-17 — Legal pages name and price TAKATAK Phone AI (`fix/legal-takatak-phone-ai`, re-land of #77)

- #77 (2e18d23) merged into `fix/legal-pages-complete` after #66, so it never reached main; cherry-picked here, product renamed « TAKATAK Phone AI » (FR + EN), `phoneFeesText()` aligned with the merged metering (AI time only, order or not, rounded up per call, never the hold or the person after a transfer, ACTIVE subscriptions only).

## 2026-10-16 — accessible horizontal tab keyboard navigation

Branche `fix/console-tabs-keyboard-20261016`. Roving `tabIndex`, sélection et focus par ArrowLeft/ArrowRight, Home/End avec bouclage, cas de bord testés, aucune mutation métier. PR et CI à vérifier, pas de déploiement. La PR #62 cible séparément le focus des dialogues.

## 2026-10-16 — Modal/drawer keyboard accessibility

Branche `fix/overlay-keyboard-focus-20261016` : focus initial, Tab/Shift+Tab circulaires, gestion Échap uniquement en haut de la pile, restitution du focus précédent, scroll-lock de fenêtres imbriquées, noms et descriptions ARIA ; tests unitaires de la pile et de navigation clavier. Aucun changement de données, de fournisseurs, de déploiement ni de `main`. PR, CI, image et essai navigateur à vérifier au SHA final.

## 2026-10-17 — Commander direct / ON2GO storefront (task 44a, `feature/on2go-storefront`)

- Commission-free pickup ordering page per brand at `/commander/<slug>` (FR first, EN with `?lang=en`): live menu of the brand's kitchen (86s, no alcohol, category hours, unpriced dishes hidden), server-priced cart, Duo / Trio / Combo offered once, pay online (Clover Hosted Checkout link opened in the browser) or at the counter, tracking page, SEO (JSON-LD, sitemap), QR / share kit, owner settings at `/settings/storefront`. Orders enter the existing direct-order pipeline as website orders (`sf_` ref). Everything off until the owner turns it on.
- Review fixes: check-and-take rate limits (address, phone, page, server; parallel-safe, given back when no order is placed), Canada / US phones only (no international or premium texts), unpaid orders capped (25 items, per-brand max 150 $ by default, 40 / h per page, 120 / h per server), last-order cutoff (prep time before closing), same-origin checkout (JSON only, Origin / Sec-Fetch-Site), body streamed and cut at 32 KB, tracking links 7 days and only under their brand, orders by source read from real orders, localized dialog / stepper labels and focus trap.
- Checks: typecheck OK, lint 0 errors, 1004 tests passed / 1 skipped / 1 known tgtg-email failure (not in this branch), webpack build OK, verify:foodhub 554/0 (ports 5910/5911). Not deployed.
## 2026-10-16 — Store availability center (task 44b, `feature/store-availability-center`)

- New page `/stores/availability` (URL only; `/stores`, `/stores/hours` and `stores-tabs.tsx` untouched): status now per kitchen / brand / channel with who paused it (TAKATAK, platform, guard, hours), reopens-at (overnight, holidays, DST), tablets online, and a Clover Online Ordering reminder row (no Clover call; no official pause endpoint found in the Clover docs).
- Status history from the activity log (pause, resume, platform_*, busy, prep, holiday, guard, reopen_failed) with reason and ok / blocked / failed, CSV export. No downtime % (analytics.ts / ops-quality do it).
- Busy schedule per kitchen (`busy_schedule_v1`): busy mode on at a window start (normal + extra, Uber prep push live-gated), back at the end only if the last prep change is still the schedule's; a person's change wins.
- Tablet-off guard (`downtime_guard_v1`, OFF by default): all tablets off for N min during open hours → timed pause of the chosen channels, re-extended every pauseMin/2, resumes only its own pauses; never relay, do-not-touch or FORBIDDEN_STORE_IDS stores; blocked results shown as not sent.
- Special days (Halloween, Remembrance Day, Christmas Eve, Boxing Day, New Year's Eve, Valentine's, Mother's / Father's Day) saved as holidays; publish from /stores/hours.
- Additive wiring: `tickAvailability` (throttled 30 s, never throws) in cron/watch (new `availability` key), pulse after(), instrumentation timer. Docs: docs/STORE_AVAILABILITY.md.
- Review fixes: the guard keeps one episode (`attemptedIds`, `pendingIds`): a store a person resumed is never re-paused in the same episode, a brand opening mid-episode is paused after its own grace time, only blocked / failed stores are retried; every locked DoorDash store (built in, `FOODHUB_MENU_LOCKED_STORES`, Stores → Mapping) is left alone; busy-schedule catch-up and removal documented and tested; bilingual route errors (`errorFr`), labelled chip groups, actor names in FR/EN; new `tests/store-availability-history.test.ts`. Shared file: `components/ui/form.tsx` (additive `disabled` prop on `Chips`).
- Later, in stores-tabs.tsx: `{ href: '/stores/availability', label: t('Disponibilité', 'Availability') }`.
## 2026-10-17 — TAKATAK Phone gate: review fixes (task 41, PR #61)

- Own merchants: `CLOVER_MERCHANT_ID`, `CLOVER_MERCHANT_TOKENS` keys and `FOODHUB_BILLING_EXEMPT_MERCHANTS` count as ours (not only `PHONE_OWN_MERCHANTS`); readiness shows a per-kitchen app check (stop when refused); refused live calls are logged.
- Never dropped: a line with no hand-off number and no kitchen phone rings ON2GO's person, else ON2GO voicemail; an unanswered hand-off goes to voicemail (`ivr/engine.ts` `directLineFallback`).
- Live call + check failed (database) fails open; setup still refuses. ON2GO "place an order" gives Clover 1 s (`ORDERING_GATE_BUDGET_MS`). Setup: kitchens keyed by line + location (reordering brands never re-checks), "changes not saved; the line stays as it was" for a line already on, and a line mixing our kitchens with a client's is refused.

## 2026-10-17 — TAKATAK Phone: the app check wired into the phone module (task 41, PR #61)

- New `lib/foodhub/phone/gate.ts` (`kitchenPhoneGate` / `linePhoneGate`): `voiceAiEntitled` for the kitchen's own Clover merchant. Live call (`startCall`): refused = handed to the line's person (hand-off number, else kitchen phone), never hung up, no AI minute. ON2GO menu "place an order": refused = a person / voicemail. Pay link (`phonePaymentPlan`): refused = counter / call back. Switching a line on (`savePhoneSettings`): strict, FR / EN reason, nothing saved.
- Unchanged without `CLOVER_PHONE_APP_ID` (nothing checked) and for `PHONE_OWN_MERCHANTS` or a kitchen with no Clover merchant of its own. ON2GO `ivr/[step]` 204 answers fixed (`new Response(null, { status: 204 })`). Tests: `tests/phone-app-gate.test.ts`, plus cases in `ivr.test.ts` and `ai-phone-paylink.test.ts`.

## 2026-10-17 — TAKATAK Phone: review round 3 fixes (task 41, PR #61)

- AI minutes stop at the hand-off even when a slow AI turn finishes later: the AI-end time is also kept outside the call record (`markAiEnded`, atomic insert) and a late turn never writes its older copy back.
- Phone minutes: every change out of "pending" is claimed (attempt owner + POST claim), so a stale copy can never turn "reported" back into "pending" (no double charge); a "sending" left behind becomes "uncertain" and is logged once; settle runs oldest first with a send budget (waiting minutes are free), so one unreachable merchant never starves others; `no_metered_id` calls are a warning in Settings.
- Low-credit alert: one key per provider, open saved before the claim (a failed write never silences it), re-sent at most every 10 min until a channel delivers, Anthropic recovery checked on every successful AI request, and lines with no hand-off number are named ("no fallback: calls are hung up").

## 2026-10-17 — TAKATAK Phone: per-minute pricing, low-credit alert (task 41, PR #61)

- Owner decision: the voice AI Clover app is **TAKATAK Phone**; 14-day free trial, then CAD $50/month + a Clover metered charge of CAD $0.25 per minute the AI is on the line (order or not). Per-order metering removed (`recordPhoneOrder`, allowance, tiers, `CLOVER_PHONE_METERED_ORDER_ID`, `CLOVER_PHONE_PRO_SUBSCRIPTION_IDS`).
- New `lib/foodhub/pos/clover-phone-minutes.ts` (ceil(AI seconds / 60), ACTIVE merchants only, once per call SID via `repo.claimKv` (same as PR #69), saved before sending, uncertain never re-sent, definite pre-send failures retried 3×, dry run unless `FOODHUB_PHONE_METERED_ENABLED=true`), `lib/foodhub/phone/metering.ts` (status callback → kitchen's own merchant), AI start/stop marks on the call (`aiStartedAt` / `aiEndedAt`), settle every 10 min in the expansion tick, Settings → Clover app "Per-minute billing" dry-run preview.
- New `lib/foodhub/phone/credit-alert.ts`: one owner alert per low-credit incident (Anthropic via the breaker, Twilio via texts / calls), re-armed on recovery. Voice status route now answers a real 204.
- Env names: `CLOVER_PHONE_METERED_MINUTE_ID`, `FOODHUB_PHONE_METERED_ENABLED`, `FOODHUB_BILLING_EXEMPT_MERCHANTS`. Docs: `docs/CLOVER_MULTI_APP.md`.

## 2026-10-16 — Clover billing: subscription status + extra-brand metered billing (`feature/clover-billing-extra-brands`)

- Stacked on `feature/clover-voice-ai-app` (reuses its app registry, token store and billing_info reader). Owner's price: tier "Standard" CAD $50/month (Canada, 14-day trial) + metered "Extra brand, per platform, per month" CAD $15 (first brand included; each extra brand × each of Uber Eats / DoorDash / SkipTheDishes it is on).
- New `lib/foodhub/pos/clover-pricing.ts` (prices, FR/EN copy) and `lib/foodhub/pos/clover-extra-brands.ts`: per-merchant subscription status (cached 15 min, trial days left), unit counting from store mappings (oldest brand or « marque principale » is free; TGTG and deactivated brands never count), monthly metered report (OFF unless `FOODHUB_CLOVER_METERED_ENABLED=true`; `CLOVER_METERED_EXTRA_BRAND_ID`; `FOODHUB_BILLING_EXEMPT_MERCHANTS` never billed; idempotent per merchant and month, 3 tries, lost answers never re-sent), billing log, dry run, price quote. Settings → Clover app → « Facturation Clover »; `components/billing/extra-brand-price.tsx` shows « +15 $/mois pour cette plateforme » before adding a brand or connecting a store. Listing copy no longer says "free". Owner steps: `docs/CLOVER_BILLING.md`.
- Review fixes (8 findings, all real, all fixed): a 5xx / 408 / broken connection after sending is "uncertain" and never re-sent (only a 4xx or no connection is retried); each send try is claimed with one atomic `fh_kv` insert (`claimKv`), so two containers never send the same month; a billing run that cannot read the catalog or the « marque principale » marks records no count (`getCatalog({ strict })`, `primaryBrands({ strict })`; `setPrimaryBrand` never wipes other marks on a failed read); only the Standard tier is billed (`CLOVER_FOODHUB_STANDARD_PLAN_IDS`, else name "Standard" and not $0; dry run shows « Non facturé : forfait X »); `PHONE_OWN_MERCHANTS` is exempt too; Uber activation quotes all stores together (`POST /api/foodhub/clover-billing/quote`, « +30 $/mois : 2 marques sur Uber Eats »); a new brand's notice is tied to a merchant when known, else worded as a condition; the section says a main-brand change applies next month.
- Checks: typecheck OK, lint 0 errors, 1032 tests passed (1 skipped; 1 Windows-only CRLF failure in tests/tgtg-email.test.ts from main), webpack build OK, e2e 554/0.

## 2026-10-16 — AI phone as a second Clover app: multi-app plumbing (task 41)

- Branch `feature/clover-voice-ai-app` (PR #61). One backend, two Clover App Market apps: TAKATAK Food Hub (unchanged) and the AI phone app, sold separately. New `lib/foodhub/pos/clover-apps.ts` (registry), per-app OAuth in `clover-oauth.ts` (optional app argument, Food Hub default), phone routes `/api/foodhub/clover-connect/phone/{start,callback}` and `/api/foodhub/webhooks/clover/phone` (404 until `CLOVER_PHONE_APP_ID` is set), tokens per (app, merchant), uninstall of one app only, `clover-entitlement.ts` (`voiceAiEntitled`, `recordPhoneOrder`, `appInstalled`, `phoneCloverToken`), Settings → Clover app "Clover apps on this server".
- Without the new env vars nothing changes. `lib/foodhub/phone/**` not touched: wiring steps in `docs/CLOVER_MULTI_APP.md`. Review fixes (PR #61): live-call check answers within 2.5 s when Clover hangs (failure remembered 2 min); phone billing status in its own per-merchant key and every token-map write serialized (no lost refresh token); charges saved before sending, pending ones settled on the next ACTIVE answer, lost answers never re-sent; Pro tier by Clover subscription ID; Settings section only once the phone app is set, approve/disconnect owner-only and per app; Food Hub keys read raw as before. Checks: typecheck OK, lint 0 errors, 993 tests (1 skipped; 1 Windows-only CRLF failure in tests/tgtg-email.test.ts from main), webpack build OK, e2e 554/0.
## 2026-10-16 — AI phone disclosure + card redaction (legal review 2a items 3–4, `fix/phone-ai-disclosure`)

- Both assistants now introduce themselves as automated (« Je suis l’assistante automatisée » / "I’m the automated assistant" / "Soy su asistente automatizada"), say the call is transcribed (to take the order / to handle the request) and that 0 reaches a person, one short sentence per part, Québec French first; "virtuel / virtual" wording removed (style.ts selfIntro, twilio.ts GREETING, ivr/engine.ts orderIntro, console intro).
- ON2GO menu: the notice (`GREETING_NOTICE` in ivr/tree.ts) is kept apart from OWNER_GREETING, so an edited greeting or a recorded MP3 can never drop it; it is said again in English / Spanish after a language switch. Key 0 reaches a person even when the tree has no enabled 0 option.
- Ordering line (voice.ts callerTurn + simulator): a card number said or typed is refused like on the ON2GO menu (never stored, never sent to the AI); every stored transcript line goes through `redactCards` (calls.ts say).
- Review fixes: card numbers read in groups with the punctuation speech recognition adds ("4111, 1111, …", periods, double spaces) are found (ivr/words.ts CARD_RUN, length + Luhn on the digits only); a card typed one key per turn on the ordering line is refused at the 13th key, the keys already noted are scrubbed from the transcript and the AI history, the rest of the card is refused too, 0 still reaches a person; the AI's own words are redacted in the stored AI history (agent.ts storedContent); "English, I want a chicken" (both lines + simulator) hears the notice in the new language before the answer; the Spanish "automatizada / automatizado" follows the Spanish voice, not the French one.
- Checks: typecheck OK, lint 0 errors, 968 tests passed, 1 skipped; 1 pre-existing local-only failure in tests/tgtg-email.test.ts (Windows autocrlf turns the .eml fixture into CRLF; passes with LF, file untouched here); webpack build OK, verify:foodhub 554/0. Not deployed.
## 2026-10-16 — ON2GO Hub pages, second review (task 45, `feature/seo-hub-landing`)

- Status wording never ahead of the facts: "L’application sera bientôt offerte sur le Clover App Market" (no more "en
  révision chez Clover": nothing is submitted yet); `FOODHUB_APP_MARKET_STATUS=review` turns that wording on later.
- DoorDash and SkipTheDishes: « Intégration en cours de certification avec … » note, badge on the links, `{pending}`
  line in the platforms FAQ and llms.txt; their pages are `noindex, follow` and out of the sitemap and llms.txt until
  `FOODHUB_PUBLIC_LIVE_PLATFORMS` lists them (default `uber`).
- `/media/` (dish photos used on on2go.ca) indexable again; draft legal pages `noindex, follow` until approved.
- `/` keeps its query string on the way to `/hub` (fbclid / utm links no longer land on `/login`); still 307 on purpose.
- Hub pages `Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`. In production a non-https
  `FOODHUB_PUBLIC_URL` falls back to `https://foodhub.on2go.ca` for canonicals, sitemap, robots and JSON-LD.
- Copy: allergies red on screen only, « par application », « heures de pointe », « versements », « 15 $/mois … taxes en
  sus » (pricing sentence, meta description, FAQ, JSON-LD Offer), "days of free trial", llms.txt English colon.
  Schema: `eligibleRegion` Canada + identifier CA, `primaryImageOfPage` ImageObject; docs: the Software App rating
  warning stays until genuine Clover App Market reviews exist.
- Tests: 32 in `tests/public-hub.test.ts`; e2e: no X-Robots-Tag on `/hub`, `/en/hub/pricing`, `/media/<photo>`; public
  cache header; `/?utm_source=x&fbclid=y` → `/hub` with query; absolute https canonical; DoorDash page noindex; draft
  legal page noindex.

- New public, indexable pages, French first with an English twin: `/hub` (landing), `/hub/tarifs`,
  `/hub/integrations/{uber-eats,doordash,skipthedishes}-clover`, `/hub/ecran-de-cuisine-clover`,
  `/hub/telephone-ia-restaurant` and `/en/hub/…`. Server-rendered, no session, no database, no page-specific client
  component, no trackers (the root layout's boot script and the Next.js runtime still load).
- Product facts reused from the Clover App Market listing (`clover-listing.ts`); prices in `lib/foodhub/pricing.ts`
  (14-day trial, $50/month per app, $15 per extra brand per platform, billed by Clover); FAQ and examples are built from
  those constants and say "(planned launch pricing)" until `FOODHUB_APP_MARKET_URL` is set. Too Good To Go only "when
  your account offers an order feed" (the hub has its own tagline without it; a test fails on any unconditional mention
  in text, JSON-LD, metadata or llms.txt); AI phone "coming soon, separate app", in the planned tense.
- JSON-LD: Organization (ON2GO Hub, alt. TAKATAK Food Hub, legal name from env, address), SoftwareApplication
  (BusinessApplication, Clover), WebPage, FAQPage = visible FAQ (each shared question on one page only), breadcrumbs;
  shared nodes keep one url (`/hub`); Offer only when `FOODHUB_APP_MARKET_URL` is set; never a rating (Search
  Console's Software App warning is expected until then, see `docs/FOODHUB.md`). Title ≤ 60, description ≤ 155, canonical, hreflang fr-CA / en-CA / x-default, share images
  `public/og/hub-{fr,en}.png`.
- `robots.txt` (blocks only `/api/`, so private pages show their noindex), `sitemap.xml` (hub pages; the 3 legal pages
  only once `FOODHUB_LEGAL_APPROVED=true`), `llms.txt`, `favicon.ico`. `/icons/` is indexable (Organization logo).
- `proxy.ts`: public site paths (exact `/hub`, `/en/hub`, prefixes `/hub/`, `/en/hub/`, `/og/`; `/hubx` stays
  private); language fixed by path (header read first by `getLang()`); anonymous `/` → `/hub` (`FOODHUB_PUBLIC_HOME=off`
  restores `/login`; tablets and signed-in users unchanged); `X-Robots-Tag: noindex` on every non-public response.
- e2e: the "/ without sign-in" check now expects `/hub`, and new checks cover the public pages, robots, sitemap, llms.
- Built on `fix/legal-pages-complete` (PR #66: paid pricing in the terms and support FAQ, no more "free"): merge #66
  first; this PR is stacked on it.
- Checks: typecheck OK, lint 0 errors (1 old warning), 1003 tests passed (27 in `tests/public-hub.test.ts`, 3 in
  `tests/i18n-server-lang.test.ts`), 1 skipped, 1 failure also on `origin/main` (`tests/tgtg-email.test.ts` "forged Too
  Good To Go From", Windows CRLF checkout artifact, not touched here); webpack build OK; verify:foodhub 560/0.
- Owner after merge: redeploy; optional env `FOODHUB_APP_MARKET_URL`, `FOODHUB_PUBLIC_SAME_AS`; Search Console
  URL-prefix property `https://foodhub.on2go.ca/` + sitemap; link the page from LinkedIn / YouTube / on2go.ca only once
  the legal Draft banner is gone (`FOODHUB_LEGAL_APPROVED=true` also adds the legal pages to the sitemap).
## 2026-10-17 — Legal pages name TAKATAK Phone (`fix/legal-takatak-phone`, stacked on #66)

- The Clover App Market review of the second app, TAKATAK Phone, uses the same `/legal/privacy` and `/legal/terms` URLs. Privacy §1 (FR + EN) now also covers the Clover app « TAKATAK Phone » (automated phone assistant: answers calls, takes orders, texts a Clover payment link; its data = the calls, voicemail and direct orders of §2). Both pages' header and title name both apps.
- Terms §1: « le service » = both apps; the caller is told it is an automated assistant and can press 0 for a person. §6 and the support FAQ: TAKATAK Food Hub price unchanged; TAKATAK Phone = 14-day free trial, then CAD $50/month + CAD $0.25 per minute the assistant is on the line (rounded up per call, not after a transfer to a person, never in the trial), billed only by Clover through the Clover App Market, Canada only (`phoneFeesText()`; env `FOODHUB_PHONE_TRIAL_DAYS`, `FOODHUB_PHONE_MONTHLY_PRICE_CAD`, `FOODHUB_PHONE_MINUTE_PRICE_CAD`, defaults 14/50/0.25). §11 names both apps as independent software.

## 2026-10-16 — Legal pages complete for Clover review (`fix/legal-pages-complete`)

- Privacy policy (FR then EN): §1 and §2 now cover the phone lines (caller number, transcripts, voicemail recordings), customer texts, the couriers' page, direct orders (website, phone, Clover Online Ordering) and more Clover data (merchant address, Online Ordering orders with the customer's name, payments, refunds). §4 lists Twilio, Google (speech, through Twilio), Anthropic (phone assistant; never approves refunds or payments), DoorDash Drive / Uber Direct / SkipTheDishes delivery (they receive the customer's name, number and email, address and order), team-chat alerts and MochaHost mail. No order aggregator is named. §5: database in Montréal, app server and Twilio / Anthropic / Google in the US; the "we assess" promise is gone. §6: deletion on request within 30 days (sales data kept for tax), no destruction promise; Clover tokens deleted "when Clover notifies us, or on request". §8: deletion, complaints, written answer within 30 days, press 0 for a person.
- Terms: §6 and the support FAQ follow the owner's 2026-10-16 pricing (not the 2a sheet's "free"): 14-day free trial, then CAD $50 per month per app, each additional brand CAD $15 per month per platform, billed only by Clover (one `feesText()`; env `FOODHUB_TRIAL_DAYS`, `FOODHUB_MONTHLY_PRICE_CAD`, `FOODHUB_EXTRA_BRAND_PRICE_CAD`, defaults 14/50/15). §8 liability cap = amounts paid for the service through Clover billing (for the adviser). §9 same token wording; new §12 on the merchant's customers' personal information (we act as service provider); contact moves to §13. Clover listing copy uses the same token wording.
- `/legal` redirects to `/legal/support` and is public in `proxy.ts` (it sent visitors to sign-in). Company, address, phone, email and officer stay env-driven (`FOODHUB_LEGAL_*`, `FOODHUB_SUPPORT_*`, `FOODHUB_PRIVACY_OFFICER`); the draft banner stays until `FOODHUB_LEGAL_APPROVED=true`.
- Not in this branch (AI-phone branch): greeting wording "automated assistant, call transcribed, press 0" in `lib/foodhub/phone/twilio.ts`, `ivr/tree.ts`, `ivr/engine.ts`, and `redactCards` in `voice.ts` callerTurn.
- Checks: typecheck OK, lint 0 errors, 973 tests passed + 1 skipped (19 in `tests/legal-pages.test.ts`); 1 failure in `tests/tgtg-email.test.ts` (forged From): a Windows CRLF checkout artifact, passes with LF fixtures, not touched here; webpack build OK, verify:foodhub 554/0. Not deployed.

## 2026-10-16 — Client dashboard: simple view, full view, platform scope (task 40)

- Branch `feature/client-dashboard-easy` (from `origin/main` 444e8f2), not merged. Spec and status: `docs/CLIENT_DASHBOARD.md`.
- Simple view by default (6-item rail, phone bar of 4, avatar menu with language, text size and the "Vue complète" switch for owners and managers; cookie `fh_view` read on the server). Full view = the console before, unchanged.
- Scope gains the platform (`?channel=`) with store counts in the switcher (bottom sheet on phones) and filter chips; Home (4 numbers, To do, By platform, Get started), Orders (Actives / Planifiées / Historique), Alerts, Sales & trends, Reports and the new Restaurants → Tous les magasins follow it. Alarms, bell, badges and the kitchen screen never follow a brand or a platform.
- Read-only API additions: `channels=` on `/api/foodhub/command` (output unchanged without it, tested), `locations=` on `/api/foodhub/incidents`. The owner's DoorDash list is gated to the owner's tenant. No webhook, order write, Clover or menu-publish change; no env var, no migration.
- Review fixes (all majors and minors): Home numbers fit a phone, contrast, "Demander le branchement" on Get started, pause on the picked platform only, `/alerts?i=` links always show their alert, chip ARIA, 44 px targets, Épuisés wording, page titles, plain words. List in `docs/CLIENT_DASHBOARD.md` §22.
- Checks after the review fixes: typecheck OK, lint 0 errors, 983 tests passed + 1 skipped (1 failure in `tests/tgtg-email.test.ts`, also on `origin/main`, not touched here), webpack build OK, verify:foodhub 554/0 (32 screens). Env check: `FOODHUB_TENANT_ID` unset or `takatak` in production. Not merged, not deployed: ready for owner review/merge.

## 2026-10-16 — Uber store kitchen mapping (task 39, `fix/uber-store-kitchen-mapping`)

- The 7 Uber UUIDs in `data/actual/platform-stores-uber.json` are at 5839 Jean-Talon E (Saint-Léonard) in Uber's own records (Uber names them "(Hochelaga)"); production maps them to `NDG_6284`. That mapping was typed by hand in the console, so it lives only in the production `fh_channel_stores` rows: no repo seed or code defaulted Uber stores to NDG.
- Repo: data file records `SAINT_LEONARD` + Uber's name/address for the 7, plus the 9 live NDG UUIDs as an unmapped reference list (no Po Poulet). Stores → Mapping suggests the recorded kitchen (never a guess from the "(Hochelaga)" name) and warns about a known store mapped elsewhere, with a **Move** button. Production fix = owner steps / SQL in the pull request; production not changed.
- Checks: typecheck OK, lint 0 errors, 816 tests (1 skipped), webpack build OK, verify 541/0.
## 2026-10-16 — Menu safety + per-brand menus (task 37, `feature/menu-safety-brand-menus`)

- Clover → platforms: the Clover webhook now obeys `FOODHUB_CLOVER_INVENTORY_SYNC=off` (the polling already did). Locked and "Do not touch" stores are left out BEFORE the fan-out (no call, no Food Hub 86 state). A store follows the Clover merchant set on it under Stores → Mapping, or the default one (`CLOVER_MERCHANT_ID`) when none is set — as before, so nothing changes for today's stores. A location where the stores follow different merchants is not 86'd; one `clover_86_skipped` activity line per out-of-stock says why. An 86 Clover made earlier is always switched back on when Clover restocks, even where no store follows that merchant any more (`clover_86` origin keys).
- Deviation from C1 as first written ("stores without a merchant never count"): rejected after review, because with no mapping done every Clover 86 would stop silently and old Clover 86s would stay stuck. Owner can still ask for the stricter rule.
- DoorDash Menu Request (pull) and Item Polling answer 409 for a "Do not touch" store, like a locked one; the Deliverect product push refuses locked and "Do not touch" stores.
- Clover import: `excludeCategories` (default "Menu Employés", "INSTORE PROMOTIONS", "Menu promotionnel"; accents and case ignored) — the real export now imports exactly the 175 DoorDash-menu dishes.
- Per-brand dishes on a shared menu (`menu_brand_dishes_v1`): a follower brand shows only its picked dishes (by ref or Clover id), with the option groups they use (Duo / Trio / Combo) and their categories; applied in `getBrandMenu` and the 86 fan-out; edited in Menu → Menu partagé. A list that matches nothing never publishes an empty menu. Order line mapping still uses the whole shared menu.
- Review fixes: a follower with a dish list that stops sharing gets a copy of ITS dishes only (never the whole master menu; no copy at all when its list matches nothing); the "moved to another menu" timer copy keeps only its dishes' timers. A staff 86 reads the dish lists before saving any state. DoorDash Menu Request for a follower whose list matches nothing answers 409 with the reason and logs `menu_pull_refused`. Dish refs longer than 120 characters are refused by the API and dropped when read.
- Checks: typecheck OK, lint 0 errors, 841 tests passed, 1 skipped (+30 in tests/menu-safety-brand-menus.test.ts), webpack build OK, verify:foodhub 554/0. Not deployed.
- Owner after merge: nothing required for Clover 86s (stores without a merchant still follow `CLOVER_MERCHANT_ID`); set a merchant under Stores → Mapping only for a store that uses another Clover register. Menu → Shared menu: pick each brand's dishes, then publish those brands.
## 2026-10-16 — AI phone go-live (task 34, branch `feature/ai-phone-quebec-paylink`)

- Finished the paused WIP (f1402bf) and verified it. Voices and words: Québec French by default (understands France French), North-American English, Latin-American Spanish (Mexican / Cuban words), professional and short. Audit fixes: the keypad menu takes over when the AI fails (never a loop, never "je n'ai pas compris"); the order number, time and payment are always said, even with end_call in the same answer; each kitchen's real hours go to both assistants and hours never set refuse the order (a person takes it); AI authentication / credit failures pause the AI (keypad mode, one team-chat alert); texted links are pages that answer; a voicemail is marked emailed only once sent; FOODHUB_PUBLIC_URL trimmed and Twilio URL errors caught.
- Payment link by text (Clover Hosted Checkout, only when CLOVER_ECOMM_PRIVATE_KEY is set): the order is held, released exactly once when paid (pickup: kitchen ticket; delivery: courier), one reminder, expiry with a courtesy text, late or double payments flagged for a refund by a person.
- Duo (+2,50 $) / Trio (+5,42 $) / Combo (+7,58 $) read from the item's Clover modifier groups: offered once per call, at most one per item, the drink always asked (add_upsell); the Clover modifier id travels on the order line and goes to Clover as a real modification. Ticket printed on the kitchen's printer (CLOVER_PRINT_DEVICES "MID|LOCATION"). FOODHUB_CLOVER_NO_REGISTER keeps orders of a kitchen without a register out of Clover. Po Poulet only at Saint-Léonard (Hochelaga allowance removed).
- Console: Settings → Expansion → AI phone gets « Prêt pour les appels de test ? » (read-only checks) and a call simulator (real handlers, dry run: nothing sent). Without the new env vars, ordering works as before (pay at the counter).
- Review fixes (13 findings): a language word inside an order ("French fries", "Spanish rice", "frites à l'anglaise") never switches the language, and keys 2 / 3 switch it only on the greeting; in keypad mode a sentence starting with "no" is routed, only "non merci" / "that's all" alone ends the call; a delivery paid while the kitchen is closed (or for the wrong amount) gets no automatic courier and booking a courier keeps that flag; the courier tip is an untaxed line on Clover's page and the texted total is what Clover charges; merchants without GST / QST rates get no link, and a failed link lets the caller pay at the counter; only credit / billing / model 400s pause the AI, simulator and test calls never touch the breaker; the poller matches our whole mark and never releases a short payment; simulator owner-only with the fictional 555 caller; /p/ rate limit on the proxy's client IP, pruned, and a 10 s check cooldown; stored voices kept when well-formed.
- Deploy notes (behaviour that changes with no new env var): AI phone orders are refused when a brand's hours were never set (check Settings → Hours for every phone brand before merging, the readiness panel flags it); tickExpansion runs tickIvr even with every expansion switch off; on2go.ca placeholders resolve to https://on2go.ca; the IVR menu and yes/no steps use googlev2_telephony_short; Po Poulet lines outside Saint-Léonard are stripped / disabled; the payment-link release is "exactly once" with ONE Food Hub process (one Coolify container) — add an atomic claim before scaling out.
- Checks: typecheck OK, lint 0 errors, 849 tests (1 skipped), webpack build OK, verify:foodhub 541/0. Ready for owner review/merge.
## 2026-10-16 — Too Good To Go order e-mails (task 36)

- Branch `feature/tgtg-email-orders`: TGTG reservation / cancellation e-mails → Food Hub order on the same pipeline (kitchen screen, Clover order type "Too Good To Go", ticket with customer, bags, pickup window and TGTG code, paid with the "Too Good To Go" tender at pickup). Cancel = order cancelled, Clover order flagged "CANCELLED" (never deleted). Idempotent by Message-ID + TGTG code; unreadable e-mails go to an attention list.
- Sources: read-only IMAP poller (`imapflow`, `mailparser`) on the existing heartbeat, and a token-protected webhook for forwarding services. Feature off unless `TGTG_IMAP_*` or `TGTG_EMAIL_WEBHOOK_SECRET` is set. Owner steps: `docs/TGTG_EMAIL_ORDERS.md`.
- Review fixes (same day): a code needs a digit and a marker ("Order confirmation" is never a code); only From counts and the mailbox server must show dkim=pass / dmarc=pass; the "Too Good To Go" order type is forced only for e-mail orders; unmapped stores are never sent to Clover (unmap stops routing); one bad e-mail is kept as "error" and never blocks the poller; price paid by priority; cancel flag honours FOODHUB_CLOVER_DELETE_CANCELLED=off and keeps the note; webhook ?token= is opt-in and the 5 MB cap is enforced while reading. Checks: typecheck, lint 0 errors, 846 tests, webpack build, e2e 554/0.
## 2026-10-16 — DoorDash sandbox-safe mode (task 38, `feature/doordash-sandbox-safe-mode`, PR #56)

- DoorDash opened Marketplace for the org in SANDBOX only. New sandbox-safe mode lets the sandbox webhooks reach production
  Food Hub with no effect on real operations: sandbox traffic (DOORDASH_ENV=sandbox, a `_sandbox` provider type,
  DOORDASH_SANDBOX_STORE_IDS, a `_sandbox` provider_type in the payload, or an event about a held test order) becomes a
  TEST order in Settings → Plateformes et Clover → Essais DoorDash (bac à sable): never in the orders table, so never
  Clover, print, kitchen ring, Watchtower, SMS/calls, money or reports.
- The DoorDash side runs with the same calls as a real order (confirm with prep_time, reject with DoorDash failure codes,
  ready, merchant cancel, DoorDash cancel / Dasher / release / adjustment, menu pull, menu push, 86, pause), aimed only at
  the test store (a virtual store, never in the Stores table). With sandbox keys, real stores are refused for every
  DoorDash call and their status is not read (no false "deactivated" alert). Po Poulet NDG can never be a test store.
- Webhook auth (DOORDASH_WEBHOOK_SECRET in Authorization) unchanged and checked first. Without the new settings, behaviour
  is unchanged. Owner steps: docs/DOORDASH_SANDBOX.md. Tests: tests/doordash-sandbox.test.ts.
- Review fixes (same PR): the sandbox decision is taken when the webhook arrives and saved on its inbox entry, so a retry,
  the recovery runner or a Replay after DOORDASH_ENV changed never sends a test order to the kitchen; every test order id
  is kept in a permanent set (never emptied by the 50-order cap or Clear); a sandbox entry is never cut off by the
  3-minute answer window (no failed entry, activity line or Watchtower incident). New DOORDASH_SANDBOX_WEBHOOK_SECRET:
  the Sandbox subscriptions' own Authorization value, every request with it is a test whatever DOORDASH_ENV says. Item
  polling and cart validation answer the test store and refuse real stores under sandbox (409). A store mapped in Food
  Hub is never a test store (even if listed; the screen warns). The Reporting API is refused with the sandbox key unless
  DOORDASH_REPORTS_* is set. A `_sandbox` DOORDASH_PROVIDER_TYPE alone no longer turns the mode on (warning only).
  Docs step 6: delete the Sandbox subscriptions first, keep DOORDASH_SANDBOX_STORE_IDS and the sandbox secret.

## 2026-10-16 — Kitchen UI accessibility and reconciliation

PR #52 (`fix/console-kitchen-a11y`): kitchen tokens on document root and first paint, reduced motion, 48px controls, PIN shake, bilingual loading/error, regression tests. Manually reconciled feature branch with `main` `444e8f2e` to retain merged Clover test-order PR #53 and all its unrelated code. GitHub CI/image pending on latest PR branch, no production rollout/connector toggles. Merge remains owner-only.


## 2026-10-15 — Owner-authorized automatic production activation

- Reusing PR #49. Existing Coolify resource rebound to its installed GitHub App, push deployment enabled, source commit available to Docker and health monitoring enabled. Historical Actions deployment controller disabled to keep one production writer while GitHub runner billing is blocked.
- Dockerfile enforces isolated audit/check/build/E2E plus final pruned runtime smoke; production health requires a real healthy database. Fixed Vitest to include the verifier's `.mjs` regressions. Local audit/typecheck/lint/build passed, 807 unit tests passed (2 skipped), E2E 536/0.
- Private media/configuration backup and rollback image retained on Contabo. Existing Supabase/session/media preserved. Automatic Webhook success and exact live main-SHA proof still pending at this commit; no live connector certification claimed.

## 2026-10-14 — Live release proof and agent handoff

- Branch `agent/foodhub-deployment-verifier`: new `npm run verify:live` command and mock-only tests for exact SHA, ON2GO public feed/CORS, health, login and private orders route. Five public continuity docs added without copying local private task files.
- PR #48 remains open and green; `main` = `bb353ccfa82a7ba5e3d7af488e0da6bf03746c09` at inspection. Coolify deployment workflow remains gated/skipped; production success is **not** claimed. See `docs/AGENT_HANDOFF.md` and issue #46.

Newest first. Every session reads this before starting (see `CLAUDE.md`) and updates its own row at the end of each
piece of work. The plan itself is `docs/MASTER_PLAN.md`. Operations (support, emails, portals) are tracked privately in
`private/CLAIMS.md` and `private/OPS_LOG.md` in the main checkout, never in git.

## Task board (one task = one branch = one owner; edit only your own row)

> Since 2026-10-08 the **live board is `private/TASKS.md`** (local, git-ignored, main checkout). This copy is a snapshot, updated by pull requests only, never by a commit on `main`.

| # | Task | Branch / place | Owner (session) | Status | Next step |
|---|---|---|---|---|---|
| 1 | Production database | Coolify env | owner + main session | FIXED 2026-10-08: NEXT_PUBLIC_SUPABASE_URL pointed to the wrong project (TAKATAK Dashboard V1, eu-west-1); now takatak-foodhub (ca-central-1, Montréal), which already has all fh_* tables. Key pasted by owner | Restart after the running deploy if /api/health database is not ok. |
| 2 | Reconcile PR #6 with `main` | `reconcile-pr6` | Food Hub ↔ Clover backend session | MERGED (PR #9, 1fb58d6). Re-verified after task 9: 386/386 tests, webpack OK, verify 492/0 | Owner closes PR #6 without merging; deletes branch claude/brave-sagan-lmgsnp. |
| 3 | "Extra loud" kitchen alarm | `uber-eats-final` (`46e5046`, not in `main`) | the Uber session | TODO | Open a small PR of `46e5046` onto `main`. |
| 4 | Stray commit `7e99455` | `claude/brave-sagan-lmgsnp` | Food Hub ↔ Clover backend session | DONE: superseded (main has a superset posRetry type; job kind unused) | Owner may delete the branch `claude/brave-sagan-lmgsnp`. |
| 5 | Point platforms at `https://foodhub.on2go.ca` + end-to-end connections (Clover, Uber, DoorDash, sign-in codes) | Coolify env + Uber / DoorDash / Clover developer settings + branch `connections-golive` if code is needed | Connections agent (main session) | IN PROGRESS (claimed 2026-10-08 ~02:45 UTC) | Production DB key first (task 1, owner). Then FOODHUB_PUBLIC_URL, platform URLs, Clover connect, SMS/email codes (Twilio/Resend), test order through each path. |
| 6 | Phase 3 look and feel | local `wf/look`, `wf/kitchen` (PR #6 session) | the PR #6 session | PAUSED | Finish after task 2. |
| 7 | Brand websites without WordPress | separate repo `brand-sites` (local, no GitHub repo yet) | main session | READY, needs a GitHub repo | Owner creates private repo `takatakca/brand-sites` → push → Coolify resource (Dockerfile, port 80, `/healthz`). |
| 8 | SEO + consent kit on 12 website repos | branch `seo-legal-kit` in each `takatakca/*` site repo | main session | DONE, pushed | Owner reviews and merges each pull request. |
| 9 | SESSION_SECRET never generated + webpack client build fix | `fix/session-secret-stable` | Clover Marketplace session | MERGED (PR #8, 3a949e6) | Owner sets SESSION_SECRET in Coolify once (never change it). |
| 10 | Website orders through Clover (pppmtl.com first) shown on the Food Hub kitchen tablet, Clover keeps control | `clover-website-orders` (b8a818b) | Clover integration agent (main session) | MERGED (PR #10, f6c7bef), deployed 2026-10-08 04:35 UTC | Owner opens https://github.com/takatakca/foodhubca/compare/main...clover-website-orders?expand=1 after task 9 is merged; rerun the webpack build; merge, deploy; then follow docs/CLOVER_WEBSITE_ORDERS.md §4 (Clover online ordering on, pppmtl.com button, Orders webhook, FOODHUB_CLOVER_WEBSITE_BRAND) and place one test order + one refund. |
| 11 | Platform API research for Marketplace approval | `api-research` (277588f, docs only) | API research agent (main session) | DONE, pushed | Owner merges https://github.com/takatakca/foodhubca/compare/main...api-research?expand=1 ; owner starts the DoorDash application + asks for an Enterprise Partner Manager. Developer backlog (section 6) = task 13. |
| 12 | pppmtl.com wired to Clover (real items/photos/options, Clover Hosted Checkout) + tablet mirror | pppmtl `clover-direct` (d7b4366) + foodhubca `clover-website-menu` (0d7c76a, on top of task 10) | Clover website menu agent | DONE, pushed. pppmtl 79/79, build OK; foodhubca 372/372, verify 486/0 | Owner: pppmtl docs/integrations/clover.md §4–5 (host on Lovable or Coolify, Clover Hosted Checkout token + webhook secret + REST token); merge foodhubca 10 → 12; open pppmtl PR (syncs to Lovable); one real test order + refund. |
| 13 | Certification backlog (PLATFORM_API_RESEARCH §6) | `certification-backlog` (1a5fe62, main merged in) | Certification agent | DONE, pushed. 11 items coded, SOW skipped, Uber prep time TODO. Checks: 426/426 tests, webpack OK, verify 506/0 | Owner opens the PR (https://github.com/takatakca/foodhubca/compare/main...certification-backlog?expand=1), merges after task 12, deploys; then the owner actions and platform questions in docs/CERTIFICATION_BACKLOG.md |
| 14 | Move Supabase project "TAKATAK User Official Dashboard V1" from eu-west-1 (Ireland) to ca-central-1 (Montréal) | none | main session | CANCELLED 2026-10-08 by the owner: the project stays in Europe as long as it works. Nothing was changed. | None. Do not restart this task unless the owner asks. |
| 18 | Brand phone lines: one Twilio number per brand rings one main number (whisper "Appel pour <marque>", voicemail and texts by email); numbers also serve Google Business Profile verification | `feature/brand-phone-lines` | Brand phone agent | DONE, pushed. Checks: typecheck OK, lint 0 errors, 420/420 tests, webpack OK | Owner merges and deploys; then creates the Twilio account (upgrade), buys the numbers, pastes the two webhook URLs on each number and adds the env names listed in `.env.example` (`FOODHUB_MAIN_PHONE`, `FOODHUB_BRAND_PHONES`, `FOODHUB_VOICEMAIL_EMAIL`, `TWILIO_*`). The owner guide is outside git. |
| 20 | takatak.ca brand section connected to Food Hub's multi-brand data (feed `GET /api/public/directory`, task 19) + one TAKATAK V1 workspace per restaurant brand (Quadro Holding admin owns all; brand logins by invitation) | foodhubca `claude/google-doordash-id-extraction-wg2f5l` (decision note `docs/TAKATAK_BRANDS_BRIDGE.md`, being written there); takatak-v1 local branch `claude/provision-brand-workspaces` (not pushed: no write access in that session) | DoorDash/Google session (claude, 2026-10-09) | IN PROGRESS (claimed 2026-10-09) | Read the note on that branch. A new session needs takatak.ca allowed in Network access, the takatak-v1 DB secrets and write access to takatak-v1; then push the setup script, run it dry-run, show the owner, `--apply` only after the owner says yes. |
| 27 | DoorDash: every store back to tablet after UrbanPiper; store list and IDs; Google listings / Ads prep (operations, outside git) | owner's private Google Drive folder "TAKATAK OPS (private)" (README, CLAIMS, APPROVED_VALUES, OPS_LOG) | DoorDash/Google session (claude, 2026-10-09) | IN PROGRESS | Read the Drive folder README first. Never redo, undo or re-send anything its OPS_LOG records without the owner. One agent at a time in the DoorDash portal and each Gmail inbox. |

## 2026-10-10 09:20 UTC (Finance A–Z session, task 30: `fix/finance-tax-split-doordash-hist`)

**Done**
- Importer fixes after the real exports arrived (DoorDash transactions Oct 2024 → Oct 2026, Uber Payment Details + Payout
  Summary Jan 2025 → Oct 2026, Clover May → Oct 2026): every statement line now adds up to the platform's net total.
  - DoorDash pre-April-2025 layout: historical marketing / ad-fee / credit columns; "Tablet fee tax" counted as recoverable tax.
  - Uber Eats Manager prints the whole tax in "GST/HST on Sales": split by the rate actually charged (QST only, GST only,
    both), GST-holiday aware; offers / refunds follow the sale's ratio. A rare Uber row with a blank "Other payments" is
    classified from its description.
  - New Lines / Tax_Summary columns + auto to-do: sales the platform taxed **QST only** outside the holiday and the GST still
    owed on them.
  - Clover orders / refunds / Sales Overview exports are reference files (the payments export carries the amounts).
- Checks: lint 0 errors, 22/22 finance tests, Excel recalculation of the workbook (21,937 formulas, 0 errors). `typecheck`
  fails only on `lib/foodhub/adapters/uber-provision.ts` from `main` (main red since #34, fix in #40).
- Private outputs (never committed): report + workbook rebuilt in `private/finance/`, copied to OneDrive.

**Next**
- Owner reviews and merges the PR. No env var, no migration, nothing deployed.
- Owner actions are listed in `private/finance/HANDOFF.md` (Skip and bank exports, Uber tax number / bank, disputes).

## 2026-10-08 06:20 UTC (brand phone agent, task 18: `feature/brand-phone-lines`)

**Done:** a Twilio voice webhook for one phone number per brand. Nothing was bought or created in Twilio.
- `POST /api/foodhub/voice/incoming` rings `FOODHUB_MAIN_PHONE`; the person who answers hears "Appel pour <marque>" (whisper); no answer after 20 s: bilingual greeting and voicemail, emailed (existing notify email) with a signed 30-day listen link. A text sent to a brand number is emailed too (`/voice/sms`).
- The number to brand map is `FOODHUB_BRAND_PHONES` (JSON, env only, no numbers in git). A line for Po Poulet NDG is refused. Every Twilio request is checked with `TWILIO_AUTH_TOKEN`; `/api/foodhub/voice/` is public in `proxy.ts` for that reason.
- Separate from the AI order-taking agent (`/api/foodhub/webhooks/voice`): a number points at one or the other.
- Checks: typecheck OK, lint 0 errors, 420/420 unit tests (20 new), webpack build OK.

**Next:** owner merges, deploys, then the Twilio steps in the owner guide.

## 2026-10-09 02:50 UTC (ON2GO agent, task 19: `feature/public-directory-api`)

**Done:** public read-only directory feed `GET /api/public/directory` for ON2GO.ca and QMAPS (docs/PUBLIC_DIRECTORY_API.md).
- 17 brands, NDG + Saint-Léonard kitchens, hours (Settings → Hours win), open now / open late, 10–12 dishes (Clover id, price, photo), order links (Clover first when `FOODHUB_PUBLIC_CLOVER_ORDER_URL` is set), 7-day trending rank.
- Public facts only; Po Poulet NDG never linked; never "24 h" (open late until about 3 AM). Cached 5 min, CORS on2go.ca / qmaps.ca / localhost.
- Checks: typecheck OK, lint 0 errors, 413/413 tests (+ snapshot export), webpack build OK, verify 506/0.
- **Next (owner):** merge, deploy, set `FOODHUB_PUBLIC_CLOVER_ORDER_URL` in Coolify. ON2GO site: repo takatakca/on2goca, branch `feature/on2go-directory`.

## 2026-10-08 06:00 UTC (infra architect agent, task 16: `ci/prebuilt-image`)

- New workflow `.github/workflows/image.yml` ("Food Hub image"): GitHub builds the existing Dockerfile, starts the image
  and checks `/api/health`, then stores it as `ghcr.io/takatakca/foodhubca` (tags `main`, `sha-<short>`, `v*`).
  Pull requests and `ci/**` branches build and test only. No new secret (built-in GITHUB_TOKEN). Dockerfile unchanged:
  Coolify keeps building as today until the owner creates a "Docker Image" resource on `ghcr.io/takatakca/foodhubca:main`.
- First run on the branch: build + smoke test green in 3 min (cold cache), nothing published.
- Checks: typecheck OK, lint 0 errors, 400/400 tests, workflow YAML parsed.
- Owner steps (merge, package visibility, Coolify switch) are in the private hosting plan.

## 2026-10-09 09:45 UTC (Uber API coverage agent, task 22: `feature/uber-api-coverage` → PR #21)
- Every official Uber Eats Marketplace endpoint and webhook and all of Uber Direct are in Food Hub: 61/61 endpoints (was 21), 17/17 webhooks (was 14). Table, scopes and the 176 github.com/uber repos: `docs/UBER_API_COVERAGE.md`.
- Kitchen: Ready / +5 min / prep time go to Uber; Uber missing item and price change in the order drawer; new Stores → Uber Eats tab; Uber Direct proof / PIN options in Settings → Delivery.
- Checks: typecheck OK, lint 0 errors, 475/475 tests, clean webpack build OK, verify:foodhub 508/0 (ports 5499/5500).
- Next: owner merges PR #21 and deploys; owner asks Uber for the optional scopes (doc, Owner steps).

## 2026-10-09 10:15 UTC (Finance A–Z session, task 30: `claude/nostalgic-dhawan-8f5bae`)

**Done**
- **Finance A–Z report** (`scripts/finance-report.ts`, `lib/foodhub/finance/*`; how to use: `docs/FINANCE_REPORT.md`).
  - It reads the owner's exports and the portal scans from git-ignored `private/` only.
  - It builds a workbook with live formulas: P&L per platform / brand / location / month, platform comparison by year,
    GST/QST summary, dispute register, payouts vs bank, money held, to-do.
- **Pure helpers extracted for reuse** (old exports unchanged):
  - `lib/foodhub/brand-match.ts`, now holding main's newer matcher with the 5839 alias and the street fallback;
  - `lib/foodhub/pos/platform-labels.ts`.
- **Checks** (origin/main `ac9848a` merged in):
  - typecheck OK, lint 0 errors, **466/466 tests**, `next build --webpack` OK;
  - Excel recalculation of the workbook: 8,398 formulas, 0 errors, 0 differences.

**Next**
- Owner reviews and merges the PR. No env var, no migration, nothing deployed.
- The per-order exports are being downloaded into `private/finance/inbox/`; the live status is in `private/TASKS.md` row 30.

## 2026-10-08 05:35 UTC (SMTP agent, task 16: `feature/smtp-email`)

**Done:** email can go out by SMTP (the owner's own mailboxes, e.g. MochaHost) as well as Resend. Not merged: the owner reviews and merges.
- One sender, `lib/foodhub/notify/email.ts` (nodemailer). SMTP is used when `SMTP_HOST` + `SMTP_USER` + `SMTP_PASS` are all set (`SMTP_PORT` default 465 = TLS, 587 = STARTTLS; optional `SMTP_SECURE`, `SMTP_TLS_SERVERNAME`); otherwise Resend, as before. 10 s timeout, the password is never logged or returned.
- Sign-in codes, invitations, alerts (`notify`) and reports (`reports.ts`) both go through it. Reports now fall back to `AUTH_EMAIL_FROM` when `REPORT_EMAIL_FROM` is empty.
- `SMTP_*` added next to `RESEND_API_KEY` in `.env.example`, `npm run setup`, Go-live, Alerts, Profile, Reports banner, docs and the privacy page.
- Tests: `tests/email-smtp.test.ts` (SMTP vs Resend vs none, transport mocked, no network). Checks: typecheck, lint 0 errors, 422/422 tests, webpack build OK, verify:foodhub 506/0.
- Owner on Coolify: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` (full mailbox address), `SMTP_PASS`, `AUTH_EMAIL_FROM`; then Settings → Alerts → "Email me" to test.

## 2026-10-09 (IVR agent, task 26: `feature/on2go-phone-ivr`, based on `feature/ai-phone-kitchens`)

- ON2GO phone menu on the main line: greeting (owner's text, editable; safer wording offered), then the AI talks and
  routes with `route_to`; keypad fallback (0 = person, star = repeat, 2 misses → keypad menu); FR / EN / ES.
- Branches: own online order (lookup, ticket, ordering agent), platform order (order number → reference saved → official
  DoorDash line / Uber Eats and Skip help link by text), billing, merchant, courier, customer service, person, voicemail
  (live transcription, ticket, email). Spanish added to the AI ordering agent.
- Screens: Settings → Expansion → AI phone → Menu téléphonique; Own orders → ON2GO line. Docs: EXPANSION_FEATURES §4b.
- Next: owner merges after `feature/ai-phone-kitchens`, sets the two Twilio webhooks and `FOODHUB_IVR_NUMBER`.

## 2026-10-08 05:30 UTC (Food Hub ↔ Clover backend session, task 2: `reconcile-pr6`)

**Done:** PR #6's fixes ported onto `main`'s webhook inbox and Clover retry. No inbox swap.
- **Inbox:**
  - An automatic run never cooks a late order. Past the platform's answer window (or 30 min for relay and Too Good To Go), the order waits for a person.
  - An entry interrupted 5 times goes to a person.
  - A copy saved although Food Hub answered 503 is marked "refused" and never processed.
  - Managers limited to some locations only see and replay theirs.
  - A relay cancel waits for its order.
  - An order stored before a server stop is **finished** by the next delivery or Replay (Clover is checked first) instead of answering "duplicate".
- **Clover retry:**
  - Never sends into a guessed register.
  - Re-reads the order after each send: someone else's copy wins; a cancelled order gets no ticket.
  - One send per order at a time.
  - Stops at the platform deadline or after 30 min.
  - Still retries an order the platform accepted on its side.
- **/api/health:**
  - Computed once per 10 s for the public answer, with a 4 s database limit, using a tiny `sync:at` key.
  - Memory mode in production and a locked console count as "down".
  - Public on the exact path only.
- **Watchtower:**
  - "Order from an unmapped store" incident.
  - Silence alarm counted in opening minutes, Too Good To Go left out.
  - `menu_failed` ignores blocked actions.
  - A webhook waiting for a person now opens an on-screen incident.
- **Go-live:**
  - SESSION_SECRET row: set, 32+ characters, stable. The generation itself stays task 9's.
  - The Clover row stays to-do while a mapped store cannot reach its register.
- e2e section 42b covers the relay, shared menus and a late DoorDash order. 28 new unit tests.
- Task 4: `7e99455` is superseded; branch `claude/brave-sagan-lmgsnp` can be deleted.

**Checks:** typecheck OK, lint 0 errors, 385/385 unit tests, webpack build OK, `verify:foodhub` 492/0.
- The webpack build needs task 9's `public-url.ts` fix: main's own build fails without it. That fix was applied locally for the run, not committed here.

**Next:** merge task 9, then this PR (rerun the webpack build after task 9). PR #6 can then be closed without merging: its fixes are here, and its inbox swap is not wanted.

## 2026-10-07 22:45 UTC (main session)

**Done**
- **PR #7 merged into `main` (`e97c1f7`) and deployed:**
  - It brings in `clover-backend-final`, `clover-marketplace-launch`, `uber-eats-final` and `expansion-features`.
  - Conflicts were resolved by keeping both sides. Only one webhook inbox is kept: clover-backend-final's, plus the Uber
    event_id dedupe and the full Uber event handling.
  - Checks: 357/357 unit tests, build OK, `verify:foodhub` 470/0.
  - Po Poulet NDG lock hole fixed: clearing or re-adding the mapping now returns 409.
  - DoorDash Menu Request now applies the alcohol rules.
- `https://foodhub.on2go.ca` answers (DNS A record → VPS, Coolify domain, HTTPS).

**Found**
- `/api/health` is **down**: the logs say `Supabase: Invalid API key`.
- Earlier builds inlined `NEXT_PUBLIC_SUPABASE_URL` at build time. Built without it, they silently ran in **memory mode**,
  which is why the bad key never showed.
- `main` now reads the URL at run time (from clover-marketplace-launch), so it really connects and the key is refused.
  Owner action: task 1.
- PR #6 was not merged before PR #7. Its comparison of the three inboxes still applies, on top of `main` now (task 2).

**Next**: tasks 1 → 5, then 2 and 3.

## 2026-10-07 16:40 UTC (PR #6 session, copied from its branch)

**Branches found (all based on `main` `a8705ec`; none contains another, none has a PR)**

| Branch | What it has | Overlap |
|---|---|---|
| `expansion-features` | **DoorDash Drive + Uber Direct couriers for our own orders**, auto-dispatch, AI phone ordering, Québec alcohol rules, grocery catalogue | none |
| `clover-backend-final` | Clover-linked lines and modifiers, order types, inbox UI with Replay, **Clover auto-retry with lookup-before-retry** | its own order inbox and Clover retry |
| `uber-eats-final` | Uber activation, menu body and webhook fixes; Uber-only inbox `uber_webhooks` | a third inbox |
| `clover-marketplace-launch` | App Market launch flow, runtime Supabase URL, media volume; generated `SESSION_SECRET` | go-live, `SESSION_SECRET` |

- **Courier dispatch withdrawn on this branch.** It already exists on `expansion-features`; the claim in the 10:05 entry is cancelled.
- **Comparison run (evidence: the PR #6 review's failing tests, run against every branch):**
  - **Order inbox:** keep PR #6's `order_inbox`.
    - It is the only one that refuses a late Clover ticket, caps the retries and covers all five channels.
    - Port into it:
      - from `uber-eats-final`: `handleUberEvent`, with its Uber CANCELED check;
      - from `clover-backend-final`: its DoorDash event classification, its more frequent recovery runs (timer, cron, pulse) with a claim, the auto-retry delays and the replay of unreadable payloads.
    - Drop the other two inboxes.
  - **Clover retry:** keep `clover-backend-final`'s.
    - It is the only one that looks in Clover before re-sending after a lost answer, so a timeout never prints a second ticket.
    - Port into it from PR #6: the re-read after the Clover call (cancelled or settled by hand in the meantime), the platform deadline, the in-process guard, and the "several registers" guard.
    - Drop PR #6's `retryFailedInjections`.
  - **Go-live, `/api/health`, `SESSION_SECRET`:** keep PR #6's.
    - A generated `SESSION_SECRET` breaks when the database is down at boot, on a first boot with two instances, and in memory mode.
    - Port from `clover-marketplace-launch`: the runtime Supabase URL, the media `VOLUME` and the public-URL check.
    - Note: `next build --webpack` fails on `clover-marketplace-launch`.

**Done (this push)** — review fixes that hold whichever way the branches are merged:
- Go-live: Clover, and each platform row, stay to-do while a mapped store cannot reach its register (no merchant, no token, Clover app access expired). The store is resolved exactly as `injectOrder` resolves it.
- `/api/health`: one database check at a time, reused for 10 s; reads a tiny `sync:at` key instead of the whole sync report.
- Order inbox:
  - a 503 whose write actually went through is marked `refused`, so the sweep never cooks an order the platform kept;
  - relay and TGTG orders are not recovered after 30 min (`FOODHUB_INBOX_MAX_AGE_MIN`);
  - a relay cancel for an order still in the inbox now stops its Clover ticket;
  - managers limited to some locations see only their locations' records.
- Watchtower: `menu_failed` no longer counts never-sent ("blocked") actions as refused by a platform.
- Checks: typecheck clean; lint 0 errors; 312 unit tests (7 new regression files); webpack build; e2e 414/414.

**Still open (to do while merging, so nothing is coded twice)**
- Crash after the order was stored but before Clover: recovery and Replay report it as done. Fix it with `clover-backend-final`'s `resendToClover`, which looks in Clover first.
- The Clover retry ports listed above.

**Next**
1. The owner picks who merges the branches: this PR as the integration branch (recommended), or each session in turn.
2. Merge order:
   1. PR #6;
   2. `clover-backend-final` (its retry kept, its inbox dropped);
   3. `uber-eats-final` (its Uber handler kept, its inbox dropped);
   4. `clover-marketplace-launch` (minus the generated `SESSION_SECRET`);
   5. `expansion-features`.
3. Phase 3 look and feel: WIP saved locally on `wf/look` and `wf/kitchen`; finish after the merge.

## 2026-10-07 10:05 UTC

**Done**
- **PR #5, merged into `main` (`a8705ec`):**
  - Food Hub Order Relay, which replaces UrbanPiper.
  - One menu shared by all brands.
  - DoorDash and Uber Eats fixed against their documented APIs.
  - Strict Docker build, in-server sync every 5 minutes.
  - Docs: `docs/BACK_ONLINE_TODAY.md` and `docs/MASTER_PLAN.md`.
- **PR #6, open, CI green on `065fd34`:** Phase 0 + Phase 1, "never lose an order":
  - Durable order intake + Replay (`lib/foodhub/inbox.ts`).
  - `GET /api/health`.
  - Watchtower: `sync_stale` and `menu_failed` now text the managers; new `platform_silent` and `store_unmapped` alarms.
  - Automatic Clover retry: 30 s → 2 min → 5 min.
  - Go-live checklist that tells the truth (Clover merchant really usable, Skip through the relay, `SESSION_SECRET`).
  - End-to-end script: 414 checks (relay, shared menus, health).
  - Unit tests: 302.

**In progress**
- **Independent review of PR #6** (intake, Clover retry and alarms, public endpoints), re-run after the usage limit. Merge after it.
- **Phase 3 look and feel.** Work in progress is saved on two local branches, to be finished, checked with screenshots and merged:
  - `wf/look` (`75f7bef`):
    - Motion tokens and the reduced-motion rule.
    - Contrast.
    - Layered surfaces and card variants.
    - Exit animations for overlays and toasts.
    - Micro-interactions.
    - CountUp, CopyButton.
  - `wf/kitchen` (`d84fc4e`):
    - Kitchen dark theme on `<html>`, so pop-ups and the drawer are dark.
    - 48 px touch targets.
    - Sound banner.
    - TableSkeleton.
    - `loading.tsx` / `error.tsx`.
    - New-order landing animation.

- **(Withdrawn 16:40 UTC: already built on `expansion-features`.) Own-courier dispatch, started 2026-10-07 10:30 UTC on `claude/practical-wright-pnhgtl`, backend first.** Food Hub requests and tracks a courier for the restaurant's own orders:
  - **DoorDash Drive API v2 first.** Research of the API and the code map are under way.
  - **Uber Direct later, behind the same provider interface.** Skip only if they offer a courier-only API.
  - MASTER_PLAN lists this as "own-courier dispatch (DoorDash Drive / Uber Direct)". Do not start it on another branch.

**Coordination**
- Branch `claude/brave-sagan-lmgsnp` (one commit, 07:43 UTC) starts a "durable webhook inbox" and a "Clover auto-retry". Both are already fully built in PR #6, so build on PR #6 instead of starting them again.

**Next (MASTER_PLAN)**
1. Merge PR #6, then redeploy on Coolify from `main`.
2. Finish Phase 3: P0/P1 above, then P2 — page transitions, scroll-linked top bar, Connections strip on the Overview, Go-live stepper, celebrations.
3. Phase 2 needs the owner: platform approvals (Uber scopes, DoorDash `PROVIDER_TYPE`, Skip JET key, TGTG spec) and the Clover App Market submission.
4. Phase 4: Autopilot.

**Owner actions still open** (see `docs/BACK_ONLINE_TODAY.md`):
- Switch the stores back to the platform tablets.
- Redeploy from `main` with the environment variables.
- Set up the uptime monitor on `/api/health`.
- Ask DoorDash to configure the Order Cancellation webhook.
