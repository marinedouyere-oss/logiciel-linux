package com.marinedouyere.orion.data

/**
 * One line of the "Pièces à découper" table. Mirrors the JS `pieces` array
 * entries pushed by the add-piece form, the generic .xlsx import (rowsToPieces)
 * and the "lancement" batch import (parseLancement) in orion.html.
 *
 * `plan` carries the idPlan-derived cutting technique for a lancement row:
 * "C" (Modulo/crédence, recoupe allowed if thin enough), "B" (bande, no recoupe),
 * "U" (unitaire, no recoupe), or null when unknown (falls back to ep-only rule).
 */
data class Piece(
    val id: Int,
    val name: String,
    val L: Double,
    val W: Double,
    val qty: Int,
    val rotate: Boolean,
    val decor: String = "",
    val material: String? = null,
    val fmtL: Double? = null,
    val fmtW: Double? = null,
    val ep: Double? = null,
    val plan: String? = null,
)
