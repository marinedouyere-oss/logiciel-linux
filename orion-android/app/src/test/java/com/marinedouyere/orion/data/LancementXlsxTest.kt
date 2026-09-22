package com.marinedouyere.orion.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LancementXlsxTest {

    private fun nextId(): () -> Int {
        var n = 1
        return { n++ }
    }

    @Test
    fun `unrecognized file returns null`() {
        val rows = listOf(listOf("foo", "bar"), listOf("1", "2"))
        assertNull(parseLancement(rows, nextId()))
    }

    @Test
    fun `one row yields support, face and contrebalancement pieces`() {
        val headers = listOf("longueur", "largeur", "comdet_qte", "agglo", "coloris", "coloris_inf", "conf_epaisseur", "idplan")
        val row = listOf("800", "400", "3", "AGGLO19", "1047", "RCB", "19", "")
        val res = parseLancement(listOf(headers, row), nextId())!!

        assertEquals(3, res.pieces.size)
        assertEquals(setOf("support", "face", "contrebalancement"), res.pieces.map { it.name.split(" ").last() }.toSet())
        res.pieces.forEach {
            assertEquals(800.0, it.L, 0.0)
            assertEquals(400.0, it.W, 0.0)
            assertEquals(3, it.qty)
            assertEquals(19.0, it.ep)
            assertEquals("U", it.plan) // idplan column present but blank -> unitaire
        }
    }

    @Test
    fun `idplan C uses finished dimensions when available`() {
        val headers = listOf("longueur", "largeur", "conf_longueur", "conf_largeur", "coloris", "idplan")
        val row = listOf("820", "420", "800", "400", "1047", "C-CRED")
        val res = parseLancement(listOf(headers, row), nextId())!!

        assertEquals(1, res.pieces.size)
        assertEquals(800.0, res.pieces[0].L, 0.0)
        assertEquals(400.0, res.pieces[0].W, 0.0)
        assertEquals("C", res.pieces[0].plan)
    }

    @Test
    fun `idplan B keeps cut dimensions even if finished dimensions are present`() {
        val headers = listOf("longueur", "largeur", "conf_longueur", "conf_largeur", "coloris", "idplan")
        val row = listOf("820", "420", "800", "400", "1047", "B-BANDE")
        val res = parseLancement(listOf(headers, row), nextId())!!

        assertEquals(820.0, res.pieces[0].L, 0.0)
        assertEquals(420.0, res.pieces[0].W, 0.0)
        assertEquals("B", res.pieces[0].plan)
    }

    @Test
    fun `rows missing both dimensions are silently skipped, partial ones are counted ignored`() {
        // Matches the source exactly: a present-but-empty-string cell is still
        // "!= null" in JS, so only a genuinely absent cell (short row) skips the
        // ignored-count increment — an empty string does not.
        val headers = listOf("longueur", "largeur", "coloris")
        val rows = listOf(
            headers,
            emptyList(), // no cells at all: both indices out of range -> not "ignored"
            listOf("500", "", "1047"), // partial: counted as ignored
            listOf("500", "300", "1047"), // valid
        )
        val res = parseLancement(rows, nextId())!!
        assertEquals(1, res.pieces.size)
        assertEquals(1, res.ignoredRows)
    }

    @Test
    fun `lenient numeric parsing tolerates trailing text like JS parseFloat`() {
        val headers = listOf("longueur", "largeur", "coloris")
        val rows = listOf(headers, listOf("500 mm", "300", "1047"))
        val res = parseLancement(rows, nextId())!!
        assertEquals(1, res.pieces.size)
        assertEquals(500.0, res.pieces[0].L, 0.0)
        assertTrue(res.pieces[0].rotate)
    }
}
