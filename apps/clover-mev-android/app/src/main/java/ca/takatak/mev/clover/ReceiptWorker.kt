package ca.takatak.mev.clover

import android.content.Context
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.clover.sdk.util.CloverAccount
import com.clover.sdk.util.CloverAuth

/** Prints the invoice of one register sale (or a copy) in the background: auth with Clover, wait for it, print once. */
class ReceiptWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val order = inputData.getString(KEY_ORDER) ?: return Result.failure()
        val mode = inputData.getString(KEY_MODE) ?: "FAC"
        val account = CloverAccount.getAccount(applicationContext) ?: return done(order, "no_clover_account")
        val auth = try { CloverAuth.authenticate(applicationContext, account) } catch (e: Exception) { null }
        if (auth?.authToken.isNullOrBlank() || auth?.merchantId.isNullOrBlank()) return done(order, "clover_auth_failed", retry = true)
        val flow = ReceiptFlow(HttpFoodHubApi(History.foodHubUrl(applicationContext), auth!!.merchantId, auth.authToken), CloverReceiptPrinter(applicationContext, account))
        val outcome = if (mode == "FAC") flow.printOriginal(order) else flow.printCopy(order, mode)
        return when (outcome) {
            is Outcome.Printed -> done(order, if (mode == "FAC") "printed ${outcome.noTrans ?: ""}".trim() else "printed $mode")
            Outcome.AlreadyPrinted -> done(order, "already_printed")
            Outcome.NotRegister -> done(order, "not_register")
            is Outcome.NeedsPerson -> done(order, "needs_person: ${outcome.reason ?: ""}".trim())
            is Outcome.NoInvoice -> done(order, outcome.status)
            // Not ready within 90 s (Food Hub or Takatak MEV unreachable): try again later, never print anything invented.
            Outcome.TimedOut -> done(order, "waiting", retry = runAttemptCount < 5)
        }
    }

    private fun done(order: String, outcome: String, retry: Boolean = false): Result {
        History.add(applicationContext, order, outcome)
        return if (retry) Result.retry() else Result.success()
    }

    companion object {
        const val KEY_ORDER = "order"
        const val KEY_MODE = "mode"

        fun enqueue(context: Context, order: String, mode: String = "FAC") {
            val req = OneTimeWorkRequestBuilder<ReceiptWorker>().setInputData(workDataOf(KEY_ORDER to order, KEY_MODE to mode)).build()
            // One job per document: the same payment broadcast twice never prints twice.
            WorkManager.getInstance(context).enqueueUniqueWork("mev-$order-$mode", if (mode == "FAC") ExistingWorkPolicy.KEEP else ExistingWorkPolicy.REPLACE, req)
        }
    }
}
