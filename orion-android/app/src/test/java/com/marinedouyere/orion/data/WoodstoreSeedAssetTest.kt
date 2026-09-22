package com.marinedouyere.orion.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Reads the ACTUAL bundled asset file straight off disk (the same bytes AGP
 * packages into app/src/main/assets/woodstore_base.json) and runs it through
 * the real parseWoodstoreRows() — diagnosing a report that Woodstore shows
 * empty on a fresh install by ruling in/out "the seed data itself doesn't
 * parse". Uses a real org.json impl (testImplementation) since the Android
 * SDK's own org.json classes are stub-only outside instrumented tests.
 */
class WoodstoreSeedAssetTest {

    private fun findAssetFile(): File {
        var dir = File("").absoluteFile
        repeat(6) {
            val candidate = File(dir, "app/src/main/assets/woodstore_base.json")
            if (candidate.exists()) return candidate
            dir = dir.parentFile ?: return@repeat
        }
        error("Could not locate app/src/main/assets/woodstore_base.json from ${File("").absolutePath}")
    }

    @Test
    fun `bundled seed asset parses to 619 rows with real org-json`() {
        val file = findAssetFile()
        val json = file.readText(Charsets.UTF_8)
        val rows = parseWoodstoreRows(json)

        assertEquals(619, rows.size)
        assertTrue(rows.all { it.id.isNotBlank() })
        assertTrue(rows.all { it.L > 0.0 && it.W > 0.0 })
        val fams = rows.map { it.fam }.toSet()
        assertTrue(fams.contains("strat"))
        assertTrue(fams.contains("agglo"))
    }

    @Test
    fun `round trip through woodstoreRowsToJson preserves row count`() {
        val file = findAssetFile()
        val rows = parseWoodstoreRows(file.readText(Charsets.UTF_8))
        val again = parseWoodstoreRows(woodstoreRowsToJson(rows))
        assertEquals(rows.size, again.size)
        assertEquals(rows.first(), again.first())
    }
}
