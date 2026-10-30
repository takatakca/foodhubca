package ca.takatak.foodhub.tablet

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

enum class PrinterType { NONE, BLUETOOTH, NETWORK }

/** A ticket this tablet claimed but could not print yet (printer off, paper out): retried at every poll. */
data class PendingTicket(val id: String, val number: String, val ticket: String, val since: Long, val attempts: Int)

/** The tablet's settings (Settings screen) and its small local state. App-private storage only. */
class Prefs(context: Context) {
    private val sp: SharedPreferences = context.applicationContext.getSharedPreferences("foodhub_tablet", Context.MODE_PRIVATE)

    var kitchenUrl: String
        get() = sp.getString("kitchen_url", null)?.takeIf { it.isNotBlank() } ?: BuildConfig.DEFAULT_KITCHEN_URL
        set(v) = sp.edit().putString("kitchen_url", v.trim()).apply()

    /** Kitchen code for the print queue; blank = the one the server knows (enrolled tablet, one-kitchen person). */
    var location: String
        get() = sp.getString("location", "") ?: ""
        set(v) = sp.edit().putString("location", v.trim().uppercase()).apply()

    var printerType: PrinterType
        get() = runCatching { PrinterType.valueOf(sp.getString("printer_type", "NONE") ?: "NONE") }.getOrDefault(PrinterType.NONE)
        set(v) = sp.edit().putString("printer_type", v.name).apply()

    var bluetoothAddress: String
        get() = sp.getString("bt_address", "") ?: ""
        set(v) = sp.edit().putString("bt_address", v).apply()

    var bluetoothName: String
        get() = sp.getString("bt_name", "") ?: ""
        set(v) = sp.edit().putString("bt_name", v).apply()

    var printerHost: String
        get() = sp.getString("printer_host", "") ?: ""
        set(v) = sp.edit().putString("printer_host", v.trim()).apply()

    var printerPort: Int
        get() = sp.getInt("printer_port", 9100)
        set(v) = sp.edit().putInt("printer_port", v).apply()

    /** 58 or 80 (mm). */
    var paper: Int
        get() = if (sp.getInt("paper", 80) == 58) 58 else 80
        set(v) = sp.edit().putInt("paper", if (v == 58) 58 else 80).apply()

    var codePage: CodePage
        get() = runCatching { CodePage.valueOf(sp.getString("code_page", "CP858") ?: "CP858") }.getOrDefault(CodePage.CP858)
        set(v) = sp.edit().putString("code_page", v.name).apply()

    var autoPrint: Boolean
        get() = sp.getBoolean("auto_print", true)
        set(v) = sp.edit().putBoolean("auto_print", v).apply()

    var sound: Boolean
        get() = sp.getBoolean("sound", true)
        set(v) = sp.edit().putBoolean("sound", v).apply()

    var startOnBoot: Boolean
        get() = sp.getBoolean("start_on_boot", true)
        set(v) = sp.edit().putBoolean("start_on_boot", v).apply()

    /** Alarm volume to the maximum while it rings (put back afterwards). */
    var maxVolume: Boolean
        get() = sp.getBoolean("max_volume", true)
        set(v) = sp.edit().putBoolean("max_volume", v).apply()

    /** French or English tickets. */
    var ticketLang: String
        get() = if (sp.getString("ticket_lang", "fr") == "en") "en" else "fr"
        set(v) = sp.edit().putString("ticket_lang", if (v == "en") "en" else "fr").apply()

    /**
     * This install's id for the print claims ("printed on this device"). Made once; making it also opens the first run
     * ([firstRun]): a new install, or the app's data wiped.
     */
    val deviceId: String
        get() = synchronized(LOCK) {
            sp.getString("device_id", null) ?: ("tab-" + UUID.randomUUID().toString().replace("-", "").take(20)).also { id ->
                sp.edit().putString("device_id", id).putBoolean("first_run", true).commit()
            }
        }

    /**
     * True from a new install (or a data wipe) until the first poll whose tickets were all handled. Meanwhile, what
     * another tablet of this kitchen already printed (the previous install) is neither printed nor rung again.
     */
    var firstRun: Boolean
        get() = deviceId.isNotEmpty() && sp.getBoolean("first_run", false) // reading deviceId first makes it on a new install
        set(v) { sp.edit().putBoolean("first_run", v).commit() }

    // since / seen / pending are written with commit(), not apply(): they are what keeps a ticket from printing twice
    // (or not at all) when Android kills the app, so they must be on disk before the next step.
    var since: String?
        get() = sp.getString("since", null)
        set(v) { sp.edit().putString("since", v).commit() }

    var seen: List<String>
        get() = (sp.getString("seen", "") ?: "").split('\n').filter { it.isNotBlank() }
        set(v) { sp.edit().putString("seen", v.joinToString("\n")).commit() }

    /** Adds ids to the seen list, kept bounded (QueueLogic.remember). */
    fun markSeen(vararg ids: String) {
        synchronized(LOCK) { seen = QueueLogic.remember(seen, ids.toList()) }
    }

    val pending: List<PendingTicket>
        get() = try {
            val arr = JSONArray(sp.getString("pending", "[]") ?: "[]")
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                PendingTicket(o.getString("id"), o.optString("number"), o.getString("ticket"), o.optLong("since"), o.optInt("attempts"))
            }
        } catch (e: Exception) { emptyList() }

    /** The only way to change the waiting tickets: the watch loop and the printer thread both do, one at a time. */
    fun updatePending(change: (List<PendingTicket>) -> List<PendingTicket>) {
        synchronized(LOCK) {
            val arr = JSONArray()
            change(pending).forEach { arr.put(JSONObject().put("id", it.id).put("number", it.number).put("ticket", it.ticket).put("since", it.since).put("attempts", it.attempts)) }
            sp.edit().putString("pending", arr.toString()).commit()
        }
    }

    private companion object {
        /** One lock for every Prefs instance (they share the same file). */
        val LOCK = Any()
    }

    fun origin(): String? = QueueLogic.originOf(kitchenUrl)
    fun width(): Int = if (paper == 58) 32 else 42
}
