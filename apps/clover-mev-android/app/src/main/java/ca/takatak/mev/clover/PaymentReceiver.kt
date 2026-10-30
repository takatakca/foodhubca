package ca.takatak.mev.clover

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.clover.sdk.v1.Intents

/** Clover says a payment went through on this device: print that order's Revenu Québec invoice. */
class PaymentReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intents.ACTION_PAYMENT_PROCESSED) return
        val order = intent.getStringExtra(Intents.EXTRA_ORDER_ID) ?: intent.getStringExtra(Intents.EXTRA_CLOVER_ORDER_ID) ?: return
        ReceiptWorker.enqueue(context, order)
    }
}
