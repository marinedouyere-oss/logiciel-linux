package com.marinedouyere.orion.data

import com.marinedouyere.orion.xlsx.XlsxReader
import com.marinedouyere.orion.xlsx.XlsxWriter
import java.io.InputStream
import java.io.OutputStream

private val WOODSTORE_EXPORT_HEADERS = listOf(
    "Code article", "Code matière", "Longueur (mm)", "Largeur (mm)", "Epaisseur (mm)",
    "Catégorie", "Fil (O/N)", "Groupe", "Description", "Type", "Flag fin", "Famille",
)

/** Port of the "Exporter en Excel" handler in the Woodstore tab. */
fun exportWoodstoreXlsx(output: OutputStream, woodstore: List<WoodstoreRow>) {
    val rows = woodstore.map { r -> listOf(r.id, r.mat, r.L, r.W, r.ep, r.cat, r.fil, r.grp, r.desc, r.type, r.flag, r.fam) }
    XlsxWriter.writeSheet(output, WOODSTORE_EXPORT_HEADERS, rows, sheetName = "Woodstore")
}

/**
 * Positional import matching this app's own export layout (id, mat, L, W, ep,
 * cat, fil, grp, desc, type, flag, fam). Skips a detected header row by
 * scanning the first 5 rows for one that mentions both "code" and "long".
 * Port of the wsXlsxInput change handler in orion.html.
 */
fun importWoodstoreXlsx(input: InputStream): List<WoodstoreRow> {
    val rows = XlsxReader.readFirstSheet(input)
    var start = 0
    for (i in 0 until minOf(5, rows.size)) {
        val joined = rows.getOrNull(i).orEmpty().joinToString(" ").lowercase()
        if (joined.contains("code") && joined.contains("long")) {
            start = i + 1
            break
        }
    }
    fun cell(row: List<String>, idx: Int): String? = if (idx in row.indices) row[idx] else null

    val imported = mutableListOf<WoodstoreRow>()
    for (i in start until rows.size) {
        val c = rows[i]
        val id = cell(c, 0)?.trim().orEmpty()
        if (id.isEmpty()) continue
        val L = jsParseFloat(cell(c, 2))
        val W = jsParseFloat(cell(c, 3))
        if (L == null || L == 0.0 || W == null || W == 0.0) continue
        imported.add(
            WoodstoreRow(
                id = id,
                mat = cell(c, 1)?.trim().orEmpty(),
                L = L,
                W = W,
                ep = jsParseFloat(cell(c, 4))?.takeUnless { it == 0.0 },
                cat = cell(c, 5)?.trim().orEmpty(),
                fil = cell(c, 6)?.trim().orEmpty(),
                grp = cell(c, 7)?.trim().orEmpty(),
                desc = cell(c, 8)?.trim().orEmpty(),
                type = cell(c, 9)?.trim().orEmpty(),
                flag = cell(c, 10)?.trim().orEmpty(),
                fam = cell(c, 11)?.trim()?.lowercase().takeUnless { it.isNullOrEmpty() } ?: "autre",
            ),
        )
    }
    return imported
}
