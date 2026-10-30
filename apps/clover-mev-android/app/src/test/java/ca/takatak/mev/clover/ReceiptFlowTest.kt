package ca.takatak.mev.clover

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReceiptFlowTest {
    private val invoice = listOf("RESTO", "TOTAL : 19,55 $", "PAIEMENT REÇU", "[CODE QR]", "2026-10-27 10:00:00", "SIM000000001")
    private fun ok(prints: List<Copy> = emptyList()) = Receipt(status = "accepted", noTrans = "1", text80mm = invoice, qrImage = "data:image/png;base64,iVBORw0KGgo=", prints = prints)

    private class FakeApi(var answers: MutableList<Receipt>, var grant: Boolean = true) : FoodHubApi {
        val claims = mutableListOf<String>()
        val copies = mutableListOf<String>()
        override fun receipt(order: String) = if (answers.size > 1) answers.removeAt(0) else answers[0]
        override fun claimPrint(order: String, copy: String): Boolean { claims += copy; return grant }
        override fun requestCopy(order: String, mode: String): Boolean { copies += mode; return true }
    }

    private class FakePrinter : ReceiptPrinter {
        val jobs = mutableListOf<List<String>>()
        override fun print(lines: List<String>, qrImage: String?, qrUrl: String?) { jobs += lines }
    }

    private fun flow(api: FoodHubApi, printer: ReceiptPrinter): ReceiptFlow {
        var t = 0L
        return ReceiptFlow(api, printer, sleep = { t += it }, now = { t }, maxWaitMs = 10_000, stepMs = 2_000)
    }

    @Test fun waitsForTheInvoiceThenPrintsItOnce() {
        val api = FakeApi(mutableListOf(Receipt("unknown"), Receipt("pending"), ok()))
        val printer = FakePrinter()
        assertEquals(Outcome.Printed("1"), flow(api, printer).printOriginal("ORDER1"))
        assertEquals(listOf("FAC"), api.claims)
        assertEquals(listOf(invoice), printer.jobs)
    }

    @Test fun anOfflineInvoicePrintsAtOnce() {
        val printer = FakePrinter()
        assertTrue(flow(FakeApi(mutableListOf(ok().copy(status = "offline"))), printer).printOriginal("O") is Outcome.Printed)
        assertEquals(1, printer.jobs.size)
    }

    @Test fun neverPrintsTheOriginalTwice() {
        val printer = FakePrinter()
        assertEquals(Outcome.AlreadyPrinted, flow(FakeApi(mutableListOf(ok()), grant = false), printer).printOriginal("O"))
        assertTrue(printer.jobs.isEmpty())
    }

    @Test fun stopsWithoutPrintingWhenNothingIsDue() {
        val printer = FakePrinter()
        assertEquals(Outcome.NotRegister, flow(FakeApi(mutableListOf(Receipt("not_register"))), printer).printOriginal("O"))
        assertEquals(Outcome.NeedsPerson("amounts_mismatch: tax"), flow(FakeApi(mutableListOf(Receipt("needs_human", reason = "amounts_mismatch: tax"))), printer).printOriginal("O"))
        assertEquals(Outcome.NoInvoice("credited"), flow(FakeApi(mutableListOf(Receipt("credited"))), printer).printOriginal("O"))
        assertEquals(Outcome.TimedOut, flow(FakeApi(mutableListOf(Receipt("pending"))), printer).printOriginal("O"))
        assertTrue(printer.jobs.isEmpty())
    }

    @Test fun aReplacedJobStopsWaitingAndPrintsNothing() {
        // Split bill: the first payment's job waits; the last payment's job replaces it and prints.
        val printer = FakePrinter()
        var t = 0L
        val api = FakeApi(mutableListOf(Receipt("unknown"), Receipt("unknown"), ok()))
        val replaced = ReceiptFlow(api, printer, sleep = { t += it }, now = { t }, maxWaitMs = 10_000, stepMs = 2_000, stopped = { t >= 2_000 })
        assertEquals(Outcome.Replaced, replaced.printOriginal("O"))
        assertTrue(api.claims.isEmpty())
        assertTrue(printer.jobs.isEmpty())
        assertEquals(Outcome.Printed("1"), flow(api, printer).printOriginal("O"))
        assertEquals(1, printer.jobs.size)
    }

    @Test fun aReproductionIsAskedFromTakatakMevAndPrintsTheNewCopy() {
        val old = Copy("k:pr:rpr1", "RPR", "accepted", listOf("OLD"), null)
        val new = Copy("k:pr:rpr2", "RPR", "accepted", listOf("RESTO", "REPRODUCTION"), null)
        val api = FakeApi(mutableListOf(ok(listOf(old)), ok(listOf(old)), ok(listOf(old, new))))
        val printer = FakePrinter()
        assertEquals(Outcome.Printed(null), flow(api, printer).printCopy("O", "RPR"))
        assertEquals(listOf("RPR"), api.copies)
        assertEquals(listOf("RPR"), api.claims)
        assertEquals(listOf(listOf("RESTO", "REPRODUCTION")), printer.jobs)
    }
}

class ReceiptLayoutTest {
    @Test fun theQrGoesWhereTakatakMevMarkedIt() {
        val (before, after) = ReceiptLayout.split(listOf("A", "B", "[CODE QR]", "C"))
        assertEquals(listOf("A", "B"), before)
        assertEquals(listOf("C"), after)
        assertEquals(listOf("A") to emptyList<String>(), ReceiptLayout.split(listOf("A")))
    }

    @Test fun onlyAPngIsPrintedAsAnImage() {
        assertArrayEquals(byteArrayOf(1, 2, 3), ReceiptLayout.pngBytes("data:image/png;base64,AQID"))
        assertNull(ReceiptLayout.pngBytes("data:image/svg+xml;base64,PHN2Zz4="))
        assertNull(ReceiptLayout.pngBytes(null))
    }

    @Test fun parsesFoodHubsAnswer() {
        val r = ReceiptJson.parse("""{"ok":true,"receipt":{"status":"accepted","noTrans":"3","text80mm":["A","[CODE QR]"],"qrImage":"data:image/png;base64,AQID","qrUrl":"https://x.test/q","prints":[{"printKey":"k","mode":"DUP","status":"accepted","text80mm":["COPIE"]}]}}""")
        assertEquals("accepted", r.status)
        assertEquals("3", r.noTrans)
        assertEquals("https://x.test/q", r.qrUrl)
        assertTrue(r.printable)
        assertEquals("DUP", r.prints[0].mode)
        assertEquals("unknown", ReceiptJson.parse("""{"ok":false,"error":"x"}""").status)
    }
}
