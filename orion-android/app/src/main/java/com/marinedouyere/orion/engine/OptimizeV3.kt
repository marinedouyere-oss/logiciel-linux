package com.marinedouyere.orion.engine

import com.marinedouyere.orion.data.Piece
import kotlin.math.ceil

internal data class OptimizeConfig3(
    val sheetL: Double,
    val sheetW: Double,
    val kerfSL: Double,
    val kerfST: Double,
    val step: Double = 5.0,
    val timeBudgetMs: Long = 5000,
    val forceNoRecoupe: Boolean = false,
    val kerfRec: Double? = null,
    val maxBandWaste: Double = Double.POSITIVE_INFINITY,
)

internal data class Variant(val rec: Boolean, val tete: Boolean, val nom: String)

// La recoupe et la coupe de tête ne sont PAS toujours gagnantes : elles élargissent
// le choix de bandes et peuvent égarer l'optimiseur. On les traite donc comme des
// options à tester, jamais comme des réglages imposés — le résultat retenu est le
// meilleur des variantes, ce qui garantit qu'activer ces fonctions ne peut pas
// dégrader le calepinage.
internal val VARIANTES: List<Variant> = listOf(
    Variant(rec = false, tete = false, nom = "simple"),
    Variant(rec = true, tete = false, nom = "recoupe"),
    Variant(rec = false, tete = true, nom = "coupe de tête"),
    Variant(rec = true, tete = true, nom = "recoupe + coupe de tête"),
)

/**
 * Full v3 optimization: tries every (variant × strategy) combination within
 * the time budget and keeps the best. Port of optimize3() in orion.html.
 *
 * Unlike optimize() (v2), this engine never reuses chutes (offcuts) across
 * sheets — same as the original.
 */
internal fun optimize3(pieces: List<Piece>, cfg: OptimizeConfig3): OptimizeResult? {
    val t0 = System.currentTimeMillis()
    var best: OptimizeResult? = null

    val variantes = if (cfg.forceNoRecoupe) VARIANTES.filter { !it.rec } else VARIANTES

    for (v in variantes) {
        for (strategy in STRATEGIES3) {
            if (System.currentTimeMillis() - t0 > cfg.timeBudgetMs && best != null) break

            val demand = buildUnits(pieces)
            val oversized = mutableListOf<OversizedPiece>()
            demand.forEach { d ->
                val ok = orientationsOf(d).any { it.w <= cfg.sheetL + 1e-6 && it.h <= cfg.sheetW + 1e-6 }
                if (!ok && d.left > 0) {
                    oversized.add(OversizedPiece(d.pieceId, d.name, d.L, d.W))
                    d.left = 0
                }
            }

            val zoneCfg = ZoneConfig(
                kerfSL = cfg.kerfSL,
                kerfST = cfg.kerfST,
                kerfRec = cfg.kerfRec ?: cfg.kerfST,
                step = cfg.step,
                allowRecoupe = v.rec,
                allowCoupeTete = v.tete,
                maxBandWaste = cfg.maxBandWaste,
            )
            val sheets = mutableListOf<CutSheet>()
            var g = 0
            val sheetArea = cfg.sheetL * cfg.sheetW
            while (demand.any { it.left > 0 } && g++ < 500) {
                val remArea = demand.sumOf { maxOf(0, it.left) * it.L * it.W }
                val need = DoubleArray(demand.size) { i ->
                    val d = demand[i]
                    if (d.left <= 0) return@DoubleArray 0.0
                    var per = 0
                    orientationsOf(d).forEach { o ->
                        if (o.w > cfg.sheetL + 1e-6 || o.h > cfg.sheetW + 1e-6) return@forEach
                        val n = ((cfg.sheetL + zoneCfg.kerfST) / (o.w + zoneCfg.kerfST)).toInt() *
                            ((cfg.sheetW + zoneCfg.kerfSL) / (o.h + zoneCfg.kerfSL)).toInt()
                        if (n > per) per = n
                    }
                    if (per > 0) d.left.toDouble() / per else 0.0
                }
                val maxNeed = maxOf(1e-9, need.maxOrNull() ?: 0.0)
                val price = DoubleArray(demand.size) { i -> 1.0 + strategy.alpha * (need[i] / maxNeed) }
                val ctx = OptimizeContext(price, maxOf(1, ceil(remArea / sheetArea).toInt()))
                val sh = buildSheet3(demand, cfg.sheetL, cfg.sheetW, zoneCfg, strategy, ctx) ?: break
                // Unlike the original (which pushes buildSheet3's raw result without ever
                // attaching L/W/fromChute onto it — a latent bug there when v3 wins over
                // v2), toCutSheet() makes attaching real sheet dimensions unskippable.
                sheets.add(sh.toCutSheet(cfg.sheetL, cfg.sheetW, demand, fromChute = false))
            }

            val unplaced = demand.sumOf { maxOf(0, it.left) }
            val aire = sheets.sumOf { sh -> sh.bands.sumOf { it.area } }
            val cand = OptimizeResult(
                sheets = sheets,
                newSheets = sheets.size,
                util = if (sheets.isNotEmpty()) aire / (sheets.size * sheetArea) else 0.0,
                oversized = oversized,
                unplaced = unplaced,
                strategy = "${strategy.name} / ${v.nom}",
                elapsedMs = 0,
                recoupes = sheets.sumOf { sh -> sh.bands.sumOf { it.recoupes } },
                coupesTete = sheets.count { it.coupeTete != null },
            )
            if (isBetterCandidate(cand, best)) best = cand
        }
    }

    return best?.copy(elapsedMs = System.currentTimeMillis() - t0)
}
