package com.marinedouyere.orion.ui.calepinage

import com.marinedouyere.orion.ui.CalepinageRun
import kotlin.math.roundToLong

/** Post-compute warnings (machine-bounds checks), port of the `warnings` block in renderResults(). */
fun computeWarnings(run: CalepinageRun): List<String> {
    val warnings = mutableListOf<String>()
    val mat = run.mat
    val sheetL = run.usedL
    val sheetW = run.usedW

    if (sheetL > mat.maxSawLength) {
        warnings.add("La longueur de feuille (${sheetL.roundToLong()}mm) dépasse la longueur maxi de coupe de la scie (${mat.maxSawLength.roundToLong()}mm).")
    }
    if (mat.panelLenMin != null && (sheetL < mat.panelLenMin || sheetL > (mat.panelLenMax ?: Double.MAX_VALUE))) {
        warnings.add("Longueur de feuille hors bornes machine (${mat.panelLenMin.roundToLong()}–${mat.panelLenMax?.roundToLong()}mm).")
    }
    if (mat.panelWMin != null && (sheetW < mat.panelWMin || sheetW > (mat.panelWMax ?: Double.MAX_VALUE))) {
        warnings.add("Largeur de feuille hors bornes machine (${mat.panelWMin.roundToLong()}–${mat.panelWMax?.roundToLong()}mm).")
    }
    if (mat.pieceLenMin != null) {
        run.pieces.forEach { p ->
            val okAsIs = p.L >= mat.pieceLenMin && p.L <= (mat.pieceLenMax ?: Double.MAX_VALUE) &&
                p.W >= (mat.pieceWMin ?: 0.0) && p.W <= (mat.pieceWMax ?: Double.MAX_VALUE)
            val okRot = p.rotate && p.W >= mat.pieceLenMin && p.W <= (mat.pieceLenMax ?: Double.MAX_VALUE) &&
                p.L >= (mat.pieceWMin ?: 0.0) && p.L <= (mat.pieceWMax ?: Double.MAX_VALUE)
            if (!okAsIs && !okRot) {
                warnings.add(
                    "${p.name} (${p.L.roundToLong()}×${p.W.roundToLong()}) est hors des bornes pièce machine " +
                        "(L ${mat.pieceLenMin.roundToLong()}–${mat.pieceLenMax?.roundToLong()}mm, l ${mat.pieceWMin?.roundToLong()}–${mat.pieceWMax?.roundToLong()}mm).",
                )
            }
        }
    }
    if (mat.minPieceLenBand > 0) {
        val tooSmall = mutableListOf<String>()
        run.result.sheets.forEach { sh -> sh.bands.forEach { b -> b.items.forEach { it2 -> if (it2.w < mat.minPieceLenBand) tooSmall.add("${it2.name} (${it2.w.roundToLong()}mm)") } } }
        if (tooSmall.isNotEmpty()) {
            val uniq = tooSmall.distinct()
            val shown = uniq.take(6).joinToString(", ") + if (uniq.size > 6) "…" else ""
            warnings.add("${tooSmall.size} pièce(s) sous la longueur mini. autorisée dans une bande (${mat.minPieceLenBand.roundToLong()}mm) : $shown.")
        }
    }
    if (run.result.unplaced > 0) warnings.add("${run.result.unplaced} pièce(s) n'ont pas pu être placées.")
    return warnings
}
