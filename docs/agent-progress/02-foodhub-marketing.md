# Agent 2 — Food Hub public marketing site

Branch: `feature/foodhub-restaurant-marketing`. This log records this agent's work and verification; branch publication is coordinated without switching the shared integration checkout.

## 2026-11-04 — native Food Hub contact and owner follow-up

The public-site continuation found two concrete routing/configuration defects: English diner links returned visitors to the French ON2GO homepage, and the production canonical guard accepted malformed hosts, URL credentials, queries or fragments. The diner CTA now follows the page language. Public canonical origins now require a valid DNS hostname and a root HTTPS URL, normalize its host, and fall back without logging a potentially sensitive invalid value.

Food Hub now has native bilingual `/hub/contact` and `/en/hub/contact` enquiries. Sales CTAs lead to the form while copyable support email remains available; actual configured Clover install links keep precedence. Phone AI requests retain the separate product context and selected phone channel through the language switch. Contact pages share the reviewed public shell, canonical/hreflang, sitemap and FAQ data.

The form posts to the existing restaurant-lead pipeline and owner inbox: shared field limits, Canadian province codes, honeypot, IP quota and strict streaming JSON bound. It shows field errors, retains values, honors Retry-After and acknowledges only a valid HTTP202/JSON response. A tab-local nonce contains no contact details; an uncertain outcome freezes the original body/key for a safe retry. Optional durable idempotency prevents a lost acknowledgement from creating another lead or email. Unknown pre-storage attempts remain pending for manual contact; the app never invents successful delivery. A nondurable production instance returns503 with an email fallback. Legacy cross-origin ON2GO requests keep their existing contract. Website URLs containing a username/password are rejected before storage or optional email.

The owner inbox now identifies Food Hub enquiries separately from ON2GO listings, with a source filter and the same owner-only permission. Source-aware optional email copy no longer mislabels Food Hub as an ON2GO listing or promises an unsupported reply deadline. Form submission requests contact about this enquiry; it does not create promotional consent.

Source is frozen at `12dc660c05c08aecbd683f9bc90e5c476274b8e1`. **102 focused tests passed**, including public journeys, legacy leads, contact idempotency/storage errors and legal rendering; scoped ESLint and whitespace checks pass. The coordinated pruned production image built successfully. Final actual-browser verification against that immutable image passed **32 checks with zero page errors** using unmodified application JavaScript: four FR/EN desktop/mobile layouts, four WCAG A/AA scans with zero violations, exact-body/key recovery, focused field errors, Retry-After, malformed acknowledgements, preserved Phone AI context, no-JS email fallback, secure nonce fallback and **20 repeated Phone AI/query/language journeys**. Real PostgreSQL lost-response/restart and single owner-inbox lead proof is recorded separately by the coordinator. [French desktop](evidence/02-marketing/contact/contact-fr-1440.png) · [French mobile](evidence/02-marketing/contact/contact-fr-390.png) · [English desktop](evidence/02-marketing/contact/contact-en-1440.png) · [English mobile](evidence/02-marketing/contact/contact-en-390.png) · [32 browser results](evidence/02-marketing/contact/results.json) · [Image/source provenance](evidence/02-marketing/contact/provenance.json) · [Actual release response](evidence/02-marketing/contact/release.json).

An earlier host review build intermittently raised React #418 during repeated Phone AI/query/language navigation. Development diagnosis did not reproduce an exact mismatch; temporary browser instrumentation was removed and is excluded from acceptance. The final immutable image did not reproduce the warning in its 20 repeated journeys. No source fix for the earlier intermittent warning is claimed, and the final harness retains its strict uncaught-page-error gate.

The real-API browser helper is `scripts/e2e/public-contact-journey.mjs`; the client error/acknowledgement and four-viewport accessibility script is `scripts/verify-public-contact.mjs`. No live submission, external email or production release is claimed.

— signé : Codex, agent 2 @ Codex cloud · 2026-11-04

## 2026-11-04 — all public restaurant journeys verified

Pricing, delivery-platform/Clover integrations, kitchen display, Phone AI and bilingual help now share the reviewed Food Hub editorial experience. The former subpages used inconsistent software naming and overstated unverified provider access. The Phone AI installation and structured Offer also reused Food Hub eligibility; they are now independent.

Implemented the shared editorial shell across all eight page families, including the new `/hub/aide` and `/en/hub/help` routes. Rewrote provider, kitchen and Phone AI copy around configured workflows and actual access/setup/test requirements. Pricing presents Food Hub and Phone AI separately, with their correct billing units. Phone AI install links and structured Offers now require the Phone AI live listing; Food Hub availability cannot activate them. Software metadata consistently names Food Hub, the publisher GROUPE TAKATAK, and the separate protected Clover app names. Existing URLs and provider noindex gates remain intact.

Verification: **72/72** focused public-page/journey/legal tests pass; TypeScript, scoped lint and the coordinated production build pass. Regressions cover all four Food Hub/Phone AI availability combinations, same-page language twins, valid local anchors, help route discovery, distinct plan units and the complete legal minute-counting definition. Strict browser verification of the fresh build passed **32 page states** (all 16 bilingual URLs at desktop/mobile widths), **32 WCAG A/AA axe scans with zero findings**, and **20 linked public destinations**. No page errors, broken images or horizontal overflow were found. Language twins, anchors, native mobile navigation/FAQs and the contact route work. The public support page exposes neither contact environment placeholders nor the unsupported same-day SLA. Source is frozen for publication; no production deployment or provider approval is implied.

The two public-page assertions in `scripts/foodhub-e2e.mjs` were updated with the coordinator's approval: preserve the pending-provider noindex/configured-page indexable distinction while checking the actual activation disclosure, and verify the Food Hub identity in `llms.txt`. No other E2E behavior changed.

Additional journey review found that `/legal/support` exposed configuration placeholders and an unsupported default response-time promise when contact settings were absent. With coordinator approval, marketing/help CTAs and support presentation now use the group's published `support@takatak.ca` address as a fallback, with configured Food Hub email precedence. The public footer shows a copyable address; an unconfigured phone is omitted. Raw environment placeholders and the same-day response promise were removed from the support page. The central legal identity, country, pricing and privacy disclosures were preserved. This provides a usable contact route without claiming that a message was sent or delivered.

### Subpage visual and browser evidence

[Pricing full page](evidence/02-marketing/public-journeys/pricing-fr-1440-full.png) · [Pricing mobile](evidence/02-marketing/public-journeys/pricing-fr-390-hero.png) · [DoorDash connection](evidence/02-marketing/public-journeys/doordash-fr-1440-hero.png) · [Phone AI mobile](evidence/02-marketing/public-journeys/phone-en-390-hero.png) · [Phone AI full page](evidence/02-marketing/public-journeys/phone-en-1440-full.png) · [Help](evidence/02-marketing/public-journeys/help-fr-1440-hero.png) · [Kitchen](evidence/02-marketing/public-journeys/kitchen-fr-1440-hero.png) · [All 32 browser/axe results](evidence/02-marketing/public-journeys/results.json).

All captures are local built-app public-page evidence. Full capture set: `/workspace/platform-review/public-journeys-browser/`. Reproducer: `/workspace/platform-review/check-hub-public-journeys.mjs` with `LANDING_REVIEW_BASE` set to the built review server.

## 2026-11-04 — final source, media and browser review complete

The target is `/hub` in Canadian French and `/en/hub` in English. Sources: current `BRAND.md`, public-hub pricing/legal/SEO code, the GitHub agent board, the existing image/video brief, ON2GO image-library rules, and the recovered media requirements. Food Hub addresses restaurant operators; ON2GO serves diners.

Implemented a restrained editorial page with a genuine, credited restaurant photograph; short bilingual Food Hub copy; operational features; an actual local sandbox tablet-wall capture; setup steps; neutral provider availability; pricing from existing constants; native FAQ; legal links; and a separate ON2GO diner link. The contact CTA works while a Clover installation link is unavailable. It does not claim that all provider accounts are connected or approved.

The video player uses native controls, no autoplay, `preload="none"`, a poster, native caption tracks, a readable description and a clear demo label. Both French and English 30-second films, posters and captions are installed. The footage is actual language-matched Food Hub UI with fictional orders and local simulated relay screens; it does not demonstrate native provider sessions or production API authorization. Media provenance is recorded in `public/hub-media/CREDITS.md`.

Verification: 43 focused marketing tests passed. The coordinated production build and TypeScript checks passed; global unit checks reported 2,091 passed / 12 skipped, and lint reported no errors (one pre-existing devices warning). Actual browser review covered `/hub` and `/en/hub` at 1440, 768, 390 and 360 pixels: eight page states without horizontal overflow, broken images or page errors; working native mobile navigation and FAQ disclosures. Both films and caption/poster routes returned successful public responses, MP4 byte-range requests returned 206, and browser metadata confirmed 30 seconds at 1920 × 1080 with controls and no autoplay.

The visual pass improved mobile reading size and the provider strip, supplied a matching English tablet-wall capture, and corrected contrast and accessible wordmark naming. The final coordinated production rebuild passed. A strict rerun against that fresh build passed all eight FR/EN viewport states; two WCAG 2/2.1 A/AA axe scans returned **zero violations**. No browser page errors, broken images or horizontal overflow were found. Native mobile navigation and FAQ controls worked. All eight media route/metadata checks passed again. The two public posters were compared by SHA-256 to the final steady-frame exports and matched exactly.

Final source and assets are frozen for branch publication. No source checkout switches, shared-tree commits, production credentials, native provider sessions or deployment were changed by this agent. Production deployment has not been verified.

Review artifacts are stored outside the checkout at `/workspace/platform-review/marketing-browser/` (eight viewport and eight full-page screenshots, section details and JSON results). The reproducible browser script is `/workspace/platform-review/check-hub-marketing.mjs`, using `LANDING_REVIEW_BASE` for the built review server. Next: root publishes this agent's reviewed source on `feature/foodhub-restaurant-marketing`; production release follows the existing deployment process and live verification.

— Codex, agent 2 @ cloud, 2026-11-04

## Published visual evidence

![Final French desktop hero](evidence/02-marketing/fr-1440-hero.png)

[Full page](evidence/02-marketing/fr-1440-full.png) · [French mobile](evidence/02-marketing/fr-390-hero.png) · [English mobile](evidence/02-marketing/en-390-hero.png) · [Browser/media results](evidence/02-marketing/results.json). These are local built-app review captures.
