# Promo reels: short product clips from the local demo build

> **En bref (FR)** : `node scripts/promo-reels.mjs` démarre Food Hub **en local** (mode mémoire, plateformes simulées,
> données inventées), filme chaque écran avec Playwright et écrit des clips MP4 de 10, 15 ou 20 s (vertical 1080×1920,
> et paysage 1920×1080 pour les plans principaux) dans `private/video/reels/` (jamais dans git). Rien n'est publié ni
> téléversé : le propriétaire choisit, approuve et publie lui-même.

## What it does

1. Starts the **built** app the same way `scripts/a11y-check.mjs` and `npm run verify:foodhub` do: `next start`,
   `FOODHUB_FORCE_MEMORY=true`, and every outside service (Uber Eats, DoorDash, SkipTheDishes, Clover, Resend, Twilio,
   the screen relay host) pointed at a local stand-in on `127.0.0.1`.
2. Seeds **made-up demo data only**: customers are a first name and an initial, phone numbers are in the 555-01xx
   fiction range, e-mails end in `.test`, store ids start with `demo-`, dishes and prices are invented, kitchen street
   addresses are left blank. Po Poulet is switched off before anything is filmed.
3. Signs in as the demo owner with a one-time code (read from the local mail stand-in), then plays each shot in
   Chromium with `recordVideo`: eased scrolls, taps with a soft touch ring (headless Chromium draws no cursor), a demo
   order arriving on the kitchen screen.
4. ffmpeg trims each take to its exact length and writes H.264, 30 fps, no audio (`-crf 17`, `+faststart`), plus a
   poster PNG. `clips.json` lists what was made.

## Run it

```bash
npx next build --webpack                      # once
npx playwright install --only-shell chromium  # once
npm i --no-save ffmpeg-static@5.2.0           # only if ffmpeg is not on PATH (or set FFMPEG=<path>)
node scripts/promo-reels.mjs                  # every shot → private/video/reels/
node scripts/promo-reels.mjs --only kitchen-new-order,screens-wall --vertical-only
node scripts/promo-reels.mjs --serve          # seed and keep running, to look around (no recording)
```

Options: `--out <dir>`, `--keep-raw` (keep the `.webm` takes), `FOODHUB_REELS_MOCK_PORT` / `FOODHUB_REELS_APP_PORT`
(default 5901 / 5902), `FOODHUB_REELS_HOUR` (the hour the demo clock shows, default 18: the app and the browser share a
fixed-offset zone so the screens show a dinner service whatever time the recording runs).

## Guards

- The browser can only reach `127.0.0.1`; every other request is aborted.
- The text **on screen** is read every 0.4 s for the whole take. A take is refused when it shows Po Poulet, a real
  platform store id from `data/actual/`, a phone number outside 555, or a gmail / hotmail / outlook / yahoo /
  takatak.ca / on2go.ca address. A round-the-clock hours wording on screen is reported so a person checks the clip.
- Anything that must stay out of a shot is blurred at capture time (`blur: [css selectors]` on the shot): the ordering
  page's pickup street line and, on Settings → Business, the deactivated Po Poulet chip. Blurred text is not read.

## Staged on purpose (said in REELS.md next to each clip)

The demo build has no database, so two screens would show "database missing". For these two shots only, the recorder
changes that one answer in the browser to what a real install answers:

- Go-live ring: `mode` of `/api/foodhub/channels` reads `supabase` and the three commission plans read "confirmed".
- Overview → Connections strip: the `database` line of `/api/health` reads "La base de données lit et écrit."

Everything else on screen is the real app answering real (demo) requests.

## Add a shot

Add an entry to `SHOTS` in `scripts/promo-reels-shots.mjs`: `key`, `n` (file number), `seconds` (10, 15 or 20),
`views` (`vertical`, `landscape`, `phone`), `path`, `poster` (seconds), `what` (one line for REELS.md), and `play(h)`.
Call `h.mark()` where the clip starts; use `h.wait`, `h.scrollBy`, `h.scrollTo`, `h.tap`, `h.sendOrder`. Optional:
`popup: false` (no new-order takeover), `fullView`, `public` (no sign-in), `blur`, `before(page)` (routes), `early`.

## Never

Post, upload or schedule anything from this script; commit videos; point it at the production server or a real account.
