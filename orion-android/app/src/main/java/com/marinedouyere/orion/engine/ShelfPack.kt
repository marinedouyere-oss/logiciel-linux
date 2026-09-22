package com.marinedouyere.orion.engine

import com.marinedouyere.orion.data.Piece

internal data class ShelfPackResult(val sheets: List<CutSheet>, val oversized: List<OversizedPiece>)

private class ShelfItem(
    val pieceId: Int, val name: String, val pieceL: Double, val pieceW: Double,
    val w: Double, val h: Double, val rotated: Boolean, val x: Double,
)
private class ShelfBand(val height: Double, var usedLen: Double, val y: Double, val items: MutableList<ShelfItem>, var area: Double)
private class ShelfSheet(var usedWidth: Double, val bands: MutableList<ShelfBand>)

/**
 * Historical shelf-packing fallback (greedy, largest piece first). Kept as a
 * safety net so the DP-based engine (buildSheet/optimize) can never do worse
 * than this simpler algorithm. Port of shelfPack() in orion.html.
 */
internal fun shelfPack(
    pieces: List<Piece>,
    sheetL: Double,
    sheetW: Double,
    kerfSL: Double,
    kerfST: Double,
    maxBandWaste: Double = Double.POSITIVE_INFINITY,
): ShelfPackResult {
    data class Unit(val pieceId: Int, val name: String, val pieceL: Double, val pieceW: Double, val rotate: Boolean)
    val units = mutableListOf<Unit>()
    pieces.forEach { p -> repeat(p.qty) { units.add(Unit(p.id, p.name, p.L, p.W, p.rotate)) } }
    val sortedUnits = units.sortedByDescending { it.pieceL * it.pieceW }

    val sheets = mutableListOf<ShelfSheet>()
    val oversized = mutableListOf<OversizedPiece>()

    for (u in sortedUnits) {
        val allOrientations = mutableListOf(Orientation(u.pieceL, u.pieceW, false))
        if (u.rotate) allOrientations.add(Orientation(u.pieceW, u.pieceL, true))
        val os = allOrientations.filter { it.w <= sheetL + 1e-6 && it.h <= sheetW + 1e-6 }
        if (os.isEmpty()) {
            oversized.add(OversizedPiece(u.pieceId, u.name, u.pieceL, u.pieceW))
            continue
        }

        // 1) best-fit into an existing band on any sheet (minimize wasted height)
        var bestBand: ShelfBand? = null
        var bestO: Orientation? = null
        var bestNeed = 0.0
        var bestWaste = Double.POSITIVE_INFINITY
        for (sh in sheets) for (b in sh.bands) for (o in os) {
            if (o.h <= b.height + 1e-6 && (b.height - o.h) <= maxBandWaste + 1e-6) {
                val need = if (b.items.isNotEmpty()) kerfST + o.w else o.w
                if (b.usedLen + need <= sheetL + 1e-6) {
                    val waste = b.height - o.h
                    if (waste < bestWaste) {
                        bestWaste = waste
                        bestBand = b
                        bestO = o
                        bestNeed = need
                    }
                }
            }
        }
        if (bestBand != null && bestO != null) {
            val x = bestBand.usedLen + (if (bestBand.items.isNotEmpty()) kerfST else 0.0)
            bestBand.items.add(ShelfItem(u.pieceId, u.name, u.pieceL, u.pieceW, bestO.w, bestO.h, bestO.rotated, x))
            bestBand.usedLen += bestNeed
            bestBand.area += bestO.w * bestO.h
            continue
        }

        // 2) best-fit a new band into an existing sheet (minimize the band's height)
        var bestSheet: ShelfSheet? = null
        var bestSheetO: Orientation? = null
        var bestSheetNw = 0.0
        for (sh in sheets) for (o in os) {
            val nw = if (sh.bands.isNotEmpty()) kerfSL + o.h else o.h
            if (sh.usedWidth + nw <= sheetW + 1e-6 && (bestSheetO == null || o.h < bestSheetO.h)) {
                bestSheet = sh
                bestSheetO = o
                bestSheetNw = nw
            }
        }
        if (bestSheet != null && bestSheetO != null) {
            val y = bestSheet.usedWidth + (if (bestSheet.bands.isNotEmpty()) kerfSL else 0.0)
            bestSheet.bands.add(
                ShelfBand(
                    bestSheetO.h, bestSheetO.w, y,
                    mutableListOf(ShelfItem(u.pieceId, u.name, u.pieceL, u.pieceW, bestSheetO.w, bestSheetO.h, bestSheetO.rotated, 0.0)),
                    bestSheetO.w * bestSheetO.h,
                ),
            )
            bestSheet.usedWidth += bestSheetNw
            continue
        }

        // 3) open a brand new sheet with the smallest-height orientation
        val o = os.minByOrNull { it.h }!!
        sheets.add(
            ShelfSheet(
                o.h,
                mutableListOf(
                    ShelfBand(o.h, o.w, 0.0, mutableListOf(ShelfItem(u.pieceId, u.name, u.pieceL, u.pieceW, o.w, o.h, o.rotated, 0.0)), o.w * o.h),
                ),
            ),
        )
    }

    val cutSheets = sheets.map { sh ->
        CutSheet(
            L = sheetL,
            W = sheetW,
            bands = sh.bands.map { b ->
                CutBand(
                    height = b.height,
                    usedLen = b.usedLen,
                    area = b.area,
                    y = b.y,
                    items = b.items.map { CutItem(it.pieceId, it.name, it.pieceL, it.pieceW, it.w, it.h, it.rotated, it.x) },
                )
            },
            usedWidth = sh.usedWidth,
            fromChute = false,
        )
    }
    return ShelfPackResult(cutSheets, oversized)
}
