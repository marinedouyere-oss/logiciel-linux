package com.marinedouyere.orion.engine

import com.marinedouyere.orion.data.Piece
import kotlin.random.Random

/**
 * Mutable per-piece stock counter used while an optimization run consumes
 * pieces onto sheets. Ports the JS `demand` entries built by buildUnits/
 * buildUnits3 (both identical in the original — merged here into one).
 */
internal class Demand(
    val pieceId: Int,
    val name: String,
    val L: Double,
    val W: Double,
    val rotate: Boolean,
    var left: Int,
)

internal data class Orientation(val w: Double, val h: Double, val rotated: Boolean)

internal fun buildUnits(pieces: List<Piece>): List<Demand> =
    pieces.map { Demand(it.id, it.name, it.L, it.W, it.rotate, it.qty) }

internal fun orientationsOf(d: Demand): List<Orientation> {
    val list = mutableListOf(Orientation(d.L, d.W, false))
    if (d.rotate && d.L != d.W) list.add(Orientation(d.W, d.L, true))
    return list
}

/** A piece placed somewhere (in a band or a recoupe column) during search. */
internal data class PlacementCandidate(val di: Int, val w: Double, val h: Double, val rotated: Boolean, val area: Double)

internal data class Strategy(val name: String, val alpha: Double, val densityBonus: Boolean, val weight: (PlacementCandidate) -> Double)

/** Per-demand-index scarcity price (`ctx.price` in the original) plus a bookkeeping hint. */
internal data class OptimizeContext(val price: DoubleArray?, val sheetsLeft: Int)

internal fun priceOf(ctx: OptimizeContext?, di: Int): Double = ctx?.price?.get(di) ?: 1.0

// alpha = intensité du prix de rareté (0 = aucun, plus haut = plus marqué)
internal val STRATEGIES: List<Strategy> = buildList {
    for (alpha in listOf(0.0, 0.5, 1.0, 2.0, 4.0)) {
        add(Strategy("aire α$alpha", alpha, false) { c -> c.area })
        add(Strategy("densité α$alpha", alpha, true) { c -> c.area })
    }
    add(Strategy("longueur α2", 2.0, false) { c -> c.w })
    add(Strategy("compact α2", 2.0, false) { c -> c.area - 0.015 * c.w * c.w })
}

internal val STRATEGIES3: List<Strategy> = buildList {
    for (alpha in listOf(0.0, 1.0, 2.0, 4.0)) {
        add(Strategy("aire α$alpha", alpha, false) { c -> c.area })
        add(Strategy("densité α$alpha", alpha, true) { c -> c.area })
    }
}

/** Extra randomized-restart strategies optimize() adds on top of STRATEGIES. */
internal fun randomStrategy(): Strategy {
    val alpha = Math.round(Random.nextDouble() * 600) / 100.0 // alpha 0 -> 6
    val densityBonus = Random.nextDouble() < 0.5
    return Strategy("aléatoire α$alpha", alpha, densityBonus) { c -> c.area }
}

/**
 * Bounded knapsack with exact reconstruction, shared by fillStrip, buildSheet,
 * bestColumn3, fillStrip3 and buildZone3 in the original app (all use this same
 * DP shape: candidates with a per-unit cost/value/stock-bound, filled into a
 * discretized capacity). Every call site in orion.html re-sorts its own output
 * immediately after reconstruction, so the traversal order used here (forward
 * fill, backward reconstruct — the only order that is actually correct for this
 * DP) is safe to share verbatim.
 */
internal fun boundedKnapsack(cap: Int, cost: IntArray, value: DoubleArray, maxCount: IntArray): IntArray? {
    val n = cost.size
    var prev = DoubleArray(cap + 1)
    val take = Array(n) { IntArray(cap + 1) }
    for (i in 0 until n) {
        val cur = DoubleArray(cap + 1)
        val ti = take[i]
        val ci = cost[i]
        val vi = value[i]
        val mi = maxCount[i]
        for (c in 0..cap) {
            var bestV = prev[c]
            var bestK = 0
            val kMax = minOf(mi, c / ci)
            var k = 1
            while (k <= kMax) {
                val v = prev[c - k * ci] + k * vi
                if (v > bestV + 1e-9) {
                    bestV = v
                    bestK = k
                }
                k++
            }
            cur[c] = bestV
            ti[c] = bestK
        }
        prev = cur
    }
    if (prev[cap] <= 0) return null
    val used = IntArray(n)
    var c = cap
    for (i in n - 1 downTo 0) {
        val k = take[i][c]
        used[i] = k
        c -= k * cost[i]
    }
    return used
}
