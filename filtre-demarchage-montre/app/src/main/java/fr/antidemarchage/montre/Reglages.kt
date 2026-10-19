package fr.antidemarchage.montre

import android.content.Context
import androidx.core.content.edit

data class AppelBloque(val horodatage: Long, val numero: String?, val motif: String)

/** Réglages et journal des appels bloqués, stockés dans les préférences de l'appli. */
class Reglages(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences("reglages", Context.MODE_PRIVATE)

    var prefixesArcepActifs: Boolean
        get() = prefs.getBoolean(CLE_ARCEP, true)
        set(valeur) = prefs.edit { putBoolean(CLE_ARCEP, valeur) }

    var bloquerMasques: Boolean
        get() = prefs.getBoolean(CLE_MASQUES, false)
        set(valeur) = prefs.edit { putBoolean(CLE_MASQUES, valeur) }

    val prefixesPerso: List<String>
        get() = lignes(CLE_PERSO)

    /** Ajoute un préfixe perso ; renvoie false si la saisie n'est pas un préfixe valide. */
    fun ajouterPrefixe(saisie: String): Boolean {
        val prefixe = FiltreNumeros.normaliserPrefixe(saisie) ?: return false
        val actuels = prefixesPerso
        if (prefixe !in actuels) enregistrerLignes(CLE_PERSO, actuels + prefixe)
        return true
    }

    fun retirerPrefixe(prefixe: String) = enregistrerLignes(CLE_PERSO, prefixesPerso - prefixe)

    fun motifBlocage(numero: String?): String? {
        val prefixes = (if (prefixesArcepActifs) PrefixesArcep.TOUS else emptyList()) + prefixesPerso
        return FiltreNumeros.motifBlocage(numero, prefixes, bloquerMasques)
    }

    /** Appels bloqués, du plus récent au plus ancien. */
    val journal: List<AppelBloque>
        get() = lignes(CLE_JOURNAL).mapNotNull { ligne ->
            val champs = ligne.split('\t', limit = 3)
            val horodatage = champs[0].toLongOrNull() ?: return@mapNotNull null
            if (champs.size < 3) return@mapNotNull null
            AppelBloque(horodatage, champs[1].ifEmpty { null }, champs[2])
        }

    fun journaliser(numero: String?, motif: String) {
        val ligne = "${System.currentTimeMillis()}\t${numero.orEmpty()}\t$motif"
        enregistrerLignes(CLE_JOURNAL, (listOf(ligne) + lignes(CLE_JOURNAL)).take(TAILLE_JOURNAL))
    }

    fun effacerJournal() = prefs.edit { remove(CLE_JOURNAL) }

    private fun lignes(cle: String): List<String> =
        prefs.getString(cle, null).orEmpty().lines().filter { it.isNotEmpty() }

    private fun enregistrerLignes(cle: String, lignes: List<String>) =
        prefs.edit { putString(cle, lignes.joinToString("\n")) }

    private companion object {
        const val CLE_ARCEP = "prefixes_arcep"
        const val CLE_MASQUES = "bloquer_masques"
        const val CLE_PERSO = "prefixes_perso"
        const val CLE_JOURNAL = "journal"
        const val TAILLE_JOURNAL = 100
    }
}
