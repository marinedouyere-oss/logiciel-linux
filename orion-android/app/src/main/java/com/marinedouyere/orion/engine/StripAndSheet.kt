package com.marinedouyere.orion.engine

import kotlin.math.ceil

/** One piece placed inside a band, at offset `x` along it (and `dy` within a recoupe column, v3 only). */
internal data class StripItem(val di: Int, val w: Double, val h: Double, val rotated: Boolean, val x: Double, val dy: Double = 0.0)

/** A filled band/strip, `y` is its offset across the sheet's width once placed (0 until then). */
internal data class StripResult(
    val items: List<StripItem>,
    val area: Double,
    val usedLen: Double,
    val height: Double,
    val counts: Map<Int, Int>,
    val y: Double = 0.0,
    val recoupes: Int = 0,
)

/** `coupeTete`/`zones` are only ever non-default for buildSheet3's output (head-cut splits); v2's buildSheet leaves them at defaults. */
internal data class SheetBuild(val bands: List<StripResult>, val usedWidth: Double, val coupeTete: Double? = null, val zones: Int = 1)

/**
 * Resolves demand-index-based bands into the public CutSheet/CutBand/CutItem
 * shape (pieceId/name/pieceL/pieceW attached). Equivalent to the normalization
 * pass at the end of optimize()/optimize3() in orion.html, just applied per
 * sheet as it's built instead of once at the very end.
 */
internal fun SheetBuild.toCutSheet(
    sheetL: Double,
    sheetW: Double,
    demand: List<Demand>,
    fromChute: Boolean,
    parentSheetIndex: Int? = null,
): CutSheet = CutSheet(
    L = sheetL,
    W = sheetW,
    bands = bands.map { b ->
        CutBand(
            height = b.height,
            usedLen = b.usedLen,
            area = b.area,
            y = b.y,
            recoupes = b.recoupes,
            items = b.items.map { it ->
                val d = demand[it.di]
                CutItem(d.pieceId, d.name, d.L, d.W, it.w, it.h, it.rotated, it.x, it.dy)
            },
        )
    },
    usedWidth = usedWidth,
    fromChute = fromChute,
    parentSheetIndex = parentSheetIndex,
    coupeTete = coupeTete,
    zones = zones,
)

/**
 * Bounded knapsack: fills one band of the given `height` over `maxLen`.
 * Port of fillStrip() in orion.html.
 */
internal fun fillStrip(
    demand: List<Demand>,
    height: Double,
    maxLen: Double,
    kerf: Double,
    step: Double,
    weightFn: (PlacementCandidate) -> Double,
    maxBandWaste: Double = Double.POSITIVE_INFINITY,
): StripResult? {
    val cands = mutableListOf<PlacementCandidate>()
    demand.forEachIndexed { di, d ->
        if (d.left <= 0) return@forEachIndexed
        orientationsOf(d).forEach { o ->
            if (o.h <= height + 1e-6 && (height - o.h) <= maxBandWaste + 1e-6 && o.w <= maxLen + 1e-6) {
                cands.add(PlacementCandidate(di, o.w, o.h, o.rotated, o.w * o.h))
            }
        }
    }
    if (cands.isEmpty()) return null

    val n = cands.size
    val cap = ceil((maxLen + kerf) / step).toInt()
    val cost = IntArray(n) { i -> maxOf(1, ceil((cands[i].w + kerf) / step).toInt()) }
    val value = DoubleArray(n) { i -> weightFn(cands[i]) }
    val maxK = IntArray(n) { i -> demand[cands[i].di].left }
    val used = boundedKnapsack(cap, cost, value, maxK) ?: return null

    // respecter le stock réel par pièce (orientations cumulées)
    val perPiece = HashMap<Int, Int>()
    val picked = mutableListOf<PlacementCandidate>()
    for (i in 0 until n) {
        for (k in 0 until used[i]) {
            val di = cands[i].di
            val c = (perPiece[di] ?: 0) + 1
            if (c > demand[di].left) {
                perPiece[di] = c - 1
                continue
            }
            perPiece[di] = c
            picked.add(cands[i])
        }
    }
    if (picked.isEmpty()) return null

    // placement réel, pièces les plus hautes en premier
    val sortedPicked = picked.sortedByDescending { it.h }
    val items = mutableListOf<StripItem>()
    var x = 0.0
    var area = 0.0
    for (p in sortedPicked) {
        val need = if (items.isNotEmpty()) kerf + p.w else p.w
        if (x + need > maxLen + 1e-6) continue
        if (items.isNotEmpty()) x += kerf
        items.add(StripItem(p.di, p.w, p.h, p.rotated, x))
        x += p.w
        area += p.w * p.h
    }
    if (items.isEmpty()) return null
    val counts = HashMap<Int, Int>()
    items.forEach { counts[it.di] = (counts[it.di] ?: 0) + 1 }
    return StripResult(items, area, x, height, counts)
}

private data class BandCandidate(val strip: StripResult, val rep: Int, val value: Double)

/**
 * Builds one full sheet: generates candidate bands per height (mixed DP fill +
 * homogeneous single-piece bands), then a second bounded knapsack picks the
 * best combination of bands across the sheet's width.
 * Port of buildSheet() in orion.html.
 */
internal fun buildSheet(
    demand: List<Demand>,
    sheetL: Double,
    sheetW: Double,
    kerfSL: Double,
    kerfST: Double,
    step: Double,
    strategy: Strategy,
    ctx: OptimizeContext?,
    maxBandWaste: Double = Double.POSITIVE_INFINITY,
): SheetBuild? {
    val heights = LinkedHashSet<Double>()
    demand.forEach { d ->
        if (d.left <= 0) return@forEach
        orientationsOf(d).forEach { o ->
            if (o.h <= sheetW + 1e-6 && o.w <= sheetL + 1e-6) heights.add(o.h)
        }
    }
    if (heights.isEmpty()) return null

    val wf: (PlacementCandidate) -> Double = { c -> strategy.weight(c) * priceOf(ctx, c.di) }
    fun valueOf(strip: StripResult, h: Double, sheetLen: Double): Double {
        var v = 0.0
        strip.items.forEach { v += it.w * it.h * priceOf(ctx, it.di) }
        return if (strategy.densityBonus) v * (strip.area / (h * sheetLen)) else v
    }

    val cand = mutableListOf<BandCandidate>()
    val seen = HashSet<String>()
    fun addCand(strip: StripResult?) {
        if (strip == null || strip.items.isEmpty()) return
        val sig = "${strip.height}|" + strip.items.map { "${it.di}:${it.w}x${it.h}" }.sorted().joinToString(",")
        if (!seen.add(sig)) return
        var rep = Int.MAX_VALUE
        strip.counts.forEach { (di, count) -> rep = minOf(rep, demand[di].left / count) }
        if (rep <= 0) return
        cand.add(BandCandidate(strip, rep, valueOf(strip, strip.height, sheetL)))
    }

    for (h in heights) {
        // a) bande mixte optimisée
        addCand(fillStrip(demand, h, sheetL, kerfST, step, wf, maxBandWaste))
        // b) bandes homogènes : une seule pièce répétée
        demand.forEachIndexed { di, d ->
            if (d.left <= 0) return@forEachIndexed
            orientationsOf(d).forEach { o ->
                if (o.h > h + 1e-6 || (h - o.h) > maxBandWaste + 1e-6 || o.w > sheetL + 1e-6) return@forEach
                val nMax = minOf(d.left, ((sheetL + kerfST) / (o.w + kerfST)).toInt())
                if (nMax < 1) return@forEach
                val items = mutableListOf<StripItem>()
                var x = 0.0
                for (k in 0 until nMax) {
                    if (k != 0) x += kerfST
                    items.add(StripItem(di, o.w, o.h, o.rotated, x))
                    x += o.w
                }
                addCand(StripResult(items, items.size * o.w * o.h, x, h, mapOf(di to items.size)))
            }
        }
    }
    if (cand.isEmpty()) return null

    // --- niveau 2 : sac à dos borné sur la largeur ---
    val cap = ceil((sheetW + kerfSL) / step).toInt()
    val cost = IntArray(cand.size) { i -> maxOf(1, ceil((cand[i].strip.height + kerfSL) / step).toInt()) }
    val value = DoubleArray(cand.size) { i -> cand[i].value }
    val maxCount = IntArray(cand.size) { i -> cand[i].rep }
    val used = boundedKnapsack(cap, cost, value, maxCount) ?: return null

    val plan = mutableListOf<BandCandidate>()
    for (i in cand.indices) repeat(used[i]) { plan.add(cand[i]) }
    if (plan.isEmpty()) return null
    val sortedPlan = plan.sortedByDescending { it.strip.height }

    // --- matérialisation contre le stock réel ---
    val bands = mutableListOf<StripResult>()
    var usedW = 0.0
    for (p in sortedPlan) {
        val remW = sheetW - usedW - (if (bands.isNotEmpty()) kerfSL else 0.0)
        if (p.strip.height > remW + 1e-6) continue
        val ok = p.strip.counts.all { (di, count) -> demand[di].left >= count }
        var strip = if (ok) p.strip else (fillStrip(demand, p.strip.height, sheetL, kerfST, step, wf, maxBandWaste) ?: continue)
        strip.items.forEach { demand[it.di].left-- }
        val y = usedW + (if (bands.isNotEmpty()) kerfSL else 0.0)
        strip = strip.copy(y = y)
        usedW = y + strip.height
        bands.add(strip)
    }

    // --- combler la largeur restante ---
    var guard = 0
    while (guard++ < 60) {
        val remW = sheetW - usedW - (if (bands.isNotEmpty()) kerfSL else 0.0)
        if (remW <= 0) break
        val hsFit = heights.filter { it <= remW + 1e-6 }
        if (hsFit.isEmpty()) break
        var bestStrip: StripResult? = null
        var bestScore = -1.0
        for (h in hsFit) {
            val s = fillStrip(demand, h, sheetL, kerfST, step, wf, maxBandWaste) ?: continue
            val sc = s.area / (h * sheetL)
            if (sc > bestScore) {
                bestScore = sc
                bestStrip = s
            }
        }
        val chosen = bestStrip ?: break
        chosen.items.forEach { demand[it.di].left-- }
        val y = usedW + (if (bands.isNotEmpty()) kerfSL else 0.0)
        val placed = chosen.copy(y = y)
        usedW = y + placed.height
        bands.add(placed)
    }

    if (bands.isEmpty()) return null
    return SheetBuild(bands, usedW)
}
