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

data class DecorOption(val code: String, val L: Double, val W: Double, val desc: String, val fil: String)

/**
 * Distinct decor codes across the whole library (not filtered by material),
 * for the "Décor / matière" picker. L/W/desc come from each code's FIRST
 * matching row; `fil` is OR'd across all matching rows toward "O" (oriented
 * grain wins). Port of fillDecorList() in orion.html.
 */
fun decorList(woodstore: List<WoodstoreRow>): List<DecorOption> {
    data class Acc(val L: Double, val W: Double, val desc: String, var fil: String?)
    val mats = LinkedHashMap<String, Acc>()
    woodstore.forEach { r ->
        if (r.mat.isBlank()) return@forEach
        val acc = mats.getOrPut(r.mat) { Acc(r.L, r.W, r.desc, null) }
        if (r.fil.uppercase() == "O") acc.fil = "O" else if (acc.fil == null) acc.fil = "N"
    }
    return mats.entries
        .map { (code, acc) -> DecorOption(code, acc.L, acc.W, acc.desc, acc.fil ?: "N") }
        .sortedBy { it.code }
}

data class FormatOption(val L: Double, val W: Double, val count: Int)

/**
 * Stock panel formats available in Woodstore for a machine profile ("strat"/
 * "agglo"), most common first. Port of fillStockFormats() in orion.html.
 */
fun stockFormatOptions(woodstore: List<WoodstoreRow>, material: String): List<FormatOption> {
    val list = woodstore.filter { FAM_PROFILE[it.fam] == material }
    val uniq = LinkedHashMap<String, FormatOption>()
    list.forEach { r ->
        val key = "${r.L}x${r.W}"
        val cur = uniq[key]
        uniq[key] = if (cur == null) FormatOption(r.L, r.W, 1) else cur.copy(count = cur.count + 1)
    }
    return uniq.values.sortedWith(compareByDescending<FormatOption> { it.count }.thenByDescending { it.L * it.W })
}

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
