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
    /** Not printed by this tablet but already by another one of this kitchen (the previous install, after a reinstall). */
    val printedElsewhere: Boolean? = null,
)

/** What the watch loop does with one ticket of the queue (QueueLogic.plan). */
enum class Step {
    /** Not printed here yet: claim it on the server; print and ring only if the claim is won. */
    CLAIM,
    /**
     * Claimed by this tablet (the queue says printed) but never written down here as handled: the claim's answer was
     * lost (timeout, Wi-Fi drop, 5xx after the write) or the app died right after it. Print and ring now, no new claim.
     */
    RECOVER,
    /** Auto-print off or no printer: ring only (the kitchen reads the screen). */
    RING,
    /** First run after an install or a data wipe: another tablet of this kitchen (the previous install) printed it. Nothing. */
    SILENT,
    /** Cancelled while its ticket was still waiting for the printer here: that ticket is dropped, ring, print nothing. */
    CANCEL_UNPRINTED,
}

data class Planned(val item: QueueItem, val step: Step)

data class QueueScope(val origin: String, val location: String, val deviceId: String)
data class QueueDrain(val scope: QueueScope, val location: String, val since: String, val handledIds: Set<String> = emptySet())

/** Decisions of the watch loop, kept pure so they are tested on the JVM (QueueLogicTest). */
object QueueLogic {
    /** Seconds the next poll looks back before the last server time: claims make the overlap harmless. */
    const val OVERLAP_SECONDS = 120L

    /** "direct:42:cancel" → "direct:42:order": the order ticket a cancel ticket belongs to. */
    fun orderTicketId(id: String): String = id.substringBeforeLast(':') + ":order"

    /**
     * One step per ticket the tablet has not handled yet (not in [seen], not already waiting for the printer in
     * [pendingIds]), oldest first (the server sorts them). [print] = a printer is chosen and auto-print is on.
     * [firstRun] = no poll was fully handled since this install (or since its data was wiped).
     */
    fun plan(items: List<QueueItem>, seen: Set<String>, pendingIds: Set<String>, print: Boolean, firstRun: Boolean): List<Planned> =
        items.filter { it.id !in seen && it.id !in pendingIds }.map { item ->
            val step = when {
                firstRun && item.printed != true && item.printedElsewhere == true -> Step.SILENT
                !print -> Step.RING
                item.kind == "cancel" && orderTicketId(item.id) in pendingIds -> Step.CANCEL_UNPRINTED
                item.printed == true -> Step.RECOVER
                else -> Step.CLAIM
            }
            Planned(item, step)
        }

    /**
     * Waiting tickets (claimed, not printed yet) that must never print now: the order tickets of the orders the queue
     * reports cancelled, and their own « ANNULÉE » tickets.
     */
    fun cancelledPending(items: List<QueueItem>, pendingIds: Set<String>): Set<String> =
        items.filter { it.kind == "cancel" && orderTicketId(it.id) in pendingIds }
            .flatMap { listOf(orderTicketId(it.id), it.id) }
            .filter { it in pendingIds }
            .toSet()

    /** Auto-print only with a printer chosen; otherwise the tablet rings and the kitchen reads the screen. */
    fun shouldPrint(autoPrint: Boolean, printer: PrinterType): Boolean = autoPrint && printer != PrinterType.NONE

    /**
     * Advance the since cursor only after handling the last page of the snapshot.
     * Keep the original cursor when a page remains or a claim needs retrying.
     */
    fun nextSince(current: String?, serverTime: String?, allHandled: Boolean, continuation: String? = null): String? {
        if (!allHandled || continuation != null || serverTime.isNullOrBlank()) return current
        return try { Instant.parse(serverTime).minusSeconds(OVERLAP_SECONDS).toString() } catch (e: Exception) { current }
    }

    fun drainForScope(drain: QueueDrain?, scope: QueueScope): QueueDrain? = drain?.takeIf { it.scope == scope }

    /** Only the selected queue can send a pending ticket. Old local rows keep their startup queue within this process. */
    fun pendingMatches(ticket: QueueScope?, location: String?, startup: QueueScope?, current: QueueScope?, activeLocation: String?): Boolean =
        current != null && (ticket ?: startup) == current && (location == null || activeLocation == null || location == activeLocation)

    /** A fresh window may clamp an old checkpoint. Keep handled IDs for the same queue, even after a restart. */
    fun reanchorDrain(current: QueueDrain?, returned: QueueDrain, continuation: String?): QueueDrain? {
        if (continuation != null) return current
        val sameQueue = current?.takeIf { it.scope == returned.scope && it.location == returned.location }
        return returned.copy(handledIds = sameQueue?.handledIds.orEmpty())
    }

    fun seenDuringDrain(recent: Collection<String>, drain: QueueDrain?): Set<String> =
        recent.toSet() + drain?.handledIds.orEmpty()

    /** Older servers cap the queue at 50 without telling the tablet whether more tickets are waiting. */
    fun queueMayHaveMore(paged: Boolean, itemCount: Int, continuation: String?): Boolean =
        continuation != null || (!paged && itemCount >= 50)

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
