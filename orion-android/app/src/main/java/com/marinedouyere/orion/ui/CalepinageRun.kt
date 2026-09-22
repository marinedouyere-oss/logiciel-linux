package com.marinedouyere.orion.ui

import com.marinedouyere.orion.data.Piece
import com.marinedouyere.orion.engine.BestFormatResult
import com.marinedouyere.orion.engine.OptimizeResult

/** Machine bounds used for the post-compute warnings, mirrors the `mat` object built in the computeBtn handler. */
data class MachineBounds(
    val maxSawLength: Double,
    val panelLenMin: Double?,
    val panelLenMax: Double?,
    val panelWMin: Double?,
    val panelWMax: Double?,
    val pieceLenMin: Double?,
    val pieceLenMax: Double?,
    val pieceWMin: Double?,
    val pieceWMax: Double?,
    val minPieceLenBand: Double,
    val minChuteL: Double,
    val minChuteW: Double,
    val minChuteArea: Double,
)

/** One decor/material group's compute outcome, mirrors an entry of `runs` in orion.html. */
data class CalepinageRun(
    val decor: String,
    val material: String?,
    val grain: String?,
    val fam: String?,
    val profileKey: String,
    val result: OptimizeResult,
    val compare: BestFormatResult?,
    val usedL: Double,
    val usedW: Double,
    val trimLong: Double,
    val trimTrans: Double,
    val mat: MachineBounds,
    val pieces: List<Piece>,
    val forcedNoRotation: Boolean,
    val unknownDecor: Boolean,
    val ep: Double?,
    val plan: String?,
    val recoupePossible: Boolean,
    val maxBandWaste: Double,
)
