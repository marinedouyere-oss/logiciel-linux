package com.marinedouyere.orion.data

import android.content.Context
import java.io.File

private const val SAVE_FILE = "orion_woodstore.json"
private const val SEED_ASSET = "woodstore_base.json"

/**
 * Loads/saves the Woodstore library. Mirrors localStorage('orion_woodstore')
 * in orion.html: on first run (or if the saved file is missing/corrupt), the
 * bundled seed asset (WOODSTORE_BASE, 619 references) is used instead.
 */
object WoodstoreRepository {

    fun loadSeed(context: Context): List<WoodstoreRow> {
        val json = context.assets.open(SEED_ASSET).bufferedReader(Charsets.UTF_8).use { it.readText() }
        return parseWoodstoreRows(json)
    }

    fun load(context: Context): List<WoodstoreRow> {
        val file = File(context.filesDir, SAVE_FILE)
        if (!file.exists()) return loadSeed(context)
        return try {
            parseWoodstoreRows(file.readText(Charsets.UTF_8))
        } catch (e: Exception) {
            loadSeed(context)
        }
    }

    fun save(context: Context, rows: List<WoodstoreRow>) {
        val file = File(context.filesDir, SAVE_FILE)
        file.writeText(woodstoreRowsToJson(rows), Charsets.UTF_8)
    }
}
