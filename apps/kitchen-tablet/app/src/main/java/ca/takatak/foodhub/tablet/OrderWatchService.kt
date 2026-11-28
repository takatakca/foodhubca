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
import android.os.SystemClock
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
 * A won claim is written to the waiting list (Prefs.pending, on disk) BEFORE it goes to the printer and leaves it
 * only once printed: a printer error or the app being killed never loses a ticket; it is retried for 2 hours.
 * A claim whose answer was lost is printed at the next poll (QueueLogic.plan, step RECOVER).
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
    private val draining = AtomicBoolean(false)
    private val printListenerEvidence = PrintListenerEvidence()
    private val printListenerWorker = Executors.newSingleThreadExecutor()
    private val reportingPrintListener = AtomicBoolean(false)
    @Volatile private var queueScope: QueueScope? = null
    private var startupScope: QueueScope? = null
    @Volatile private var queueLocation: String? = null
    private var continuation: String? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        createChannels()
        goForeground(getString(R.string.watch_starting))
        acquireLocks()
        // Reuse the checkpoint or unfinished window. The first successful response confirms its kitchen.
        queueScope = configuredQueueScope()
        startupScope = queueScope
        val savedProgress = prefs.queueDrain
        if (savedProgress == null || savedProgress.scope != queueScope) {
            prefs.resetQueueProgress(queueScope?.origin)
        }
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
        printListenerWorker.shutdownNow()
        poller?.shutdownNow()
        Alarm.stop(this)
        runCatching { wakeLock?.release() }
        runCatching { wifiLock?.release() }
        super.onDestroy()
    }

    // ------------------------------------------------------------------ polling

    private fun safePoll() {
        try { poll() } catch (e: Throwable) {
            continuation = null
            queueLocation = null
            setStatus(getString(R.string.status_offline, e.message ?: e.javaClass.simpleName))
        }
        // The printer thread checks the verified kitchen and current order before sending bytes.
        drainPending()
    }

    private fun configuredQueueScope(): QueueScope? = prefs.withSettings {
        prefs.origin()?.let { QueueScope(it, prefs.location, prefs.deviceId) }
    }

    private fun apiFor(scope: QueueScope) =
        FoodHubApi(scope.origin, { cookieFor(scope.origin) }, "FoodHubTablet/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE})")

    private fun resetQueueScope(scope: QueueScope?, location: String? = null) {
        queueScope = scope
        queueLocation = location
        continuation = null
        prefs.resetQueueProgress(scope?.origin)
    }

    private fun poll() {
        val scope = configuredQueueScope()
        if (queueScope != scope) resetQueueScope(scope)
        if (scope == null) return setStatus(getString(R.string.status_bad_url))
        val drain = QueueLogic.drainForScope(prefs.queueDrain, scope)
        val api = apiFor(scope)
        // Keep the cookie actually used for this successful read, before the WebView can change enrollment.
        val readCookies = cookieFor(scope.origin)
        val queue = try {
            api.queue(drain?.since ?: prefs.since, scope.location, scope.deviceId, prefs.paper, prefs.ticketLang, continuation, readCookies)
        } catch (e: FoodHubApi.ApiError) {
            continuation = null
            queueLocation = null
            return setStatus(when {
                e.status == 401 -> getString(R.string.status_signed_out)
                e.needLocation -> getString(R.string.status_need_location)
                e.status == 0 -> getString(R.string.status_offline, e.message ?: "")
                else -> "HTTP ${e.status} : ${e.message}"
            })
        }
        val currentScope = configuredQueueScope()
        if (currentScope != scope) return resetQueueScope(currentScope)
        val location = queue.location ?: throw FoodHubApi.ApiError(0, "Missing print queue location")
        val previousLocation = queueLocation ?: drain?.location
        if (previousLocation != null && location != previousLocation) return resetQueueScope(scope, location)
        if (continuation != null && (queue.continuation == continuation || queue.since != drain?.since)) {
            throw FoodHubApi.ApiError(0, "Invalid print queue continuation")
        }
        queueLocation = location
        val mayHaveMore = QueueLogic.queueMayHaveMore(queue.paged, queue.items.size, queue.continuation)
        val since = queue.since ?: throw FoodHubApi.ApiError(0, "Missing print queue window")
        val horizon = QueueLogic.parseInstant(queue.serverTime)
        val activeDrain = prefs.anchorQueueDrain(QueueDrain(scope, location, since), continuation, horizon)
            ?: throw FoodHubApi.ApiError(0, "Missing print queue checkpoint")
        if (horizon != null) reportPrintListener(scope, location, readCookies)
        val pendingIds = prefs.pending.filter(::pendingInCurrentScope).map { it.id }.toSet()
        val firstRun = prefs.firstRun
        val restored = if (horizon != null) prefs.recentQueueReceiptIds(scope, location) else emptySet()
        val seen = QueueLogic.seenDuringDrain(prefs.seen, activeDrain, restored)
        val plan = QueueLogic.plan(queue.items, seen, pendingIds, QueueLogic.shouldPrint(prefs.autoPrint, prefs.printerType), firstRun)
        // A cancelled order whose ticket still waits for the printer (no paper, printer off): never print it now.
        val dropped = QueueLogic.cancelledPending(queue.items, pendingIds)
        if (dropped.isNotEmpty()) prefs.updatePending { list -> list.filterNot { it.id in dropped && pendingInCurrentScope(it) } }
        val ring = mutableListOf<QueueItem>()
        var allHandled = true
        for ((item, step) in plan) {
            val configured = configuredQueueScope()
            if (configured != scope) return resetQueueScope(configured)
            when (step) {
                Step.SILENT -> prefs.markSeen(item, scope, location)
                Step.RING, Step.CANCEL_UNPRINTED -> { prefs.markSeen(item, scope, location); ring += item }
                Step.RECOVER -> { toPrinter(item, scope, location); ring += item }
                Step.CLAIM -> {
                    val claim = try {
                        api.claim(item, scope.deviceId, location) { configuredQueueScope() == scope }
                    } catch (e: FoodHubApi.ApiError) {
                        val afterFailure = configuredQueueScope()
                        if (afterFailure != scope) return resetQueueScope(afterFailure)
                        // 404 / 400: not for this tablet. Otherwise (no answer, 5xx): asked again next poll — and if the
                        // claim did go through, the queue then says printed and the ticket is printed (RECOVER).
                        if (e.status == 404 || e.status == 400) prefs.markSeen(item, scope, location) else allHandled = false
                        continue
                    }
                    val afterClaim = configuredQueueScope()
                    if (afterClaim != scope) {
                        // Preserve a confirmed claim for the original kitchen without sending it to a new printer.
                        if (claim.claimed) rememberPending(item, scope, location)
                        return resetQueueScope(afterClaim)
                    }
                    if (claim.claimed) { toPrinter(item, scope, location); ring += item } else prefs.markSeen(item, scope, location)
                }
            }
        }
        val afterPage = configuredQueueScope()
        if (afterPage != scope) return resetQueueScope(afterPage)
        continuation = queue.continuation.takeIf { allHandled }
        if (allHandled && !mayHaveMore) {
            prefs.finishQueueDrain(activeDrain, queue.serverTime)
        }
        if (ring.isNotEmpty()) announce(ring)
        setStatus(getString(R.string.status_ok, LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss")), queue.location ?: "?", ring.size))
    }

    private fun reportPrintListener(scope: QueueScope, location: String, readCookies: String?) {
        if (!reportingPrintListener.compareAndSet(false, true)) return
        val observation = printListenerEvidence.afterRead(scope, location, readCookies, SystemClock.elapsedRealtime())
        if (observation == null) {
            reportingPrintListener.set(false)
            return
        }
        runCatching {
            printListenerWorker.execute {
                try {
                    runCatching {
                        apiFor(scope).reportPrintListener(observation) {
                            !printListenerWorker.isShutdown && observation.matches(configuredQueueScope(), queueScope, queueLocation)
                        }
                    }
                } finally {
                    reportingPrintListener.set(false)
                }
            }
        }.onFailure { reportingPrintListener.set(false) }
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

    /**
     * A ticket this tablet claimed: written down (waiting list + seen, on disk) BEFORE it goes to the printer, so a
     * printer error or the app being killed in between never loses it, and it is never claimed or recovered twice.
     */
    private fun rememberPending(item: QueueItem, scope: QueueScope, location: String) {
        val ticket = PendingTicket(item.id, item.number, item.ticket, System.currentTimeMillis(), 0, scope, location)
        prefs.withSettings {
            prefs.updatePending { list -> if (list.any { it.sameTicket(ticket) }) list else list + ticket }
            prefs.markSeen(item, scope, location)
        }
    }

    private fun toPrinter(item: QueueItem, scope: QueueScope, location: String) {
        rememberPending(item, scope, location)
        drainPending()
    }

    private fun pendingInCurrentScope(ticket: PendingTicket): Boolean {
        val current = configuredQueueScope()
        val activeLocation = queueLocation.takeIf { queueScope == current }
        return QueueLogic.pendingMatches(ticket.scope, ticket.resolvedLocation, startupScope, current, activeLocation)
    }

    private fun stillPending(ticket: PendingTicket, scope: QueueScope, location: String): Boolean =
        queueScope == scope && queueLocation == location && pendingInCurrentScope(ticket) && prefs.pending.any(ticket::sameTicket)

    private fun cancelPendingOrder(ticket: PendingTicket, scope: QueueScope, location: String) {
        val cancel = QueueItem(
            ticket.id.removeSuffix(":order") + ":cancel",
            ticket.id.substringAfter(':').substringBeforeLast(':'), ticket.id.substringBefore(':'),
            "cancel", ticket.number, null, true, "",
        )
        val removed = prefs.withSettings {
            if (!stillPending(ticket, scope, location)) return@withSettings false
            prefs.markSeen(cancel, scope, location)
            prefs.updatePending { list -> list.filterNot { it.sameTicket(ticket) } }
            true
        }
        if (removed) announce(listOf(cancel))
    }

    /**
     * Prints waiting tickets on the printer thread. A failed printer stops the pass. An unverified order stays
     * pending for the next poll, while other eligible orders still get checked.
     */
    private fun drainPending() {
        val scope = configuredQueueScope() ?: return
        val location = queueLocation.takeIf { queueScope == scope } ?: return
        if (prefs.pending.none(::pendingInCurrentScope) || !draining.compareAndSet(false, true)) return
        EscPosPrinter.onPrinterThread(this) { app ->
            val attempted = mutableSetOf<Triple<String, QueueScope?, String?>>()
            try {
                while (queueScope == scope && queueLocation == location && configuredQueueScope() == scope) {
                    val p = prefs.pending.firstOrNull {
                        Triple(it.id, it.scope, it.resolvedLocation) !in attempted &&
                            QueueLogic.pendingMatches(it.scope, it.resolvedLocation, startupScope, scope, location)
                    } ?: break
                    attempted.add(Triple(p.id, p.scope, p.resolvedLocation))
                    if (System.currentTimeMillis() - p.since > PENDING_MAX_MS) {
                        prefs.updatePending { list -> list.filterNot { it.sameTicket(p) } }
                        notifyPrinter(getString(R.string.printer_gave_up, p.number))
                        continue
                    }
                    var status = FoodHubApi.PendingStatus.UNVERIFIED
                    var statusFailed = false
                    val out = EscPosPrinter.printNow(app, p.ticket, authorizeWrite = {
                        when {
                            p.id.endsWith(":cancel") -> true
                            p.id.endsWith(":order") -> {
                                status = try {
                                    apiFor(scope).pendingStatus(p.id, scope.deviceId, location) { stillPending(p, scope, location) }
                                } catch (e: FoodHubApi.ApiError) {
                                    statusFailed = true
                                    FoodHubApi.PendingStatus.UNVERIFIED
                                }
                                status == FoodHubApi.PendingStatus.CLEAR
                            }
                            else -> false
                        }
                    }) { stillPending(p, scope, location) }
                    if (status == FoodHubApi.PendingStatus.CANCELLED) cancelPendingOrder(p, scope, location)
                    if (out is EscPosPrinter.Outcome.Held) {
                        if (statusFailed) break
                        continue
                    }
                    if (out is EscPosPrinter.Outcome.Failed) {
                        prefs.updatePending { list -> list.map { if (it.sameTicket(p)) it.copy(attempts = it.attempts + 1) else it } }
                        printerProblem(out.message)
                        break
                    }
                    prefs.updatePending { list -> list.filterNot { it.sameTicket(p) } }
                }
                if (prefs.pending.isEmpty()) runCatching { NotificationManagerCompat.from(app).cancel(ID_PRINTER) }
            } finally {
                draining.set(false)
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
