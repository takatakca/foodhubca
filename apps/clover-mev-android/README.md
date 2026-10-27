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
./gradlew assembleDebug   # app/build/outputs/apk/debug/app-debug.apk
```

## Status (2026-10-27) — read before continuing

- **Builds** (2026-10-27): `./gradlew test assembleDebug` OK against clover-android-sdk 341, 8/8 unit tests, debug APK 4.4 MB.
- **Not tested on a real Clover device.** To verify on a Clover Dev Kit / sandbox merchant:
  1. the `PAYMENT_PROCESSED` broadcast reaches a manifest receiver on Clover's Android (if not: register it from a
     foreground service or poll recent orders);
  2. `GET_ACCOUNTS` is enough for `CloverAuth` (Clover may require its own permission in the app's Clover settings);
  3. print layout on the 80 mm printer (TextPrintJob line width, QR size 384 px).
- Upload: the APK goes into the TAKATAK MEV app in the Clover developer dashboard (Android APK, Canada), with the
  webhook / OAuth settings in docs/CLOVER_MULTI_APP.md § TAKATAK MEV.
