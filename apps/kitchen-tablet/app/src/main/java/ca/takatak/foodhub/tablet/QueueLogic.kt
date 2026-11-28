package ca.takatak.foodhub.tablet

import java.net.URI
import java.time.Instant
import org.json.JSONObject

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
    val at: Instant? = null,
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

/** Exact receipts that can reappear after a kitchen change clears the active cursor. */
data class RecentQueueReceipts(
    val origin: String, val deviceId: String, val serverTime: Instant,
    private val kitchens: Map<String, Map<String, Instant>> = emptyMap(),
) {
    fun matches(scope: QueueScope): Boolean = origin == scope.origin && deviceId == scope.deviceId

    fun ids(scope: QueueScope, location: String): Set<String> =
        if (matches(scope)) kitchens[location].orEmpty().keys else emptySet()

    fun advance(horizon: Instant): RecentQueueReceipts {
        if (horizon <= serverTime) return this
        val cutoff = horizon.minusSeconds(FRESH_REPLAY_SECONDS)
        val retained = kitchens.mapValues { (_, receipts) -> receipts.filterValues { it >= cutoff } }
            .filterValues { it.isNotEmpty() }
        return copy(serverTime = horizon, kitchens = retained)
    }

    fun record(location: String, id: String, at: Instant?): RecentQueueReceipts {
        if (at == null || at > serverTime || at < serverTime.minusSeconds(FRESH_REPLAY_SECONDS)) return this
        val receipts = kitchens[location].orEmpty()
        if (receipts[id]?.let { it >= at } == true) return this
        return copy(kitchens = kitchens + (location to (receipts + (id to at))))
    }

    fun encode(): String {
        val locations = JSONObject()
        kitchens.forEach { (location, receipts) ->
            val tickets = JSONObject()
            receipts.forEach { (id, at) -> tickets.put(id, at.toString()) }
            locations.put(location, tickets)
        }
        return JSONObject().put("origin", origin).put("deviceId", deviceId)
            .put("serverTime", serverTime.toString()).put("kitchens", locations).toString()
    }

    companion object {
        // Matches DEFAULT_SINCE_MS in lib/foodhub/kitchen/print-queue.ts.
        private const val FRESH_REPLAY_SECONDS = 15 * 60L

        fun decode(stored: String): RecentQueueReceipts {
            val data = JSONObject(stored)
            val locations = data.getJSONObject("kitchens")
            val kitchens = locations.keys().asSequence().associateWith { location ->
                val tickets = locations.getJSONObject(location)
                tickets.keys().asSequence().associateWith { id -> Instant.parse(tickets.getString(id)) }
            }
            return RecentQueueReceipts(data.getString("origin"), data.getString("deviceId"),
                Instant.parse(data.getString("serverTime")), kitchens)
        }
    }
}

/** The replay window or completed checkpoint, with scoped receipts for any ticket the next read can return. */
data class QueueDrain(val scope: QueueScope, val location: String, val since: String, val handled: Map<String, Instant?> = emptyMap()) {
    fun encode(): String {
        val receipts = JSONObject()
        handled.forEach { (id, at) -> receipts.put(id, at?.toString() ?: JSONObject.NULL) }
        return JSONObject().put("origin", scope.origin).put("requestedLocation", scope.location)
            .put("deviceId", scope.deviceId).put("location", location).put("since", since)
            .put("handled", receipts).toString()
    }

    companion object {
        fun decode(stored: String): QueueDrain {
            val data = JSONObject(stored)
            val handled = data.optJSONObject("handled")?.let { receipts ->
                receipts.keys().asSequence().associateWith { QueueLogic.parseInstant(receipts.opt(it) as? String) }
            } ?: data.optJSONArray("handledIds")?.let { ids ->
                (0 until ids.length()).associate { ids.getString(it) to null }
            }.orEmpty()
            return QueueDrain(
                QueueScope(data.getString("origin"), data.getString("requestedLocation"), data.getString("deviceId")),
                data.getString("location"), data.getString("since"), handled,
            )
        }
    }
}

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
        if (!allHandled || continuation != null) return current
        return parseInstant(serverTime)?.minusSeconds(OVERLAP_SECONDS)?.toString() ?: current
    }

    fun drainForScope(drain: QueueDrain?, scope: QueueScope): QueueDrain? = drain?.takeIf { it.scope == scope }

    /** The bounded history deduplicates a tablet across kitchens of the same server. */
    fun seenOriginChanged(previous: String?, current: String?): Boolean =
        previous != null && current != null && previous != current

    /** Scoped tickets need a verified kitchen. Old local rows keep their startup queue within this process. */
    fun pendingMatches(ticket: QueueScope?, location: String?, startup: QueueScope?, current: QueueScope?, activeLocation: String?): Boolean =
        current != null && (ticket ?: startup) == current && (location == null || location == activeLocation)

    /** A fresh window may clamp an old checkpoint. Keep handled IDs for the same queue, even after a restart. */
    fun reanchorDrain(current: QueueDrain?, returned: QueueDrain, continuation: String?): QueueDrain? {
        if (continuation != null) return current
        val sameQueue = current?.takeIf { it.scope == returned.scope && it.location == returned.location }
        return returned.copy(handled = sameQueue?.handled.orEmpty())
    }

    fun seenDuringDrain(recent: Collection<String>, drain: QueueDrain?, restored: Set<String> = emptySet()): Set<String> =
        recent.toSet() + drain?.handled.orEmpty().keys + restored

    /** Keep receipts on the inclusive lower bound. Legacy receipts without dates age from the observed horizon. */
    fun finishDrain(drain: QueueDrain, serverTime: String?): QueueDrain {
        val since = nextSince(null, serverTime, allHandled = true) ?: return drain
        val checkpoint = Instant.parse(since)
        val fallback = checkpoint.plusSeconds(OVERLAP_SECONDS)
        val handled = drain.handled.mapValues { (_, at) -> at ?: fallback }.filterValues { it >= checkpoint }
        return drain.copy(since = since, handled = handled)
    }

    fun parseInstant(value: String?): Instant? = value?.let { runCatching { Instant.parse(it) }.getOrNull() }

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
