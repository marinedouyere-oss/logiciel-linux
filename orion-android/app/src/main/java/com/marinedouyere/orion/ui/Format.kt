package com.marinedouyere.orion.ui

/** Formats a millimeter dimension without a trailing ".0" for whole numbers, but keeps decimals (e.g. laminate "0.8"). */
fun formatMm(v: Double): String = if (v == Math.floor(v) && !v.isInfinite()) v.toLong().toString() else v.toString()
