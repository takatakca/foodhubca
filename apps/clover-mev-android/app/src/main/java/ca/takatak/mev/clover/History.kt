package ca.takatak.mev.clover

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** The last register sales this device handled, for the screen (on the device only; Food Hub keeps the real record). */
object History {
    private const val PREFS = "takatak_mev"
    private const val KEY = "history"
    private const val MAX = 40

    data class Entry(val order: String, val at: Long, val outcome: String)

    fun add(context: Context, order: String, outcome: String) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val list = list(context).filter { it.order != order }.toMutableList()
        list.add(0, Entry(order, System.currentTimeMillis(), outcome))
        val arr = JSONArray()
        list.take(MAX).forEach { arr.put(JSONObject().put("order", it.order).put("at", it.at).put("outcome", it.outcome)) }
        prefs.edit().putString(KEY, arr.toString()).apply()
    }

    fun list(context: Context): List<Entry> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return emptyList()
        val arr = try { JSONArray(raw) } catch (e: Exception) { return emptyList() }
        return List(arr.length()) { arr.getJSONObject(it).let { o -> Entry(o.getString("order"), o.getLong("at"), o.getString("outcome")) } }
    }

    fun foodHubUrl(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("foodhub_url", null) ?: BuildConfig.FOODHUB_URL

    fun setFoodHubUrl(context: Context, url: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("foodhub_url", url.trim()).apply()
    }
}
