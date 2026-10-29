# Platform screens (Écrans des plateformes)

The Uber Eats, DoorDash and Skip **order screens**, live inside Food Hub (Stores → Platform screens), running on a
**screen relay host** that stays wired and always on. It answers the tablet problem: a tablet that drops its Wi-Fi or
its sign-in loses orders without anyone noticing.

## What it is, and what it is not

- **Is:** each screen is a real Chromium browser on the relay host, signed in to the platform's own merchant web app
  (Uber Eats Orders, DoorDash Order Manager…). Food Hub shows it in a frame. Staff use it exactly like the tablet:
  accept, mark ready, answer the courier.
- **Watched:** a small agent next to each browser tells Food Hub every 20 s whether the screen is up, still signed in,
  and the page title (platforms put the number of waiting orders there, e.g. "(2) Orders"). A blank or crashed page is
  reloaded by itself. During opening hours, a screen that is offline, signed out or crashed opens a **Watchtower
  incident** (`screen_down`: screen beep → SMS → call → owner, like a tablet that is off).
- **The screens wall:** Stores → Platform screens shows every screen side by side: **1, 2, 4, 8, 12 or 16 at a
  time** (pages beyond), **tabs** (one big screen, the others as tabs), or **custom** (tap "Arrange", then drag each
  screen anywhere on a 12 × 12 board and resize it from its corner; arrow keys move, Shift + arrows resize). Drag a
  screen's title bar onto another to swap places; double-click it to make it big. **Full screen** hides the console.
  The view, the order and the board are saved on each device; **Share layout** makes this device's layout the one every
  device without its own starts from, and **Shared layout** takes it on any device (`GET/PUT /api/foodhub/screens/layout`). Each tile shows its channel (switch DoorDash / Uber Eats /
  Skip right there: the screen opens that platform's sign-in page), its status, the orders waiting, Reload and
  "Sign-in page".
- **Relay host address:** put the relay host on a sub-domain of Food Hub's own domain (e.g. `screens.<your Food Hub
  domain>`): browsers block sign-in cookies inside a frame from another site, and the relay host's own page must allow
  being framed by Food Hub (`frame-ancestors`).
- **Set up screens:** creates numbered screens `s01`, `s02`… in one go (e.g. 8 DoorDash, 6 Uber Eats, 4 Skip) for one
  location, each at `<relay host>/sNN/` and opening its platform's sign-in page. The relay host uses the same numbers.
- **Orders → Clover strip:** above the wall, how each platform's orders reach Clover (the platform's own Clover link, or
  Food Hub's connection, or "screen only") and when the last one came in.
- **Rings on one device:** Stores → Platform screens → **Ring on this device** turns any tablet or PC at the counter into
  the screens wall: it rings at every refresh (10 s) while orders wait on any online screen, rings an alarm when a
  screen drops, stays awake, and shows the waiting count in a banner. The choice is kept on that device.
- **Nobody answers:** orders waiting on an online screen longer than the Watchtower's "order waiting" delay, during
  opening hours, open a **`screen_waiting`** incident (critical: beep → SMS → call → owner).
- **Android mode (heartbeat v2):** a screen can be the platform's Android app (installed by the owner from the Play
  Store on the relay host) instead of a web page. Its agent reports which app is in front and how many notifications the
  order app shows (a count, never their text). Relay kit: lane B of `docs/ORDER_SCREENS_RESCUE.md`.
- **Stores shown:** each screen can list the platform store numbers its account shows. A protected store (Po Poulet NDG,
  DoorDash 27982486, and every locked DoorDash store) is marked "never act".
- **Passwords:** Food Hub never asks for, stores or types a platform password. The owner signs in **once, inside the
  screen** (with the SMS code if the platform asks). The browser profile is kept on the relay host's disk, so the
  session survives restarts. Agents (people or AI) never type passwords or codes (CLAUDE.md §4).
- **Is not an order integration.** The agent never clicks, accepts or reads orders. Orders reach Clover the way they
  do today. Reading orders off the screen and injecting them would break the platforms' merchant terms and could get
  the accounts suspended; the real integrations (Uber Eats API, DoorDash Drive/Marketplace, Skip/JET Connect, the
  Order Relay) stay the way orders enter Food Hub.
- **Po Poulet NDG (DoorDash 27982486):** if a DoorDash screen shows that store, nobody acts on it from Food Hub.

## Setup (owner, about 30 minutes)

1. **A relay host.** A small Linux server or VPS with Docker (2 vCPU / 4 GB RAM handles 3–4 screens), wired, always
   on. A Windows PC also works (see the end).
2. **Token.** Generate one (`openssl rand -hex 24`). Put it in Coolify as `FOODHUB_SCREENS_AGENT_TOKEN` (runtime
   variable) and redeploy Food Hub. Until it is set, the heartbeat route answers 503 and the page shows a warning.
3. **Food Hub → Stores → Platform screens → Add a screen**, once per platform account: platform, name, location, and
   the screen's https address (step 5). Edit the screen to copy its id.
4. **On the relay host:** copy `deploy/screens/` there, `cp .env.example .env`, fill it (Food Hub URL, the same token,
   a view user and password for the relay host's own web view, the screen ids from step 3). Start: `docker compose up -d --build`.
   One pair of services (browser + agent) per screen; copy a pair for each extra account or location.
5. **Expose each screen over https** behind your reverse proxy (Traefik / Coolify / Cloudflare Tunnel), e.g.
   `https://screens.example.ca/uber-1/` → `127.0.0.1:3101`. Protect it (the view user + password, or better Cloudflare
   Access for your team's emails). Never put a user name or password in the address saved in Food Hub: it is refused.
6. **Sign in once in each screen** (open it in Food Hub or full screen), with the account's own email, and tick
   "remember this device" when the platform offers it. The page title and the green dot appear within 20 s.
7. Check the start addresses in `docker-compose.yml` (`CHROME_CLI` and `SCREEN_START_URL`) are the merchant web pages
   you use for orders; change them if your platform shows another address after sign-in.

## Settings

| Where | Name | Meaning |
|---|---|---|
| Food Hub | `FOODHUB_SCREENS_AGENT_TOKEN` | Shared secret of the relay agents (24+ characters). Off until set. |
| Relay host `.env` | `FOODHUB_URL` | Food Hub address. |
| Relay host `.env` | `FOODHUB_SCREENS_AGENT_TOKEN` | Same value as on Food Hub. |
| Relay host `.env` | `SCREENS_VIEW_USER` / `SCREENS_VIEW_PASSWORD` | Sign-in of the relay host's web view (not a platform password). |
| Relay host `.env` | `SCREEN_ID_*` | The ids of the screens added in Food Hub. |
| Agent | `HEARTBEAT_SECONDS` | Default 20. |

## How it works (for developers)

- `lib/foodhub/screens.ts`: screens (`platform_screens` documents), status (`online`, `login_required`, `error`,
  `offline` after 120 s, `never`), view address check (https, no credentials), agent token check, heartbeat recording
  (v1, plus v2's optional `mode` web|android, `app` package, `waiting` count), `waitingSince` (set when orders appear,
  restarted when one is answered, cleared at 0), store numbers per screen and the protected ones, "reload" commands
  handed to the agent once (Android: bring the order app back to the front).
- `lib/ui/screens-ring.ts`: when the screens wall rings (pure, tested).
- Routes: `GET/POST /api/foodhub/screens` (view / `stores:map`), `PATCH/DELETE /api/foodhub/screens/:id` (`stores:map`),
  `POST /api/foodhub/screens/:id {action:"reload"}` (`orders:act`), `POST /api/foodhub/screens/heartbeat` (public in
  `proxy.ts`; `Authorization: Bearer <token>`).
- Watchtower: rules `screen_down` and `screen_waiting` in `lib/foodhub/watch/engine.ts`, only during the location's
  opening hours.
- Page: `app/(console)/stores/screens/page.tsx`. Relay kit: `deploy/screens/` (compose file + `agent/agent.mjs`).
- Tests: `tests/platform-screens.test.ts`.

## Windows instead of Docker

Run Chrome once per screen with its own profile and debugging port, e.g.
`chrome.exe --user-data-dir=C:\screens\uber-1 --remote-debugging-port=9222 https://merchants.ubereats.com/manager/orders`,
run `deploy/screens/agent/agent.mjs` with Node 22 for each (`CDP_URL=http://127.0.0.1:9222`, other settings as above),
and expose the desktop to Food Hub with Apache Guacamole (RDP → https web view). Docker on Linux is simpler and cheaper;
use Windows only if the platform's app is Windows-only.
