package ca.takatak.foodhub.tablet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class QueueLogicTest {
    private fun item(id: String, printed: Boolean? = false) = QueueItem(id, id, "platform", "order", "#$id", null, printed, "@@HBC #$id")

    @Test
    fun freshSkipsPrintedAndSeen() {
        val items = listOf(item("a"), item("b", printed = true), item("c"), item("d", printed = null))
        assertEquals(listOf("a", "d"), QueueLogic.fresh(items, setOf("c")).map { it.id })
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
