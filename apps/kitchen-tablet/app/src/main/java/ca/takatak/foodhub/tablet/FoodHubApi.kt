package ca.takatak.foodhub.tablet

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Food Hub's print queue, with the WebView's own cookies (the staff session, or the enrolled tablet's device cookie):
 *   GET  /api/foodhub/kitchen/print-queue?since=&location=&device=&paper=&lang=
 *   POST /api/foodhub/kitchen/print-queue/<orderId>/printed  { deviceId, source, kind, location }
 * Server side: lib/foodhub/kitchen/print-queue.ts.
 */
class FoodHubApi(private val origin: String, private val cookie: () -> String?, private val userAgent: String) {

    data class Queue(val items: List<QueueItem>, val serverTime: String?, val location: String?)
    data class Claim(val claimed: Boolean, val reason: String?)

    /** HTTP status (0 = no answer) and Food Hub's error text. 401 = signed out; 400 + needLocation = choose the kitchen. */
    class ApiError(val status: Int, message: String, val needLocation: Boolean = false) : IOException(message)

    fun queue(since: String?, location: String, deviceId: String, paper: Int, lang: String): Queue {
        val q = buildList {
            if (!since.isNullOrBlank()) add("since=${enc(since)}")
            if (location.isNotBlank()) add("location=${enc(location)}")
            add("device=${enc(deviceId)}")
            add("paper=$paper")
            add("lang=${enc(lang)}")
        }.joinToString("&")
        val json = call("GET", "$origin/api/foodhub/kitchen/print-queue?$q", null)
        val arr = json.optJSONArray("items")
        val items = (0 until (arr?.length() ?: 0)).map { i ->
            val o = arr!!.getJSONObject(i)
            QueueItem(
                id = o.getString("id"), orderId = o.getString("orderId"), source = o.optString("source", "platform"), kind = o.optString("kind", "order"),
                number = o.optString("number"), brandName = if (o.isNull("brandName")) null else o.optString("brandName"),
                printed = if (o.isNull("printed")) null else o.optBoolean("printed"), ticket = o.optString("ticket"),
                printedElsewhere = if (!o.has("printedElsewhere") || o.isNull("printedElsewhere")) null else o.optBoolean("printedElsewhere"),
            )
        }
        return Queue(items, json.optString("serverTime").ifBlank { null }, json.optString("location").ifBlank { null })
    }

    fun claim(item: QueueItem, deviceId: String, location: String): Claim {
        val body = JSONObject().put("deviceId", deviceId).put("source", item.source).put("kind", item.kind)
        if (location.isNotBlank()) body.put("location", location)
        val json = call("POST", "$origin/api/foodhub/kitchen/print-queue/${enc(item.orderId)}/printed", body.toString())
        return Claim(json.optBoolean("claimed", false), json.optString("reason").ifBlank { null })
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun call(method: String, url: String, body: String?): JSONObject {
        val conn = (URL(url).openConnection() as HttpURLConnection)
        try {
            conn.requestMethod = method
            conn.connectTimeout = 10_000
            conn.readTimeout = 15_000
            conn.useCaches = false
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("User-Agent", userAgent)
            cookie()?.takeIf { it.isNotBlank() }?.let { conn.setRequestProperty("Cookie", it) }
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = conn.responseCode
            val text = (if (status in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (status !in 200..299) throw ApiError(status, json.optString("error").ifBlank { "HTTP $status" }, json.optBoolean("needLocation", false))
            return json
        } catch (e: ApiError) {
            throw e
        } catch (e: IOException) {
            throw ApiError(0, e.message ?: e.javaClass.simpleName)
        } finally {
            conn.disconnect()
        }
    }
}
