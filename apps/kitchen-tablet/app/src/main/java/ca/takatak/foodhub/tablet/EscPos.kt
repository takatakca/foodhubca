package ca.takatak.foodhub.tablet

import java.io.ByteArrayOutputStream
import java.text.Normalizer

/** Character table the printer is told to use (ESC t n). */
enum class CodePage { CP858, CP1252, ASCII }

/**
 * Ticket text → ESC/POS bytes. Pure (no Android classes): tested on the JVM (EscPosTest).
 *
 * The text is the one Food Hub renders (lib/foodhub/kitchen/ticket-text.ts): one printed line per text line; a line
 * starting with "@@" + flags + one space is styled — B bold, C centred, H double width and height. French accents are
 * sent in CP858 (ESC t 19, the default) or CP1252 (ESC t 16); ASCII drops the accents for printers that print neither.
 */
object EscPos {
    private const val ESC: Byte = 0x1B
    private const val GS: Byte = 0x1D
    private const val LF: Byte = 0x0A

    val INIT = byteArrayOf(ESC, 0x40)

    fun selectCodePage(cp: CodePage): ByteArray = when (cp) {
        CodePage.CP858 -> byteArrayOf(ESC, 0x74, 19)
        CodePage.CP1252 -> byteArrayOf(ESC, 0x74, 16)
        CodePage.ASCII -> byteArrayOf(ESC, 0x74, 0)
    }

    /** Feed n lines, then a partial cut (printers without a cutter ignore it). */
    fun feedAndCut(lines: Int): ByteArray = byteArrayOf(ESC, 0x64, lines.coerceIn(0, 10).toByte(), GS, 0x56, 66, 0)

    data class Line(val text: String, val bold: Boolean = false, val center: Boolean = false, val big: Boolean = false)

    /** "@@HBC #12" → Line("#12", bold, center, big). Only "@@" at the very start of a line is markup. */
    fun parseLine(raw: String): Line {
        val m = Regex("^@@([A-Z]*) (.*)$").find(raw) ?: return Line(raw)
        val flags = m.groupValues[1]
        return Line(m.groupValues[2], bold = 'B' in flags, center = 'C' in flags, big = 'H' in flags)
    }

    fun render(ticket: String, cp: CodePage, feedLines: Int = 4, cut: Boolean = true): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(INIT)
        out.write(selectCodePage(cp))
        for (raw in ticket.replace("\r\n", "\n").split('\n')) {
            val line = parseLine(raw)
            if (line.center) out.write(byteArrayOf(ESC, 0x61, 1))
            if (line.bold) out.write(byteArrayOf(ESC, 0x45, 1))
            if (line.big) out.write(byteArrayOf(GS, 0x21, 0x11))
            out.write(encode(line.text, cp))
            out.write(LF.toInt())
            if (line.big) out.write(byteArrayOf(GS, 0x21, 0))
            if (line.bold) out.write(byteArrayOf(ESC, 0x45, 0))
            if (line.center) out.write(byteArrayOf(ESC, 0x61, 0))
        }
        if (cut) out.write(feedAndCut(feedLines)) else out.write(byteArrayOf(ESC, 0x64, feedLines.coerceIn(0, 10).toByte()))
        return out.toByteArray()
    }

    // CP850 with € at 0xD5 (= CP858), bytes 0x80..0xFF.
    private const val CP858_HIGH =
        "ÇüéâäàåçêëèïîìÄÅ" +
        "ÉæÆôöòûùÿÖÜø£Ø×ƒ" +
        "áíóúñÑªº¿®¬½¼¡«»" +
        "░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐" +
        "└┴┬├─┼ãÃ╚╔╩╦╠═╬¤" +
        "ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀" +
        "ÓßÔÒõÕµþÞÚÛÙýÝ¯´" +
        "­±‗¾¶§÷¸°¨·¹³²■ "

    private val CP858_MAP: Map<Char, Byte> = CP858_HIGH.mapIndexed { i, c -> c to (0x80 + i).toByte() }.toMap()

    // CP1252 differs from Latin-1 only in 0x80..0x9F.
    private val CP1252_EXTRA: Map<Char, Byte> = mapOf(
        '€' to 0x80, '‚' to 0x82, 'ƒ' to 0x83, '„' to 0x84, '…' to 0x85, '†' to 0x86, '‡' to 0x87,
        'ˆ' to 0x88, '‰' to 0x89, 'Š' to 0x8A, '‹' to 0x8B, 'Œ' to 0x8C, 'Ž' to 0x8E,
        '‘' to 0x91, '’' to 0x92, '“' to 0x93, '”' to 0x94, '•' to 0x95, '–' to 0x96, '—' to 0x97,
        '˜' to 0x98, '™' to 0x99, 'š' to 0x9A, '›' to 0x9B, 'œ' to 0x9C, 'ž' to 0x9E, 'Ÿ' to 0x9F,
    ).mapValues { it.value.toByte() }

    // Typography the code pages lack (text from the JavaScript bridge may carry it; Food Hub's tickets do not).
    private val FALLBACK: Map<Char, String> = mapOf(
        '‘' to "'", '’' to "'", '‚' to "'", '“' to "\"", '”' to "\"", '„' to "\"",
        '–' to "-", '—' to "-", '−' to "-", '…' to "...", '•' to "*", 'œ' to "oe", 'Œ' to "OE",
        'Ÿ' to "Y", ' ' to " ", ' ' to " ", '\t' to " ",
    )

    fun encode(text: String, cp: CodePage): ByteArray {
        val out = ByteArrayOutputStream(text.length + 8)
        for (ch in Normalizer.normalize(text, Normalizer.Form.NFC)) encodeChar(ch, cp, out)
        return out.toByteArray()
    }

    private fun encodeChar(ch: Char, cp: CodePage, out: ByteArrayOutputStream) {
        val code = ch.code
        if (code in 0x20..0x7E) { out.write(code); return }
        if (code < 0x20 || code == 0x7F) return
        if (Character.isSurrogate(ch)) return // emoji and other astral symbols: dropped
        when (cp) {
            CodePage.CP858 -> CP858_MAP[ch]?.let { out.write(it.toInt()); return }
            CodePage.CP1252 -> {
                CP1252_EXTRA[ch]?.let { out.write(it.toInt()); return }
                if (code in 0xA0..0xFF) { out.write(code); return }
            }
            CodePage.ASCII -> Unit
        }
        FALLBACK[ch]?.let { s -> s.forEach { encodeChar(it, cp, out) }; return }
        val base = Normalizer.normalize(ch.toString(), Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")
        if (base.isNotEmpty() && base.all { it.code in 0x20..0x7E }) base.forEach { out.write(it.code) } else out.write('?'.code)
    }
}
