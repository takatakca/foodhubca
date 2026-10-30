package ca.takatak.foodhub.tablet

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.webkit.CookieManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Foreground service that listens for orders even with the screen off: every 15 s it reads Food Hub's print queue
 * with the WebView's cookies, claims each new ticket (POST …/printed: written and read back on the server, so never
 * twice), prints it on the tablet's printer, and rings the loud alarm until someone taps the screen.
 * A ticket claimed but not printed (printer off, no paper) is kept and retried at every poll for 2 hours.
 */
class OrderWatchService : Service() {

    companion object {
        const val ACTION_START = "ca.takatak.foodhub.tablet.START"
        const val ACTION_STOP_ALARM = "ca.takatak.foodhub.tablet.STOP_ALARM"
        const val ACTION_POLL_NOW = "ca.takatak.foodhub.tablet.POLL_NOW"
        private const val CH_WATCH = "watch"
        private const val CH_ORDERS = "orders_alarm"
        private const val CH_PRINTER = "printer"
        private const val ID_WATCH = 1
        private const val ID_ORDER = 2
        private const val ID_PRINTER = 3
        private const val POLL_SECONDS = 15L
        private const val PENDING_MAX_MS = 2 * 3600_000L

        /** Last poll result, shown in Settings. */
        @Volatile var status: String = ""

        fun start(context: Context) {
            runCatching { ContextCompat.startForegroundService(context, Intent(context, OrderWatchService::class.java).setAction(ACTION_START)) }
        }

        fun send(context: Context, action: String) {
            runCatching { context.startService(Intent(context, OrderWatchService::class.java).setAction(action)) }
        }

        fun stopAlarm(context: Context) {
            Alarm.stop(context)
            runCatching { NotificationManagerCompat.from(context).cancel(ID_ORDER) }
        }
    }

    private lateinit var prefs: Prefs
    private var poller: ScheduledExecutorService? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private val main = Handler(Looper.getMainLooper())
    private val retrying = AtomicBoolean(false)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        createChannels()
        goForeground(getString(R.string.watch_starting))
        acquireLocks()
        // After a (re)start the first poll uses the server's default window (15 minutes): no pile of old tickets in the
        // morning, and the claims already made stop any reprint.
        prefs.since = null
        poller = Executors.newSingleThreadScheduledExecutor().also { it.scheduleWithFixedDelay({ safePoll() }, 1, POLL_SECONDS, TimeUnit.SECONDS) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Every startForegroundService() call is answered with startForeground(), even when already running.
        goForeground(status.ifBlank { getString(R.string.watch_starting) })
        when (intent?.action) {
            ACTION_STOP_ALARM -> stopAlarm(this)
            ACTION_POLL_NOW -> poller?.execute { safePoll() }
        }
        return START_STICKY
    }

    private fun goForeground(text: String) {
        ServiceCompat.startForeground(
            this, ID_WATCH, watchNotification(text),
            if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0,
        )
    }

    override fun onDestroy() {
        poller?.shutdownNow()
        Alarm.stop(this)
        runCatching { wakeLock?.release() }
        runCatching { wifiLock?.release() }
        super.onDestroy()
    }

    // ------------------------------------------------------------------ polling

    private fun safePoll() {
        try { poll() } catch (e: Throwable) { setStatus(getString(R.string.status_offline, e.message ?: e.javaClass.simpleName)) }
    }

    private fun poll() {
        val origin = prefs.origin() ?: return setStatus(getString(R.string.status_bad_url))
        val api = FoodHubApi(origin, { cookieFor(origin) }, "FoodHubTablet/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE})")
        retryPending()
        val queue = try {
            api.queue(prefs.since, prefs.location, prefs.deviceId, prefs.paper, prefs.ticketLang)
        } catch (e: FoodHubApi.ApiError) {
            return setStatus(when {
                e.status == 401 -> getString(R.string.status_signed_out)
                e.needLocation -> getString(R.string.status_need_location)
                e.status == 0 -> getString(R.string.status_offline, e.message ?: "")
                else -> "HTTP ${e.status} : ${e.message}"
            })
        }
        val seen = prefs.seen
        val fresh = QueueLogic.fresh(queue.items, seen.toSet())
        val print = QueueLogic.shouldPrint(prefs.autoPrint, prefs.printerType)
        val handled = mutableListOf<String>()
        val ring = mutableListOf<QueueItem>()
        var allHandled = true
        for (item in fresh) {
            if (!print) { handled += item.id; ring += item; continue }
            val claim = try {
                api.claim(item, prefs.deviceId, prefs.location)
            } catch (e: FoodHubApi.ApiError) {
                if (e.status == 404 || e.status == 400) { handled += item.id } else { allHandled = false } // network: retried next poll
                continue
            }
            handled += item.id
            if (claim.claimed) {
                ring += item
                printClaimed(item)
            }
        }
        if (handled.isNotEmpty()) prefs.seen = QueueLogic.remember(seen, handled)
        prefs.since = QueueLogic.nextSince(prefs.since, queue.serverTime, allHandled)
        if (ring.isNotEmpty()) announce(ring)
        setStatus(getString(R.string.status_ok, LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss")), queue.location ?: "?", ring.size))
    }

    /** The WebView's cookies for Food Hub (read on the main thread, where CookieManager lives). */
    private fun cookieFor(origin: String): String? {
        var value: String? = null
        val latch = CountDownLatch(1)
        main.post {
            value = try { CookieManager.getInstance().getCookie(origin) } catch (e: Throwable) { null }
            latch.countDown()
        }
        latch.await(3, TimeUnit.SECONDS)
        return value
    }

    // ------------------------------------------------------------------ printing

    private fun printClaimed(item: QueueItem) {
        EscPosPrinter.submit(this, item.ticket) { out ->
            if (out is EscPosPrinter.Outcome.Failed) {
                // Claimed on the server, so never fetched again: keep it here and retry it.
                prefs.pending = prefs.pending + PendingTicket(item.id, item.number, item.ticket, System.currentTimeMillis(), 1)
                printerProblem(out.message)
            }
        }
    }

    /** Retries the tickets that did not print, oldest first, on the printer thread (one batch at a time). */
    private fun retryPending() {
        if (prefs.pending.isEmpty() || !retrying.compareAndSet(false, true)) return
        EscPosPrinter.onPrinterThread(this) { app ->
            try {
                for (p in prefs.pending) {
                    if (System.currentTimeMillis() - p.since > PENDING_MAX_MS) {
                        prefs.pending = prefs.pending.filter { it.id != p.id }
                        notifyPrinter(getString(R.string.printer_gave_up, p.number))
                        continue
                    }
                    val out = EscPosPrinter.printNow(app, p.ticket)
                    if (out is EscPosPrinter.Outcome.Failed) {
                        prefs.pending = prefs.pending.map { if (it.id == p.id) it.copy(attempts = it.attempts + 1) else it }
                        printerProblem(out.message)
                        break // still down: try again at the next poll
                    }
                    prefs.pending = prefs.pending.filter { it.id != p.id }
                }
                if (prefs.pending.isEmpty()) runCatching { NotificationManagerCompat.from(app).cancel(ID_PRINTER) }
            } finally {
                retrying.set(false)
            }
        }
    }

    private fun printerProblem(message: String) {
        notifyPrinter(getString(R.string.printer_failed_text, prefs.pending.size, message))
    }

    // ------------------------------------------------------------------ alarm and notifications

    private fun announce(items: List<QueueItem>) {
        if (prefs.sound) Alarm.start(this, prefs.maxVolume)
        val cancel = items.firstOrNull { it.kind == "cancel" }
        val text = when {
            cancel != null -> getString(R.string.cancelled_order, cancel.number)
            items.size == 1 -> getString(R.string.new_order_one, listOfNotNull(items[0].number, items[0].brandName).joinToString(" · "))
            else -> getString(R.string.new_orders_many, items.size)
        }
        val open = PendingIntent.getActivity(this, 1, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 2, Intent(this, OrderWatchService::class.java).setAction(ACTION_STOP_ALARM), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(this, CH_ORDERS)
            .setSmallIcon(R.drawable.ic_stat_bell)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setContentIntent(open)
            // Screen off or locked: Android opens the kitchen screen (MainActivity shows over the lock screen).
            .setFullScreenIntent(open, true)
            .addAction(0, getString(R.string.stop_alarm), stop)
            .setDeleteIntent(stop)
            .setAutoCancel(true)
            .build()
        notify(ID_ORDER, n)
    }

    private fun notifyPrinter(text: String) {
        val open = PendingIntent.getActivity(this, 3, Intent(this, SettingsActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        notify(ID_PRINTER, NotificationCompat.Builder(this, CH_PRINTER)
            .setSmallIcon(R.drawable.ic_stat_bell)
            .setContentTitle(getString(R.string.printer_failed_title))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setOnlyAlertOnce(true)
            .build())
    }

    private fun setStatus(text: String) {
        status = text
        notify(ID_WATCH, watchNotification(text))
    }

    private fun watchNotification(text: String): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CH_WATCH)
            .setSmallIcon(R.drawable.ic_stat_bell)
            .setContentTitle(getString(R.string.watch_title))
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(open)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    @SuppressLint("MissingPermission")
    private fun notify(id: Int, n: Notification) {
        // Without the notification permission (Android 13+) the alarm still rings; only the notification is hidden.
        try { NotificationManagerCompat.from(this).notify(id, n) } catch (e: SecurityException) { /* permission refused */ }
    }

    private fun createChannels() {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(NotificationChannel(CH_WATCH, getString(R.string.channel_watch), NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(NotificationChannel(CH_ORDERS, getString(R.string.channel_orders), NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(null, null) // the app plays its own alarm (Alarm), louder and looping
            enableVibration(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        })
        nm.createNotificationChannel(NotificationChannel(CH_PRINTER, getString(R.string.channel_printer), NotificationManager.IMPORTANCE_DEFAULT))
    }

    @Suppress("DEPRECATION")
    private fun acquireLocks() {
        // The tablet stays plugged in: keep the CPU and Wi-Fi awake so orders arrive with the screen off.
        runCatching {
            wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "foodhub:watch").apply { setReferenceCounted(false); acquire() }
        }
        runCatching {
            wifiLock = (applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager).createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "foodhub:watch").apply { setReferenceCounted(false); acquire() }
        }
    }
}
