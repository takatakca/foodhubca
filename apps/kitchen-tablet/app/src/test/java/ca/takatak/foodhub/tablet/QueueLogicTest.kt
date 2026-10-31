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
