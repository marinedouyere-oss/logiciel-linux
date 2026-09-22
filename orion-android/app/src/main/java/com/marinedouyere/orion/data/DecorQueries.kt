package com.marinedouyere.orion.data

/**
 * Decor / grain helpers ported from orion.html's "Décor et sens du fil" section.
 * A piece can only be cut from a panel of the SAME decor, so each decor is
 * optimized separately (see groupByDecor below and the engine's per-group runs).
 *
 * Woodstore's `fil` column is O or N: O = grain oriented (rotation forbidden),
 * N = no grain constraint (free rotation). If that convention is inverted for a
 * given library, fix the Fil column in the Woodstore tab rather than this code.
 */
fun decorRows(woodstore: List<WoodstoreRow>, decor: String?): List<WoodstoreRow> {
    if (decor.isNullOrBlank()) return emptyList()
    val d = decor.trim().uppercase()
    return woodstore.filter { it.mat.isNotBlank() && it.mat.trim().uppercase() == d }
}

/** 'O' (oriented), 'N' (free), or null if the decor is unknown to Woodstore. */
fun grainOf(woodstore: List<WoodstoreRow>, decor: String?): String? {
    val rows = decorRows(woodstore, decor)
    if (rows.isEmpty()) return null
    // If any matching format has an oriented grain, keep the strictest constraint.
    return if (rows.any { it.fil.uppercase() == "O" }) "O" else "N"
}

fun decorFormats(woodstore: List<WoodstoreRow>, decor: String?): List<Pair<Double, Double>> {
    val seen = LinkedHashSet<Pair<Double, Double>>()
    decorRows(woodstore, decor).forEach { seen.add(it.L to it.W) }
    return seen.toList()
}

fun decorFamily(woodstore: List<WoodstoreRow>, decor: String?): String? =
    decorRows(woodstore, decor).firstOrNull()?.fam

/**
 * Groups pieces by decor (pieces without a decor form one group per material,
 * strat/agglo, so they still get calepiné under the right machine profile).
 * Sub-partitioned by finished thickness (`ep`) and cutting plan (`plan`): the
 * recoupe/bande rule below must apply uniformly to a whole batch computed
 * together, hence the extra split.
 */
fun groupByDecor(pieces: List<com.marinedouyere.orion.data.Piece>, currentMaterial: String): LinkedHashMap<String, MutableList<com.marinedouyere.orion.data.Piece>> {
    val groups = LinkedHashMap<String, MutableList<com.marinedouyere.orion.data.Piece>>()
    pieces.forEach { p ->
        val base = if (p.decor.isNotBlank()) p.decor else "__mat__${p.material ?: currentMaterial}"
        val key = "$base::ep=${p.ep ?: ""}::plan=${p.plan ?: ""}"
        groups.getOrPut(key) { mutableListOf() }.add(p)
    }
    return groups
}
