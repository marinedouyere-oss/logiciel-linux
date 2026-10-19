package fr.antidemarchage.montre

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FiltreNumerosTest {

    private fun motifArcep(numero: String?, masques: Boolean = false) =
        FiltreNumeros.motifBlocage(numero, PrefixesArcep.TOUS, masques)

    @Test
    fun `bloque les prefixes ARCEP quelle que soit la presentation du numero`() {
        assertEquals("0162", motifArcep("0162123456"))
        assertEquals("0162", motifArcep("01 62 12 34 56"))
        assertEquals("0163", motifArcep("+33163123456"))
        assertEquals("0270", motifArcep("+33 2 70 12 34 56"))
        assertEquals("0377", motifArcep("+33 (0)3 77 12 34 56"))
        assertEquals("0424", motifArcep("0033424123456"))
        assertEquals("0568", motifArcep("33568123456"))
        assertEquals("0949", motifArcep("09.49.12.34.56"))
    }

    @Test
    fun `bloque les prefixes ARCEP d'outre-mer`() {
        assertEquals("09475", motifArcep("0947512345"))
        assertEquals("09479", motifArcep("+33947912345"))
        assertNull(motifArcep("0947012345"))
    }

    @Test
    fun `laisse passer les autres numeros`() {
        assertNull(motifArcep("0612345678"))
        assertNull(motifArcep("+33612345678"))
        assertNull(motifArcep("0160123456"))
        assertNull(motifArcep("0937123456"))
        assertNull(motifArcep("+44162123456"))
        assertNull(motifArcep("3179"))
    }

    @Test
    fun `numeros masques bloques seulement si l'option est active`() {
        assertNull(motifArcep(null))
        assertNull(motifArcep(""))
        assertEquals(FiltreNumeros.MOTIF_MASQUE, motifArcep(null, masques = true))
        assertEquals(FiltreNumeros.MOTIF_MASQUE, motifArcep(" ", masques = true))
    }

    @Test
    fun `normalise les prefixes saisis`() {
        assertEquals("0899", FiltreNumeros.normaliserPrefixe("08 99"))
        assertEquals("0899", FiltreNumeros.normaliserPrefixe("+33 899"))
        assertEquals("06", FiltreNumeros.normaliserPrefixe("+33 6"))
        assertEquals("+44", FiltreNumeros.normaliserPrefixe("+44"))
        assertEquals("+44", FiltreNumeros.normaliserPrefixe("0044"))
    }

    @Test
    fun `refuse les prefixes non valides`() {
        assertNull(FiltreNumeros.normaliserPrefixe(""))
        assertNull(FiltreNumeros.normaliserPrefixe("0"))
        assertNull(FiltreNumeros.normaliserPrefixe("+33"))
        assertNull(FiltreNumeros.normaliserPrefixe("zéro huit"))
        assertNull(FiltreNumeros.normaliserPrefixe("08a9"))
    }

    @Test
    fun `bloque les prefixes perso francais et etrangers`() {
        val perso = listOf("0899", "+44")
        assertEquals("0899", FiltreNumeros.motifBlocage("+33899123456", perso, false))
        assertEquals("+44", FiltreNumeros.motifBlocage("+447700900123", perso, false))
        assertEquals("+44", FiltreNumeros.motifBlocage("00447700900123", perso, false))
        assertNull(FiltreNumeros.motifBlocage("0162123456", perso, false))
    }

    @Test
    fun `formate les numeros francais par paires`() {
        assertEquals("01 62 12 34 56", FiltreNumeros.formater("+33162123456"))
        assertEquals("09 47 51 23 45", FiltreNumeros.formater("0947512345"))
        assertEquals("+447700900123", FiltreNumeros.formater("+447700900123"))
    }
}
