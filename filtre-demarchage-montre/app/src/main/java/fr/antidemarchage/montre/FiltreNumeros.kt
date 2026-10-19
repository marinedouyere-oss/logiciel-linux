package fr.antidemarchage.montre

/**
 * Préfixes que l'ARCEP réserve aux systèmes automatisés d'appel (plateformes de
 * démarchage), décision n° 2022-1583 en vigueur depuis le 1er janvier 2023.
 * C'est la liste que bloque Prefixtel.
 */
object PrefixesArcep {
    val METROPOLE = listOf(
        "0162", "0163", "0270", "0271", "0377", "0378",
        "0424", "0425", "0568", "0569", "0948", "0949",
    )

    val OUTRE_MER = mapOf(
        "09475" to "Guadeloupe, St-Martin, St-Barth",
        "09476" to "Guyane",
        "09477" to "Martinique",
        "09478" to "La Réunion, Mayotte",
        "09479" to "La Réunion, Mayotte",
    )

    val TOUS = METROPOLE + OUTRE_MER.keys
}

object FiltreNumeros {

    /** Motif enregistré dans le journal pour un appel sans numéro affiché. */
    const val MOTIF_MASQUE = "masqué"

    /**
     * Renvoie le motif de blocage de l'appel (le préfixe en cause, ou [MOTIF_MASQUE]),
     * ou null si la montre doit sonner. [numero] vaut null pour un numéro masqué.
     */
    fun motifBlocage(numero: String?, prefixes: List<String>, bloquerMasques: Boolean): String? {
        if (numero.isNullOrBlank()) return if (bloquerMasques) MOTIF_MASQUE else null
        val national = normaliserNumero(numero)
        if (national.trimStart('+').isEmpty()) return null
        return prefixes.firstOrNull { national.startsWith(it) }
    }

    /**
     * Ramène un numéro au format national (« 0162… »), quelle que soit sa
     * présentation : « +33 1 62… », « 0033162… », « +33 (0)1 62… », « 33162… ».
     * Les numéros étrangers gardent leur « + » (« +44… »).
     */
    fun normaliserNumero(numero: String): String {
        val n = normaliser(numero)
        // 33XXXXXXXXX sans « + », présentation utilisée par certains opérateurs
        if (n.length == 11 && n.startsWith("33")) return "0" + n.substring(2)
        return n
    }

    /** Normalise un préfixe saisi sur la montre, ou renvoie null s'il n'est pas valide. */
    fun normaliserPrefixe(saisie: String): String? {
        if (saisie.any { it.isLetter() }) return null
        return normaliser(saisie).takeIf { it.trimStart('+').length in 2..15 }
    }

    /** « 01 62 12 34 56 » pour un numéro français, numéro brut sinon. */
    fun formater(numero: String): String {
        val n = normaliserNumero(numero)
        if (n.length != 10 || !n.startsWith("0")) return numero.trim()
        return n.chunked(2).joinToString(" ")
    }

    private fun normaliser(texte: String): String {
        val brut = texte.trim()
        val chiffres = brut.filter { it.isDigit() }
        if (!brut.startsWith("+") && !chiffres.startsWith("00")) return chiffres
        val international = chiffres.removePrefix("00")
        if (!international.startsWith("33")) return "+$international"
        // « +33 (0)1 62… » : le 0 entre parenthèses ne fait pas partie du numéro
        return "0" + international.substring(2).removePrefix("0")
    }
}
