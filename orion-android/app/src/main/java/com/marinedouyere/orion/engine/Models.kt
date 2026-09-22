package com.marinedouyere.orion.engine

/**
 * Result model for the cutting-optimization engine (ports of orion.html's
 * buildSheet/buildSheet3 outputs). Unlike the JS version, `pieceId`/`name`/
 * `pieceL`/`pieceW` are resolved at placement time instead of attached in a
 * later normalization pass. `pieceL`/`pieceW` are the piece's original (un-cut)
 * dimensions as entered; `w`/`h` are its as-cut size along the band's axes.
 */
data class CutItem(
    val pieceId: Int,
    val name: String,
    val pieceL: Double,
    val pieceW: Double,
    val w: Double,
    val h: Double,
    val rotated: Boolean,
    val x: Double,
    val dy: Double = 0.0,
)

data class CutBand(
    val height: Double,
    val usedLen: Double,
    val area: Double,
    val y: Double,
    val items: List<CutItem>,
    val recoupes: Int = 0,
)

data class CutSheet(
    val L: Double,
    val W: Double,
    val bands: List<CutBand>,
    val usedWidth: Double,
    val fromChute: Boolean = false,
    val parentSheetIndex: Int? = null,
    val coupeTete: Double? = null,
    val zones: Int = 1,
)

data class OversizedPiece(val pieceId: Int, val name: String, val L: Double, val W: Double)

data class Chute(val L: Double, val W: Double, val parentSheetIndex: Int)

data class OptimizeResult(
    val sheets: List<CutSheet>,
    val newSheets: Int,
    val util: Double,
    val oversized: List<OversizedPiece>,
    val unplaced: Int,
    val strategy: String,
    val elapsedMs: Long,
    val chutesLeft: List<Chute> = emptyList(),
    val recoupes: Int = 0,
    val coupesTete: Int = 0,
) {
    val placedArea: Double get() = sheets.sumOf { sheet -> sheet.bands.sumOf { band -> band.items.sumOf { it.w * it.h } } }
}

data class StockFormat(val L: Double, val W: Double, val label: String? = null)

data class FormatResult(val result: OptimizeResult, val format: StockFormat, val totalArea: Double)

data class BestFormatResult(val best: FormatResult, val all: List<FormatResult>)
