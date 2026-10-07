# Clover App Market launch — TAKATAK Food Hub

_Updated 2026-10-07 · branch `clover-marketplace-launch`._

Requirements come from Clover's Global Developer Platform pages on docs.clover.com (pages dated March to September
2026, read on 2026-10-07; links in §10). Anything Clover does not state on an official page is marked **to confirm**.

Companion files:
- [`CLOVER_APP_LISTING.md`](CLOVER_APP_LISTING.md): every text to paste.
- [`CLOVER_APP.md`](CLOVER_APP.md): how the app works.
- [`clover-listing/`](clover-listing/): icon, cover and screenshots.

In the console, **Settings → Clover app** checks most of this list live. It also shows every text and address with a
Copy button.

Legend:
- ✅ done in the code;
- 🟡 ready, waiting for an owner action;
- 👤 owner-only (a dashboard, an account, a decision);
- ❓ to confirm with Clover.

---

## 0. In one minute

- **The code is ready for Clover's review.** Clover's reviewers will:
  - install the app on their own test merchant;
  - open it from the Clover dashboard;
  - expect onboarding pre-filled from the merchant's data;
  - check that orders reach Clover correctly (line items, open → paid, totals and tax).

  This branch makes each of those work:
  - the dashboard launch flow;
  - a bilingual welcome wizard filled from the merchant's own Clover;
  - an alert to you when a merchant waits for approval;
  - a **Send a test order** button that creates, prints and pays a TEST order in the reviewer's Clover.
- **What only you can do** (§4):
  1. Point **foodhub.takatak.ca** at the server.
  2. Set the support email and phone.
  3. Have the legal pages reviewed.
  4. Record the functional video.
  5. Fill in the Clover dashboard.
  6. Click **Submit for Approval**.
- **Two decisions before submitting:**
  1. Public listing or private app (§3).
  2. The Québec sales-recording (SRM) question for restaurant categories, to ask Clover (§5).

---

## 1. How Clover's approval works

1. **Developer account approved for each market.**
   - You choose Individual or Business; for a business: tax country, tax ID, legal name and address.
   - Identity check: a home address that matches a utility bill or bank statement. Canadian developers may use a
     driver's licence.
   - Clover runs an OFAC check, at approval and then monthly. Documents Clover asks for are due within 10 business days.
   - Only the account **Owner** accepts the Developer Agreement.
   - Your account must be approved for **Canada** and the **United States** before you can submit for those markets.
2. **App created in production** (not only in sandbox), with its subscription countries.
3. **Overview:** a **Functional Description** and a **Functional Video URL** (both required).
4. **App Settings:**
   - REST configuration: Site URL, Alternate Launch Path, OAuth.
   - Permissions, each with a reason.
   - Webhooks.
5. **App Market Listing**, one tab per language and country.
6. **Pricing:** every app needs a plan, even a free one.
7. **Submit App:** complete the checklist (App Settings, Market Listing, Releases), then **Submit for Approval**. The
   status becomes *Pending*.
8. **Review, in three stages:**
   1. functional: video, description, permissions, REST configuration, webhooks;
   2. legal: privacy policy, EULA;
   3. listing: icon, texts.

   Statuses you will see: Draft, Pending, Under review, Changes Required, Approved, Published, Rejected, Denied.
9. When it is **Approved**, click **Publish to App Market**. Any later edit of an approved app is reviewed again
   (category changes are approved automatically).

**Timeline:** Clover only says it "can vary" (❓). Plan for several weeks, and answer Clover's messages quickly: not
answering is a listed rejection reason.

**Common rejection reasons Clover lists:**
- the app crashes or fails tests;
- the video does not show the whole integration;
- a permission without a justification;
- generic legal documents;
- an incomplete listing or a bad icon;
- another payment processor, surcharging, or the developer handling money;
- not answering the Clover team.

---

## 2. Every requirement and where it stands

### 2.1 Account, app and regions

| Requirement | Status | Detail |
|---|---|---|
| Developer account approved for Canada and US | 👤 | Clover developer dashboard → account. Check both markets show approved. |
| App created in **production**, App ID `629HFYHNVMZYR` | ✅ / 👤 | Created 2026-10-05 as REST Clients → Web, Canada + US. Confirm both subscription countries are ticked. |
| App name has no "Clover" | ✅ | "TAKATAK Food Hub" (checked by a test). |
| Bank account (paid apps only) | n/a | Free app. Needed only if you add a paid plan later (Owner/Admin, after approval, 2FA on). |

### 2.2 Authentication and launch

| Requirement | Status | Detail |
|---|---|---|
| OAuth v2 with expiring tokens (mandatory in North America since 31 March 2025) | ✅ | `lib/foodhub/pos/clover-oauth.ts`: `/oauth/v2/token`, `/oauth/v2/refresh`, refreshed 5 min before expiry, one refresh at a time (refresh tokens are single-use). |
| High-trust flow (server keeps the secret); PKCE only for low-trust apps | ✅ | The App Secret stays on the server (`CLOVER_CLIENT_SECRET`). No PKCE needed. |
| Production vs sandbox hosts | ✅ | `CLOVER_BASE_URL` decides: `www.clover.com` / `api.clover.com`, or `sandbox.dev.clover.com` / `apisandbox.dev.clover.com`. |
| Alternate Launch Path set; same domain as the Site URL | ✅ / 🟡 | `/api/foodhub/clover-connect/callback`. Paste it in App Settings (already set). |
| **Launch from the dashboard / App Market without a code** → the app calls `/oauth/v2/authorize` | ✅ **new** | The callback now sends the browser to Clover's authorize page with a signed, stateless "launch" state (HMAC with the app secret, 15 min). It never loops: a second visit without a code shows an error page. |
| `redirect_uri` is HTTPS and under the Site URL | ✅ | Built from `FOODHUB_PUBLIC_URL`. |
| Onboarding pre-filled from the merchant's data | ✅ **new** | At connect time Food Hub reads, never writes: the merchant profile (name, city), a count of items, categories, order types, tenders and devices, and the App Market subscription. The welcome page shows them. |
| Uninstall removes access | ✅ | App webhook `A:<appId>` DELETE deletes the tokens. Clover also invalidates the code. |
| No test API tokens in production | 🟡 | The app uses OAuth. Your own merchant may still use `CLOVER_ACCESS_TOKEN`; that is fine for your restaurants, but the reviewer only sees the OAuth path. |

### 2.3 Permissions (least privilege)

| Permission | Status | Why it is needed (reason to paste: `CLOVER_APP_LISTING.md`) |
|---|---|---|
| Merchant R/W | ✅ / 🟡 | Read: name and address, App events. Write: one tender per platform. |
| Inventory R/W | ✅ / 🟡 | Read: menu import, sold-out sync. Write: kitchen printer labels, only on the owner's click. |
| Orders R/W | ✅ / 🟡 | Write: create orders, order types, print; remove a cancelled unpaid order. Read: daily totals and platform orders created by Clover's own integrations. |
| Payments R/W | ✅ / 🟡 | Write: record the platform payment (custom tender, no card). Read: payout check. |

> Changing permissions after merchants installed the app makes them uninstall and reinstall. Keep these four as they are.

### 2.4 Webhooks

| Requirement | Status | Detail |
|---|---|---|
| HTTPS, public, answers 200 within seconds | ✅ | `/api/foodhub/webhooks/clover` answers at once. The work runs in the background. |
| Verification code flow | ✅ | The code is stored and shown in Settings → Platforms & Clover; paste it back in Clover. |
| `X-Clover-Auth` checked on every event | ✅ | Constant-time compare with `CLOVER_WEBHOOK_AUTH`; anything else gets a 401. |
| App events: install, uninstall, subscription change | ✅ **new** | CREATE is logged, DELETE removes the tokens, UPDATE re-reads `billing_info`. |
| Inventory events | ✅ | Item out of stock → 86 on every platform, and back when it returns. |
| Set the URL, events (Inventory, App), verify | 👤 | Clover dashboard, once the domain is live (§4 step 5). |

### 2.5 Billing and pricing

| Requirement | Status | Detail |
|---|---|---|
| A plan for every market, free allowed | 👤 | Choose **Free (0.00)** for Canada and the US. Clover may follow up about monetizing. |
| All fees through Clover billing, none outside | ✅ | The terms now say any fee for the Clover app goes through Clover's billing only. Food Hub charges nothing. |
| Read the merchant's subscription (`GET /v3/apps/{appId}/merchants/{mId}/billing_info`) | ✅ **new** | Read at connect time and on each App UPDATE. Shown on the welcome page and in Settings → Clover app. Nothing is blocked by it: the app is free. If you add a paid plan later, decide then what a lapsed merchant loses. |
| Prices in CAD for Canada; trial lengths | n/a | Only if you add a paid plan. |

### 2.6 Listing content

| Requirement | Status | Detail |
|---|---|---|
| Tagline ≤ 255, 3–5 benefits ≤ 100 each, description stating requirements | ✅ | `lib/foodhub/clover-listing.ts` and `CLOVER_APP_LISTING.md`. A test checks the limits and that both files say the same thing. |
| French (Canada) + English (Canada) + English (US) tabs | 🟡 | FR-CA and EN-US were saved on 2026-10-05. Add **EN-CA**, and update all three with the new texts (the description now has a requirements paragraph). |
| Icon: square PNG, no Clover/Fiserv marks, cannot be deleted | ✅ | `clover-listing/icon-512.png` (already uploaded). |
| Cover image 1080 × 216 (optional, cannot be deleted) | ✅ | `clover-listing/cover-1080x216.png`. It carries no Clover mark. Upload it only if you like it: it is permanent. |
| Screenshots ≤ 1920 × 1080, ≥ 320 px | ✅ | `clover-listing/fr/` and `en/`: 11 each at 1920 × 1080, from the demo (simulated data). Replace the 8 already uploaded. |
| Listing video (optional) | 👤 | Can reuse the functional video. |
| Categories: ≥ 1 functional (≤ 3) and ≥ 1 vertical | 👤 ❓ | Orders & Delivery, Items & Inventory, Kitchen Operations / Quick Service and Full Service Restaurant. **For Canada, wait for the SRM answer (§5).** |
| Functional description | ✅ / 👤 | In Settings → Clover app, with your support email filled in. Paste it on the Overview page. |
| Functional video | 👤 | Script in §6. |

### 2.7 Legal and support

| Requirement | Status | Detail |
|---|---|---|
| Privacy policy URL, not generic; Canadian law, PIPEDA | ✅ / 👤 | `/legal/privacy`, French first. Covers Québec Law 25, PIPEDA, transfers outside Québec, retention, rights and the incident duty. **New:** the onboarding read, cookies, and US merchants (service-provider wording). Draft until reviewed. |
| EULA / terms URL, not generic | ✅ / 👤 | `/legal/terms`: licence, approval, liability, Québec law, French prevails. **New:** Clover-billing-only fees and a trademarks clause. Draft until reviewed. |
| Support website with FAQ, privacy, terms, email and phone | ✅ **new** | `/legal/support`: email, phone, hours, 7 FAQs in French and English, links to privacy and terms. |
| Support email and phone (both required), hours | 👤 | `FOODHUB_SUPPORT_EMAIL` and `FOODHUB_SUPPORT_PHONE`; hours default to Mon–Fri 9–5 ET (`FOODHUB_SUPPORT_HOURS`). The email domain must not contain "clover". |
| Legal pages approved | 👤 | After review: `FOODHUB_LEGAL_APPROVED=true`, and the yellow banner goes away. Name a privacy officer with `FOODHUB_PRIVACY_OFFICER` (Law 25 expects a title; a name is better). |

### 2.8 Security, quality, Canada

| Requirement | Status | Detail |
|---|---|---|
| HTTPS (TLS 1.2+) on your own domain | 🟡 | The server still answers on its temporary sslip.io address. A Site URL change after approval goes back to review, so **move to `foodhub.takatak.ca` before submitting**. Settings → Clover app and Go-live flag sslip.io, IP addresses, localhost and "clover" in the host. |
| Rate limits (50/s per app, 16/s per token; 5 concurrent per token); back off on 429 | ✅ **new** | Every Clover call goes through `cloverFetch`: on a 429 it waits for Retry-After (5 s at most), else 1 s then 2 s. The onboarding read uses at most 5 concurrent calls. |
| Tokens never in URLs or the browser | ✅ | Tokens stay in `fh_kv` (Supabase, service role, RLS on). APIs never return them; the e2e checks this. The welcome page uses a signed ticket, not the merchant ID, and sends no Referer. |
| No other payment processor, no surcharge, no data selling | ✅ | Food Hub takes no payment; the privacy policy says it sells no data. |
| Accessibility: contrast ≥ 4.5:1, alt text | ✅ **new** | The secondary text colour (`ink-3`) was darkened to reach 4.5:1. Decorative images use empty alt text. |
| **Every merchant-facing screen in French and English (Québec)** | ✅ | Console, welcome wizard (language switch), legal pages, error codes and test-order results all exist in both languages. The disconnect confirmation was English-only; fixed. |
| **Restaurant apps certified under Revenu Québec's SRM mandate** | ❓ 👤 | See §5. Food Hub does not bill customers; the question is whether Clover applies the rule to it. |
| Merchant plans: the app needs Inventory and Orders | ✅ / ❓ | The welcome page flags a register whose plan does not expose them. Clover's international page says Canada has "Payments Plus" and "Register Lite"; confirm with DevRel which Canadian plans can install the app. |
| Functional test path for reviewers | ✅ **new** | Install → open → welcome page pre-filled → you approve (alert sent) → **Send a test order** → uninstall. The e2e checks every step against simulated Clover (verify step 37). |

---

## 3. Decision: public listing or private app

| | Public listing (current setup) | Private app |
|---|---|---|
| Visible in the App Market | Yes | No: installed from a link (`https://www.clover.com/oauth/authorize?client_id=<APP_ID>`) |
| Clover review | Yes | Yes (production approval still required) |
| Who can install | Anyone. Food Hub keeps unknown merchants **pending** until you approve them | Only merchants you give the link to |
| Billing through Clover | Possible later | No ("discussed during review") |
| Fits Food Hub today | Yes: it is a B2B app that requires an account, like many App Market apps | Yes: your own restaurants only |

**Recommendation:** submit as a **public** listing, as planned.
- The description says plainly that a TAKATAK Food Hub account is required and that new restaurants are approved
  first.
- The reviewer gets a working path through your approval and the test order.
- If Clover objects to the approval gate, or if the SRM rule cannot be met for Canada, ask DevRel to convert the app
  to **private**. The code works the same way in both cases.

---

## 4. Owner-only steps, in order

Nobody else should do these: they touch your accounts, your DNS and your legal commitments. Keys are typed on the
server with `npm run setup`, never in a chat.

1. **DNS.** At the DNS host of `takatak.ca`, create an `A` record `foodhub` → the VPS address. The address is in
   `private/OPS_LOG.md` (the server in the sslip.io name).
2. **Deploy this branch** after you merge the pull request: `deploy/update-vps.sh` on the VPS, or re-run
   `deploy/install-vps.sh foodhub.takatak.ca` so Caddy/Traefik gets the HTTPS certificate for the new name.
3. **`npm run setup` on the server:**
   - `FOODHUB_PUBLIC_URL=https://foodhub.takatak.ca`
   - `FOODHUB_SUPPORT_EMAIL`: a support address on your domain, not on a "clover" domain
   - `FOODHUB_SUPPORT_PHONE`
   - optional: `FOODHUB_SUPPORT_HOURS`
   - `FOODHUB_PRIVACY_OFFICER`
   - check `FOODHUB_LEGAL_ADDRESS`

   Restart. **Settings → Clover app** should show the domain as ✅.
4. **Legal review.** Read `/legal/privacy`, `/legal/terms` and `/legal/support` with your adviser. Then set
   `FOODHUB_LEGAL_APPROVED=true` and `FOODHUB_LEGAL_UPDATED` to the date of the reviewed version.
5. **Clover developer dashboard → app 629HFYHNVMZYR → App Settings.** Copy every address from Settings → Clover app.
   - Site URL: `https://foodhub.takatak.ca`
   - Alternate Launch Path: `/api/foodhub/clover-connect/callback`
   - Default OAuth Response: `CODE`
   - Webhook URL: `https://foodhub.takatak.ca/api/foodhub/webhooks/clover`, with events **Inventory** and **App**
   - Then **Send Verification Code**, paste back the code shown in Food Hub, and put Clover's auth code in
     `CLOVER_WEBHOOK_AUTH` (`npm run setup`).
6. **Permissions:** paste the four reasons.
7. **App Market Listing:**
   - Tabs FR-CA, EN-CA and EN-US: tagline, benefits, description.
   - Replace the screenshots with `clover-listing/fr` and `en`.
   - EULA and privacy URLs on the new domain.
   - Categories (after §5).
   - Developer Support: email, phone, website `https://foodhub.takatak.ca/legal/support`, hours.
   - Optional: the cover image.
8. **Pricing:** a free plan for Canada and the United States.
9. **Functional video** (§6): upload it to YouTube or Vimeo as **unlisted**.
10. **Overview:** paste the functional description from Settings → Clover app, and the video URL.
11. **Test** (§7) in sandbox and on your own merchant.
12. **Send the SRM question** (§5) and wait for the answer before choosing categories for Canada.
13. **Submit App → Submit for Approval.**
    - During the review, keep an eye on the "Clover merchant waiting" alerts (team chat and email).
    - Approve the reviewer's test merchant (Settings → Platforms & Clover).
    - Answer Clover within a day or two.
14. **After approval:**
    - Click **Publish to App Market**.
    - Then **disconnect the reviewer's test merchant**. An approved merchant is synced like your own (its Clover
      sales would appear in your analytics).

---

## 5. Question for Clover Developer Relations (SRM, plans)

Clover's international readiness page says hospitality, full-service and quick-service restaurant apps must be
certified under Revenu Québec's SRM mandate. Draft to send from the developer account's email to
`developer-relations@devrel.clover.com`:

> **Subject:** TAKATAK Food Hub (App ID 629HFYHNVMZYR) — SRM requirement and Canadian plans
>
> Hello,
>
> Before we submit TAKATAK Food Hub (REST web app, Canada and United States), we would like to confirm two points.
>
> 1. **SRM (Revenu Québec).** Your international readiness page says restaurant apps must be certified under Revenu
>    Québec's sales recording module mandate. Food Hub does not take payments or produce customer bills. It receives
>    orders that Uber Eats, DoorDash and SkipTheDishes have already billed to their customers. It creates them in the
>    merchant's Clover with a platform order type, prints the kitchen ticket, and records the platform's payment with
>    a custom tender. Does the SRM requirement apply to an app like this? If yes, can it be listed for Canada under a
>    non-restaurant category, or for the United States only until certification?
> 2. **Plans.** Food Hub needs Inventory and Orders. Which Canadian merchant plans can install it?
>
> Thank you,
> [name] — Quadro Holdings LTEE

Until the answer arrives:
- choose the categories for the **US** tab only;
- keep Canada with functional categories, and add a vertical category once Clover answers.

---

## 6. Functional video script (about 3 minutes, screen recording with voice-over)

Clover rejects a video that does not show the whole integration. Record on your production merchant, or on a sandbox
merchant with the demo platforms. Show the Clover device or Clover web dashboard next to Food Hub.

| # | Show | Say (EN; record a FR version too if you like) |
|---|---|---|
| 1 | Clover App Market → TAKATAK Food Hub → Install (or the app already installed) | "TAKATAK Food Hub connects Uber Eats, DoorDash and SkipTheDishes to Clover, without an aggregator." |
| 2 | Clover dashboard → open the app → the Food Hub welcome page | "Opening the app runs Clover OAuth; Food Hub reads the register and the subscription, read-only, and shows what it found." |
| 3 | The 3 set-up steps; Settings → Platforms & Clover | "The restaurant connects its platforms, imports its Clover menu and enrols a kitchen tablet." |
| 4 | Menus → Import from Clover → the master menu | "Items, categories and modifiers come from Clover inventory." |
| 5 | A platform order arrives (sandbox or demo): the pop-up, accept | "A delivery order arrives and is accepted in one tap." |
| 6 | Clover: the new order with the "Uber Eats" order type, line items, modifier, note; the kitchen ticket printing | "Food Hub creates it in Clover with the platform's order type and prints the kitchen ticket." |
| 7 | Mark Ready → Picked up; Clover: the order is paid with the "Uber Eats" tender | "When the courier leaves, the order is recorded as paid with the platform tender, so the closeout is right. No card is processed." |
| 8 | Clover inventory: mark an item out of stock → Food Hub 86 board / platform menu | "An item out of stock in Clover is taken off every platform." |
| 9 | Welcome page → Send a test order → the three green steps | "Any approved merchant can check the whole path with a test order." |
| 10 | Clover → uninstall the app → Food Hub shows the merchant disconnected | "Uninstalling deletes the merchant's tokens at once." |

---

## 7. Test before submitting

**Automated** (this branch, all green):
- `npm run check`: typecheck, lint and 262 unit tests;
- `npm run build`;
- `npm run verify:foodhub`: 391 end-to-end checks against simulated Uber Eats, DoorDash, Skip and Clover. Step 37
  covers launch without a code, the signed welcome link, a forged ticket, pending → approved, the test order, tokens
  hidden, and uninstall.

**Manual, sandbox:**
1. Create the same app on `sandbox.dev.clover.com` with the same Site URL and launch path. Run a staging copy with
   `CLOVER_BASE_URL=https://apisandbox.dev.clover.com`.
2. Install the app on a sandbox test merchant and open it from the dashboard. You should see:
   - the welcome page says **Request received**, with the register check;
   - you receive the chat or email alert.
3. Approve the merchant in Settings → Platforms & Clover. Reload the welcome page: it says **connected**.
4. Press **Send a test order**. In the sandbox merchant you should see:
   - the order with the Uber Eats order type;
   - its ticket in the print queue;
   - its payment with the "Uber Eats" tender, matching Clover's own total including tax.
5. Uninstall the app. The merchant disappears from Settings → Platforms & Clover.

**Manual, production:**
1. Open the app from your own merchant: it is trusted, so the page says **connected** at once.
2. Send a test order and check the ticket prints. Then delete the TEST order in Clover if you want a clean day.

---

## 8. What this branch changed

| Area | Files |
|---|---|
| Launch flow without a code, error codes, onboarding read, billing_info, owner alert, welcome ticket | `lib/foodhub/pos/clover-oauth.ts`, `app/api/foodhub/clover-connect/callback/route.ts`, `lib/foodhub/session.ts` |
| Welcome wizard (FR/EN switch, register snapshot, 3 live steps, celebration) | `app/welcome/clover/page.tsx`, `app/welcome/clover/welcome-view.tsx`, `lib/foodhub/onboarding.ts`, `app/globals.css` |
| Send a test order | `lib/foodhub/pos/clover-test-order.ts`, `app/api/foodhub/clover-connect/test-order/route.ts`, `lib/foodhub/pos/clover-books.ts`, `proxy.ts` |
| 429 back-off on every Clover call | `lib/foodhub/pos/clover-http.ts` (+ clover, books, labels, platform-orders, oauth) |
| Settings → Clover app (listing kit) | `app/(console)/settings/clover-app/page.tsx`, `lib/foodhub/clover-listing.ts`, `app/(console)/settings/settings-ui.tsx` |
| Domain check, no hard-coded host | `lib/foodhub/public-url.ts` (every URL comes from `FOODHUB_PUBLIC_URL`) |
| Go-live | Clover needs a connected merchant; a platform on the Order Relay counts as done; domain and listing steps (`app/(console)/settings/go-live/page.tsx`) |
| Legal and support | `app/legal/support/page.tsx` (hours, phone, FAQ), `app/legal/privacy/page.tsx`, `app/legal/terms/page.tsx`, `lib/foodhub/legal.ts` |
| Phase 0 deploy traps | Supabase URL read at run time (`lib/supabase/server.ts`), `SESSION_SECRET` generated in production (`lib/foodhub/runtime-secrets.ts`), media `VOLUME` (`Dockerfile`), `.env.example`, setup wizard |
| Fixes found on the way | A zero alert volume crashed the console (`lib/ui/sound.ts`); English-only disconnect confirmation; contrast token |
| Tests | `tests/clover-app.test.ts`, `tests/clover-marketplace.test.ts`, e2e step 37 |
| Assets | `docs/clover-listing/` (icon, cover, 11 + 11 screenshots) |

---

## 9. Known limits and risks

- **Approval gate.** A reviewer's merchant needs your approval before the test order works. You are alerted at once
  (team chat and email, if configured), but a slow answer stalls the review.
- **Approved merchants join your Food Hub.** Food Hub is single-tenant: an approved merchant's Clover sales and
  platform orders are synced into your console. Disconnect review merchants after approval. A multi-tenant mode is
  Phase 5 work.
- **The test order uses "Uber Eats" labels.** It creates the "Uber Eats" order type and tender in the merchant's
  Clover, as a first real order would. The order is titled `Uber Eats #TEST-…` and is never read back into Food Hub.
- **Tokens are stored without encryption** in the database (`fh_kv`). Only the service role can read it, and RLS is
  on. Clover does not state an encryption requirement (to confirm). Encrypting with a server key is an optional
  hardening step.
- **Site URL changes go back to review.** Set the final domain before submitting.
- **Review time is not published.** Plan for weeks.
- **Public repository.** The current docs and tests no longer carry real merchant IDs, developer account details or
  server-only records. Older commits still contain the merchant ID and the developer account email. A merchant ID is
  not a credential, but rewriting history (or making the repository private) is your call.

---

## 10. Sources (docs.clover.com, read 2026-10-07)

- Submit your app for approval — https://docs.clover.com/dev/docs/gdp-submit-your-app-for-approval
- App approval statuses and rejection reasons — https://docs.clover.com/dev/docs/developer-app-approval-archive
- Functional review playbook — https://docs.clover.com/dev/docs/clover-functional-review-playbook
- App approval and App Market FAQs — https://docs.clover.com/dev/docs/app-approval-and-app-market-faqs
- Expiring tokens required — https://docs.clover.com/dev/docs/expiring-tokens-required-in-all-regions
- High-trust auth flow — https://docs.clover.com/dev/docs/high-trust-app-auth-flow
- Low-trust apps (PKCE) — https://docs.clover.com/dev/docs/oauth-flow-for-low-trust-apps-pkce
- Dashboard left-navigation OAuth flow — https://docs.clover.com/dev/docs/merchant-dashboard-left-navigation-oauth-flow
- Site URL, launch path, CORS — https://docs.clover.com/dev/docs/using-cors
- Refresh tokens — https://docs.clover.com/dev/docs/refresh-access-tokens
- OAuth and tokens FAQs — https://docs.clover.com/dev/docs/oauth-and-tokens-faqs
- App permissions — https://docs.clover.com/dev/docs/gdp-set-app-permissions
- Modules and plans — https://docs.clover.com/dev/docs/understanding-modules
- Webhooks — https://docs.clover.com/dev/docs/webhooks
- Monetizing apps — https://docs.clover.com/dev/docs/monetizing-your-apps
- Pricing tiers — https://docs.clover.com/dev/docs/gdp-set-up-pricing-tiers
- Billing for apps (billing_info) — https://docs.clover.com/dev/docs/billing-for-apps
- App administration checklist — https://docs.clover.com/dev/docs/app-administration-checklist
- App Market listing — https://docs.clover.com/dev/docs/gdp-set-clover-app-market-listing
- International readiness (Canada, SRM, French) — https://docs.clover.com/dev/docs/international-app-market-readiness
- Rate limits — https://docs.clover.com/dev/docs/api-usage-rate-limits
- Basic app configuration — https://docs.clover.com/dev/docs/basic-app-configuration
- App design requirements — https://docs.clover.com/dev/docs/app-design-requirements
- Developer account approval — https://docs.clover.com/dev/docs/submit-global-developer-account-for-approval
- Multiple markets — https://docs.clover.com/dev/docs/multiple-markets
- Private apps — https://docs.clover.com/dev/docs/gdp-work-with-private-apps
