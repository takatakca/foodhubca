package ca.takatak.mev.clover

/** Food Hub's device endpoint (HttpFoodHubApi on the device, a fake in tests). */
interface FoodHubApi {
    fun receipt(order: String): Receipt
    /** Claims the right to print one document once (`FAC` original, or the newest `RPR` / `DUP`). */
    fun claimPrint(order: String, copy: String): Boolean
    /** Asks Takatak MEV for a reproduction (`RPR`) or a merchant copy (`DUP`): transmitted, then printable. */
    fun requestCopy(order: String, mode: String): Boolean
}

/** The Clover printer (CloverReceiptPrinter on the device). */
interface ReceiptPrinter {
    fun print(lines: List<String>, qrImage: String?, qrUrl: String?)
}

sealed class Outcome {
    data class Printed(val noTrans: String?) : Outcome()
    /** The original was printed already (by this device or another): a second paper is a reproduction. */
    object AlreadyPrinted : Outcome()
    /** Invoiced another way (platform, online or Food Hub order): nothing to print here. */
    object NotRegister : Outcome()
    /** Takatak MEV or Food Hub needs a person (a wrong tax rate in Clover, a refund by an amount…). */
    data class NeedsPerson(val reason: String?) : Outcome()
    /** Credited or not invoiced (refunded before it was sent, switched off): nothing to print. */
    data class NoInvoice(val status: String) : Outcome()
    object TimedOut : Outcome()
}

/**
 * Right after a payment on the register: wait for Takatak MEV's invoice, claim it, print it once. Waiting covers the
 * few seconds the invoice takes; an offline invoice (« PROBLÈME DE COMMUNICATION ») prints at once too — Takatak MEV
 * transmits it later.
 */
class ReceiptFlow(
    private val api: FoodHubApi,
    private val printer: ReceiptPrinter,
    private val sleep: (Long) -> Unit = { Thread.sleep(it) },
    private val now: () -> Long = { System.currentTimeMillis() },
    private val maxWaitMs: Long = 90_000,
    private val stepMs: Long = 2_000,
) {
    fun printOriginal(order: String): Outcome {
        val until = now() + maxWaitMs
        while (true) {
            val r = api.receipt(order)
            when {
                r.printable -> {
                    if (!api.claimPrint(order, "FAC")) return Outcome.AlreadyPrinted
                    printer.print(r.text80mm, r.qrImage, r.qrUrl)
                    return Outcome.Printed(r.noTrans)
                }
                r.status == "not_register" -> return Outcome.NotRegister
                r.status == "needs_human" || r.status == "rejected" -> return Outcome.NeedsPerson(r.reason)
                r.status == "credited" || r.status == "skipped" -> return Outcome.NoInvoice(r.status)
            }
            if (now() >= until) return Outcome.TimedOut
            sleep(stepMs)
        }
    }

    /** A reproduction (RPR) or merchant copy (DUP): asked from Takatak MEV, then printed once when it is issued. */
    fun printCopy(order: String, mode: String): Outcome {
        require(mode == "RPR" || mode == "DUP")
        val before = api.receipt(order).prints.filter { it.mode == mode }.map { it.printKey }.toSet()
        if (!api.requestCopy(order, mode)) return Outcome.NoInvoice("no_invoice")
        val until = now() + maxWaitMs
        while (true) {
            val copy = api.receipt(order).prints.lastOrNull { it.mode == mode && it.printKey !in before && (it.status == "accepted" || it.status == "offline") && it.text80mm.isNotEmpty() }
            if (copy != null) {
                if (!api.claimPrint(order, mode)) return Outcome.AlreadyPrinted
                printer.print(copy.text80mm, copy.qrImage, null)
                return Outcome.Printed(null)
            }
            if (now() >= until) return Outcome.TimedOut
            sleep(stepMs)
        }
    }
}
