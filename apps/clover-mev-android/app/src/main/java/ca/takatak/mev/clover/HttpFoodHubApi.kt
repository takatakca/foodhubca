package ca.takatak.mev.clover

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Food Hub's /api/foodhub/mev/clover-device/* with the merchant's own Clover token (from CloverAuth on this device):
 * Food Hub checks it with Clover and serves only this merchant's register sales.
 */
class HttpFoodHubApi(baseUrl: String, private val merchantId: String, private val cloverToken: String) : FoodHubApi {
    private val base = baseUrl.trimEnd('/') + "/api/foodhub/mev/clover-device"

    private fun call(method: String, path: String, body: JSONObject? = null): Pair<Int, String> {
        val c = URL(base + path).openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = 10_000
            c.readTimeout = 20_000
            c.setRequestProperty("Authorization", "Bearer $cloverToken")
            c.setRequestProperty("X-Clover-Merchant-Id", merchantId)
            c.setRequestProperty("Accept", "application/json")
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            return code to text
        } finally {
            c.disconnect()
        }
    }

    override fun receipt(order: String): Receipt {
        val (code, text) = call("GET", "/receipt?order=" + URLEncoder.encode(order, "UTF-8"))
        // Not reachable / refused: keep waiting (the flow's deadline decides), the reason is kept for the screen.
        if (code !in 200..299) return Receipt(status = "unknown", reason = "HTTP $code")
        return ReceiptJson.parse(text)
    }

    override fun claimPrint(order: String, copy: String): Boolean {
        val (code, text) = call("POST", "/print", JSONObject().put("order", order).put("copy", copy))
        return code in 200..299 && JSONObject(text).optBoolean("granted", false)
    }

    override fun requestCopy(order: String, mode: String): Boolean {
        val (code, _) = call("POST", "/copy", JSONObject().put("order", order).put("mode", mode))
        return code in 200..299
    }
}
