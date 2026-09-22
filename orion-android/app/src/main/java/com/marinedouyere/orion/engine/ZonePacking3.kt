package com.marinedouyere.orion.engine

import kotlin.math.abs
import kotlin.math.ceil

private data class ColCandidate(val col: ColumnResult, val counts: Map<Int, Int>, val rep: Int)

/**
 * Fills one band of height `height` over `maxLen`, but the placed elements are
 * whole COLUMNS (recoupe stacks) rather than single pieces. When recoupe is
 * disallowed, each column degenerates to a single piece. Port of fillStrip3().
 */
internal fun fillStrip3(
    demand: List<Demand>,
    height: Double,
    maxLen: Double,
    kerfST: Double,
    kerfRec: Double,
    step: Double,
    weightFn: (PlacementCandidate) -> Double,
    allowRecoupe: Boolean,
    maxBandWaste: Double = Double.POSITIVE_INFINITY,
): StripResult? {
    val widths = LinkedHashSet<Double>()
    demand.forEach { d ->
        if (d.left <= 0) return@forEach
        orientationsOf(d).forEach { o ->
            if (o.h <= height + 1e-6 && o.w <= maxLen + 1e-6) widths.add(jsRound(o.w))
        }
    }
    if (widths.isEmpty()) return null

    val cols = mutableListOf<ColumnResult>()
    for (w in widths) {
        val col: ColumnResult? = if (allowRecoupe) {
            bestColumn3(demand, w, height, kerfRec, step, weightFn)
        } else {
            var best: PlacementCandidate? = null
            var bestV = Double.NEGATIVE_INFINITY
            demand.forEachIndexed { di, d ->
                if (d.left <= 0) return@forEachIndexed
                orientationsOf(d).forEach { o ->
                    if (abs(o.w - w) < 0.51 && o.h <= height + 1e-6 && (height - o.h) <= maxBandWaste + 1e-6) {
                        val cand = PlacementCandidate(di, o.w, o.h, o.rotated, o.w * o.h)
                        val v = weightFn(cand)
                        if (best == null || v > bestV) {
                            best = cand
                            bestV = v
                        }
                    }
                }
            }
            val b = best
            if (b != null) ColumnResult(b.w, listOf(StripItem(b.di, b.w, b.h, b.rotated, x = 0.0, dy = 0.0)), b.area, b.h, 1) else null
        }
        if (col != null) cols.add(col)
    }
    if (cols.isEmpty()) return null

    // combien de fois chaque colonne peut être répétée compte tenu du stock
    val colCands = cols.map { col ->
        val counts = HashMap<Int, Int>()
        col.items.forEach { counts[it.di] = (counts[it.di] ?: 0) + 1 }
        var rep = Int.MAX_VALUE
        counts.forEach { (di, count) -> rep = minOf(rep, demand[di].left / count) }
        ColCandidate(col, counts, rep)
    }

    // sac à dos borné sur la LONGUEUR de la bande
    val cap = ceil((maxLen + kerfST) / step).toInt()
    val cost = IntArray(colCands.size) { i -> maxOf(1, ceil((colCands[i].col.w + kerfST) / step).toInt()) }
    val value = DoubleArray(colCands.size) { i -> colCands[i].col.area }
    val maxCount = IntArray(colCands.size) { i -> colCands[i].rep }
    val used = boundedKnapsack(cap, cost, value, maxCount) ?: return null

    val chosen = mutableListOf<ColCandidate>()
    for (i in colCands.indices) repeat(used[i]) { chosen.add(colCands[i]) }
    if (chosen.isEmpty()) return null
    val sortedChosen = chosen.sortedByDescending { it.col.usedH }

    // placement réel, en respectant le stock
    val left = IntArray(demand.size) { demand[it].left }
    val items = mutableListOf<StripItem>()
    var x = 0.0
    var area = 0.0
    var nbCol = 0
    for (cc in sortedChosen) {
        val ok = cc.counts.all { (di, count) -> left[di] >= count }
        if (!ok) continue
        val need = if (nbCol > 0) kerfST + cc.col.w else cc.col.w
        if (x + need > maxLen + 1e-6) continue
        if (nbCol > 0) x += kerfST
        cc.col.items.forEach { it2 ->
            items.add(StripItem(it2.di, it2.w, it2.h, it2.rotated, x, it2.dy))
            left[it2.di]--
            area += it2.w * it2.h
        }
        x += cc.col.w
        nbCol++
    }
    if (items.isEmpty()) return null

    val counts = HashMap<Int, Int>()
    items.forEach { counts[it.di] = (counts[it.di] ?: 0) + 1 }
    val recoupes = sortedChosen.count { it.col.nb > 1 }
    return StripResult(items, area, x, height, counts, recoupes = recoupes)
}

internal data class ZoneConfig(
    val kerfSL: Double,
    val kerfST: Double,
    val kerfRec: Double,
    val step: Double,
    val allowRecoupe: Boolean,
    val allowCoupeTete: Boolean = false,
    val maxBandWaste: Double = Double.POSITIVE_INFINITY,
)

/**
 * Stacks bands into one zone of a panel (a zone is the whole sheet, or one side
 * of an optional head-cut split). Port of buildZone3().
 */
internal fun buildZone3(demand: List<Demand>, zoneL: Double, zoneW: Double, cfg: ZoneConfig, strategy: Strategy, ctx: OptimizeContext?): SheetBuild? {
    val wf: (PlacementCandidate) -> Double = { c -> strategy.weight(c) * priceOf(ctx, c.di) }

    val heights = LinkedHashSet<Double>()
    demand.forEach { d ->
        if (d.left <= 0) return@forEach
        orientationsOf(d).forEach { o ->
            if (o.h <= zoneW + 1e-6 && o.w <= zoneL + 1e-6) heights.add(o.h)
        }
    }
    if (heights.isEmpty()) return null

    // Avec la recoupe, des bandes plus HAUTES que la pièce deviennent utiles :
    // on ajoute les sommes de hauteurs (2 ou 3 pièces empilées).
    if (cfg.allowRecoupe) {
        val base = heights.toList()
        base.forEach { a ->
            base.forEach { b ->
                val s2 = a + cfg.kerfRec + b
                if (s2 <= zoneW + 1e-6) heights.add(s2)
                val s3 = s2 + cfg.kerfRec + a
                if (s3 <= zoneW + 1e-6) heights.add(s3)
            }
        }
    }

    val hs = heights.sorted()
    data class ZoneCandidate(val strip: StripResult, val rep: Int, val value: Double)
    val cand = mutableListOf<ZoneCandidate>()
    hs.forEach { h ->
        val s = fillStrip3(demand, h, zoneL, cfg.kerfST, cfg.kerfRec, cfg.step, wf, cfg.allowRecoupe, cfg.maxBandWaste) ?: return@forEach
        var rep = Int.MAX_VALUE
        s.counts.forEach { (di, count) -> rep = minOf(rep, demand[di].left / count) }
        if (rep <= 0) return@forEach
        val value = if (strategy.densityBonus) s.area * (s.area / (h * zoneL)) else s.area
        cand.add(ZoneCandidate(s, rep, value))
    }
    if (cand.isEmpty()) return null

    val cap = ceil((zoneW + cfg.kerfSL) / cfg.step).toInt()
    val cost = IntArray(cand.size) { i -> maxOf(1, ceil((cand[i].strip.height + cfg.kerfSL) / cfg.step).toInt()) }
    val value = DoubleArray(cand.size) { i -> cand[i].value }
    val maxCount = IntArray(cand.size) { i -> cand[i].rep }
    val used = boundedKnapsack(cap, cost, value, maxCount) ?: return null

    val plan = mutableListOf<ZoneCandidate>()
    for (i in cand.indices) repeat(used[i]) { plan.add(cand[i]) }
    if (plan.isEmpty()) return null
    val sortedPlan = plan.sortedByDescending { it.strip.height }

    val bands = mutableListOf<StripResult>()
    var usedW = 0.0
    for (p in sortedPlan) {
        val remW = zoneW - usedW - (if (bands.isNotEmpty()) cfg.kerfSL else 0.0)
        if (p.strip.height > remW + 1e-6) continue
        val strip = fillStrip3(demand, p.strip.height, zoneL, cfg.kerfST, cfg.kerfRec, cfg.step, wf, cfg.allowRecoupe, cfg.maxBandWaste) ?: continue
        strip.items.forEach { demand[it.di].left-- }
        val y = usedW + (if (bands.isNotEmpty()) cfg.kerfSL else 0.0)
        val placed = strip.copy(y = y)
        usedW = y + placed.height
        bands.add(placed)
    }

    // combler la largeur restante
    var guard = 0
    while (guard++ < 60) {
        val remW = zoneW - usedW - (if (bands.isNotEmpty()) cfg.kerfSL else 0.0)
        if (remW <= 0) break
        var best: StripResult? = null
        var bestSc = -1.0
        for (h in hs) {
            if (h > remW + 1e-6) continue
            val s = fillStrip3(demand, h, zoneL, cfg.kerfST, cfg.kerfRec, cfg.step, wf, cfg.allowRecoupe, cfg.maxBandWaste) ?: continue
            val sc = s.area / (h * zoneL)
            if (sc > bestSc) {
                bestSc = sc
                best = s
            }
        }
        val chosen = best ?: break
        chosen.items.forEach { demand[it.di].left-- }
        val y = usedW + (if (bands.isNotEmpty()) cfg.kerfSL else 0.0)
        val placed = chosen.copy(y = y)
        usedW = y + placed.height
        bands.add(placed)
    }

    if (bands.isEmpty()) return null
    return SheetBuild(bands, usedW)
}

/**
 * Builds a full sheet, optionally with a head cut splitting it into two
 * independently-optimized zones. Port of buildSheet3() + finalizeSheet3().
 */
internal fun buildSheet3(demand: List<Demand>, sheetL: Double, sheetW: Double, cfg: ZoneConfig, strategy: Strategy, ctx: OptimizeContext?): SheetBuild? {
    if (!cfg.allowCoupeTete) {
        // single zone at x=0: buildZone3's band offsets are already absolute
        return buildZone3(demand, sheetL, sheetW, cfg, strategy, ctx)
    }

    // on essaie plusieurs positions de coupe de tête et on garde la meilleure
    val largeurs = LinkedHashSet<Double>()
    demand.forEach { d ->
        if (d.left <= 0) return@forEach
        orientationsOf(d).forEach { o -> if (o.w < sheetL) largeurs.add(o.w) }
    }
    val positions = largeurs.filter { it >= 100 && it <= sheetL - 100 }.sortedDescending().take(6)

    val etat = IntArray(demand.size) { demand[it].left }
    fun restoreEtat() {
        demand.forEachIndexed { i, d -> d.left = etat[i] }
    }

    var meilleurZones: List<Pair<Double, SheetBuild>>? = null // (zoneX, build)
    var meilleurCoupeTete: Double? = null
    var meilleurAire = -1.0
    var meilleurEtat: IntArray? = null

    // sans coupe de tête
    run {
        restoreEtat()
        val z = buildZone3(demand, sheetL, sheetW, cfg, strategy, ctx)
        if (z != null) {
            val aire = z.bands.sumOf { it.area }
            meilleurZones = listOf(0.0 to z)
            meilleurCoupeTete = null
            meilleurAire = aire
            meilleurEtat = IntArray(demand.size) { demand[it].left }
        }
    }

    // avec coupe de tête à chaque position testée
    for (pos in positions) {
        restoreEtat()
        val zA = buildZone3(demand, pos, sheetW, cfg, strategy, ctx)
        val restL = sheetL - pos - cfg.kerfST
        val zB = if (restL > 50) buildZone3(demand, restL, sheetW, cfg, strategy, ctx) else null
        if (zA == null && zB == null) continue
        val aire = (zA?.bands?.sumOf { it.area } ?: 0.0) + (zB?.bands?.sumOf { it.area } ?: 0.0)
        if (aire > meilleurAire + 1e-6) {
            val zones = mutableListOf<Pair<Double, SheetBuild>>()
            if (zA != null) zones.add(0.0 to zA)
            if (zB != null) zones.add((pos + cfg.kerfST) to zB)
            meilleurZones = zones
            meilleurCoupeTete = pos
            meilleurAire = aire
            meilleurEtat = IntArray(demand.size) { demand[it].left }
        }
    }

    val zones = meilleurZones ?: run { restoreEtat(); return null }
    demand.forEachIndexed { i, d -> d.left = meilleurEtat!![i] }

    // Aplatit les zones en une liste de bandes avec coordonnées absolues
    val allBands = mutableListOf<StripResult>()
    var usedWidth = 0.0
    zones.forEach { (zoneX, z) ->
        z.bands.forEach { b ->
            allBands.add(b.copy(items = b.items.map { it.copy(x = it.x + zoneX) }))
        }
        usedWidth = maxOf(usedWidth, z.usedWidth)
    }
    if (allBands.isEmpty()) return null
    return SheetBuild(allBands, usedWidth, coupeTete = meilleurCoupeTete, zones = zones.size)
}
