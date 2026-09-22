package com.marinedouyere.orion.engine

import com.marinedouyere.orion.data.Piece

/**
 * Runs the v2 engine (bands) then the v3 engine (recoupe + coupe de tête) and
 * keeps the better of the two: v3 isn't systematically superior — on simple
 * cases it can do worse — hence this arbitration rather than a straight
 * replacement. Port of meilleurDesDeuxMoteurs() in orion.html.
 */
internal fun meilleurDesDeuxMoteurs(pieces: List<Piece>, cfg: OptimizeConfig): OptimizeResult {
    val budget = cfg.timeBudgetMs
    val a = optimize(pieces, cfg.copy(timeBudgetMs = Math.round(budget * 0.45)))
    val b = try {
        optimize3(
            pieces,
            OptimizeConfig3(
                sheetL = cfg.sheetL,
                sheetW = cfg.sheetW,
                kerfSL = cfg.kerfSL,
                kerfST = cfg.kerfST,
                step = cfg.step,
                timeBudgetMs = Math.round(budget * 0.55),
                forceNoRecoupe = cfg.forceNoRecoupe,
                kerfRec = cfg.kerfST,
                maxBandWaste = cfg.maxBandWaste,
            ),
        )
    } catch (e: Exception) {
        null
    }

    if (b == null) return a
    if (b.unplaced < a.unplaced) return b
    if (b.unplaced > a.unplaced) return a
    if (b.newSheets < a.newSheets) return b
    if (b.newSheets > a.newSheets) return a
    return if (b.util > a.util) b else a
}

/**
 * Compares several stock panel formats (typically Woodstore's formats for the
 * selected material) and keeps the best by total area consumed — that's what
 * costs money, not the raw sheet count. Port of optimizeBestFormat().
 */
internal fun optimizeBestFormat(pieces: List<Piece>, formats: List<StockFormat>, cfg: OptimizeConfig): BestFormatResult {
    val budget = maxOf(600L, cfg.timeBudgetMs / maxOf(1, formats.size))
    val results = formats.map { f ->
        val r = meilleurDesDeuxMoteurs(
            pieces,
            cfg.copy(
                sheetL = f.L - cfg.trimLong,
                sheetW = f.W - cfg.trimTrans,
                timeBudgetMs = budget,
            ),
        )
        FormatResult(r, f, r.newSheets * f.L * f.W)
    }
    val sorted = results.sortedWith(
        compareBy<FormatResult> { it.result.unplaced }
            .thenBy { it.totalArea }
            .thenBy { it.result.newSheets },
    )
    return BestFormatResult(sorted.first(), sorted)
}
