package ca.takatak.foodhub.tablet

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.TextView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * The Food Hub kitchen screen, full screen and always on: a WebView of the kitchen page (default
 * https://foodhub.on2go.ca/kitchen), its cookies kept, plus the JavaScript bridge window.FoodHubTablet
 * (print(text), beep(), version()). Starts the order-listening service; a tap anywhere stops the alarm.
 */
class MainActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var web: WebView
    private lateinit var alarmBanner: TextView
    private lateinit var offline: TextView
    private val ui = Handler(Looper.getMainLooper())
    private var loadedUrl: String? = null

    /** Origin of the page shown now when it is Food Hub's (the bridge only answers Food Hub's own pages). */
    @Volatile var trustedOrigin: String? = null
        private set

    private val bannerTick = object : Runnable {
        override fun run() {
            alarmBanner.visibility = if (Alarm.ringing) View.VISIBLE else View.GONE
            ui.postDelayed(this, 500)
        }
    }
    private val retryLoad = Runnable { if (web.url.isNullOrBlank()) web.loadUrl(prefs.kitchenUrl) else web.reload() }
    private var mainFrameFailed = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        offline = TextView(this).apply {
            setBackgroundColor(Color.parseColor("#E6151514"))
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(24), dp(24), dp(24))
            visibility = View.GONE
            setOnClickListener { ui.removeCallbacks(retryLoad); retryLoad.run() }
        }
        root.addView(offline, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        alarmBanner = TextView(this).apply {
            text = getString(R.string.alarm_banner)
            setBackgroundColor(Color.parseColor("#D32F2F"))
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
            gravity = Gravity.CENTER
            setPadding(dp(16), dp(28), dp(16), dp(28))
            visibility = View.GONE
            setOnClickListener { OrderWatchService.stopAlarm(this@MainActivity) }
        }
        root.addView(alarmBanner, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))

        val gear = ImageButton(this).apply {
            setImageResource(R.drawable.ic_settings)
            setBackgroundColor(Color.TRANSPARENT)
            alpha = 0.55f
            contentDescription = getString(R.string.settings_title)
            setOnClickListener { startActivity(Intent(this@MainActivity, SettingsActivity::class.java)) }
        }
        root.addView(gear, FrameLayout.LayoutParams(dp(52), dp(52), Gravity.BOTTOM or Gravity.END))

        setContentView(root)
        hideSystemBars()
        setUpWebView()
        askPermissions()
        loadKitchen()
        OrderWatchService.start(this)
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
        if (prefs.kitchenUrl != loadedUrl) loadKitchen() // changed in Settings
        OrderWatchService.start(this)
        ui.post(bannerTick)
    }

    override fun onPause() {
        ui.removeCallbacks(bannerTick)
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        ui.removeCallbacksAndMessages(null)
        web.destroy()
        super.onDestroy()
    }

    /** Any tap stops the alarm (the tap still reaches the page). */
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_DOWN && Alarm.ringing) OrderWatchService.stopAlarm(this)
        return super.dispatchTouchEvent(ev)
    }

    @Deprecated("Back goes back in the kitchen pages; it never closes the kitchen screen.")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun loadKitchen() {
        loadedUrl = prefs.kitchenUrl
        if (prefs.origin() == null) {
            showOffline(getString(R.string.status_bad_url))
            return
        }
        web.loadUrl(prefs.kitchenUrl)
    }

    private fun hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun setUpWebView() {
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, false)
        }
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // The kitchen page's own chimes (Web Audio) may play without a first tap.
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            allowFileAccess = false
            allowContentAccess = false
            userAgentString = "$userAgentString FoodHubTablet/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(TabletBridge(this), "FoodHubTablet")
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val origin = QueueLogic.originOf(request.url.toString())
                if (origin != null && origin == prefs.origin()) return false
                // Other sites open in the browser, never inside the kitchen app (the print bridge stays Food Hub's).
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                mainFrameFailed = false
                trustedOrigin = trusted(url)
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                trustedOrigin = trusted(url)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                CookieManager.getInstance().flush()
                if (!mainFrameFailed) offline.visibility = View.GONE
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    mainFrameFailed = true
                    showOffline(error.description?.toString() ?: "")
                }
            }
        }
    }

    private fun showOffline(detail: String) {
        offline.text = getString(R.string.offline, detail)
        offline.visibility = View.VISIBLE
        ui.removeCallbacks(retryLoad)
        ui.postDelayed(retryLoad, 10_000)
    }

    private fun trusted(url: String?): String? {
        val origin = url?.let { QueueLogic.originOf(it) } ?: return null
        return if (origin == prefs.origin()) origin else null
    }

    private fun askPermissions() {
        val wanted = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            wanted += Manifest.permission.POST_NOTIFICATIONS
        }
        if (prefs.printerType == PrinterType.BLUETOOTH && !EscPosPrinter.hasBluetoothPermission(this) && Build.VERSION.SDK_INT >= 31) {
            wanted += Manifest.permission.BLUETOOTH_CONNECT
        }
        if (wanted.isNotEmpty()) requestPermissions(wanted.toTypedArray(), 1)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
