package com.marinedouyere.orion.xlsx

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class XlsxRoundTripTest {

    @Test
    fun `writes and reads back headers and rows`() {
        val headers = listOf("Code article", "Longueur (mm)", "Description", "Fil")
        val rows = listOf(
            listOf("AGGLO-19-4", 4200, "Aggloméré 19 mm — brut", "N"),
            listOf("1047_4100_2060", 4100.5, "STRAT H1180 ST37 CHÊNE HALIFAX", "O"),
            listOf("EMPTY-CELL", null, "", "N"),
        )

        val out = ByteArrayOutputStream()
        XlsxWriter.writeSheet(out, headers, rows)

        val readBack = XlsxReader.readFirstSheet(ByteArrayInputStream(out.toByteArray()))

        assertEquals(4, readBack.size)
        assertEquals(headers, readBack[0])
        assertEquals(listOf("AGGLO-19-4", "4200", "Aggloméré 19 mm — brut", "N"), readBack[1])
        assertEquals(listOf("1047_4100_2060", "4100.5", "STRAT H1180 ST37 CHÊNE HALIFAX", "O"), readBack[2])
        assertEquals("EMPTY-CELL", readBack[3][0])
    }

    @Test
    fun `handles special xml characters and sparse-ish rows`() {
        val headers = listOf("id", "desc")
        val rows = listOf(listOf("A&B", "Tilt <45°> \"quoted\" 'it's'"))

        val out = ByteArrayOutputStream()
        XlsxWriter.writeSheet(out, headers, rows)
        val readBack = XlsxReader.readFirstSheet(ByteArrayInputStream(out.toByteArray()))

        assertEquals("A&B", readBack[1][0])
        assertEquals("Tilt <45°> \"quoted\" 'it's'", readBack[1][1])
    }
}
