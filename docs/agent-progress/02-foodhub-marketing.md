# Agent 2 — Food Hub public marketing site

Branch: `feature/foodhub-restaurant-marketing`. This log records this agent's work and verification; branch publication is coordinated without switching the shared integration checkout.

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
