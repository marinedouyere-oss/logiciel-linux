package com.marinedouyere.orion.engine

import kotlin.math.abs
import kotlin.math.ceil

/** A vertical stack of pieces of the same width `w`, to be recoupée (cross-cut) apart. */
internal data class ColumnResult(val w: Double, val items: List<StripItem>, val area: Double, val usedH: Double, val nb: Int)

/**
 * Best column (stack) of width `w` within an available height `maxH`: pieces are
 * stacked and later recoupées apart, exactly like the saw's longitudinal ->
 * transversal -> recoupe sequence. Port of bestColumn3() in orion.html.
 *
 * The original threads a `used` per-demand-index array through this function,
 * but every caller constructs it fresh as all-zeros and never mutates it before
 * calling in, so `d.left - (used[di] || 0)` always equals `d.left`; that dead
 * parameter is dropped here.
 */
internal fun bestColumn3(
    demand: List<Demand>,
    w: Double,
    maxH: Double,
    kerf: Double,
    step: Double,
    weightFn: (PlacementCandidate) -> Double,
): ColumnResult? {
    val cands = mutableListOf<PlacementCandidate>()
    val maxByCand = mutableListOf<Int>()
    demand.forEachIndexed { di, d ->
        val dispo = d.left
        if (dispo <= 0) return@forEachIndexed
        orientationsOf(d).forEach { o ->
            if (abs(o.w - w) < 0.51 && o.h <= maxH + 1e-6) {
                cands.add(PlacementCandidate(di, o.w, o.h, o.rotated, o.w * o.h))
                maxByCand.add(dispo)
            }
        }
    }
    if (cands.isEmpty()) return null

    val n = cands.size
    val cap = ceil((maxH + kerf) / step).toInt()
    val cost = IntArray(n) { i -> maxOf(1, ceil((cands[i].h + kerf) / step).toInt()) }
    val value = DoubleArray(n) { i -> weightFn(cands[i]) }
    val maxCount = IntArray(n) { i -> maxByCand[i] }
    val used = boundedKnapsack(cap, cost, value, maxCount) ?: return null

    val picked = mutableListOf<PlacementCandidate>()
    for (i in 0 until n) repeat(used[i]) { picked.add(cands[i]) }
    if (picked.isEmpty()) return null

    val sortedPicked = picked.sortedByDescending { it.h }
    val items = mutableListOf<StripItem>()
    var y = 0.0
    var area = 0.0
    for (p in sortedPicked) {
        val need = if (items.isNotEmpty()) kerf + p.h else p.h
        if (y + need > maxH + 1e-6) continue
        if (items.isNotEmpty()) y += kerf
        items.add(StripItem(p.di, p.w, p.h, p.rotated, x = 0.0, dy = y))
        y += p.h
        area += p.w * p.h
    }
    if (items.isEmpty()) return null
    return ColumnResult(w, items, area, y, items.size)
}
