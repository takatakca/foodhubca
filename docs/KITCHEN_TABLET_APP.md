# Application tablette cuisine Food Hub · Food Hub kitchen tablet app

## Résumé (français)

**Ce qu’elle fait.** Une application Android à nous, installée sans Play Store, pour les tablettes de cuisine qui
faisaient tourner UrbanPiper avec une imprimante thermique :

- elle affiche l’écran cuisine Food Hub (`/kitchen`) en plein écran, toujours allumé, connexion gardée ;
- elle **sonne fort** à chaque nouvelle commande, **même écran éteint**, jusqu’à ce qu’on touche l’écran (son généré
  par l’application, sur le canal « alarme », plus vibration) ;
- elle **imprime chaque nouvelle commande une seule fois** sur l’imprimante de la tablette (billet en français ou en
  anglais, 58 ou 80 mm : plateforme, numéro en gros, marque, prénom du client, emporter / livraison, heure, articles
  avec options et notes, note de la commande, total), et un court billet **« ANNULÉE »** si une commande déjà imprimée
  est annulée. Une commande annulée avant l’impression n’est jamais imprimée.
- Là où une imprimante **Clover** imprime déjà les commandes, Clover reste le premier choix : on met l’imprimante sur
  « Aucune » (ou on coupe l’impression automatique) et la tablette sonne quand même.

**Installer demain** (page à ouvrir sur la tablette : **https://foodhub.on2go.ca/tablette**, étapes en français puis en
anglais) :

1. Télécharger `foodhub-tablet.apk` depuis la page, autoriser Chrome à installer des applications inconnues, installer,
   ouvrir.
2. Autoriser les notifications (et « Appareils à proximité » pour une imprimante Bluetooth).
3. Se connecter avec le code de la tablette : écran NIP d’une tablette enregistrée (un gérant l’enregistre une fois dans
   Réglages → Tablettes), ou le code reçu par courriel / texto. La connexion Google ne marche pas dans l’application.
4. Jumeler l’imprimante dans les réglages Bluetooth d’Android, puis dans l’application : ⚙ (en bas à droite) →
   Imprimante → Bluetooth → la choisir (ou Réseau : IP, port 9100) → papier 58 / 80 mm → Enregistrer → Impression test.
5. Désactiver l’optimisation de la batterie (bouton dans les réglages de l’application) et laisser la tablette branchée.

**Imprimantes qui marchent :** imprimantes thermiques **ESC/POS 58 mm ou 80 mm** en **Bluetooth « classique » (SPP)**
ou en **réseau (TCP 9100)** — les modèles courants (Xprinter, Munbyn, Rongta, Epson TM en mode ESC/POS…). **Ne marchent
pas :** les imprimantes **Bluetooth LE seulement** (pas de SPP), les imprimantes USB, les imprimantes qui ne parlent
pas ESC/POS (étiquettes, AirPrint).

**Pas encore testé sur du vrai matériel** (rien ici n’a touché une vraie tablette ni une vraie imprimante) :

- l’impression elle-même (accents en CP858 / CP1252, gras, double taille, coupe) — si les accents sortent mal,
  Réglages → Accents → essayer CP1252, puis « Sans accents » ;
- la connexion Bluetooth (trois façons d’ouvrir le canal SPP sont essayées) et le réseau 9100 ;
- la sonnerie écran éteint, le réveil de l’écran (notification plein écran), le démarrage avec la tablette, le
  comportement sous Android 8 à 14 et selon le fabricant (certaines marques coupent les services en arrière-plan :
  désactiver l’optimisation de batterie est alors indispensable) ;
- la lecture des cookies du WebView par le service (méthode standard d’Android, non vérifiée sur appareil).

**Ce qui est vérifié :** la partie serveur (file d’impression, billets, « jamais deux fois », annulation) a ses tests
automatiques ; l’APK est compilé et ses tests unitaires (encodage ESC/POS, son, logique de la file) passent dans GitHub
Actions.

**Mises à jour.** Sans clé de signature, chaque version est signée par une clé différente (celle de la machine de
GitHub qui la compile) : il faut **désinstaller l’ancienne version avant d’installer la nouvelle** (et refaire les
réglages). Après une réinstallation, la tablette **ne réimprime pas** ce que la cuisine a déjà imprimé et ne resonne
pas pour ces commandes ; elle imprime seulement celles arrivées pendant la réinstallation. Avec les quatre secrets
ci-dessous, les mises à jour s’installent par-dessus.

**À faire par le propriétaire :** fusionner la PR ; publier une version (Actions → « Android kitchen tablet » → *Run
workflow* → version `1.0.0`, ou pousser l’étiquette `tablet-v1.0.0`) pour que le lien de `/tablette` marche ; si
voulu, ajouter les secrets de signature (noms seulement ici, jamais la clé) : `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

---

## Technical notes (English)

### Pieces

| Piece | Where |
| --- | --- |
| Print queue API | `app/api/foodhub/kitchen/print-queue/route.ts`, `…/[orderId]/printed/route.ts`, logic in `lib/foodhub/kitchen/print-queue.ts` |
| Ticket text (pure) | `lib/foodhub/kitchen/ticket-text.ts` |
| Download page | `app/tablette/page.tsx` (public), APK lookup `lib/foodhub/tablet-app.ts` |
| Android app | `apps/kitchen-tablet/` (Kotlin, Gradle Kotlin DSL, wrapper committed) |
| APK build | `.github/workflows/android-tablet.yml` |
| Tests | `tests/kitchen-ticket-text.test.ts`, `tests/kitchen-print-queue.test.ts`, `apps/kitchen-tablet/app/src/test/` |

`apps/**` is excluded from `tsc`, ESLint, Vitest and the Docker image (`.dockerignore`): the Food Hub checks do not
see the Android project, and the Android workflow does not run Food Hub's.

### API

`GET /api/foodhub/kitchen/print-queue?location=&since=&device=&paper=58|80&lang=fr|en`

- **Who:** a signed-in person with `view` whose locations include the kitchen, or an **enrolled kitchen tablet** (its
  signed `takatak_device` cookie, own location only). 401 otherwise. The route is listed in `proxy.ts` so the device
  cookie alone reaches it — the route does the checking (same model as `/api/foodhub/devices/heartbeat`). Reason:
  a kitchen tablet sits on its PIN screen most of the day; printing must not stop when the 14 h staff session ends.
- **location:** optional for an enrolled tablet, a PIN session on one, or a one-kitchen person; otherwise 400
  `{ needLocation: true }`.
- **since:** ISO date; default 15 minutes back, clamped to [now − 24 h, now]. An order counts from when it reached the
  kitchen: platform orders from `timeline.firedAt` (scheduled) or `createdAt` — orders from Clover's own DoorDash /
  Uber integration (`viaPos`) from their import into Food Hub (`timeline.seenAt`, set by the 5-minute Clover import);
  own orders from when they left the payment hold (`paylink.releasedAt` when paid by link, the `pay_at_counter` event /
  `paylink.cancelledAt` when switched to « pay at the counter ») or `createdAt`. Orders are read from the last 24 h
  (platform) / 12 h (own orders, as the kitchen screen) and filtered on that time.
- **Which orders:** platform orders `new` / `accepted` not waiting for their fire time; own orders from the kitchen
  screen's sources (`phone_ai`, `phone`, `website`, `manual`) in `new` / `in_kitchen` (not `awaiting_payment`; Clover
  Online Ordering orders print through Clover). With `device`, each item carries `printed` (this device already
  claimed it) and `printedElsewhere` (not this device, but another tablet of the kitchen printed it — the app reads it
  only on its first run after an install or a data wipe), and cancelled orders this device printed come back as
  `kind: 'cancel'` items with an « ANNULÉE » ticket.
- **Answer:** `{ location, since, serverTime, width, lang, items: [{ id, orderId, source, kind, channel, number,
  brandName, locationCode, createdAt, at, printed, printedElsewhere, ticket }] }`, oldest first, at most 50.

`POST /api/foodhub/kitchen/print-queue/<orderId>/printed` `{ deviceId, source?, kind?, location? }`

- Claim **before** printing: `repo.claimKv('tablet_print:<device>:<kind>:<source>:<orderId>')` (atomic insert, primary
  key in Supabase), then read back; only the caller whose random nonce comes back gets `{ claimed: true }`. Anything
  else → `{ claimed: false, reason }`: `already_printed`, `cancelled` (never printed), `not_cancelled` /
  `not_printed_here` (cancel tickets), `not_for_kitchen`, `conflict`. Unknown order or another kitchen → 404.
- A won claim also inserts the kitchen-wide mark `tablet_print_any:<kind>:<source>:<orderId>` (first tablet wins;
  never read by the claim itself) — the source of `printedElsewhere`.
- A retry after a lost answer gets `already_printed`; the queue then says `printed: true` for this device, and the app
  prints a ticket it claimed but never wrote down as handled (step `RECOVER` below).
- Platform orders get an order event `tablet_printed` / `tablet_cancel_printed`. `timeline.printedAt` (Clover's print
  status) is untouched.
- One claim row per order per device (plus one kitchen-wide mark per order) stays in `fh_kv` (small; a cleanup can
  come later).

### Ticket text format

One printed line per text line; a line starting with `@@` + flags + space is styled: `B` bold, `C` centred, `H`
double width and height (≤ width / 2 characters). Content lines starting with `@@` get a leading space. Characters are
Latin-1 + € (curly quotes, dashes, œ, emoji replaced or dropped). 58 mm = 32 columns, 80 mm = 42 (fits both 42- and
48-column printers). When Takatak MEV issues the order's invoice (`mev.status` not `skipped` / `shadow`), the ticket
carries **no amount** (the SEV's invoice is the only paper with amounts — same rule as `app/ticket/*`).

### Android app (`apps/kitchen-tablet`)

- **Toolchain:** Gradle 8.14.3 (wrapper jar copied from `apps/clover-mev-android`, checked by
  `gradle/actions/wrapper-validation` in CI), AGP 8.7.3, Kotlin 2.0.21, JDK 17. `minSdk 26`, `targetSdk 34`
  (from 35 a `dataSync` foreground service is capped at 6 h a day), `compileSdk 34`. Only dependency:
  `androidx.core:core-ktx` (no Play services). Package `ca.takatak.foodhub.tablet`.
- **MainActivity:** full-screen WebView of the kitchen URL (Settings; default `https://foodhub.on2go.ca/kitchen`),
  cookies accepted and flushed, screen kept on, shows over the lock screen, back = page back only. Other origins open
  in the browser. JS bridge `window.FoodHubTablet`: `print(text)` (same ticket format; only on Food Hub's own origin),
  `beep()`, `version()`. A tap anywhere stops the alarm; a red banner says why it rings. ⚙ bottom right → Settings.
- **OrderWatchService:** foreground service (type `dataSync`), partial wake lock + Wi-Fi lock, polls every 15 s with
  the WebView cookies (`CookieManager`, read on the main thread). Each item not yet handled gets one step
  (`QueueLogic.plan`, JVM-tested): `CLAIM` (claim → print → ring), `RECOVER` (the queue says `printed` for this
  device but the app never wrote it down — lost claim answer or app killed — print and ring, no new claim), `RING`
  (auto-print off or no printer), `SILENT` (first run after an install / data wipe and `printedElsewhere`: nothing),
  `CANCEL_UNPRINTED` (cancelled while its ticket still waited for the printer: that ticket is dropped, ring, no slip).
  A won claim is written to the waiting list (`Prefs.pending`, SharedPreferences `commit()`) and to `seen` BEFORE it
  goes to the printer, and leaves the list only once printed; the printer thread drains the list oldest first,
  stops at the first failure, gives up after 2 h. Cursor = last `serverTime` − 120 s, advanced only when every item was
  handled; reset to the server default (15 min) when the service starts. Boot / app update restart it
  (`BootReceiver`, Settings switch).
- **Alarm:** two-tone pattern (988 / 1319 Hz, like the kitchen screen) generated as 16-bit PCM (`Tone`), looped with a
  static `AudioTrack` on `USAGE_ALARM`, alarm volume raised to the maximum while it rings (option), vibration; the
  high-priority notification has a full-screen intent (wakes the screen) and a « Arrêter la sonnerie » action.
- **Printing:** `EscPos` (pure, JVM-tested) → `ESC @`, `ESC t 19` (CP858) / `ESC t 16` (CP1252) / `ESC t 0` (ASCII,
  accents removed), `ESC a 1` centre, `ESC E 1` bold, `GS ! 0x11` double size, `ESC d 4` feed, `GS V 66 0` partial cut.
  `EscPosPrinter`: Bluetooth Classic SPP `00001101-0000-1000-8000-00805F9B34FB` (secure, then insecure, then channel 1)
  or TCP 9100, 512-byte chunks, one job at a time. The next Bluetooth socket type is tried only when `connect()`
  failed; once connected, a send error ends the job (the ticket stays waiting and is printed whole later).
- **Permissions:** INTERNET, FOREGROUND_SERVICE + FOREGROUND_SERVICE_DATA_SYNC, WAKE_LOCK, RECEIVE_BOOT_COMPLETED,
  VIBRATE, POST_NOTIFICATIONS (asked on 13+), USE_FULL_SCREEN_INTENT, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
  BLUETOOTH_CONNECT (asked on 12+; BLUETOOTH / BLUETOOTH_ADMIN up to 11).
- **Strings:** French default (`values/`), English `values-en/`.

### Build and release

- Local (needs JDK 17 + Android SDK 34): `cd apps/kitchen-tablet && ./gradlew testDebugUnitTest assembleRelease`.
- CI: push to `feature/kitchen-tablet-app` / `main` touching the app → tests + APK artifact
  (`foodhub-tablet-<version>`). Tag `tablet-v<version>` or *Run workflow* with a version → GitHub Release
  `tablet-v<version>` with `foodhub-tablet.apk` (+ `.sha256`), marked latest.
- **Signed APK:** add repository secrets `ANDROID_KEYSTORE_BASE64` (the `.jks` in base64), `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`; the release build is then signed with it. Keep the key in the password
  manager: losing it means uninstalling on every tablet once. Without the secrets: the same release build (never
  `android:debuggable`, checked with `aapt` in CI — no `adb run-as` copy of a tablet's cookies) signed with the
  runner's own debug key, so each update needs an uninstall first.
- `/tablette` links to the newest `tablet-v*` release asset (GitHub API, cached 10 min); fallback
  `releases/latest/download/foodhub-tablet.apk`; `FOODHUB_TABLET_APK_URL` (https) overrides both.

### Known limits

- Scheduled platform orders placed more than 24 h before their fire time are not seen by the queue (rare).
- Several tablets in one kitchen each print their own copy (claims are per device). After a reinstall, the first run
  skips what another tablet of the kitchen already printed; in a kitchen whose previous install only rang (no
  printer), the orders of the last 15 minutes ring once more.
- A reinstall needs a new sign-in: the device cookie lives in the app's data with the device id, so the server-side
  device id would not survive a reinstall either (that is why the kitchen-wide mark is used, not the enrolled id).
- `window.print()` inside the WebView does nothing (Android WebView); the app prints through its own queue.
- Tablets without Google Play still need Android 8+ and Chrome's WebView.
