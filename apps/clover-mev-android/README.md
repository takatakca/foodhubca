# TAKATAK MEV — Clover device app (Android)

Prints the **Revenu Québec invoice (text + QR code)** of each sale rung up on the Clover register, right after the
payment. Clover's REST API cannot print a QR code, so this app does it on the device.

How it works: Clover broadcasts `com.clover.intent.action.PAYMENT_PROCESSED` → `PaymentReceiver` → `ReceiptWorker`
gets the merchant's token with `CloverAuth` → asks Food Hub `GET /api/foodhub/mev/clover-device/receipt?order=…`
(Food Hub checks the token with Clover) → waits for Takatak MEV's invoice → claims it (`/print`, printed once) →
prints with `TextPrintJob` + `ImagePrintJob2` (QR at the `[CODE QR]` line). Tap a sale on the screen for a
reproduction (RPR) or merchant copy (DUP) (`/copy`). Server side: `lib/foodhub/mev/clover-device.ts`.

Clover SDK names (`ACTION_PAYMENT_PROCESSED`, `EXTRA_ORDER_ID`, `CloverAuth.authenticate`, `TextPrintJob.Builder.lines`,
`ImagePrintJob2.Builder(context).bitmap`, `PrintJob.print(context, account)`) were read from clover-android-sdk 341.

## Build

```sh
# needs JDK 17+, Android SDK (platform 34, build-tools 34); local.properties: sdk.dir=/path/to/android-sdk
./gradlew test            # unit tests (ReceiptFlow, ReceiptLayout, ReceiptJson)
./gradlew assembleDebug   # app/build/outputs/apk/debug/app-debug.apk (Dev Kit only)
```

**targetSdk is 25 on purpose** (Clover App Market rule). From 26, a manifest receiver no longer gets the implicit
`PAYMENT_PROCESSED` broadcast, and from 27 Android's account access policy gets in the way of `CloverAuth`. Do not
raise it to follow Google Play's rules: they do not apply to Clover devices.

## Release APK for the Clover App Market (owner)

Clover accepts the **v1 (JAR) signature only**, file `META-INF/CERT.RSA`, and **the same key for every upload** —
losing the keystore means a new app listing. The build forces exactly that (v1 on, v2 / v3 / v4 off).

1. Once, make the key and keep it in the password manager plus a backup — never in git, never in chat:
   `keytool -genkeypair -v -keystore takatak-mev-release.jks -alias takatakmev -keyalg RSA -keysize 2048 -validity 10000`
2. In `~/.gradle/gradle.properties` (or environment variables of the same names):
   `TAKATAK_MEV_KEYSTORE=/path/to/takatak-mev-release.jks`, `TAKATAK_MEV_KEYSTORE_PASSWORD=…`,
   `TAKATAK_MEV_KEY_ALIAS=takatakmev`, `TAKATAK_MEV_KEY_PASSWORD=…`
3. Raise `versionCode` in `app/build.gradle.kts` above the last uploaded one (Clover refuses an equal or lower one).
4. `./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release.apk` (left unsigned when step 2 is missing).
5. Check before uploading: `apksigner verify -v app-release.apk` says v1 `true` and v2 / v3 / v4 `false`, and
   `unzip -l app-release.apk | grep CERT.RSA` finds the signature.
6. Clover developer dashboard → TAKATAK MEV → APK → upload.

## Status (2026-10-27) — read before continuing

- **Builds** (2026-10-27): `./gradlew test assembleDebug` OK against clover-android-sdk 341, 9/9 unit tests, debug APK 4.4 MB.
- **Release signing checked** (2026-10-27) with a throwaway key: `assembleRelease` gives a v1-only APK with
  `META-INF/CERT.RSA` that `apksigner verify` accepts (targetSdk 25).
- **Not tested on a real Clover device.** To verify on a Clover Dev Kit / sandbox merchant:
  1. the `PAYMENT_PROCESSED` broadcast reaches a manifest receiver on Clover's Android (if not: register it from a
     foreground service or poll recent orders);
  2. `GET_ACCOUNTS` is enough for `CloverAuth` (Clover may require its own permission in the app's Clover settings);
  3. print layout on the 80 mm printer (TextPrintJob line width, QR size 384 px).
- Upload: the APK goes into the TAKATAK MEV app in the Clover developer dashboard (Android APK, Canada), with the
  webhook / OAuth settings in docs/CLOVER_MULTI_APP.md § TAKATAK MEV.
