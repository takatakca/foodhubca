package ca.takatak.foodhub.tablet

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import java.net.InetAddress
import java.net.ServerSocket
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

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
        assertFalse(QueueLogic.pendingMatches(original, "A", original, original, null))
        assertTrue(QueueLogic.pendingMatches(null, null, original, original, "A"))
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
    fun pendingOrderStatusRequiresTheExpectedSignedKitchenDeviceAndReference() {
        val id = "direct:fixture:colon:order"
        val url = "/api/foodhub/kitchen/print-queue/pending"
        val responses = listOf(
            Triple("A", "tablet-test", JSONObject().put(id, "clear")) to FoodHubApi.PendingStatus.CLEAR,
            Triple("A", "tablet-test", JSONObject().put(id, "cancelled")) to FoodHubApi.PendingStatus.CANCELLED,
            Triple("A", "tablet-test", JSONObject().put(id, "unverified")) to FoodHubApi.PendingStatus.UNVERIFIED,
            Triple("B", "tablet-test", JSONObject().put(id, "clear")) to null,
            Triple("A", "other-tablet", JSONObject().put(id, "clear")) to null,
            Triple("A", "tablet-test", JSONObject().put("direct:other:order", "clear")) to null,
            Triple("A", "tablet-test", JSONObject().put(id, "unknown-verdict")) to null,
        )
        val executor = Executors.newSingleThreadExecutor()
        try {
            ServerSocket(0, 10, InetAddress.getByName("127.0.0.1")).use { server ->
                server.soTimeout = 3_000
                val fixtures = executor.submit {
                    for ((response, _) in responses) {
                        server.accept().use { socket ->
                            socket.soTimeout = 3_000
                            val input = socket.getInputStream().bufferedReader()
                            assertEquals("POST $url HTTP/1.1", input.readLine())
                            val headers = generateSequence(input::readLine).takeWhile(String::isNotEmpty)
                                .associate { it.substringBefore(':').lowercase() to it.substringAfter(':').trim() }
                            val payload = CharArray(headers.getValue("content-length").toInt()) { input.read().toChar() }.concatToString()
                            val submitted = JSONObject(payload)
                            assertEquals("A", submitted.getString("location"))
                            assertEquals("tablet-test", submitted.getString("deviceId"))
                            assertEquals(id, submitted.getJSONArray("ids").getString(0))
                            assertEquals(1, submitted.getJSONArray("ids").length())
                            assertEquals("session=synthetic", headers["cookie"])
                            val (location, device, results) = response
                            val body = JSONObject().put("ok", true).put("location", location).put("deviceId", device).put("results", results)
                                .toString().toByteArray()
                            val status = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n"
                            socket.getOutputStream().apply { write(status.toByteArray()); write(body); flush() }
                        }
                    }
                }
                val api = FoodHubApi("http://127.0.0.1:${server.localPort}", { "session=synthetic" }, "fixture")
                for ((_, expected) in responses) {
                    val actual = runCatching { api.pendingStatus(id, "tablet-test", "A") { true } }
                    if (expected == null) {
                        assertTrue(actual.exceptionOrNull() is FoodHubApi.ApiError)
                        assertEquals("Invalid pending print response", actual.exceptionOrNull()?.message)
                    } else {
                        assertEquals(expected, actual.getOrThrow())
                    }
                }
                fixtures.get(3, TimeUnit.SECONDS)
            }
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun pendingStatusStopsBeforeSendingOnScopeChange() {
        var current = "A"
        val api = FoodHubApi("http://127.0.0.1:1", { current = "B"; null }, "fixture")
        val failure = runCatching { api.pendingStatus("platform:fixture:order", "tablet-test", "A") { current == "A" } }
        assertEquals("Print queue scope changed", failure.exceptionOrNull()?.message)
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

        val original = QueueDrain(scope, "KITCHEN1", "2026-10-29T15:00:00Z", allHandled.associateWith { null })
        val returned = QueueDrain(scope, "KITCHEN1", "2026-10-29T16:00:00Z")
        val replay = QueueLogic.reanchorDrain(QueueLogic.drainForScope(original, scope), returned, null)
        val seen = QueueLogic.seenDuringDrain(recent, replay)
        val firstPage = ticks.take(50) + item("new", printed = true)
        assertEquals(listOf("new/order=RECOVER"), steps(QueueLogic.plan(firstPage, seen, emptySet(), print = true, firstRun = false)))
        assertEquals(listOf("new/order=RING"), steps(QueueLogic.plan(firstPage, seen, emptySet(), print = false, firstRun = false)))
        assertEquals(emptyMap<String, Instant?>(), QueueLogic.reanchorDrain(original, returned.copy(location = "KITCHEN2"), null)?.handled)
    }

    @Test
    fun completedDrainKeepsMoreThanFiveHundredOverlapReceiptsAcrossRestart() {
        val scope = QueueScope("https://hub.example", "", "tablet-test")
        val horizon = Instant.parse("2026-10-29T16:00:00Z")
        val cutoff = horizon.minusSeconds(QueueLogic.OVERLAP_SECONDS)
        val replay = (1..550).map { item("overlap-$it", printed = true) }
        val before = item("before-cutoff", printed = true)
        val receipts = replay.associate { it.id to cutoff } + (before.id to cutoff.minusMillis(1))
        val drain = QueueDrain(scope, "A", "2026-10-29T15:00:00Z", receipts)

        val completed = QueueLogic.finishDrain(drain, horizon.toString())
        val restarted = QueueLogic.drainForScope(QueueDrain.decode(completed.encode()), scope)
        assertEquals(cutoff.toString(), restarted?.since)
        assertEquals(550, restarted?.handled?.size)
        assertFalse(before.id in restarted?.handled.orEmpty())
        val freshClaim = item("lost-reply", printed = true)
        val seen = QueueLogic.seenDuringDrain(QueueLogic.remember(emptyList(), receipts.keys), restarted)
        assertEquals(listOf("lost-reply/order=RECOVER"), steps(QueueLogic.plan(replay + freshClaim, seen, emptySet(), true, false)))

        val moved = QueueLogic.reanchorDrain(restarted, QueueDrain(scope, "B", cutoff.toString()), null)
        assertTrue(moved?.handled.orEmpty().isEmpty())
        assertTrue(QueueLogic.finishDrain(completed, horizon.plusMillis(1).toString()).handled.isEmpty())
    }

    @Test
    fun returningToAKitchenOnlyRecoversItsUnacknowledgedTicketAfterMoreThanFiveHundredReceipts() {
        val scope = QueueScope("https://hub.example", "A", "tablet-test")
        val horizon = Instant.parse("2026-10-29T16:00:00Z")
        val at = horizon.minusSeconds(8 * 60)
        val handled = (1..550).map { item("receipt-$it", printed = true).copy(at = at) }
        val lostReply = item("lost-reply", printed = true).copy(at = at)
        val activeA = QueueDrain(scope, "A", horizon.minusSeconds(15 * 60).toString(), handled.associate { it.id to it.at })
        val completedA = QueueLogic.finishDrain(activeA, horizon.toString())
        assertTrue(completedA.handled.isEmpty())
        val bScope = scope.copy(location = "B")
        val bHorizon = horizon.plusSeconds(60)
        val bReceipt = item("b-receipt")
        val archive = handled.fold(RecentQueueReceipts(scope.origin, scope.deviceId, horizon)) { receipts, ticket ->
            receipts.record("A", ticket.id, ticket.at)
        }
        assertNull(QueueLogic.drainForScope(completedA, bScope))
        val moved = archive.advance(bHorizon).record("B", bReceipt.id, bHorizon)
            .record("B", "undated", null)
            .record("B", "future", bHorizon.plusSeconds(1))
            .record("B", "expired", bHorizon.minusSeconds(15 * 60 + 1))
        val restarted = RecentQueueReceipts.decode(moved.encode())
        val returnAt = bHorizon.plusSeconds(60)
        val archiveOnReturn = restarted.advance(returnAt)
        val returnedA = QueueDrain(scope.copy(location = ""), "A", returnAt.minusSeconds(15 * 60).toString())
        val deviceSeen = QueueLogic.remember(emptyList(), handled.map { it.id } + bReceipt.id)
        assertFalse(handled.first().id in deviceSeen)
        val restored = archiveOnReturn.ids(returnedA.scope, returnedA.location)
        val seen = QueueLogic.seenDuringDrain(deviceSeen, returnedA, restored)
        assertEquals(listOf("lost-reply/order=RECOVER"), steps(QueueLogic.plan(handled + lostReply, seen, emptySet(), true, false)))
        assertEquals(setOf(bReceipt.id), archiveOnReturn.ids(bScope, "B"))
        assertTrue(archiveOnReturn.ids(scope.copy(origin = "https://different.example"), "A").isEmpty())
        assertTrue(archiveOnReturn.ids(scope.copy(deviceId = "other-tablet"), "A").isEmpty())
        assertEquals(550, archiveOnReturn.advance(at.plusSeconds(15 * 60)).ids(scope, "A").size)
        assertTrue(archiveOnReturn.advance(at.plusSeconds(15 * 60 + 1)).ids(scope, "A").isEmpty())
    }

    @Test
    fun boundedHistorySurvivesKitchenChangesButResetsForAnotherServer() {
        val original = QueueScope("https://hub.example", "A", "tablet-test")
        val otherKitchen = original.copy(location = "B")
        val otherServer = original.copy(origin = "https://different.example")
        val checkpoint = QueueDrain(original, "A", "2026-10-29T15:00:00Z")
        assertNull(QueueLogic.drainForScope(checkpoint, otherKitchen))
        assertFalse(QueueLogic.seenOriginChanged(original.origin, otherKitchen.origin))
        assertFalse(QueueLogic.seenOriginChanged(otherKitchen.origin, original.origin))
        assertFalse(QueueLogic.seenOriginChanged(original.origin, null))
        assertFalse(QueueLogic.seenOriginChanged(null, original.origin))
        assertTrue(QueueLogic.seenOriginChanged(original.origin, otherServer.origin))
    }

    @Test
    fun oldUndatedReceiptsSurviveAnOverlapAndThenExpire() {
        val legacy = """{"origin":"https://hub.example","requestedLocation":"","deviceId":"tablet-test","location":"A","since":"2026-10-29T15:00:00Z","handledIds":["platform:legacy:order"]}"""
        val horizon = Instant.parse("2026-10-29T16:00:00Z")
        val completed = QueueLogic.finishDrain(QueueDrain.decode(legacy), horizon.toString())
        assertEquals(horizon, completed.handled["platform:legacy:order"])
        val advanced = QueueLogic.finishDrain(completed, horizon.plusSeconds(QueueLogic.OVERLAP_SECONDS + 1).toString())
        assertTrue(advanced.handled.isEmpty())
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
