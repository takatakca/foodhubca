package ca.takatak.foodhub.tablet

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EscPosTest {
    private fun bytes(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }

    private fun ByteArray.indexOf(sub: ByteArray, from: Int = 0): Int {
        outer@ for (i in from..size - sub.size) {
            for (j in sub.indices) if (this[i + j] != sub[j]) continue@outer
            return i
        }
        return -1
    }

    @Test
    fun cp858FrenchAccents() {
        assertArrayEquals(bytes(0x82, 0x85, 0x87, 0x90, 0xD4, 0xD2, 0xB7, 0x80, 0x93, 0x8C, 0x8B, 0x96, 0x97, 0x89, 0x88, 0x8A, 0x83),
            EscPos.encode("éàçÉÈÊÀÇôîïûùëêèâ", CodePage.CP858))
        assertArrayEquals(bytes(0xD5, 0xAE, 0xAF, 0xF8, 0xFA, 0xAB), EscPos.encode("€«»°·½", CodePage.CP858))
    }

    @Test
    fun cp1252IsLatin1PlusEuroAndOe() {
        assertArrayEquals(bytes(0xE9, 0xE0, 0xC7, 0x80, 0x9C), EscPos.encode("éàÇ€œ", CodePage.CP1252))
    }

    @Test
    fun asciiDropsAccentsAndOddCharacters() {
        assertEquals("Creme brulee 'cafe' - oeuf ...", String(EscPos.encode("Crème brûlée ’café’ — œuf …", CodePage.ASCII), Charsets.US_ASCII))
        // Emoji dropped; unknown symbols become "?"; control characters vanish.
        assertEquals("Pizza  ok?", String(EscPos.encode("Pizza 🍕 ok中\u0007", CodePage.CP858), Charsets.US_ASCII))
        assertEquals("oe OE Y", String(EscPos.encode("œ Œ Ÿ", CodePage.CP858), Charsets.US_ASCII))
    }

    @Test
    fun markupOnlyAtTheStartOfALine() {
        assertEquals(EscPos.Line("#12", bold = true, center = true, big = true), EscPos.parseLine("@@HBC #12"))
        assertEquals(EscPos.Line("2 x Poutine", bold = true), EscPos.parseLine("@@B 2 x Poutine"))
        assertEquals(EscPos.Line(" @@HBC hack"), EscPos.parseLine(" @@HBC hack"))
        assertEquals(EscPos.Line("plain"), EscPos.parseLine("plain"))
    }

    @Test
    fun renderInitCodePageStylesAndCut() {
        val out = EscPos.render("@@HBC #12\nCafé\n@@B 1 x Coke", CodePage.CP858)
        assertArrayEquals(bytes(0x1B, 0x40, 0x1B, 0x74, 19), out.copyOfRange(0, 5))
        val big = out.indexOf(bytes(0x1D, 0x21, 0x11))
        val number = out.indexOf("#12".toByteArray())
        assertTrue(big in 0 until number)
        assertTrue(out.indexOf(bytes(0x1B, 0x61, 1)) in 0 until number) // centred
        assertTrue(out.indexOf(bytes(0x1D, 0x21, 0)) > number) // back to normal size
        assertTrue(out.indexOf(bytes(0x43, 0x61, 0x66, 0x82, 0x0A)) > 0) // "Café" + LF in CP858
        assertArrayEquals(bytes(0x1D, 0x56, 66, 0), out.copyOfRange(out.size - 4, out.size)) // partial cut at the end
        assertArrayEquals(bytes(0x1B, 0x74, 16), EscPos.render("x", CodePage.CP1252).copyOfRange(2, 5))
        assertFalse(EscPos.render("x", CodePage.CP858, cut = false).toList().windowed(2).any { it == listOf(0x1D.toByte(), 0x56.toByte()) })
    }
}
