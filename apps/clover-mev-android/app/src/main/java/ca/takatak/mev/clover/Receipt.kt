package ca.takatak.mev.clover

import org.json.JSONArray
import org.json.JSONObject

/** One copy Takatak MEV made of an invoice: a reproduction (RPR) or a merchant copy (DUP). */
data class Copy(val printKey: String, val mode: String, val status: String, val text80mm: List<String>, val qrImage: String?)

/**
 * The Revenu Québec invoice of a register sale, exactly as Takatak MEV rendered it (Food Hub's
 * /api/foodhub/mev/clover-device/receipt). The app prints these lines and this QR code, never numbers of its own.
 */
data class Receipt(
    val status: String,
    val reason: String? = null,
    val noTrans: String? = null,
    val text80mm: List<String> = emptyList(),
    val qrImage: String? = null,
    val qrUrl: String? = null,
    val printedAt: String? = null,
    val prints: List<Copy> = emptyList(),
) {
    /** Accepted by MEV-WEB, or recorded offline (« PROBLÈME DE COMMUNICATION »): both are printable invoices. */
    val printable: Boolean get() = (status == "accepted" || status == "offline") && text80mm.isNotEmpty()
}

object ReceiptJson {
    private fun lines(a: JSONArray?): List<String> = if (a == null) emptyList() else List(a.length()) { a.optString(it) }
    private fun opt(o: JSONObject, k: String): String? = if (o.has(k) && !o.isNull(k)) o.optString(k) else null

    /** Food Hub's answer `{ ok, receipt: {...} }` → Receipt. */
    fun parse(body: String): Receipt {
        val root = JSONObject(body)
        val r = root.optJSONObject("receipt") ?: return Receipt(status = "unknown", reason = opt(root, "error"))
        val prints = r.optJSONArray("prints")
        return Receipt(
            status = r.optString("status", "unknown"),
            reason = opt(r, "reason"),
            noTrans = opt(r, "noTrans"),
            text80mm = lines(r.optJSONArray("text80mm")),
            qrImage = opt(r, "qrImage"),
            qrUrl = opt(r, "qrUrl"),
            printedAt = opt(r, "printedAt"),
            prints = if (prints == null) emptyList() else List(prints.length()) {
                val p = prints.getJSONObject(it)
                Copy(p.optString("printKey"), p.optString("mode"), p.optString("status"), lines(p.optJSONArray("text80mm")), opt(p, "qrImage"))
            },
        )
    }
}
