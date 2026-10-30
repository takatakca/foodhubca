package ca.takatak.mev.clover

import android.accounts.Account
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import com.clover.sdk.v1.printer.job.ImagePrintJob2
import com.clover.sdk.v1.printer.job.TextPrintJob
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/** Prints an invoice on the Clover device's printer: the lines, the QR code at « [CODE QR] », then the rest. */
class CloverReceiptPrinter(private val context: Context, private val account: Account) : ReceiptPrinter {
    override fun print(lines: List<String>, qrImage: String?, qrUrl: String?) {
        val (before, after) = ReceiptLayout.split(lines)
        if (before.isNotEmpty()) TextPrintJob.Builder().lines(before).build().print(context, account)
        val qr = qrBitmap(qrImage, qrUrl)
        if (qr != null) ImagePrintJob2.Builder(context).bitmap(qr).build().print(context, account)
        if (after.isNotEmpty()) TextPrintJob.Builder().lines(after).build().print(context, account)
    }

    /** Takatak MEV's PNG; else the QR drawn from its link (same content); else nothing (the text still prints). */
    private fun qrBitmap(qrImage: String?, qrUrl: String?): Bitmap? {
        ReceiptLayout.pngBytes(qrImage)?.let { bytes -> BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.let { return it } }
        if (qrUrl.isNullOrBlank()) return null
        val size = 384
        val m = QRCodeWriter().encode(qrUrl, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 2))
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        for (x in 0 until size) for (y in 0 until size) bmp.setPixel(x, y, if (m[x, y]) Color.BLACK else Color.WHITE)
        return bmp
    }
}
