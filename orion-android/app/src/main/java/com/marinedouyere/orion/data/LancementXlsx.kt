package com.marinedouyere.orion.data

data class LancementImportResult(val pieces: List<Piece>, val ignoredRows: Int)

/**
 * A "lancement" (production batch) row yields up to THREE pieces to cut, in
 * three different materials: the substrate (support), the face laminate
 * (coloris) and the counter-balance laminate (coloris_inf) — each in its own
 * decor, so the optimizer keeps them separate. Port of parseLancement() in
 * orion.html.
 *
 * Uses cut dimensions (longueur/largeur) rather than finished dimensions
 * (conf_longueur/conf_largeur), UNLESS idplan marks the row as Modulo/
 * crédence ("C..."), which cuts to the finished size instead.
 *
 * Returns null if the file has no recognizable longueur/largeur columns at
 * all (caller should report the file as unreadable, not just empty).
 */
fun parseLancement(rows: List<List<String>>, nextId: () -> Int): LancementImportResult? {
    if (rows.size < 2) return LancementImportResult(emptyList(), 0)
    val headers = rows[0].map { it.lowercase().trim().replace("\\", "") }

    fun col(vararg names: String): Int {
        for (n in names) {
            val i = headers.indexOf(n)
            if (i >= 0) return i
        }
        for (n in names) {
            val i = headers.indexOfFirst { h -> h.contains(n) }
            if (i >= 0) return i
        }
        return -1
    }

    val iL = col("longueur")
    val iW = col("largeur")
    val iLf = col("conf_longueur")
    val iWf = col("conf_largeur")
    val iQte = col("comdet_qte", "qte", "quantite")
    val iAgg = col("agglo")
    val iCol = col("coloris")
    val iInf = col("coloris_inf")
    val iEp = col("conf_epaisseur", "epaisseur")
    val iCmd = col("conf_commande", "commande")
    val iLig = col("conf_ligne", "ligne")
    val iArt = col("conf_article", "article")
    val iPlan = col("idplan")

    if (iL < 0 || iW < 0) return null

    fun cell(row: List<String>, idx: Int): String? = if (idx in row.indices) row[idx] else null
    fun cellOrBlank(row: List<String>, idx: Int): String = cell(row, idx)?.trim().orEmpty()

    val out = mutableListOf<Piece>()
    var ignorees = 0

    for (i in 1 until rows.size) {
        val c = rows[i]

        // idPlan indicates the cutting technique production wants:
        //  "C..." = crédence/Modulo (stack + recoupe, cut to FINISHED size)
        //  "B..." = classic band (cut to cut-size, with extra thickness)
        //  column present but blank = unitary (no recoupe, classic cut)
        //  column absent entirely = unknown (falls back to thickness alone)
        var plan: String? = null
        if (iPlan >= 0) {
            val raw = cellOrBlank(c, iPlan).uppercase()
            plan = when {
                raw.isEmpty() -> "U"
                raw.startsWith("C") -> "C"
                raw.startsWith("B") -> "B"
                else -> raw
            }
        }

        // Dimension to cut: finished size for Modulo (if provided), else cut size.
        var l = jsParseFloat(cell(c, iL))
        var w = jsParseFloat(cell(c, iW))
        if (plan == "C" && iLf >= 0 && iWf >= 0) {
            val lf = jsParseFloat(cell(c, iLf))
            val wf = jsParseFloat(cell(c, iWf))
            if (lf != null && lf != 0.0 && wf != null && wf != 0.0) {
                l = lf
                w = wf
            }
        }
        if (l == null || l == 0.0 || w == null || w == 0.0) {
            if (cell(c, iL) != null || cell(c, iW) != null) ignorees++
            continue
        }
        val pieceL: Double = l
        val pieceW: Double = w

        val qte = if (iQte >= 0) (jsParseInt(cell(c, iQte))?.takeUnless { it == 0 } ?: 1) else 1
        val ep = if (iEp >= 0) jsParseFloat(cell(c, iEp))?.takeUnless { it == 0.0 } else null
        val art = if (iArt >= 0) cellOrBlank(c, iArt).ifEmpty { "Pièce" } else "Pièce"
        val cmd = if (iCmd >= 0) cellOrBlank(c, iCmd) else ""
        val lig = if (iLig >= 0) cellOrBlank(c, iLig) else ""
        val ref = cmd + (if (lig.isNotEmpty()) "-$lig" else "")

        fun ajoute(decor: String?, role: String) {
            val d = decor?.trim().orEmpty()
            if (d.isEmpty()) return
            out.add(
                Piece(
                    id = nextId(),
                    name = "$art $role" + (if (ref.isNotEmpty()) " ($ref)" else ""),
                    L = pieceL, W = pieceW, qty = qte, rotate = true, decor = d, ep = ep, plan = plan,
                ),
            )
        }
        ajoute(if (iAgg >= 0) cell(c, iAgg) else null, "support")
        ajoute(if (iCol >= 0) cell(c, iCol) else null, "face")
        // The source's contrebalancement branch duplicates its own else-branch
        // exactly (both add the piece regardless of whether inf equals the face
        // color), so this collapses to one unconditional non-blank check on inf.
        val inf = if (iInf >= 0) cell(c, iInf) else null
        if (!inf.isNullOrBlank()) ajoute(inf, "contrebalancement")
    }
    return LancementImportResult(out, ignorees)
}
