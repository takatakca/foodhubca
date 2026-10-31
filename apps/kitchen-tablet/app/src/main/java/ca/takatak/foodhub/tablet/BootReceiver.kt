package ca.takatak.foodhub.tablet

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Starts the order-listening service when the tablet starts (Settings « Démarrer au démarrage ») and after an update. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED, "android.intent.action.QUICKBOOT_POWERON" ->
                if (Prefs(context).startOnBoot) OrderWatchService.start(context)
        }
    }
}
