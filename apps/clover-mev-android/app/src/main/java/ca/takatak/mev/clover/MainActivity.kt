package ca.takatak.mev.clover

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ListView
import java.text.DateFormat
import java.util.Date

/**
 * The app's screen on the Clover device: the last register sales and what happened to their invoice, a reprint
 * (RPR) or merchant copy (DUP) per sale, printing an order's invoice by its Clover id, and Food Hub's address.
 */
class MainActivity : Activity() {
    private lateinit var list: ListView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        list = findViewById(R.id.history)
        findViewById<Button>(R.id.print_order).setOnClickListener {
            val order = findViewById<EditText>(R.id.order_id).text.toString().trim().uppercase()
            if (order.isNotEmpty()) ReceiptWorker.enqueue(this, order)
        }
        findViewById<Button>(R.id.settings).setOnClickListener { editUrl() }
        list.setOnItemClickListener { _, _, pos, _ -> copyDialog(History.list(this)[pos].order) }
    }

    override fun onResume() {
        super.onResume()
        val fmt = DateFormat.getTimeInstance(DateFormat.SHORT)
        list.adapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, History.list(this).map { "${fmt.format(Date(it.at))} · ${it.order} · ${it.outcome}" })
    }

    private fun copyDialog(order: String) {
        AlertDialog.Builder(this)
            .setTitle(order)
            .setItems(arrayOf(getString(R.string.reprint), getString(R.string.merchant_copy))) { _, which -> ReceiptWorker.enqueue(this, order, if (which == 0) "RPR" else "DUP") }
            .show()
    }

    private fun editUrl() {
        val input = EditText(this).apply { setText(History.foodHubUrl(this@MainActivity)) }
        AlertDialog.Builder(this).setTitle(R.string.foodhub_url).setView(input)
            .setPositiveButton(android.R.string.ok) { _, _ -> History.setFoodHubUrl(this, input.text.toString()) }
            .setNegativeButton(android.R.string.cancel, null).show()
    }
}
