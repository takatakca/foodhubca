package ca.takatak.foodhub.tablet

import java.net.URI
import java.time.Instant

/** One ticket of GET /api/foodhub/kitchen/print-queue (lib/foodhub/kitchen/print-queue.ts PrintQueueItem). */
data class QueueItem(
    val id: String,
    val orderId: String,
    val source: String,
    val kind: String,
    val number: String,
    val brandName: String?,
    val printed: Boolean?,
    val ticket: String,
)

/** Decisions of the watch loop, kept pure so they are tested on the JVM (QueueLogicTest). */
object QueueLogic {
    /** Seconds the next poll looks back before the last server time: claims make the overlap harmless. */
    const val OVERLAP_SECONDS = 120L

    /** Tickets this tablet has neither printed nor handled yet, oldest first (the server already sorts them). */
    fun fresh(items: List<QueueItem>, seen: Set<String>): List<QueueItem> = items.filter { it.printed != true && it.id !in seen }

    /** Auto-print only with a printer chosen; otherwise the tablet rings and the kitchen reads the screen. */
    fun shouldPrint(autoPrint: Boolean, printer: PrinterType): Boolean = autoPrint && printer != PrinterType.NONE

    /**
     * The next since cursor: the last server time minus the overlap, only once every ticket of that answer was handled
     * (claimed, printed or skipped). Otherwise the same cursor again, so nothing is lost after a network error.
     */
    fun nextSince(current: String?, serverTime: String?, allHandled: Boolean): String? {
        if (!allHandled || serverTime.isNullOrBlank()) return current
        return try { Instant.parse(serverTime).minusSeconds(OVERLAP_SECONDS).toString() } catch (e: Exception) { current }
    }

    /** "https://foodhub.on2go.ca/kitchen" → "https://foodhub.on2go.ca" (https only; null for anything else). */
    fun originOf(url: String): String? = try {
        val u = URI(url.trim())
        val host = u.host
        if (!u.scheme.equals("https", ignoreCase = true) || host.isNullOrBlank()) null
        else "https://${host.lowercase()}${if (u.port > 0 && u.port != 443) ":${u.port}" else ""}"
    } catch (e: Exception) { null }

    /** Keeps the last [max] ids (the seen list survives restarts without growing forever). */
    fun remember(seen: List<String>, add: Collection<String>, max: Int = 500): List<String> =
        (seen.filter { it !in add } + add).takeLast(max)
}
