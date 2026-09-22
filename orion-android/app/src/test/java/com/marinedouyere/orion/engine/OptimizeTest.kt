package com.marinedouyere.orion.engine

import com.marinedouyere.orion.data.Piece
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OptimizeTest {

    private fun cfg(sheetL: Double, sheetW: Double, kerf: Double = 5.0, timeBudgetMs: Long = 500) = OptimizeConfig(
        sheetL = sheetL, sheetW = sheetW, kerfSL = kerf, kerfST = kerf, timeBudgetMs = timeBudgetMs,
    )

    @Test
    fun `four pieces fit on a single sheet`() {
        val pieces = listOf(Piece(id = 1, name = "P1", L = 480.0, W = 480.0, qty = 4, rotate = true))
        val result = meilleurDesDeuxMoteurs(pieces, cfg(1000.0, 1000.0))

        assertEquals(0, result.unplaced)
        assertEquals(1, result.newSheets)
        assertTrue(result.oversized.isEmpty())
        val placedCount = result.sheets.sumOf { sh -> sh.bands.sumOf { it.items.size } }
        assertEquals(4, placedCount)
        result.sheets.forEach { sh -> sh.bands.forEach { b -> b.items.forEach { assertEquals(1, it.pieceId) } } }
    }

    @Test
    fun `oversized piece is reported and does not crash the engine`() {
        val pieces = listOf(
            Piece(id = 1, name = "Trop grand", L = 2000.0, W = 2000.0, qty = 1, rotate = true),
            Piece(id = 2, name = "Normal", L = 300.0, W = 300.0, qty = 1, rotate = true),
        )
        val result = meilleurDesDeuxMoteurs(pieces, cfg(1000.0, 1000.0))

        assertEquals(1, result.oversized.size)
        assertEquals(1, result.oversized[0].pieceId)
        assertEquals(0, result.unplaced)
        val placedIds = result.sheets.flatMap { sh -> sh.bands.flatMap { b -> b.items.map { it.pieceId } } }
        assertEquals(listOf(2), placedIds)
    }

    @Test
    fun `pieces that only fit one per sheet open multiple sheets`() {
        // 600x600 pieces on a 1000x1000 sheet with 5mm kerf: 2 side by side would need
        // 1205mm, so exactly one fits per sheet -> 5 pieces need 5 sheets.
        val pieces = listOf(Piece(id = 7, name = "Grande", L = 600.0, W = 600.0, qty = 5, rotate = true))
        val result = optimize(pieces, cfg(1000.0, 1000.0, timeBudgetMs = 800))

        assertEquals(0, result.unplaced)
        assertEquals(5, result.newSheets)
        result.sheets.forEach { sh ->
            val count = sh.bands.sumOf { it.items.size }
            assertEquals(1, count)
        }
    }

    @Test
    fun `unrotatable oriented-grain piece is never placed rotated`() {
        val pieces = listOf(Piece(id = 3, name = "Fil oriente", L = 900.0, W = 200.0, qty = 2, rotate = false))
        val result = meilleurDesDeuxMoteurs(pieces, cfg(1000.0, 1000.0))

        assertEquals(0, result.unplaced)
        val items = result.sheets.flatMap { sh -> sh.bands.flatMap { it.items } }
        items.forEach { assertTrue(!it.rotated) }
    }

    @Test
    fun `recoupe engine stacks narrow tall pieces more densely than bands alone`() {
        // Credenza-like pieces: narrow and short, the v3 recoupe engine should be able
        // to stack more than one per column height where plain banding could not.
        val pieces = listOf(Piece(id = 9, name = "Credence", L = 300.0, W = 120.0, qty = 8, rotate = true))
        val v2Only = optimize(pieces, cfg(1000.0, 500.0, timeBudgetMs = 400))
        val best = meilleurDesDeuxMoteurs(pieces, cfg(1000.0, 500.0, timeBudgetMs = 800))

        assertEquals(0, best.unplaced)
        assertTrue(best.newSheets <= v2Only.newSheets)
    }
}
