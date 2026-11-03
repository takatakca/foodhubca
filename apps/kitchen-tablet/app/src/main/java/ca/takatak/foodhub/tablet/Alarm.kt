package ca.takatak.foodhub.tablet

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * The loud new-order alarm: the generated Tone, looped on the ALARM stream (it plays with the screen off and in most
 * Do Not Disturb modes), plus vibration, until stop() — a tap on the screen, the notification's « Arrêter » button, or
 * the Settings screen. One alarm for the whole app.
 */
object Alarm {
    private var track: AudioTrack? = null
    private var savedVolume = -1
    @Volatile var ringing = false
        private set

    @Synchronized
    fun start(context: Context, maxVolume: Boolean) {
        if (ringing) return
        ringing = true
        val app = context.applicationContext
        val audio = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (maxVolume) {
            try {
                savedVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM)
                audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
            } catch (e: Exception) { savedVolume = -1 } // some Do Not Disturb modes refuse: keep the current volume
        }
        try {
            val pcm = Tone.alarm()
            track = staticTrack(pcm).also {
                it.setLoopPoints(0, pcm.size, -1)
                it.play()
            }
        } catch (e: Exception) { track = null }
        vibrate(app, true)
    }

    @Synchronized
    fun stop(context: Context) {
        if (!ringing) return
        ringing = false
        track?.let { runCatching { it.stop() }; runCatching { it.release() } }
        track = null
        val app = context.applicationContext
        if (savedVolume >= 0) {
            runCatching { (app.getSystemService(Context.AUDIO_SERVICE) as AudioManager).setStreamVolume(AudioManager.STREAM_ALARM, savedVolume, 0) }
            savedVolume = -1
        }
        vibrate(app, false)
    }

    /** One short beep (JavaScript bridge beep(), Settings « test »). */
    fun beep() {
        try {
            val pcm = Tone.beep()
            val t = staticTrack(pcm)
            t.play()
            Thread {
                Thread.sleep(600)
                runCatching { t.stop() }; runCatching { t.release() }
            }.start()
        } catch (e: Exception) { /* no audio output */ }
    }

    private fun staticTrack(pcm: ShortArray): AudioTrack {
        val t = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(Tone.SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(pcm.size * 2)
            .build()
        t.write(pcm, 0, pcm.size)
        return t
    }

    @Suppress("DEPRECATION")
    private fun legacyVibrator(context: Context): Vibrator? = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator

    private fun vibrate(context: Context, on: Boolean) {
        val vibrator: Vibrator? = try {
            if (Build.VERSION.SDK_INT >= 31) (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            else legacyVibrator(context)
        } catch (e: Exception) { null }
        if (vibrator == null || !vibrator.hasVibrator()) return
        runCatching {
            if (on) vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 700, 500), 0)) else vibrator.cancel()
        }
    }
}
