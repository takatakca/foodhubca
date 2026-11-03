package ca.takatak.foodhub.tablet

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.RadioGroup
import android.widget.Spinner
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast

/** Settings: Food Hub address, kitchen code, printer (paired Bluetooth or IP), paper, accents, auto-print, sound. */
class SettingsActivity : Activity() {
    private lateinit var prefs: Prefs
    private var devices: List<Pair<String, String>> = emptyList() // name, address
    private val ui = Handler(Looper.getMainLooper())

    private val url by lazy { findViewById<EditText>(R.id.url) }
    private val location by lazy { findViewById<EditText>(R.id.location) }
    private val printer by lazy { findViewById<RadioGroup>(R.id.printer_type) }
    private val btSpinner by lazy { findViewById<Spinner>(R.id.bt_device) }
    private val host by lazy { findViewById<EditText>(R.id.host) }
    private val port by lazy { findViewById<EditText>(R.id.port) }
    private val paper by lazy { findViewById<RadioGroup>(R.id.paper) }
    private val codePage by lazy { findViewById<Spinner>(R.id.code_page) }
    private val lang by lazy { findViewById<RadioGroup>(R.id.ticket_lang) }
    private val autoPrint by lazy { findViewById<Switch>(R.id.auto_print) }
    private val sound by lazy { findViewById<Switch>(R.id.sound) }
    private val maxVolume by lazy { findViewById<Switch>(R.id.max_volume) }
    private val boot by lazy { findViewById<Switch>(R.id.boot) }
    private val statusView by lazy { findViewById<TextView>(R.id.status) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        title = getString(R.string.settings_title)
        prefs = Prefs(this)

        url.setText(prefs.kitchenUrl)
        location.setText(prefs.location)
        printer.check(when (prefs.printerType) { PrinterType.BLUETOOTH -> R.id.printer_bt; PrinterType.NETWORK -> R.id.printer_net; PrinterType.NONE -> R.id.printer_none })
        host.setText(prefs.printerHost)
        port.setText(prefs.printerPort.toString())
        paper.check(if (prefs.paper == 58) R.id.paper_58 else R.id.paper_80)
        codePage.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, resources.getStringArray(R.array.code_pages))
        codePage.setSelection(prefs.codePage.ordinal)
        lang.check(if (prefs.ticketLang == "en") R.id.lang_en else R.id.lang_fr)
        autoPrint.isChecked = prefs.autoPrint
        sound.isChecked = prefs.sound
        maxVolume.isChecked = prefs.maxVolume
        boot.isChecked = prefs.startOnBoot
        findViewById<TextView>(R.id.version).text = getString(R.string.version_line, BuildConfig.VERSION_NAME, prefs.deviceId)

        printer.setOnCheckedChangeListener { _, id -> showPrinterFields(id); if (id == R.id.printer_bt) refreshDevices(ask = true) }
        showPrinterFields(printer.checkedRadioButtonId)
        refreshDevices(ask = prefs.printerType == PrinterType.BLUETOOTH)

        findViewById<Button>(R.id.bt_refresh).setOnClickListener { refreshDevices(ask = true) }
        findViewById<Button>(R.id.bt_settings).setOnClickListener { open(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) }
        findViewById<Button>(R.id.save).setOnClickListener { if (save()) toast(getString(R.string.saved)) }
        findViewById<Button>(R.id.test_print).setOnClickListener { testPrint() }
        findViewById<Button>(R.id.test_alarm).setOnClickListener { testAlarm() }
        findViewById<Button>(R.id.battery).setOnClickListener { batterySettings() }
        findViewById<Button>(R.id.back).setOnClickListener { if (save()) finish() }
    }

    override fun onResume() {
        super.onResume()
        showStatus()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_BT) refreshDevices(ask = false) // never ask twice in a row
    }

    private fun showPrinterFields(checkedId: Int) {
        findViewById<View>(R.id.bt_group).visibility = if (checkedId == R.id.printer_bt) View.VISIBLE else View.GONE
        findViewById<View>(R.id.net_group).visibility = if (checkedId == R.id.printer_net) View.VISIBLE else View.GONE
    }

    @SuppressLint("MissingPermission")
    private fun refreshDevices(ask: Boolean) {
        if (!EscPosPrinter.hasBluetoothPermission(this)) {
            if (ask && Build.VERSION.SDK_INT >= 31) requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT), REQ_BT)
            devices = emptyList()
        } else {
            devices = try {
                getSystemService(BluetoothManager::class.java)?.adapter?.bondedDevices
                    ?.map { (it.name ?: it.address) to it.address }
                    ?.sortedBy { it.first.lowercase() } ?: emptyList()
            } catch (e: SecurityException) { emptyList() }
        }
        val labels = if (devices.isEmpty()) listOf(getString(R.string.bt_none_paired)) else devices.map { "${it.first}  (${it.second})" }
        btSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
        val idx = devices.indexOfFirst { it.second == prefs.bluetoothAddress }
        if (idx >= 0) btSpinner.setSelection(idx)
    }

    private fun save(): Boolean {
        val u = url.text.toString().trim()
        if (QueueLogic.originOf(u) == null) {
            url.error = getString(R.string.bad_url)
            return false
        }
        prefs.kitchenUrl = u
        prefs.location = location.text.toString()
        prefs.printerType = when (printer.checkedRadioButtonId) { R.id.printer_bt -> PrinterType.BLUETOOTH; R.id.printer_net -> PrinterType.NETWORK; else -> PrinterType.NONE }
        devices.getOrNull(btSpinner.selectedItemPosition)?.let { (name, address) -> prefs.bluetoothName = name; prefs.bluetoothAddress = address }
        prefs.printerHost = host.text.toString()
        prefs.printerPort = port.text.toString().toIntOrNull()?.takeIf { it in 1..65535 } ?: 9100
        prefs.paper = if (paper.checkedRadioButtonId == R.id.paper_58) 58 else 80
        prefs.codePage = CodePage.values().getOrElse(codePage.selectedItemPosition) { CodePage.CP858 }
        prefs.ticketLang = if (lang.checkedRadioButtonId == R.id.lang_en) "en" else "fr"
        prefs.autoPrint = autoPrint.isChecked
        prefs.sound = sound.isChecked
        prefs.maxVolume = maxVolume.isChecked
        prefs.startOnBoot = boot.isChecked
        OrderWatchService.send(this, OrderWatchService.ACTION_POLL_NOW)
        return true
    }

    private fun testPrint() {
        if (!save()) return
        if (prefs.printerType == PrinterType.NONE) { toast(getString(R.string.test_print_failed, getString(R.string.printer_none))); return }
        EscPosPrinter.submit(this, EscPosPrinter.testTicket(this, prefs.width())) { out ->
            runOnUiThread {
                toast(if (out is EscPosPrinter.Outcome.Failed) getString(R.string.test_print_failed, out.message) else getString(R.string.test_print_ok))
                showStatus()
            }
        }
    }

    private fun testAlarm() {
        if (Alarm.ringing) { OrderWatchService.stopAlarm(this); return }
        Alarm.start(this, maxVolume.isChecked)
        ui.postDelayed({ OrderWatchService.stopAlarm(this) }, 5_000)
    }

    private fun batterySettings() {
        val pm = getSystemService(PowerManager::class.java)
        val ignoring = pm?.isIgnoringBatteryOptimizations(packageName) == true
        @SuppressLint("BatteryLife")
        val ask = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
        if (ignoring || !open(ask)) open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }

    private fun showStatus() {
        val pending = prefs.pending.size
        statusView.text = listOfNotNull(
            OrderWatchService.status.ifBlank { null },
            if (pending > 0) getString(R.string.pending_count, pending) else null,
        ).joinToString("\n")
    }

    private fun open(intent: Intent): Boolean = try { startActivity(intent); true } catch (e: Exception) { false }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_LONG).show()

    companion object {
        private const val REQ_BT = 2
    }
}
