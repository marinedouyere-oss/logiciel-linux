package com.marinedouyere.orion.engine

import com.marinedouyere.orion.data.Piece
import kotlin.math.ceil

internal data class OptimizeConfig(
    val sheetL: Double,
    val sheetW: Double,
    val kerfSL: Double,
    val kerfST: Double,
    val minChuteL: Double = 0.0,
    val minChuteW: Double = 0.0,
    val minChuteArea: Double = 0.0,
    val reuseChutes: Boolean = true,
    val step: Double = 5.0,
    val timeBudgetMs: Long = 4000,
    val maxBandWaste: Double = Double.POSITIVE_INFINITY,
    val trimLong: Double = 0.0,
    val trimTrans: Double = 0.0,
    val forceNoRecoupe: Boolean = false,
    val kerfRec: Double? = null,
)

private data class ChuteRef(val L: Double, val W: Double, val parent: Int)

/**
 * Full v2 optimization: tries every STRATEGIES entry plus 8 randomized
 * restarts within the time budget, reusing valorizable offcuts (chutes)
 * across sheets, and keeps the best candidate. Falls back to shelfPack() so
 * the DP engine can never perform worse than the historical algorithm.
 * Port of optimize() in orion.html.
 */
internal fun optimize(pieces: List<Piece>, cfg: OptimizeConfig): OptimizeResult {
    val t0 = System.currentTimeMillis()
    var best: OptimizeResult? = null

    val plan = STRATEGIES.toMutableList()
    repeat(8) { plan.add(randomStrategy()) }

    for (strategy in plan) {
        if (System.currentTimeMillis() - t0 > cfg.timeBudgetMs && best != null) break

        val demand = buildUnits(pieces)
        val oversized = mutableListOf<OversizedPiece>()
        demand.forEach { d ->
            val fits = orientationsOf(d).any { it.w <= cfg.sheetL + 1e-6 && it.h <= cfg.sheetW + 1e-6 }
            if (!fits && d.left > 0) {
                oversized.add(OversizedPiece(d.pieceId, d.name, d.L, d.W))
                d.left = 0
            }
        }

        val sheets = mutableListOf<CutSheet>()
        val chutes = mutableListOf<ChuteRef>()
        var guard = 0
        val sheetArea = cfg.sheetL * cfg.sheetW

        fun buildCtx(): OptimizeContext {
            val remArea = demand.sumOf { maxOf(0, it.left) * it.L * it.W }
            val need = DoubleArray(demand.size) { i ->
                val d = demand[i]
                if (d.left <= 0) return@DoubleArray 0.0
                var perSheet = 0
                orientationsOf(d).forEach { o ->
                    if (o.w > cfg.sheetL + 1e-6 || o.h > cfg.sheetW + 1e-6) return@forEach
                    val n = ((cfg.sheetL + cfg.kerfST) / (o.w + cfg.kerfST)).toInt() *
                        ((cfg.sheetW + cfg.kerfSL) / (o.h + cfg.kerfSL)).toInt()
                    if (n > perSheet) perSheet = n
                }
                if (perSheet > 0) d.left.toDouble() / perSheet else 0.0
            }
            val maxNeed = maxOf(1e-9, need.maxOrNull() ?: 0.0)
            val price = DoubleArray(demand.size) { i -> 1.0 + strategy.alpha * (need[i] / maxNeed) }
            return OptimizeContext(price, maxOf(1, ceil(remArea / sheetArea).toInt()))
        }

        while (demand.any { it.left > 0 }) {
            if (++guard > 2000) break

            var placed = false
            if (cfg.reuseChutes) {
                chutes.sortBy { it.L * it.W }
                var i = 0
                while (i < chutes.size) {
                    val ch = chutes[i]
                    val res = buildSheet(demand, ch.L, ch.W, cfg.kerfSL, cfg.kerfST, cfg.step, strategy, buildCtx(), cfg.maxBandWaste)
                    if (res != null && res.bands.isNotEmpty()) {
                        sheets.add(res.toCutSheet(ch.L, ch.W, demand, fromChute = true, parentSheetIndex = ch.parent))
                        chutes.removeAt(i)
                        placed = true
                        break
                    }
                    i++
                }
            }
            if (placed) continue

            val res = buildSheet(demand, cfg.sheetL, cfg.sheetW, cfg.kerfSL, cfg.kerfST, cfg.step, strategy, buildCtx(), cfg.maxBandWaste)
            if (res == null || res.bands.isEmpty()) break
            sheets.add(res.toCutSheet(cfg.sheetL, cfg.sheetW, demand, fromChute = false))

            if (cfg.reuseChutes) {
                val idx = sheets.size - 1
                val remW = cfg.sheetW - res.usedWidth
                if (remW >= cfg.minChuteW && cfg.sheetL >= cfg.minChuteL && (cfg.sheetL * remW / 1e6) >= cfg.minChuteArea) {
                    chutes.add(ChuteRef(cfg.sheetL, remW, idx))
                }
                res.bands.forEach { b ->
                    val remL = cfg.sheetL - b.usedLen
                    if (remL >= cfg.minChuteL && b.height >= cfg.minChuteW && (remL * b.height / 1e6) >= cfg.minChuteArea) {
                        chutes.add(ChuteRef(remL, b.height, idx))
                    }
                }
            }
        }

        val newSheets = sheets.count { !it.fromChute }
        val placedArea = sheets.sumOf { sh -> sh.bands.sumOf { b -> b.items.sumOf { it.w * it.h } } }
        val util = if (newSheets > 0) placedArea / (newSheets * cfg.sheetL * cfg.sheetW) else 0.0
        val unplaced = demand.sumOf { maxOf(0, it.left) }

        val cand = OptimizeResult(
            sheets = sheets,
            newSheets = newSheets,
            util = util,
            oversized = oversized,
            unplaced = unplaced,
            strategy = strategy.name,
            elapsedMs = 0,
            chutesLeft = chutes.map { Chute(it.L, it.W, it.parent) },
        )
        if (isBetterCandidate(cand, best)) best = cand
    }

    // repli : l'algorithme d'étagères historique, pour ne jamais faire moins bien
    val sp = shelfPack(pieces, cfg.sheetL, cfg.sheetW, cfg.kerfSL, cfg.kerfST, cfg.maxBandWaste)
    if (sp.sheets.isNotEmpty()) {
        val area = sp.sheets.sumOf { sh -> sh.bands.sumOf { it.area } }
        val candShelf = OptimizeResult(
            sheets = sp.sheets,
            newSheets = sp.sheets.size,
            util = area / (sp.sheets.size * cfg.sheetL * cfg.sheetW),
            oversized = sp.oversized,
            unplaced = 0,
            strategy = "étagères (repli)",
            elapsedMs = 0,
        )
        val currentBest = best
        if (currentBest == null || candShelf.newSheets < currentBest.newSheets ||
            (candShelf.newSheets == currentBest.newSheets && candShelf.util > currentBest.util)
        ) {
            best = candShelf
        }
    }

    // `plan` is never empty (STRATEGIES has 12 entries + 8 random restarts), so the
    // loop above always produces at least one candidate: best is never null here.
    val elapsed = System.currentTimeMillis() - t0
    return best!!.copy(elapsedMs = elapsed)
}
