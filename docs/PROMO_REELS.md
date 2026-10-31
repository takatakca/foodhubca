# Promo reels: short product clips from the local demo build

> **En bref (FR)** : `node scripts/promo-reels.mjs` démarre Food Hub **en local** (mode mémoire, plateformes simulées,
> données inventées), filme chaque écran avec Playwright et écrit dans `private/video/reels/` (jamais dans git) des clips
> de 10 à 20 s et des extraits courts de 5 à 8 s (vertical 1080×1920, carré 1080×1080 pour les meilleurs, paysage
> 1920×1080 pour les plans principaux). Message : « Fais-le toi-même avec notre système — fini les maux de tête et
> l'argent perdu. » Rien n'est publié ni téléversé : le propriétaire approuve et publie chaque reel lui-même.

## The library (private/video/reels/, git-ignored)

- **47 MP4 files + a poster PNG each** in one folder (run of 2026-10-31):
  - 15 full clips of 10, 15 or 20 s, numbers **001–011**: 11 vertical 1080×1920 + 4 landscape 1920×1080 (kitchen new
    order, platform screens wall, orders board, overview + Connections);
  - 32 short cuts of 5 to 8 s, numbers **101–122**: 22 vertical 1080×1920 + 10 square 1080×1080 (a new order landing and
    ringing, one-tap accept, the screens wall going from 8 to 16 views, go-live at 100 %, an Autopilot switch, picking a
    brand colour, the brand stripes in the kitchen, "make it a meal" on the ordering page, the tablet app page…).
- **Names:** `<NNN>-<theme>-<seconds>s-<vertical|square|landscape>.mp4` (+ `.png` poster). The same number is the same
  moment in another format. `clips.json` lists every file with what it shows and where a cut comes from.
- **Format:** H.264, 30 fps, no audio, full-resolution frames.
- **REELS.md** (same folder): per file, what it shows, a caption in French then English around the owner's message
  ("Fais-le toi-même avec notre système — fini les maux de tête et l'argent perdu" / "Do it yourself with our system —
  save the headaches and the money"), at most 5 hashtags, and a Runway prompt for a 5–8 s generation that keeps the real
  screen readable and never invents a feature; then a posting plan.
- **Caption rules:** benefit first; never "first", never a round-the-clock opening claim, never "virtual / ghost
  kitchen", never a delivery platform's or a competitor's name, no number or saving that cannot be proven.
- **Posting rules:** one post per day per account (TAK on Facebook, TAK on Instagram), never the same clip on both the
  same day, the owner approves every post, posted by hand or scheduled by him in Meta Business Suite, within Meta's
  normal use (no bulk uploads, no automation, no engagement bait). Runway is run by the owner; the script never calls it.

## What the script does

1. Starts the **built** app the same way `scripts/a11y-check.mjs` and `npm run verify:foodhub` do: `next start`,
   `FOODHUB_FORCE_MEMORY=true`, and every outside service (Uber Eats, DoorDash, SkipTheDishes, Clover, Resend, Twilio,
   the screen relay host) pointed at a local stand-in on `127.0.0.1`.
2. Seeds **made-up demo data only**: customers are a first name and an initial, phone numbers are in the 555-01xx
   fiction range, e-mails end in `.test`, store ids start with `demo-`, dishes and prices are invented, kitchen street
   addresses are left blank. Po Poulet is switched off before anything is filmed. The relay host's tiles are neutral
   placeholders ("Tablette de commandes", a slot number, a clock): no platform screen is ever filmed.
3. Signs in as the demo owner with a one-time code (read from the local mail stand-in), then plays each shot in
   Chromium with `recordVideo`: eased scrolls, taps with a soft touch ring (headless Chromium draws no cursor), a demo
   order arriving on the kitchen screen.
4. ffmpeg trims each take to its exact length (H.264, 30 fps, no audio, `-crf 17`, `+faststart`) with a poster PNG,
   then cuts the 5–8 s moments listed in `CUTS` (vertical, plus a square crop where set) and writes `clips.json`.

Playwright's video is a screencast at CSS size: with an emulated device scale alone, an 810×1440 page fills only three
quarters of a 1080×1920 video. The recorder therefore launches one Chromium per scale with
`--force-device-scale-factor` (4/3 for the console views, 2.5 for the phone), which gives full-size, sharp frames.

## Run it

```bash
npx next build --webpack                      # once
npx playwright install --only-shell chromium  # once
npm i --no-save ffmpeg-static@5.2.0           # only if ffmpeg is not on PATH (or set FFMPEG=<path>)
node scripts/promo-reels.mjs                  # every shot + every cut → private/video/reels/
node scripts/promo-reels.mjs --only kitchen-new-order,screens-wall --vertical-only
node scripts/promo-reels.mjs --cuts-only      # no server: re-cut the 5–8 s moments from the clips already there
node scripts/promo-reels.mjs --serve          # seed and keep running, to look around (no recording)
```

Options: `--out <dir>`, `--keep-raw` (keep the `.webm` takes), `--no-cuts`, `FOODHUB_REELS_MOCK_PORT` /
`FOODHUB_REELS_APP_PORT` (default 5901 / 5902), `FOODHUB_REELS_HOUR` (the hour the demo clock shows, default 18: the app
and the browser share a fixed-offset zone so the screens show a dinner service whatever time the recording runs).

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

## Add a shot or a cut

Shot: an entry in `SHOTS` (`scripts/promo-reels-shots.mjs`): `key`, `n` (file number), `seconds` (10, 15 or 20), `views`
(`vertical`, `landscape`, `phone`), `path`, `poster` (seconds), `what`, and `play(h)`. Call `h.mark()` where the clip
starts; use `h.wait`, `h.scrollBy`, `h.scrollTo`, `h.tap`, `h.sendOrder`. Optional: `popup: false`, `fullView`, `public`,
`blur`, `before(page)` (routes), `early`.

Cut: an entry in `CUTS`: `n` (101+), `key` (theme), `from` (shot key), `start`, `seconds` (5–8), `what`, and optionally
`square: { y }` (crop of the vertical clip) or `square: { landscape: true, x }`. After a re-recording, look at the cuts
once: the timelines are steady, not frame-exact.

## Never

Post, upload or schedule anything from this script; call Runway; commit videos; point it at the production server or a
real account; film a delivery platform's own screen.
