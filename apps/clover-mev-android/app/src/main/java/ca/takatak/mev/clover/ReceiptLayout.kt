package ca.takatak.mev.clover

import java.util.Base64

/** Where the QR goes on the paper: Takatak MEV marks its place with the line « [CODE QR] » (Revenu Québec's layout). */
object ReceiptLayout {
    const val QR_MARK = "[CODE QR]"

    /** The lines before and after the QR code (the mark itself is not printed). No mark → everything before. */
    fun split(lines: List<String>): Pair<List<String>, List<String>> {
        val at = lines.indexOfFirst { it.trim() == QR_MARK }
        if (at < 0) return lines to emptyList()
        return lines.subList(0, at) to lines.subList(at + 1, lines.size)
    }

    /** The PNG bytes of a `data:image/png;base64,…` URL (null for anything else: an SVG cannot be printed as is). */
    fun pngBytes(dataUrl: String?): ByteArray? {
        val prefix = "data:image/png;base64,"
        if (dataUrl == null || !dataUrl.startsWith(prefix)) return null
        return try { Base64.getDecoder().decode(dataUrl.substring(prefix.length)) } catch (e: IllegalArgumentException) { null }
    }
}
