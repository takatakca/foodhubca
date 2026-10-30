package ca.takatak.foodhub.tablet

import android.webkit.JavascriptInterface

/**
 * window.FoodHubTablet in the kitchen page:
 *   FoodHubTablet.print(text)  prints a ticket (same text format as the print queue: "@@HBC #12" lines) → true if queued
 *   FoodHubTablet.beep()       one short beep
 *   FoodHubTablet.version()    the app's version, e.g. "1.0.0" (the page can tell it runs inside the tablet app)
 * Only Food Hub's own pages (the origin set in Settings) may print or beep: other sites never open inside the app.
 */
class TabletBridge(private val activity: MainActivity) {
    @JavascriptInterface
    fun print(text: String?): Boolean {
        if (activity.trustedOrigin == null || text.isNullOrBlank() || text.length > 20_000) return false
        if (Prefs(activity).printerType == PrinterType.NONE) return false
        EscPosPrinter.submit(activity, text)
        return true
    }

    @JavascriptInterface
    fun beep() {
        if (activity.trustedOrigin != null) Alarm.beep()
    }

    @JavascriptInterface
    fun version(): String = BuildConfig.VERSION_NAME
}
