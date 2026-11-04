# Food Hub product-film edit

`render-product-film.py` makes four silent, 30-second product films: French/English, landscape 1920×1080 and square 1080×1080. It also writes a JPG poster, SRT and WebVTT captions, and a JSON output manifest. It makes no network request or account change and does not call a video-generation provider.

It requires Python 3, ffmpeg with libx264/drawtext, DejaVu Sans fonts, reviewed local product captures and the existing ON2GO restaurant photos. The photo originals remain unchanged; the edit displays/crops them with a gentle camera motion.

## Input captures

The existing [PR #140 recorder](https://github.com/takatakca/foodhubca/pull/140) is the source for these real local app recordings:

- `001-kitchen-new-order-15s-landscape.mp4`
- `002-screens-wall-20s-landscape.mp4`
- `003-orders-board-15s-landscape.mp4`

Use synthetic data with outside services replaced by local stand-ins. The English recordings must show the app's real English interface. The no-prices media brief requires capture-only redaction of currency text; this renderer preserves the supplied UI and does not identify or hide monetary values itself. Review clips before using them. Do not supply production account screens, private merchant/customer records or staged “connected” statuses.

The current delivery's external recorder copy includes system Chromium compatibility, English language-cookie support, scoped status-filter selectors and currency-text blur. See `docs/agent-progress/05-github-media.md` for its verified status; an unmodified historical recorder does not include those adjustments.

## Render

From the repository root, with the expected three recordings in each input folder:

```sh
FOODHUB_FILM_CAPTURES=/path/to/reviewed-french-captures \
FOODHUB_FILM_CAPTURES_EN=/path/to/reviewed-english-captures \
FOODHUB_FILM_PHOTOS=../on2goca/public/photos \
python scripts/media/render-product-film.py
```

Outputs default to git-ignored `private/video/product-film/output/`. `FOODHUB_FILM_ROOT` changes the work directory; `FOODHUB_FILM_OUTPUT` changes the final output directory. `FOODHUB_FILM_LANGS=fr` or `en` renders one language. The photo inputs are the existing Clover-menu pizza and pita covers referenced in the ON2GO feed. Their repository provenance is documented in `docs/agent-progress/media-requirements-evidence.md`; this script does not certify their rights.

The film clearly labels local demo/fictional data, uses the current navy/blue brand and closes with the restaurant portal and takatak.ca. It contains no subscription prices, unproven savings, music, artificial voice, native-provider-login claim or Runway-generation claim. The demo wall depicts simulated relay views; it does not establish 54 authenticated persistent sessions.

Review the whole film, verify output dimensions/duration/frame rate, confirm readable redaction and captions, and publish only the reviewed assets through the existing release workflow. Rendering is not deployment, provider certification or authorization to post to social accounts.
