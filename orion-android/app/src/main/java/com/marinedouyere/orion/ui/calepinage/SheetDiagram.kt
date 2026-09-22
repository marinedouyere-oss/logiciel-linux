package com.marinedouyere.orion.ui.calepinage

import android.graphics.Paint
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.sp
import com.marinedouyere.orion.engine.CutSheet
import com.marinedouyere.orion.ui.MachineBounds
import com.marinedouyere.orion.ui.theme.OrionAmber
import com.marinedouyere.orion.ui.theme.OrionInk
import com.marinedouyere.orion.ui.theme.OrionPiecePalette
import kotlin.math.roundToLong

private val TRIM_OVERLAY = Color(0xFF94A3B8)
private val LOSS_COLOR = Color(0xFF64748B)

/**
 * Cut-plan diagram for one sheet, drawn on a Canvas: bands, color-coded
 * pieces with dimension labels, and chute (reusable offcut, amber) vs perte
 * (loss, grey) shading. Port of the per-sheet SVG block in renderResults().
 */
@Composable
fun SheetDiagram(sheet: CutSheet, trimLong: Double, trimTrans: Double, mat: MachineBounds) {
    val fullL = if (sheet.fromChute) sheet.L else sheet.L + trimLong
    val fullW = if (sheet.fromChute) sheet.W else sheet.W + trimTrans
    if (fullL <= 0 || fullW <= 0) return
    val aspect = (fullL / fullW).toFloat()

    val inkArgb = remember { OrionInk.toArgb() }
    val labelPaint = remember {
        Paint().apply {
            color = inkArgb
            textAlign = Paint.Align.CENTER
            isAntiAlias = true
        }
    }

    Canvas(Modifier.fillMaxWidth().aspectRatio(aspect.coerceAtLeast(0.05f))) {
        val scale = (size.width / fullL).toFloat()
        val ox = (if (sheet.fromChute) 0.0 else trimLong / 2)
        val oy = (if (sheet.fromChute) 0.0 else trimTrans / 2)

        drawRect(Color.White, topLeft = Offset.Zero, size = size)
        drawRect(OrionInk, topLeft = Offset.Zero, size = size, style = Stroke(width = 1.5f))

        if (!sheet.fromChute && (trimLong > 0 || trimTrans > 0)) {
            drawRect(TRIM_OVERLAY.copy(alpha = 0.18f), topLeft = Offset.Zero, size = size)
            val innerTopLeft = Offset((ox * scale).toFloat(), (oy * scale).toFloat())
            val innerSize = Size((sheet.L * scale).toFloat(), (sheet.W * scale).toFloat())
            drawRect(Color.White, topLeft = innerTopLeft, size = innerSize)
            drawRect(
                TRIM_OVERLAY,
                topLeft = innerTopLeft,
                size = innerSize,
                style = Stroke(width = 1f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(4f, 3f))),
            )
        }

        sheet.bands.forEach { band ->
            val by = ((band.y + oy) * scale).toFloat()
            val bh = (band.height * scale).toFloat()
            band.items.forEach { item ->
                val ix = ((item.x + ox) * scale).toFloat()
                val iw = (item.w * scale).toFloat()
                val ih = (item.h * scale).toFloat()
                val iy = by + (item.dy * scale).toFloat()
                val color = OrionPiecePalette[((item.pieceId % OrionPiecePalette.size) + OrionPiecePalette.size) % OrionPiecePalette.size]
                drawRect(color.copy(alpha = 0.75f), topLeft = Offset(ix, iy), size = Size(iw, ih))
                drawRect(OrionInk, topLeft = Offset(ix, iy), size = Size(iw, ih), style = Stroke(width = 1f))
                if (iw > 40 && ih > 16) {
                    val label = "${item.pieceL.roundToLong()}×${item.pieceW.roundToLong()}${if (item.rotated) " ↻" else ""}"
                    labelPaint.textSize = 11.sp.toPx()
                    drawContext.canvas.nativeCanvas.drawText(label, ix + iw / 2, iy + ih / 2 + 4, labelPaint)
                }
            }
            val remLen = sheet.L - band.usedLen
            if (remLen > 1) {
                val x0 = ((band.usedLen + ox) * scale).toFloat()
                val w0 = (remLen * scale).toFloat()
                val reusable = remLen >= mat.minChuteL && band.height >= mat.minChuteW && (remLen * band.height / 1e6) >= mat.minChuteArea
                val col = if (reusable) OrionAmber else LOSS_COLOR
                drawRect(col.copy(alpha = 0.14f), topLeft = Offset(x0, by), size = Size(w0, bh))
                if (w0 > 50 && bh > 14) {
                    labelPaint.color = col.toArgb()
                    labelPaint.textSize = 10.sp.toPx()
                    val label = "${if (reusable) "chute" else "perte"} ${remLen.roundToLong()}×${band.height.roundToLong()}"
                    drawContext.canvas.nativeCanvas.drawText(label, x0 + w0 / 2, by + bh / 2 + 4, labelPaint)
                    labelPaint.color = inkArgb
                }
            }
        }

        val remW = sheet.W - sheet.usedWidth
        if (remW > 1) {
            val y0 = ((sheet.usedWidth + oy) * scale).toFloat()
            val h0 = (remW * scale).toFloat()
            val reusable = sheet.L >= mat.minChuteL && remW >= mat.minChuteW && (sheet.L * remW / 1e6) >= mat.minChuteArea
            val col = if (reusable) OrionAmber else LOSS_COLOR
            drawRect(col.copy(alpha = 0.14f), topLeft = Offset((ox * scale).toFloat(), y0), size = Size((sheet.L * scale).toFloat(), h0))
            if (h0 > 14) {
                labelPaint.color = col.toArgb()
                labelPaint.textSize = 10.sp.toPx()
                val label = "${if (reusable) "chute" else "perte"} ${sheet.L.roundToLong()}×${remW.roundToLong()}"
                drawContext.canvas.nativeCanvas.drawText(label, (ox * scale).toFloat() + (sheet.L * scale).toFloat() / 2, y0 + h0 / 2 + 4, labelPaint)
                labelPaint.color = inkArgb
            }
        }
    }
}
