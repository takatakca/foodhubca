package ca.takatak.foodhub.tablet

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Sends ESC/POS bytes to the tablet's thermal printer:
 *  - Bluetooth Classic, Serial Port Profile (UUID 00001101-…), paired first in Android's Bluetooth settings;
 *  - network printer, raw TCP on port 9100.
 * Bluetooth LE-only printers do not work (no SPP); neither does USB. Not tested on a real printer yet (see
 * docs/KITCHEN_TABLET_APP.md): the byte stream follows the ESC/POS command set most 58/80 mm printers accept.
 */
object EscPosPrinter {
    val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    /** One printer job at a time for the whole app (service, Settings test, JavaScript bridge). */
    private val queue = Executors.newSingleThreadExecutor()

    sealed class Outcome {
        object Ok : Outcome()
        data class Failed(val message: String) : Outcome()
    }

    /** Prints in the background; [done] runs on the printer thread. */
    fun submit(context: Context, ticket: String, done: (Outcome) -> Unit = {}) {
        val app = context.applicationContext
        queue.execute { done(printNow(app, ticket)) }
    }

    /** Runs [task] on the printer thread, after the jobs already queued. */
    fun onPrinterThread(context: Context, task: (Context) -> Unit) {
        val app = context.applicationContext
        queue.execute { task(app) }
    }

    /** Blocking print (call it from a background thread only). */
    fun printNow(context: Context, ticket: String): Outcome {
        val prefs = Prefs(context)
        val bytes = EscPos.render(ticket, prefs.codePage)
        return try {
            when (prefs.printerType) {
                PrinterType.NONE -> Outcome.Failed("no printer chosen")
                PrinterType.NETWORK -> sendTcp(prefs.printerHost, prefs.printerPort, bytes)
                PrinterType.BLUETOOTH -> sendBluetooth(context, prefs.bluetoothAddress, bytes)
            }
        } catch (e: Exception) {
            Outcome.Failed(e.message ?: e.javaClass.simpleName)
        }
    }

    private fun sendTcp(host: String, port: Int, bytes: ByteArray): Outcome {
        if (host.isBlank()) return Outcome.Failed("printer IP address missing")
        Socket().use { s ->
            s.connect(InetSocketAddress(host, if (port in 1..65535) port else 9100), 5_000)
            s.soTimeout = 10_000
            writeChunks(s.getOutputStream(), bytes)
            Thread.sleep(300) // let the printer take the last bytes before the socket closes
        }
        return Outcome.Ok
    }

    fun hasBluetoothPermission(context: Context): Boolean =
        Build.VERSION.SDK_INT < 31 || context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    private fun sendBluetooth(context: Context, address: String, bytes: ByteArray): Outcome {
        if (address.isBlank()) return Outcome.Failed("no Bluetooth printer chosen")
        if (!hasBluetoothPermission(context)) return Outcome.Failed("Bluetooth permission (Nearby devices) not granted")
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return Outcome.Failed("this tablet has no Bluetooth")
        if (!adapter.isEnabled) return Outcome.Failed("Bluetooth is off")
        val device = adapter.getRemoteDevice(address)
        // Cheap printers differ: the secure socket first, then the insecure one, then channel 1 directly.
        val makers: List<(BluetoothDevice) -> BluetoothSocket> = listOf(
            { d -> d.createRfcommSocketToServiceRecord(SPP_UUID) },
            { d -> d.createInsecureRfcommSocketToServiceRecord(SPP_UUID) },
            { d -> d.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType!!).invoke(d, 1) as BluetoothSocket },
        )
        var last: Exception? = null
        for (make in makers) {
            val socket: BluetoothSocket = try {
                make(device).also { s ->
                    try { s.connect() } catch (e: Exception) { runCatching { s.close() }; throw e }
                }
            } catch (e: Exception) {
                // Only a failed connection moves on to the next socket type: nothing was sent yet.
                last = e
                continue
            }
            // Connected: from here a failure ends the job (the ticket stays waiting and is retried whole later). Sending
            // it again on another socket type now would print a cut slip plus a full one.
            return try {
                writeChunks(socket.outputStream, bytes)
                // RFCOMM buffers: closing at once can cut the end of the ticket on some printers.
                Thread.sleep(500L + bytes.size / 8)
                Outcome.Ok
            } catch (e: Exception) {
                Outcome.Failed("Bluetooth: ${e.message ?: "sending failed"}")
            } finally {
                runCatching { socket.close() }
            }
        }
        return Outcome.Failed("Bluetooth: ${last?.message ?: "connection failed"}")
    }

    /** Small chunks with a pause: printers with a small buffer otherwise drop bytes. */
    private fun writeChunks(out: OutputStream, bytes: ByteArray) {
        var i = 0
        while (i < bytes.size) {
            val n = minOf(512, bytes.size - i)
            out.write(bytes, i, n)
            out.flush()
            i += n
            if (i < bytes.size) Thread.sleep(25)
        }
    }

    /** Test ticket of the Settings screen (accents, both sizes, the paper's width). */
    fun testTicket(context: Context, width: Int): String {
        val w = if (width == 32) 32 else 42
        val ruler = (1..w).joinToString("") { (it % 10).toString() }
        return listOf(
            "@@BC Food Hub - ${context.getString(R.string.test_ticket_title)}",
            "@@HBC #1234",
            "@@C ${context.getString(R.string.app_name)} ${BuildConfig.VERSION_NAME}",
            "=".repeat(w),
            "Crème brûlée, café, à emporter",
            "É È Ê À Ç Ô Û Î Ï Ë « » €",
            "@@B ${context.getString(R.string.test_ticket_bold)}",
            ruler,
            "=".repeat(w),
        ).joinToString("\n")
    }
}
