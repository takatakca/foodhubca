package ca.takatak.foodhub.tablet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class QueueLogicTest {
    private fun item(id: String, printed: Boolean? = false, elsewhere: Boolean? = false, kind: String = "order") =
        QueueItem("platform:$id:$kind", id, "platform", kind, "#$id", null, printed, "@@HBC #$id", elsewhere)

    private fun steps(plan: List<Planned>) = plan.map { it.item.orderId + "/" + it.item.kind + "=" + it.step }

    @Test
    fun claimedTicketWaitsForItsOriginalQueueAndResolvedKitchen() {
        val original = QueueScope("https://hub.example", "", "tablet-test")
        val changed = original.copy(location = "B")
        val otherOrigin = original.copy(origin = "https://second.example")
        assertTrue(QueueLogic.pendingMatches(original, "A", original, original, "A"))
        assertFalse(QueueLogic.pendingMatches(original, "A", original, changed, "B"))
        assertFalse(QueueLogic.pendingMatches(original, "A", original, otherOrigin, "A"))
        assertFalse(QueueLogic.pendingMatches(original, "A", original, original, "B"))
        assertFalse(QueueLogic.pendingMatches(null, null, original, changed, "B"))
        assertTrue(QueueLogic.pendingMatches(original, "A", original, original, null))
    }

    @Test
    fun claimStopsBeforeSendingIfTheKitchenChangesWhileReadingTheSession() {
        var current = "A"
        val api = FoodHubApi("http://127.0.0.1:1", { current = "B"; null }, "fixture")
        val error = runCatching { api.claim(item("a"), "fixture-tablet", "A") { current == "A" } }.exceptionOrNull()
        assertTrue(error is FoodHubApi.ApiError)
        assertEquals("Print queue scope changed", error?.message)
    }

    @Test
    fun planClaimsNewTicketsAndSkipsSeenAndWaiting() {
        val items = listOf(item("a"), item("b"), item("c", printed = null))
        val plan = QueueLogic.plan(items, seen = setOf("platform:b:order"), pendingIds = setOf("platform:c:order"), print = true, firstRun = false)
        assertEquals(listOf("a/order=CLAIM"), steps(plan))
    }

    @Test
    fun lostClaimAnswerIsPrintedNotDropped() {
        // Claimed by this tablet (printed = true) but never written down here: the answer was lost, or the app died.
        val plan = QueueLogic.plan(listOf(item("a", printed = true), item("b", printed = true)), seen = setOf("platform:b:order"), pendingIds = emptySet(), print = true, firstRun = false)
        assertEquals(listOf("a/order=RECOVER"), steps(plan))
    }

    @Test
    fun reinstallDoesNotReprintWhatTheKitchenAlreadyPrinted() {
        val items = listOf(item("old1", elsewhere = true), item("old2", elsewhere = true), item("gap", elsewhere = false))
        // First run after an install: what the previous install printed is skipped (no ticket, no alarm); the order that
        // arrived during the reinstall is printed.
        assertEquals(listOf("old1/order=SILENT", "old2/order=SILENT", "gap/order=CLAIM"), steps(QueueLogic.plan(items, emptySet(), emptySet(), print = true, firstRun = true)))
        assertEquals(listOf("old1/order=SILENT", "old2/order=SILENT", "gap/order=RING"), steps(QueueLogic.plan(items, emptySet(), emptySet(), print = false, firstRun = true)))
        // Afterwards each tablet prints its own copy again.
        assertEquals(listOf("old1/order=CLAIM", "old2/order=CLAIM", "gap/order=CLAIM"), steps(QueueLogic.plan(items, emptySet(), emptySet(), print = true, firstRun = false)))
    }

    @Test
    fun ringOnlyWithoutPrinter() {
        val plan = QueueLogic.plan(listOf(item("a"), item("b", printed = true)), emptySet(), emptySet(), print = false, firstRun = false)
        assertEquals(listOf("a/order=RING", "b/order=RING"), steps(plan))
    }

    @Test
    fun cancelledWhileWaitingForThePrinterIsNeverPrinted() {
        val waiting = setOf("platform:a:order", "platform:b:order")
        val items = listOf(item("a", printed = true), item("a", kind = "cancel"), item("c"), item("c", kind = "cancel"))
        val plan = QueueLogic.plan(items, seen = setOf("platform:c:order"), pendingIds = waiting, print = true, firstRun = false)
        // a: its ticket never printed → drop it, ring, no « ANNULÉE » slip. c: printed earlier → the slip is claimed.
        assertEquals(listOf("a/cancel=CANCEL_UNPRINTED", "c/cancel=CLAIM"), steps(plan))
        assertEquals(setOf("platform:a:order"), QueueLogic.cancelledPending(items, waiting))
        // Its own cancel slip, if it was waiting too, goes with it.
        assertEquals(setOf("platform:a:order", "platform:a:cancel"), QueueLogic.cancelledPending(items, waiting + "platform:a:cancel"))
        assertEquals("direct:42:order", QueueLogic.orderTicketId("direct:42:cancel"))
    }

    @Test
    fun printsOnlyWithAPrinterAndAutoPrint() {
        assertTrue(QueueLogic.shouldPrint(true, PrinterType.BLUETOOTH))
        assertTrue(QueueLogic.shouldPrint(true, PrinterType.NETWORK))
        assertFalse(QueueLogic.shouldPrint(true, PrinterType.NONE))
        assertFalse(QueueLogic.shouldPrint(false, PrinterType.BLUETOOTH))
    }

    @Test
    fun cursorMovesOnlyWhenEverythingWasHandled() {
        assertEquals("2026-10-30T15:58:00Z", QueueLogic.nextSince(null, "2026-10-30T16:00:00.000Z", true))
        assertEquals("2026-10-30T15:00:00Z", QueueLogic.nextSince("2026-10-30T15:00:00Z", "2026-10-30T16:00:00.000Z", false))
        assertEquals("keep", QueueLogic.nextSince("keep", "not a date", true))
        assertNull(QueueLogic.nextSince(null, null, true))
    }

    @Test
    fun replayKeepsOriginalWindowUntilTheLastTicketIsHandled() {
        val since = "2026-10-30T15:50:00Z"
        val snapshot = "2026-10-30T16:00:00.000Z"
        val scope = QueueScope("https://foodhub.on2go.ca", "", "tablet-test")
        val drain = QueueDrain(scope, "KITCHEN1", since)
        assertEquals(since, QueueLogic.nextSince(since, snapshot, true, "next-page"))
        assertEquals(since, QueueLogic.drainForScope(drain, scope)?.since)
        assertNull(QueueLogic.drainForScope(drain, scope.copy(location = "KITCHEN2")))
        assertNull(QueueLogic.drainForScope(drain, scope.copy(origin = "https://another.example")))
        assertNull(QueueLogic.drainForScope(drain, scope.copy(deviceId = "new-tablet")))

        val tickets = (1..51).map { item("ticket-$it") }
        val firstPageIds = tickets.take(50).map { it.id }.toSet()
        assertEquals(listOf("ticket-51/order=RECOVER"), steps(QueueLogic.plan(
            tickets.dropLast(1) + item("ticket-51", printed = true), firstPageIds, emptySet(), print = true, firstRun = true,
        )))
        assertEquals(since, QueueLogic.nextSince(since, snapshot, false))
        assertEquals("2026-10-30T15:58:00Z", QueueLogic.nextSince(since, snapshot, true))
    }

    @Test
    fun onlyLegacyFullPagesWithoutAContinuationStayOpen() {
        assertTrue(QueueLogic.queueMayHaveMore(false, 50, null))
        assertFalse(QueueLogic.queueMayHaveMore(false, 49, null))
        assertFalse(QueueLogic.queueMayHaveMore(true, 50, null))
        assertTrue(QueueLogic.queueMayHaveMore(true, 50, "next-page"))
    }

    @Test
    fun aFreshPageReanchorsAnExpiredDrainToTheServersClampedWindow() {
        val scope = QueueScope("https://foodhub.on2go.ca", "", "tablet-test")
        val expired = QueueDrain(scope, "KITCHEN1", "2026-10-29T15:00:00Z")
        val clamped = expired.copy(since = "2026-10-29T16:00:00Z")

        assertEquals(clamped, QueueLogic.reanchorDrain(expired, clamped, null))
        assertEquals(clamped, QueueLogic.reanchorDrain(null, clamped, null))
        assertEquals(expired, QueueLogic.reanchorDrain(expired, clamped, "continuation"))
    }

    @Test
    fun anUnfinishedDrainReplaysMoreThanFiveHundredTicketsWithoutReprintingEarlyClaims() {
        val scope = QueueScope("https://foodhub.on2go.ca", "", "tablet-test")
        val ticks = (1..550).map { item("old-$it", printed = true) }
        val allHandled = ticks.map { it.id }.toSet()
        val recent = QueueLogic.remember(emptyList(), allHandled)
        assertEquals(500, recent.size)
        assertFalse(ticks.first().id in recent)

        val original = QueueDrain(scope, "KITCHEN1", "2026-10-29T15:00:00Z", allHandled)
        val returned = QueueDrain(scope, "KITCHEN1", "2026-10-29T16:00:00Z")
        val replay = QueueLogic.reanchorDrain(QueueLogic.drainForScope(original, scope), returned, null)
        val seen = QueueLogic.seenDuringDrain(recent, replay)
        val firstPage = ticks.take(50) + item("new", printed = true)
        assertEquals(listOf("new/order=RECOVER"), steps(QueueLogic.plan(firstPage, seen, emptySet(), print = true, firstRun = false)))
        assertEquals(listOf("new/order=RING"), steps(QueueLogic.plan(firstPage, seen, emptySet(), print = false, firstRun = false)))
        assertEquals(emptySet<String>(), QueueLogic.reanchorDrain(original, returned.copy(location = "KITCHEN2"), null)?.handledIds)
    }

    @Test
    fun originIsHttpsOnly() {
        assertEquals("https://foodhub.on2go.ca", QueueLogic.originOf("https://foodhub.on2go.ca/kitchen"))
        assertEquals("https://foodhub.on2go.ca", QueueLogic.originOf(" HTTPS://FoodHub.on2go.ca/kitchen/lock?next=/kitchen "))
        assertEquals("https://example.test:8443", QueueLogic.originOf("https://example.test:8443/kitchen"))
        assertNull(QueueLogic.originOf("http://foodhub.on2go.ca/kitchen"))
        assertNull(QueueLogic.originOf("javascript:alert(1)"))
        assertNull(QueueLogic.originOf("not a url"))
    }

    @Test
    fun seenListStaysBounded() {
        val seen = (1..10).map { "id$it" }
        val next = QueueLogic.remember(seen, listOf("id3", "new"), max = 5)
        assertEquals(listOf("id7", "id8", "id9", "id10", "id3", "new").takeLast(5), next)
        assertEquals(5, next.size)
    }

    @Test
    fun alarmToneIsLoudWithSilenceBetweenLoops() {
        val pcm = Tone.alarm()
        assertEquals((2.8 * Tone.SAMPLE_RATE).toInt(), pcm.size)
        val peak = pcm.maxOf { abs(it.toInt()) }
        assertTrue("peak $peak", peak > 0.75 * Short.MAX_VALUE)
        // The last 0.5 s is silent: the loop has a breath between two rings.
        assertTrue(pcm.takeLast(Tone.SAMPLE_RATE / 2).all { it.toInt() == 0 })
        assertTrue(Tone.beep().isNotEmpty())
    }
}
