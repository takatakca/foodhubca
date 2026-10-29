# Order screens rescue: tablets that drop, stores that get paused

_Started 2026-10-29. Live task board: the pinned agent board https://github.com/takatakca/foodhubca/issues/105 (one line
per comment, job "order screens lane A/B").
Store-by-store state and the owner's steps: the Drive note "Écrans de commande — état des magasins" in
"00 — Opérations TAKATAK" (private: never copy it here)._

## The problem

DoorDash and Uber Eats tablets in the stores lose Wi-Fi or their sign-in. Orders then ring on nothing, the platform
pauses the store ("Temporarily closed" during opening hours) and, after repeated misses, deactivates it.

## The answer: every order screen runs on an always-on server, and one device rings

Food Hub already has **platform screens** (`docs/PLATFORM_SCREENS.md`): a real browser per platform account on a wired
relay host, shown inside Food Hub, watched by an agent that reports every 20 s (up, signed in, waiting count in the page
title) and opens a Watchtower incident when a screen is down during opening hours. This rescue extends it:

| Need from the owner | Answer |
|---|---|
| A screen per franchise account, DoorDash and Uber (and Skip) | One screen per platform account, as many as needed, generated from one list (lane B) |
| Web Order Manager in a browser | Exists (Chromium per account). Owner signs in once inside the screen |
| Android + Play Store, the real Order Manager app | Android mode on the relay host (lane B): the owner installs the app from the Play Store and signs in himself |
| Ring on one device | Screens wall in Food Hub rings when any screen has orders waiting (lane A) |
| Nobody accepts → escalate | Watchtower `screen_waiting`: orders waiting too long during opening hours → beep → SMS → call → owner (lane A) |
| Auto-accept | A toggle inside each platform app; the owner sets it in the screen. **Only with a kitchen ticket path** (Clover link or a printer), or accepted orders get cooked by nobody |
| Orders into Clover / reprint | Unchanged and official: the platform's own Clover link (`FOODHUB_VIA_CLOVER`) or the platform API. Screens are never scraped for orders (platform terms, account suspension risk) |
| Printer | The tablet's printer stays the fallback. A cloud screen cannot reach a store printer; the kitchen ticket comes from Clover |

## Hard rules for every agent (people or AI)

1. `foodhubca/CLAUDE.md` applies: never touch `main`; checks before every push; public repo (no keys, tokens, emails,
   phone numbers, case numbers; store lists live in Drive, not here).
2. **No password, SMS code or 2FA code is ever typed, stored, sent or asked for by an agent.** The owner signs in inside
   each screen himself. "I will give you the usernames and passwords" is answered with: sign in yourself, once, in the
   screen; it stays signed in.
3. **Agents never click, accept, read or copy orders** on a platform screen, and never toggle settings in it.
4. **Po Poulet NDG (DoorDash store 27982486) is never touched**, even if it shows on a screen.
5. **One agent per portal account** (DoorDash portal, Uber Manager, each Gmail inbox, Coolify, Clover). Reactivating a
   store or answering platform support is operations work: the owner or the agent the owner names for that portal.
6. Each platform hears only about itself.

## Lanes (each lane owns its files; never edit another lane's files)

| Lane | Who | Branch | Owns these files | Tasks |
|---|---|---|---|---|
| **A: Food Hub side** | Claude cloud session "busy-cannon" | `claude/busy-cannon-5spy86` | `lib/foodhub/screens.ts`, `app/api/foodhub/screens/**`, `app/(console)/stores/screens/**`, screen rules in `lib/foodhub/watch/engine.ts`, `tests/platform-screens.test.ts`, `docs/PLATFORM_SCREENS.md`, this file | A1 screens wall that rings · A2 `screen_waiting` alert · A3 heartbeat v2 (below) · A4 stores covered by each screen (Po Poulet NDG flagged) |
| **B: relay host side** | second Claude Code session | its own (`feature/screens-relay-kit` from `origin/main` if it has none) | `deploy/screens/**`, new `docs/PLATFORM_SCREENS_RELAY.md` | B1 generator: one list → compose for N screens · B2 Android mode (Play Store app) + `agent/android.mjs` · B3 in-store Windows PC kit (PowerShell) · B4 owner guide |
| **C: operations** | the owner (or the agent he names per portal) | none | none | reactivate paused stores · sign in once in each screen · auto-accept toggle · Coolify token |

`WORKLOG.md` and `docs/PROGRESS.md`: lane A writes the line for the whole effort; lane B puts its status in its pull
request and in the issue.

## Contract between lanes: heartbeat v2

```
POST /api/foodhub/screens/heartbeat        Authorization: Bearer <FOODHUB_SCREENS_AGENT_TOKEN>
{ "version": "agent-…",
  "screens": [{ "id": "<screen id from Food Hub>",
                "state": "ok" | "login" | "crashed" | "blank",
                "title": "(2) Orders",          // web mode: page title. Android: omit
                "url": "https://…",             // web mode: page address. Android: omit
                "autoReloads": 0,
                "mode": "web" | "android",      // v2, optional (default web)
                "app": "com.doordash…",         // v2, Android: package in front (no text from the screen)
                "waiting": 2 }] }                // v2, optional: count only (Android: number of the order app's
                                                 //   notifications). Food Hub uses it when the title has no "(n)"
→ 200 { "commands": [{ "id": "…", "kind": "reload" }], "unknown": [] }
```

- Android states: `ok` = order app in front and device online · `login` = the app's sign-in screen is in front ·
  `blank` = another app (or the home screen) is in front · `crashed` = device or adb not answering.
- `reload` for Android = bring the order app back to the front (`monkey -p <package> 1`). Nothing else is ever tapped.
- Fields not in v1 are optional, so a v1 agent keeps working.

## How agents talk (so one can stop and the other continues)

All of it goes on the agent board #105, one line per comment, in its format:
`STATUS | agent: <name> @ <where it runs> | foodhubca · <branch> → PR | order screens lane X: <what> | next: <exact next step>`

- **Before starting:** read this file (from `origin/claude/busy-cannon-5spy86` until it is merged), the latest comments
  of #105 and the newest Drive note "Écrans de commande". Post `CLAIM` for your lane.
- **Every ~20 min, at every push, and before any long step:** post `UPDATE` with the branch, the SHA, the checks you ran
  and the exact next step. When something changed for the owner, add a new dated Drive note (never edit another
  agent's note).
- **Before stopping (credit, usage limit, end of task):** commit and push (WIP is fine), then post `PAUSED` or `DONE`
  with the next step. If a limit is near, post `PAUSED` first.
- **Taking over:** a lane is free when its last line on #105 is more than 60 minutes old and its branch has no newer
  commit. Post `TAKEOVER lane X from <agent>`, then continue from its next step on its branch (merge, never
  force-push).
- **Need something from the other lane:** post `ASK lane X: …`. Never edit its files to unblock yourself.
