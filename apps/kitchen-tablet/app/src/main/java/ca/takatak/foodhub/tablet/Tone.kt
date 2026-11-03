package ca.takatak.foodhub.tablet

import kotlin.math.PI
import kotlin.math.min
import kotlin.math.sin

/**
 * The alarm sound, generated here (no audio file, nothing copyrighted): the same two-note pattern as the Food Hub
 * kitchen screen (lib/ui/sound.ts « order »: 988 Hz / 1319 Hz), played twice, as a bright near-square wave that cuts
 * through a hood fan. 16-bit mono PCM; looped by Alarm until someone taps the screen. Pure: tested on the JVM.
 */
object Tone {
    const val SAMPLE_RATE = 22_050

    /** [frequency Hz, start s, length s] */
    private val ORDER = listOf(
        Triple(988.0, 0.00, 0.20), Triple(1319.0, 0.22, 0.20), Triple(988.0, 0.50, 0.20), Triple(1319.0, 0.72, 0.30),
        Triple(988.0, 1.20, 0.20), Triple(1319.0, 1.42, 0.20), Triple(988.0, 1.70, 0.20), Triple(1319.0, 1.92, 0.30),
    )
    private val BEEP = listOf(Triple(1319.0, 0.0, 0.15))

    /** One loop of the alarm: 2.2 s of notes, then 0.6 s of silence. */
    fun alarm(sampleRate: Int = SAMPLE_RATE): ShortArray = render(ORDER, 2.8, sampleRate)

    /** A short single beep (JavaScript bridge beep()). */
    fun beep(sampleRate: Int = SAMPLE_RATE): ShortArray = render(BEEP, 0.2, sampleRate)

    fun render(notes: List<Triple<Double, Double, Double>>, totalSeconds: Double, sampleRate: Int, level: Double = 0.9): ShortArray {
        val out = ShortArray((totalSeconds * sampleRate).toInt())
        val ramp = (0.004 * sampleRate).toInt().coerceAtLeast(1) // 4 ms fade in/out: no click
        for ((freq, start, length) in notes) {
            val from = (start * sampleRate).toInt()
            val count = (length * sampleRate).toInt()
            for (i in 0 until count) {
                val idx = from + i
                if (idx >= out.size) break
                val phase = 2 * PI * freq * i / sampleRate
                // Fundamental + odd harmonics: square-like, loud, still pleasant.
                val wave = sin(phase) + sin(3 * phase) / 3 + sin(5 * phase) / 5
                val env = min(1.0, min(i.toDouble() / ramp, (count - i).toDouble() / ramp))
                val v = wave * level * env // peak of the three harmonics ≈ 0.92 → about 83 % of full scale
                out[idx] = (v.coerceIn(-1.0, 1.0) * Short.MAX_VALUE).toInt().toShort()
            }
        }
        return out
    }
}
